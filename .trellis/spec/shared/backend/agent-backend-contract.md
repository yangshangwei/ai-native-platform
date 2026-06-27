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
  - Runner Codex runtime sets `CODEX_NON_INTERACTIVE=1` for the child process.
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
- Runner: backend selection reads only project config, uses the backend-specific preflight contract, Codex runtime does not pass `--ask-for-approval` to `codex exec` (the flag is interactive-only) and instead pins `-c approval_policy="never"` so the sandbox is the sole gate, passes `--ignore-rules --disable hooks` plus `CODEX_NON_INTERACTIVE=1` while keeping user config loaded for auth/provider routing, stages produce-file artifacts inside the workspace at `<workspace>/.ainp-artifacts/<stage>/<name>` (then copies them to `ctx.artifactsDir`) because Codex's `codex_core::tools::router` hard-rejects any `apply_patch` whose target sits outside `--cd` regardless of `--add-dir` or approval policy, and fail-fast errors include remediation.
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

## Scenario: AgentSession trajectory ledger

### 1. Scope / Trigger

- Trigger: any change that records, stores, validates, or displays backend invocation envelopes for workflow runs.
- This is a cross-layer contract: shared types, API persistence/ingress, Workflow Engine state writes, Runner invocation, and read-model APIs must agree.
- AgentSession is audit/read-model data only. It must not become the authority for workflow status, gate status, or completion.

### 2. Signatures

- Shared type: `AgentSession` records one backend invocation envelope.
- Shared status: `AgentSessionStatus = 'running' | 'success' | 'failed' | 'cancelled'`.
- Shared link: `AgentSessionLink` describes retry or handoff-child parentage.
- DB table: `agent_sessions` with `workflow_run_id`, `step_run_id`, `agent_task_id`, `agent_result_id`, `backend`, `stage`, `skill_id`, `skill_version`, `context_pack_id`, `parent_session_id`, `retry_index`, `status`, timestamps, and `metadata_json`.
- Runner ingress:
  - `POST /runner/events/agent-session-started`
  - `POST /runner/events/agent-session-finished`
- Read model:
  - `GET /workflow-runs/:id/agent-sessions`
  - `GET /workflow-runs/:id` includes `agentSessions`.

### 3. Contracts

- Every workflow-run backend invocation creates an AgentTask first, then an AgentSession linked to that task and the context pack used for the invocation.
- Successful invocations finish the AgentTask, then finish the AgentSession with `status: 'success'` and the produced `agentResultId`.
- Failed invocations finish the AgentTask, then finish the AgentSession with `status: 'failed'`, the failure AgentResult id, and concise error metadata.
- Existing workflow runs with no AgentSession rows must return `items: []`, not fail.
- Runner reports events through API ingress; Workflow Engine remains the only platform state writer.
- Gate Engine remains the only pass/warn/fail authority. AgentSession status is invocation audit status, not gate verdict.
- Retry or child invocations must preserve `parentSessionId` and `retryIndex` so later context retry, handoff, and replay features can reconstruct lineage.
- Same-step context retry creates a second AgentSession for the retry invocation. The retry session must set `parentSessionId` to the base session id, `retryIndex = 1`, and `contextPackId` to the supplement ContextPack id.

### 4. Validation & Error Matrix

- Missing start fields (`workflowRunId`, `agentTaskId`, `stage`, `skillId`, `skillVersion`, `contextPackId`) -> 400.
- Unknown start `stage` -> 400.
- Missing `agentTaskId` on start -> 404.
- `agentTaskId` belongs to a different `workflowRunId` -> 400.
- Missing finish fields (`sessionId`, `status`) -> 400.
- Unknown finish `status` -> 400.
- Finish with `status: 'running'` -> 400.
- Missing `sessionId` on finish -> 404.
- Missing `agentResultId` on finish when supplied -> 404.
- Supplied `agentResultId` belongs to a different task than the session's `agentTaskId` -> 400.

### 5. Good/Base/Bad Cases

- Good: Runner invokes `skill.implementation@1.0.0`, records AgentTask, creates AgentSession with the context pack id, finishes AgentResult, then finishes AgentSession with `status: 'success'`.
- Good: Backend throws; Runner records failed AgentResult and failed AgentSession with error metadata before rethrowing.
- Base: legacy run predates AgentSession; `/workflow-runs/:id/agent-sessions` returns `{ items: [] }`.
- Bad: Runner finishes a session with an AgentResult from another AgentTask; API rejects the envelope.
- Bad: UI or API treats AgentSession success as a gate pass; Gate Engine verdicts are the only gate authority.
- Bad: context_request retry reuses the base AgentSession instead of creating a child session; trajectory replay can no longer distinguish base vs supplement context.

### 6. Tests Required

- Shared: assert AgentSession statuses and type shape support normal invocation plus retry/child linkage.
- API store/engine: assert AgentSession rows can be started, finished, linked to AgentTask/AgentResult/ContextPack, and queried by workflow run.
- API routes: assert legacy empty lists, start/finish ingress success, and validation errors for bad finish envelopes.
- Runner: assert successful `invokeSkill()` returns `sessionId` and `finishAgentSuccess()` links the success AgentResult to the AgentSession.
- Runner: assert failed `invokeSkill()` records a failed AgentResult and failed AgentSession instead of leaving the session running or absent.
- Runner: assert context_request same-step retry starts a child AgentSession with `parentSessionId` and `retryIndex = 1`, and repeated requests fail the retry session instead of looping.

### 7. Wrong vs Correct

#### Wrong

```ts
// The runner invents durable state locally and never tells the Workflow Engine.
localSessions.push({ taskId, status: 'success' });
```

#### Correct

```ts
const session = await api.agentSessionStarted({
  workflowRunId,
  agentTaskId: task.task.id,
  stage: skill.stage,
  skillId: skill.id,
  skillVersion: skill.version,
  contextPackId: contextPack.id,
});

const result = await api.agentTaskFinished({ taskId: task.task.id, status: 'success', summary, outputArtifactIds });
await api.agentSessionFinished({ sessionId: session.session.id, status: 'success', agentResultId: result.result.id });
```
