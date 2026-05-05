# Fix Coordinator Reply Input Reset

## Goal

Fix the Coordinator clarification reply textarea on the task detail page so operators can type and send answers even while the page continues polling for Workflow Request and Coordinator updates.

## What I already know

* The user reports that the `回复 Coordinator…` box cannot be used: typed content appears to be cleared by automatic refresh.
* The screenshot shows a Workflow Request in `awaiting_clarification` with two Coordinator questions and a visible reply textarea.
* `apps/web/src/main.ts` renders the Coordinator panel in `renderCoordinatorChatPanel`.
* `loadCoordinatorChat` polls every 1500 ms while the request is `pending` or `awaiting_clarification`, then calls `render()` when the active task matches.
* The global page polling loop also calls `loadData({ render: true, keepDetail: true })` every 3000 ms outside create/settings pages.
* `render()` clears the app root and rebuilds the DOM, so any uncontrolled textarea value/focus is lost during polling.

## Requirements

* Preserve an in-progress Coordinator reply draft across all automatic re-renders/polling refreshes.
* Keep the reply textarea usable while the request remains `awaiting_clarification`.
* Preserve focus and cursor selection when a render happens while the operator is typing, so typing is not interrupted every poll tick.
* Clear the preserved draft only after a reply is successfully sent, or when the request is no longer awaiting clarification.
* Do not add dependencies.

## Acceptance Criteria

* [ ] When a user types into `回复 Coordinator…` and `loadCoordinatorChat` or the 3-second page poll triggers `render()`, the typed text remains visible.
* [ ] If the textarea was focused before a render, it is focused again after the render without scrolling the page unexpectedly.
* [ ] Pressing `发送` submits the current draft, clears the draft after success, reloads Coordinator state, and does not leave stale text in future renders.
* [ ] Requests that are not `awaiting_clarification` do not render or retain an obsolete Coordinator reply draft.
* [ ] Project type-check and test suite pass.

## Definition of Done

* Code change is small and localized to the web Coordinator chat UI.
* No new dependencies are introduced.
* `bun run typecheck` passes.
* `bun run test` passes or any failure is documented as unrelated.

## Technical Approach

Store Coordinator reply drafts in frontend state keyed by `requestId`, update that state from textarea input and before root re-render, then repopulate the textarea when it is rebuilt. Track focus/selection for the active Coordinator textarea and restore it after render when appropriate.

## Decision (ADR-lite)

**Context**: The page intentionally polls for request/Coordinator progress. The existing UI creates an uncontrolled textarea inside a full root re-render, so polling destroys user input.

**Decision**: Keep a small request-scoped draft/focus state in `apps/web/src/main.ts` rather than changing polling cadence or disabling refreshes.

**Consequences**: The Coordinator panel remains live-updating without clobbering operator input. The fix is local and reversible. If more form state has similar issues later, this pattern can be generalized, but this task keeps scope narrow.

## Out of Scope

* Changing Coordinator backend behavior or message schemas.
* Reworking the app-wide render architecture.
* Adding a frontend framework or state-management library.
* Changing polling intervals.

## Technical Notes

* Likely impacted file: `apps/web/src/main.ts`.
* Relevant functions: `render`, `loadCoordinatorChat`, `sendCoordinatorReply`, `renderCoordinatorChatPanel`.
* Relevant specs for implementation/check context: `.trellis/spec/web/frontend/index.md`, `.trellis/spec/web/frontend/state-management.md`, `.trellis/spec/web/frontend/component-guidelines.md`, `.trellis/spec/web/frontend/quality-guidelines.md`, `.trellis/spec/web/frontend/type-safety.md`, `.trellis/spec/guides/index.md`.
