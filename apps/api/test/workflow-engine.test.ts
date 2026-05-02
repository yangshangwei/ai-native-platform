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
