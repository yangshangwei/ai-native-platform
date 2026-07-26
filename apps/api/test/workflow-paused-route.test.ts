/**
 * 07-26 operational-unavailable-state — route tests for
 * `POST /runner/events/workflow-paused` (PRD R3, AC-001/002/003 route layer).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, expect, test } from 'vitest';
import { newId, nowIso, type Project, type WorkflowRun } from '@ainp/shared';

process.env.AINP_DB_PATH = join(
  mkdtempSync(join(tmpdir(), 'ainp-workflow-paused-route-test-')),
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
    localPath: '/tmp/paused-route-test-fixture',
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

async function createRun(projectName: string, title: string): Promise<WorkflowRun> {
  const project = registerProject(projectName);
  const res = await app.request('/workflow-runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectName: project.name, type: 'feature', title }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as WorkflowRun;
}

async function postWorkflowPaused(body: unknown): Promise<Response> {
  return app.request('/runner/events/workflow-paused', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('pauses a run with reason/detail/worktreeHead and records the audit row', async () => {
  const run = await createRun('paused-route-basic', 'pause via route');

  const res = await postWorkflowPaused({
    workflowRunId: run.id,
    stage: 'implementation',
    reason: 'backend_timeout',
    detail: 'claude exited -1 during implementation',
    worktreeHead: 'deadbeef',
  });

  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean; run: WorkflowRun };
  expect(body.ok).toBe(true);
  expect(body.run.status).toBe('paused');
  expect(body.run.currentStage).toBe('implementation');

  const audits = storeMod.store.auditLog
    .byWorkflow(run.id)
    .filter((entry) => entry.kind === 'workflow_run.paused');
  expect(audits).toHaveLength(1);
  expect(audits[0]!.payload).toMatchObject({
    stage: 'implementation',
    reason: 'backend_timeout',
    detail: 'claude exited -1 during implementation',
    worktreeHead: 'deadbeef',
  });
});

test('400 on missing required fields', async () => {
  const res = await postWorkflowPaused({ workflowRunId: 'run_missing_fields' });
  expect(res.status).toBe(400);
  expect(((await res.json()) as { error: string }).error).toMatch(/workflowRunId, stage, reason required/);
});

test('400 on unknown stage or unknown reason (trust-boundary guards)', async () => {
  const run = await createRun('paused-route-guards', 'pause guards');

  const badStage = await postWorkflowPaused({
    workflowRunId: run.id,
    stage: 'not_a_stage',
    reason: 'backend_timeout',
  });
  expect(badStage.status).toBe(400);
  expect(((await badStage.json()) as { error: string }).error).toMatch(/unknown stage/);

  const badReason = await postWorkflowPaused({
    workflowRunId: run.id,
    stage: 'implementation',
    reason: 'business_gate_failed',
  });
  expect(badReason.status).toBe(400);
  expect(((await badReason.json()) as { error: string }).error).toMatch(/unknown pause reason/);
});

test('404 on unknown workflowRunId', async () => {
  const res = await postWorkflowPaused({
    workflowRunId: 'run_does_not_exist',
    stage: 'implementation',
    reason: 'backend_unavailable',
  });
  expect(res.status).toBe(404);
});

test('400 when pausing a cancelled run (AC-007)', async () => {
  const run = await createRun('paused-route-cancelled', 'pause cancelled route');
  storeMod.store.workflowRuns.set(run.id, {
    ...storeMod.store.workflowRuns.get(run.id)!,
    status: 'cancelled',
  });

  const res = await postWorkflowPaused({
    workflowRunId: run.id,
    stage: 'implementation',
    reason: 'backend_timeout',
  });
  expect(res.status).toBe(400);
  expect(((await res.json()) as { error: string }).error).toMatch(/cannot pause a cancelled run/);
});
