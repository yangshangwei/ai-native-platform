# Optimize task detail page for nontechnical review

## Goal

Redesign the workflow request detail page so nontechnical reviewers can quickly understand what needs attention, what has been produced, and what action to take next. Engineering diagnostics must remain available but should not compete with the primary review flow.

## What I already know

* The current detail page exposes project/run ids, branches, workspace paths, Runner state, gate ids, command counts, artifacts, and audit data at the same visual priority as user-facing review content.
* The screenshot shows an `awaiting_human` request paused at `requirement_gate`; the most important user task is reviewing the requirement output and approving or rejecting it.
* Existing code lives primarily in `apps/web/src/main.ts`; styles are in `apps/web/index.html`.
* Current renderers already separate major regions: `renderTaskHero`, `renderLifecycle`, `renderCurrentStagePanel`, `renderTaskNextActionPanel`, `renderRunnerControlPanel`, `renderEvidencePanel`, and `renderStageBackendDetails`.
* Existing adjacent page style uses compact panels, metric cards, stage cards, status pills, and collapsed `<details>` for diagnostics.

## Assumptions

* This task should change presentation and information hierarchy only; no API or workflow semantics should change.
* Nontechnical reviewers primarily need title, status, current phase, what to review, and the approve/reject action.
* Technical details are still useful for troubleshooting and should stay reachable through collapsed sections.

## Open Questions

* None blocking for MVP. The implementation should choose conservative wording and keep existing diagnostic access.

## Requirements

* Make the top hero read as a task summary, not a run/debug summary.
* Reduce visible technical labels in the default view: hide raw gate ids, run ids, workspace paths, command counts, source branches, and Runner process details behind details panels where practical.
* Rename action copy from raw gate language (`Approve requirement_gate`, `Reject`) to user-facing Chinese labels such as approving requirements or sending back for changes.
* Make the current human checkpoint stand out as the primary right-side action.
* Keep lifecycle and current-stage content visible because they explain progress and review evidence.
* Move Runner, evidence, stage backend details, and environment/debug data lower or behind collapsed diagnostic sections.
* Preserve existing behavior: approval submissions, rejection reason modal, polling disclosure-state preservation, stream rendering, and artifact drill-downs.
* Keep the design consistent with existing reports/projects/knowledge page card and details patterns.

## Acceptance Criteria

* [x] An `awaiting_human` detail page shows a plain-language current action without exposing `requirement_gate` in the primary header or buttons.
* [x] The hero emphasizes task title, current phase, reviewer status, and high-level progress rather than IDs and environment paths.
* [x] Runner control and evidence drill-down remain accessible but are collapsed or secondary by default.
* [x] Existing technical drill-downs still expose gate runs, command runs, artifacts, agent audit, and stage backend details when expanded.
* [x] Layout remains responsive at desktop and mobile widths without text overlap.
* [x] `bun run --filter @ainp/web typecheck` passes.

## Definition of Done

* Web UI code and CSS updated with a small, reviewable diff.
* Existing user actions continue to call the same approval/rejection APIs.
* Disclosure panels have stable `data-details-key` values where they are user-owned UI state.
* A local visual check is performed after implementation.

## Out of Scope

* Changing backend APIs, workflow state machines, or gate semantics.
* Replacing the current DOM rendering architecture with a framework.
* Adding a new dependency or icon library.
* Redesigning unrelated pages.

## Technical Notes

* Relevant spec: `.trellis/spec/web/frontend/state-management.md` requires preserving disclosure state for `<details>` panels during polling renders.
* Relevant spec: `.trellis/spec/web/frontend/agent-backend-ui.md` requires backend/stream diagnostics to remain accurate and backend-specific.
* Existing docs describe `renderTaskNextActionPanel` as the core checkpoint entry, and `renderStageBackendDetails` as troubleshooting-oriented.
* Likely implementation files: `apps/web/src/main.ts`, `apps/web/index.html`.
