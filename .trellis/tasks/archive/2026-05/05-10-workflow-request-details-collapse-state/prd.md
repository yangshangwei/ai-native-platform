# 修复 Workflow Request 后端细节折叠自动收起

## Goal

用户在 Workflow Request 详情页展开「查看 Workflow Request 后端细节」后，页面的后台轮询刷新不应把该 `<details>` 自动折叠。修复后，用户展开/折叠的 UI 状态应在自动刷新期间稳定保留。

## What I already know

- 用户在任务详情页点击「当前阶段」内的「查看 Workflow Request 后端细节」，几秒后会自动折上。
- 截图中同一页面同时存在两个同名 summary：
  - 「当前阶段」面板内的「查看 Workflow Request 后端细节」
  - 「后端细节」面板内的「查看 Workflow Request 后端细节」
- `apps/web/src/main.ts` 每 3 秒轮询并调用 `render()` 重建 app root。
- `render()` 已有 `captureDetailsOpenState()` / `restoreDetailsOpenState()`，但当前 details key 只由 hash + details summary 路径组成。
- 两个同名顶层 `<details>` 的 state key 会冲突；捕获时后一个 closed 状态覆盖前一个 opened 状态，下一次 render 后就表现为“自动折上”。

## Requirements

- 自动轮询刷新期间，用户已展开的「当前阶段」里的 Workflow Request 后端细节保持展开。
- 页面上多个 summary 文案相同的 `<details>` 必须有互不冲突的持久化键。
- 修复应尽量局部，不改变 Workflow Request 后端数据展示内容。
- 不引入新依赖。

## Acceptance Criteria

- [ ] 在 `#task/<requestId>` 页面展开「当前阶段」内的「查看 Workflow Request 后端细节」后，等待至少一个 3 秒轮询周期仍保持展开。
- [ ] 同页下方「后端细节」内同名 `<details>` 的展开/折叠状态不再互相覆盖。
- [ ] 现有 details 状态保留机制仍适用于其它 details 面板。
- [ ] `bun run typecheck` 通过。
- [ ] 如有可运行测试，`bun test` 通过或明确记录跳过原因。

## Definition of Done

- 实现完成并通过质量检查。
- 若发现通用 UI 状态持久化约定需要补充，更新 `.trellis/spec/`。
- 提交前按项目 Lore Commit Protocol 准备提交信息。

## Technical Approach

优先修复 `apps/web/src/main.ts` 的 `<details>` 状态键生成：为容易重复的 details 节点提供显式 `data-details-key`，并让 `detailsStateKey()` 优先使用该键；没有显式键的节点继续沿用现有 summary-path fallback。针对本 bug，给两处 Workflow Request 后端细节分别设置稳定 key（例如 `request-debug-current-stage:<request.id>` 与 `request-debug-backend-panel:<request.id>`）。

## Decision (ADR-lite)

**Context**: 自动轮询会重建 DOM，必须把用户控制的展开状态保存在模块级状态中。当前 key 只看 summary，无法区分同页同名 details。

**Decision**: 引入可选的显式 details state key，并在重复文案的 Workflow Request debug panel 调用处传入不同 scope。

**Consequences**: 修复范围小，保持现有 fallback 行为；未来新增同名 details 时可以复用显式 key，避免再次冲突。

## Out of Scope

- 不修改后端 Workflow Request API。
- 不重构整个 `main.ts` 渲染架构。
- 不改变轮询间隔或禁用刷新。

## Technical Notes

- 主要文件：`apps/web/src/main.ts`
- 相关规范：`.trellis/spec/web/frontend/state-management.md`、`.trellis/spec/web/frontend/quality-guidelines.md`
- 观察到的刷新入口：`setInterval(..., 3000)` 调用 `loadData({ render: true, keepDetail: true })`。
- 观察到的冲突点：`renderRequestDebugPanel()` 被 `renderCurrentStagePanel()` 和 `renderQueuedBackendDetails()` 两处复用，summary 文案相同。
