import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, expect, test } from 'vitest';

// Isolate this test's SQLite file. Must be set BEFORE importing the api.
process.env.AINP_DB_PATH = join(
  mkdtempSync(join(tmpdir(), 'ainp-promote-route-test-')),
  'ainp.sqlite',
);
process.env.AINP_HOME = join(
  mkdtempSync(join(tmpdir(), 'ainp-promote-route-home-')),
  '.ai-native',
);

let app: Awaited<typeof import('../src/app')>['app'];

const PROJECT = 'proj-promote-route-test';

beforeAll(async () => {
  ({ app } = await import('../src/app'));
});

async function postPromote(body: Record<string, unknown>): Promise<Response> {
  return app.request('/knowledge-artifacts/promote', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const baseBody = {
  projectId: PROJECT,
  draftArtifactId: 'art-route-1',
  uri: 'file:///tmp/draft.md',
  size: 100,
  contentType: 'text/markdown',
};

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

test('POST /promote requirement_draft with explicit REQ-### returns 201', async () => {
  const res = await postPromote({
    ...baseBody,
    kind: 'requirement_draft',
    draftArtifactId: 'art-route-req-1',
    draftText: '---\nentity_id: REQ-200\n---\n# Calculator divide',
  });
  expect(res.status).toBe(201);
  const json = (await res.json()) as {
    ok: boolean;
    result: {
      knowledgeArtifactId: string;
      entityId: string;
      entityKind: string;
      version: number;
    };
  };
  expect(json.ok).toBe(true);
  expect(json.result.entityId).toBe('REQ-200');
  expect(json.result.entityKind).toBe('requirement');
  expect(json.result.version).toBe(1);
  expect(typeof json.result.knowledgeArtifactId).toBe('string');
});

test('POST /promote design_doc with both DSN-### and REQ-### returns 201', async () => {
  // REQ-200 already exists from prior test; this design references it.
  const res = await postPromote({
    ...baseBody,
    kind: 'design_doc',
    draftArtifactId: 'art-route-design-1',
    draftText: '---\nentity_id: DSN-100\nref_req: REQ-200\n---\n# Divide design',
  });
  expect(res.status).toBe(201);
  const json = (await res.json()) as {
    ok: boolean;
    result: { entityId: string; entityKind: string; version: number };
  };
  expect(json.result.entityId).toBe('DSN-100');
  expect(json.result.entityKind).toBe('design');
  expect(json.result.version).toBe(1);
});

test('POST /promote second time on same entity advances version (full HTTP round-trip)', async () => {
  const res = await postPromote({
    ...baseBody,
    kind: 'requirement_draft',
    draftArtifactId: 'art-route-req-200-v2',
    draftText: 'See REQ-200 — revised body.',
  });
  expect(res.status).toBe(201);
  const json = (await res.json()) as { result: { entityId: string; version: number } };
  expect(json.result.entityId).toBe('REQ-200');
  expect(json.result.version).toBe(2);
});

// ---------------------------------------------------------------------------
// 400 — input validation
// ---------------------------------------------------------------------------

test('POST /promote rejects missing required field', async () => {
  const res = await postPromote({
    // omit projectId
    kind: 'requirement_draft',
    draftArtifactId: 'art-x',
    draftText: 'body',
    uri: 'file:///tmp/x.md',
    size: 1,
    contentType: 'text/markdown',
  });
  expect(res.status).toBe(400);
  const json = (await res.json()) as { error: string };
  expect(json.error).toMatch(/projectId/);
});

test('POST /promote rejects non-promotable kind (e.g. context_pack)', async () => {
  const res = await postPromote({
    ...baseBody,
    kind: 'context_pack',
    draftArtifactId: 'art-bad-kind',
    draftText: 'body',
  });
  expect(res.status).toBe(400);
  const json = (await res.json()) as { error: string };
  expect(json.error).toMatch(/not a promotable draft kind/);
});

test('POST /promote rejects design_doc lacking REQ-### in draftText (R29)', async () => {
  const res = await postPromote({
    ...baseBody,
    kind: 'design_doc',
    draftArtifactId: 'art-design-no-ref',
    draftText: '# A design with no upstream REQ reference at all',
  });
  expect(res.status).toBe(400);
  const json = (await res.json()) as { error: string };
  expect(json.error).toMatch(/REQ-###|reference/i);
});

test('POST /promote rejects negative size', async () => {
  const res = await postPromote({
    ...baseBody,
    kind: 'requirement_draft',
    draftArtifactId: 'art-bad-size',
    draftText: 'See REQ-201',
    size: -1,
  });
  expect(res.status).toBe(400);
  const json = (await res.json()) as { error: string };
  expect(json.error).toMatch(/size/);
});

// ---------------------------------------------------------------------------
// 409 — DB constraint violation (FK refers to non-existent requirement)
// ---------------------------------------------------------------------------

test('POST /promote design_doc → non-existent REQ returns 409 with CONSTRAINT_VIOLATION code', async () => {
  const res = await postPromote({
    ...baseBody,
    kind: 'design_doc',
    draftArtifactId: 'art-design-bad-fk',
    draftText: 'See DSN-999 → REQ-9999.',
  });
  expect(res.status).toBe(409);
  const json = (await res.json()) as { error: string; code: string };
  expect(json.code).toBe('CONSTRAINT_VIOLATION');
  expect(json.error).toMatch(/FOREIGN KEY/i);
});
