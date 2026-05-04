import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, expect, test } from 'vitest';

// Isolate this test's SQLite file. Must be set BEFORE importing the store.
process.env.AINP_DB_PATH = join(
  mkdtempSync(join(tmpdir(), 'ainp-entity-tables-test-')),
  'ainp.sqlite',
);

let store: Awaited<typeof import('../src/store/store')>['store'];
let db: Awaited<typeof import('../src/store/db')>['db'];

beforeAll(async () => {
  ({ store } = await import('../src/store/store'));
  ({ db } = await import('../src/store/db'));
});

const NOW = '2026-05-04T13:00:00Z';
const PROJECT_A = 'proj-entity-test-A';
const PROJECT_B = 'proj-entity-test-B';

// ---------------------------------------------------------------------------
// Migration sanity
// ---------------------------------------------------------------------------

test('migration created `requirements` table with expected columns', () => {
  const cols = (
    db.prepare(`PRAGMA table_info(requirements)`).all() as Array<{ name: string }>
  ).map((c) => c.name);
  expect(cols).toEqual(
    expect.arrayContaining([
      'id',
      'project_id',
      'status',
      'current_version',
      'current_artifact_id',
      'created_at',
      'updated_at',
    ]),
  );
});

test('migration created `designs` table with expected columns including ref_req', () => {
  const cols = (
    db.prepare(`PRAGMA table_info(designs)`).all() as Array<{ name: string }>
  ).map((c) => c.name);
  expect(cols).toEqual(
    expect.arrayContaining([
      'id',
      'project_id',
      'status',
      'current_version',
      'current_artifact_id',
      'ref_req',
      'created_at',
      'updated_at',
    ]),
  );
});

test('migration declared the designs.ref_req → requirements(id) foreign key', () => {
  const fks = db.prepare(`PRAGMA foreign_key_list(designs)`).all() as Array<{
    table: string;
    from: string;
    to: string;
    on_delete: string;
  }>;
  const refReqFk = fks.find((f) => f.from === 'ref_req');
  expect(refReqFk).toBeDefined();
  expect(refReqFk?.table).toBe('requirements');
  expect(refReqFk?.to).toBe('id');
  expect(refReqFk?.on_delete).toBe('RESTRICT');
});

// ---------------------------------------------------------------------------
// requirementEntities CRUD + UNIQUE
// ---------------------------------------------------------------------------

test('requirementEntities.insert + get round-trips', () => {
  store.requirementEntities.insert({
    id: 'REQ-001',
    projectId: PROJECT_A,
    status: 'accepted',
    currentVersion: 1,
    currentArtifactId: 'kn-art-r1',
    createdAt: NOW,
    updatedAt: NOW,
  });
  const got = store.requirementEntities.get(PROJECT_A, 'REQ-001');
  expect(got).toBeDefined();
  expect(got?.currentVersion).toBe(1);
  expect(got?.currentArtifactId).toBe('kn-art-r1');
});

test('requirementEntities.byProject filters by project_id', () => {
  store.requirementEntities.insert({
    id: 'REQ-100',
    projectId: PROJECT_B,
    status: 'accepted',
    currentVersion: 1,
    currentArtifactId: 'kn-art-r-b',
    createdAt: NOW,
    updatedAt: NOW,
  });
  const a = store.requirementEntities.byProject(PROJECT_A);
  const b = store.requirementEntities.byProject(PROJECT_B);
  expect(a.find((r) => r.id === 'REQ-100')).toBeUndefined();
  expect(b.find((r) => r.id === 'REQ-100')).toBeDefined();
});

test('requirementEntities.insert blocks duplicate id (PK + UNIQUE)', () => {
  expect(() =>
    store.requirementEntities.insert({
      id: 'REQ-001', // already exists from earlier test
      projectId: PROJECT_A,
      status: 'accepted',
      currentVersion: 1,
      currentArtifactId: 'kn-art-r1-dup',
      createdAt: NOW,
      updatedAt: NOW,
    }),
  ).toThrow(/UNIQUE|PRIMARY KEY|constraint/i);
});

// ---------------------------------------------------------------------------
// upsertHead semantics
// ---------------------------------------------------------------------------

test('requirementEntities.upsertHead INSERTs first time then UPDATEs (preserving created_at)', () => {
  // First call: INSERT
  const a = store.requirementEntities.upsertHead({
    id: 'REQ-200',
    projectId: PROJECT_A,
    status: 'accepted',
    currentVersion: 1,
    currentArtifactId: 'kn-art-200-v1',
    now: '2026-05-04T13:00:00Z',
  });
  expect(a.currentVersion).toBe(1);
  expect(a.createdAt).toBe('2026-05-04T13:00:00Z');

  // Second call: UPDATE (advance version, change artifact pointer)
  const b = store.requirementEntities.upsertHead({
    id: 'REQ-200',
    projectId: PROJECT_A,
    status: 'accepted',
    currentVersion: 2,
    currentArtifactId: 'kn-art-200-v2',
    now: '2026-05-04T14:00:00Z',
  });
  expect(b.currentVersion).toBe(2);
  expect(b.currentArtifactId).toBe('kn-art-200-v2');
  // created_at MUST be preserved across UPDATE
  expect(b.createdAt).toBe('2026-05-04T13:00:00Z');
  expect(b.updatedAt).toBe('2026-05-04T14:00:00Z');
});

// ---------------------------------------------------------------------------
// designEntities + ref_req strong FK (Q3=3-B)
// ---------------------------------------------------------------------------

test('designEntities.insert succeeds when ref_req points at an existing requirement', () => {
  store.designEntities.insert({
    id: 'DSN-001',
    projectId: PROJECT_A,
    status: 'accepted',
    currentVersion: 1,
    currentArtifactId: 'kn-art-d1',
    refReq: 'REQ-001',
    createdAt: NOW,
    updatedAt: NOW,
  });
  const got = store.designEntities.get(PROJECT_A, 'DSN-001');
  expect(got?.refReq).toBe('REQ-001');
});

test('designEntities.insert with non-existent ref_req is rejected by FK', () => {
  expect(() =>
    store.designEntities.insert({
      id: 'DSN-NOPE',
      projectId: PROJECT_A,
      status: 'accepted',
      currentVersion: 1,
      currentArtifactId: 'kn-art-nope',
      refReq: 'REQ-NONEXIST', // FK violation
      createdAt: NOW,
      updatedAt: NOW,
    }),
  ).toThrow(/FOREIGN KEY/i);
});

test('DELETE requirements row that is referenced by a design is blocked by ON DELETE RESTRICT', () => {
  // REQ-001 is referenced by DSN-001 (inserted in prior test).
  expect(() =>
    db.prepare('DELETE FROM requirements WHERE id = ?').run('REQ-001'),
  ).toThrow(/FOREIGN KEY/i);
  // Sanity: REQ-001 still exists.
  expect(store.requirementEntities.get(PROJECT_A, 'REQ-001')).toBeDefined();
});

test('designEntities.byRefReq finds designs for a requirement', () => {
  // Add a second design pointing at REQ-001 to make this meaningful.
  store.designEntities.insert({
    id: 'DSN-002',
    projectId: PROJECT_A,
    status: 'accepted',
    currentVersion: 1,
    currentArtifactId: 'kn-art-d2',
    refReq: 'REQ-001',
    createdAt: NOW,
    updatedAt: NOW,
  });
  const designs = store.designEntities.byRefReq(PROJECT_A, 'REQ-001');
  expect(designs.map((d) => d.id).sort()).toEqual(['DSN-001', 'DSN-002']);
});

test('designEntities.upsertHead UPDATEs preserving ref_req and created_at', () => {
  const a = store.designEntities.upsertHead({
    id: 'DSN-300',
    projectId: PROJECT_A,
    status: 'accepted',
    currentVersion: 1,
    currentArtifactId: 'kn-art-d300-v1',
    refReq: 'REQ-001',
    now: '2026-05-04T13:00:00Z',
  });
  expect(a.currentVersion).toBe(1);
  expect(a.refReq).toBe('REQ-001');

  const b = store.designEntities.upsertHead({
    id: 'DSN-300',
    projectId: PROJECT_A,
    status: 'accepted',
    currentVersion: 2,
    currentArtifactId: 'kn-art-d300-v2',
    refReq: 'REQ-001',
    now: '2026-05-04T14:00:00Z',
  });
  expect(b.currentVersion).toBe(2);
  expect(b.createdAt).toBe('2026-05-04T13:00:00Z');
  expect(b.updatedAt).toBe('2026-05-04T14:00:00Z');
});

// ---------------------------------------------------------------------------
// Empty-state guarantee (Q4=4-B: no backfill)
// ---------------------------------------------------------------------------

test('migration leaves tables empty for an unused project (no backfill)', () => {
  const fresh = 'proj-untouched-by-promote';
  expect(store.requirementEntities.byProject(fresh)).toEqual([]);
  expect(store.designEntities.byProject(fresh)).toEqual([]);
});
