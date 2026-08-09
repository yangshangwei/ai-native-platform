import type { ReviewRemediation, ReviewerVerdict } from './review-verdict';

/**
 * What counts as "the next attempt has something to act on" — the single
 * judgement behind prior feedback (08-09 P1-2) and bounded auto-rework
 * (08-09 P1-2b).
 *
 * Two layers ask this question for two different purposes and must not answer
 * it differently:
 *
 * | Caller | Side | Asks |
 * |---|---|---|
 * | `apps/runner/src/orchestrator/prior-feedback.ts` | extract | which items go into the retry's ContextPack |
 * | `apps/api/src/auto-rework.ts` | decide | may this run retry itself at all (PRD ADR-3) |
 *
 * If the decider were more permissive than the extractor, the platform would
 * grant a paid retry whose prompt then turns out to contain nothing new — the
 * exact failure ADR-3 exists to prevent. The api cannot import from the runner,
 * so the predicate lives here rather than being copied with a comment asking
 * the next reader to keep two copies in step. Same reasoning as the
 * FLOW_REGISTRY relocation: a judgement two layers need is a shared judgement.
 */

/** The fields of an approval this judgement reads. Deliberately minimal. */
export interface PriorRejectionInput {
  decision: 'approved' | 'rejected';
  comment: string | null;
}

/**
 * The rejection comment a retry can act on, or null.
 *
 * An approval is not feedback, and a rejection without a comment says only
 * "no" — neither tells the next attempt what to change.
 */
export function actionableRejectionComment(approval: PriorRejectionInput): string | null {
  if (approval.decision !== 'rejected') return null;
  const text = approval.comment?.trim();
  return text ? text : null;
}

/**
 * The remediation entries a retry can act on.
 *
 * Only a failing verdict describes something to fix; a passing verdict's
 * advisory notes are suggestions, not instructions for a retry.
 */
export function actionableRemediation(verdict: ReviewerVerdict): readonly ReviewRemediation[] {
  if (verdict.status !== 'fail') return [];
  return verdict.remediation;
}
