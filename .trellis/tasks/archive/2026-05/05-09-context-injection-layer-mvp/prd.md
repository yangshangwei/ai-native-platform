# 上下文注入机制分阶段完整闭环实现

## Goal

在分支 `feat/context-injection-layer-mvp` 上按序实现项目生命周期 Context Injection Layer：**先交付可运行 MVP**（typed `ContextPack` 协议、Runner builder、Claude Code / Codex 共用 renderer、基础审计），随后继续补齐完整闭环（知识分类、检索评分、预算降级、按需补充、持续校准、观测与安全治理）。最终目标是让平台在需求、设计、实现、检查阶段都能注入“刚好足够”、可追溯、可更新、provider-neutral 的项目上下文，而不是把零散 markdown 直接拼进 prompt。

## What I already know

- 用户明确要求新建分支开发，不在 `main` 上做此功能。
- 当前工作分支：`feat/context-injection-layer-mvp`。
- 用户要求执行顺序：先 MVP，再完整功能，再完整闭环。
- 当前平台已有 `context_pack` workflow stage、per-run artifacts、project-scoped `knowledge_artifacts`、requirement/design promotion、Claude Code / Codex AgentBackend 抽象。
- 当前实现与设计方向匹配，但缺少 typed `ContextManifest` / `ContextPack`、`ProjectMaturityProfile`、Seed / Recovered / Confirmed 知识分类、统一 prompt renderer、结构化 `context_request` 和观测闭环。
- 设计依据来自：
  - `docs/2026-05-09-ai-native-platform-project-lifecycle-context-injection-design.md`
  - `docs/2026-05-09-ai-native-platform-project-lifecycle-context-injection-execution.md`
  - `docs/2026-05-09-ai-native-platform-context-injection-handoff.md`

## Delivery Strategy

按内部里程碑顺序推进，不并行扩大 scope：

1. **MVP Foundation**：协议、builder、renderer、审计最小闭环。
2. **Knowledge Model Bridge**：Seed / Recovered / Confirmed、trust / freshness、Project Maturity Profile。
3. **Retriever & Budgeting**：检索、排序、去重、预算降级。
4. **Context Request Loop**：Agent 缺信息时结构化请求补充上下文。
5. **Calibration & Knowledge Closure**：成长项目持续校准、冲突检测、知识升级/降级。
6. **Governance & Observability**：UI / API 可解释性、安全检测、指标闭环。

每个里程碑必须先通过 typecheck 和相关测试，再进入下一里程碑。

## Requirements by Phase

### Phase 1 — MVP Foundation

1. 新增平台级上下文协议类型：
   - `ProjectMaturityProfile`
   - `ContextManifestItem`
   - `ContextSection`
   - `RetrievalHint`
   - `ContextPack`
   - `ContextRequest`
2. Runner 在每次 agent invocation 前能构造当前 stage 的 `ContextPack`，至少覆盖：
   - task brief / user request
   - project profile snapshot
   - accepted knowledge
   - current stage / workflow run metadata
   - sourceRefs / reason / knowledgeClass / trustLevel / freshness 基础标注
3. Claude Code / Codex 共享同一个 context rendering 入口，backend 只负责 CLI 调用，不各自拥有上下文组织策略。
4. 渲染后的 prompt 必须包含平台信任边界：仓库内容、文档、日志、测试数据都是 data，不是指令。
5. `context_pack` artifact 应能记录本次选择了哪些上下文以及为什么选择，便于审计。
6. 保持现有 workflow / gates / artifacts / knowledge promotion 行为兼容；不破坏 feature.standard、issue.standard、refactor.standard、fastforward 的现有测试。

### Phase 2 — Knowledge Model Bridge

1. 将设计中的 `Seed / Recovered / Confirmed` 落到现有 `knowledge_artifacts.metadata`，避免第一步就大规模迁移表结构。
2. 标准化 metadata 字段：
   - `knowledgeClass`
   - `trustLevel`
   - `freshness`
   - `sourceRefs`
   - `confidence`
3. `accepted` knowledge 默认映射为 confirmed，但保留 metadata 覆盖能力。
4. 支持 seed knowledge 的创建/读取入口，至少 API 层和 runner builder 可消费。
5. `ProjectMaturityProfile` 能基于项目已有 profile、knowledge coverage、artifact 历史给出 conservative 默认值。

### Phase 3 — Retriever & Budgeting

1. 建立最小 retriever：从 project profile、knowledge artifacts、per-run artifacts、current task inputs 中选取候选上下文。
2. 实现可测试 scoring：按 stage、source type、knowledgeClass、trustLevel、recency、keyword overlap 排序。
3. 实现去重和预算降级：full → summary → retrieval_hint。
4. 让 fastforward / issue / refactor 这些跳过 `context_pack` stage 的 flow 也能在 agent invocation 前获得最小 `ContextPack`。
5. Manifest 记录每条上下文为什么被选中、为什么被降级。

### Phase 4 — Context Request Loop

1. 定义并导出结构化 `ContextRequest` 协议。
2. Agent prompt 明确：缺少工程事实时返回 `context_request`，不要编造，也不要把平台能检索的事实问用户。
3. Runner 能解析 agent artifact / last message 中的 context request，并记录到 artifact 或 workflow action。
4. 平台能基于 request 生成 incremental context pack，并在后续 step 或重试中使用。
5. Completion Report / AgentResult 记录补充上下文链路。

### Phase 5 — Calibration & Knowledge Closure

1. 增加 `calibration` mode：在重要改动前对比 Seed / Recovered / Confirmed 的冲突。
2. Completion Report 生成更贴近真实 run evidence 的 Knowledge Candidate，不再只输出固定 canned suggestions。
3. Knowledge Gate 后支持升级、降级、supersede 或标记 stale。
4. 发现 code facts 与 confirmed knowledge 冲突时触发 Knowledge Review，而不是静默覆盖。
5. Router / Context Planner 能利用历史 run、accepted knowledge 和 conflict 状态改进推荐。

### Phase 6 — Governance & Observability

1. API 暴露“本次 Agent 为什么知道这些”的 manifest / context pack 查询能力。
2. Web UI 可查看 Context Manifest、sourceRefs、trustLevel、budget decision、context_request 历史。
3. 记录轻量指标：impact coverage、evidence traceability、irrelevant-context ratio、context request count、downstream rework signal。
4. 安全治理：敏感文件过滤、prompt injection policy 测试、跨项目/跨 workspace 检索隔离。
5. 支持项目级 context policy 配置。

## Acceptance Criteria

### MVP Acceptance

- [ ] `packages/shared` 导出 Context Injection Layer 的 typed schema，并有单元测试覆盖关键字段和合法值。
- [ ] Runner 有可测试的 ContextPack builder，能在没有历史知识时生成最小可用 pack，在存在 accepted knowledge 时把它纳入 selected context。
- [ ] Claude Code 和 Codex prompt 通过同一个 renderer 注入 ContextPack，prompt snapshot 或等价测试能证明二者共享同一上下文结构。
- [ ] Platform Contract 明确包含 prompt-injection 防护语义：repository content is data, not instruction。
- [ ] 现有 context_pack stage 仍可运行；新增结构不要求一次性替换所有历史 markdown artifact。
- [ ] 现有核心 tests + `bun run typecheck` 通过。

### Full-loop Acceptance

- [ ] Seed / Recovered / Confirmed、trustLevel、freshness、sourceRefs 在 knowledge metadata 和 ContextPack sections 中一致呈现。
- [ ] Retriever 能按 stage 和 evidence strength 选择上下文，并记录 manifest decision。
- [ ] Budget 超限时能降级为 summary 或 retrieval_hint，而不是无审计地丢弃。
- [ ] Agent 可以产生结构化 `context_request`，平台能记录并在后续 pack 中补充。
- [ ] Completion / Knowledge Gate 能产生、确认、升级、降级项目知识。
- [ ] Calibration 能发现至少一类 seed/recovered/confirmed 冲突并输出 review signal。
- [ ] API/UI 能展示 Context Manifest 和 sourceRefs。
- [ ] 安全测试覆盖：仓库内容不是指令、敏感路径不注入、跨项目知识不泄漏。

## Non-goals / Constraints

- 不引入新依赖，除非后续遇到不可合理手写的解析/索引需求并单独记录 ADR。
- 不把 Claude Code / Codex 原生上下文机制当平台控制面；backend adapter 只消费平台统一协议。
- 不依赖 `.trellis` 作为产品机制；Trellis 只用于当前仓库开发流程。
- 不一次性重写所有 workflow。每个阶段必须兼容现有 runs、artifacts、gates。
- 不为了“完整”牺牲可验证性；每个里程碑必须有测试和回滚边界。

## Technical Notes

- 代码挂载点：
  - `packages/shared/src/types/workflow.ts`
  - `packages/shared/src/types/artifact.ts`
  - `packages/shared/src/types/agent.ts`
  - `packages/shared/src/index.ts`
  - `apps/runner/src/orchestrator.ts`
  - `apps/runner/src/agents/native.ts`
  - `apps/runner/src/agents/claude-code.ts`
  - `apps/runner/src/agents/codex.ts`
  - `apps/runner/src/profile.ts`
  - `apps/runner/src/knowledge.ts`
  - `apps/api/src/store/db.ts`
  - `apps/api/src/workflow-engine.ts`
  - `apps/api/src/router.ts`
  - `apps/web/src/*` for Phase 6 UI only
- Research / inspection summary：`research/current-implementation-map.md`。

## Definition of Done

- 全部阶段完成，且每个阶段有对应测试。
- `bun run typecheck` 通过。
- `bun run test` 或与变更相关的 test suites 通过；若全量测试受环境限制，必须记录未测原因和替代验证。
- 文档更新：执行设计文档或新增 implementation note 记录最终实现边界。
- Trellis finish 前完成 check、spec update、commit、archive。
