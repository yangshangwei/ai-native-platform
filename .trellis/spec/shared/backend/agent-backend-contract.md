# Agent Backend Contract

## Scenario: project-level real Agent Backend selection

### 1. Scope / Trigger

- Trigger: any change that stores, validates, displays, or executes an Agent Backend choice.
- This is a cross-layer contract: shared types, API persistence, Runner execution, and Web UI must agree.
- Product-facing backends are real CLI integrations only: `claude_code` and `codex`.

### 2. Signatures

- Shared type: `ProjectAgentBackendKind = 'codex' | 'claude_code'`.
- Historical event/task type: `AgentBackendKind = 'native' | 'codex' | 'claude_code'`.
- Project field: `Project.agentBackend?: ProjectAgentBackendKind | null`.
- DB column: `projects.agent_backend TEXT` stores `claude_code`, `codex`, or `NULL`.
- API request field: `agentBackend` accepts `claude_code` or `codex`.
- Preflight response: `AgentBackendPreflight` with `status`, `installed`, `runnable`, `authenticated`, `version`, `error`, and `remediationHint`.
- Stream event channel: `AgentStreamEvent` belongs to exactly one of `run:<workflowRunId>` or `request:<workflowRequestId>`. Shared helpers `isAgentStreamChannel(input)` and `agentStreamChannelKey(channel)` are the canonical runtime guard/router.

### 3. Contracts

- Product configuration must use `ProjectAgentBackendKind`, not the broader historical `AgentBackendKind`.
- `native` may exist only in legacy tests or historical `agent_tasks` / `agent_events` rows; it must not be accepted as project configuration.
- A project with `agentBackend: null` is not runnable for new workflow requests/runs until configured.
- `agentBackendDisplayName()` may render historical event rows, but UI configuration options must be built from `PROJECT_AGENT_BACKENDS`.
- Preflight is backend-specific:
  - Claude Code: run `claude --version`, then `claude auth status` and require JSON `loggedIn === true`. Do not spend a model call for the connection check.
  - Codex: run `codex --version`, then `codex login status` and require recognizable logged-in output such as `Logged in`. Do not spend a model call for the connection check.
- Environment keys:
  - `AINP_CLAUDE_BIN` optionally overrides the Claude Code binary.
  - `AINP_CODEX_BIN` optionally overrides the Codex binary.
  - `AINP_AGENT_PREFLIGHT_TIMEOUT_MS` optionally overrides preflight timeout.
- Cross-platform CLI resolution is a shared contract between API preflight,
  Runner preflight, and Runner runtime invocation:
  - macOS/Linux candidates are the ordinary `claude` / `codex` commands unless
    an env override is provided.
  - Windows candidates must cover Node/npm/Bun-style shims before the bare name:
    `claude.cmd`, `claude.exe`, `claude.bat`, `claude`; and
    `codex.cmd`, `codex.exe`, `codex.bat`, `codex`.
  - Env overrides are honored first. On Windows, an override without an
    executable extension is expanded with `.cmd`, `.exe`, `.bat`, then the exact
    value so `AINP_CLAUDE_BIN=C:\Tools\claude` can still find
    `C:\Tools\claude.cmd`.
  - `.cmd` / `.bat` shims must be invoked with `shell: false` through safe
    spawn argument vectors: executable `cmd.exe` and argv
    `['/d', '/s', '/c', 'call', shim, ...args]`, equivalent to
    `cmd.exe /d /s /c call <shim> ...`. Do not omit `call`, and do not
    concatenate a shell command string.
  - The binary candidate that passed preflight must be passed into the runtime
    backend instance so detection and execution do not diverge.
- Agent stream events use a two-channel model:
  - `workflowRunId` is set and `workflowRequestId` is null/absent for real workflow-run execution.
  - `workflowRequestId` is set and `workflowRunId` is null for pre-run phases such as Coordinator triage.
  - Both set or both missing is invalid at API ingest / engine write boundaries. The bus and UI must derive channel keys through the shared helper, not by concatenating ids ad hoc.
- `sequence` is monotonic per channel, not globally. `run:<id>` and `request:<id>` may both start at sequence 1; UI resume/dedupe must key by channel + sequence.

### 4. Validation & Error Matrix

- Missing `agentBackend` on project create/update -> persist `NULL`; UI must show setup required.
- Missing `agentBackend` when creating workflow request/run -> reject with a setup error.
- `agentBackend = native` in API input -> reject as invalid or normalize legacy storage to `NULL` when reading.
- CLI binary missing -> preflight `status: 'missing_cli'` with install hint.
- Windows `.cmd` shim present but bare `claude` / `codex` missing -> preflight
  must still connect by resolving the shim candidate; runtime must use the same
  resolved shim.
- Claude Code `auth status` reports `loggedIn: false` -> preflight `status: 'needs_login'` with login hint.
- Claude Code `auth status` emits invalid JSON or fails unexpectedly -> concise `needs_login` / `not_runnable`; never dump raw plugin/path payloads.
- Codex `login status` exits non-zero or reports logged out -> concise `needs_login`.
- Codex `login status` emits unrecognized output -> concise `not_runnable`; mask API keys/tokens before returning diagnostics.
- Runner sees preflight not runnable -> throw; never fall back to another backend.
- Agent stream event with neither channel id or both channel ids -> reject with a trust-boundary error (400 at HTTP ingest; throw in engine helpers).

### 5. Good/Base/Bad Cases

- Good: project has `agentBackend: 'claude_code'`, `claude auth status` returns `loggedIn: true`, Runner uses `ClaudeCodeBackend`, and Web logs show `Claude Code` events.
- Good: project has `agentBackend: 'codex'`, `codex login status` reports logged in, Runner uses `CodexBackend`, and Web logs show `Codex` events.
- Base: legacy project has `agentBackend: null`; Web shows `Needs setup` and task creation is disabled/rejected until configured.
- Bad: `agentBackend: 'claude_code'` but `claude` is missing; API/Runner report `missing_cli` and do not enqueue/execute a fake backend.

### 6. Tests Required

- Shared: assert product backend guard accepts only `codex` / `claude_code`.
- API: create/update project stores backend, rejects invalid backend, normalizes legacy invalid DB values to `null`, and blocks workflow request/run without backend.
- Runner: backend selection reads only project config, uses the backend-specific preflight contract, Codex runtime does not pass `--ask-for-approval` to `codex exec`, and fail-fast errors include remediation.
- Web: project form/task form renders only Claude Code/Codex, disables task creation without backend, and labels stream events with display names.
- Shared/API: stream-channel tests must prove `workflowRunId | workflowRequestId` mutual exclusion, per-channel sequence independence, and request/run live-tail isolation.

### 7. Wrong vs Correct

#### Wrong

```ts
const backend = process.env.AINP_AGENT_BACKEND ?? 'native';
// If codex is unavailable, keep the demo moving.
return new NativeBackend();
```

#### Correct

```ts
const backend = project.agentBackend;
if (!backend) throw new Error('Choose Claude Code or Codex before starting a workflow.');
const preflight = await preflightAgentBackend(backend);
if (!preflight.runnable) throw new Error(preflight.remediationHint);
```
