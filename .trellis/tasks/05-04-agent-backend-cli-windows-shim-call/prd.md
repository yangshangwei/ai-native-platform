# Agent backend CLI Windows shim call

## Goal

Make Windows `.cmd` / `.bat` shim invocation more robust when the shim path contains spaces by routing the shim through `cmd.exe /c call` while preserving `shell: false` and separate spawn argv tokens.

## What I already know

- Target implementation: `packages/shared/src/utils/agent-backend-cli.ts`.
- Target tests: `packages/shared/test/agent-backend-cli.test.ts`.
- Current shim wrapping uses `cmd.exe` argv `['/d', '/s', '/c', shim, ...args]`.
- Required behavior is `['/d', '/s', '/c', 'call', shim, ...args]` for both `.cmd` and `.bat` shims.
- Do not concatenate a shell command string; keep `shell: false`.
- Scope must stay limited to this behavior and tests; do not commit.

## Requirements

- Add `call` as its own argv token before the shim path for Windows `.cmd` / `.bat` shim spawn wrappers.
- Preserve spaced shim paths and spaced command arguments as independent argv tokens.
- Update `.cmd` and `.bat` unit expectations to cover the `call` token.
- Avoid changing non-Windows, `.exe`, candidate resolution, or broader backend behavior.

## Acceptance Criteria

- [ ] `.cmd` spawn wrappers return `args: ['/d', '/s', '/c', 'call', shim, ...args]`.
- [ ] `.bat` spawn wrappers return `args: ['/d', '/s', '/c', 'call', shim, ...args]`.
- [ ] Spaced shim paths remain a single argv element after `call`.
- [ ] `shell` remains `false`.
- [ ] `bun x --bun vitest run packages/shared/test/agent-backend-cli.test.ts` passes.

## Out of Scope

- No commit.
- No dependency changes.
- No changes outside the shared utility and its focused test unless required by verification.

## Technical Notes

- Relevant contract: `.trellis/spec/shared/backend/agent-backend-contract.md` requires safe spawn argument vectors for `.cmd` / `.bat` shims and prohibits concatenated shell strings.
