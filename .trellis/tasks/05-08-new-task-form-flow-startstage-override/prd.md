# new-task-form 高级覆盖补 Flow / Start Stage 字段

## 起源（Carry-forward context）

源于 `05-06-new-task-form-router-driven-defaults`（已归档于 `2026-05`）的 **Implementation Deviations #1**——原 PRD Requirements 写「高级覆盖 disclosure 内含 Type / Flow / startStage 三个下拉」，commit `73ccd26` 落地时只放了 Type，Flow / startStage 因为牵扯 schema + DB + runner 三层 plumbing 被拆出来。

## Goal

补齐「新建任务」页「高级覆盖（Advanced Override）」disclosure 里的 **Flow** 和 **Start Stage** 两个下拉，让用户在显式覆盖 Type 时也能进一步覆盖 router 推荐的 flowId 和起始 stage。当前展开高级只能选 Type，Flow / startStage 仍由 router 决策——没有逃生口给"我就想从 design 阶段开始这个 run"的场景。

## Why（为什么 Deferred）

`73ccd26` 只把 Type 接进 `POST /workflow-requests` 的 body，因为：
- Type 字段本来就在 `WorkflowRequest` schema + DB column 里（server default = 'feature'）。
- Flow / startStage **当时没有** 在 schema 里，加它们需要：
  1. `WorkflowRequest` 类型 + DB column + migration 加 `flow_id` / `start_stage`
  2. `apps/api/src/routes/workflow-requests.ts` body 解析这两个新字段
  3. runner watch 在 `createWorkflowRun` 调用时把这两个值带过去（覆盖 Coordinator/Router 默认）
  4. UI 表单加两个下拉 + 联动逻辑（startStage 仅在 `feature.standard` 时显示）

每一步都有边角，所以拆出来单独做。

## What I already know

### 已经完成（在 73ccd26 commit 里）

- `POST /coordinator/preview` 端点存在 (`apps/api/src/routes/coordinator.ts`)。
- 新建任务页两段调用 (coordinator/preview → router/recommend) 已落地。
- `apps/web/src/main.ts` 高级覆盖 disclosure 已搭好（line ~3050 起 typeSelect），框架在；新增两个 select 是局部添加，不需要重写表单。
- mismatch detector (`main.ts:3673`) 不影响这次改动。

### 待做（本任务范围）

#### 1. Schema + DB

- `WorkflowRequest` 类型扩 `flowId?: FlowId | null` + `startStage?: WorkflowStage | null`。
- DB migration: `workflow_requests` 表加 `flow_id TEXT NULL` 和 `start_stage TEXT NULL` 两列（idempotent ALTER TABLE，参 V2 W2-1 的 PR 模式）。
- 类型存活在 `packages/shared/src/types/workflow.ts`。

#### 2. API 路由

- `apps/api/src/routes/workflow-requests.ts` POST handler 解析 `body.flowId` / `body.startStage`，落到 `WorkflowRequest` row。
- 校验：flowId 必须在 `FLOW_REGISTRY` 里（`packages/shared/src/flows/registry.ts`）；startStage 必须在选定 flow 的 stages 里（且仅当 `flow_id === 'feature.standard'` 时允许）；其他组合 400。

#### 3. Runner watch

- `apps/runner/src/watch.ts`（或对应 watch 路径）在认领 request 后 `createWorkflowRun({ flowId: request.flowId ?? coordinatorDecided, startStage: request.startStage ?? null, ... })`，把用户覆盖优先于 Coordinator 决策。
- 行为契约：用户覆盖 > Coordinator 决策 > Router 默认。

#### 4. Web UI

- `apps/web/src/main.ts` 高级覆盖 disclosure 内：
  - 加 `flowSelect`（4 选 1：`issue.standard` / `feature.standard` / `feature.fastforward` / `refactor.standard`，外加「(让 router 推荐)」空选项）。
  - 加 `startStageSelect`（仅在 `flowSelect.value === 'feature.standard'` 时 visible，selectoptions 来自 `feature.standard` 的 stages 列表）。
  - submit body：`flowSelect.value && (body.flowId = flowSelect.value)`、startStage 同理；空选项 = 不传。
  - 不动既有 typeSelect / Type 下拉、Coordinator preview 渲染。
  - Renderer idempotent：用 `element.value` 局部更新，不整段重建（参 `.trellis/spec/web/frontend/component-guidelines.md` L121 wholesale-replace focus-loss 警告）。

#### 5. 测试

- `apps/api/test/workflow-requests.test.ts`（或新文件）：
  - flowId 合法 / 非法 / 缺省（不传）三路。
  - startStage 在非 `feature.standard` flow 下被拒 400。
  - flowId + startStage 都传时正确落库。
- `apps/runner/test/`：
  - watch 在 request 含 flowId 时把它透到 `createWorkflowRun`，不被 Coordinator 决策覆盖。

## Acceptance Criteria

- [ ] `WorkflowRequest` schema + DB 加 `flow_id` / `start_stage` 列；migration idempotent。
- [ ] `POST /workflow-requests` 接受可选 `flowId` / `startStage`；非法组合 400。
- [ ] Runner watch 把 request 的 flowId / startStage 透到 `createWorkflowRun`，覆盖 Coordinator/Router 默认。
- [ ] 新建任务页高级覆盖 disclosure 含 Flow + Start Stage 下拉；startStage 仅在 `feature.standard` 时可见。
- [ ] vitest / tsc x4 / lint 全绿；无新增回归。
- [ ] 手测：从 5173 新建一个高级覆盖 = `flow=refactor.standard` 的任务，run 真的走了 refactor.standard flow（`run.flowId` 字段对得上）。

## Out of Scope

- Smart Router 的 LLM fallback / history learning（V2 §7.2 W3 独立 task）。
- Coordinator preview 接 LLM（同上）。
- 触发 mismatch detector 改造（保持现状）。
- DB 数据回填（新列 NULLABLE，不需要 backfill）。

## Technical Notes

- 对照 `73ccd26` commit 已落地内容看现状，避免重复劳动。
- `apps/web/src/main.ts` 高级覆盖 disclosure 里 typeSelect 已经在 line ~3050；新两个 select 紧跟其后即可。
- `getFlowDef(flowId).stages` 在 `packages/shared/src/flows/registry.ts:193` 周边，列出 startStage 选项时直接用。
- 参考 `flow_id` 列的写入路径前例：commit `5a61db2` / `dc155ef` 里 `WorkflowRun.flowId` 的 plumbing。

## Open Questions

（implementation 阶段进入 brainstorm 时再填——本 PRD 只是 placeholder，承载从父任务带过来的 deviation 上下文。）
