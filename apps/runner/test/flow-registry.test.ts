import { describe, expect, test } from 'vitest';
import type { StageStep, WorkflowStage } from '@ainp/shared';
import { FLOW_REGISTRY } from '../src/flows/registry';

// ---------------------------------------------------------------------------
// V2 Wave 2 / W2-1 / PR2 — FLOW_REGISTRY behavioural smoke + zero-regression
// pin against V1's `runWorkflow()` dispatch order.
//
// PRD acceptance criteria covered:
//   AC-8  FLOW_REGISTRY contains exactly one entry: `feature.standard`
//   AC-9  `feature.standard.stages` length matches V1 effect-stage count
//   AC-10 `stages.map(s => s.stage)` strictly equals a const reference array
//
// The reference array below is intentionally duplicated from the registry —
// it is the *out-of-band* truth the test compares against. If the registry
// is reordered, this assertion is the canary.
// ---------------------------------------------------------------------------

/**
 * V1 dispatch order, taken from `apps/runner/src/orchestrator.ts:99-318`.
 *
 *   Line 100  await runContextPack();                                  // 1
 *   Line 103  await runStage('requirement', ...);                      // 2
 *   Line 106  await runStage('design', ...);                           // 3
 *   Lines 109-179 inline implementation block                          // 4
 *   Lines 182-243 inline build_test block (mvn compile + mvn test)     // 5
 *   Line 246  await runStage('review', ...);                           // 6
 *      then inline acceptance_gate + awaitHuman({ stage: 'review' })
 *   Line 275  await api.stageTransition({ stage: 'completion' });      // 7
 *   Line 285  await api.stageTransition({ stage: 'knowledge' });       // 8
 *
 * `'init'` is excluded — it is a `WorkflowStage` enum value used as a
 * status placeholder (the value of `run.currentStage` when the row is
 * inserted, before any stage starts). It is never dispatched.
 *
 * `'acceptance'` is not in the `WorkflowStage` enum: V1 folds human
 * acceptance into `awaitHuman({ stage: 'review' })` immediately after the
 * review agent emits its artifact, so review owns the gate inline.
 */
const V1_STAGE_ORDER: readonly WorkflowStage[] = [
  'context_pack',
  'requirement',
  'design',
  'implementation',
  'build_test',
  'review',
  'completion',
  'knowledge',
] as const;

describe('FLOW_REGISTRY', () => {
  test('AC-8: exposes exactly one flow (feature.standard) in W2-1', () => {
    expect(Object.keys(FLOW_REGISTRY)).toEqual(['feature.standard']);
  });

  describe('feature.standard', () => {
    const flow = FLOW_REGISTRY['feature.standard'];

    test('id matches its registry key', () => {
      expect(flow.id).toBe('feature.standard');
    });

    test('kind is "feature" (a WorkflowRunType literal)', () => {
      expect(flow.kind).toBe('feature');
    });

    test('description is non-empty (surfaced in UI / docs)', () => {
      expect(typeof flow.description).toBe('string');
      expect(flow.description.length).toBeGreaterThan(0);
    });

    test('AC-9: stages length matches V1 effect-stage count (8; init/acceptance excluded)', () => {
      expect(flow.stages).toHaveLength(V1_STAGE_ORDER.length);
      expect(flow.stages).toHaveLength(8);
    });

    test('AC-10: stages.map(s => s.stage) strictly equals V1 reference order', () => {
      const order = flow.stages.map((s: StageStep) => s.stage);
      expect(order).toEqual([...V1_STAGE_ORDER]);
    });

    test('every step.kind is one of the four StageStepKind buckets', () => {
      const buckets = new Set<string>(['agent', 'gate', 'human', 'engine']);
      for (const step of flow.stages) {
        expect(buckets.has(step.kind)).toBe(true);
      }
    });

    test('build_test, completion, knowledge are runner-side engine stages', () => {
      const byStage = Object.fromEntries(flow.stages.map((s) => [s.stage, s]));
      expect(byStage.build_test.kind).toBe('engine');
      expect(byStage.completion.kind).toBe('engine');
      expect(byStage.knowledge.kind).toBe('engine');
    });

    test('agent stages declare a non-empty skillId; engine stages do not', () => {
      // W2-1=α does not yet read skillId at runtime; W2-3 starts consuming it
      // through the dispatcher. We declare skillIds eagerly so the surface is
      // stable when W2-3 lands.
      for (const step of flow.stages) {
        if (step.kind === 'agent') {
          expect(typeof step.skillId).toBe('string');
          expect(step.skillId!.length).toBeGreaterThan(0);
        } else {
          expect(step.skillId).toBeUndefined();
        }
      }
    });
  });
});
