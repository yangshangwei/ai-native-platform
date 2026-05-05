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
// apps/api/src/routes/workflow-runs.ts:23
const KNOWN_FLOW_IDS: readonly FlowId[] = [
  'feature.standard', 'feature.fastforward', 'issue.standard', 'refactor.standard',
];
function isFlowId(value: unknown): value is FlowId {
  return typeof value === 'string' && (KNOWN_FLOW_IDS as readonly string[]).includes(value);
}
```

Same pattern in `routes/workflow-runs.ts:34-51` for `WorkflowStage`. Reason:
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
