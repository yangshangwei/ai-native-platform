# Fix Workbench Action Queue Buttons

## Goal

Workbench action queue buttons should take the operator to the actionable task surface. Today the buttons in the queue appear inert for run-based items because they navigate to the workbench run view instead of the reviewer/task detail flow where confirmation and evidence actions live.

## What I Already Know

- User reported that the buttons in the workbench pending list do not respond.
- The screenshot shows the `Action Queue` panel with `查看证据` and `处理确认` buttons.
- `apps/web/src/page-workbench.ts` builds request items that navigate to `#task/<requestId>`.
- The same file builds run items that navigate to `#run/<runId>`, which parses back to the workbench page.
- Web frontend is a vanilla TypeScript DOM SPA. Event handlers should be bound as DOM listeners/properties on real elements.
- `apps/web/src/dom.ts` already renders non-submit buttons with `type="button"`.

## Requirements

- Clicking a workbench action queue item for a workflow run must navigate to the task detail page that owns confirmation/evidence actions.
- Existing request action behavior must continue to navigate to the task detail page.
- The queue should not invent new API calls or duplicate approval logic on the workbench page.
- The fix should preserve the current visual design.

## Acceptance Criteria

- [x] `处理确认` on an `awaiting_human` run navigates to `#task/<requestId>` when a matching workflow request exists.
- [x] `查看证据` on a failed run navigates to `#task/<requestId>` when a matching workflow request exists.
- [x] Request actions still navigate to `#task/<requestId>`.
- [x] A regression test covers run-based action queue navigation.
- [x] Web focused tests and typecheck pass.

## Out Of Scope

- Redesigning the workbench layout.
- Adding inline approval or evidence modals to the workbench queue.
- Changing backend workflow-run or workflow-request API contracts.

## Technical Notes

- Relevant specs:
  - `.trellis/spec/web/frontend/component-guidelines.md`
  - `.trellis/spec/web/frontend/state-management.md`
  - `.trellis/spec/web/frontend/quality-guidelines.md`
  - `.trellis/spec/web/frontend/type-safety.md`
  - `.trellis/spec/web/frontend/agent-backend-ui.md`
- The task detail spec says reviewer actions should live on the task detail page and show acknowledged states after successful clicks.
