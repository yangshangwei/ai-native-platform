import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, expect, test } from 'vitest';

process.env.AINP_DB_PATH = join(
  mkdtempSync(join(tmpdir(), 'ainp-knowledge-route-test-')),
  'ainp.sqlite',
);
process.env.AINP_HOME = join(
  mkdtempSync(join(tmpdir(), 'ainp-knowledge-route-home-')),
  '.ai-native',
);

let app: Awaited<typeof import('../src/app')>['app'];
const PROJECT_ID = 'proj-test-knowledge';

beforeAll(async () => {
  ({ app } = await import('../src/app'));
});

async function postKnowledge(body: Record<string, unknown>): Promise<Response> {
  return app.request(`/knowledge-artifacts/projects/${PROJECT_ID}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

test('POST creates a requirement entity row with default status/version', async () => {
  const res = await postKnowledge({
    kind: 'requirement',
    uri: 'mem://req-001',
    size: 42,
    contentType: 'text/markdown',
    entityId: 'REQ-001',
  });
  expect(res.status).toBe(201);
  const json = (await res.json()) as { ok: boolean; artifact: Record<string, unknown> };
  expect(json.ok).toBe(true);
  expect(json.artifact.kind).toBe('requirement');
  expect(json.artifact.status).toBe('draft');
  expect(json.artifact.version).toBe(1);
  expect(json.artifact.entityId).toBe('REQ-001');
  expect(json.artifact.projectId).toBe(PROJECT_ID);
  expect((json.artifact.metadata as Record<string, unknown>).knowledgeClass).toBe('recovered');
});

test('POST accepts a lesson with valid subtype', async () => {
  const res = await postKnowledge({
    kind: 'lesson',
    uri: 'mem://lesson-001',
    size: 100,
    contentType: 'text/markdown',
    subtype: 'pitfall',
    metadata: { severity: 'high' },
  });
  expect(res.status).toBe(201);
  const json = (await res.json()) as { ok: boolean; artifact: Record<string, unknown> };
  expect(json.artifact.subtype).toBe('pitfall');
  expect((json.artifact.metadata as Record<string, unknown>).severity).toBe('high');
});

test('POST defaults accepted knowledge metadata to confirmed and allows valid overrides', async () => {
  const confirmed = await postKnowledge({
    kind: 'decision',
    uri: 'mem://accepted-default',
    size: 50,
    contentType: 'text/markdown',
    status: 'accepted',
  });
  expect(confirmed.status).toBe(201);
  const confirmedJson = (await confirmed.json()) as { artifact: { metadata: Record<string, unknown> } };
  expect(confirmedJson.artifact.metadata).toMatchObject({
    knowledgeClass: 'confirmed',
    trustLevel: 'accepted_knowledge',
    freshness: 'possibly_stale',
    confidence: 0.9,
  });
  expect(confirmedJson.artifact.metadata.sourceRefs).toEqual(
    expect.arrayContaining(['knowledge:accepted', 'uri:mem://accepted-default']),
  );

  const seedOverride = await postKnowledge({
    kind: 'decision',
    uri: 'mem://accepted-seed',
    size: 50,
    contentType: 'text/markdown',
    status: 'accepted',
    subtype: 'constraint',
    metadata: {
      knowledgeClass: 'seed',
      trustLevel: 'summary',
      freshness: 'current',
      sourceRefs: ['seed:import'],
      confidence: 0.55,
    },
  });
  expect(seedOverride.status).toBe(201);
  const seedJson = (await seedOverride.json()) as { artifact: { metadata: Record<string, unknown> } };
  expect(seedJson.artifact.metadata).toMatchObject({
    knowledgeClass: 'seed',
    trustLevel: 'summary',
    freshness: 'current',
    sourceRefs: ['seed:import'],
    confidence: 0.55,
  });
});

test('POST rejects invalid standardized knowledge metadata', async () => {
  const res = await postKnowledge({
    kind: 'decision',
    uri: 'mem://bad-metadata',
    size: 50,
    contentType: 'text/markdown',
    subtype: 'constraint',
    metadata: { knowledgeClass: 'trusted', confidence: 5 },
  });
  expect(res.status).toBe(400);
  const json = (await res.json()) as { error: string; field: string };
  expect(json.field).toBe('metadata');
  expect(json.error).toContain('metadata.knowledgeClass');
  expect(json.error).toContain('metadata.confidence');
});

test('POST rejects invalid knowledge status at the write boundary', async () => {
  const res = await postKnowledge({
    kind: 'decision',
    uri: 'mem://bad-status',
    size: 50,
    contentType: 'text/markdown',
    status: 'archived',
  });
  expect(res.status).toBe(400);
  const json = (await res.json()) as { error: string };
  expect(json.error).toContain('invalid status');
});

test('seed knowledge convenience endpoint creates and reads seed metadata', async () => {
  const created = await app.request(`/knowledge-artifacts/projects/${PROJECT_ID}/seed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'Initial architecture constraints',
      text: 'Keep ContextPack renderer provider-neutral.',
      sourceRefs: ['seed:api-test'],
    }),
  });
  expect(created.status).toBe(201);
  const json = (await created.json()) as { artifact: { status: string; metadata: Record<string, unknown> } };
  expect(json.artifact.status).toBe('accepted');
  expect(json.artifact.metadata).toMatchObject({
    title: 'Initial architecture constraints',
    text: 'Keep ContextPack renderer provider-neutral.',
    knowledgeClass: 'seed',
    trustLevel: 'summary',
    freshness: 'current',
    sourceRefs: ['seed:api-test'],
    confidence: 0.6,
  });

  const read = await app.request(`/knowledge-artifacts/projects/${PROJECT_ID}/seed`);
  expect(read.status).toBe(200);
  const readJson = (await read.json()) as { artifacts: Array<{ metadata: Record<string, unknown> }> };
  expect(readJson.artifacts.some((a) => a.metadata.title === 'Initial architecture constraints')).toBe(true);
});

// ---------------------------------------------------------------------------
// Validation: kind / subtype rejection
// ---------------------------------------------------------------------------

test('POST rejects a per-run kind (confused-tier protection)', async () => {
  const res = await postKnowledge({
    kind: 'requirement_draft', // V1 per-run kind, NOT a knowledge kind
    uri: 'mem://invalid',
    size: 10,
    contentType: 'text/markdown',
  });
  expect(res.status).toBe(400);
  const json = (await res.json()) as { error: string };
  expect(json.error).toContain('not a KnowledgeArtifactKind');
});

test('POST rejects a totally unknown kind', async () => {
  const res = await postKnowledge({
    kind: 'banana',
    uri: 'mem://invalid',
    size: 10,
    contentType: 'text/markdown',
  });
  expect(res.status).toBe(400);
});

test('POST rejects an illegal subtype for the kind', async () => {
  const res = await postKnowledge({
    kind: 'lesson',
    uri: 'mem://lesson-bad',
    size: 10,
    contentType: 'text/markdown',
    subtype: 'totally-invalid',
  });
  expect(res.status).toBe(400);
  const json = (await res.json()) as { error: string; field: string };
  expect(json.field).toBe('subtype');
});

test('POST rejects a subtype on a kind that does not accept any', async () => {
  const res = await postKnowledge({
    kind: 'requirement',
    uri: 'mem://req-bad-subtype',
    size: 10,
    contentType: 'text/markdown',
    subtype: 'anything',
  });
  expect(res.status).toBe(400);
});

// ---------------------------------------------------------------------------
// Read endpoints
// ---------------------------------------------------------------------------

test('GET /projects/:id lists all knowledge artifacts for the project', async () => {
  const res = await app.request(`/knowledge-artifacts/projects/${PROJECT_ID}`);
  expect(res.status).toBe(200);
  const json = (await res.json()) as { ok: boolean; artifacts: unknown[] };
  expect(json.ok).toBe(true);
  // From the happy-path tests above we expect at least: REQ-001 + lesson.
  expect(json.artifacts.length).toBeGreaterThanOrEqual(2);
});

test('GET /projects/:id?kind=lesson narrows to a single kind', async () => {
  const res = await app.request(
    `/knowledge-artifacts/projects/${PROJECT_ID}?kind=lesson`,
  );
  expect(res.status).toBe(200);
  const json = (await res.json()) as { ok: boolean; artifacts: Array<{ kind: string }> };
  for (const a of json.artifacts) expect(a.kind).toBe('lesson');
});

test('GET /projects/:id?knowledgeClass=seed narrows by standardized metadata', async () => {
  const res = await app.request(
    `/knowledge-artifacts/projects/${PROJECT_ID}?knowledgeClass=seed`,
  );
  expect(res.status).toBe(200);
  const json = (await res.json()) as { ok: boolean; artifacts: Array<{ metadata: Record<string, unknown> }> };
  expect(json.ok).toBe(true);
  expect(json.artifacts.length).toBeGreaterThan(0);
  for (const a of json.artifacts) expect(a.metadata.knowledgeClass).toBe('seed');
});

test('GET ?knowledgeClass=invalid returns 400', async () => {
  const res = await app.request(
    `/knowledge-artifacts/projects/${PROJECT_ID}?knowledgeClass=banana`,
  );
  expect(res.status).toBe(400);
});

test('GET ?kind=invalid returns 400', async () => {
  const res = await app.request(
    `/knowledge-artifacts/projects/${PROJECT_ID}?kind=banana`,
  );
  expect(res.status).toBe(400);
});

test('GET /:id returns a single artifact', async () => {
  // First create one we can fetch deterministically
  const created = (await (
    await postKnowledge({
      kind: 'decision',
      uri: 'mem://dec-001',
      size: 50,
      contentType: 'text/markdown',
      entityId: 'ADR-001',
      subtype: 'tech_stack',
    })
  ).json()) as { artifact: { id: string } };
  const fetched = await app.request(`/knowledge-artifacts/${created.artifact.id}`);
  expect(fetched.status).toBe(200);
  const j = (await fetched.json()) as { ok: boolean; artifact: { id: string; entityId: string } };
  expect(j.artifact.id).toBe(created.artifact.id);
  expect(j.artifact.entityId).toBe('ADR-001');
});

test('GET /:id returns 404 for unknown id', async () => {
  const res = await app.request('/knowledge-artifacts/does-not-exist');
  expect(res.status).toBe(404);
});

// ---------------------------------------------------------------------------
// Versioning via entityId
// ---------------------------------------------------------------------------

test('GET by-entity returns multiple versions ordered by version asc', async () => {
  await postKnowledge({
    kind: 'requirement',
    uri: 'mem://req-002-v1',
    size: 10,
    contentType: 'text/markdown',
    entityId: 'REQ-002',
    version: 1,
  });
  await postKnowledge({
    kind: 'requirement',
    uri: 'mem://req-002-v2',
    size: 12,
    contentType: 'text/markdown',
    entityId: 'REQ-002',
    version: 2,
  });
  const res = await app.request(
    `/knowledge-artifacts/projects/${PROJECT_ID}/by-entity/REQ-002`,
  );
  expect(res.status).toBe(200);
  const j = (await res.json()) as { ok: boolean; artifacts: Array<{ version: number }> };
  expect(j.artifacts.map((a) => a.version)).toEqual([1, 2]);
});

// ---------------------------------------------------------------------------
// Status updates
// ---------------------------------------------------------------------------

test('PATCH /:id/status flips a draft to accepted and retargets default context metadata', async () => {
  const created = (await (
    await postKnowledge({
      kind: 'roadmap',
      uri: 'mem://roadmap-1',
      size: 10,
      contentType: 'text/markdown',
      subtype: 'feature',
    })
  ).json()) as { artifact: { id: string } };
  const patch = await app.request(
    `/knowledge-artifacts/${created.artifact.id}/status`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'accepted' }),
    },
  );
  expect(patch.status).toBe(200);
  const j = (await patch.json()) as {
    ok: boolean;
    artifact: { status: string; metadata: Record<string, unknown> };
  };
  expect(j.artifact.status).toBe('accepted');
  expect(j.artifact.metadata).toMatchObject({
    knowledgeClass: 'confirmed',
    trustLevel: 'accepted_knowledge',
    freshness: 'possibly_stale',
    confidence: 0.9,
  });
  expect(j.artifact.metadata.sourceRefs).toEqual(
    expect.arrayContaining(['knowledge:accepted', 'uri:mem://roadmap-1']),
  );
  expect(j.artifact.metadata.sourceRefs).not.toContain('knowledge:draft');
});

test('PATCH /:id/status retargets only status-derived metadata fields', async () => {
  const created = (await (
    await postKnowledge({
      kind: 'roadmap',
      uri: 'mem://roadmap-partial-override',
      size: 10,
      contentType: 'text/markdown',
      subtype: 'feature',
      metadata: {
        trustLevel: 'source',
      },
    })
  ).json()) as { artifact: { id: string } };
  const patch = await app.request(
    `/knowledge-artifacts/${created.artifact.id}/status`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'accepted' }),
    },
  );
  expect(patch.status).toBe(200);
  const j = (await patch.json()) as {
    ok: boolean;
    artifact: { status: string; metadata: Record<string, unknown> };
  };
  expect(j.artifact.status).toBe('accepted');
  expect(j.artifact.metadata).toMatchObject({
    knowledgeClass: 'confirmed',
    trustLevel: 'source',
    freshness: 'possibly_stale',
    confidence: 0.9,
  });
  expect(j.artifact.metadata.sourceRefs).toEqual(
    expect.arrayContaining(['knowledge:accepted', 'uri:mem://roadmap-partial-override']),
  );
  expect(j.artifact.metadata.sourceRefs).not.toContain('knowledge:draft');
});

test('PATCH /:id/status preserves explicit seed classification overrides', async () => {
  const created = (await (
    await postKnowledge({
      kind: 'roadmap',
      uri: 'mem://roadmap-seed',
      size: 10,
      contentType: 'text/markdown',
      subtype: 'feature',
      metadata: {
        knowledgeClass: 'seed',
        trustLevel: 'summary',
        freshness: 'current',
        sourceRefs: ['seed:patch-test'],
        confidence: 0.7,
      },
    })
  ).json()) as { artifact: { id: string } };
  const patch = await app.request(
    `/knowledge-artifacts/${created.artifact.id}/status`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'accepted' }),
    },
  );
  expect(patch.status).toBe(200);
  const j = (await patch.json()) as {
    ok: boolean;
    artifact: { status: string; metadata: Record<string, unknown> };
  };
  expect(j.artifact.status).toBe('accepted');
  expect(j.artifact.metadata).toMatchObject({
    knowledgeClass: 'seed',
    trustLevel: 'summary',
    freshness: 'current',
    sourceRefs: ['seed:patch-test'],
    confidence: 0.7,
  });
});

test('PATCH rejects an invalid status value', async () => {
  // Need an existing id; reuse the lesson from earlier listing
  const list = (await (
    await app.request(`/knowledge-artifacts/projects/${PROJECT_ID}?kind=lesson`)
  ).json()) as { artifacts: Array<{ id: string }> };
  const id = list.artifacts[0]!.id;
  const res = await app.request(`/knowledge-artifacts/${id}/status`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'unsupported' }),
  });
  expect(res.status).toBe(400);
});

test('PATCH on missing id returns 404', async () => {
  const res = await app.request('/knowledge-artifacts/no-such-id/status', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'accepted' }),
  });
  expect(res.status).toBe(404);
});

// ---------------------------------------------------------------------------
// Cross-table protection: per-run kinds rejected at /runner/events/artifact too
// ---------------------------------------------------------------------------

test('POST /runner/events/artifact rejects a knowledge kind (confused-tier opposite direction)', async () => {
  const res = await app.request('/runner/events/artifact', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowRunId: 'wf-irrelevant',
      stepRunId: null,
      kind: 'requirement', // a knowledge kind, must NOT go through this entrypoint
      uri: 'mem://wrong',
      size: 10,
      contentType: 'text/markdown',
    }),
  });
  expect(res.status).toBe(400);
  const json = (await res.json()) as { error: string };
  expect(json.error).toContain('not a PerRunArtifactKind');
});
