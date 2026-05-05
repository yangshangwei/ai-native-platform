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

test('POST /workflow-runs without flowId routes via smart-router (W2-4 AC-13)', async () => {
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
  // PR3 swap: short feature title → router picks feature.fastforward.
  expect(run.flowId).toBe('feature.fastforward');
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

test('POST /workflow-runs honors body.flowId = issue.standard (W2-2a AC-20)', async () => {
  const project = registerProject('issue-route-explicit');

  const res = await app.request('/workflow-runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectName: project.name,
      type: 'bugfix',
      title: 'issue via body',
      flowId: 'issue.standard',
    }),
  });

  expect(res.status).toBe(201);
  const run = (await res.json()) as WorkflowRun;
  expect(run.flowId).toBe('issue.standard');
  // PRD ADR Q2: FlowDef.kind='bugfix' but type plumbed from body.type;
  // route doesn't enforce type↔flow correspondence (W2-4 router will).
  expect(run.type).toBe('bugfix');

  // Persistence sanity: the row in workflow_runs.flow_id matches.
  const reloaded = storeMod.store.workflowRuns.get(run.id);
  expect(reloaded?.flowId).toBe('issue.standard');
});

test('POST /workflow-runs honors body.flowId = refactor.standard (W2-2b AC-18)', async () => {
  const project = registerProject('refactor-route-explicit');

  const res = await app.request('/workflow-runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectName: project.name,
      type: 'refactor',
      title: 'refactor via body',
      flowId: 'refactor.standard',
    }),
  });

  expect(res.status).toBe(201);
  const run = (await res.json()) as WorkflowRun;
  expect(run.flowId).toBe('refactor.standard');
  // PRD ADR Q2=A: WorkflowRunType extended; FlowDef.kind='refactor' matches
  // body.type='refactor' (clean naming, unlike W2-2a's 'bugfix' asymmetry).
  expect(run.type).toBe('refactor');

  // Persistence sanity: the row in workflow_runs.flow_id matches.
  const reloaded = storeMod.store.workflowRuns.get(run.id);
  expect(reloaded?.flowId).toBe('refactor.standard');
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
  expect(body.error).toContain('issue.standard');
  expect(body.error).toContain('refactor.standard');
});
