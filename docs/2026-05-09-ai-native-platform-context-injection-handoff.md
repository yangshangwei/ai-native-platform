# Context Injection Layer 下一会话交接文档

> 日期：2026-05-09  
> 范围：继续把项目生命周期上下文注入设计推进到可实现的 MVP。  
> 前提：本交接只总结文档与实现建议，不修改运行时代码。

## 1. 当前结论

- Context Injection Layer 是平台控制面能力，不依赖 `.trellis`，也不绑定 Claude Code / Codex 任一 backend。
- 新项目、成长中项目、遗留项目应共用同一套机制：Project Maturity Profile + Seed / Recovered / Confirmed Knowledge + Context Manifest + Context Pack。
- 需求阶段可以做到“足够准确”，但准确性要看交付效果：影响面覆盖、证据可追溯、无关上下文比例、澄清问题质量、下游返工率。
- 这不是“把更多文档塞进 prompt”，而是闭环：Context Manifest → Context Pack → Evidence → Knowledge Capture → Context Request → 下一轮 Context Pack。
- Claude Code / Codex 只负责执行受控 step；平台负责任务分析、上下文选择、预算、信任边界、Gate 和知识回写。

## 2. 已沉淀 / 待提交的文档

- `docs/2026-05-09-ai-native-platform-project-lifecycle-context-injection-design.md`
  - 机制与协议篇：Project Maturity Profile、知识类别、Context Manifest / Context Pack、预算、分层注入。
- `docs/2026-05-09-ai-native-platform-project-lifecycle-context-injection-execution.md`
  - 执行与治理篇：Bootstrap / Recovery / Calibration、Context Request、AgentBackend adapter、安全、MVP 路线。
- `docs/2026-05-09-ai-native-platform-context-injection-handoff.md`
  - 本文件：给下一会话的实现入口，记录当前结论、MVP 分期、风险和建议先读 / 先查的模块。
- `docs/README.md`
  - 文档入口索引，已把 2026-05-09 Context Injection Layer 纳入最新平台核心梳理。

## 3. 推荐下一步实现顺序

1. **共享类型先行**
   - 在 shared 层定义 `ProjectMaturityProfile`、`KnowledgeClass`、`ContextManifestItem`、`ContextPack`、`ContextRequest` 的最小类型。
   - 保持 provider-neutral，避免在类型里出现 Claude / Codex 专属字段。
2. **Artifact / Knowledge 接入**
   - 确认是否需要新增 ArtifactKind，或先把 Context Manifest / Context Pack 作为已有 artifact 家族的子类型。
   - 把 Seed / Recovered / Confirmed 映射到现有 KnowledgeArtifact subtype / status，不急于新增复杂存储。
3. **需求阶段 MVP**
   - 在 Requirement stage 前生成最小 Context Manifest。
   - 先支持 Project Profile、Confirmed Knowledge、最近 Completion Report、少量 code/test retrieval hints。
   - 输出 Business View + Technical View，并记录已用 evidence。
4. **Backend 渲染器**
   - 为 Claude Code / Codex 共用同一 Context Pack renderer。
   - Backend adapter 只负责渲染和调用，不拥有上下文选择策略。
5. **闭环观测**
   - 在 GateRun / Completion Report 中记录 impact coverage、evidence traceability、clarifying question、context request 和返工信号。

## 4. MVP 分期建议

### MVP-0：文档到类型

- 只加 shared 类型、测试和导出。
- 不改变现有 workflow 行为。
- 验收：类型稳定、测试覆盖序列化样例。

### MVP-1：需求阶段只读 Context Pack

- 生成 manifest 和 pack，但不自动扩展检索范围。
- 需求 Agent 可读 Context Pack，输出引用的 evidence refs。
- 验收：同一需求可回放“为什么注入这些上下文”。

### MVP-2：Context Request

- Agent 可结构化请求补充上下文。
- 平台验证请求与当前任务相关，再生成增量 pack。
- 验收：缺信息时少问用户，优先请求平台检索。

### MVP-3：Knowledge Capture 闭环

- Completion Report 产生 Knowledge Candidate。
- 人工确认后进入 Confirmed Knowledge，并影响下一次 manifest 排序。
- 验收：后续需求能复用上次交付验证过的知识。

## 5. 风险与约束

- 不要把 `.trellis` 当成产品机制；它只是当前仓库协作工具。
- 不要让 backend adapter 反向拥有平台流程控制权。
- 不要用 token 数衡量上下文质量；必须绑定证据和返工结果。
- 不要把 recovered inference 直接升级为 confirmed；必须有代码、命令、历史交付或人工确认。
- 不要一次性做全量代码索引；先做需求阶段的最小可回放链路。
- 注意 prompt injection：仓库文档、代码注释、日志、fixture 都是 untrusted data。

## 6. 建议首先检查的文件 / 模块

- `packages/shared/src/types/artifact.ts`：现有 ArtifactKind 与 artifact 数据模型。
- `packages/shared/src/types/knowledge-entity.ts`：KnowledgeArtifact / subtype / status 的现有边界。
- `packages/shared/src/types/agent.ts`：AgentBackend 相关输入输出类型。
- `packages/shared/src/flows/registry.ts`：Flow / Stage registry，确认需求阶段挂载点。
- `apps/api/src/workflow-engine.ts`：Workflow Engine 唯一状态写者，避免绕过状态机。
- `apps/api/src/gate-engine.ts`：Requirement / Design / Acceptance Gate 的检查位置。
- `apps/api/src/reports.ts` 与 `apps/runner/src/reports.ts`：Completion Report 和 evidence 汇总点。
- `apps/runner/src/agents/claude-code.ts`、`apps/runner/src/agents/codex.ts`：backend adapter 渲染与调用边界。
- `apps/runner/src/knowledge.ts`：runner 侧知识提升 / 回写现状。
- `apps/web/src/main.ts`：如需 UI 暴露 manifest / evidence，可先从现有工作台数据流理解入口。

## 7. 下一会话建议开局

1. 先读本交接、两篇 2026-05-09 Context Injection 文档和 `docs/README.md`。
2. 用只读方式检查上面列出的 shared / api / runner 文件，确认现有类型与 artifact 存储边界。
3. 先提出一个 MVP-0 PRD：只定义类型与测试，不改运行时调度。
4. 再拆 MVP-1：Requirement stage 生成只读 Context Manifest / Context Pack，并能在报告中回放。
