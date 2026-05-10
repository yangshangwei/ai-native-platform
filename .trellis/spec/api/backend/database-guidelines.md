# Database Guidelines

> Database patterns and conventions for `apps/api`.

---

## Overview

This project uses **bun:sqlite** (single-file SQLite via Bun's built-in driver). The DB lives at `process.env.AINP_DB_PATH ?? ~/.ai-native/ainp.sqlite`.

Two PRAGMAs are set unconditionally at module load (see `apps/api/src/store/db.ts:15-16`):

- `PRAGMA journal_mode = WAL` — concurrent readers + single writer
- `PRAGMA foreign_keys = ON` — FK constraints are enforced (Bun defaults to OFF)

The `db` instance is a singleton exported from `apps/api/src/store/db.ts`. The `store` module (`apps/api/src/store/store.ts`) wraps it with typed CRUD modules.

---

## Query Patterns

### Read

```ts
const r = db
  .prepare('SELECT * FROM requirements WHERE project_id = ? AND id = ?')
  .get(projectId, id) as RequirementEntityRow | null;
return r ? rowToRequirementEntity(r) : undefined;
```

### Write

Plain INSERT via the `insertRow(table, row)` helper (`store.ts:68`) which accepts a `Record<string, unknown>` keyed by snake_case column name and binds positional placeholders.

UPSERT uses raw SQL with `ON CONFLICT(<conflict-target>) DO UPDATE SET ...`:

```ts
db.prepare(
  `INSERT INTO requirements (id, project_id, status, ...)
   VALUES (?, ?, ?, ...)
   ON CONFLICT(project_id, id) DO UPDATE SET
     status = excluded.status,
     current_version = excluded.current_version,
     updated_at = excluded.updated_at`,
).run(...);
```

The conflict target **must** match the table's PRIMARY KEY exactly; for composite PKs, list both columns.

### Transactions

```ts
const txn = db.transaction(() => {
  // sequential operations
});
txn();
```

Any exception inside the callback rolls back the entire transaction. Use this for multi-statement invariants (e.g. `INSERT knowledge_artifact + UPSERT entity head` in V2 promote — see `apps/api/src/promote.ts`).

---

## Migrations

### Pattern

Append SQL strings to the `MIGRATIONS` array in `apps/api/src/store/db.ts`. Each entry is run unconditionally on import via `for (const sql of MIGRATIONS) runSql(sql)`. To stay idempotent:

- Tables: `CREATE TABLE IF NOT EXISTS ...`
- Indexes: `CREATE INDEX IF NOT EXISTS ...`
- Adding a column to an existing table: write a column-existence check + `ALTER TABLE ... ADD COLUMN ...` (see the block starting around `db.ts:287` for the precedent — `columnNames(table)` Set check).

### V1-compatible defaults

Adding a NOT NULL column to a table with existing rows requires a default. Use `DEFAULT 'value'` in the ALTER. If no sensible default exists, reconsider the migration.

### Schema changes that affect existing data

This project's policy (see V2 P0-2 Q4=4-B) is **idempotent migration + no automatic backfill**. New tables come up empty; data accrues via the live write path. If a migration absolutely needs to populate rows, write a separate admin command, not inline in the migration loop.

### Rebuilding a table to relax a NOT NULL constraint

SQLite cannot `ALTER COLUMN` to change nullability. When an existing table must relax a `NOT NULL` column (for example `agent_events.workflow_run_id` became nullable when pre-run `workflow_request_id` channels were introduced), use an idempotent rebuild migration:

1. Inspect `PRAGMA table_info(<table>)` and rebuild only when the old constraint is present.
2. Create `<table>__rebuild` with the full target schema.
3. `INSERT ... SELECT ...` existing rows, supplying `NULL` / defaults for new nullable columns.
4. Drop the old table and rename the rebuild table.
5. Recreate indexes with `CREATE INDEX IF NOT EXISTS`.

Do not rely on unconditional rebuilds; dev machines and tests may import the DB module many times.

---

## Naming Conventions

| What | Convention | Example |
|---|---|---|
| Table | `snake_case` plural | `knowledge_artifacts`, `workflow_runs` |
| Column | `snake_case` | `project_id`, `current_artifact_id` |
| Index | `idx_<table>_<column(s)>` | `idx_designs_ref_req` |
| TS field | `camelCase` | `projectId`, `currentArtifactId` |
| TS interface for row | `<Name>Row` | `RequirementEntityRow` |
| TS interface for domain | `<Name>` | `RequirementEntity` |

Always provide a `rowTo<Name>` mapper to bridge snake_case → camelCase. Never expose raw rows to consumers.

---

## Foreign Keys (V2 P0-2 convention — R18)

### Rule

> **Declare FK constraints only on product-core relationships. Use bare TEXT + application-layer transactions for auxiliary pointers.**

### What counts as "product-core"

Relationships that the product or downstream verifiers (e.g. P3-1 `traceability_gate`) **require** to be machine-traceable. Examples:

- ✅ `designs.ref_req → requirements.id` — the V2 § 3.6 REQ↔DSN traceability invariant. Strong FK with `ON DELETE RESTRICT`. Composite when project-scoped: `(project_id, ref_req) → (project_id, id)`.

### What does NOT need a FK

Pointers that are upheld trivially by an in-process transaction (the writer just inserted the target row in the same `db.transaction(...)` block). Examples:

- ❌ `requirements.current_artifact_id` / `designs.current_artifact_id` → `knowledge_artifacts.id`. The promote transaction inserts the new `knowledge_artifacts` row in step 6a and upserts the entity head pointing at that fresh id in step 6b. The DB FK adds no safety; it would just block ad-hoc cleanup of the immutable history table.

### Why this rule

Adding FK constraints non-uniformly is fine if the rule is explicit. The danger is FK creep — a reviewer adds an "obvious" FK for a non-core relationship, future tests trip on cleanup ordering, and over time the cost of FKs makes the team reluctant to use them even where they matter. Stating the rule up front (and refusing to add FKs without a product-core justification) keeps the FK signal strong.

When introducing a new entity table in a future PR, ask: does any product feature *require* this relationship to be DB-enforced? If yes, FK. If no, app-layer.

---

## V2 P0-2 entity tables — upgrade semantics (R23)

The migration that adds `requirements` / `designs` (PR2 of `05-04-v2-entity-tables-bootstrap`) does **not** backfill existing `knowledge_artifacts.entity_id` rows into the new entity tables.

**Practical consequence**: any REQ-### / DSN-### that was promoted before P0-2 went live (PR3 of `05-04-v2-artifact-kind-expansion`) will continue to be reachable via `knowledgeArtifacts.latestByEntityId(...)`, but it will not appear in `requirements.byProject(...)` or `designs.byProject(...)` until someone re-promotes that entity.

**To backfill manually**: trigger a fresh promote of the same entity_id. The API's max+1 logic preserves version continuity, so the entity head row created during this promote will have `current_version = max(existing) + 1` — no gaps, no number reuse.

A future task may add a CLI / admin endpoint to bulk-reconcile `knowledge_artifacts.entity_id` rows into entity heads. Until then, manual promote is the supported path.

---

## V2 P1-1 dual-write — files as source of truth

V2 § 3.1 holds the entity *files* on disk as the source of truth and the DB rows as an index/relations mirror. P1-1 (`05-04-v2-dual-write-pipeline`) is the first task to honor this rule: every successful `promoteDraftInTransaction` call writes a markdown file alongside the DB transaction.

### File layout

```
<project.localPath>/
  codestable/
    requirements/
      REQ-001.md
      REQ-002.md
    designs/
      DSN-001.md
```

- One top-level `codestable/` directory per project working tree (constant `CODESTABLE_DIR_NAME` in `apps/api/src/promote-file.ts`)
- One subdirectory per entity kind in plural form (`ENTITY_KIND_DIR` map: `requirement → requirements`, `design → designs`)
- One file per entity, named `<entity-id>.md`. The entity_id MUST satisfy `ENTITY_ID_PATTERN` (`^(REQ|DSN)-\d{1,6}$`). Path safety is enforced before any FS operation (R20).

Future entity kinds (architecture / roadmap / decision / lesson / pattern / explore / dev_guide / api_doc) will get their own plural subdirectory once their entity tables exist (P0-2.5 / P1-1.5). Add the mapping to `ENTITY_KIND_DIR` and extend `ENTITY_ID_PATTERN` (or split into per-kind regexes) — keep the path-stable convention.

### Frontmatter schema

```yaml
---
entity_id: REQ-001          # PK column; matches ENTITY_ID_PATTERN
kind: requirement           # 'requirement' | 'design'
status: accepted            # P1-1 only writes 'accepted'
version: 1                  # integer; tracks knowledge_artifacts.version
updated_at: '2026-05-04T13:00:00Z'   # ISO 8601, single-quoted (YAML colon escape)
knowledge_artifact_id: kart-abc      # FK-style pointer at the head row
ref_req: REQ-042            # design only — DB strong FK target
---
```

- 6 fields are mandatory for every entity (7 for designs).
- The renderer (`renderFrontmatterBlock` in `apps/api/src/promote-file.ts`) emits keys in stable order so files diff cleanly on re-promote.
- Body following the frontmatter is the verbatim `draftText` from the `PromoteRequest` (no parsing, no merging with the user's own frontmatter — see PRD R17 / R18).

### Write protocol — Stage-then-Finalize

The bun:sqlite transaction primitive is synchronous; filesystem ops are async. We split the work into three phases (see `apps/api/src/promote.ts:promoteDraftInTransaction`):

1. **Stage (pre-tx, async)** — `await ensureCodestableDir(localPath, kind)`. Validates project exists, mkdir -p the entity-kind directory. Any IO error here aborts before the DB tx starts (fail-fast).
2. **Tx (sync)** — the original 6 DB steps. Decides the final `entityId` (frontmatter hint OR project-scoped max+1) and `version`.
3. **Finalize (post-tx, async)** — `await writeEntityFile({...})`. Renders frontmatter with the FINAL values from the tx and writes via tmp file + rename for atomicity.

### Failure semantics

| Failure stage | Effect on DB | Effect on FS | Caller observation |
|---|---|---|---|
| Project not found (pre-tx) | tx never starts | nothing written | 400 KnowledgeArtifactValidationError |
| `ensureCodestableDir` fails (pre-tx, e.g. ENOENT / permission) | tx never starts | nothing written | propagates as 500 |
| DB tx fails (FK / UNIQUE / inside-tx error) | rolled back | nothing written | propagates as 409 / 500 |
| `writeEntityFile` fails (post-tx, e.g. disk full at rename) | committed | partial / no file | error logged, 201 returned |
| Path-unsafe `entityId` (post-tx) | committed | nothing written | warning logged, 201 returned |

The post-tx failure paths leave the DB ahead of the filesystem. Recovery is intentionally manual in MVP (P1-1 Q5 = no auto-drift-scan); future tasks may add a `rebuild-files-from-db` admin command.

### git working tree implications

Per P1-1 Q4, promote does **NOT** auto-commit. The newly-written `codestable/<...>.md` file is left in the project's git working tree as an unstaged change. Users decide when to `git add codestable/ && git commit`. This is intentional:

- Users keep full control of their commit history
- AI never spam-commits during long workflows
- Entity files naturally pair with related code changes in the user's PR

`/trellis:finish-work` and similar tools that demand a clean working tree should treat `codestable/` like `.trellis/` — that is, be aware that V2 promote naturally leaves these paths dirty.

### Race-window note

Two concurrent promotes of the same kind without explicit entity_ids both extract a max+1 guess outside the tx, but the SQLite write lock in step 2 serializes them. The losing tx re-runs max+1 inside its own scope and gets a fresh number. The file path computed inside the post-tx finalize step uses the FINAL entity_id, so both promotes end up with distinct files. If both happen to target the same entity_id (concurrent re-promote of an explicit REQ-001), the rename is a last-writer-wins atomic swap; readers always see one consistent file.

---

## Common Mistakes

- **Using a single-column PK when you need project-scoped uniqueness.** SQLite enforces PK globally; `id TEXT PRIMARY KEY` makes `id` unique across all projects. For project-scoped namespaces (REQ-### / DSN-###), use a composite PK `PRIMARY KEY (project_id, id)` and update the matching `ON CONFLICT(project_id, id)` clause in any UPSERT.
- **Forgetting to update the `ON CONFLICT` target after a PK change.** SQLite silently treats a non-matching conflict target as "no UPSERT", inserting a duplicate or failing on the unique constraint instead of updating the existing row.
- **Adding a FK without checking that `PRAGMA foreign_keys = ON` is set on the connection actually used by tests.** This project sets it globally on the `db` singleton, but custom DB connections in tests need to set it themselves.
- **Reading a row by `id` only when the schema is project-scoped.** Always include `project_id = ?` in the WHERE clause when querying entity tables.
- **Trying to do filesystem ops inside `db.transaction(() => ...)`.** bun:sqlite's transaction body must be synchronous; any `await` on `fs/promises` will not be awaited in the way the developer expects (the tx commits before the IO finishes). For dual-write, do FS work either fully BEFORE the tx (mkdir / pre-stage) or fully AFTER (atomic rename / write).
- **Forgetting that post-tx file write failures do not roll back the DB.** Per V2 P1-1 Q3, the file is the source of truth in theory, but in MVP the DB is what's actually written first; a post-tx file write failure leaves the DB ahead. Always log with the `knowledge_artifact_id` so ops can reconcile manually.
