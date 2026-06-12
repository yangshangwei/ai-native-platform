# Database Guidelines (SQLite)

> Schema migration discipline and connection lifecycle for `apps/api`.
> Established by task `06-12-explicit-versioned-db-migrations-replacing-import-side-effects` (roadmap T4.3).

---

## Overview

The API uses a single `bun:sqlite` database. All schema definition and
evolution lives in **one place**: `apps/api/src/store/db.ts`, as an explicit,
numbered migration list. Import side effects are forbidden — the module does
no IO at import time.

---

## Connection Lifecycle

| Export | Purpose |
|--------|---------|
| `initDb(options?)` | Idempotent explicit initialization. Opens the DB (default: `AINP_DB_PATH` env or `~/.ai-native/ainp.sqlite`), sets `journal_mode=WAL` + `foreign_keys=ON`, applies pending migrations. Repeated calls return the same instance; a conflicting `path` throws. |
| `db` | Lazy singleton proxy. First property access calls `initDb()`. Production code and existing consumers (`store.ts`, `workflow-engine.ts`, `promote.ts`) use this. |
| `closeDb()` | Test helper: closes the singleton so a fresh `initDb` can run. |
| `runMigrations(database)` | Applies pending migrations to an arbitrary connection (used by migration tests). |

**Fail fast at startup**: the production entry point (`apps/api/src/server.ts`)
calls `initDb()` explicitly **before** `Bun.serve`. A broken DB path or a
failing migration must crash the process at boot, not surface as a 500 on the
first request that happens to touch the lazy `db` proxy. Keep this call when
touching the server entry.

**Tests — recommended bootstrap** (instead of mutating `AINP_DB_PATH` before a dynamic import):

```ts
import { initDb } from '../src/store/db';

beforeAll(async () => {
  initDb({ path: join(mkdtempSync(join(tmpdir(), 'my-test-')), 'ainp.sqlite') });
  storeMod = await import('../src/store/store');
});
```

The legacy pattern (`process.env.AINP_DB_PATH = ...` then dynamic import) still
works via the lazy proxy, but new tests should call `initDb({ path })`.

---

## Migration Version Table Contract

```sql
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,  -- contiguous, starting at 1
  name TEXT,                    -- e.g. 'projects-add-source_kind'
  applied_at TEXT               -- ISO timestamp when recorded
);
```

- Every applied migration has exactly one row; rows are never updated or deleted.
- Version 1 is the frozen baseline DDL (full schema as of 2026-06, `IF NOT EXISTS`-idempotent).
- **Baseline takeover**: when opening a legacy DB without `schema_migrations`,
  each migration's `isApplied(db)` probe (PRAGMA-based) detects already-present
  schema; such migrations are *recorded without running `up`*. This is why a
  pre-existing production DB is adopted with zero duplicate-ALTER errors.

---

## How to Add a New Migration

1. Append one entry to `MIGRATIONS` in `apps/api/src/store/db.ts` with the
   **next contiguous version number** and a descriptive `name`
   (`<table>-<verb>-<subject>`).
2. Implement `up(database)` with the plain DDL/DML — no defensive probing
   inside `up`; the runner only calls it when needed.
3. Implement `isApplied(database)`: return `true` iff the schema already
   contains the migration's effect (usually a `hasColumn`/table probe). For
   changes that can never pre-exist (brand-new table not in the baseline),
   `() => false` is correct.
4. If the change is a simple column addition, use the `addColumn(...)` helper.
5. Add/extend tests in `apps/api/test/db-migrations.test.ts` if the migration
   has takeover-sensitive behavior (rebuilds, backfills).

---

## Forbidden Patterns

- **No probe-style ad-hoc ALTERs** outside the `MIGRATIONS` list
  (the old `if (!columns.has('x')) ALTER ...` at module top level). All schema
  changes go through numbered migrations.
- **No IO at import time** in `db.ts` — keep `initDb` the only place that
  opens connections and applies migrations.
- **Never edit or renumber an existing migration** that may have shipped;
  append a new one instead.
- **Do not modify `apps/api/test/fixtures/legacy-db.ts`** — it is a frozen
  historical baseline used as schema-equivalence evidence.

---

**Language**: All documentation should be written in **English**.
