import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, expect, test } from 'vitest';
import { newId, nowIso, type Project, type RouterRecommendation } from '@ainp/shared';

process.env.AINP_DB_PATH = join(
  mkdtempSync(join(tmpdir(), 'ainp-router-route-test-')),
  'ainp.sqlite',
);

let app: Awaited<typeof import('../src/app')>['app'];
let storeMod: typeof import('../src/store/store');

beforeAll(async () => {
  ({ app } = await import('../src/app'));
  storeMod = await import('../src/store/store');
});

function registerProject(name: string): Project {
  const project: Project = {
    id: newId('proj'),
    name,
    localPath: '/tmp/router-route-test-fixture',
    sourceKind: 'local',
    sourceUrl: null,
    sourceAuthKind: 'none',
    sourceUsername: null,
    sourceCredential: null,
    status: 'active',
    archivedAt: null,
    agentBackend: 'claude_code',
    language: 'java',
    buildTool: 'maven',
    defaultBranch: 'main',
    sourceBranches: ['main'],
    registeredAt: nowIso(),
  };
  storeMod.store.projects.set(project.id, project);
  return project;
}

// ---------------------------------------------------------------------------
// V2 W2-4 / PR3 — POST /router/recommend endpoint contract.
// PRD AC-12 / AC-13 / AC-14 / AC-15 + R15-R17 + R27.
// ---------------------------------------------------------------------------

test('POST /router/recommend returns 200 with RouterRecommendation for a smoke run', async () => {
  const project = registerProject('router-smoke');
  const res = await app.request('/router/recommend', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: project.id,
      title: 'mvn -B test smoke',
      runType: 'smoke',
    }),
  });
  expect(res.status).toBe(200);
  const rec = (await res.json()) as RouterRecommendation;
  expect(rec.flowId).toBe('feature.standard');
  expect(rec.rulesFired).toContain('flow.smoke_to_feature_standard');
  expect(rec.confidence).toBe(1.0);
});

test('POST /router/recommend returns 200 for bugfix → issue.standard', async () => {
  const project = registerProject('router-bugfix');
  const res = await app.request('/router/recommend', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: project.id,
      title: 'NullPointer crash on the payment service when refunding',
      runType: 'bugfix',
    }),
  });
  expect(res.status).toBe(200);
  const rec = (await res.json()) as RouterRecommendation;
  expect(rec.flowId).toBe('issue.standard');
  expect(rec.startStage).toBeNull();
});

test('POST /router/recommend rejects missing projectId with 400', async () => {
  const res = await app.request('/router/recommend', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'no project', runType: 'feature' }),
  });
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: string };
  expect(body.error).toContain('projectId');
});

test('POST /router/recommend rejects unknown projectId with 400', async () => {
  const res = await app.request('/router/recommend', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId: 'proj_not_real', title: 'x', runType: 'feature' }),
  });
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: string };
  expect(body.error).toContain('proj_not_real');
});

test('POST /router/recommend rejects unknown runType with 400', async () => {
  const project = registerProject('router-bad-runtype');
  const res = await app.request('/router/recommend', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: project.id,
      title: 'something',
      runType: 'fictional',
    }),
  });
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: string };
  expect(body.error).toContain('runType');
  expect(body.error).toContain('fictional');
});

test('POST /router/recommend rejects missing title with 400', async () => {
  const project = registerProject('router-no-title');
  const res = await app.request('/router/recommend', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId: project.id, runType: 'feature' }),
  });
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: string };
  expect(body.error).toContain('title');
});
