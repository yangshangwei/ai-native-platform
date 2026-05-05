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
  test('exposes V2 Wave 2 flows: feature.standard + feature.fastforward (W2-3) + issue.standard (W2-2a)', () => {
    expect(Object.keys(FLOW_REGISTRY).sort()).toEqual([
      'feature.fastforward',
      'feature.standard',
      'issue.standard',
    ]);
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

  // ---------------------------------------------------------------------------
  // V2 W2-3 — feature.fastforward: 4-stage strict subset of feature.standard.
  // PRD AC-4 / AC-5 / AC-6 / AC-7 / AC-8 (the W2-3 task PRD, not W2-1's).
  // ---------------------------------------------------------------------------

  describe('feature.fastforward (W2-3)', () => {
    const flow = FLOW_REGISTRY['feature.fastforward'];

    /**
     * Reference order: 4 stages, strictly the subset of `feature.standard`
     * that DOES the work + audits it. Skips `context_pack` / `requirement` /
     * `design` (front-end) and `knowledge` (back-end). Keeps `review` because
     * V1 review owns the human acceptance gate; fastforward MUST NOT bypass
     * human ack.
     */
    const FASTFORWARD_STAGE_ORDER: readonly WorkflowStage[] = [
      'implementation',
      'build_test',
      'review',
      'completion',
    ] as const;

    test('id matches its registry key', () => {
      expect(flow.id).toBe('feature.fastforward');
    });

    test('AC-7: kind is "feature" (variant of the same WorkflowRunType)', () => {
      expect(flow.kind).toBe('feature');
    });

    test('description is non-empty', () => {
      expect(typeof flow.description).toBe('string');
      expect(flow.description.length).toBeGreaterThan(0);
    });

    test('AC-5: stages length is exactly 4', () => {
      expect(flow.stages).toHaveLength(4);
      expect(flow.stages).toHaveLength(FASTFORWARD_STAGE_ORDER.length);
    });

    test('AC-6: stages.map(s => s.stage) strictly equals fastforward reference order', () => {
      const order = flow.stages.map((s: StageStep) => s.stage);
      expect(order).toEqual([...FASTFORWARD_STAGE_ORDER]);
    });

    test('skipped stages are NOT in the list (context_pack/requirement/design/knowledge)', () => {
      const present = new Set(flow.stages.map((s) => s.stage));
      expect(present.has('context_pack')).toBe(false);
      expect(present.has('requirement')).toBe(false);
      expect(present.has('design')).toBe(false);
      expect(present.has('knowledge')).toBe(false);
    });

    test('build_test + completion are runner-side engine stages', () => {
      const byStage = Object.fromEntries(flow.stages.map((s) => [s.stage, s]));
      expect(byStage.build_test.kind).toBe('engine');
      expect(byStage.completion.kind).toBe('engine');
    });

    test('implementation + review are agent stages with skillIds', () => {
      const byStage = Object.fromEntries(flow.stages.map((s) => [s.stage, s]));
      expect(byStage.implementation.kind).toBe('agent');
      expect(byStage.implementation.skillId).toBe('cs-feat-impl');
      expect(byStage.review.kind).toBe('agent');
      expect(byStage.review.skillId).toBe('cs-feat-accept');
    });

    test('every step.kind is one of the four StageStepKind buckets', () => {
      const buckets = new Set<string>(['agent', 'gate', 'human', 'engine']);
      for (const step of flow.stages) {
        expect(buckets.has(step.kind)).toBe(true);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // V2 W2-2a — issue.standard: 6-stage issue/bug pipeline.
  // PRD AC-4 / AC-5 / AC-6 / AC-7 / AC-8 (W2-2a task PRD).
  // ---------------------------------------------------------------------------

  describe('issue.standard (W2-2a)', () => {
    const flow = FLOW_REGISTRY['issue.standard'];

    /**
     * Reference order: 6 stages — issue work-type's own front-end (report,
     * analyze) plus the back-end shared with feature flows (implementation,
     * build_test, review, completion). Skips `context_pack` / `requirement`
     * / `design` / `knowledge` (issue has no PRD/design and rarely produces
     * reusable knowledge from a single bug). `fix` reuses `implementation`
     * (PRD ADR Q1).
     */
    const ISSUE_STANDARD_STAGE_ORDER: readonly WorkflowStage[] = [
      'report',
      'analyze',
      'implementation',
      'build_test',
      'review',
      'completion',
    ] as const;

    test('id matches its registry key', () => {
      expect(flow.id).toBe('issue.standard');
    });

    test('AC-8: kind is "bugfix" (reuses existing WorkflowRunType, PRD ADR Q2)', () => {
      expect(flow.kind).toBe('bugfix');
    });

    test('description is non-empty', () => {
      expect(typeof flow.description).toBe('string');
      expect(flow.description.length).toBeGreaterThan(0);
    });

    test('AC-6: stages length is exactly 6', () => {
      expect(flow.stages).toHaveLength(6);
      expect(flow.stages).toHaveLength(ISSUE_STANDARD_STAGE_ORDER.length);
    });

    test('AC-7: stages.map(s => s.stage) strictly equals issue.standard reference order', () => {
      const order = flow.stages.map((s: StageStep) => s.stage);
      expect(order).toEqual([...ISSUE_STANDARD_STAGE_ORDER]);
    });

    test('skipped stages are NOT in the list (context_pack/requirement/design/knowledge)', () => {
      const present = new Set(flow.stages.map((s) => s.stage));
      expect(present.has('context_pack')).toBe(false);
      expect(present.has('requirement')).toBe(false);
      expect(present.has('design')).toBe(false);
      expect(present.has('knowledge')).toBe(false);
    });

    test('build_test + completion are runner-side engine stages', () => {
      const byStage = Object.fromEntries(flow.stages.map((s) => [s.stage, s]));
      expect(byStage.build_test.kind).toBe('engine');
      expect(byStage.completion.kind).toBe('engine');
    });

    test('agent stages declare a non-empty skillId; engine stages do not', () => {
      for (const step of flow.stages) {
        if (step.kind === 'agent') {
          expect(typeof step.skillId).toBe('string');
          expect(step.skillId!.length).toBeGreaterThan(0);
        } else {
          expect(step.skillId).toBeUndefined();
        }
      }
    });

    test('R9: skillId placeholders for issue agent stages (W2-4 will consume)', () => {
      const byStage = Object.fromEntries(flow.stages.map((s) => [s.stage, s]));
      expect(byStage.report.kind).toBe('agent');
      expect(byStage.report.skillId).toBe('cs-issue-report');
      expect(byStage.analyze.kind).toBe('agent');
      expect(byStage.analyze.skillId).toBe('cs-issue-analyze');
      expect(byStage.implementation.kind).toBe('agent');
      expect(byStage.implementation.skillId).toBe('cs-issue-fix');
      expect(byStage.review.kind).toBe('agent');
      expect(byStage.review.skillId).toBe('cs-feat-accept');
    });

    test('every step.kind is one of the four StageStepKind buckets', () => {
      const buckets = new Set<string>(['agent', 'gate', 'human', 'engine']);
      for (const step of flow.stages) {
        expect(buckets.has(step.kind)).toBe(true);
      }
    });
  });
});
