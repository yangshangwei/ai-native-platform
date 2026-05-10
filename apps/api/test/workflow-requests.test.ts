import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, expect, test } from 'vitest';
import { newId, nowIso, type Project } from '@ainp/shared';

process.env.AINP_DB_PATH = join(mkdtempSync(join(tmpdir(), 'ainp-request-test-')), 'ainp.sqlite');

let workflow: typeof import('../src/workflow-engine');
let storeMod: typeof import('../src/store/store');

beforeAll(async () => {
  workflow = await import('../src/workflow-engine');
  storeMod = await import('../src/store/store');
});

function seedProject(): Project {
  const project: Project = {
    id: newId('proj'),
    name: `request-project-${Date.now()}`,
    localPath: '/tmp/request-project',
    language: 'java',
    buildTool: 'maven',
    defaultBranch: 'main',
    registeredAt: nowIso(),
  };
  storeMod.store.projects.set(project.id, project);
  return project;
}

test('creates and claims workflow requests for runner watch mode', () => {
  const project = seedProject();
  const request = workflow.createWorkflowRequest({
    projectId: project.id,
    type: 'feature',
    title: 'add export button',
    branch: project.defaultBranch,
  });

  expect(request.status).toBe('pending');
  expect(storeMod.store.workflowRequests.pending().map((item) => item.id)).toContain(request.id);

  const claimed = workflow.claimWorkflowRequest({
    requestId: request.id,
    runnerId: 'runner@test',
  });
  expect(claimed?.status).toBe('claimed');
  expect(claimed?.claimedBy).toBe('runner@test');
  expect(workflow.claimWorkflowRequest({ requestId: request.id, runnerId: 'runner2@test' })).toBeNull();
});

test('completes a claimed workflow request with the resulting workflow run id', () => {
  const project = seedProject();
  const request = workflow.createWorkflowRequest({
    projectId: project.id,
    type: 'bugfix',
    title: 'fix calculator',
    branch: project.defaultBranch,
  });
  const claimed = workflow.claimWorkflowRequest({ requestId: request.id, runnerId: 'runner@test' });
  expect(claimed).not.toBeNull();

  const completed = workflow.completeWorkflowRequest({
    requestId: request.id,
    workflowRunId: 'run_from_watch',
    ok: true,
    error: null,
  });

  expect(completed.status).toBe('completed');
  expect(completed.workflowRunId).toBe('run_from_watch');
});
