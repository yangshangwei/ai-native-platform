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

### Auto-context 校核（2026-05-08 brainstorm 阶段实测）

更精细的实情，比初稿设想轻一截 —— **下游 `/workflow-runs` 路径已全打通，只需补 request 一侧**：

- `POST /workflow-runs`（`apps/api/src/routes/workflow-runs.ts:67-128`）**已经接受 `flowId` + `startStage`** + isFlowId / isWorkflowStage 校验 + 400 错误（V2 W2-4/PR4 落地）。 **不需改。**
- 引擎层 `createWorkflowRun`（`apps/api/src/workflow-engine.ts`）已支持 startStage / flowId 透传到 `workflow_runs` 行。 **不需改。**
- `apps/runner/src/api-client.ts:55-63 createWorkflowRun`：接受 `flowId?: FlowId`，但**没有** `startStage`。 **需补 `startStage?: WorkflowStage | null`。**
- `apps/runner/src/orchestrator.ts:114-120 cmdOrchestrate`：把 `opts.flowId` 透传给 `api.createWorkflowRun`，但**没有** `opts.startStage`。 **需补。**
- `apps/runner/src/cmd/watch.ts:148-158 cmdWatch`：调 `cmdOrchestrate({ project, title, sourceBranch, workflowRequestId, runType, ... })` —— **完全不读 `request.flowId / request.startStage`**。 **需补。**
- `WorkflowRequest` 接口（`packages/shared/src/types/workflow.ts:180-193`）：12 个字段，**没有** `flowId / startStage`。 **需补。**
- `workflow_requests` DB 表（`apps/api/src/store/db.ts:53-66`）：12 列，**没有** `flow_id / start_stage` 列。 **需补 idempotent ALTER TABLE。**
- `POST /workflow-requests`（`apps/api/src/routes/workflow-requests.ts:46-95`）：body 解析 projectId / projectName / title / type / branch / firstMessage，**不接受** `flowId / startStage`。 **需补 + 校验。**
- `apps/web/src/main.ts` 新建任务表单：高级覆盖里仅有 typeSelect。 **需加 `flowSelect` + `startStageSelect`（仅 feature.standard 时可见）。**

### FLOW_REGISTRY 各 flow 的 stages（决定 startStage 选项）

- `feature.standard`：8 stages（context_pack → requirement → design → implementation → build_test → review → completion → knowledge）
- `feature.fastforward`：4 stages（implementation → build_test → review → completion）
- `issue.standard`：6 stages（PRD 见参考）
- `refactor.standard`：（待查；看测试 fixture）

`FlowDef.startStage` 文档明确："Currently only `feature.standard` carries non-null values; other flows are short and run head-to-tail." → **startStage select 只在 `flowSelect.value === 'feature.standard'` 时显示** 是符合既有设计意图的。

### 待做（本任务范围 —— 收窄后的实际清单）

1. **shared types**：`WorkflowRequest` 加 `flowId?: FlowId | null` + `startStage?: WorkflowStage | null`。
2. **DB**：`workflow_requests` idempotent ALTER TABLE 加 `flow_id TEXT NULL` + `start_stage TEXT NULL`（参考 `workflow_runs.flow_id` 的迁移模式：`apps/api/src/store/db.ts` 现有的 idempotent ALTER 块）。
3. **api/routes/workflow-requests.ts** POST：解析 + 校验 `body.flowId / body.startStage`（重用 `isFlowId / isWorkflowStage` from `routes/workflow-runs.ts`）；落到 `WorkflowRequest` row。
4. **runner watch**（`apps/runner/src/cmd/watch.ts:148-158`）：把 `request.flowId / request.startStage` 透到 `cmdOrchestrate({ ..., flowId, startStage })`。
5. **runner cmdOrchestrate**（`apps/runner/src/orchestrator.ts:114-120`）：扩 `opts.startStage`，透传给 `api.createWorkflowRun`。
6. **runner api-client createWorkflowRun**（`apps/runner/src/api-client.ts:55`）：扩 `startStage?: WorkflowStage | null` 字段。
7. **web UI**（`apps/web/src/main.ts`）：高级覆盖加 `flowSelect`（4 选 1 + 「(让 router 推荐)」空选项） + `startStageSelect`（仅 `feature.standard` 时可见，options 来自 `FLOW_REGISTRY['feature.standard'].stages`）；submit body 透传非空字段；flowSelect 切换非 feature.standard 时自动清 startStageSelect。
8. **Tests**：`apps/api/test/workflow-requests*.test.ts` 加 4 路测试（合法 / flowId 非法 / startStage on non-feature 拒绝 / 都传 happy）；`apps/runner/test/watch*.test.ts` 加 1 路（request.flowId 透传到 cmdOrchestrate）。


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

## Decisions (locked 2026-05-08)

- **Q1（Coordinator interaction when user overrides flowId）= A**：`request.flowId` 非空 → `runType = FLOW_REGISTRY[flowId].kind`，**完全跳过 Coordinator + Router**；audit 中 `routerRecommendation` 写 `null`；mismatch detector 不触发（没东西可对比）。
  - **Why**：用户显式覆盖 = source of truth，再花 LLM 调用复核浪费且引入歧义。
  - **How**：runner watch 在 claim 之后判 `request.flowId` 是否非空——非空走 fast-path（derive runType + skip Coordinator）；为空保持现有 Coordinator → Router 链路。
- **Q2（验证严格性）= 400 hard error**（与 `/workflow-runs` POST 现行做法一致）：不合法 flowId / startStage 在 `/workflow-requests` POST 阶段就返回 400，不让脏数据落 DB。
- **Q3（UI 切换 flowSelect 时 startStage 行为）= 自动清空**：`flowSelect.value` 切到非 `feature.standard` → `startStageSelect` 隐藏 + `startStageSelect.value = ''`，避免 stale 选项偷渡到 submit body。
- **Q4（user-override 审计事件）= 不发新 event**（MVP）：现有 audit_log 已记录 `request.flowId` / `request.startStage` 字段，足够回溯；引入新 event 类型属 over-engineering，留待 history-based learning 任务再做。

