import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, expect, test } from 'vitest';
import { sh } from '../../runner/src/sh';

process.env.AINP_DB_PATH = join(mkdtempSync(join(tmpdir(), 'ainp-project-route-test-')), 'ainp.sqlite');
process.env.AINP_HOME = join(mkdtempSync(join(tmpdir(), 'ainp-project-route-home-')), '.ai-native');

let app: Awaited<typeof import('../src/app')>['app'];

beforeAll(async () => {
  ({ app } = await import('../src/app'));
});

async function makeGitRepo(branches: string[] = ['main']): Promise<string> {
  const repo = mkdtempSync(join(tmpdir(), 'ainp-detect-repo-'));
  await sh('git', ['init', '-b', branches[0] ?? 'main'], { cwd: repo });
  writeFileSync(join(repo, 'README.md'), '# detect fixture\n', 'utf8');
  await sh('git', ['add', 'README.md'], { cwd: repo });
  await sh('git', ['-c', 'user.email=ainp@test', '-c', 'user.name=ainp', 'commit', '-m', 'initial'], { cwd: repo });
  for (const branch of branches.slice(1)) {
    await sh('git', ['checkout', '-b', branch], { cwd: repo });
    writeFileSync(join(repo, `${branch.replace(/[^a-zA-Z0-9.-]/g, '-')}.txt`), branch, 'utf8');
    await sh('git', ['add', `${branch}.txt`], { cwd: repo });
    await sh('git', ['-c', 'user.email=ainp@test', '-c', 'user.name=ainp', 'commit', '-m', `add ${branch}`], { cwd: repo });
  }
  await sh('git', ['checkout', branches[0] ?? 'main'], { cwd: repo });
  return repo;
}

test('detects a local git project and returns project name, branches, and metadata', async () => {
  const repo = await makeGitRepo(['main', 'develop']);

  const res = await app.request('/projects/detect-source', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sourceKind: 'local', localPath: repo }),
  });

  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    ok: true,
    sourceKind: 'local',
    projectName: expect.stringContaining('ainp-detect-repo-'),
    defaultBranch: 'main',
    branches: expect.arrayContaining(['main', 'develop']),
    metadata: { transport: 'local' },
  });
});

test('detects a remote git source and returns normalized URL, branches, and provider metadata', async () => {
  const repo = await makeGitRepo(['main', 'release/1.0']);

  const res = await app.request('/projects/detect-source', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sourceKind: 'gitee',
      sourceUrl: repo,
      sourceAuthKind: 'none',
    }),
  });

  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    ok: true,
    sourceKind: 'gitee',
    sourceUrl: repo,
    projectName: expect.stringContaining('ainp-detect-repo-'),
    defaultBranch: 'main',
    branches: expect.arrayContaining(['main', 'release/1.0']),
    metadata: { provider: 'gitee', authKind: 'none', transport: 'remote' },
  });
});

test('lists constrained source chunk index catalog metadata for a project', async () => {
  const repo = await makeGitRepo(['main']);
  const createdRes = await app.request('/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'catalog-read-project', sourceKind: 'local', localPath: repo }),
  });
  expect(createdRes.status).toBe(201);
  const project = await createdRes.json() as { id: string };
  const { SOURCE_CHUNK_INDEX_MAX_EMBEDDING_DIMENSIONS, store } = await import('../src/store/store');

  store.sourceChunkIndexEntries.replaceForArtifact('art_source_index_catalog_route', [
    {
      id: 'art_source_index_catalog_route:src_chunk_idx_refund',
      projectId: project.id,
      workflowRunId: 'run_catalog_route',
      sourceChunkIndexArtifactId: 'art_source_index_catalog_route',
      sourceInventoryArtifactId: 'art_inventory_catalog_route',
      sourceChunkRef: 'chunk_refund_policy',
      contentSha256: 'a'.repeat(64),
      path: 'apps/api/src/refunds.ts',
      language: 'typescript/javascript',
      startLine: 40,
      endLine: 44,
      lexicalTokens: ['refund', 'settlement', 'workflow'],
      searchText: 'refund settlement workflow',
      linkedRecordRefs: ['symbol:sym_refund_policy'],
      sourceRefs: ['file:apps/api/src/refunds.ts#L40'],
      entrypointRefs: [],
      symbolRefs: ['sym_refund_policy'],
      domainEntityRefs: [],
      graphEdgeRefs: [],
      testRefs: [],
      hotspotRefs: [],
      capabilityRefs: ['cap_billing_refunds'],
      createdAt: '2026-07-04T00:00:00.000Z',
    },
    {
      id: 'art_source_index_catalog_route:src_chunk_idx_customer',
      projectId: project.id,
      workflowRunId: 'run_catalog_route',
      sourceChunkIndexArtifactId: 'art_source_index_catalog_route',
      sourceInventoryArtifactId: 'art_inventory_catalog_route',
      sourceChunkRef: 'chunk_customer_profile',
      contentSha256: 'b'.repeat(64),
      path: 'apps/api/src/customers.ts',
      language: 'typescript/javascript',
      startLine: 8,
      endLine: 12,
      lexicalTokens: ['customer', 'profile'],
      searchText: 'customer profile',
      linkedRecordRefs: ['symbol:sym_customer_profile'],
      sourceRefs: ['file:apps/api/src/customers.ts#L8'],
      entrypointRefs: [],
      symbolRefs: ['sym_customer_profile'],
      domainEntityRefs: [],
      graphEdgeRefs: [],
      testRefs: [],
      hotspotRefs: [],
      capabilityRefs: ['cap_customers'],
      createdAt: '2026-07-04T00:00:00.000Z',
    },
    {
      id: 'art_source_index_catalog_route:src_chunk_idx_refund_archive',
      projectId: project.id,
      workflowRunId: 'run_catalog_route',
      sourceChunkIndexArtifactId: 'art_source_index_catalog_route',
      sourceInventoryArtifactId: 'art_inventory_catalog_route',
      sourceChunkRef: 'chunk_refund_archive',
      contentSha256: 'c'.repeat(64),
      path: 'apps/api/src/a-refund-archive.ts',
      language: 'typescript/javascript',
      startLine: 4,
      endLine: 7,
      lexicalTokens: ['refund', 'archive'],
      searchText: 'refund archive',
      linkedRecordRefs: ['symbol:sym_refund_archive'],
      sourceRefs: ['file:apps/api/src/a-refund-archive.ts#L4'],
      entrypointRefs: [],
      symbolRefs: ['sym_refund_archive'],
      domainEntityRefs: [],
      graphEdgeRefs: [],
      testRefs: [],
      hotspotRefs: [],
      capabilityRefs: ['cap_billing_refunds'],
      createdAt: '2026-07-04T00:01:00.000Z',
    },
    {
      id: 'art_source_index_catalog_route:src_chunk_idx_refund_verbose',
      projectId: project.id,
      workflowRunId: 'run_catalog_route',
      sourceChunkIndexArtifactId: 'art_source_index_catalog_route',
      sourceInventoryArtifactId: 'art_inventory_catalog_route',
      sourceChunkRef: 'chunk_refund_verbose',
      contentSha256: 'd'.repeat(64),
      path: 'apps/api/src/aa-refund-settlement-verbose.ts',
      language: 'typescript/javascript',
      startLine: 20,
      endLine: 28,
      lexicalTokens: ['refund', 'settlement', 'workflow', 'customer', 'archive', 'report'],
      searchText: 'refund settlement workflow customer archive report invoice reconciliation queue legacy',
      linkedRecordRefs: ['symbol:sym_refund_verbose'],
      sourceRefs: ['file:apps/api/src/aa-refund-settlement-verbose.ts#L20'],
      entrypointRefs: [],
      symbolRefs: ['sym_refund_verbose'],
      domainEntityRefs: [],
      graphEdgeRefs: [],
      testRefs: [],
      hotspotRefs: [],
      capabilityRefs: ['cap_billing_refunds'],
      createdAt: '2026-07-04T00:02:00.000Z',
    },
    {
      id: 'art_source_index_catalog_route:src_chunk_idx_chargeback_hybrid',
      projectId: project.id,
      workflowRunId: 'run_catalog_route',
      sourceChunkIndexArtifactId: 'art_source_index_catalog_route',
      sourceInventoryArtifactId: 'art_inventory_catalog_route',
      sourceChunkRef: 'chunk_chargeback_hybrid',
      contentSha256: 'e'.repeat(64),
      path: 'apps/api/src/chargebacks.ts',
      language: 'typescript/javascript',
      startLine: 30,
      endLine: 34,
      lexicalTokens: ['chargeback', 'workflow'],
      searchText: 'chargeback workflow chargeback',
      linkedRecordRefs: ['symbol:sym_chargeback_workflow'],
      sourceRefs: ['file:apps/api/src/chargebacks.ts#L30'],
      entrypointRefs: [],
      symbolRefs: ['sym_chargeback_workflow'],
      domainEntityRefs: [],
      graphEdgeRefs: [],
      testRefs: [],
      hotspotRefs: [],
      capabilityRefs: ['cap_billing_chargebacks'],
      embeddingModel: 'fixture-cosine-v1',
      embeddingDimensions: 2,
      embeddingVector: [0.6, 0.8],
      createdAt: '2026-07-04T00:03:00.000Z',
    },
    {
      id: 'art_source_index_catalog_route:src_chunk_idx_customer_semantic',
      projectId: project.id,
      workflowRunId: 'run_catalog_route',
      sourceChunkIndexArtifactId: 'art_source_index_catalog_route',
      sourceInventoryArtifactId: 'art_inventory_catalog_route',
      sourceChunkRef: 'chunk_customer_semantic',
      contentSha256: 'f'.repeat(64),
      path: 'apps/api/src/customer-semantic.ts',
      language: 'typescript/javascript',
      startLine: 30,
      endLine: 34,
      lexicalTokens: ['customer', 'profile'],
      searchText: 'customer profile',
      linkedRecordRefs: ['symbol:sym_customer_semantic'],
      sourceRefs: ['file:apps/api/src/customer-semantic.ts#L30'],
      entrypointRefs: [],
      symbolRefs: ['sym_customer_semantic'],
      domainEntityRefs: [],
      graphEdgeRefs: [],
      testRefs: [],
      hotspotRefs: [],
      capabilityRefs: ['cap_customer_semantic'],
      embeddingModel: 'fixture-cosine-v1',
      embeddingDimensions: 2,
      embeddingVector: [1, 0],
      createdAt: '2026-07-04T00:04:00.000Z',
    },
    {
      id: 'art_source_index_catalog_route:src_chunk_idx_provider_model_compatible',
      projectId: project.id,
      workflowRunId: 'run_catalog_route',
      sourceChunkIndexArtifactId: 'art_source_index_catalog_route',
      sourceInventoryArtifactId: 'art_inventory_catalog_route',
      sourceChunkRef: 'chunk_provider_model_compatible',
      contentSha256: '2'.repeat(64),
      path: 'apps/api/src/provider-model-compatible.ts',
      language: 'typescript/javascript',
      startLine: 30,
      endLine: 34,
      lexicalTokens: ['provider', 'model', 'mix'],
      searchText: 'provider model mix provider',
      linkedRecordRefs: ['symbol:sym_provider_model_compatible'],
      sourceRefs: ['file:apps/api/src/provider-model-compatible.ts#L30'],
      entrypointRefs: [],
      symbolRefs: ['sym_provider_model_compatible'],
      domainEntityRefs: [],
      graphEdgeRefs: [],
      testRefs: [],
      hotspotRefs: [],
      capabilityRefs: ['cap_provider_model_compatible'],
      embeddingModel: 'fixture-cosine-v1',
      embeddingDimensions: 2,
      embeddingVector: [0.1, 0.99],
      createdAt: '2026-07-04T00:05:00.000Z',
    },
    {
      id: 'art_source_index_catalog_route:src_chunk_idx_other_model_semantic',
      projectId: project.id,
      workflowRunId: 'run_catalog_route',
      sourceChunkIndexArtifactId: 'art_source_index_catalog_route',
      sourceInventoryArtifactId: 'art_inventory_catalog_route',
      sourceChunkRef: 'chunk_other_model_semantic',
      contentSha256: '1'.repeat(64),
      path: 'apps/api/src/other-model-semantic.ts',
      language: 'typescript/javascript',
      startLine: 30,
      endLine: 34,
      lexicalTokens: ['provider', 'model', 'mix'],
      searchText: 'provider model mix provider',
      linkedRecordRefs: ['symbol:sym_other_model_semantic'],
      sourceRefs: ['file:apps/api/src/other-model-semantic.ts#L30'],
      entrypointRefs: [],
      symbolRefs: ['sym_other_model_semantic'],
      domainEntityRefs: [],
      graphEdgeRefs: [],
      testRefs: [],
      hotspotRefs: [],
      capabilityRefs: ['cap_other_model_semantic'],
      embeddingModel: 'fixture-other-cosine-v1',
      embeddingDimensions: 2,
      embeddingVector: [0, 1],
      createdAt: '2026-07-04T00:06:00.000Z',
    },
  ]);

  const res = await app.request(
    `/projects/${project.id}/source-chunk-index?q=settlement&linkedRecordRef=${encodeURIComponent('symbol:sym_refund_policy')}&limit=10`,
  );
  expect(res.status).toBe(200);
  const body = await res.json() as { items: Array<Record<string, unknown>> };
  expect(body.items).toHaveLength(1);
  expect(body.items[0]).toMatchObject({
    sourceChunkRef: 'chunk_refund_policy',
    contentSha256: 'a'.repeat(64),
    path: 'apps/api/src/refunds.ts',
    lexicalTokens: ['refund', 'settlement', 'workflow'],
    sourceRefs: ['file:apps/api/src/refunds.ts#L40'],
  });
  expect(body.items[0]).not.toHaveProperty('content');
  expect(body.items[0]).not.toHaveProperty('snippet');
  expect(JSON.stringify(body.items)).not.toContain('Snippet:');

  const ranked = await app.request(`/projects/${project.id}/source-chunk-index?q=refund%20settlement&limit=10`);
  expect(ranked.status).toBe(200);
  const rankedBody = await ranked.json() as { items: Array<Record<string, unknown>> };
  expect(rankedBody.items.map((item) => item.sourceChunkRef)).toEqual([
    'chunk_refund_policy',
    'chunk_refund_verbose',
    'chunk_refund_archive',
  ]);

  const partialToken = await app.request(`/projects/${project.id}/source-chunk-index?q=fund&limit=10`);
  expect(partialToken.status).toBe(200);
  const partialBody = await partialToken.json() as { items: Array<Record<string, unknown>> };
  expect(partialBody.items).toEqual([]);

  const modelLessVector = await app.request(
    `/projects/${project.id}/source-chunk-index?embedding=${encodeURIComponent(JSON.stringify([1, 0]))}&limit=10`,
  );
  expect(modelLessVector.status).toBe(400);
  expect(await modelLessVector.json()).toEqual({
    error: 'embeddingModel is required when embedding is supplied',
  });

  const vectorRanked = await app.request(
    `/projects/${project.id}/source-chunk-index?embedding=${encodeURIComponent(JSON.stringify([1, 0]))}&embeddingModel=fixture-cosine-v1&limit=10`,
  );
  expect(vectorRanked.status).toBe(200);
  const vectorBody = await vectorRanked.json() as { items: Array<Record<string, unknown>> };
  expect(vectorBody.items.map((item) => item.sourceChunkRef).slice(0, 2)).toEqual([
    'chunk_customer_semantic',
    'chunk_chargeback_hybrid',
  ]);
  expect(vectorBody.items[0]).toMatchObject({
    sourceChunkRef: 'chunk_customer_semantic',
    embeddingModel: 'fixture-cosine-v1',
    embeddingDimensions: 2,
    embeddingVector: [1, 0],
  });

  const modelFilteredVector = await app.request(
    `/projects/${project.id}/source-chunk-index?embedding=${encodeURIComponent(JSON.stringify([0, 1]))}&embeddingModel=fixture-cosine-v1&limit=10`,
  );
  expect(modelFilteredVector.status).toBe(200);
  const modelFilteredBody = await modelFilteredVector.json() as { items: Array<Record<string, unknown>> };
  expect(modelFilteredBody.items.map((item) => item.sourceChunkRef)).toContain('chunk_chargeback_hybrid');
  expect(modelFilteredBody.items.map((item) => item.sourceChunkRef)).not.toContain('chunk_other_model_semantic');

  const modelFilteredHybrid = await app.request(
    `/projects/${project.id}/source-chunk-index?q=provider%20model%20mix&embedding=${encodeURIComponent(JSON.stringify([0, 1]))}&embeddingModel=fixture-cosine-v1&limit=10`,
  );
  expect(modelFilteredHybrid.status).toBe(200);
  const modelFilteredHybridBody = await modelFilteredHybrid.json() as { items: Array<Record<string, unknown>> };
  const modelFilteredHybridRefs = modelFilteredHybridBody.items.map((item) => item.sourceChunkRef);
  expect(modelFilteredHybridRefs[0]).toBe('chunk_provider_model_compatible');
  expect(modelFilteredHybridRefs).toContain('chunk_other_model_semantic');

  const hybridRanked = await app.request(
    `/projects/${project.id}/source-chunk-index?q=chargeback&embedding=${encodeURIComponent(JSON.stringify([1, 0]))}&embeddingModel=fixture-cosine-v1&limit=10`,
  );
  expect(hybridRanked.status).toBe(200);
  const hybridBody = await hybridRanked.json() as { items: Array<Record<string, unknown>> };
  expect(hybridBody.items.map((item) => item.sourceChunkRef).slice(0, 2)).toEqual([
    'chunk_chargeback_hybrid',
    'chunk_customer_semantic',
  ]);
  expect(JSON.stringify(hybridBody.items)).not.toContain('Snippet:');
  expect(hybridBody.items[0]).not.toHaveProperty('content');
  expect(hybridBody.items[0]).not.toHaveProperty('snippet');
  expect(hybridBody.items[0]).not.toHaveProperty('sourceIndexJson');

  const badEmbedding = await app.request(
    `/projects/${project.id}/source-chunk-index?embedding=${encodeURIComponent(JSON.stringify([1, 'bad']))}`,
  );
  expect(badEmbedding.status).toBe(400);

  const zeroEmbedding = await app.request(
    `/projects/${project.id}/source-chunk-index?embedding=${encodeURIComponent(JSON.stringify([0, 0]))}`,
  );
  expect(zeroEmbedding.status).toBe(400);

  const excessiveEmbedding = await app.request(
    `/projects/${project.id}/source-chunk-index?embedding=${Array.from(
      { length: SOURCE_CHUNK_INDEX_MAX_EMBEDDING_DIMENSIONS + 1 },
      () => '1',
    ).join(',')}`,
  );
  expect(excessiveEmbedding.status).toBe(400);

  const badHash = await app.request(`/projects/${project.id}/source-chunk-index?contentSha256=nope`);
  expect(badHash.status).toBe(400);
});

test('returns a structured detect failure instead of registering incomplete remote input', async () => {
  const res = await app.request('/projects/detect-source', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sourceKind: 'gitlab', sourceUrl: '', sourceAuthKind: 'token' }),
  });

  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    ok: false,
    error: expect.stringContaining('sourceUrl'),
  });
});

test('registers a local git project with backward-compatible localPath', async () => {
  const res = await app.request('/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'local-sample',
      localPath: '/repos/local-sample',
      defaultBranch: 'main',
    }),
  });

  expect(res.status).toBe(201);
  expect(await res.json()).toMatchObject({
    name: 'local-sample',
    sourceKind: 'local',
    agentBackend: null,
    sourceAuthKind: 'none',
    localPath: '/repos/local-sample',
    sourceUrl: null,
    hasSourceCredential: false,
    defaultBranch: 'main',
  });
});

test('stores project-level real agent backend and rejects unsupported backend values', async () => {
  const created = await app.request('/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: `backend-project-${Date.now()}`,
      localPath: '/repos/backend-project',
      defaultBranch: 'main',
      agentBackend: 'claude_code',
    }),
  });
  expect(created.status).toBe(201);
  const project = (await created.json()) as { id: string; agentBackend: string };
  expect(project.agentBackend).toBe('claude_code');

  const updated = await app.request(`/projects/${project.id}/agent-backend`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agentBackend: 'codex' }),
  });
  expect(updated.status).toBe(200);
  expect(await updated.json()).toMatchObject({ agentBackend: 'codex' });

  const bad = await app.request(`/projects/${project.id}/agent-backend`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agentBackend: 'native' }),
  });
  expect(bad.status).toBe(400);
  expect(await bad.json()).toMatchObject({ error: expect.stringContaining('claude_code') });
});

test('does not expose legacy persisted backend values as user-selectable project backends', async () => {
  const { store } = await import('../src/store/store');
  const id = `proj_legacy_backend_${Date.now()}`;
  store.projects.set(id, {
    id,
    name: `legacy-backend-${Date.now()}`,
    localPath: '/repos/legacy-backend',
    agentBackend: 'native' as never,
    language: 'java',
    buildTool: 'maven',
    defaultBranch: 'main',
    registeredAt: new Date().toISOString(),
  });

  const res = await app.request(`/projects/${id}`);

  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ id, agentBackend: null });
});

test('preflights Codex backend through version and login status', async () => {
  const previous = process.env.AINP_CODEX_BIN;
  process.env.AINP_CODEX_BIN = fakeCodexBin({ loginStatus: 'logged_in' });
  try {
    const res = await app.request('/projects/agent-backend/preflight', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentBackend: 'codex' }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      backend: 'codex',
      installed: true,
      runnable: true,
      authenticated: true,
      version: 'codex 9.9.9',
      status: 'connected',
    });
  } finally {
    if (previous === undefined) delete process.env.AINP_CODEX_BIN;
    else process.env.AINP_CODEX_BIN = previous;
  }
});

test('reports Codex logged-out login status as needs_login without secret dumps', async () => {
  const previous = process.env.AINP_CODEX_BIN;
  process.env.AINP_CODEX_BIN = fakeCodexBin({ loginStatus: 'logged_out' });
  try {
    const res = await app.request('/projects/agent-backend/preflight', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentBackend: 'codex' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; error: string; remediationHint: string };
    expect(body.status).toBe('needs_login');
    expect(body.error).toContain('not logged in');
    expect(body.remediationHint).toContain('login');
    expect(body.error.length).toBeLessThan(700);
    expect(body.error).not.toContain('sk-test-codex-secret');
  } finally {
    if (previous === undefined) delete process.env.AINP_CODEX_BIN;
    else process.env.AINP_CODEX_BIN = previous;
  }
});

test('reports invalid Codex login status output as not_runnable with compact masked output', async () => {
  const previous = process.env.AINP_CODEX_BIN;
  process.env.AINP_CODEX_BIN = fakeCodexBin({ loginStatus: 'invalid' });
  try {
    const res = await app.request('/projects/agent-backend/preflight', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentBackend: 'codex' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; error: string; remediationHint: string };
    expect(body.status).toBe('not_runnable');
    expect(body.error).toContain('not recognized');
    expect(body.error).toContain('sk-[redacted]');
    expect(body.error.length).toBeLessThan(700);
    expect(body.remediationHint).toContain('login status');
    expect(body.error).not.toContain('sk-test-codex-secret');
  } finally {
    if (previous === undefined) delete process.env.AINP_CODEX_BIN;
    else process.env.AINP_CODEX_BIN = previous;
  }
});

test('preflights Claude Code backend through version and auth status JSON', async () => {
  const previous = process.env.AINP_CLAUDE_BIN;
  process.env.AINP_CLAUDE_BIN = fakeClaudeAuthBin({ loggedIn: true });
  try {
    const res = await app.request('/projects/agent-backend/preflight', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentBackend: 'claude_code' }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      backend: 'claude_code',
      installed: true,
      runnable: true,
      authenticated: true,
      version: 'claude 2.1.117',
      status: 'connected',
    });
  } finally {
    if (previous === undefined) delete process.env.AINP_CLAUDE_BIN;
    else process.env.AINP_CLAUDE_BIN = previous;
  }
});

test('reports Claude Code auth status loggedOut as needs_login without prompt dumps', async () => {
  const previous = process.env.AINP_CLAUDE_BIN;
  process.env.AINP_CLAUDE_BIN = fakeClaudeAuthBin({ loggedIn: false });
  try {
    const res = await app.request('/projects/agent-backend/preflight', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentBackend: 'claude_code' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; error: string; remediationHint: string };
    expect(body.status).toBe('needs_login');
    expect(body.error).toContain('loggedIn=false');
    expect(body.remediationHint).toContain('login');
    expect(body.error.length).toBeLessThan(700);
    expect(body.error).not.toContain('plugins');
    expect(body.error).not.toContain('/Users/artisan');
    expect(body.error).not.toContain('AINP_PREFLIGHT_OK');
  } finally {
    if (previous === undefined) delete process.env.AINP_CLAUDE_BIN;
    else process.env.AINP_CLAUDE_BIN = previous;
  }
});

test('reports invalid Claude Code auth status JSON as not_runnable with compact output', async () => {
  const previous = process.env.AINP_CLAUDE_BIN;
  process.env.AINP_CLAUDE_BIN = fakeClaudeInvalidAuthStatusBin();
  try {
    const res = await app.request('/projects/agent-backend/preflight', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentBackend: 'claude_code' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; error: string; remediationHint: string };
    expect(body.status).toBe('not_runnable');
    expect(body.error).toContain('invalid_json');
    expect(body.error.length).toBeLessThan(700);
    expect(body.remediationHint).toContain('auth status');
    expect(body.error).not.toContain('AINP_PREFLIGHT_OK');
  } finally {
    if (previous === undefined) delete process.env.AINP_CLAUDE_BIN;
    else process.env.AINP_CLAUDE_BIN = previous;
  }
});

test('stores and refreshes source branch options for a registered project', async () => {
  const repo = await makeGitRepo(['main', 'develop']);
  const res = await app.request('/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: `branch-options-${Date.now()}`,
      sourceKind: 'local',
      localPath: repo,
      defaultBranch: 'main',
      sourceBranches: ['main', 'develop'],
    }),
  });

  expect(res.status).toBe(201);
  const project = (await res.json()) as { id: string; sourceBranches: string[] };
  expect(project.sourceBranches).toEqual(['main', 'develop']);

  const branches = await app.request(`/projects/${project.id}/branches`);
  expect(branches.status).toBe(200);
  expect(await branches.json()).toMatchObject({
    ok: true,
    defaultBranch: 'main',
    branches: expect.arrayContaining(['main', 'develop']),
  });
});

test('registers GitHub, Gitee, generic Git, and private GitLab sources by repo URL', async () => {
  for (const input of [
    {
      name: 'github-sample',
      sourceKind: 'github',
      sourceUrl: 'https://github.com/acme/widgets.git',
      sourceAuthKind: 'token',
      sourceCredential: 'ghp_test_token',
    },
    {
      name: 'gitee-sample',
      sourceKind: 'gitee',
      sourceUrl: 'https://gitee.com/acme/widgets.git',
      sourceAuthKind: 'basic',
      sourceUsername: 'robot',
      sourceCredential: 'password-test',
    },
    {
      name: 'generic-git-sample',
      sourceKind: 'git',
      sourceUrl: 'ssh://git@example.com/acme/widgets.git',
      sourceAuthKind: 'ssh',
    },
    {
      name: 'private-gitlab-sample',
      sourceKind: 'gitlab',
      sourceUrl: 'git@gitlab.internal.example.com:platform/widgets.git',
      sourceAuthKind: 'ssh',
    },
  ] as const) {
    const res = await app.request('/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...input, defaultBranch: 'main' }),
    });

    expect(res.status, `${input.name} should register`).toBe(201);
    const project = (await res.json()) as { id: string; localPath: string; sourceCredential?: string };
    expect(project).toMatchObject({
      name: input.name,
      sourceKind: input.sourceKind,
      sourceUrl: input.sourceUrl,
      sourceAuthKind: input.sourceAuthKind,
      hasSourceCredential: Boolean('sourceCredential' in input),
      defaultBranch: 'main',
    });
    expect(project).not.toHaveProperty('sourceCredential');
    if ('sourceCredential' in input) {
      const secretRes = await app.request(`/projects/${project.id}?includeSecret=1`, {
        headers: { 'x-ainp-internal': 'runner' },
      });
      expect(await secretRes.json()).toMatchObject({ sourceCredential: input.sourceCredential });
    }
    expect(project.localPath).toMatch(new RegExp(`${project.id}/source$`));
  }
});

test('rejects source-specific registrations missing the required source field', async () => {
  const missingLocal = await app.request('/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'missing-local', sourceKind: 'local' }),
  });
  expect(missingLocal.status).toBe(400);
  expect(await missingLocal.json()).toMatchObject({ error: expect.stringContaining('localPath') });

  const missingUrl = await app.request('/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'missing-url', sourceKind: 'gitlab' }),
  });
  expect(missingUrl.status).toBe(400);
  expect(await missingUrl.json()).toMatchObject({ error: expect.stringContaining('sourceUrl') });
});

test('rejects unknown project source kinds', async () => {
  const res = await app.request('/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'bad-source-kind',
      sourceKind: 'bitbucket',
      sourceUrl: 'https://bitbucket.example.com/acme/widgets.git',
    }),
  });

  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: expect.stringContaining('sourceKind') });
});

test('lists local folders for the local project picker without returning files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ainp-local-picker-'));
  const child = join(root, 'repo-dir');
  const hidden = join(root, '.hidden-dir');
  const file = join(root, 'README.md');
  await Bun.$`mkdir -p ${child} ${hidden}`;
  writeFileSync(file, 'not a directory', 'utf8');

  const res = await app.request(`/projects/local-directories?path=${encodeURIComponent(root)}`);

  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    path: root,
    parent: expect.any(String),
    directories: [
      { name: 'repo-dir', path: child },
    ],
  });
});

test('updates an existing project while keeping saved credential when omitted', async () => {
  const createdRes = await app.request('/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'editable-gitee',
      sourceKind: 'gitee',
      sourceUrl: 'https://gitee.com/acme/old.git',
      sourceAuthKind: 'token',
      sourceCredential: 'old-secret',
      defaultBranch: 'main',
    }),
  });
  expect(createdRes.status).toBe(201);
  const created = (await createdRes.json()) as { id: string; localPath: string };

  const updateRes = await app.request(`/projects/${created.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'editable-gitee-renamed',
      sourceKind: 'gitee',
      sourceUrl: 'https://gitee.com/acme/new.git',
      sourceAuthKind: 'token',
      defaultBranch: 'master',
    }),
  });

  expect(updateRes.status).toBe(200);
  expect(await updateRes.json()).toMatchObject({
    id: created.id,
    name: 'editable-gitee-renamed',
    localPath: created.localPath,
    sourceUrl: 'https://gitee.com/acme/new.git',
    sourceAuthKind: 'token',
    hasSourceCredential: true,
    defaultBranch: 'master',
  });

  const secretRes = await app.request(`/projects/${created.id}?includeSecret=1`, {
    headers: { 'x-ainp-internal': 'runner' },
  });
  expect(await secretRes.json()).toMatchObject({ sourceCredential: 'old-secret' });
});

// ---------------------------------------------------------------------------
// T3.2: optional project-level build/test commands.
// ---------------------------------------------------------------------------

test('registers a project with custom build/test commands and trims them', async () => {
  const res = await app.request('/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'custom-build-commands',
      localPath: '/repos/custom-build-commands',
      defaultBranch: 'main',
      buildCompileCommand: '  gradle assemble  ',
      buildTestCommand: 'gradle test',
    }),
  });

  expect(res.status).toBe(201);
  expect(await res.json()).toMatchObject({
    name: 'custom-build-commands',
    buildCompileCommand: 'gradle assemble',
    buildTestCommand: 'gradle test',
  });
});

test('defaults build/test commands to null when omitted at registration', async () => {
  const res = await app.request('/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'default-build-commands',
      localPath: '/repos/default-build-commands',
      defaultBranch: 'main',
    }),
  });

  expect(res.status).toBe(201);
  expect(await res.json()).toMatchObject({
    buildCompileCommand: null,
    buildTestCommand: null,
  });
});

test('rejects build commands containing shell metacharacters with 400', async () => {
  for (const [field, command] of [
    ['buildTestCommand', 'mvn -B test && rm -rf /'],
    ['buildTestCommand', 'mvn test; echo pwned'],
    ['buildCompileCommand', 'make | tee log'],
    ['buildCompileCommand', 'echo $(whoami)'],
    ['buildTestCommand', 'mvn -Dtest="Foo Bar" test'],
    ['buildTestCommand', 'mvn -B test\nrm -rf /'],
  ] as const) {
    const res = await app.request('/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: `bad-build-command-${Math.random().toString(16).slice(2)}`,
        localPath: '/repos/bad-build-command',
        defaultBranch: 'main',
        [field]: command,
      }),
    });

    expect(res.status, command).toBe(400);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining(field),
    });
  }
});

test('PUT merge semantics: omitted keeps, empty string and null clear, non-empty sets', async () => {
  const createdRes = await app.request('/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'build-command-merge',
      localPath: '/repos/build-command-merge',
      defaultBranch: 'main',
      buildCompileCommand: 'gradle assemble',
      buildTestCommand: 'gradle test',
    }),
  });
  expect(createdRes.status).toBe(201);
  const created = (await createdRes.json()) as { id: string };

  // Omitted fields keep current values.
  const keepRes = await app.request(`/projects/${created.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ defaultBranch: 'develop' }),
  });
  expect(keepRes.status).toBe(200);
  expect(await keepRes.json()).toMatchObject({
    buildCompileCommand: 'gradle assemble',
    buildTestCommand: 'gradle test',
    defaultBranch: 'develop',
  });

  // Non-empty string replaces; empty string clears.
  const setRes = await app.request(`/projects/${created.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ buildCompileCommand: 'make build', buildTestCommand: '' }),
  });
  expect(setRes.status).toBe(200);
  expect(await setRes.json()).toMatchObject({
    buildCompileCommand: 'make build',
    buildTestCommand: null,
  });

  // Explicit null clears too.
  const clearRes = await app.request(`/projects/${created.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ buildCompileCommand: null }),
  });
  expect(clearRes.status).toBe(200);
  expect(await clearRes.json()).toMatchObject({
    buildCompileCommand: null,
    buildTestCommand: null,
  });

  // Invalid update is rejected without mutating stored values.
  const badRes = await app.request(`/projects/${created.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ buildTestCommand: 'mvn test && echo hacked' }),
  });
  expect(badRes.status).toBe(400);
  const afterBad = await app.request(`/projects/${created.id}`);
  expect(await afterBad.json()).toMatchObject({
    buildCompileCommand: null,
    buildTestCommand: null,
  });
});

async function registerLocalProject(name: string): Promise<{ id: string; name: string }> {
  const res = await app.request('/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, localPath: `/tmp/${name}`, defaultBranch: 'main', agentBackend: 'codex' }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; name: string };
}

function fakeCodexBin(opts: { loginStatus: 'logged_in' | 'logged_out' | 'invalid' }): string {
  const dir = mkdtempSync(join(tmpdir(), 'ainp-project-route-fake-codex-'));
  const bin = join(dir, 'codex');
  const loginLine = opts.loginStatus === 'logged_in'
    ? 'Logged in using an API key - sk-test-codex-secret'
    : opts.loginStatus === 'logged_out'
      ? 'Not logged in'
      : 'Codex status unknown: sk-test-codex-secret';
  writeFileSync(bin, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "codex 9.9.9"; exit 0; fi',
    `if [ "$1" = "login" ] && [ "$2" = "status" ]; then printf '%s\\n' '${loginLine}'; exit 0; fi`,
    'echo "unexpected args: $@" >&2',
    'exit 2',
    '',
  ].join('\n'), 'utf8');
  chmodSync(bin, 0o755);
  return bin;
}

function fakeClaudeAuthBin(opts: { loggedIn: boolean }): string {
  const dir = mkdtempSync(join(tmpdir(), 'ainp-project-route-fake-claude-'));
  const bin = join(dir, 'claude');
  const authPayload = JSON.stringify({
    loggedIn: opts.loggedIn,
    authMethod: opts.loggedIn ? 'oauth_token' : null,
    apiProvider: opts.loggedIn ? 'firstParty' : null,
  });
  writeFileSync(bin, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "claude 2.1.117"; exit 0; fi',
    `if [ "$1" = "auth" ] && [ "$2" = "status" ]; then printf '%s\\n' '${authPayload}'; exit 0; fi`,
    'echo "unexpected args: $@" >&2',
    'exit 9',
    '',
  ].join('\n'), 'utf8');
  chmodSync(bin, 0o755);
  return bin;
}

function fakeClaudeInvalidAuthStatusBin(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ainp-project-route-fake-claude-invalid-auth-'));
  const bin = join(dir, 'claude');
  writeFileSync(bin, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "claude 2.1.117"; exit 0; fi',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "not json"; exit 0; fi',
    'echo "unexpected args: $@" >&2',
    'exit 9',
    '',
  ].join('\n'), 'utf8');
  chmodSync(bin, 0o755);
  return bin;
}

test('hard deletes a project only when it has no linked workflow history', async () => {
  const project = await registerLocalProject(`delete-empty-${Date.now()}`);

  const preview = await app.request(`/projects/${project.id}/delete-preview`);
  expect(preview.status).toBe(200);
  expect(await preview.json()).toMatchObject({
    canHardDelete: true,
    canArchive: true,
    totalRequests: 0,
    totalRuns: 0,
    recommendation: 'hard_delete',
  });

  const deleted = await app.request(`/projects/${project.id}`, { method: 'DELETE' });
  expect(deleted.status).toBe(200);
  expect(await deleted.json()).toMatchObject({ ok: true, action: 'hard_deleted' });

  const byId = await app.request(`/projects/${project.id}`);
  expect(byId.status).toBe(404);
});

test('blocks project archive while active workflow requests exist', async () => {
  const project = await registerLocalProject(`delete-active-${Date.now()}`);
  const requestRes = await app.request('/workflow-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId: project.id, title: 'pending feature', type: 'feature' }),
  });
  expect(requestRes.status).toBe(201);

  const preview = await app.request(`/projects/${project.id}/delete-preview`);
  expect(await preview.json()).toMatchObject({
    canHardDelete: false,
    canArchive: false,
    activeRequests: 1,
    recommendation: 'blocked_active_work',
  });

  const archive = await app.request(`/projects/${project.id}/archive`, { method: 'POST' });
  expect(archive.status).toBe(409);
  expect(await archive.json()).toMatchObject({ error: expect.stringContaining('active') });
});

test('archives a project with completed history and keeps it out of active project lists', async () => {
  const project = await registerLocalProject(`archive-history-${Date.now()}`);
  const requestRes = await app.request('/workflow-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId: project.id, title: 'historical feature', type: 'feature' }),
  });
  const request = (await requestRes.json()) as { id: string };
  await app.request(`/workflow-requests/${request.id}/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ runnerId: 'runner@archive-test' }),
  });
  await app.request(`/workflow-requests/${request.id}/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ok: true, workflowRunId: null }),
  });

  const preview = await app.request(`/projects/${project.id}/delete-preview`);
  expect(await preview.json()).toMatchObject({
    canHardDelete: false,
    canArchive: true,
    totalRequests: 1,
    activeRequests: 0,
    recommendation: 'archive',
  });

  const archive = await app.request(`/projects/${project.id}/archive`, { method: 'POST' });
  expect(archive.status).toBe(200);
  expect(await archive.json()).toMatchObject({ status: 'archived', archivedAt: expect.any(String) });

  const activeList = await app.request('/projects?status=active');
  const activeItems = ((await activeList.json()) as { items: Array<{ id: string }> }).items;
  expect(activeItems.map((p) => p.id)).not.toContain(project.id);

  const createAfterArchive = await app.request('/workflow-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId: project.id, title: 'should be blocked', type: 'feature' }),
  });
  expect(createAfterArchive.status).toBe(400);
});

// ---------------------------------------------------------------------------
// R1.2: includeSecret endpoint contract hardening
// ---------------------------------------------------------------------------

test('includeSecret=1 without x-ainp-internal header strips sourceCredential', async () => {
  const res = await app.request('/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: `secret-test-${Date.now()}`,
      sourceKind: 'github',
      sourceUrl: 'https://github.com/acme/secret-test.git',
      sourceAuthKind: 'token',
      sourceCredential: 'ghp_secret_token',
      defaultBranch: 'main',
    }),
  });
  expect(res.status).toBe(201);
  const project = (await res.json()) as { id: string };

  // Without x-ainp-internal header, includeSecret=1 should NOT return credential
  const withoutHeader = await app.request(`/projects/${project.id}?includeSecret=1`);
  expect(withoutHeader.status).toBe(200);
  const body = await withoutHeader.json();
  expect(body).not.toHaveProperty('sourceCredential');
  expect(body).toMatchObject({ hasSourceCredential: true });
});

test('includeSecret=1 with x-ainp-internal=runner returns sourceCredential', async () => {
  const res = await app.request('/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: `runner-secret-test-${Date.now()}`,
      sourceKind: 'github',
      sourceUrl: 'https://github.com/acme/runner-test.git',
      sourceAuthKind: 'token',
      sourceCredential: 'ghp_runner_token',
      defaultBranch: 'main',
    }),
  });
  expect(res.status).toBe(201);
  const project = (await res.json()) as { id: string };

  // With x-ainp-internal: runner header, includeSecret=1 should return credential
  const withHeader = await app.request(`/projects/${project.id}?includeSecret=1`, {
    headers: { 'x-ainp-internal': 'runner' },
  });
  expect(withHeader.status).toBe(200);
  const body = await withHeader.json();
  expect(body).toMatchObject({ sourceCredential: 'ghp_runner_token' });
});

test('includeSecret=1 with wrong x-ainp-internal value strips sourceCredential', async () => {
  const res = await app.request('/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: `wrong-header-test-${Date.now()}`,
      sourceKind: 'github',
      sourceUrl: 'https://github.com/acme/wrong-header.git',
      sourceAuthKind: 'token',
      sourceCredential: 'ghp_wrong_token',
      defaultBranch: 'main',
    }),
  });
  expect(res.status).toBe(201);
  const project = (await res.json()) as { id: string };

  // With wrong x-ainp-internal value, should strip credential
  const withWrongHeader = await app.request(`/projects/${project.id}?includeSecret=1`, {
    headers: { 'x-ainp-internal': 'web' },
  });
  expect(withWrongHeader.status).toBe(200);
  const body = await withWrongHeader.json();
  expect(body).not.toHaveProperty('sourceCredential');
  expect(body).toMatchObject({ hasSourceCredential: true });
});
