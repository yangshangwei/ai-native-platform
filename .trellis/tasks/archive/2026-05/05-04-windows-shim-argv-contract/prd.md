# Document Windows shim argv contract

## Goal

Align Trellis specs with the current cross-platform CLI runtime behavior for Windows `.cmd` / `.bat` shims so future changes preserve safe argv-based invocation.

## What I already know

- Current implementation in `packages/shared/src/utils/agent-backend-cli.ts` invokes Windows `.cmd` / `.bat` shims through `cmd.exe` with argv `['/d', '/s', '/c', 'call', shim, ...args]` and keeps `shell: false`.
- The requested update is docs/spec only: do not modify production code and do not commit.
- Preferred target specs are `.trellis/spec/shared/backend/agent-backend-contract.md` and `.trellis/spec/runner/backend/agent-backend-runtime.md`.

## Requirements

- Update only the relevant Trellis specs needed to make the CLI contract explicit.
- State that Windows `.cmd` / `.bat` shims are executed via `cmd.exe /d /s /c call <shim> ...` represented as an argv vector.
- Make clear that this must not be implemented by omitting `call` or by concatenating a shell command string.
- Preserve `shell: false` as part of the contract.
- Do not change production code.
- Do not create commits.

## Acceptance Criteria

- [ ] `.trellis/spec/shared/backend/agent-backend-contract.md` documents the exact `.cmd` / `.bat` argv shape with `call` and `shell: false`.
- [ ] `.trellis/spec/runner/backend/agent-backend-runtime.md` documents the same runtime/preflight expectation.
- [ ] No production source files are modified by this task.
- [ ] `git diff --check` passes.

## Out of Scope

- Changing `packages/shared/src/utils/agent-backend-cli.ts` or related tests.
- Running or modifying CLI preflight/runtime behavior.
- Creating a git commit.
