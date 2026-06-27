# Ask Flow Lightweight UI

## Problem

When coordinator routes a request as `routeCase: 'ask'` (只读探索/问答), the task detail page still displays the full 7-stage development progress board (需求分析→方案设计→代码实现→构建测试→验收确认→交付报告→知识沉淀). This confuses users — asking a question shouldn't look like a dev workflow.

## Current State (from research)

- Coordinator correctly identifies ask intent (`routeCase='ask'`, `runType='ask'`)
- `WorkflowRequest` created with `kind='ask'`, `status='awaiting_clarification'`
- Runner watch loop is supposed to skip ask requests (only polls `status='pending'`)
- However, if a run IS created (current behavior gap), frontend renders full stage-board via `buildRunProjection()` → `renderLifecycle()`
- Pre-run view renders via `renderQueuedLifecycle(request)` which also defaults to the stage-board
- No `FLOW_REGISTRY` entry exists for ask (by design — ask should never enter orchestrator)

## Design Decision

Ask requests should NOT display stage progress at all. Replace with:

1. **Lightweight activity indicator** — real-time action labels ("正在探索代码…", "正在搜索相关文件…") when the system is actively working on a code-related question
2. **No progress UI** — for general (non-code) questions, stream the answer directly
3. **No fixed phases** — ask is inherently variable; a 3-step pipeline would be as misleading as a 7-step one

## Scope

### In Scope

1. **Frontend: `page-task-detail.ts`** — detect `kind='ask'` (or `runType='ask'`) and skip `renderLifecycle()` / `renderQueuedLifecycle()`. Render a lightweight chat/streaming view instead.

2. **Frontend: `projection.ts`** — `buildRunProjection()` should handle `runType='ask'` gracefully (return empty stages or a special projection type) so that no stage-board renders even if a run somehow exists.

3. **Frontend: activity indicator component** — a small inline element that shows the current agent action (populated from SSE stream events). Only visible while the system is actively working. Disappears once the answer is delivered.

4. **Backend: ensure ask never creates a WorkflowRun** — verify the guard in `watch.ts` actually prevents run creation. If a run leaks through (as shown in the screenshot), add a defensive check.

### Out of Scope (future work)

- Ask sub-classification (`ask:code` vs `ask:general` vs `ask:ambiguous`) — the UI changes here work regardless of sub-type
- Routing confirmation grill for ambiguous intent — separate task (already in progress: `06-26-coordinator-grill-me-routing`)
- Actual ask answer generation backend — the 06-25 ask-flow only implemented routing, not the LLM Q&A response

## Implementation Plan

### Step 1: Frontend — Skip stage-board for ask

**File**: `apps/web/src/page-task-detail.ts`

In the layout decision at ~line 302:
```
detail ? renderLifecycle(detail, projection!) : renderQueuedLifecycle(request)
```

Add condition: if `request.kind === 'ask'` (or `detail?.run.type === 'ask'`), render the lightweight ask view instead of either lifecycle view.

### Step 2: Frontend — Lightweight ask view component

Create a minimal render function (in same file or extracted):
- Shows the streaming chat/answer area
- Shows an activity indicator when agent is working (from SSE events)
- No stage cards, no progress percentages

### Step 3: Frontend — projection.ts guard

In `buildRunProjection()`, if `flowId` is undefined/null and `runType === 'ask'`, return early with an empty projection (no stages). This prevents crashes if an ask run leaks through.

### Step 4: Backend — Verify ask isolation

**File**: `apps/runner/src/cmd/watch.ts`

Confirm that `processNextWorkflowRequest()` cannot pick up a `kind='ask'` request. If the current guard relies solely on `status='awaiting_clarification'`, add an explicit `kind !== 'ask'` check to `listPending()` as defense-in-depth.

## Acceptance Criteria

- [x] Submitting an ask-type request shows NO stage-board (no 7 cards)
- [x] While the system is working (if/when ask answering is implemented), an activity label is visible
- [x] Once the answer is delivered, the activity indicator disappears
- [x] Dev/fix/refactor requests continue to show their normal stage-board unchanged
- [x] No regression in existing stage-board rendering for other flow types
- [x] If a WorkflowRun somehow gets created for an ask request, the frontend does not crash or show empty stage cards

> 验收核验 2026-06-27：实现已提交于 `69ad9ac`（前端轻量 ask UI）+ `7316d81`（runner 隔离 ask 不建 run）。证据：web typecheck EXIT=0、web 测试 96 passed（含 projection.test.ts 17 项）；`isAskRouted()` 跳过 stage-board、`buildRunProjection()` 对 `run.type==='ask'` 返回空 stages、`watch.ts` `kind !== 'ask'` 过滤。验收 2/3 的实际「AI 正在回答」态依赖后续 ask 回答后端（本任务 Out of Scope）。后续加固点：补 watch.ts ask-skip 单测。

## Related Files

| File | Role |
|------|------|
| `apps/web/src/page-task-detail.ts` | Main render logic for task detail |
| `apps/web/src/projection.ts` | Stage state computation |
| `packages/shared/src/types/workflow.ts` | `WorkflowRunType`, `FlowId` types |
| `packages/shared/src/flows/registry.ts` | `FLOW_REGISTRY` |
| `apps/runner/src/cmd/watch.ts` | Runner watch loop (verify isolation) |
| `apps/api/src/workflow-engine.ts` | Request creation (kind='ask' → status mapping) |

## Research References

- [task-progress-ui.md](research/task-progress-ui.md)
- [coordinator-routing-logic.md](research/coordinator-routing-logic.md)
