import { expect, test } from 'bun:test';
import {
  STEP_CHECKPOINT_STATUSES,
  isStepCheckpointStatus,
  type StepCheckpoint,
} from '../src';

test('StepCheckpoint shared contract enumerates durable step states', () => {
  expect(STEP_CHECKPOINT_STATUSES).toEqual([
    'pending',
    'running',
    'passed',
    'failed',
    'cancelled',
    'skipped',
  ]);
  expect(isStepCheckpointStatus('running')).toBe(true);
  expect(isStepCheckpointStatus('passed')).toBe(true);
  expect(isStepCheckpointStatus('pending')).toBe(true);
  expect(isStepCheckpointStatus('blocked')).toBe(false);
});

test('StepCheckpoint shape links agent runtime evidence without owning gate status', () => {
  const checkpoint: StepCheckpoint = {
    id: 'scp_1',
    workflowRunId: 'run_1',
    stepRunId: 'step_1',
    stage: 'implementation',
    status: 'failed',
    inputArtifactIds: ['art_design'],
    outputArtifactIds: ['art_diff'],
    contextPackId: 'ctx_1',
    agentSessionIds: ['ags_base', 'ags_retry'],
    toolInvocationIds: ['tinv_diff'],
    gateRunIds: ['gate_scope'],
    retryIndex: 1,
    resumeCursor: null,
    failureReason: 'diff_scope_gate failed',
    createdAt: '2026-06-27T00:00:00.000Z',
    updatedAt: '2026-06-27T00:00:01.000Z',
    metadata: { source: 'runner-events' },
  };

  expect(checkpoint.contextPackId).toBe('ctx_1');
  expect(checkpoint.agentSessionIds).toContain('ags_retry');
  expect(checkpoint.gateRunIds).toContain('gate_scope');
});
