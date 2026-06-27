# Research: Task Progress UI (7-Stage Display)

- **Query**: How does the task progress UI (7-stage progress display) work?
- **Scope**: internal
- **Date**: 2026-06-26

## Findings

### 1. Frontend Component That Renders the Stage Progress

The stage progress bar/cards are rendered by **two functions** in the task-detail page:

| File Path | Function | Description |
|---|---|---|
| `apps/web/src/page-task-detail.ts:980` | `renderLifecycle()` | Renders the active run's lifecycle stage cards (uses `projection.visibleStages`) |
| `apps/web/src/page-task-detail.ts:396` | `renderQueuedLifecycle()` | Renders the pre-run queued lifecycle (preview stages before runner claims the task) |

Both render a `<div class="stage-board">` containing `<article class="stage-card {state}">` elements, each with:
- Stage index (01, 02, ...)
- Stage label (from `STAGE_LABELS`)
- Hint text (from `stageCardHint()`)
- State label (from `stageStateLabel()`)

The top-level page layout is `renderTaskDetailPage()` at line 275, which calls `renderLifecycle` or `renderQueuedLifecycle` at line 302:
```ts
detail ? renderLifecycle(detail, projection!) : renderQueuedLifecycle(request),
```

### 2. How `runType` / `routeCase` Flows to the Frontend

**Backend (Coordinator):**
- `apps/runner/src/agents/coordinator/index.ts` — `triageRequest()` returns a `CoordinatorDecision` containing a `CoordinatorAction` with `action: 'proceed'`, `routeCase`, and `runType`.
- The decision is persisted via the API as part of the workflow request messages.

**Frontend (Loading):**
- `apps/web/src/coordinator-chat.ts:184` — `loadCoordinatorChat(requestId)` fetches `GET /workflow-requests/{requestId}/messages` which returns a `CoordinatorChatState` including the decision.
- The decision shape on the frontend (line 62-73):
  ```ts
  interface CoordinatorChatState {
    messages: CoordinatorChatMessage[];
    decision: {
      decision:
        | { action: 'proceed'; routeCase: string; runType: string; reason: string }
        | { action: 'pause_for_human'; questions: string[]; reason: string }
        | { action: 'abort'; reason: string };
      confidence: number;
      source: string;
    } | null;
    status: string;
  }
  ```

**Frontend (Display):**
- `apps/web/src/page-task-detail.ts:383` — `coordinatorVerdictText()` renders the decision:
  ```ts
  if (decision.action === 'proceed') return `${requestTypeLabel(decision.runType)} · ${decision.routeCase}`;
  ```
- This is shown in the "Hero" section under "系统分诊" (line 378).

**How `flowId` determines which stages show:**
- The `WorkflowRequest` carries optional `flowId` and `startStage` fields.
- When a run is created, `run.flowId` is set (defaults to `'feature.standard'`).
- The frontend uses `visibleStagesForRun(flowId, startStage)` to determine which stages to display.

### 3. Where Stages/Phases Are Defined (Data Model)

| File Path | Export | Description |
|---|---|---|
| `packages/shared/src/types/workflow.ts:1-18` | `WorkflowStage` type | Union of all possible stage values |
| `packages/shared/src/types/workflow.ts:26-40` | `WORKFLOW_STAGES` const | Runtime array of all stage values |
| `packages/shared/src/types/workflow.ts:60` | `WorkflowRunType` | `'feature' \| 'bugfix' \| 'smoke' \| 'refactor' \| 'ask'` |
| `packages/shared/src/types/workflow.ts:111` | `FlowId` | `'feature.standard' \| 'feature.fastforward' \| 'issue.standard' \| 'refactor.standard'` |
| `packages/shared/src/types/workflow.ts:138-160` | `StageStep` / `FlowDef` | Flow definition: ordered list of stages + metadata |
| `packages/shared/src/flows/registry.ts:192` | `FLOW_REGISTRY` | Single source of truth mapping `FlowId -> FlowDef` (ordered stage lists) |
| `apps/web/src/projection.ts:60-70` | `STAGES` const | Feature-pipeline stage ordering (legacy reference) |
| `apps/web/src/projection.ts:95-103` | `USER_VISIBLE_STAGES` | Feature lifecycle minus `context_pack` (7 stages for feature.standard) |
| `apps/web/src/projection.ts:105-119` | `STAGE_LABELS` | Chinese labels: init=任务受理, requirement=需求分析, design=方案设计, implementation=代码实现, build_test=构建测试, review=验收确认, completion=交付报告, knowledge=知识沉淀, etc. |
| `apps/web/src/projection.ts:121-135` | `STAGE_HELP` | Per-stage help text |
| `apps/web/src/projection.ts:137-143` | `STAGE_TO_GATE` | Maps stages to their gate IDs (requirement->requirement_gate, design->design_gate, etc.) |
| `apps/web/src/projection.ts:146-151` | `FLOW_LABELS` | Chinese labels per flow: feature.standard=标准功能流程, etc. |

**The "7 stages" for feature.standard (user-visible):**
1. 需求分析 (requirement)
2. 方案设计 (design)
3. 代码实现 (implementation)
4. 构建测试 (build_test)
5. 验收确认 (review)
6. 交付报告 (completion)
7. 知识沉淀 (knowledge)

(`context_pack` is filtered out by `visibleStagesForRun` — it's an internal prep stage.)

### 4. How Current Stage State Is Determined and Updated

**State computation** is in `apps/web/src/projection.ts:427` — `buildRunProjection()`:

```ts
export function buildRunProjection(detail: RunDetail): RunProjection {
  const flowId = (detail.run.flowId ?? FALLBACK_FLOW_ID) as FlowId;
  const startStage = detail.run.startStage ?? null;
  const flowStages = stagesForRun(flowId, startStage);
  const effectiveCurrentStage = effectiveStageForProjection(detail);
  const pendingGate = detail.run.status === 'awaiting_human'
    ? (STAGE_TO_GATE[effectiveCurrentStage] ?? null) : null;

  const stages = flowStages.map<StageProjection>((stage) => {
    // ... computes per-stage state
  });
}
```

**Per-stage state logic** (line 445-455):
- `'failed'` — step.status === 'failed' OR gate.status === 'fail' OR (isCurrent AND run.status === 'failed')
- `'blocked'` — pendingGate exists AND this is the current stage (awaiting human)
- `'active'` — this is the current stage AND run.status === 'running'
- `'done'` — step passed OR gate passed OR has done evidence (completion_report artifact, knowledge approved, etc.)
- `'waiting'` — default (stage not yet reached)

**`effectiveStageForProjection`** (line 484): handles edge case where `currentStage=completion` but no evidence exists (run failed before completion produced artifacts) — falls back to last transition stage or last step stage.

**Data source for the projection:**
- `detail.run.currentStage` — set by the orchestrator on the backend as it transitions stages
- `detail.run.status` — workflow run status (pending/running/awaiting_human/passed/failed/cancelled)
- `detail.steps` — StepRun records per stage
- `detail.gates` — GateRun records (quality gates per stage)
- `detail.approvals` — human approval decisions

**Polling/update mechanism:**
- `apps/web/src/polling.ts` drives periodic data refresh
- `apps/web/src/data-loading.ts` — `loadRunDetail(workflowRunId)` fetches the full `RunDetail`
- Each poll triggers `buildRunProjection()` which recomputes all stage states
- `render()` from `render-core.ts` re-renders the DOM

### Related Flow: `visibleStagesForRun` Resolution

```
FLOW_REGISTRY[flowId].stages  →  stagesForRun(flowId, startStage)  →  visibleStagesForRun (filters context_pack)
                                                                           ↓
                                                                   buildRunProjection().visibleStages
                                                                           ↓
                                                                   renderLifecycle() → stage-card DOM
```

### Coordinator Types (Shared)

| File Path | Description |
|---|---|
| `packages/shared/src/types/router.ts` | `RouteCase` type union, `CoordinatorAction` discriminated union, `CoordinatorDecision` interface |

`RouteCase` values: `'feature_clear' | 'feature_brainstorm' | 'roadmap_needed' | 'bugfix' | 'refactor_clear' | 'ask' | 'unclear'`

## Caveats / Not Found

- The `'ask'` runType and routeCase are recent additions (06-25 ask-flow). An `'ask'` request has `kind: 'ask'` on `WorkflowRequest` and never enters the runner watch loop (chat only, no workflow run created).
- There is no separate "ask" flow in `FLOW_REGISTRY` — ask requests skip the runner entirely.
- The stage display is polymorphic: `feature.standard` shows 7 stages, `feature.fastforward` shows 4, `issue.standard` shows 5, `refactor.standard` shows 5. The number shown depends entirely on the run's `flowId`.
