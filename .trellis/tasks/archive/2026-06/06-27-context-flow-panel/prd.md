# Context Flow Panel

## Goal

Add a "Context Flow" panel to the task detail page that visualizes how context
and artifacts flow between stages in a workflow run. After P4, the panel should
show P1-P4 evidence together: context packs, stage checkpoints, input injection
decisions, stage handoffs, and context_request retry chains.

## What I already know

* The API's `GET /workflow-runs/:id` already returns full `agentTasks` (with `inputArtifactIds`) and `agentResults` (with `outputArtifactIds`) plus all `artifacts` for the run
* The API's `GET /workflow-runs/:id` also returns `handoffs`, but the web `RunDetail` type currently omits that field
* The API's `GET /workflow-runs/:id/context` read model already includes `stageHandoffs`, but the web `ContextGovernanceDto` currently omits that field
* The web DTO types (`AgentTaskDto`, `AgentResultDto`) currently exclude `inputArtifactIds` / `outputArtifactIds` — they need to be expanded
* `RunDetail` already carries `steps`, `artifacts`, `agentTasks`, `agentResults` — all the data needed to build the flow graph
* Artifacts have `kind` (requirement_draft, design_doc, diff, context_pack, project_profile, other), `stepRunId`, `metadata` with stage info
* P1-P3 added context pack artifacts, stage context checkpoints, and input injection audit lines
* P4 has landed `requirement -> design` stage handoff evidence and context governance summaries
* The task detail page already renders current-stage, context governance, stage backend detail, and technical evidence panels; Context Flow should sit beside these as a collapsed reviewer aid, not replace them
* Existing frontend conventions require DTOs derived from `@ainp/shared`, pure derived state in `projection.ts`, stable `data-details-key` values for polling-safe disclosures, and user-facing Chinese labels in primary task detail UI

## Assumptions (temporary)

* A simple stage-by-stage vertical flow (not a full DAG) is sufficient for MVP because current flows are ordered stage pipelines
* Artifact content preview (already handled by existing artifact viewers) can be linked from the flow nodes
* The MVP can derive a useful flow without adding a backend endpoint by combining `RunDetail` and context governance data already fetched by the task detail page
* Graph runtime branch/join visualization is future work; this panel should not pre-design a general graph layout

## Open Questions

* (none blocking - approach is clear from existing patterns)

## Requirements

1. Expand `AgentTaskDto` to include `inputArtifactIds: string[]`
2. Expand `AgentResultDto` to include `outputArtifactIds: string[]`
3. Add missing web DTO coverage for run-level `handoffs` and context governance `stageHandoffs`
4. Build a pure `ContextFlowProjection` in `projection.ts` that maps each visible stage to:
   - stage status from the existing run projection
   - input artifacts from `AgentTask.inputArtifactIds`
   - output artifacts from `AgentResult.outputArtifactIds`
   - context pack artifacts and checkpoint context references
   - context request base/request/supplement artifact references
   - stage handoff records such as `requirement -> design`
5. Render a collapsed "Context Flow" panel in the task detail page showing:
   - each stage as a compact row with user-facing stage label and status
   - inputs and outputs as artifact chips with kind badge, short id, and readable label when metadata allows
   - explicit relation rows for reused artifacts, context requests, and stage handoffs
   - empty states that distinguish "no evidence yet" from "context governance still loading"
6. Reuse existing artifact viewer behavior for artifact chips when the artifact is readable:
   - `toggleArtifactViewer`
   - `ensureArtifactContent`
   - `openArtifactViewers`
   - stable `artifactViewerScrollKey`
7. Keep raw ids, full paths, hashes, and verbose diagnostics inside collapsed areas unless the id is the only useful artifact label
8. Add focused regression coverage for the pure projection and enough DOM/render coverage or manual smoke notes to protect the task detail integration

## Acceptance Criteria (evolving)

* [x] `AgentTaskDto` includes `inputArtifactIds`; `AgentResultDto` includes `outputArtifactIds` — derived via `Pick` from `@ainp/shared` `AgentTask`/`AgentResult` (`projection.ts:337-349`)
* [x] `RunDetail` and `ContextGovernanceDto` include the currently returned `handoffs` / `stageHandoffs` evidence without weakening shared contracts unnecessarily — `HandoffRecordDto` (`projection.ts:358`), `stageHandoffs` (`types.ts:230`)
* [x] A pure context flow projection joins steps, agent tasks, agent results, artifacts, checkpoints, context requests, and stage handoffs without mutating app state — `buildContextFlowProjection` (`projection.ts:543`), covered by 19 unit tests
* [x] Context Flow panel renders for any completed or in-progress run with at least one finished stage — `renderContextFlowPanel`, covered by render test
* [x] Each stage shows its input artifacts (name + kind badge) and output artifacts
* [x] Artifacts that appear as both output of one stage and input of a later stage are shown as reuse relations — `artifact_reuse` relation, asserted in render test
* [x] Stage handoff records are shown as explicit relation rows when available — `stage_handoff` relation, asserted in render test
* [x] context_request base -> request -> supplement chains are visible when present — `context_request` relation, asserted in render test
* [x] Input injection decisions are visible at summary level — context pack `mode`/`role` and handoff `injectionPreference` surfaced per stage
* [x] Clicking an artifact name opens the existing artifact content viewer — `toggleArtifactViewer` wired on readable artifact chips
* [x] Panel is collapsible by default and has a stable `data-details-key` so polling renders preserve disclosure state — `data-details-key="context-flow:<runId>"`, asserted in render test
* [x] No new endpoint is added unless implementation proves existing `RunDetail` plus context governance data cannot represent the flow cleanly — frontend-only, no backend read path added
* [x] `bun test apps/web/test/projection.test.ts` or equivalent targeted tests pass — `projection.test.ts` (19) + `context-flow-panel.test.ts` (5) green
* [x] `bun run typecheck --filter @ainp/web` or the repo-equivalent web typecheck passes — `tsc -p apps/web/tsconfig.json --noEmit` exit 0

## Definition of Done

* [x] Tests added/updated (unit/integration where appropriate) — `projection.test.ts` (pure projection, 19) + new `context-flow-panel.test.ts` (DOM/render via happy-dom, 5)
* [x] Lint / typecheck / CI green — repo has no configured linter; `bun run typecheck` exit 0, `bun run test` 97 files / 870 tests green
* [x] Docs/notes updated if behavior changes — frontend contract recorded in `.trellis/spec/web/frontend/agent-backend-ui.md` (commit 5563209)
* [x] Manual task detail smoke captures at least one run with context packs and one run with stage handoff/context request evidence, if fixture data is available — satisfied by automated render coverage (the PRD-allowed "DOM/render coverage OR manual smoke" alternative): render test exercises both the stage-flow run and the governance run (context packs + stage handoff + context request)

## Technical Approach

### Architecture

Keep the feature split into three layers:

1. **DTO wiring**
   - Expand existing derived DTOs in `apps/web/src/projection.ts`.
   - Add a derived `HandoffRecord` DTO for `RunDetail.handoffs` if the renderer needs run-level handoff fields beyond `ContextGovernanceDto.stageHandoffs`.
   - Extend `ContextGovernanceDto` in `apps/web/src/types.ts` to match `apps/api/src/context-governance.ts`, including `stageHandoffs`, richer `contextPacks`, and `baseContextPackArtifactId`.

2. **Pure projection**
   - Add `buildContextFlowProjection(detail, contextGovernance)` in `apps/web/src/projection.ts`.
   - Inputs are `RunDetail` and `ContextGovernanceDto | null`; output is a serializable view model.
   - Use `visibleStagesForRun` / `STAGE_LABELS` for stage ordering and labels.
   - Resolve artifacts through an `artifactById` map, then produce stable arrays:
     - `stages[]`
     - `artifactRefs[]`
     - `relations[]`
     - `warnings[]`
   - Do not cache the projection in global state; it is derived state and cheap to recompute.

3. **Task detail rendering**
   - Add `renderContextFlowPanel(detail)` near `renderContextGovernancePanel`.
   - Read `contextGovernanceByRun.get(detail.run.id) ?? null` inside the renderer and pass it to the projection.
   - Render collapsed by default with `data-details-key="context-flow:<runId>"`.
   - Reuse `renderArtifactInlineViewer`, `toggleArtifactViewer`, and existing artifact readability checks.
   - Prefer restrained diagnostic styling that matches `context-governance` and `evidence` panels.

### Projection model sketch

```ts
interface ContextFlowProjection {
  stages: ContextFlowStage[];
  relations: ContextFlowRelation[];
  warnings: string[];
}

interface ContextFlowStage {
  id: Stage;
  label: string;
  state: StageProjection['state'];
  inputs: ContextFlowArtifactRef[];
  outputs: ContextFlowArtifactRef[];
  checkpoints: ContextFlowCheckpointRef[];
  contextPacks: ContextFlowContextPackRef[];
}

type ContextFlowRelation =
  | { kind: 'artifact_reuse'; artifactId: string; fromStage: Stage | null; toStage: Stage | null }
  | { kind: 'stage_handoff'; handoffId: string; fromStage: string; toStage: string; artifactId: string | null }
  | { kind: 'context_request'; requestId: string; baseArtifactId: string | null; requestArtifactId: string | null; supplementArtifactId: string | null };
```

### UI placement

Place the panel after `renderContextGovernancePanel(detail)` in the main task detail body. The governance panel answers "what context was selected"; Context Flow answers "how that context and artifacts moved between stages".

### Decision (ADR-lite)

**Context:** The API already exposes most evidence needed for this view through run detail and context governance endpoints. The web app already has a projection layer and polling-safe disclosure conventions.

**Decision:** Implement Context Flow as a frontend projection and collapsed task detail panel. Do not add a new backend endpoint in the MVP.

**Consequences:** This keeps the diff narrow and testable, but the first version is a sequential stage timeline rather than a general DAG. A future graph-runtime view can reuse the projection concepts but should not be forced into this panel.

## Implementation Plan

1. **DTO and fixture alignment**
   - Add `inputArtifactIds` to `AgentTaskDto`
   - Add `outputArtifactIds` to `AgentResultDto`
   - Add `handoffs` to `RunDetail` if needed for renderer/projection tests
   - Add `stageHandoffs` and missing context pack/request fields to `ContextGovernanceDto`
   - Update existing web test fixtures to satisfy stricter DTOs

2. **Pure context flow projection**
   - Add projection types and `buildContextFlowProjection`
   - Cover stage ordering, artifact input/output joins, artifact reuse relations, stage handoff relations, and context request relations in `apps/web/test/projection.test.ts`
   - Include defensive behavior for missing artifact ids and legacy rows

3. **Task detail panel**
   - Add `renderContextFlowPanel`
   - Insert it after `renderContextGovernancePanel(detail)`
   - Reuse artifact viewer helpers and stable disclosure keys
   - Keep primary labels Chinese and raw diagnostics collapsed

4. **Styling and responsive polish**
   - Add minimal CSS for compact stage rows, artifact chips, and relation rows using existing panel/evidence classes first
   - Ensure mobile does not widen the document; long ids wrap inside chips or live in collapsed details

5. **Verification**
   - Run targeted projection tests
   - Run web typecheck
   - Run relevant web test suite if targeted tests/typecheck reveal broad fixture changes
   - Manually smoke a task detail page with context governance available

## Out of Scope

* Full token budget visualization (contextPack manifest detail) — future enhancement
* Full interactive DAG layout (e.g. d3-dag) — overkill for sequential flows
* Implementing P4 backend handoff generation
* Graph runtime branch/join visualization
* Adding a new backend endpoint for this panel unless existing data is proven insufficient

## Technical Notes

* Key files: `apps/web/src/page-task-detail.ts`, `apps/web/src/projection.ts`, `apps/web/src/types.ts`
* `ArtifactDto.metadata` may contain `{ output: string, stage: string }` which can label artifacts
* The existing `isReadableFileArtifact()` helper determines if content can be fetched for preview
* The store layer (`apps/api/src/store/store.ts:1187,1233`) already serializes/deserializes the artifact ID arrays from JSON columns
* API route `apps/api/src/routes/workflow-runs.ts` returns `handoffs`, `agentTasks`, `agentResults`, `stepCheckpoints`, and `audit` in run detail
* Context governance source `apps/api/src/context-governance.ts` includes `stageHandoffs`, `contextRequests`, `contextPacks`, and metrics
* Relevant frontend specs:
  - `.trellis/spec/web/frontend/agent-backend-ui.md`
  - `.trellis/spec/web/frontend/state-management.md`
  - `.trellis/spec/web/frontend/type-safety.md`
