# Error Handling

> Error patterns for `apps/api/`.

---

## The two surfaces

API errors travel two channels at once:

1. **HTTP response** — the immediate caller (web UI, runner, scripts).
2. **Audit / agent_result rows in the DB** — the durable record the workflow
   engine and downstream gates reason about.

Don't conflate them. A failed `POST /workflow-runs` returns a 400, but a
failed `runWorkflow` step writes a `workflow_audit` row + flips the run
status to `failed`. The HTTP caller is gone by then.

---

## Route-handler pattern

```ts
workflowRequests.post('/', async (c) => {
  const body = (await c.req.json()) as { ... };

  // 1. Authentication / existence checks → 4xx
  let project = body.projectId ? store.projects.get(body.projectId) : undefined;
  if (!project && body.projectName) project = store.projectByName(body.projectName);
  if (!project) return c.json({ error: 'projectId or projectName required' }, 400);

  // 2. Business preconditions → 4xx with structured payload
  const backendError = projectAgentBackendError(project);
  if (backendError) return c.json({ error: backendError, needsAgentBackendSetup: true }, 400);

  // 3. Body validation BEFORE any DB write (atomicity)
  if (!body.title?.trim()) return c.json({ error: 'title required' }, 400);
  // ... validate firstMessage etc.

  // 4. Delegate to engine
  const request = createWorkflowRequest({ ... });
  return c.json(request, 201);
});
```

See `apps/api/src/routes/workflow-requests.ts:60-78` for the actual sequence.

### Status code map

| Status | When |
|---|---|
| `400` | Body / query / params don't satisfy contract; missing required field; project archived. |
| `404` | Resource lookup by id failed (`store.projects.get(id)` returned undefined for a known-shape id). |
| `409` | UPSERT conflict that the caller must resolve, e.g. duplicate `name` on `POST /projects`. |
| `500` | Unhandled exception bubbling out — should be rare; if you can predict it, map to a 4xx instead. |

Return JSON every time: `c.json({ error: <human-string>, ...optionalContext }, status)`. Plain
`c.text(...)` is OK for `/health` only.

### Trust-boundary type guards

User input crosses a boundary into a TypeScript union — guard it with a
predicate before passing it downstream.

```ts
// Guards live in @ainp/shared and are derived from the source-of-truth —
// do NOT re-declare local literal allow-lists at route boundaries.
import { isFlowId, isWorkflowStage } from '@ainp/shared';
// KNOWN_FLOW_IDS / isFlowId: derived from Object.keys(FLOW_REGISTRY)
//   (packages/shared/src/flows/registry.ts)
// WORKFLOW_STAGES / isWorkflowStage: packages/shared/src/types/workflow.ts

if (body.flowId !== undefined && !isFlowId(body.flowId)) {
  return c.json({ error: `unknown flowId: ${body.flowId}` }, 400);
}
```

Consumers: `routes/workflow-runs.ts` (flowId + startStage), `routes/runner-events.ts`
(stage), `routes/workflow-requests.ts`. Reason:
`FLOW_REGISTRY[run.flowId]` and the orchestrator dispatcher would otherwise
silently get garbage and crash deep inside the engine; the route is the right
place to fail fast.

---

## Engine-side errors

`workflow-engine.ts` is the sole writer. When it can't make progress:

1. **Predictable rejection** (gate failed, knowledge rejected, missing input
   artifact) — write a `workflow_audit` row with action and details. Do NOT
   throw. The orchestrator continues per the flow contract.
2. **Programmer error / invariant violation** — `throw new Error('...')`. The
   orchestrator catches at `cmdOrchestrate`'s try/finally and writes a failed
   `workflow_audit` plus `completeWorkflowRun(..., 'failed')`.
3. **Backend / IO failure** (e.g. agent CLI exited non-zero) — record a failed
   `agent_task` + `agent_result` rows via `recordAgentTask` /
   `recordAgentResult`, plus a `workflow_audit` row, then propagate.

The pattern: **expected failures become rows; unexpected failures become
exceptions**. The HTTP surface only sees the unexpected ones (and only when a
synchronous route is involved).

### Scenario: Operational pause ingress and state transitions

#### 1. Scope / Trigger

Use this contract when the runner classifies a backend CLI failure as an
`OperationalError`. Operational unavailability is a recoverable fourth run
outcome; it must not be persisted as a business `failed` conclusion.

#### 2. Signatures

```ts
POST /runner/events/workflow-paused {
  workflowRunId: string;
  stage: WorkflowStage;
  reason: 'backend_unavailable' | 'backend_timeout' | 'backend_protocol';
  detail?: string | null;
  worktreeHead?: string | null;
}

pauseWorkflowRun(input): WorkflowRun
completeWorkflowRun(workflowRunId: string, ok: boolean): WorkflowRun
retryStage({ workflowRunId, stage, actor }): { run: WorkflowRun; step: StepRun }
```

#### 3. Contracts

- `pauseWorkflowRun` sets the run to `paused`, records its current stage, and
  writes one `workflow_run.paused` audit row containing
  `reason/detail/stage/worktreeHead`.
- The owning request moves `claimed -> paused`; other request states are not
  rewritten. A resumed run's completion closes `paused -> completed|failed`.
- Repeating pause on an already-paused run is idempotent and writes no second
  audit row. A cancelled run cannot be paused.
- A late `completeWorkflowRun(id, false)` cannot demote `paused` to `failed` or
  write a completion audit. `ok=true` is allowed after recovery.
- Resume is manual only. `retryStage` accepts `paused`, resets the selected
  step to `pending`, and returns the run to `running`; `cancelled` remains
  terminal. SQLite stores statuses as unrestricted `TEXT`, so no migration is
  needed for the new literal.

#### 4. Validation & Error Matrix

| Input / state | Result |
|---|---|
| Missing `workflowRunId`, `stage`, or `reason` | `400` |
| Unknown `stage` or operational reason | `400` |
| Unknown workflow run | `404` |
| Run is `cancelled` | `400`, state unchanged |
| Run is already `paused` | `200`, same run, no duplicate audit |
| Run is active | `200 { ok: true, run }`, run and claimed request pause |
| Paused run receives late `ok=false` completion | No-op; remains paused |

#### 5. Good / Base / Bad Cases

- Good: a hard backend timeout pauses the run and claimed request, preserving
  the stage, detail, and worktree HEAD for manual recovery.
- Base: a paused run is resumed with `retryStage`, then ordinary successful or
  failed completion closes the linked request.
- Bad: treating a gate failure as operational would corrupt business audit
  semantics; gate, compile, test, and diff-scope failures stay on `failed`.

#### 6. Tests Required

- Route tests: valid payload, trust-boundary guards, unknown run, and cancelled
  run (`apps/api/test/workflow-paused-route.test.ts`).
- Engine tests: request linkage, single audit, cancelled/idempotent guards,
  late completion defense, retry reset, and resumed completion closure
  (`apps/api/test/operational-pause.test.ts`).
- Cross-layer tests must also assert that the runner skips completion and
  cleanup for pauses while preserving the historical business-failure path.

#### 7. Wrong vs Correct

```ts
// Wrong: late delivery converts an operational pause into a business failure.
run.status = ok ? 'passed' : 'failed';

// Correct: preserve the typed pause until a real recovery succeeds.
if (run.status === 'paused' && !ok) return run;
run.status = ok ? 'passed' : 'failed';
```

---

## Runner-event ingress (`routes/runner-events.ts`)

The runner is a downstream consumer, not a state writer. It POSTs events
(`/runner/events/step-started`, `/runner/events/step-finished`,
`/runner/events/agent-event`, …) and the engine decides the new state.

If the runner sends bad data (missing required fields, unknown stage), the
route returns 400. The runner's `api-client.ts:request()` throws on non-2xx,
so the runner sees the error immediately.

Runner-side timeouts (Claude Code stuck, Maven hang) become exit codes/events
that the runner records via `agent-event` / `command-run` POSTs — the engine
records them as failed agent_tasks, but the API itself stays healthy.

---

## Forbidden patterns

- **Silently swallowing errors in route handlers.**
  ```ts
  // BAD
  try { return c.json(await doThing()); } catch { return c.json({ ok: false }); }
  ```
  The caller has no idea what went wrong; debugging requires server logs that
  may not be retained. Either propagate (let `app.onError` write a 500) or
  classify (`if (err instanceof KnowledgeArtifactValidationError) return c.json({error: err.message}, 400)`).
- **Exposing raw stack traces in 5xx response bodies.** Stack traces leak
  internal paths and module structure. Log the stack server-side; return a
  short message + a stable error code if the caller needs to branch.
- **Mixing 4xx and 5xx semantics.** A user-visible "you forgot a field" is 4xx;
  "the database is unreachable" is 5xx. Don't return 200 with `{ ok: false }`
  for things that should be 4xx — that breaks fetch-based clients that expect
  HTTP status to mean what it says.
- **Throwing from a `db.transaction()` body for an expected business
  rejection.** SQLite rolls back, which is what you want for invariant
  violations, but expected rejections (gate failed, knowledge rejected) need a
  row written. Compose the predicate check OUTSIDE the tx.
- **Returning `c.json(err, 500)` with a raw `Error` object.** Hono will
  stringify only own-enumerable fields; `message` and `stack` get dropped.
  Use `c.json({ error: err.message }, 500)` and log the stack separately.
