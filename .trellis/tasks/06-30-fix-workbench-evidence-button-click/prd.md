# fix workbench evidence button click

## Goal

Make the Workbench `查看证据` action visibly open evidence for a failed workflow run. The button currently routes to the run hash fallback when no matching workflow request is found, but the Workbench page does not render the active run detail, so the click appears inert.

## What I Already Know

- The reported UI is the Workbench Action Queue failed-run card.
- `apps/web/src/page-workbench.ts` builds run-based action items for `awaiting_human` and `failed` workflow runs.
- `setHash('workbench', run.id)` writes `#run/<id>`, and `parseHash()` maps that to `ui.activePage = 'workbench'` plus `ui.activeRunId`.
- `main.ts` and `data-loading.ts` load run detail for `ui.activeRunId`.
- The Workbench page currently does not render `data.activeDetail`, so a valid `#run/<id>` fallback has no visible evidence surface on Workbench.
- The Task Detail page already has `renderEvidencePanel(detail)` for evidence summaries and diagnostics.

## Requirements

- Failed run cards with matching workflow requests should keep opening task detail.
- Failed run cards without matching workflow requests should still make evidence visible after click.
- Preserve existing `#run/<id>` semantics used for active run stream subscriptions.
- Keep changes narrow to the web frontend.

## Acceptance Criteria

- [x] Clicking `查看证据` for a failed run without a matching request sets the hash to `#run/<id>`.
- [x] When Workbench has an active loaded run detail, it renders a visible evidence summary for that run.
- [x] Existing request-backed action queue navigation to `#task/<requestId>` still works.
- [x] Web Workbench tests pass.

## Out of Scope

- Changing API workflow request listing.
- Reworking global route semantics.
- Adding new evidence APIs.
- Redesigning the Workbench layout beyond adding the missing active-run evidence surface.

## Technical Notes

- Relevant frontend specs:
  - `.trellis/spec/web/frontend/agent-backend-ui.md`
  - `.trellis/spec/web/frontend/state-management.md`
- Existing evidence renderer:
  - `apps/web/src/page-task-detail.ts::renderEvidencePanel`
