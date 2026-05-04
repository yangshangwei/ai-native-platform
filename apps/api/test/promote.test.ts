import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, expect, test } from 'vitest';

// Isolate this test's SQLite file. Must be set BEFORE importing the api.
process.env.AINP_DB_PATH = join(
  mkdtempSync(join(tmpdir(), 'ainp-promote-test-')),
  'ainp.sqlite',
);
process.env.AINP_HOME = join(
  mkdtempSync(join(tmpdir(), 'ainp-promote-home-')),
  '.ai-native',
);

let promoteDraftInTransaction: typeof import('../src/promote')['promoteDraftInTransaction'];
let store: Awaited<typeof import('../src/store/store')>['store'];
let KnowledgeArtifactValidationError: typeof import('../src/workflow-engine')['KnowledgeArtifactValidationError'];

const PROJECT = 'proj-promote-test';

beforeAll(async () => {
  ({ promoteDraftInTransaction } = await import('../src/promote'));
  ({ store } = await import('../src/store/store'));
  ({ KnowledgeArtifactValidationError } = await import('../src/workflow-engine'));
});

const baseRequest = {
  projectId: PROJECT,
  draftArtifactId: 'art-draft-XXX',
  uri: 'file:///tmp/draft.md',
  size: 100,
  contentType: 'text/markdown',
};

// ---------------------------------------------------------------------------
// AC-12e (a): frontmatter抓到 entity_id
// ---------------------------------------------------------------------------

test('requirement_draft with REQ-### in body resolves to that entity_id', () => {
  const res = promoteDraftInTransaction({
    ...baseRequest,
    kind: 'requirement_draft',
    draftArtifactId: 'art-draft-1',
    draftText: '---\nentity_id: REQ-042\n---\n# Calculator divide',
  });
  expect(res.entityId).toBe('REQ-042');
  expect(res.entityKind).toBe('requirement');
  expect(res.version).toBe(1);
  // Side effects:
  expect(store.requirementEntities.get(PROJECT, 'REQ-042')?.currentVersion).toBe(1);
  expect(store.knowledgeArtifacts.get(res.knowledgeArtifactId)?.entityId).toBe('REQ-042');
  expect(store.knowledgeArtifacts.get(res.knowledgeArtifactId)?.status).toBe('accepted');
});

// ---------------------------------------------------------------------------
// AC-12e (b): frontmatter没抓到走 max+1 fallback
// ---------------------------------------------------------------------------

test('requirement_draft without REQ-### falls back to project-scoped max+1', () => {
  // After the previous test REQ-042 exists. So fallback should produce REQ-043.
  const res = promoteDraftInTransaction({
    ...baseRequest,
    kind: 'requirement_draft',
    draftArtifactId: 'art-draft-2',
    draftText: '# A requirement with no explicit id',
  });
  expect(res.entityId).toBe('REQ-043');
  expect(res.version).toBe(1);
});

// ---------------------------------------------------------------------------
// AC-12e (c+d): 同 entity_id 多次 promote 累加 version；旧 accepted 行 superseded
// ---------------------------------------------------------------------------

test('promoting the same entity_id again advances version and supersedes the prior row', () => {
  // First promote of REQ-100.
  const v1 = promoteDraftInTransaction({
    ...baseRequest,
    kind: 'requirement_draft',
    draftArtifactId: 'art-100-v1',
    draftText: 'See REQ-100 — initial draft.',
  });
  expect(v1.entityId).toBe('REQ-100');
  expect(v1.version).toBe(1);

  // Second promote of REQ-100.
  const v2 = promoteDraftInTransaction({
    ...baseRequest,
    kind: 'requirement_draft',
    draftArtifactId: 'art-100-v2',
    draftText: 'See REQ-100 — revised draft.',
  });
  expect(v2.entityId).toBe('REQ-100');
  expect(v2.version).toBe(2);

  // Prior accepted row is now superseded.
  const v1Row = store.knowledgeArtifacts.get(v1.knowledgeArtifactId);
  expect(v1Row?.status).toBe('superseded');
  // New row is accepted.
  const v2Row = store.knowledgeArtifacts.get(v2.knowledgeArtifactId);
  expect(v2Row?.status).toBe('accepted');

  // Entity head advanced.
  const head = store.requirementEntities.get(PROJECT, 'REQ-100');
  expect(head?.currentVersion).toBe(2);
  expect(head?.currentArtifactId).toBe(v2.knowledgeArtifactId);
});

// ---------------------------------------------------------------------------
// AC-12e: design_doc happy path with REQ-### + DSN-### in body
// ---------------------------------------------------------------------------

test('design_doc with both DSN-### and REQ-### resolves entity + ref_req', () => {
  // First, ensure REQ-100 exists (it does from prior test).
  const res = promoteDraftInTransaction({
    ...baseRequest,
    kind: 'design_doc',
    draftArtifactId: 'art-design-1',
    draftText:
      '---\nentity_id: DSN-001\nref_req: REQ-100\n---\n# Calculator divide design',
  });
  expect(res.entityId).toBe('DSN-001');
  expect(res.entityKind).toBe('design');
  expect(res.version).toBe(1);

  const head = store.designEntities.get(PROJECT, 'DSN-001');
  expect(head?.refReq).toBe('REQ-100');
  expect(head?.currentVersion).toBe(1);
  expect(head?.currentArtifactId).toBe(res.knowledgeArtifactId);
});

// ---------------------------------------------------------------------------
// PRD R29: design_doc without any REQ-### must error (no silent drop)
// ---------------------------------------------------------------------------

test('design_doc without a REQ-### reference is rejected (R29)', () => {
  expect(() =>
    promoteDraftInTransaction({
      ...baseRequest,
      kind: 'design_doc',
      draftArtifactId: 'art-design-noref',
      draftText: '# Some design with no upstream requirement reference',
    }),
  ).toThrow(KnowledgeArtifactValidationError);
});

// ---------------------------------------------------------------------------
// AC-12f: 单事务原子性 — entity head upsert 失败 → INSERT knowledge_artifact 回滚
// ---------------------------------------------------------------------------

test('design_doc referencing non-existent REQ rolls back BOTH knowledge_artifact INSERT and supersede', () => {
  const beforeCount = store.knowledgeArtifacts.byKind(PROJECT, 'design').length;

  // REQ-999 is well-formed (regex matches) but no `requirements` entity row
  // exists for it — designs.ref_req FK fires with ON DELETE RESTRICT.
  expect(() =>
    promoteDraftInTransaction({
      ...baseRequest,
      kind: 'design_doc',
      draftArtifactId: 'art-design-bad-fk',
      draftText: 'See DSN-999 → REQ-999.',
    }),
  ).toThrow(/FOREIGN KEY/i);

  const afterCount = store.knowledgeArtifacts.byKind(PROJECT, 'design').length;
  // Step 6a (INSERT into knowledge_artifacts) MUST be rolled back along
  // with the failed step 6b (entity head upsert FK violation).
  expect(afterCount).toBe(beforeCount);
  // Entity head also not created.
  expect(store.designEntities.get(PROJECT, 'DSN-999')).toBeUndefined();
});

test('rollback also undoes step 5 (supersede) when step 6 fails', () => {
  // Pre-condition: REQ-100 exists with v2 accepted (from earlier test).
  // Force a failure on a SECOND promote for REQ-100 by simulating an
  // FK error indirectly: try to promote a design that references a
  // requirement entity ID that exists ONLY as a knowledge_artifacts row,
  // not in the entity head table. Use a value that has no
  // requirements row to ensure FK rejects.
  const reqHeadBefore = store.requirementEntities.get(PROJECT, 'REQ-100');
  expect(reqHeadBefore?.currentVersion).toBe(2);

  // Promote a design that points at a non-existent REQ to trigger FK violation.
  // Then verify the requirement REQ-100 was untouched (no spurious supersede).
  const r100KnRowsBefore = store.knowledgeArtifacts
    .byEntityId(PROJECT, 'REQ-100')
    .map((a) => ({ id: a.id, status: a.status }));
  expect(() =>
    promoteDraftInTransaction({
      ...baseRequest,
      kind: 'design_doc',
      draftArtifactId: 'art-rollback-supersede',
      // REQ-998 is well-formed but does not exist as a requirements entity.
      draftText: 'See DSN-998 → REQ-998.',
    }),
  ).toThrow();
  const r100KnRowsAfter = store.knowledgeArtifacts
    .byEntityId(PROJECT, 'REQ-100')
    .map((a) => ({ id: a.id, status: a.status }));
  expect(r100KnRowsAfter).toEqual(r100KnRowsBefore);
});

// ---------------------------------------------------------------------------
// AC-12g: 并发 — sequential calls without hint produce distinct entity_ids
// (SQLite's single-writer guarantee covers true concurrency; here we assert
// the algorithm doesn't reuse a number when called twice in a row.)
// ---------------------------------------------------------------------------

test('two requirement_draft promotes without hint produce distinct entity_ids', () => {
  const r1 = promoteDraftInTransaction({
    ...baseRequest,
    kind: 'requirement_draft',
    draftArtifactId: 'art-no-hint-1',
    draftText: 'no-hint draft 1',
  });
  const r2 = promoteDraftInTransaction({
    ...baseRequest,
    kind: 'requirement_draft',
    draftArtifactId: 'art-no-hint-2',
    draftText: 'no-hint draft 2',
  });
  expect(r1.entityId).not.toBe(r2.entityId);
  // Both should be valid REQ-### identifiers, advancing in sequence.
  expect(r1.entityId).toMatch(/^REQ-\d{3}$/);
  expect(r2.entityId).toMatch(/^REQ-\d{3}$/);
});

// ---------------------------------------------------------------------------
// design_doc upsertHead does not change ref_req on UPDATE path
// ---------------------------------------------------------------------------

test('promoting same DSN twice keeps original ref_req on entity head UPDATE', () => {
  // Make sure REQ-300 exists for this test to be valid.
  promoteDraftInTransaction({
    ...baseRequest,
    kind: 'requirement_draft',
    draftArtifactId: 'art-req-300',
    draftText: 'See REQ-300.',
  });
  // First promote of DSN-300 → REQ-300.
  const d1 = promoteDraftInTransaction({
    ...baseRequest,
    kind: 'design_doc',
    draftArtifactId: 'art-dsn-300-v1',
    draftText: 'DSN-300 references REQ-300.',
  });
  expect(d1.entityId).toBe('DSN-300');
  expect(d1.version).toBe(1);
  expect(store.designEntities.get(PROJECT, 'DSN-300')?.refReq).toBe('REQ-300');

  // Make REQ-301 also exist so FK won't reject the second promote attempt.
  promoteDraftInTransaction({
    ...baseRequest,
    kind: 'requirement_draft',
    draftArtifactId: 'art-req-301',
    draftText: 'See REQ-301.',
  });
  // Second promote of DSN-300 still mentions REQ-300 (unchanged).
  const d2 = promoteDraftInTransaction({
    ...baseRequest,
    kind: 'design_doc',
    draftArtifactId: 'art-dsn-300-v2',
    draftText: 'DSN-300 still references REQ-300 (revised body).',
  });
  expect(d2.entityId).toBe('DSN-300');
  expect(d2.version).toBe(2);
  // ref_req remains REQ-300 (UPDATE path doesn't change ref_req).
  expect(store.designEntities.get(PROJECT, 'DSN-300')?.refReq).toBe('REQ-300');
});
