# 交付工作台上下文管理优化任务分解

> 日期：2026-06-27  
> 性质：任务分解文档  
> 对应需求：`docs/2026-06-27-context-management-optimization-requirements.md`  
> 对应设计：`docs/2026-06-27-context-management-optimization-design.md`

## 总体路线

先把现有上下文链路变得可见、可恢复、可治理，再增强检索能力。

推荐分四个里程碑：

1. M1：上下文可审计 MVP。
2. M2：上下文注入治理。
3. M3：可观测与质量保障。
4. M4：检索增强。

当前状态（2026-06-27）：P0 文档校准、P1 ContextPack 持久化、P2 stage checkpoint 和 P3 输入注入策略已在本分支推进；P4 及以后仍待实现。

## M1：上下文可审计 MVP

### P0：文档与行为校准

#### 目标

修正上下文架构文档与当前代码行为不一致的问题。

#### 任务

1. 更新 `docs/2026-06-27-context-management-architecture.md`。
2. 明确当前 `context_request` 已支持一次 same-step supplement retry。
3. 补充当前阶段间传递机制：artifact + `RunCtx.inputs` + fresh `ContextPack`。
4. 标注当前限制：历史 base pack artifact 不完整、隐式 handoff、阶段 checkpoint 不足、输入注入策略不足。

#### 验收标准

- 文档与 `invokeSkill()` 行为一致。
- 新人能理解需求分析结果如何传递给架构设计 agent。
- 文档明确 base invocation、supplement pack、retry limit 的关系。

#### 状态

已完成：架构说明已校准为 same-step supplement retry 一次，并补充 artifact + `RunCtx.inputs` + fresh `ContextPack` 的阶段传递机制。

### P1：ContextPack 持久化

#### 目标

每次 agent 调用前保存 base context pack，触发 `context_request` 时保存 supplement context pack。

#### 任务

1. 在 `invokeSkill()` 中生成 `invocationId`。
2. 保存 `kind='context_pack'`、`metadata.contextPackRole='base'` 的 base artifact。
3. 保存 `kind='context_pack'`、`metadata.contextPackRole='supplement'` 的 supplement artifact。
4. 在 agent session metadata 中记录 context artifact id。
5. 在 context governance read model 中聚合 base/supplement context pack。

#### 涉及文件

- `apps/runner/src/orchestrator/invoke-skill.ts`
- `apps/runner/src/api-client.ts`
- `apps/runner/src/context/builder.ts`
- `apps/api/src/context-governance.ts`
- `apps/api/src/routes/runner-events.ts`
- `apps/api/src/workflow-engine.ts`
- `packages/shared/src/types/context.ts`

#### 验收标准

- 任意一次 invocation 都能查到 base context pack。
- 触发 `context_request` 时能查到 request artifact、supplement artifact 和 retry 关系。
- 单测覆盖正常调用和 supplement retry。

#### 状态

已完成：

- 正常 invocation 会在 backend 调用前写 base `ContextPack` JSON artifact。
- `context_request` 捕获会写 request artifact 和 supplement `ContextPack` artifact，并复用该 supplement artifact 作为 retry session metadata。
- `AgentSession.metadata` 记录 `invocationId`、`contextPackArtifactId`、`contextPackRole` 和 retry 关系。
- `/workflow-runs/:id/context` 可聚合 artifact metadata 中的 base/supplement pack、role、invocationId、retryIndex 和 request 链路。

## M2：上下文注入治理

### P2：Stage checkpoint

#### 目标

阶段上下文可恢复、可回放。

#### 任务

1. stage start 写入 checkpoint。
2. stage finish 写入 checkpoint。
3. checkpoint 记录 `inputs`、`inputArtifactIds`、产物 artifact id、context pack artifact id。
4. 实现从 checkpoint 重建 `RunCtx` 的函数。
5. 添加恢复场景测试。

#### 涉及文件

- `apps/runner/src/orchestrator/steps.ts`
- `apps/runner/src/orchestrator/types.ts`
- `apps/runner/src/orchestrator/invoke-skill.ts`

#### 验收标准

- 模拟中断后可恢复上下文。
- checkpoint 中能看到 `requirement.md` 对应 artifact id。
- 不影响现有 workflow 执行。

#### 状态

已完成：

- agent stage start / finish 会写入 stage context checkpoint metadata。
- checkpoint metadata 包含 `inputs`、命名 `inputArtifactIds`、产物 artifact id map 和 context pack artifact id。
- runner 提供从 checkpoint metadata 恢复 `RunCtx.inputs` / `RunCtx.inputArtifactIds` 的 helper。
- 单测覆盖 `requirement.md` artifact id 捕获和 restore map 重建。

### P3：输入注入策略

#### 目标

避免所有上游输入默认全文注入，降低 token 成本和上下文噪音。

#### 任务

1. 在 skill 定义中增加 input policy。
2. renderer 支持 `full`、`summary`、`reference`、`omit`。
3. 实现超预算自动降级。
4. 为 `requirement.md -> design stage` 配置首个策略样例。
5. 在 prompt audit 中记录每个输入的注入模式。

#### 涉及文件

- `apps/runner/src/skills/index.ts`
- `apps/runner/src/context/renderer.ts`
- `apps/runner/src/context/builder.ts`
- `packages/shared/src/types/context.ts`

#### 验收标准

- 架构设计阶段能拿到需求摘要和 artifact 引用。
- 大文档不会默认全文进入 prompt。
- required 输入被降级时有明确 audit 记录。

#### 状态

已完成：

- shared `SkillInputInjectionPolicy` / `InputInjectionMode` 已定义。
- `SkillSpec.inputPolicies` 可声明 `full`、`summary`、`reference`、`omit`。
- renderer 会按策略渲染输入 artifact，并输出 input injection audit。
- design stage 对 `requirement.md` 使用 summary + artifact reference。
- budget 降级按 `full -> summary -> reference -> omit` 执行；required 输入至少保留 reference 并写 warning。

### P4：Stage handoff

#### 目标

让阶段之间的语义交接显式化。

#### 任务

1. 阶段完成时生成 handoff artifact。
2. handoff 包含 summary、decisions、risks、openQuestions、producedArtifacts。
3. 下游阶段优先读取上游 handoff。
4. 为需求分析到架构设计打通第一条 handoff 链路。
5. 在 context governance read model 中展示 handoff。

#### 涉及文件

- `apps/runner/src/orchestrator/steps.ts`
- `apps/runner/src/orchestrator/types.ts`
- `apps/api/src/context-governance.ts`
- `apps/web/src/page-task-detail.ts`

#### 验收标准

- 下游阶段可读取上游 handoff。
- handoff 中能看到上游关键结论和开放问题。
- handoff 不替代原始 artifact。

## M3：可观测与质量保障

### P5：上下文审计报告

#### 目标

让上下文使用过程可解释。

#### 任务

1. 生成 context audit report。
2. 展示使用、降级、丢弃的上下文。
3. 展示 token 预算。
4. 展示 `context_request` 和 retry 记录。
5. 在 Web 任务详情页补充上下文审计入口。

#### 涉及文件

- `apps/api/src/context-governance.ts`
- `apps/web/src/data-loading.ts`
- `apps/web/src/page-task-detail.ts`
- `apps/runner/src/context/renderer.ts`

#### 验收标准

- 能回答“agent 实际看到了什么”。
- 能回答“为什么某个 artifact 没有注入”。
- 排障不依赖手翻 runner 日志。

### P6：测试与回归

#### 目标

锁住上下文传递行为，防止回归。

#### 任务

1. 单测 ContextPack 持久化。
2. 单测 checkpoint 写入和恢复。
3. 单测 renderer 注入策略。
4. 集成测试需求分析到架构设计链路。
5. 回归测试现有 workflow。
6. 增加 `context_request` retry limit 测试。

#### 验收标准

- 主链路测试通过。
- 老 workflow 兼容。
- 新 artifact 不影响现有产物生成。
- retry limit 行为有确定性测试。

## M4：检索增强

### P7：Hybrid retrieval

#### 目标

在可审计链路稳定后，引入更强的上下文检索能力。

#### 任务

1. 建立 FTS/BM25 文档索引。
2. 建立代码符号索引。
3. 可选接入 embedding 检索。
4. 实现 hybrid ranking。
5. 保持 `sourceRefs` 和 ranking reason 可解释。

#### 验收标准

- agent 可按任务目标检索相关文档和代码。
- 检索结果带 sourceRefs。
- 不破坏 provider-neutral 的 `ContextPack`。

### P8：MCP resource gateway

#### 目标

把 artifact、context pack、handoff、checkpoint 暴露为标准资源接口。

#### 任务

1. 设计 resource URI 规范。
2. 支持 list resources。
3. 支持 read resource。
4. 支持按 run/stage/invocation 查询上下文资源。
5. 与 context governance read model 对齐。

#### 验收标准

- agent 能通过 resource URI 读取上下文资源。
- resource 内容与 artifact/read model 一致。
- 不绕过现有 trust boundary。

## 推荐实施顺序

第一批：

1. P0 文档与行为校准。
2. P1 ContextPack 持久化。
3. P2 Stage checkpoint。
4. P3 输入注入策略。

第二批：

1. P4 Stage handoff。
2. P5 上下文审计报告。
3. P6 测试与回归。

第三批：

1. P7 Hybrid retrieval。
2. P8 MCP resource gateway。

## 不建议的路线

不建议一开始就引入向量数据库或复杂 RAG 平台。

原因：

1. 当前最大问题是上下文链路不可审计、不可回放、交接不显式。
2. 如果先上 embedding，仍然无法回答“agent 为什么看到这些上下文”。
3. 现有 `ContextPack` 已经是较好的抽象，应先补齐治理能力。
4. 检索增强应建立在稳定的 artifact、handoff、checkpoint 和 sourceRefs 之上。

## 完成定义

一期完成时，系统应满足：

- 每次 agent invocation 有 context snapshot。
- 每个 stage 有 start/finish checkpoint。
- 需求分析到架构设计有显式 handoff。
- renderer 支持输入注入策略。
- context governance 能解释上下文来源、注入方式和 retry 链路。
