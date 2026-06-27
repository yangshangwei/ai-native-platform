# 技术架构分析文档

## Goal

基于当前 2026-06-27 代码事实，输出一份面向后续开发、评审和新人 onboarding 的技术架构文档，说明 AI Native Platform 现在的模块边界、数据流、运行时流程、核心不变量和已知风险。

## What I already know

- 仓库是 Bun + TypeScript monorepo，包含 `apps/api`、`apps/runner`、`apps/web`、`packages/shared` 四个主要包。
- 2026-05 的架构文档仍有参考价值，但代码已演进：Runner orchestrator 已去闭包化，Web 已从单体 `main.ts` 拆成页面模块，Shared 已承载 FLOW_REGISTRY，`ask` 问答流已变成轻量 chat-only 请求。
- 当前任务只产出文档，不改业务代码、不改变运行行为。

## Requirements

- 文档必须以当前代码为准，不复述过期规划。
- 覆盖整体进程边界：Browser/Web、API、Runner、本地 CLI/worktree、Shared 类型契约。
- 覆盖核心运行链路：项目接入、WorkflowRequest、Coordinator/Router、WorkflowRun、FLOW_REGISTRY、AgentBackend、ContextPack、Gate、Completion Report、Knowledge。
- 明确关键不变量：Workflow Engine 唯一状态写者、Gate Engine 唯一门禁判定者、Runner 只上报事件、Agent 不改平台状态、`ask` 不进入 workflow execution。
- 记录当前技术栈、持久化方式、测试/验证命令、扩展点和剩余风险。
- 更新 `docs/README.md`，让新文档可被发现。
- 补充一份专门回答“上下文管理是如何设计的”的当前实现文档，覆盖 ContextPack / ContextRequest / Runner 构建注入 / API 治理 / Web 展示 / 安全边界 / 已知风险。

## Acceptance Criteria

- [x] 新增一份当前架构文档，位置在 `docs/`。
- [x] `docs/README.md` 包含新文档入口。
- [x] 文档能回答“当前系统由哪些模块组成、一次任务如何流转、哪些边界不能破坏、未来扩展从哪里切入”。
- [x] 新增 `docs/2026-06-27-context-management-architecture.md`，能回答“上下文管理是如何设计的”。
- [x] 任务上下文文件 `implement.jsonl` / `check.jsonl` 从 seed 示例替换为真实上下文条目。
- [x] 文档修改完成后至少做 Markdown 结构检查和相关文件 diff 审阅。

## Definition of Done

- 文档写入并索引。
- 上下文管理架构文档写入并索引。
- Trellis 任务文件完整。
- 不产生业务代码改动。
- 验证结果和剩余风险在最终回复中说明。

## Technical Approach

先读当前实现入口和已沉淀设计文档，再以“当前事实 + 可维护架构地图”的形式重写，而不是继续扩写 5 月设计稿。文档结构预计包含：

- 快速结论与技术栈。
- 总体架构图和模块职责。
- 端到端任务流。
- 关键子系统：Workflow/Gate/Flow/Context/AgentBackend/Knowledge/Web。
- 数据模型与持久化。
- 扩展点、测试命令、架构风险。

## Decision (ADR-lite)

**Context**: 用户要求“分析当前技术架构，输出文档”。这是文档交付，不需要做架构重构。

**Decision**: 新增一份 2026-06-27 当前架构文档，并在 docs 索引中标注它是 6 月代码事实入口；保留既有 5 月设计文档作为历史/背景资料。

**Consequences**: 文档会把已落地事实和仍待演进风险区分开，避免后续开发者把旧规划误认为当前实现。

## Out of Scope

- 不改业务代码。
- 不新增依赖。
- 不重构模块。
- 不启动完整端到端运行链路。

## Technical Notes

- 已读入口：`README.md`、`docs/README.md`、`docs/2026-05-06-technical-architecture-design.md`、`docs/2026-05-09-ai-native-platform-project-lifecycle-context-injection-design.md`。
- 已读关键代码：API app/workflow/gate/router/store/routes，Runner watch/orchestrator/steps/invoke-skill/context/agent backends，Web main/shell/state/data-loading/router/new-task/task-detail/stream/coordinator-chat，Shared workflow/context/flow registry。
- 当前验证命令：文档任务优先做 Markdown 结构和 diff 检查；代码测试不作为必须项，因为不改业务逻辑。
