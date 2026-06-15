# fix task detail page flashing from aggressive polling

## Goal

Stop the task detail page from visibly flashing during automatic polling while keeping meaningful workflow, Runner, and request status updates live.

## What I Already Know

- The user sees the task detail page repeatedly flicker and suspects automatic refresh.
- The web app has a global 3-second polling loop in `apps/web/src/main.ts`.
- `render()` clears and rebuilds the entire `#app` root, so unnecessary renders are visible even when scroll and disclosure state are restored.
- A previous fix made run detail reload conditional, but the polling fingerprint still includes `latestRunner()?.lastSeenAt`.
- Runner heartbeat timestamps can change on every poll without changing user-relevant state, which still triggers full-root renders.

## Requirements

- Automatic polling must not trigger a full root rebuild for heartbeat-only changes such as Runner `lastSeenAt`.
- The UI must still re-render for meaningful visible changes:
  - workflow request status or `updatedAt`;
  - workflow run status or current stage;
  - Runner connection/running state changes;
  - Runner control pid/start/stop state changes;
  - project count changes;
  - active detail run changes.
- The run detail reload guard must continue to avoid unnecessary `/workflow-runs/:id` reloads while still reloading on first load, active run switch, status change, or stage change.
- Keep the fix local to the web frontend polling/render policy.

## Acceptance Criteria

- [ ] A regression test proves heartbeat timestamp-only changes do not change the polling render fingerprint.
- [ ] A regression test proves Runner running-state changes do change the polling render fingerprint.
- [ ] A regression test proves run status/stage changes still require active detail reload.
- [ ] `@ainp/web` typecheck passes.
- [ ] Relevant web test suite passes.

## Definition of Done

- Tests added/updated.
- Typecheck and tests are green.
- No API or Runner protocol changes.
- User-facing behavior: stable task detail page during idle polling, with live updates when meaningful status changes.

## Technical Approach

Extract the polling render fingerprint and active-detail reload decision into pure helpers. Use those helpers from `main.ts` and cover them with Vitest. The fingerprint will intentionally exclude volatile heartbeat timestamps and include only fields that should visibly affect the UI.

## Decision (ADR-lite)

**Context**: The app uses a simple DOM renderer that rebuilds the whole app root. Polling needs to be conservative about when it calls `render()`.

**Decision**: Treat Runner heartbeat timestamps as diagnostic data, not a global render trigger. Keep status/running/pid fields in the fingerprint so operational changes still refresh the UI.

**Consequences**: The collapsed Runner diagnostics heartbeat timestamp may not update every 3 seconds while no other visible state changes. That is an acceptable trade-off because avoiding task-detail flicker matters more than live ticking diagnostic timestamps.

## Out of Scope

- Replacing polling with WebSocket/SSE for all app data.
- Changing backend polling intervals or Runner heartbeat behavior.
- Redesigning the task detail layout.

## Technical Notes

- Relevant spec: `.trellis/spec/web/frontend/state-management.md`.
- Relevant spec: `.trellis/spec/web/frontend/agent-backend-ui.md`.
- Existing related task: `.trellis/tasks/06-15-fix-workbench-page-flashing-due-to-aggressive-polling/`.
