import { expect, test } from 'vitest';
import type {
  FlowDef,
  FlowId,
  StageStep,
  StageStepKind,
  WorkflowRunType,
  WorkflowStage,
} from '../src';

// ---------------------------------------------------------------------------
// V2 W2-1 / PR1: FlowId / FlowDef / StageStep type smoke
//
// These tests keep `tsc --noEmit` honest: removing or renaming any field
// on the shipped Flow contracts would fail to type-check here. Runtime
// assertions only touch the constructed values.
// ---------------------------------------------------------------------------

test('FlowId currently exposes exactly one literal: feature.standard', () => {
  const id: FlowId = 'feature.standard';
  expect(id).toBe('feature.standard');
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
    description: 'V1-equivalent 9-stage pipeline (W2-1 baseline).',
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
