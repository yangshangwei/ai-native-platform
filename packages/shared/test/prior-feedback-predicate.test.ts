/**
 * 08-09 P1-2b — the shared "is there anything to act on?" predicate.
 *
 * This exists because two layers ask the same question for different reasons:
 * the runner extracts prior feedback into the retry's ContextPack, and the api
 * gates auto-rework on whether such feedback exists (PRD ADR-3). A decider more
 * permissive than the extractor authorises paid retries whose prompts contain
 * nothing new, so the two share one predicate rather than two copies.
 */
import { expect, test } from 'vitest';
import {
  REVIEW_VERDICT_SCHEMA_VERSION,
  actionableRejectionComment,
  actionableRemediation,
  type ReviewerVerdict,
} from '../src/index';

function verdict(overrides: Partial<ReviewerVerdict> = {}): ReviewerVerdict {
  return {
    schemaVersion: REVIEW_VERDICT_SCHEMA_VERSION,
    role: 'reviewer',
    status: 'fail',
    summary: 'compile is broken',
    blocking: [
      { id: 'B1', severity: 'blocker', summary: 'missing import', location: null, evidenceRefs: [] },
    ],
    remediation: [{ blockerId: 'B1', action: 'add the missing import', rationale: null }],
    advisory: [],
    evidenceRefs: [],
    provenance: { agentSessionId: null, backend: null, skillId: null, producedAt: '2026-08-09T00:00:00.000Z' },
    unavailableReason: null,
    ...overrides,
  };
}

test('a rejection with a comment is the only approval shape that is actionable', () => {
  expect(actionableRejectionComment({ decision: 'rejected', comment: 'fix the error path' }))
    .toBe('fix the error path');
  // An approval is not feedback, and a bare "no" does not say what to change.
  expect(actionableRejectionComment({ decision: 'approved', comment: 'looks good' })).toBeNull();
  expect(actionableRejectionComment({ decision: 'rejected', comment: null })).toBeNull();
  expect(actionableRejectionComment({ decision: 'rejected', comment: '   ' })).toBeNull();
});

test('the comment is trimmed, so whitespace never passes as guidance', () => {
  expect(actionableRejectionComment({ decision: 'rejected', comment: '  do X  ' })).toBe('do X');
});

test('only a failing verdict carries remediation a retry can act on', () => {
  expect(actionableRemediation(verdict())).toHaveLength(1);
  // A passing verdict's suggestions are advice, not instructions for a retry.
  expect(
    actionableRemediation(verdict({ status: 'pass', blocking: [], remediation: [] })),
  ).toEqual([]);
  expect(actionableRemediation(verdict({ status: 'fail', remediation: [] }))).toEqual([]);
});

test('an unavailable verdict is never actionable, whatever it carries', () => {
  // `unavailable` is an outage (P0-2), and an outage must not look like a
  // product defect with a known fix.
  expect(
    actionableRemediation(
      verdict({ status: 'unavailable', unavailableReason: 'reviewer backend down' }),
    ),
  ).toEqual([]);
});
