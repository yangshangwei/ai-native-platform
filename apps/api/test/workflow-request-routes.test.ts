import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, expect, test } from 'vitest';
import { newId, nowIso, type Artifact, type Project } from '@ainp/shared';

process.env.AINP_DB_PATH = join(mkdtempSync(join(tmpdir(), 'ainp-request-route-test-')), 'ainp.sqlite');

let app: Awaited<typeof import('../src/app')>['app'];
let storeMod: typeof import('../src/store/store');

beforeAll(async () => {
  ({ app } = await import('../src/app'));
  storeMod = await import('../src/store/store');
});

function seedProject(name = `route-project-${Date.now()}`): Project {
  const project: Project = {
    id: newId('proj'),
    name,
    localPath: '/tmp/request-route-project',
    language: 'java',
    buildTool: 'maven',
    defaultBranch: 'main',
    agentBackend: 'codex',
    registeredAt: nowIso(),
  };
  storeMod.store.projects.set(project.id, project);
  return project;
}

test('workflow request routes create, list, claim, and complete runner work', async () => {
  const project = seedProject();

  const createdRes = await app.request('/workflow-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectName: project.name, title: 'add workbench polish', type: 'feature' }),
  });
  expect(createdRes.status).toBe(201);
  const created = (await createdRes.json()) as { id: string; status: string; branch: string };
  expect(created.status).toBe('pending');
  expect(created.branch).toBe(project.defaultBranch);

  const listRes = await app.request('/workflow-requests?status=pending');
  const listed = (await listRes.json()) as { items: Array<{ id: string }> };
  expect(listed.items.map((r) => r.id)).toContain(created.id);

  const claimRes = await app.request(`/workflow-requests/${created.id}/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ runnerId: 'runner@routes' }),
  });
  expect(claimRes.status).toBe(200);
  expect((await claimRes.json()) as { status: string; claimedBy: string }).toMatchObject({
    status: 'claimed',
    claimedBy: 'runner@routes',
  });

  const runStartedRes = await app.request(`/workflow-requests/${created.id}/run-started`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workflowRunId: 'run_live_from_route' }),
  });
  expect(runStartedRes.status).toBe(200);
  expect((await runStartedRes.json()) as { status: string; workflowRunId: string }).toMatchObject({
    status: 'claimed',
    workflowRunId: 'run_live_from_route',
  });

  const duplicateClaim = await app.request(`/workflow-requests/${created.id}/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ runnerId: 'runner@other' }),
  });
  expect(duplicateClaim.status).toBe(409);

  const completeRes = await app.request(`/workflow-requests/${created.id}/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ok: true }),
  });
  expect(completeRes.status).toBe(200);
  expect((await completeRes.json()) as { status: string; workflowRunId: string }).toMatchObject({
    status: 'completed',
    workflowRunId: 'run_live_from_route',
  });
});

test('workflow request creation fails fast when project agent backend is not configured', async () => {
  const project = seedProject(`missing-backend-${Date.now()}`);
  storeMod.store.projects.set(project.id, { ...project, agentBackend: null });

  const res = await app.request('/workflow-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectName: project.name, title: 'should not queue', type: 'feature' }),
  });

  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({
    needsAgentBackendSetup: true,
    error: expect.stringContaining('Agent Backend'),
  });
});

test('feature workflow run creation fails fast when project agent backend is not configured', async () => {
  const project = seedProject(`missing-run-backend-${Date.now()}`);
  storeMod.store.projects.set(project.id, { ...project, agentBackend: null });

  const res = await app.request('/workflow-runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectName: project.name, title: 'should not start', type: 'feature' }),
  });

  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({
    needsAgentBackendSetup: true,
    error: expect.stringContaining('Agent Backend'),
  });
});

test('artifact content routes return latest local artifact text for UI drill-down', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ainp-artifact-route-'));
  const first = join(dir, 'requirement-1.md');
  const latest = join(dir, 'requirement-2.md');
  writeFileSync(first, '# Requirement\n\nAC-OLD\n', 'utf8');
  writeFileSync(latest, '# Requirement\n\nAC-LATEST\n', 'utf8');

  const workflowRunId = 'run_artifact_routes';
  for (const artifact of [
    { id: 'art_first', uri: `file://${first}`, createdAt: '2026-05-01T00:00:00.000Z' },
    { id: 'art_latest', uri: `file://${latest}`, createdAt: '2026-05-01T00:00:01.000Z' },
  ]) {
    storeMod.store.artifacts.insert({
      id: artifact.id,
      kind: 'requirement_draft',
      uri: artifact.uri,
      workflowRunId,
      stepRunId: null,
      size: 1,
      contentType: 'text/markdown',
      createdAt: artifact.createdAt,
      metadata: {},
    } satisfies Artifact);
  }

  const byId = await app.request('/artifacts/art_first/content');
  expect(byId.status).toBe(200);
  expect(((await byId.json()) as { text: string }).text).toContain('AC-OLD');

  const latestRes = await app.request(
    `/artifacts/workflow-runs/${workflowRunId}/requirement_draft/latest/content`,
  );
  expect(latestRes.status).toBe(200);
  expect(((await latestRes.json()) as { artifact: { id: string }; text: string })).toMatchObject({
    artifact: { id: 'art_latest' },
    text: expect.stringContaining('AC-LATEST'),
  });
});

// ---- PR1: atomic create + firstMessage (PRD §P0-2 / P0-3) ----------------

/**
 * The bun:sqlite db module is a per-process singleton, so all test files in
 * this directory share the same DB. Sibling tests assert `pending()` length,
 * so each PR1 test below MUST flip its created request to a terminal status
 * before exiting to avoid cross-file pollution.
 */
function markCompleted(requestId: string): void {
  const current = storeMod.store.workflowRequests.get(requestId);
  if (current) storeMod.store.workflowRequests.set(requestId, { ...current, status: 'completed' });
}

test('POST /workflow-requests with firstMessage atomically inserts request + message', async () => {
  const project = seedProject(`first-message-${Date.now()}`);

  const res = await app.request('/workflow-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectName: project.name,
      title: 'add export button to report page',
      type: 'feature',
      firstMessage: { role: 'user', content: 'add export button to report page' },
    }),
  });
  expect(res.status).toBe(201);
  const created = (await res.json()) as { id: string; status: string };
  expect(created.status).toBe('pending');

  const msgRes = await app.request(`/workflow-requests/${created.id}/messages`);
  expect(msgRes.status).toBe(200);
  const body = (await msgRes.json()) as {
    messages: Array<{ role: string; content: string }>;
    status: string;
  };
  expect(body.messages).toHaveLength(1);
  expect(body.messages[0]).toMatchObject({
    role: 'user',
    content: 'add export button to report page',
  });
  expect(body.status).toBe('pending');
  markCompleted(created.id);
});

test('POST /workflow-requests without firstMessage stays backward compatible (no message inserted)', async () => {
  const project = seedProject(`no-first-message-${Date.now()}`);

  const res = await app.request('/workflow-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectName: project.name, title: 'legacy CLI register path' }),
  });
  expect(res.status).toBe(201);
  const created = (await res.json()) as { id: string };

  const msgRes = await app.request(`/workflow-requests/${created.id}/messages`);
  expect(msgRes.status).toBe(200);
  const body = (await msgRes.json()) as { messages: unknown[] };
  expect(body.messages).toEqual([]);
  markCompleted(created.id);
});

test('POST /workflow-requests rejects empty firstMessage.content with 400 and creates nothing', async () => {
  const project = seedProject(`bad-first-message-${Date.now()}`);
  const beforeCount = storeMod.store.workflowRequests.values().length;

  const res = await app.request('/workflow-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectName: project.name,
      title: 'bad payload',
      firstMessage: { role: 'user', content: '   ' },
    }),
  });
  expect(res.status).toBe(400);

  const afterCount = storeMod.store.workflowRequests.values().length;
  // Atomicity: no request was created when firstMessage validation failed.
  expect(afterCount).toBe(beforeCount);
});

test('POST /workflow-requests rejects firstMessage with unknown role', async () => {
  const project = seedProject(`bad-role-${Date.now()}`);
  const res = await app.request('/workflow-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectName: project.name,
      title: 'bad role',
      firstMessage: { role: 'system', content: 'hi' },
    }),
  });
  expect(res.status).toBe(400);
});

// 05-08 new-task-form-flow-startstage-override: validate the new flowId /
// startStage body fields piggyback onto POST /workflow-requests. Empty / null
// = "no override" (server treats as null). Non-empty must be a registered
// FlowId / WorkflowStage (`isFlowId` / `isWorkflowStage`) plus the rule that
// startStage is only meaningful when flowId === 'feature.standard'.

test('POST /workflow-requests accepts a valid flowId override', async () => {
  const project = seedProject(`flow-override-${Date.now()}`);
  const res = await app.request('/workflow-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectName: project.name,
      title: 'refactor entity layer',
      flowId: 'refactor.standard',
    }),
  });
  expect(res.status).toBe(201);
  const created = (await res.json()) as { id: string; flowId: string | null; startStage: string | null };
  expect(created.flowId).toBe('refactor.standard');
  expect(created.startStage).toBeNull();
});

test('POST /workflow-requests accepts flowId+startStage when flow is feature.standard', async () => {
  const project = seedProject(`flow-startstage-${Date.now()}`);
  const res = await app.request('/workflow-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectName: project.name,
      title: 'resume from review',
      flowId: 'feature.standard',
      startStage: 'review',
    }),
  });
  expect(res.status).toBe(201);
  const created = (await res.json()) as { id: string; flowId: string | null; startStage: string | null };
  expect(created.flowId).toBe('feature.standard');
  expect(created.startStage).toBe('review');
});

test('POST /workflow-requests treats empty flowId/startStage as no override', async () => {
  const project = seedProject(`flow-empty-${Date.now()}`);
  const res = await app.request('/workflow-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectName: project.name,
      title: 'auto-routed task',
      flowId: '',
      startStage: '',
    }),
  });
  expect(res.status).toBe(201);
  const created = (await res.json()) as { flowId: string | null; startStage: string | null };
  expect(created.flowId).toBeNull();
  expect(created.startStage).toBeNull();
});

test('POST /workflow-requests rejects an unknown flowId with 400', async () => {
  const project = seedProject(`flow-unknown-${Date.now()}`);
  const res = await app.request('/workflow-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectName: project.name,
      title: 'bad flow',
      flowId: 'nonsense.flow',
    }),
  });
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: string };
  expect(body.error).toMatch(/unknown flowId/i);
});

test('POST /workflow-requests rejects startStage on a non-feature.standard flow', async () => {
  const project = seedProject(`startstage-bad-flow-${Date.now()}`);
  const res = await app.request('/workflow-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectName: project.name,
      title: 'fastforward with stage',
      flowId: 'feature.fastforward',
      startStage: 'review',
    }),
  });
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: string };
  expect(body.error).toMatch(/feature\.standard/i);
});

test('POST /workflow-requests rejects startStage without a flowId', async () => {
  const project = seedProject(`startstage-no-flow-${Date.now()}`);
  const res = await app.request('/workflow-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectName: project.name,
      title: 'orphan stage',
      startStage: 'review',
    }),
  });
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: string };
  expect(body.error).toMatch(/feature\.standard/i);
});

test('POST /workflow-requests rejects an unknown startStage with 400', async () => {
  const project = seedProject(`startstage-unknown-${Date.now()}`);
  const res = await app.request('/workflow-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectName: project.name,
      title: 'bad stage',
      flowId: 'feature.standard',
      startStage: 'no_such_stage',
    }),
  });
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: string };
  expect(body.error).toMatch(/unknown startStage/i);
});
