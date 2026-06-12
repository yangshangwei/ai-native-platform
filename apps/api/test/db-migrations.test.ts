// Tests for the explicit, versioned migration layer (task 06-12, roadmap
// T4.3). Covers PRD acceptance criteria:
//   #2 schema equivalence: legacy import-side-effect module vs new
//      runMigrations produce identical tables/columns/indexes,
//   #3 baseline takeover of a legacy DB (bookkeeping written, data intact,
//      no duplicate-ALTER errors),
//   #4 idempotence (two consecutive opens), version ordering, and takeover
//      from a pre-rebuild-era DB exercising real ALTER/rebuild paths.
//
// The legacy builder is frozen verbatim in fixtures/legacy-db.ts and executed
// in a subprocess (`bun fixtures/legacy-db.ts`) so its import side effects
// run against an isolated AINP_DB_PATH.
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { expect, test } from 'vitest';
import { MIGRATIONS, closeDb, initDb, runMigrations } from '../src/store/db';

const LEGACY_FIXTURE = new URL('./fixtures/legacy-db.ts', import.meta.url).pathname;

function tmpDbPath(prefix: string): string {
  return join(mkdtempSync(join(tmpdir(), prefix)), 'ainp.sqlite');
}

/** Builds a DB via the frozen legacy module's import side effects. */
function buildLegacyDb(path: string): void {
  const res = spawnSync('bun', [LEGACY_FIXTURE], {
    env: { ...process.env, AINP_DB_PATH: path },
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    throw new Error(`legacy fixture failed (status ${res.status}): ${res.stderr}`);
  }
}

function openMigrated(path: string): Database {
  const database = new Database(path);
  runMigrations(database);
  return database;
}

interface SchemaObject {
  type: string;
  name: string;
  tbl_name: string;
  sql: string | null;
}

/**
 * Full schema dump: every user table/index from sqlite_master plus per-table
 * PRAGMA table_info. `schema_migrations` (the new bookkeeping table) and
 * SQLite-internal objects are excluded; everything else must match exactly.
 */
function schemaDump(database: Database): {
  objects: SchemaObject[];
  columns: Record<string, unknown[]>;
} {
  const objects = (
    database
      .prepare(
        `SELECT type, name, tbl_name, sql FROM sqlite_master
          WHERE name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'
          ORDER BY type, name`,
      )
      .all() as SchemaObject[]
  ).map((o) => ({ ...o, sql: o.sql ? o.sql.replace(/\s+/g, ' ').trim() : null }));
  const columns: Record<string, unknown[]> = {};
  for (const o of objects) {
    if (o.type !== 'table') continue;
    columns[o.name] = database.prepare(`PRAGMA table_info(${o.name})`).all();
  }
  return { objects, columns };
}

function recordedVersions(database: Database): number[] {
  return (
    database
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all() as Array<{ version: number }>
  ).map((r) => r.version);
}

const ALL_VERSIONS = MIGRATIONS.map((m) => m.version).sort((a, b) => a - b);

// ---------------------------------------------------------------------------
// Version ordering
// ---------------------------------------------------------------------------

test('MIGRATIONS versions are unique, contiguous and start at 1', () => {
  expect(ALL_VERSIONS).toEqual(
    Array.from({ length: MIGRATIONS.length }, (_, i) => i + 1),
  );
  expect(new Set(MIGRATIONS.map((m) => m.name)).size).toBe(MIGRATIONS.length);
});

test('fresh DB records every migration in version order', () => {
  const database = openMigrated(tmpDbPath('ainp-mig-fresh-'));
  expect(recordedVersions(database)).toEqual(ALL_VERSIONS);
  database.close();
});

// ---------------------------------------------------------------------------
// PRD #4: idempotence — two consecutive opens of the same file
// ---------------------------------------------------------------------------

test('runMigrations is idempotent across two consecutive opens of the same file', () => {
  const path = tmpDbPath('ainp-mig-idem-');
  const first = openMigrated(path);
  const dumpAfterFirst = schemaDump(first);
  first.close();

  // Second open + migrate must be a pure no-op: no errors, no new
  // bookkeeping rows, identical schema. Run twice on the same connection too.
  const second = openMigrated(path);
  runMigrations(second);
  expect(recordedVersions(second)).toEqual(ALL_VERSIONS);
  expect(schemaDump(second)).toEqual(dumpAfterFirst);
  second.close();
});

// ---------------------------------------------------------------------------
// PRD #2: schema equivalence — legacy builder vs versioned migrations
// ---------------------------------------------------------------------------

test('schema equivalence: legacy import-side-effect DB === fresh versioned-migrations DB', () => {
  const legacyPath = tmpDbPath('ainp-mig-legacy-schema-');
  buildLegacyDb(legacyPath);
  // The legacy fixture is frozen at the takeover era (v21). Migrations
  // appended after the freeze (22/23: projects build-command columns) must
  // be applied to the legacy DB too — convergence means "legacy + pending
  // migrations === fresh full migration run".
  const legacy = openMigrated(legacyPath);
  const legacyDump = schemaDump(legacy);
  legacy.close();

  const fresh = openMigrated(tmpDbPath('ainp-mig-new-schema-'));
  const freshDump = schemaDump(fresh);
  fresh.close();

  // Sanity: the dump actually covers the full schema, not an empty DB.
  const tableNames = legacyDump.objects.filter((o) => o.type === 'table').map((o) => o.name);
  expect(tableNames).toContain('projects');
  expect(tableNames).toContain('agent_events');
  expect(tableNames.length).toBeGreaterThanOrEqual(20);

  // Every table, every column (cid/name/type/notnull/dflt_value/pk) and every
  // index must match between the two build paths.
  expect(freshDump).toEqual(legacyDump);
});

// ---------------------------------------------------------------------------
// PRD #3: baseline takeover of a legacy DB with data
// ---------------------------------------------------------------------------

test('baseline takeover: legacy DB with data gains bookkeeping, keeps data, no duplicate ALTERs', () => {
  const path = tmpDbPath('ainp-mig-takeover-');
  buildLegacyDb(path);

  // Write business data through a plain connection (simulates production use
  // under the old code), and confirm the legacy DB has no version table.
  const before = new Database(path);
  expect(
    before
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'`)
      .get(),
  ).toBeNull();
  before
    .prepare(
      `INSERT INTO projects (id, name, local_path, language, build_tool, default_branch, registered_at)
       VALUES ('proj_takeover', 'takeover', '/tmp/takeover', 'java', 'maven', 'main', '2026-06-12T00:00:00Z')`,
    )
    .run();
  before
    .prepare(
      `INSERT INTO agent_events (id, workflow_request_id, agent_kind, sequence, type, payload_json, ts)
       VALUES ('evt_takeover', 'req_takeover', 'coordinator', 1, 'text', '{}', '2026-06-12T00:00:00Z')`,
    )
    .run();
  before.close();

  // Takeover: every freeze-era migration's isApplied probe must detect the
  // existing schema (a duplicate ALTER would throw "duplicate column name");
  // migrations appended after the legacy freeze (22/23) run their real up()
  // and the result must converge with a fresh versioned-migrations DB.
  const database = openMigrated(path);
  expect(recordedVersions(database)).toEqual(ALL_VERSIONS);
  const fresh = openMigrated(tmpDbPath('ainp-mig-takeover-fresh-'));
  expect(schemaDump(database)).toEqual(schemaDump(fresh));
  fresh.close();

  const project = database
    .prepare(`SELECT id, name, status FROM projects WHERE id = 'proj_takeover'`)
    .get() as { id: string; name: string; status: string };
  expect(project).toMatchObject({ id: 'proj_takeover', name: 'takeover', status: 'active' });
  const event = database
    .prepare(`SELECT id, workflow_request_id FROM agent_events WHERE id = 'evt_takeover'`)
    .get();
  expect(event).toMatchObject({ id: 'evt_takeover', workflow_request_id: 'req_takeover' });
  database.close();
});

test('takeover of a pre-rebuild-era DB runs real ALTER + agent_events rebuild and preserves rows', () => {
  // Hand-build a DB from the era before agent_events.workflow_request_id
  // existed and while workflow_run_id was still NOT NULL. This exercises the
  // actual up() paths (column ALTER + table rebuild) during takeover, not
  // just the record-only branch.
  const path = tmpDbPath('ainp-mig-oldera-');
  const old = new Database(path);
  old
    .prepare(
      `CREATE TABLE agent_events (
         id TEXT PRIMARY KEY,
         workflow_run_id TEXT NOT NULL,
         step_run_id TEXT,
         agent_kind TEXT NOT NULL,
         sequence INTEGER NOT NULL,
         type TEXT NOT NULL,
         payload_json TEXT NOT NULL,
         text TEXT,
         ts TEXT NOT NULL
       )`,
    )
    .run();
  old
    .prepare(
      `INSERT INTO agent_events (id, workflow_run_id, agent_kind, sequence, type, payload_json, ts)
       VALUES ('evt_old', 'run_old', 'claude', 7, 'text', '{"a":1}', '2026-01-01T00:00:00Z')`,
    )
    .run();
  old.close();

  const database = openMigrated(path);
  expect(recordedVersions(database)).toEqual(ALL_VERSIONS);

  const info = database.prepare('PRAGMA table_info(agent_events)').all() as Array<{
    name: string;
    notnull: number;
  }>;
  expect(info.find((c) => c.name === 'workflow_run_id')?.notnull).toBe(0);
  expect(info.some((c) => c.name === 'workflow_request_id')).toBe(true);
  expect(
    database.prepare(`SELECT id, workflow_run_id, sequence FROM agent_events WHERE id = 'evt_old'`).get(),
  ).toMatchObject({ id: 'evt_old', workflow_run_id: 'run_old', sequence: 7 });
  database.close();
});

// ---------------------------------------------------------------------------
// initDb lifecycle
// ---------------------------------------------------------------------------

test('initDb is idempotent and rejects a conflicting path while open', () => {
  // This file never touched the singleton before this test (all tests above
  // use explicit connections), so initDb opens fresh here.
  const path = tmpDbPath('ainp-mig-initdb-');
  const first = initDb({ path });
  expect(initDb({ path })).toBe(first);
  expect(initDb()).toBe(first);
  expect(() => initDb({ path: '/tmp/other-ainp.sqlite' })).toThrow(/already initialized/);
  expect(recordedVersions(first)).toEqual(ALL_VERSIONS);
  closeDb();
});
