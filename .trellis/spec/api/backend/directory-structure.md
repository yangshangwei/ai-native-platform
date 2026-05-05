# Directory Structure

> Module layout for `apps/api/`.

---

## Top-level layout

```
apps/api/src/
├── server.ts                 # Bun.serve entry; reads AINP_API_PORT/HOST
├── app.ts                    # Hono app + route mounts; the only place routes are registered
├── routes/                   # HTTP boundary — one file per resource
├── store/                    # SQLite persistence — db.ts (singleton) + store.ts (typed CRUD)
├── workflow-engine.ts        # Sole writer of WorkflowRun / StepRun / Build / Test / Gate state
├── gate-engine.ts            # Compile / Test / Diff-scope / Sensitive / Acceptance / Traceability gates
├── router.ts                 # Smart Router pure function (W2-4)
├── promote.ts                # Knowledge promote-in-transaction
├── promote-file.ts           # Dual-write (codestable/<kind>/<entity>.md) renderer + atomic write
├── reports.ts                # Completion report + knowledge candidate generators
├── artifact-content.ts       # `assertReadableFileUri` boundary check
├── agent-stream-bus.ts       # In-process pub/sub for live agent SSE
└── agent-backend-preflight.ts# Project backend availability checks
```

---

## Where things go

### `routes/<resource>.ts` — HTTP boundary

One file per resource. Hono router exported as a named const matching the file
(`projects.ts` exports `projects`; `app.ts` does `app.route('/projects', projects)`).

Route handlers do **only**:

1. Parse + validate body / query / params (with trust-boundary type guards).
2. Map errors to HTTP status codes (400 / 404 / 409 / 5xx).
3. Delegate the business mutation to `workflow-engine.ts` / `promote.ts` / a
   helper, OR a read to `store/store.ts`.

Examples:

- `routes/workflow-runs.ts:23` — `KNOWN_FLOW_IDS` literal + `isFlowId()` guard.
  The trust-boundary check that keeps `FLOW_REGISTRY[run.flowId]` from ever
  seeing garbage.
- `routes/workflow-requests.ts:60` — fail-fast `if (!body.title?.trim()) return c.json({ error: 'title required' }, 400)` BEFORE any DB write so the
  atomicity contract holds.

### `store/db.ts` — DB singleton

Owns the `bun:sqlite` Database instance, the connection-level PRAGMAs (`WAL` +
`foreign_keys = ON` at `db.ts:15-16`), and the append-only `MIGRATIONS` array
(see `database-guidelines.md` for the migration protocol).

Nothing outside `store/` may import `bun:sqlite` directly. Route handlers and
engine modules import `db` only for narrow, one-off raw SQL inside transaction
bodies — and even then you should prefer a repo method.

### `store/store.ts` — typed CRUD layer

Holds the typed repos (`store.projects`, `store.workflowRuns`,
`store.knowledgeArtifacts`, …) plus row-to-domain mappers (`rowToProject`,
`rowToWorkflowRun`, …) and the two helpers `insertRow(table, row)` /
`upsertRow(table, row)` for positional INSERT.

A new repo lives here as a `MapLike<T>`-shaped object exported on the `store`
namespace. The repo methods own the snake_case ↔ camelCase translation; the
rest of the codebase only sees domain shapes.

### `workflow-engine.ts` — sole state writer

The only module allowed to mutate workflow lifecycle state. Header comment
states it explicitly:

> Workflow Engine — sole state writer. Anything that mutates a WorkflowRun /
> StepRun / Build / Test / Gate must go through this module.

Routes call `createWorkflowRun()`, `recordRequirementAction()`,
`recordAcceptanceDecision()`, etc. They never `store.workflowRuns.set(...)`
directly — except for already-immutable lookups read paths.

### `gate-engine.ts` — pure gate decisions

`runCompileGate()`, `runTestGate()`, `runDiffScopeGate()`,
`runSensitiveChangeGate()`, `runAcceptanceTraceabilityGate()`,
`runRequirementGate()`, `runDesignGate()`, `runManualGate()`. Each takes the
inputs it needs and returns a `GateRun`. No DB writes inside (the engine
writes the GateRun via `recordGateRun`).

### Top-level service files

Each has a single, named purpose: `promote.ts` for promote-in-transaction,
`reports.ts` for report generation, `agent-stream-bus.ts` for live SSE
pub/sub, `router.ts` for the Smart Router pure function,
`agent-backend-preflight.ts` for project backend availability checks.

Don't add anonymous "utils.ts" / "helpers.ts" — give the file a name that
states what concept it owns.

---

## Cross-package imports

`apps/api/` may import from:

- `@ainp/shared` — types, `FLOW_REGISTRY`, utils (whitelist, surefire parser,
  redaction, agent-backend-cli, id helpers).
- `node:*`, `bun:sqlite`, `hono`.

`apps/api/` MUST NOT import from:

- `apps/runner/` — runner is a downstream consumer; reverse imports would
  create a layering cycle.
- `apps/web/` — web is a frontend consumer; api owns the contract.

The `@ainp/shared` package itself has stricter rules (see
`spec/shared/backend/quality-guidelines.md`); any cross-cutting type or pure
helper that both api and runner need belongs there.

---

## File-naming conventions

| Kind | Convention | Example |
|---|---|---|
| Module | `kebab-case.ts` | `workflow-engine.ts`, `agent-stream-bus.ts` |
| Route file | `<plural-resource>.ts` | `workflow-runs.ts`, `knowledge-artifacts.ts` |
| Test | `<file-under-test>.test.ts` next to the file | `router.test.ts` next to `router.ts` |

Don't introduce nested folders inside `routes/` — when there are too many
routes for a resource, split by sub-resource (e.g. `workflow-request-chat.ts`
co-exists with `workflow-requests.ts`) rather than nesting.

---

## Forbidden patterns

- **Business logic inside route handlers.** A handler that builds a multi-step
  domain operation belongs in `workflow-engine.ts` / `promote.ts`. The handler
  should be a thin shell. Reason: business state is exercised directly by
  tests via the engine; tests should not need an HTTP server.
- **Direct SQL outside `store/`.** Catches: ad-hoc `db.prepare(...).run(...)`
  in a route or service. Reason: the row ↔ domain mapper lives in the store;
  if you bypass it you bypass the type bridge and the snake_case discipline.
- **Importing from `apps/runner/` or `apps/web/`.** Reason: layering cycle,
  build-time circular import, and conceptual confusion about who owns what.
- **Adding cross-cutting helpers under `apps/api/src/utils/`.** Pure helpers
  shared with the runner go to `packages/shared/src/utils/`. API-private
  helpers stay at the top level with descriptive names.
