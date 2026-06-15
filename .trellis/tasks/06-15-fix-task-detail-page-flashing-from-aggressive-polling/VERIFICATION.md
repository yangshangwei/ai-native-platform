# Verification

## Automated

- `bun x --bun vitest run apps/web/test/polling.test.ts`
  - Result: passed, 4 tests.
- `bun run --filter @ainp/web typecheck`
  - Result: passed.
- `bun x --bun vitest run apps/web/test`
  - Result: passed, 8 files / 70 tests.
- `bun run typecheck`
  - Result: passed.

## Acceptance Criteria

- [x] A regression test proves heartbeat timestamp-only changes do not change the polling render fingerprint.
- [x] A regression test proves Runner running-state changes do change the polling render fingerprint.
- [x] A regression test proves run status/stage changes still require active detail reload.
- [x] `@ainp/web` typecheck passes.
- [x] Relevant web test suite passes.

## Manual QA

Not run in browser in this turn. The automated tests cover the polling decision that caused the repeated full-root renders.
