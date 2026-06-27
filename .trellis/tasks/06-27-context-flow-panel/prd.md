# Context Flow Panel

## Goal

Add a "Context Flow" panel to the task detail page that visualizes how context
and artifacts flow between stages in a workflow run. After P4, the panel should
show P1-P4 evidence together: context packs, stage checkpoints, input injection
decisions, stage handoffs, and context_request retry chains.

## What I already know

* The API's `GET /workflow-runs/:id` already returns full `agentTasks` (with `inputArtifactIds`) and `agentResults` (with `outputArtifactIds`) plus all `artifacts` for the run
* The web DTO types (`AgentTaskDto`, `AgentResultDto`) currently exclude `inputArtifactIds` / `outputArtifactIds` — they need to be expanded
* `RunDetail` already carries `steps`, `artifacts`, `agentTasks`, `agentResults` — all the data needed to build the flow graph
* Artifacts have `kind` (requirement_draft, design_doc, diff, context_pack, project_profile, other), `stepRunId`, `metadata` with stage info
* P1-P3 added context pack artifacts, stage context checkpoints, and input injection audit lines
* P4 is expected to add `requirement -> design` stage handoff evidence before this panel is implemented
* The task detail page already renders per-stage panels; this would be an additional disclosure/tab

## Assumptions (temporary)

* A simple stage-by-stage vertical flow (not a full DAG) is sufficient for MVP — stages run sequentially
* Artifact content preview (already handled by existing artifact viewers) can be linked from the flow nodes

## Open Questions

* (none blocking — approach is clear from existing patterns)

## Requirements (evolving)

1. Expand `AgentTaskDto` to include `inputArtifactIds: string[]`
2. Expand `AgentResultDto` to include `outputArtifactIds: string[]`
3. Build a `ContextFlowProjection` that maps each stage to its inputs/outputs by joining steps → agentTasks → agentResults → artifacts
4. Render a collapsible "Context Flow" panel in the task detail page showing:
   - Each completed stage as a row/node
   - Input artifacts listed (with kind badge + short name)
   - Output artifacts listed (with kind badge + short name)
   - Visual arrows/connectors showing artifact reuse across stages
5. Include P1-P4 context evidence when available:
   - base/supplement context pack artifacts
   - stage start/finish checkpoint snapshots
   - input injection mode/audit summary
   - stage handoff edges such as `requirement -> design`
   - context_request base -> request -> supplement -> retry chain
6. Clicking an artifact in the flow opens the existing artifact viewer (reuse `ensureArtifactContent` + `openArtifactViewers` state)

## Acceptance Criteria (evolving)

* [ ] `AgentTaskDto` includes `inputArtifactIds`; `AgentResultDto` includes `outputArtifactIds`
* [ ] Context Flow panel renders for any completed or in-progress run with at least one finished stage
* [ ] Each stage shows its input artifacts (name + kind badge) and output artifacts
* [ ] Artifacts that appear as both output of stage N and input of stage N+1 are visually connected
* [ ] Stage handoff records are shown as explicit edges when the backend exposes them
* [ ] context_request retry chains are visible when present
* [ ] Input injection decisions are visible at summary level
* [ ] Clicking an artifact name opens the existing artifact content viewer
* [ ] Panel is collapsible (default collapsed to avoid noise for users who don't need it)
* [ ] Prefer existing RunDetail/context governance data; add no endpoint unless P4 evidence cannot be represented cleanly

## Definition of Done

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes

## Technical Approach

**Data flow:**
- Wire already carries full `AgentTask.inputArtifactIds` and `AgentResult.outputArtifactIds`
- Expand web DTO Pick types to include them
- Build projection: for each step, find its agentTask(s), join to agentResult(s), resolve artifact metadata from the `artifacts` array
- Also consume context governance data for context packs, context requests, and stage handoffs once P4 exposes them

**Rendering:**
- New function `renderContextFlowPanel(detail: RunDetail)` in `page-task-detail.ts` (or a dedicated `context-flow.ts` module if it exceeds ~150 lines)
- Vertical stage list, each stage as a card with "Inputs" and "Outputs" sections
- Artifacts shown as pills/chips with kind-colored badges
- Connector lines (CSS border-left or SVG) linking output→input across stages
- Reuse existing `ensureArtifactContent` for on-click expansion

## Out of Scope

* Full token budget visualization (contextPack manifest detail) — future enhancement
* Full interactive DAG layout (e.g. d3-dag) — overkill for sequential flows
* Implementing P4 backend handoff generation

## Technical Notes

* Key files: `apps/web/src/page-task-detail.ts`, `apps/web/src/projection.ts`, `apps/web/src/types.ts`
* `ArtifactDto.metadata` may contain `{ output: string, stage: string }` which can label artifacts
* The existing `isReadableFileArtifact()` helper determines if content can be fetched for preview
* The store layer (`apps/api/src/store/store.ts:1187,1233`) already serializes/deserializes the artifact ID arrays from JSON columns
