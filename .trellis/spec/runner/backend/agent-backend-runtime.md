# Agent Backend Runtime

## Scenario: fail-fast real CLI execution

### 1. Scope / Trigger

- Trigger: changes to Runner backend selection, CLI invocation, preflight, or stream event emission.
- Runner production orchestration must execute the project-level backend exactly: Claude Code or Codex.

### 2. Signatures

- `selectAgentBackend(project: Project): Promise<AgentBackend>`.
- `preflightAgentBackend(backend: ProjectAgentBackendKind): Promise<AgentBackendPreflight>`.
- Backend classes: `new ClaudeCodeBackend()` and `new CodexBackend()`.
- Runner registration flag: `--agent-backend <claude_code|codex>` for project setup convenience.

### 3. Contracts

- Backend selection source is `project.agentBackend`; do not add per-run overrides in MVP.
- `AINP_AGENT_BACKEND` must not control production orchestration.
- Preflight is backend-specific:
  - `claude_code` checks local process/auth only: `claude --version` plus `claude auth status` JSON with `loggedIn === true`. It must not spend or hang on a model prompt just to check connection.
  - `codex` checks local process/auth only: `codex --version` plus `codex login status` output that clearly reports logged in. It must not spend or hang on a model prompt just to check connection.
- Runtime `claude_code` execution uses `claude --print --output-format stream-json ...` and must not pass `--bare`, so the local Claude Code OAuth/keychain login remains visible.
- Runtime `claude_code` execution must inherit the parent process `HOME`, `CLAUDE_CONFIG_DIR`, and `XDG_CONFIG_HOME` by default so the local user's Claude Code OAuth/keychain login and config remain visible.
- Runtime `claude_code` execution must pass a `--settings` JSON whose `hooks` field overrides every known hook event type (PreToolUse, PostToolUse, PostToolUseFailure, UserPromptSubmit, Stop, SessionStart, Notification, SubagentStop) to an empty array. This prevents user-global hooks from firing inside runner-driven sessions, which historically caused message_stop ↔ Stop-hook-fail ↔ synthetic-user-message loops that only ended at the 10-minute hard timeout. **Important**: do NOT use `--setting-sources project,local` for this purpose — that flag also drops the user's `env` block (e.g. `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` for third-party routers like anyrouter), which breaks runtime auth.
- `AINP_CLAUDE_LOAD_USER_SETTINGS=1` is the explicit opt-in debugging flag for keeping user-level hooks active inside runner sessions. When set, runtime execution omits `--settings` so all user hooks fire as in interactive mode. Do not use in production orchestration.
- `AINP_CLAUDE_HOME_ISOLATION=1` is the explicit opt-in debugging flag for Claude Code HOME isolation. When set, runtime execution uses a temporary empty `HOME` and removes `CLAUDE_CONFIG_DIR` / `XDG_CONFIG_HOME` from the child environment. Do not restore default isolation under another negative flag.
- Runtime `codex` execution uses `codex exec --json ... -` and must not pass `--ask-for-approval` to `exec` for Codex CLI 0.128.0 compatibility.
- Runner CLI command resolution must be shared with preflight:
  - macOS/Linux use ordinary `claude` / `codex` or the matching env override.
  - Windows tries shim/executable candidates (`.cmd`, `.exe`, `.bat`, then the
    bare name) so npm/Bun-installed `claude.cmd` / `codex.cmd` and native
    `.exe` installs work.
  - `AINP_CLAUDE_BIN` / `AINP_CODEX_BIN` are resolved through the same candidate
    expansion; overrides ending in `.cmd` / `.bat` are invoked with
    `shell: false` via executable `cmd.exe` and argv
    `['/d', '/s', '/c', 'call', shim, ...args]`, equivalent to
    `cmd.exe /d /s /c call <shim> ...`. Never omit `call`, and never build a
    shell command string.
  - `selectAgentBackend()` must pass `preflight.bin` into `new ClaudeCodeBackend`
    / `new CodexBackend`; direct backend construction must also use the same
    resolver so runtime calls do not fall back to hard-coded bare commands.
- Every backend emits `meta` start/finish and parsed stream events through `api.postAgentEvent()`.
- The `meta:started` payload must record `userHooksOverridden: boolean` so the audit log shows whether runner hook isolation was active for that run (default `true`, becomes `false` only when `AINP_CLAUDE_LOAD_USER_SETTINGS=1`).
- For `stage='context_pack'`, the system prompt (passed via `--append-system-prompt`) must include explicit "CONTEXT-PACK CONSTRAINTS" forbidding implementation planning, variable-name proposals, and edit-site enumeration; output must be capped (≤ 2 KB target). Reason: without these constraints the model treats the user title as an implementation task and burns the timeout doing deep code reading.
- Stream event failures must not crash the local CLI process, but backend exit failures must fail the workflow.

### 4. Validation & Error Matrix

- Project backend missing -> throw setup error before choosing a backend.
- Unknown project backend -> impossible via shared type; defensive code should still fail, not default.
- Preflight not runnable -> throw composed error including `status`, raw error, and remediation hint.
- Windows shim resolution mismatch (preflight succeeds on `*.cmd` but runtime
  spawns bare `claude` / `codex`) -> forbidden; this is a contract violation.
- Windows `.cmd` / `.bat` shim invoked without `call`, with `shell: true`, or
  through a concatenated command string -> forbidden; use the exact argv
  contract above.
- Claude Code `auth status` false -> `needs_login`; invalid JSON/failure -> concise not-ready error.
- Codex `login status` logged out or failed auth -> `needs_login`; unrecognized login-status output -> `not_runnable` with masked, compact diagnostics.
- CLI stderr line during runtime -> emit `stderr` event and keep consuming unless process exits non-zero.
- Timeout -> mark preflight/runtime as not runnable/failed and surface concise timeout text.
- Claude Code reports `Not logged in` during runtime while local `claude` is logged in -> check for accidental default HOME isolation or env stripping. Default runtime should see the same local login as the runner parent process.

### 5. Good/Base/Bad Cases

- Good: `project.agentBackend = 'claude_code'`; fake Claude binary prints version and `auth status` JSON `loggedIn:true`; selection returns `ClaudeCodeBackend`.
- Good: `project.agentBackend = 'codex'`; fake Codex test binary prints version and `login status` output containing `Logged in`; selection returns `CodexBackend`.
- Bad: `claude --version` works but `claude auth status` returns `loggedIn:false`; selection fails with `needs_login`.
- Bad: `codex --version` works but `codex login status` reports logged out or emits unrecognized output; selection fails instead of assuming login is valid.

### 6. Tests Required

- Unit tests for `selectAgentBackend()` missing backend, preflight fail, and both backend success paths.
- Tests must include fake CLIs proving Claude Code auth-status handling and Codex login-status logged-in/logged-out/unrecognized handling.
- Runtime tests for Claude Code must assert args include `--print`, `--output-format stream-json`, `--no-session-persistence`, and do not include `--bare`.
- Runtime tests for Claude Code must assert default args include `--settings <json>` whose `hooks` field has empty arrays for `Stop`, `PostToolUse`, `UserPromptSubmit` (and other known types). The default args must NOT include `--setting-sources` (that flag would drop the user `env` block and break third-party auth). Setting `AINP_CLAUDE_LOAD_USER_SETTINGS=1` must omit `--settings` entirely.
- Runtime tests for Claude Code must assert default child env inherits `HOME` / Claude config env, and setting `AINP_CLAUDE_HOME_ISOLATION=1` switches to an isolated temporary `HOME` with Claude config env removed.
- Runtime tests for Claude Code must assert that for `stage='context_pack'` the system prompt argument contains the literal "CONTEXT-PACK CONSTRAINTS" guard (forbids implementation planning and caps output size).
- Runtime tests for Codex must assert args include `--json`, `--sandbox workspace-write`, `--cd`, `--ephemeral`, `--skip-git-repo-check`, `--output-last-message`, and do not include `--ask-for-approval`.
- Cross-platform resolver tests must cover Windows candidate order, env override
  expansion, `.cmd` shim spawn wrapping, `.exe` direct spawn, and runtime env
  override use without requiring a real Windows host.
- Orchestrator tests should verify no environment fallback or Native fallback is used for production runs.
- Parser tests for Claude Code/Codex JSON lines should stay green after log rendering changes.

### 7. Wrong vs Correct

#### Wrong

```ts
if (!(await codexCliAvailable())) return new NativeBackend();
```

#### Correct

```ts
const preflight = await preflightAgentBackend(project.agentBackend);
if (!preflight.runnable) throw new Error(`${preflight.label} is not ready (${preflight.status}). ${preflight.remediationHint}`);
```
