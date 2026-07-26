/**
 * 07-26 operational-unavailable-state — engine-level tests for the paused
 * fourth state (PRD R3/R6/R7/R8, AC-005/006/007).
 *
 * Operational failures park the run/request as `paused` (worktree kept,
 * manual resume); business failures keep the historical `failed` path
 * byte-for-byte.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, expect, test } from 'vitest';

process.env.AINP_DB_PATH ??= join(mkdtempSync(join(tmpdir(), 'ainp-api-test-')), 'ainp.sqlite');

let workflow: typeof import('../src/workflow-engine');
let storeMod: typeof import('../src/store/store');

beforeAll(async () => {
  workflow = await import('../src/workflow-engine');
  storeMod = await import('../src/store/store');
});

function createRun(title: string) {
  return workflow.createWorkflowRun({
    projectId: 'proj_pause_test',
    type: 'feature',
    title,
  });
}

function createClaimedRequestForRun(runId: string, title: string) {
  const request = workflow.createWorkflowRequest({
    projectId: 'proj_pause_test',
    type: 'feature',
    title,
    branch: 'main',
  });
  workflow.claimWorkflowRequest({ requestId: request.id, runnerId: 'runner@test' });
  workflow.markWorkflowRequestRunStarted({ requestId: request.id, workflowRunId: runId });
  return storeMod.store.workflowRequests.get(request.id)!;
}

function pausedAuditRows(runId: string) {
  return storeMod.store.auditLog
    .byWorkflow(runId)
    .filter((entry) => entry.kind === 'workflow_run.paused');
}

test('pauseWorkflowRun parks the run as paused with a full-context audit row', () => {
  const run = createRun('pause basic');

  const paused = workflow.pauseWorkflowRun({
    workflowRunId: run.id,
    stage: 'implementation',
    reason: 'backend_timeout',
    detail: 'claude exited -1 during implementation',
    worktreeHead: 'abc123',
  });

  expect(paused.status).toBe('paused');
  expect(paused.currentStage).toBe('implementation');
  const audits = pausedAuditRows(run.id);
  expect(audits).toHaveLength(1);
  expect(audits[0]!.payload).toMatchObject({
    stage: 'implementation',
    reason: 'backend_timeout',
    detail: 'claude exited -1 during implementation',
    worktreeHead: 'abc123',
  });
  // No completion audit: the run did not "finish".
  const completions = storeMod.store.auditLog
    .byWorkflow(run.id)
    .filter((entry) => entry.kind === 'workflow_run.completed');
  expect(completions).toHaveLength(0);
});

test('pauseWorkflowRun links the claimed request to paused (AC-001 request half)', () => {
  const run = createRun('pause links request');
  const request = createClaimedRequestForRun(run.id, 'pause links request');
  expect(request.status).toBe('claimed');

  workflow.pauseWorkflowRun({
    workflowRunId: run.id,
    stage: 'implementation',
    reason: 'backend_unavailable',
    detail: 'Claude Code is not ready (needs_login).',
  });

  const linked = storeMod.store.workflowRequests.get(request.id)!;
  expect(linked.status).toBe('paused');
  expect(linked.error).toBe('Claude Code is not ready (needs_login).');
});

test('AC-007: pausing an already-paused run is idempotent (single audit row)', () => {
  const run = createRun('pause idempotent');
  workflow.pauseWorkflowRun({
    workflowRunId: run.id,
    stage: 'implementation',
    reason: 'backend_protocol',
    detail: 'first pause',
  });
  workflow.pauseWorkflowRun({
    workflowRunId: run.id,
    stage: 'implementation',
    reason: 'backend_protocol',
    detail: 'duplicate pause',
  });

  expect(storeMod.store.workflowRuns.get(run.id)!.status).toBe('paused');
  expect(pausedAuditRows(run.id)).toHaveLength(1);
});

test('AC-007: a cancelled run cannot be paused', () => {
  const run = createRun('pause cancelled');
  const cancelled = { ...run, status: 'cancelled' as const };
  storeMod.store.workflowRuns.set(run.id, cancelled);

  expect(() =>
    workflow.pauseWorkflowRun({
      workflowRunId: run.id,
      stage: 'implementation',
      reason: 'backend_timeout',
    }),
  ).toThrow(/cannot pause a cancelled run/);
  expect(storeMod.store.workflowRuns.get(run.id)!.status).toBe('cancelled');
});

test('AC-006 / R8: late workflowCompleted(ok=false) does not demote a paused run', () => {
  const run = createRun('pause late completion');
  workflow.pauseWorkflowRun({
    workflowRunId: run.id,
    stage: 'build_test',
    reason: 'backend_timeout',
  });

  const after = workflow.completeWorkflowRun(run.id, false);

  expect(after.status).toBe('paused');
  const completions = storeMod.store.auditLog
    .byWorkflow(run.id)
    .filter((entry) => entry.kind === 'workflow_run.completed');
  expect(completions).toHaveLength(0);
});

test('R8: workflowCompleted(ok=true) on a paused run passes through normally', () => {
  const run = createRun('pause success completion');
  workflow.pauseWorkflowRun({
    workflowRunId: run.id,
    stage: 'build_test',
    reason: 'backend_protocol',
  });

  const after = workflow.completeWorkflowRun(run.id, true);

  expect(after.status).toBe('passed');
});

test('AC-005: retryStage lets a paused run resume (run -> running, step -> pending)', () => {
  const run = createRun('pause retry stage');
  workflow.pauseWorkflowRun({
    workflowRunId: run.id,
    stage: 'implementation',
    reason: 'backend_timeout',
  });

  const { run: resumed, step } = workflow.retryStage({
    workflowRunId: run.id,
    stage: 'implementation',
    actor: 'web',
  });

  expect(resumed.status).toBe('running');
  expect(resumed.currentStage).toBe('implementation');
  expect(step.status).toBe('pending');
});

test('AC-005: resume closure — completion after pause syncs the paused request', () => {
  const run = createRun('pause resume closure');
  const request = createClaimedRequestForRun(run.id, 'pause resume closure');

  workflow.pauseWorkflowRun({
    workflowRunId: run.id,
    stage: 'implementation',
    reason: 'backend_timeout',
    detail: 'claude exited -1 during implementation',
  });
  expect(storeMod.store.workflowRequests.get(request.id)!.status).toBe('paused');

  // Manual resume: retryStage flips the run back to running…
  workflow.retryStage({ workflowRunId: run.id, stage: 'implementation', actor: 'web' });
  // …and the resumed orchestrate finishes successfully.
  const finished = workflow.completeWorkflowRun(run.id, true);

  expect(finished.status).toBe('passed');
  expect(storeMod.store.workflowRequests.get(request.id)!.status).toBe('completed');
  expect(storeMod.store.workflowRequests.get(request.id)!.error).toBeNull();
});

test('resume closure — a real failure after resume marks the paused request failed', () => {
  const run = createRun('pause resume then fail');
  const request = createClaimedRequestForRun(run.id, 'pause resume then fail');

  workflow.pauseWorkflowRun({
    workflowRunId: run.id,
    stage: 'build_test',
    reason: 'backend_protocol',
    detail: 'codex exited 2 for stage build_test',
  });
  workflow.retryStage({ workflowRunId: run.id, stage: 'build_test', actor: 'web' });

  // The run is now `running`, so the R8 defense does not shield it: a real
  // business failure lands as failed and closes the paused request.
  const finished = workflow.completeWorkflowRun(run.id, false);

  expect(finished.status).toBe('failed');
  expect(storeMod.store.workflowRequests.get(request.id)!.status).toBe('failed');
});

test('R7: completing a run with a claimed (non-paused) request leaves the request untouched', () => {
  const run = createRun('business path untouched');
  const request = createClaimedRequestForRun(run.id, 'business path untouched');

  const finished = workflow.completeWorkflowRun(run.id, false);

  expect(finished.status).toBe('failed');
  // The watch loop owns claimed-request completion — the engine must not
  // touch it here (byte-for-byte business path, PRD R7).
  expect(storeMod.store.workflowRequests.get(request.id)!.status).toBe('claimed');
});
