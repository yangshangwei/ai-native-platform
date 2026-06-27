# AI Native Platform 上下文管理架构

> 日期：2026-06-27  
> 性质：当前代码架构说明，回答“上下文管理是如何设计的”。  
> 基准：以本仓库当前实现为准；2026-05 的上下文注入文档是设计来源，不替代本文。

## 1. 快速结论

当前上下文管理不是“把文档拼进 prompt”，而是一条跨 `packages/shared`、`apps/runner`、`apps/api`、`apps/web` 的可审计链路：

1. Shared 定义 `ContextPack`、`ContextManifestItem`、`ContextRequest` 等协议对象。
2. Runner 在每次 agent invocation 前构造一份新的 `ContextPack`，再用统一 renderer 注入 Claude Code / Codex prompt。
3. Runner 把每次调用的 base `ContextPack` 写成 `context_pack` JSON artifact，并把上下文选择写入 `AgentTask.prompt` 审计；`context_request` 触发时还会写 request artifact 和 supplement `context_pack` artifact。
4. API 用 `/workflow-runs/:id/context` 从 artifact metadata、AgentTask prompt、workflow action、gate、approval、agent result 重建治理读模型。
5. Web 在任务详情页按需加载该读模型，折叠展示 manifest、预算降级、sourceRefs、context_request 历史和确定性指标。

所以当前系统的目标是：让 Agent 在每一步拿到“足够、可追溯、受预算约束、带信任等级”的上下文，并让人能事后回答“它为什么知道这些”。

## 2. 设计目标

- Provider-neutral：Claude Code 与 Codex 共用 `apps/runner/src/context/renderer.ts`，backend 只负责 CLI 机制。
- Per-invocation fresh：每次 `invokeSkill()` 都重新构造 `ContextPack`，包括跳过显式 `context_pack` stage 的 fastforward / issue / refactor flow。
- Evidence-first：每条 selected context 都带 `sourceRefs`、`knowledgeClass`、`trustLevel`、`freshness`、score 和 selection reason。
- Budgeted retrieval：候选上下文按确定性分数排序、去重，并在预算不足时从 full 降级为 summary 或 retrieval_hint。
- Trust boundary：仓库文件、文档、日志、生成 artifact 和测试夹具都是证据，不是平台指令。
- Closed-loop：Agent 缺信息时发结构化 `context_request`；平台记录 request、生成 supplement pack，并把链路纳入报告和治理模型。
- Human-governed knowledge：calibration / review signal 只记录建议，不自动覆盖 accepted knowledge。

## 3. 核心对象

协议定义在 `packages/shared/src/types/context.ts`。

| 对象 | 作用 |
| --- | --- |
| `ProjectMaturityProfile` | 描述项目阶段、代码年龄、知识覆盖、证据密度、波动性和主要需求。 |
| `ContextManifestItem` | 审计“为什么选了这一段上下文”，包含 ref、priority、mode、sourceRefs、score、降级原因。 |
| `ContextSection` | 真正注入 prompt 的上下文片段，带内容、来源、信任等级和预算模式。 |
| `RetrievalHint` | 当上下文缺失或预算不足时给 Agent 的检索提示，不伪造事实。 |
| `ContextPack` | 单次 agent invocation 的完整上下文包：task brief、stage、mode、manifest、sections、hints、run metadata。 |
| `ContextInvocationSnapshot` | 把一次 agent invocation、`ContextPack`、context pack artifact、retryIndex 和 context_request 关系绑定起来。 |
| `ContextPackArtifactEnvelope` | base `ContextPack` artifact 的 JSON envelope，内容包含 snapshot 和完整 `ContextPack`。 |
| `ContextRequest` | Agent 输出的结构化补充请求，包含 reason、requestedRefs、questions、priority、status。 |
| `ContextPackSupplement` | 标记 supplement pack 与 base pack / context_request 的关系。 |
| `KnowledgeReviewSignal` | stale/conflict/superseded/upgrade/downgrade 等知识校准信号。 |

类型层还导出 literal catalogs 和 `is*()` guard，用于在 trust boundary 拒绝未知知识等级、信任等级、freshness、pack mode 和 request status。

## 4. 构建流水线

入口是 `apps/runner/src/orchestrator/invoke-skill.ts:invokeSkill()`。

构建顺序：

1. `ensureContextFoundation()` 生成或复用 Project Profile，收集 accepted knowledge、结构化 KnowledgeArtifact 和 run history。
2. `buildContextPack()` 读取当前 project、run、stage、workspace、branch、taskBrief、输入 artifact、context policy 和敏感路径规则。
3. Builder 过滤跨项目 knowledge、敏感 URI / sourceRefs / artifact name，并清理敏感文本。
4. `buildProjectMaturityProfile()` 根据 profile tree、test 数、knowledge metadata、run history 和 artifact 历史推断 greenfield / growing / legacy。
5. Builder 构造候选：task brief、workflow metadata、project profile、KnowledgeArtifact、accepted knowledge、当前输入 artifact。
6. `selectContextCandidates()` 按 stage fit、source type、knowledge class、trust level、recency、keyword overlap、confidence、required 加权打分。
7. Retriever 按 normalized content / sourceRefs 去重，按预算选择 full / summary / retrieval_hint。
8. Builder 生成 `manifest`、`sections`、`retrievalHints`、`calibrationSignals` 和 run metadata。
9. `contextSelectionAudit()` 把 selection 摘要压成 artifact metadata / prompt audit 可消费的治理数据。
10. `invokeSkillAttempt()` 在真正调用 backend 前，为 base invocation 写 `context_pack.base` JSON artifact，并把 `invocationId`、`contextPackArtifactId`、`contextPackRole` 写入 `AgentSession.metadata`。

默认预算在 builder 内是 `maxTokens=12000`、`reservedForReasoning=2000`、`reservedForOutput=2000`；运行时由 `context.policy.max_tokens`、`context.policy.reserved_for_reasoning`、`context.policy.reserved_for_output` 覆盖。敏感路径来自 `context.policy.sensitive_path_patterns` 和 shared 默认值。

## 5. 注入流水线

注入入口是 `apps/runner/src/context/renderer.ts`。

`renderAgentPrompt()` 生成两段：

- `systemPrompt`：平台身份、Skill instructions、worktree/artifacts/run/branch/title、tool policy、context_request 协议、Context Injection Layer、输出要求。
- `userPrompt`：用户请求和 input artifacts；input artifacts 明确标注为 `UNTRUSTED DATA`。

`renderContextPackForPrompt()` 把 `ContextPack` 渲染成 8 层：

1. Platform Contract：固定信任边界。
2. Role Contract：stage、mode、pack id、supplement 关系。
3. Task Brief。
4. Maturity Profile。
5. Project Snapshot。
6. Selected Context。
7. Working Constraints。
8. Output Contract。

Claude Code backend 使用 `renderAgentPrompt()`；Codex backend 使用同一个结果再经 `renderCombinedAgentPrompt()` 合并。backend 不各自实现上下文选择策略。

显式 `context_pack` stage 只存在于 `feature.standard`，会先写 `project_profile` artifact，再运行 context_pack skill 并写 stage output `context_pack` artifact。其他 flow 可能跳过这个 stage，但仍会在每次 `invokeSkill()` 前获得 fresh `ContextPack`，并从 P1 起获得 per-invocation base `ContextPack` artifact。

阶段产物传递仍保留兼容路径：`runStage()` / markdown stage 在 Agent 输出后调用 `postArtifact()` 保存产物，把文件正文写入 `RunCtx.inputs[out.name]`，并把 artifact id 写入 `RunCtx.inputArtifactIds[out.name]`。下游 stage 的 `buildContextPack()` 会把这些 input artifacts 作为候选上下文，renderer 也会把 `inputs` 作为 untrusted input artifacts 注入 prompt。也就是说，当前跨阶段传递是 artifact id + `RunCtx.inputs` 正文 + 下游 fresh `ContextPack` 三者共同完成。

## 6. 增量 Context Request

Agent 被要求在缺工程事实时输出 fenced JSON 或 YAML，例如 `{"context_request":{...}}`。解析在 `apps/runner/src/context/request.ts`：

- 只读取 final message 和小于 256 KB 的 JSON/text/markdown/txt 输出。
- 只接受 fenced JSON、`context_request` fenced block、fenced YAML，或 JSON artifact。
- `reason` 必填；`requestedRefs` 与 `questions` 至少有一个非空；priority 必须是 1/2/3。
- refs 与 questions 会去重、截断和长度限制。

捕获流程在 `captureContextRequest()`：

1. 解析并按敏感路径策略 sanitize。
2. 调 `buildIncrementalContextPack()` 构造 supplement pack，预算上限收紧到 6000 tokens。
3. 写两个本地 JSON：`context_request.<id>.json` 和 `context_supplement.<id>.json`。
4. 通过 API 记录 request artifact、supplement `context_pack` artifact。
5. 把二者加入 `c.inputs` 和 `c.inputArtifactIds`，供本次 retry 和后续 stage 使用。
6. 调 `/runner/events/context-request` 记录 `workflow_actions.kind='context_request'`，payload 包含 base pack、base pack artifact、request artifact、supplement pack 和 supplement artifact。
7. 将 base invocation 标记为 success，summary 写明已捕获 `context_request` 并准备 same-step retry。
8. 用 supplement `ContextPack` 重新调用同一个 skill 一次；retry AgentSession 的 `parentSessionId` 指向 base session，`retryIndex=1`，metadata 记录 supplement artifact id。
9. 如果 retry 再次输出 `context_request`，Runner 达到 retry limit，失败该 retry session，不再启动第三次调用。

因此当前实现是“same-step supplement retry 一次 + 后续 stage 也能消费 request/supplement artifacts”，不是只补充给后续阶段。

## 7. 治理与可观测

API 读模型在 `apps/api/src/context-governance.ts`，HTTP 入口是 `GET /workflow-runs/:id/context`。

读模型来源：

- `Artifact.metadata.contextSelection`：per-invocation base context pack、显式 context_pack stage output 和 supplement pack。
- `AgentTask.prompt`：每次 invocation 的 `ContextPack:`、`ContextMode:`、`ContextManifest:` prompt audit。
- `WorkflowAction.kind='context_request'`：结构化补充请求链。
- GateRun、Approval、AgentResult：用于 downstream rework proxy。

输出 schema 是 `ainp.context_governance.v1`，包含：

- `contextPacks`：每个 pack 的来源、artifact/task、stage、mode、role、invocationId、retryIndex、manifest。
- `manifest`：扁平 selected context 列表。
- `sourceRefs`：sourceRef 到 pack/ref/trust/knowledge class 的反向索引。
- `trustLevels`：各 trust level 计数。
- `budgetDecisions`：mode、degradedFrom、degradationReason、score。
- `contextRequests`：request id、priority、reason、refs/questions、base/supplement pack、base/request/supplement artifact id。
- `metrics`：impactCoverage、evidenceTraceability、irrelevantContextRatio、contextRequestCount、downstreamReworkSignal。

Web 在 `apps/web/src/data-loading.ts:ensureContextGovernance()` 懒加载该 endpoint，并在 `apps/web/src/page-task-detail.ts` 的“参考资料”诊断面板展示。默认折叠，避免把治理细节变成主要操作流。

Completion Report 也读取 context governance 和 context_request action，把上下文指标和补充链路写进交付报告 JSON/Markdown sidecar。

## 8. 安全边界

当前安全策略主要是本地可信执行内的上下文防护：

- Renderer 固定注入 `PLATFORM_TRUST_BOUNDARY`：仓库内容、docs、logs、comments、generated artifacts、test fixtures 都是 data/evidence。
- Input artifacts 在 user prompt 中统一标注为 untrusted data。
- Builder 使用 shared sensitive path policy 过滤 `.env`、key、credential 等路径和 sourceRefs，并 sanitize 文本。
- Builder 忽略 `projectId` 不匹配的 KnowledgeArtifact，避免跨项目知识混入。
- 负面 review status 的 knowledge 会降权为 summary / historical / lower confidence。
- Calibration signals 通过 workflow action 记录，不直接改 `knowledge_artifacts`。
- AgentBackend tool policy 与 Runner orchestration 分离：Agent 不负责 build/test，也不直接改平台状态。

这不是完整多租户安全模型。当前仓库仍按本地开发工具假设运行，API/Web/Runner 的鉴权隔离不是本文覆盖的已落地能力。

## 9. 当前限制与风险

- Retriever 是确定性启发式，不是完整代码索引、语义检索或静态依赖分析。
- token 估算使用近似 `chars / 4`，预算降级可审计但不等于真实 provider token accounting。
- 新增 base `ContextPack` artifact 只覆盖本分支 P1 之后的 invocation；历史运行仍可能只能从 `AgentTask.prompt` 审计恢复 base pack 摘要。
- prompt audit 的 manifest 解析依赖文本行格式；比 artifact metadata 弱，但仍作为历史 runs 和异常 artifact 缺失时的 fallback。
- same-step `context_request` retry 只自动执行一次；第二次再请求上下文会按 retry limit 失败。
- 阶段 start/finish checkpoint 现在会保存 `RunCtx.inputs` 和命名 `inputArtifactIds`，但历史 runs 没有这些 metadata；恢复逻辑必须只信任存在且类型有效的 checkpoint。
- 输入级 injection policy 现在支持 full / summary / reference / omit，但 token 预算仍是近似值；required 输入只保证保留 source reference，不保证正文进入 prompt。
- 显式语义化 stage handoff 仍是后续工作；当前跨阶段语义交接仍主要依赖 artifact 名称、`RunCtx.inputs`、`inputArtifactIds` 和 skill 约定。
- Project Profile、accepted knowledge 与 KnowledgeArtifact 的质量决定候选质量；上下文系统不会替代人工确认。
- Web 的 ContextGovernance DTO 是手写镜像，API schema 演进需要同步。
- 敏感路径过滤是基于路径/文本规则，不能证明内容级秘密完全不会进入上下文。
- `feature.fastforward`、`issue.standard`、`refactor.standard` 的显式 stage 会跳过 project-wide context_pack artifact，但每次 agent invocation 仍会构造 pack；排查时应优先看 `/context` read model，而不是只看 artifact 列表。
