import { expect, test } from 'vitest';
import type { Artifact } from '@ainp/shared';
import { REVIEW_VERDICT_SCHEMA_VERSION, type ReviewerVerdict } from '@ainp/shared';
import {
  priorFeedbackFromApprovals,
  priorFeedbackFromVerdicts,
} from '../src/orchestrator/prior-feedback';

// 08-09 P1-2: both feedback sources were producer-only before this task —
// a human's rejection comment and a reviewer's remediation were recorded and
// then dropped on retry. These pin that they now reach the context builder,
// and that a first attempt injects nothing.

function verdictArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: 'art_verdict_1',
    kind: 'other',
    uri: 'file:///tmp/review-verdict.json',
    workflowRunId: 'run_1',
    stepRunId: 'step_1',
    size: 1,
    contentType: 'application/json',
    sha256: null,
    createdAt: '2026-08-09T00:00:00.000Z',
    // Key copied from the real writer: `metadataForStageOutput` lifts
    // `schemaVersion` out of the JSON body for `.json` outputs.
    metadata: { skill: 'skill.review', output: 'review-verdict.json', schemaVersion: REVIEW_VERDICT_SCHEMA_VERSION },
    ...overrides,
  };
}

function failingVerdict(overrides: Partial<ReviewerVerdict> = {}): ReviewerVerdict {
  return {
    schemaVersion: REVIEW_VERDICT_SCHEMA_VERSION,
    role: 'reviewer',
    status: 'fail',
    summary: 'Retry logic never bounds its attempts.',
    blocking: [{
      id: 'B1',
      severity: 'blocker',
      summary: 'retry loop has no upper bound',
      location: 'src/retry.ts:42',
      evidenceRefs: [],
    }],
    remediation: [{
      blockerId: 'B1',
      action: 'cap attempts at 2 and record a no-progress fingerprint',
      rationale: 'an unbounded loop burns budget without converging',
    }],
    advisory: [],
    evidenceRefs: [],
    provenance: { agentSessionId: null, backend: 'claude_code', skillId: 'skill.review', producedAt: '2026-08-09T00:00:00.000Z' },
    unavailableReason: null,
    ...overrides,
  };
}

test('a first attempt produces no prior feedback from either source', () => {
  expect(priorFeedbackFromApprovals([])).toEqual([]);
  expect(priorFeedbackFromVerdicts([])).toEqual([]);
});

test('a human rejection comment becomes prior feedback', () => {
  const feedback = priorFeedbackFromApprovals([
    { gateId: 'acceptance_gate', decision: 'rejected', comment: '边界用例没覆盖，AC-003 缺证据' },
  ]);

  expect(feedback).toHaveLength(1);
  expect(feedback[0]?.source).toBe('human_rejection');
  expect(feedback[0]?.text).toBe('边界用例没覆盖，AC-003 缺证据');
  expect(feedback[0]?.stage).toBe('acceptance_gate');
});

test('approvals that approved, or rejected without a usable comment, contribute nothing', () => {
  expect(priorFeedbackFromApprovals([
    { gateId: 'acceptance_gate', decision: 'approved', comment: 'looks good' },
    { gateId: 'design_gate', decision: 'rejected', comment: null },
    { gateId: 'compile_gate', decision: 'rejected', comment: '   ' },
  ])).toEqual([]);
});

test('a failing verdict contributes one entry per remediation, pairing it with its blocker', () => {
  const verdict = failingVerdict();
  const feedback = priorFeedbackFromVerdicts([
    { artifact: verdictArtifact(), text: JSON.stringify(verdict) },
  ]);

  expect(feedback).toHaveLength(1);
  expect(feedback[0]?.source).toBe('reviewer_remediation');
  expect(feedback[0]?.sourceRef).toBe('artifact:art_verdict_1');
  // The blocker and its fix must travel together — a fix with no problem
  // statement is not actionable on the next attempt.
  expect(feedback[0]?.text).toContain('retry loop has no upper bound');
  expect(feedback[0]?.text).toContain('src/retry.ts:42');
  expect(feedback[0]?.text).toContain('cap attempts at 2');
  expect(feedback[0]?.text).toContain('burns budget without converging');
});

test('a passing verdict contributes nothing even when it carries advice', () => {
  const passing = failingVerdict({
    status: 'pass',
    blocking: [],
    remediation: [],
    advisory: ['consider extracting the helper'],
  });

  expect(priorFeedbackFromVerdicts([
    { artifact: verdictArtifact(), text: JSON.stringify(passing) },
  ])).toEqual([]);
});

test('artifacts that are not verdicts, unparseable, or missing their body are skipped', () => {
  const verdict = JSON.stringify(failingVerdict());
  expect(priorFeedbackFromVerdicts([
    // Not a verdict: no schemaVersion in metadata.
    { artifact: verdictArtifact({ metadata: { output: 'review.md' } }), text: verdict },
    // Claims to be a verdict but the body does not satisfy the schema.
    { artifact: verdictArtifact(), text: '{"schemaVersion":"ainp.review_verdict.v0"}' },
    // Body was never loaded — skipped rather than guessed at.
    { artifact: verdictArtifact(), text: null },
  ])).toEqual([]);
});
