import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, expect, test } from 'vitest';
import { newId, nowIso, type Project, type WorkflowRun } from '@ainp/shared';

process.env.AINP_DB_PATH = join(
  mkdtempSync(join(tmpdir(), 'ainp-workflow-runs-route-test-')),
  'ainp.sqlite',
);
process.env.AINP_HOME = join(
  mkdtempSync(join(tmpdir(), 'ainp-workflow-runs-route-home-')),
  '.ai-native',
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
    localPath: '/tmp/route-test-fixture',
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
// V2 W2-3 PR2 — POST /workflow-runs honors body.flowId end-to-end.
// PRD W2-3 AC-9 / AC-10 (HTTP route plumbing).
// ---------------------------------------------------------------------------

test('POST /workflow-runs without flowId defaults to feature.standard (W2-3 AC-10)', async () => {
  const project = registerProject('ff-route-default');

  const res = await app.request('/workflow-runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectName: project.name,
      type: 'feature',
      title: 'no flowId in body',
    }),
  });

  expect(res.status).toBe(201);
  const run = (await res.json()) as WorkflowRun;
  expect(run.flowId).toBe('feature.standard');
});

test('POST /workflow-runs honors body.flowId = feature.fastforward (W2-3 AC-9)', async () => {
  const project = registerProject('ff-route-explicit');

  const res = await app.request('/workflow-runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectName: project.name,
      type: 'feature',
      title: 'fastforward via body',
      flowId: 'feature.fastforward',
    }),
  });

  expect(res.status).toBe(201);
  const run = (await res.json()) as WorkflowRun;
  expect(run.flowId).toBe('feature.fastforward');

  // Persistence sanity: the row in workflow_runs.flow_id matches.
  const reloaded = storeMod.store.workflowRuns.get(run.id);
  expect(reloaded?.flowId).toBe('feature.fastforward');
});

test('POST /workflow-runs honors body.flowId = feature.standard (explicit form of default)', async () => {
  const project = registerProject('ff-route-explicit-standard');

  const res = await app.request('/workflow-runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectName: project.name,
      type: 'feature',
      title: 'standard via body',
      flowId: 'feature.standard',
    }),
  });

  expect(res.status).toBe(201);
  const run = (await res.json()) as WorkflowRun;
  expect(run.flowId).toBe('feature.standard');
});

test('POST /workflow-runs rejects an unknown flowId with 400 (trust-boundary validation)', async () => {
  const project = registerProject('ff-route-bogus');

  const res = await app.request('/workflow-runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectName: project.name,
      type: 'feature',
      title: 'should reject',
      flowId: 'feature.bogus',
    }),
  });

  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: string };
  expect(body.error).toContain('feature.bogus');
  expect(body.error).toContain('feature.standard');
  expect(body.error).toContain('feature.fastforward');
});
