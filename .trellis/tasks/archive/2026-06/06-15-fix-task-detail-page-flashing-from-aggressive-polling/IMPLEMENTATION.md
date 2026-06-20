# Implementation Summary

## Root Cause

The task detail page was still flashing because the global 3-second polling fingerprint included Runner heartbeat time (`lastSeenAt`). Heartbeat timestamps can change on every poll even when no user-relevant state changed. Since `render()` clears and rebuilds the full `#app` root, that heartbeat-only fingerprint change still caused visible page flicker.

## Changes

- Added `apps/web/src/polling.ts` with pure polling policy helpers:
  - `buildPollingRenderFingerprint`
  - `shouldReloadActiveRunDetail`
- Updated `apps/web/src/main.ts` to:
  - initialize `lastDataFingerprint` from the already-rendered initial state;
  - ignore heartbeat timestamp-only changes for render decisions;
  - refresh active run detail before rendering when status/stage changes, so the page paints once with fresh detail.
- Added `apps/web/test/polling.test.ts` regression tests for heartbeat-only changes, Runner running-state changes, and active-detail reload decisions.

## Behavior

- Idle Runner heartbeat updates no longer trigger a full root rebuild.
- Runner running/pid/start/stop changes still refresh the UI.
- Workflow request status and workflow run status/stage changes still refresh the UI.
- Active run detail still reloads on first load, task switch, run status change, or stage change.

## Verification

- `bun x --bun vitest run apps/web/test/polling.test.ts` -> 4 tests passed.
- `bun run --filter @ainp/web typecheck` -> passed.
- `bun x --bun vitest run apps/web/test` -> 70 tests passed.
- `bun run typecheck` -> passed.

## Remaining Risk

- The collapsed Runner diagnostics heartbeat timestamp will no longer tick every 3 seconds when it is the only changed field. This is intentional: heartbeat time is diagnostic, while task detail stability is primary.
