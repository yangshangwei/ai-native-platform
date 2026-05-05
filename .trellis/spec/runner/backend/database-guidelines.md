# Database Guidelines

> Persistence rules for `apps/runner/`.

---

## TL;DR

**The runner has no direct database access.** All persistence flows through
the API over HTTP via `apps/runner/src/api-client.ts`. There is no
`bun:sqlite` import in `apps/runner/src/`. There is no SQL.

---

## Why

This split is intentional and load-bearing for the architecture:

- The runner is a remote process — it can sit on a different machine from
  the API in future deployments. Direct DB access would couple them at the
  filesystem layer.
- The api owns the workflow lifecycle invariants (sole state writer per
  `apps/api/src/workflow-engine.ts` header). If the runner could write to
  the DB, those invariants would be enforced in two places — eventually
  drifting.
- Multiple runners on one host (separate processes for `runner watch` and
  `runner orchestrate`) coordinate via the API, not via SQLite.
- It makes the runner trivially testable: stub `api-client.ts` and you've
  stubbed the entire persistence layer.

---

## What "the database" looks like to the runner

The api over HTTP. The runner sees these resource shapes (defined in
`@ainp/shared`):

- `Project` (read-only from the runner's view)
- `WorkflowRun`, `WorkflowRequest`, `StepRun`, `CommandRun`, `BuildRun`,
  `TestRun`, `GateRun`, `Artifact`, `KnowledgeArtifact`, `AgentTask`,
  `AgentResult`, `AgentStreamEvent`

Plus runtime-only types like `WorkspaceRef` (computed in the runner, not
persisted).

---

## The api-client contract

Every cross-process call goes through `apps/runner/src/api-client.ts:25-36`:

```ts
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${method} ${path} -> ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}
```

- Non-2xx → `throw`. Callers in `orchestrator.ts` either catch + log or let
  bubble.
- 2xx → parsed JSON cast to the expected `T`. The api's response shape is
  the contract.

The exported `api` object groups calls by resource:

```ts
export const api = {
  health: () => request<{ ok: boolean }>('GET', '/health'),
  registerProject: (params) => request<Project>('POST', '/projects', params),
  getProject: (idOrName) => request<Project>('GET', `/projects/${...}?includeSecret=1`),
  createWorkflowRun: (params) => request<WorkflowRun>('POST', '/workflow-runs', { ...params, type: params.type ?? 'smoke' }),
  // ...
};
```

Adding a new persistence call means adding a method on the `api` object — not
adding a new HTTP fetch elsewhere in the runner.

---

## Event vs. state distinction

Per `apps/api/src/routes/runner-events.ts:38-41` header:

> Runner-driven event ingress. The Runner is NOT a state writer — it tells
> the Engine what happened and the Engine decides the new state.

So the runner POSTs events:

- `POST /runner/events/step-started` → engine creates StepRun row.
- `POST /runner/events/step-finished` → engine updates the row.
- `POST /runner/events/command-run` → engine inserts CommandRun row.
- `POST /runner/events/agent-event` → engine inserts AgentStreamEvent and
  publishes to live SSE subscribers.
- `POST /runner/events/workspace-prepared` → engine sets `workspace_path`.
- `POST /runner/events/maven-build` → engine synthesizes BuildRun + TestRun
  + Artifact + runs Compile/Test gates.

Each of those is a method on `api` in `api-client.ts`. The runner never asks
"please update WorkflowRun.status to running" directly — it tells the engine
what happened and the engine decides.

---

## Idempotency expectations

The runner may retry on its side (network blip, restart mid-run). HTTP calls
should therefore be idempotent at the api side where possible, OR the runner
must guard at the call site:

- `api.workspacePrepared` is idempotent: the engine just records the latest
  workspace_path.
- `api.commandRun` is **not** idempotent if called twice with the same
  CommandRun — it would insert a second row. The runner generates a fresh
  `CommandRunId` per attempt, so retry-after-throw means retry the work, not
  retry the recording.

Document any new event endpoint you add as idempotent or not, and pick the
matching call shape.

---

## Forbidden patterns

- **`import { db } from 'apps/api/src/store/db'`** — would dissolve the
  layering. There's no path that should make this attractive; if you find
  yourself wanting it, the right fix is to add an api endpoint.
- **`import 'bun:sqlite'`** anywhere under `apps/runner/src/` — same reason.
- **Reading directly from `~/.ai-native/ainp.sqlite`** — same DB the api
  uses, but reading it from the runner means the runner sees post-tx state
  the api thinks is private. Use the api endpoints.
- **Calling `fetch` to the api outside of `api-client.ts`** — bypasses the
  central error handling and the typed response contract.
- **Caching api responses across run invocations.** The api is the source of
  truth; cache only within a single `cmdOrchestrate` invocation when the
  cost is real (e.g., `getProject` once per orchestrate is fine).
