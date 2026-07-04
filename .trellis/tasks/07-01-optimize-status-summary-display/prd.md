# Optimize Status Summary Display

## Goal

Improve the top-right global status summary in the Web app so pending work, running work, and overall health are easier to scan and less button-like.

## What I Already Know

* The screenshot shows three large colored pills: `5 待处理`, `4 运行中`, and `正常`.
* These are rendered by `renderTopbar()` in `apps/web/src/shell.ts`.
* The current global counts are:
  * pending = awaiting clarification + awaiting human + failed requests.
  * running = running workflow runs + claimed workflow requests.
  * health = `workbenchEnvironmentSummary(project, runner)`.
* Current topbar status styling is inline in `apps/web/index.html`.
* Existing shell rendering tests live in `apps/web/test/shell-rendering.test.ts`.

## Assumptions

* This is a visual/UX optimization only; no API or data-model change is needed.
* The status summary should remain visible in the topbar for pages that currently show the topbar.
* The summary should not look like a primary action unless it becomes clickable in a future task.

## Requirements

* Replace the current three separate large status pills with a more compact status summary surface.
* Preserve the three meanings:
  * `待处理`: work needing attention.
  * `运行中`: active execution.
  * health/readiness: current execution environment status.
* Make the numbers visually primary and the labels secondary enough to support quick scanning.
* Keep semantic color cues, but reduce the heavy colored-box appearance.
* Ensure the layout does not overflow or overlap on narrow screens.
* Add or update shell rendering coverage for the new DOM structure and labels.

## Acceptance Criteria

* [ ] The top-right summary still displays pending count, running count, and health/readiness text.
* [ ] When pending or running counts are zero, the summary remains visually coherent and does not show misleading empty badges.
* [ ] The status group reads as a dashboard summary, not as three clickable buttons.
* [ ] Mobile/narrow layout wraps or stacks without text clipping.
* [ ] Relevant Web shell tests pass.
* [ ] Typecheck for the Web package passes after the change.

## Definition of Done

* Tests added or updated where practical.
* Web typecheck passes.
* Visual smoke check performed in browser or screenshot.
* No new dependencies.

## Technical Approach

Recommended approach: render one `global-status-panel` containing three compact `global-status-item` entries. Each item uses a small status dot/indicator, a numeric or text value, and a short label. This keeps the same data model while making the group visually lighter and clearer.

## Decision (ADR-lite)

**Context**: The current UI uses large colored pills with count circles, which makes passive status indicators look like clickable action chips.

**Decision**: Prefer a single grouped summary panel with compact metrics over separate large pills.

**Consequences**: The visual hierarchy becomes quieter and easier to scan. Future click-through behavior can be added to the whole group or individual items later, but this task will keep it display-only.

## Out of Scope

* Changing how pending/running/health values are calculated.
* Adding new backend fields or API endpoints.
* Making the status indicators clickable.
* Redesigning the entire topbar or sidebar.

## Technical Notes

* Relevant files:
  * `apps/web/src/shell.ts`
  * `apps/web/index.html`
  * `apps/web/test/shell-rendering.test.ts`
* Relevant spec:
  * `.trellis/spec/web/frontend/agent-backend-ui.md`
