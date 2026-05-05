# Quality Guidelines

> Code standards specific to `apps/api/`.

---

## Pre-commit gate

```bash
bun test
bun run typecheck
```

Must be green before any commit. `bun run typecheck` runs `tsc --noEmit` for
every workspace. Failing typecheck on api propagates to runner / web because
they consume `@ainp/shared` types that flow through here.

The CLAUDE.md hot-path note: `apps/api/src/workflow-engine.ts` shows up 26+
times in recent task records — changes to its public functions affect both
the runner via `api-client.ts` and the routes that call it. Test those
specifically.

---

## Test placement

- **Unit tests live next to the file under test**: `router.test.ts` next to
  `router.ts`, `gate-engine.test.ts` next to `gate-engine.ts`.
- Engine-level tests use the real `store` and a fresh in-memory DB (set
  `AINP_DB_PATH` to `:memory:` in the test setup or use the test fixture).
- Route tests instantiate the Hono `app` and use `app.fetch(new Request(...))`
  — no real HTTP server needed.
- See `apps/runner/src/flows/flow-registry.test.ts` for the shape; W2-4 PR1
  baseline of 391 → 403 tests is recorded in the archived task notes.

---

## Naming

| What | Convention | Example |
|---|---|---|
| Function | `camelCase` | `createWorkflowRun`, `recordAcceptanceDecision`, `recommend` |
| Type / interface | `PascalCase` | `WorkflowRun`, `RouterRecommendation` |
| File | `kebab-case.ts` | `workflow-engine.ts`, `agent-stream-bus.ts` |
| Const | `SCREAMING_SNAKE` (literal arrays / config) | `KNOWN_FLOW_IDS`, `STAGE_AGENT_TIME_SEC` |
| DB column | `snake_case` (translated to camelCase by `rowTo*` mappers) | `agent_backend`, `current_stage` |

Type guards: `is<Type>`. Trust-boundary guards: literal `KNOWN_*` array +
`is*()` predicate (see `routes/workflow-runs.ts:23`).

---

## Pure functions vs side effects

`workflow-engine.ts` is the sole state writer; it is by definition not pure.
Everything else should default to pure:

- `gate-engine.ts` decisions are pure: take inputs, return a `GateRun` shape.
  Persistence is `recordGateRun()` in `workflow-engine.ts`.
- `router.ts:recommend()` is pure: `RouterInput → RouterRecommendation`. The
  one DB read it does (`store.knowledgeArtifacts.byProject`) is read-only and
  flagged in the header comment as the reason it lives api-side.
- `reports.ts:generateCompletionReport()` reads from the store but does not
  write.

Side effects belong in:

- `routes/*.ts` (HTTP boundary)
- `workflow-engine.ts` / `promote.ts` (DB writes)
- `promote-file.ts` (filesystem writes; see `database-guidelines.md` § V2 P1-1
  dual-write for the stage-then-finalize protocol)

A pure function in the wrong place is fine — it just means the test surface
gets a little wider. A side effect in the wrong place is a bug.

---

## Transaction boundaries

`db.transaction(() => { ... })` in `bun:sqlite` is **synchronous**. The
callback must not contain `await`. See `database-guidelines.md` § V2 P1-1 for
the Stage-then-Finalize pattern that handles this for filesystem writes.

Use a transaction whenever two or more rows must commit together for an
invariant. Examples in this codebase:

- Knowledge promote: insert `knowledge_artifacts` head row + UPSERT entity
  table head pointer (see `apps/api/src/promote.ts`).
- Workflow run creation + initial audit row + first step row.

Don't use a transaction for read-only sequences. Don't span a transaction
across IO. Don't return a Promise from inside the callback.

---

## Type safety

- Body parsing always casts to a typed shape with `as { ... }`. Never leave
  `body` as `any`.
- After parsing, validate every field that crosses a TS union — see
  `error-handling.md` § Trust-boundary type guards.
- Prefer `as const satisfies readonly T[]` over plain `T[]` for literal arrays
  used in trust-boundary guards (gives both narrowness and exhaustiveness).
- Don't use `// @ts-expect-error` to silence a real signature mismatch. Fix
  the caller or the signature.

---

## Anti-patterns this team has hit

### 1. State writer drift

> Reference: archived task `05-04-v2-dual-write-pipeline`, the V2 P1-1
> dual-write design.

Original V1 had multiple places writing workflow state. P0/P1 work explicitly
reorganized so `workflow-engine.ts` is the sole writer. **Do not add a new
top-level service that writes lifecycle state without updating that
invariant** — if you genuinely need a new mutation surface, extend the engine
or add an explicit module-level comment that it's a deliberate exception (the
engine header should be updated to point at it).

### 2. PK shape change without ON CONFLICT update

> Reference: archived task `05-04-v2-entity-tables-bootstrap`.

When introducing the entity tables (`requirements`, `designs`) the migration
used a composite PK `(project_id, id)`. The `database-guidelines.md` §
Common Mistakes captures the symptom: forgetting to update the matching
`ON CONFLICT(project_id, id)` clause in the UPSERT silently breaks the write.
Always grep for every `ON CONFLICT(...)` referencing a renamed PK and update
them together.

### 3. Treating runner errors as API health problems

When the runner can't run Claude Code (current open issue
`coordinator-fallback-pauses-concrete-request`), it's tempting to make the
API return 5xx. Don't. The API's job is to receive and persist the runner's
event ("agent_task failed with reason X"); the run is recorded as failed,
the HTTP layer stays 200/201. Runner failure is a runtime-level event, not
an API-level error.

---

## Forbidden patterns

- **`any` to silence type errors.** If you can't express the shape, model it.
- **Cross-module `import` cycles.** Routes import engine; engine imports
  store and types. Never the reverse.
- **Mutating the `store` Maps in tests without resetting.** Use a fresh DB
  per test file or per test (depending on isolation needs).
- **`process.exit(...)` in api code.** That's runner-CLI behavior. The api
  process is supervised; let exceptions propagate.
