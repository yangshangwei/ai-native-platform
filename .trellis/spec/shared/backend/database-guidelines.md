# Database Guidelines

> Persistence rules for `packages/shared/`.

---

## TL;DR

**`packages/shared/` has no database access. Ever.** No SQLite import. No
SQL strings. No connection. The shared package is consumed by api, runner,
AND web — the web build (Vite) would break the moment a `bun:sqlite` import
appeared.

Shared defines the **shapes** that the database stores, but it doesn't
connect to a database itself.

---

## What shared provides

### Domain types that mirror DB rows

Examples in `packages/shared/src/types/`:

- `Project` — mirrors the `projects` table (camelCase fields).
- `WorkflowRun` — mirrors `workflow_runs`.
- `KnowledgeArtifact` — mirrors `knowledge_artifacts`.
- `AgentTask`, `AgentResult`, `AgentStreamEvent`, `CommandRun`, `BuildRun`,
  `TestRun`, `GateRun`, `Artifact`, `RequestMessage`, `RequirementEntity`,
  `DesignEntity`.

These are pure TS interfaces. They don't carry behavior. The api's
`store/store.ts` owns the row ↔ domain mapping (`rowToProject`, etc.); shared
just declares the domain shape.

### Discriminator unions and guards

For fields that come back from JSON parsing or HTTP bodies and need narrow
runtime validation:

- `types/agent.ts:isProjectAgentBackendKind(value)` — narrow to
  `'claude_code' | 'codex'`.
- `types/workflow.ts:FlowId` (union); the api owns the trust-boundary
  guard `isFlowId` (in `routes/workflow-runs.ts`) but the union itself is
  declared once here.

### Constants the schema depends on

- `utils/whitelist.ts:COMMAND_WHITELIST` — the 8 regex patterns that the
  api's command-row writer trusts.
- `flows/registry.ts:FLOW_REGISTRY` — the workflow stage shapes that the
  api's `workflow-engine.ts` and the runner's `orchestrator.ts` both index
  by `FlowId`.

---

## What shared MUST NOT do

### No `bun:sqlite` import

```ts
// ❌ NEVER in packages/shared/src/
import { Database } from 'bun:sqlite';
```

The api owns the singleton (`apps/api/src/store/db.ts:9`). Web (Vite/browser)
can't satisfy `bun:sqlite`; importing it from shared would break the web
build.

### No SQL strings

Even as a "shared SQL helpers" module — don't. The shapes are typed; the
queries live next to where the db is. Reason: SQL coupling causes
co-evolution friction, and the api's `store/store.ts` already centralizes
that layer.

### No connection helpers

No `getDb()`, no `withTransaction()`. Those concepts are api-side. Shared
is silent about transactions.

### No row-to-domain mappers

`rowToProject(row)` lives in `apps/api/src/store/store.ts` because the row
shape (snake_case columns from sqlite) is api-private. Shared exports the
target type (`Project`); it doesn't know the source shape.

---

## What if a runner-side cache needs a "row type"?

The runner has no DB access. If you find yourself wanting a "row type" in
shared for a runner cache, you actually want a domain type — and the
runner should call `api.getProject(id)` rather than persisting locally.

Truly local runner caches (e.g., generated project profiles cached in
`~/.ai-native/profiles/`) use file persistence with their own JSON shapes,
not DB rows. Those JSON shapes can live in `apps/runner/src/profile.ts` if
runner-only, or in `packages/shared/src/types/` if a future feature needs
them on the api side too.

---

## Forbidden patterns

- **`import 'bun:sqlite'` anywhere under `packages/shared/src/`.** Breaks
  web build, breaks the architectural layering.
- **Hard-coded SQL fragments / migration strings.** Migrations live in
  `apps/api/src/store/db.ts`'s `MIGRATIONS` array. Shared has no business
  declaring schema.
- **Re-exporting `apps/api/src/store/store`'s `store` singleton.** That
  would let the runner read the api's in-memory state directly, which it
  must not do.
- **Adding a "database row type" suffix (`*Row`) in shared.** Domain types
  only; no row types. If a row mapper is needed, both row type and mapper
  live in `apps/api/src/store/store.ts`.
