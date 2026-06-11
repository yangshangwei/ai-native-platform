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

test('claim is atomic: a rival claim landing inside the read/write window cannot double-claim', () => {
  const project = seedProject();
  const request = workflow.createWorkflowRequest({
    projectId: project.id,
    type: 'feature',
    title: 'concurrent claim target',
    branch: project.defaultBranch,
  });

  // Simulate the TOCTOU interleaving: the moment runner A reads the request
  // (a non-atomic implementation reads before writing), runner B's claim
  // lands. Under "get then set" both claims pass the status check and both
  // succeed; under an atomic UPDATE ... WHERE status='pending' exactly one
  // caller wins. If the implementation never does a pre-write read, runner B
  // claims right after runner A instead — the invariant must hold either way.
  const repo = storeMod.store.workflowRequests;
  const originalGet = repo.get;
  let rivalResult: ReturnType<typeof workflow.claimWorkflowRequest> | undefined;
  const fireRivalClaim = () => {
    repo.get = originalGet;
    rivalResult = workflow.claimWorkflowRequest({
      requestId: request.id,
      runnerId: 'runner-b@test',
    });
  };
  repo.get = (id: string) => {
    const value = originalGet(id);
    if (rivalResult === undefined && id === request.id) fireRivalClaim();
    return value;
  };

  let resultA: ReturnType<typeof workflow.claimWorkflowRequest>;
  try {
    resultA = workflow.claimWorkflowRequest({
      requestId: request.id,
      runnerId: 'runner-a@test',
    });
  } finally {
    repo.get = originalGet;
  }
  if (rivalResult === undefined) fireRivalClaim();

  const outcomes = [resultA, rivalResult].filter((r) => r !== null);
  expect(outcomes).toHaveLength(1); // exactly one claimer wins
  const final = repo.get(request.id);
  expect(final?.status).toBe('claimed');
  expect(final?.claimedBy).toBe(outcomes[0]?.claimedBy);
});

test('store.claimIfPending returns null and writes nothing when status precondition fails', () => {
  const project = seedProject();
  const request = workflow.createWorkflowRequest({
    projectId: project.id,
    type: 'feature',
    title: 'already claimed request',
    branch: project.defaultBranch,
  });
  const claimed = storeMod.store.workflowRequests.claimIfPending({
    id: request.id,
    runnerId: 'runner-1@test',
    updatedAt: nowIso(),
  });
  expect(claimed?.status).toBe('claimed');

  const rejected = storeMod.store.workflowRequests.claimIfPending({
    id: request.id,
    runnerId: 'runner-2@test',
    updatedAt: nowIso(),
  });
  expect(rejected).toBeNull();
  expect(storeMod.store.workflowRequests.get(request.id)?.claimedBy).toBe('runner-1@test');

  expect(
    storeMod.store.workflowRequests.claimIfPending({
      id: 'wreq_missing',
      runnerId: 'runner-1@test',
      updatedAt: nowIso(),
    }),
  ).toBeNull();
});

test('markWorkflowRequestRunStarted rejects requests that are not claimed', () => {
  const project = seedProject();
  const request = workflow.createWorkflowRequest({
    projectId: project.id,
    type: 'feature',
    title: 'run-started precondition',
    branch: project.defaultBranch,
  });

  // Still pending — precondition `status = 'claimed'` not met.
  expect(() =>
    workflow.markWorkflowRequestRunStarted({ requestId: request.id, workflowRunId: 'run_x' }),
  ).toThrow(/not claimed/);
  expect(storeMod.store.workflowRequests.get(request.id)?.workflowRunId).toBeNull();

  expect(() =>
    workflow.markWorkflowRequestRunStarted({ requestId: 'wreq_missing', workflowRunId: 'run_x' }),
  ).toThrow(/not found/);
});

test('completeWorkflowRequest fails for a missing request', () => {
  expect(() =>
    workflow.completeWorkflowRequest({
      requestId: 'wreq_missing',
      workflowRunId: null,
      ok: true,
      error: null,
    }),
  ).toThrow(/not found/);
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
