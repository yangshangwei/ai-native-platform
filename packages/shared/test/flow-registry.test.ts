import { expect, test } from 'vitest';
import type {
  FlowDef,
  FlowId,
  StageStep,
  StageStepKind,
  WorkflowRunType,
  WorkflowStage,
} from '../src';
import { FLOW_REGISTRY, KNOWN_FLOW_IDS, isFlowId, isWorkflowStage } from '../src';

// ---------------------------------------------------------------------------
// V2 W2-1 / PR1: FlowId / FlowDef / StageStep type smoke
//
// These tests keep `tsc --noEmit` honest: removing or renaming any field
// on the shipped Flow contracts would fail to type-check here. Runtime
// assertions only touch the constructed values.
// ---------------------------------------------------------------------------

test('FlowId carries registered flow ids', () => {
  const std: FlowId = 'feature.standard';
  const ff: FlowId = 'feature.fastforward';
  const profile: FlowId = 'profile.bootstrap';
  expect(std).toBe('feature.standard');
  expect(ff).toBe('feature.fastforward');
  expect(profile).toBe('profile.bootstrap');
});

test('WorkflowRunType carries profile runs', () => {
  const runType: WorkflowRunType = 'profile';
  expect(runType).toBe('profile');
});

test('isWorkflowStage accepts profile bootstrap stages', () => {
  const inventory: WorkflowStage = 'inventory';
  const profile: WorkflowStage = 'profile';
  expect(isWorkflowStage(inventory)).toBe(true);
  expect(isWorkflowStage(profile)).toBe(true);
  expect(isWorkflowStage('not_a_stage')).toBe(false);
});

test('StageStepKind enumerates the four dispatch buckets', () => {
  const kinds: StageStepKind[] = ['agent', 'gate', 'human', 'engine'];
  expect(kinds).toHaveLength(4);
});

test('StageStep can be instantiated with all required + optional fields', () => {
  const stageRequirement: WorkflowStage = 'requirement';
  const step: StageStep = {
    stage: stageRequirement,
    kind: 'agent',
    skillId: 'cs-feat-design',
  };
  expect(step.stage).toBe('requirement');
  expect(step.kind).toBe('agent');
  expect(step.skillId).toBe('cs-feat-design');
});

test('StageStep skillId is optional', () => {
  const step: StageStep = { stage: 'build_test', kind: 'engine' };
  expect(step.skillId).toBeUndefined();
});

test('FlowDef shape carries id, kind, description, stages and a stable order', () => {
  const flow: FlowDef = {
    id: 'feature.standard',
    kind: 'feature' satisfies WorkflowRunType,
    description: 'V1-equivalent 8-stage pipeline (W2-1 baseline).',
    stages: [
      { stage: 'context_pack', kind: 'agent', skillId: 'context_pack' },
      { stage: 'requirement', kind: 'agent', skillId: 'cs-req' },
      { stage: 'design', kind: 'agent', skillId: 'cs-feat-design' },
      { stage: 'implementation', kind: 'agent', skillId: 'cs-feat-impl' },
      { stage: 'build_test', kind: 'engine' },
      { stage: 'review', kind: 'agent', skillId: 'cs-feat-accept' },
      { stage: 'completion', kind: 'engine' },
      { stage: 'knowledge', kind: 'engine' },
    ] as const,
  };
  expect(flow.id).toBe('feature.standard');
  expect(flow.kind).toBe('feature');
  expect(flow.stages).toHaveLength(8);
});

test('FlowDef.stages is readonly — type-level only; runtime is just an array', () => {
  // Runtime: stages is iterable like any array.
  const flow: FlowDef = {
    id: 'feature.standard',
    kind: 'feature',
    description: '',
    stages: [{ stage: 'context_pack', kind: 'agent' }],
  };
  let count = 0;
  for (const _ of flow.stages) count++;
  expect(count).toBe(1);
});

test('FlowDef.kind links to WorkflowRunType — typed compile-time mapping', () => {
  // This is purely a compile-time check: feeding a non-WorkflowRunType
  // value into FlowDef.kind would trip tsc. The runtime assertion
  // exists so Bun records the test ran.
  const featureFlow: FlowDef = {
    id: 'feature.standard',
    kind: 'feature',
    description: '',
    stages: [],
  };
  expect(featureFlow.kind satisfies WorkflowRunType).toBe('feature');
});

test('KNOWN_FLOW_IDS is derived from FLOW_REGISTRY keys in registration order', () => {
  expect(KNOWN_FLOW_IDS).toEqual([
    'feature.standard',
    'feature.fastforward',
    'issue.standard',
    'refactor.standard',
    'profile.bootstrap',
  ]);
  expect(KNOWN_FLOW_IDS).toEqual(Object.keys(FLOW_REGISTRY));
});

test('isFlowId accepts registered ids and rejects everything else', () => {
  for (const id of KNOWN_FLOW_IDS) expect(isFlowId(id)).toBe(true);
  expect(isFlowId('feature.unknown')).toBe(false);
  expect(isFlowId('')).toBe(false);
  expect(isFlowId(undefined)).toBe(false);
  expect(isFlowId(42)).toBe(false);
});
