import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, expect, test } from 'vitest';

process.env.AINP_DB_PATH = join(mkdtempSync(join(tmpdir(), 'ainp-api-test-')), 'ainp.sqlite');

let workflow: typeof import('../src/workflow-engine');
let storeMod: typeof import('../src/store/store');

beforeAll(async () => {
  workflow = await import('../src/workflow-engine');
  storeMod = await import('../src/store/store');
});

test('recordApproval is idempotent for the same workflow run and gate decision', () => {
  const first = workflow.recordApproval({
    workflowRunId: 'run_idempotent_approval',
    gateId: 'requirement_gate',
    approved: true,
    actor: 'web',
    comment: 'first click',
  });
  const second = workflow.recordApproval({
    workflowRunId: 'run_idempotent_approval',
    gateId: 'requirement_gate',
    approved: true,
    actor: 'web',
    comment: 'duplicate click',
  });

  const approvals = storeMod.store.approvals.byWorkflow('run_idempotent_approval');
  const gates = storeMod.store.gateRuns.byWorkflow('run_idempotent_approval');

  expect(second.approval.id).toBe(first.approval.id);
  expect(second.gate.id).toBe(first.gate.id);
  expect(approvals).toHaveLength(1);
  expect(gates.filter((g) => g.gateId === 'requirement_gate')).toHaveLength(1);
});

test('records AgentTask and AgentResult audit rows for a backend invocation', () => {
  const task = workflow.recordAgentTask({
    workflowRunId: 'run_agent_audit',
    stepRunId: 'step_agent_audit',
    kind: 'implementation',
    backend: 'native',
    prompt: 'implement approved design',
    inputArtifactIds: ['art_input'],
  });
  const result = workflow.recordAgentResult({
    taskId: task.id,
    status: 'success',
    summary: 'produced diff',
    outputArtifactIds: ['art_output'],
  });

  expect(storeMod.store.agentTasks.byWorkflow('run_agent_audit')).toMatchObject([
    {
      id: task.id,
      workflowRunId: 'run_agent_audit',
      kind: 'implementation',
      backend: 'native',
      inputArtifactIds: ['art_input'],
    },
  ]);
  expect(storeMod.store.agentResults.byTask(task.id)).toMatchObject({
    id: result.id,
    taskId: task.id,
    status: 'success',
    outputArtifactIds: ['art_output'],
  });
});


test('completeWorkflowRun preserves the failed stage instead of jumping to completion', () => {
  const run = workflow.createWorkflowRun({
    projectId: 'proj_failed_stage',
    type: 'feature',
    title: 'needs approval',
    sourceBranch: 'main',
  });
  const step = workflow.startStep({
    workflowRunId: run.id,
    stage: 'requirement',
    name: 'requirement',
  });
  workflow.finishStep(step.id, 'passed');
  workflow.awaitHuman(run.id, 'requirement');

  const completed = workflow.completeWorkflowRun(run.id, false);

  expect(completed.status).toBe('failed');
  expect(completed.currentStage).toBe('requirement');
});

// ---------------------------------------------------------------------------
// V2 W2-1 / PR3 — createWorkflowRun.flowId end-to-end (PRD AC-12 / AC-13 /
// AC-14 / R19). Verifies the default + explicit + persistence paths so the
// `WorkflowRun.flowId` contract is honored at the API layer before the
// runner reads it via FLOW_REGISTRY.
// ---------------------------------------------------------------------------

test('createWorkflowRun defaults flowId to feature.standard when omitted (AC-13)', () => {
  const run = workflow.createWorkflowRun({
    projectId: 'proj_default_flowid',
    type: 'feature',
    title: 'default flow',
    sourceBranch: 'main',
  });
  expect(run.flowId).toBe('feature.standard');
});

test('createWorkflowRun honors an explicit flowId in params (AC-12)', () => {
  const run = workflow.createWorkflowRun({
    projectId: 'proj_explicit_flowid',
    type: 'feature',
    title: 'explicit flow',
    sourceBranch: 'main',
    flowId: 'feature.standard',
  });
  expect(run.flowId).toBe('feature.standard');
});

test('createWorkflowRun.flowId round-trips through SQLite (AC-4 / AC-5 / AC-11)', () => {
  const run = workflow.createWorkflowRun({
    projectId: 'proj_flowid_roundtrip',
    type: 'feature',
    title: 'roundtrip flow',
    sourceBranch: 'main',
  });
  // Re-read from store (rowToWorkflowRun maps `flow_id` column → `flowId`).
  const reloaded = storeMod.store.workflowRuns.get(run.id);
  expect(reloaded).toBeDefined();
  expect(reloaded!.flowId).toBe('feature.standard');
});

// ---------------------------------------------------------------------------
// V2 W2-4 / PR2 — createWorkflowRun.startStage end-to-end (PRD AC-4 / AC-5 /
// AC-16 / AC-17 / AC-18 + R3 / R4 / R5 / R6 / R19 / R20).
// ---------------------------------------------------------------------------

test('createWorkflowRun defaults startStage to null when omitted (AC-16)', () => {
  const run = workflow.createWorkflowRun({
    projectId: 'proj_default_startstage',
    type: 'feature',
    title: 'default start stage',
    sourceBranch: 'main',
  });
  expect(run.startStage).toBeNull();
});

test('createWorkflowRun honors an explicit startStage in params (AC-17)', () => {
  const run = workflow.createWorkflowRun({
    projectId: 'proj_explicit_startstage',
    type: 'feature',
    title: 'explicit start stage',
    sourceBranch: 'main',
    flowId: 'feature.standard',
    startStage: 'design',
  });
  expect(run.startStage).toBe('design');
});

test('createWorkflowRun.startStage round-trips through SQLite (AC-18)', () => {
  const run = workflow.createWorkflowRun({
    projectId: 'proj_startstage_roundtrip',
    type: 'feature',
    title: 'roundtrip start stage',
    sourceBranch: 'main',
    flowId: 'feature.standard',
    startStage: 'implementation',
  });
  const reloaded = storeMod.store.workflowRuns.get(run.id);
  expect(reloaded).toBeDefined();
  expect(reloaded!.startStage).toBe('implementation');
});

test('createWorkflowRun preserves null startStage round-trip (NULL column read)', () => {
  const run = workflow.createWorkflowRun({
    projectId: 'proj_startstage_null_rt',
    type: 'feature',
    title: 'null start stage roundtrip',
    sourceBranch: 'main',
  });
  const reloaded = storeMod.store.workflowRuns.get(run.id);
  expect(reloaded).toBeDefined();
  expect(reloaded!.startStage).toBeNull();
});
