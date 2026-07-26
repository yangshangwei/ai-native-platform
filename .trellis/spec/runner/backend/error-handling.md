# Error Handling

> Error patterns for `apps/runner/`.

---

## The runner's error surfaces

A runner process talks to three things, and each has its own failure mode:

1. **The API** (`api-client.ts`) — non-2xx → throws.
2. **Spawned processes** (agent backends, git, maven, jdk) — exit code,
   signal, timeout.
3. **The local filesystem** (worktree, artifact files) — IO errors from
   `node:fs/promises`.

The runner's job is to translate every failure into either a DB-recorded
event (so the engine's audit log captures it) or a clean process exit. It
must NOT swallow errors silently — losing the failure breaks the user's
ability to investigate.

---

## Scenario: Operational vs business failures

### 1. Scope / Trigger

Apply this contract to backend preflight, CLI execution, response parsing, and
required-output validation inside a workflow run. Classify before finalizing:
operational failures pause for manual recovery; business failures remain final
`failed` outcomes.

### 2. Signatures

```ts
class OperationalError extends Error {
  reason: 'backend_unavailable' | 'backend_timeout' | 'backend_protocol';
  detail: string;
}

isOperationalError(value: unknown): value is OperationalError
handleOrchestrationError(input): Promise<boolean> // true means paused
finalizeOrchestration(input): Promise<{ workflowRunId; ok; paused }>
POST /runner/events/workflow-paused {
  workflowRunId, stage, reason, detail, worktreeHead
}
```

Use the shared shape guard at package boundaries; never rely on
cross-bundle `instanceof OperationalError`.

### 3. Contracts

- A backend invocation is successful only after exit `0` **and** a parseable
  terminal result event. Assistant/item output without the terminal result is
  `backend_protocol`, even if artifacts exist.
- `handleOrchestrationError` posts the pause event with the current stage and
  best-effort worktree HEAD. If the POST throws, it reads the run once: a
  confirmed server-side `paused` state is accepted as success; otherwise it
  falls back to historical failure handling.
- A pause skips `workflow-completed`, skips worktree cleanup, does not set a
  failure exit code, and returns `{ ok: true, paused: true }` to the watch loop.
- Step and graph schemas do not gain a new state. The step is `failed` with an
  `operational:` reason; the graph node is `failed` with
  `metadata.operational=true`.
- Business gate, compile, test, and diff-scope failures are never wrapped in
  `OperationalError`; they keep `workflow-completed(ok=false)`, cleanup, and
  exit code `1`.
- Recovery is manual: Web calls `retry-step`, then `retry-run`; worktree
  `prepare` reuses the valid same-run worktree and the start-stage slice avoids
  replaying completed stages.

> **Warning**: the two Web recovery mutations are not atomic. If `retry-step`
> succeeds and `retry-run` fails before spawning the runner, the run can remain
> `running` while its request is still `paused`. Do not claim atomic resume
> until the API owns both transition and spawn/rollback semantics.

### 4. Validation & Error Matrix

| Condition | Classification / action |
|---|---|
| CLI missing or not logged in during preflight | `backend_unavailable` |
| Hard timeout kills Claude/Codex | `backend_timeout` |
| Spawn error or non-zero CLI exit | `backend_protocol` |
| Exit `0` without parseable terminal result | `backend_protocol` |
| Missing/empty expected artifact or required stage output | `backend_protocol` |
| Pause POST fails, read-back says run is paused | Keep pause; preserve worktree |
| Pause POST fails and read-back cannot confirm | Historical failed + cleanup path |
| Gate / compile / test / diff-scope failure | Business `failed`; never operational |

### 5. Good / Base / Bad Cases

- Good: timeout -> typed pause event -> run/request paused -> worktree kept ->
  operator fixes backend and resumes the current stage.
- Base: non-zero CLI exit or malformed protocol pauses with original message in
  `detail`, while durable agent events retain exit/stderr evidence.
- Bad: wrapping `diff_scope_gate failed` as `backend_protocol` would make an
  actual business rejection recoverable and pollute the audit model.

### 6. Tests Required

- Shared taxonomy and cross-bundle guard:
  `packages/shared/test/operational-error.test.ts`.
- Backend unavailable, timeout, non-zero exit, and missing terminal result:
  `apps/runner/test/{backend-selection,claude-code-backend,claude-code-backend-grace,codex-backend}.test.ts`.
- Pause reporting, response-loss read-back, lifecycle finalization, R10 graph
  evidence, and missing outputs:
  `apps/runner/test/orchestrator-operational-pause.test.ts`.
- Watch must not complete a paused request; worktree prepare must be idempotent;
  Web must render the pause and issue retry-step before retry-run.

### 7. Wrong vs Correct

```ts
// Wrong: every thrown backend error becomes a business conclusion.
ok.value = false;
await api.workflowCompleted({ workflowRunId, ok: false });
await env.cleanup(workspace);

// Correct: only typed operational failures preserve a recoverable scene.
paused = await handleOrchestrationError({ err, workflowRunId, stage, workspacePath });
if (!paused) ok.value = false;
await finalizeOrchestration({ workflowRunId, ok: ok.value, paused, ...deps });
```

---

## API-call errors

`api-client.ts:25-36` throws on non-2xx. Callers handle in three ways:

```ts
// 1. Let bubble — the watch loop catches and records.
const project = await api.getProject(opts.project);

// 2. Catch + record + recover.
try {
  await api.workspacePrepared({ workflowRunId, workspacePath });
} catch (err) {
  // Continue if the engine doesn't strictly need the event before next step.
  console.error(`[runner] workspace-prepared failed: ${err}`);
}

// 3. Catch + record + abort the orchestrate cleanly.
try {
  await api.commandRun(cr);
} catch (err) {
  ok = false;
  // ... but still try the cleanup path
}
```

Default: **let bubble**. The watch-loop top-level catch (`watch.ts:66-73`)
records `complete(claimed.id, { ok: false, error })` so the request status
ends up correct.

---

## Spawned-process errors

Two distinct exec surfaces, both via `node:child_process.spawn`:

### `sh.ts` — runner-internal

```ts
// apps/runner/src/sh.ts
export interface ShellResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  signal: NodeJS.Signals | null;
}
```

Returns a result; never throws on non-zero exit. Caller checks `result.exitCode`
and decides what to do. Used for `git worktree`, version detection, etc.

The optional `timeoutMs` triggers a `SIGKILL` and sets `exitCode: null`. Reason:
runners must never deadlock on a hung subprocess. Always pass a timeout for
external tools whose runtime you don't trust.

### `command-runner.ts` — user-facing whitelisted

Produces a `CommandRun` event with `status: 'passed' | 'failed' | 'timed_out'`
and `exitCode`. The result is POSTed to api via `api.commandRun(cr)`; the
engine writes the row and runs the matching gate.

### Agent backends (`agents/claude-code.ts`, `codex.ts`)

Spawn via `buildResolvedAgentBackendCliSpawn` (shared util,
`packages/shared/src/utils/agent-backend-cli.ts:101-107`) so the spawn argv,
shell:false, and Windows shim wrapper are consistent.

Exit codes the runner observes:

| Exit | Meaning | Recording |
|---|---|---|
| `0` | Success | normal completion path |
| `1` | Backend reported failure | `agent_result.ok = false`, error on agent_task |
| `null` (signal) | Runner SIGKILLed for timeout | recorded as `claude exited 143 during <stage>` (143 = 128+15 SIGTERM) |
| Other non-zero | Backend-specific (`403 insufficient balance` for codex) | record verbatim, the engine surfaces it |

The current open issue
`codestable/issues/2026-05-05-claude-code-implementation-no-exit/` is rooted
exactly here: a real backend that doesn't terminate cleanly even after the
assistant answer is done. **Always preserve the original exit code +
stderr** in the agent_result so postmortem has the evidence.

---

## Filesystem errors

`worktree.ts` and artifact writes use `node:fs/promises`. Failures should
fail the entire run cleanly:

```ts
// Don't catch and continue — a failed worktree prep means we cannot proceed.
const workspace = await env.prepare(run);
```

Don't catch `ENOENT` and pretend it didn't happen. If the worktree path
doesn't exist, the run is broken.

---

## Coordinator triage failures (`watch.ts`)

The Coordinator (`agents/coordinator/`) is itself an LLM-backed agent. When
the LLM is unreachable or times out:

- Current behavior: triage falls back to `awaiting_clarification` with a
  Coordinator-authored message asking for more context.
- Open issue:
  `codestable/issues/2026-05-05-coordinator-fallback-pauses-concrete-request/`
  documents that this is too aggressive — concrete requests get incorrectly
  paused.
- Open issue:
  `codestable/issues/2026-05-05-coordinator-duplicate-clarification-on-watch-race/`
  documents that an awaiting-state request can be re-processed by a second
  watch consumer.

Lesson: **fallback paths must be idempotent**, and **fallback decisions
should be recorded with their cause** (`decision.reason = 'claude_code CLI
invocation failed: claude one-shot timed out'`) so the issue is debuggable
later.

---

## Process exits

`runner` is a CLI; `process.exit(...)` is appropriate at top-level after a
clean shutdown:

- `cmd/run.ts` exits non-zero if the command failed (`opts.setExitCode ?? true`).
- `cmd/watch.ts` does NOT exit on per-request failure (the daemon stays up
  to process the next request).
- Top-level uncaught exceptions in `index.ts` should print to `console.error`
  and exit non-zero so process supervisors can restart.

---

## Forbidden patterns

- **Swallowing exit codes from `command-runner.ts`.** Every CommandRun must
  be POSTed to api; if you skip that, the engine's compile/test gate has no
  evidence and the run looks "stuck".
- **Catching an `api-client.ts` throw and proceeding as if it succeeded.**
  The api is the source of truth; if it doesn't know the runner did
  something, the runner didn't do something, regardless of local state.
- **Logging stdout/stderr without preserving them in agent_event /
  agent_result.** The console scrolls; the DB is durable. Always record AT
  LEAST the failure tail in the event.
- **`process.exit(1)` from non-cmd files.** Only `index.ts` and `cmd/*` may
  exit. Service modules throw; the cmd-layer decides whether that's fatal.
- **Killing a child process without a timeout reason recorded.** The
  agent_result must say why (`claude exited 143 during implementation` not
  just `claude exited 143`).
