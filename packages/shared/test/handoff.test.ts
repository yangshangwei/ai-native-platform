import { expect, test } from 'vitest';
import {
  HANDOFF_ADOPTION_DECISIONS,
  HANDOFF_ROLES,
  HANDOFF_STATUSES,
  isHandoffAdoptionDecision,
  isHandoffRole,
  isHandoffStatus,
  type HandoffRecord,
} from '../src';

test('Handoff shared contract enumerates bounded lifecycle fields', () => {
  expect(HANDOFF_STATUSES).toEqual(['requested', 'running', 'completed', 'failed', 'cancelled']);
  expect(HANDOFF_ADOPTION_DECISIONS).toEqual(['pending', 'adopted', 'rejected', 'needs_review']);
  expect(HANDOFF_ROLES).toEqual(['main', 'reviewer', 'debugger', 'verifier', 'planner', 'executor']);

  expect(isHandoffStatus('completed')).toBe(true);
  expect(isHandoffStatus('passed')).toBe(false);
  expect(isHandoffAdoptionDecision('needs_review')).toBe(true);
  expect(isHandoffAdoptionDecision('auto_apply')).toBe(false);
  expect(isHandoffRole('debugger')).toBe(true);
  expect(isHandoffRole('free_agent')).toBe(false);
});

test('Handoff record links parent and child AgentSessions without owning gate status', () => {
  const record: HandoffRecord = {
    id: 'hnd_1',
    workflowRunId: 'run_1',
    stepRunId: 'step_impl',
    parentSessionId: 'ags_parent',
    childSessionId: 'ags_child',
    fromRole: 'main',
    toRole: 'reviewer',
    reason: 'Independent implementation review.',
    inputArtifactIds: ['art_diff'],
    expectedOutput: {
      schemaVersion: 'ainp.handoff.review.v1',
      artifactKind: 'other',
      description: 'Review findings artifact.',
    },
    stopCondition: 'Stop after producing one review artifact.',
    status: 'completed',
    adoptionDecision: 'needs_review',
    outputArtifactIds: ['art_review'],
    createdAt: '2026-06-27T00:00:00.000Z',
    updatedAt: '2026-06-27T00:00:01.000Z',
    completedAt: '2026-06-27T00:00:01.000Z',
    metadata: { gateAuthority: 'gate_engine' },
  };

  expect(record.parentSessionId).toBe('ags_parent');
  expect(record.childSessionId).toBe('ags_child');
  expect(record.adoptionDecision).toBe('needs_review');
  expect(record.metadata.gateAuthority).toBe('gate_engine');
});
