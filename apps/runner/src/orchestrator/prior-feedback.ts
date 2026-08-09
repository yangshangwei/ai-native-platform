import type { Artifact } from '@ainp/shared';
import {
  REVIEW_VERDICT_SCHEMA_VERSION,
  actionableRejectionComment,
  actionableRemediation,
  parseReviewerVerdict,
} from '@ainp/shared';
import type { PriorFeedbackInput } from '../context/builder';

/**
 * Collect why the previous attempt was rejected, so a retry does not start
 * from zero (08-09 P1-2).
 *
 * Two sources, one shape:
 *  - a human's gate rejection comment (`Approval.comment`, mandatory and
 *    non-empty whenever `decision === 'reject'` — see the acceptance-decision
 *    route), and
 *  - a reviewer verdict's remediation entries (P0-2).
 *
 * Both are OPINIONS about a failure, not evidence, which is why the context
 * builder gives them their own manifest type and the lowest trust level.
 *
 * Returns an empty array on a first attempt: there is no prior approval and no
 * prior verdict, so nothing is injected and no placeholder appears.
 *
 * WHAT counts as actionable lives in `@ainp/shared`
 * (`types/prior-feedback.ts`); this file only decides how to render it. The
 * api's auto-rework trigger (08-09 P1-2b) gates on the same predicate, and a
 * decider more permissive than this extractor would authorise paid retries
 * whose prompts contain nothing new.
 */

export interface PriorApprovalRecord {
  gateId: string;
  decision: 'approved' | 'rejected';
  comment: string | null;
}

export function priorFeedbackFromApprovals(
  approvals: readonly PriorApprovalRecord[],
): PriorFeedbackInput[] {
  return approvals
    .map((approval): PriorFeedbackInput | null => {
      const text = actionableRejectionComment(approval);
      if (!text) return null;
      return {
        source: 'human_rejection',
        stage: approval.gateId,
        text,
        sourceRef: `gate:${approval.gateId}`,
        createdAt: null,
      };
    })
    .filter((item): item is PriorFeedbackInput => item !== null);
}

/**
 * Pull remediation out of the run's reviewer verdicts.
 *
 * Verdict artifacts are identified the way the gate engine identifies them —
 * by `metadata.schemaVersion`, which `metadataForStageOutput` copies out of
 * the JSON body. Reading the body itself requires the artifact text, so the
 * caller supplies it; artifacts whose text is unavailable are skipped rather
 * than guessed at.
 */
export function priorFeedbackFromVerdicts(
  artifacts: ReadonlyArray<{ artifact: Artifact; text: string | null }>,
): PriorFeedbackInput[] {
  const feedback: PriorFeedbackInput[] = [];
  for (const { artifact, text } of artifacts) {
    if (artifact.metadata?.schemaVersion !== REVIEW_VERDICT_SCHEMA_VERSION) continue;
    if (!text) continue;
    const parsed = parseReviewerVerdict(text);
    if (!parsed.ok) continue;
    const blockerById = new Map(parsed.verdict.blocking.map((item) => [item.id, item]));
    for (const remediation of actionableRemediation(parsed.verdict)) {
      const blocker = blockerById.get(remediation.blockerId);
      const lines = [
        blocker ? `Problem: ${blocker.summary}` : `Problem: ${remediation.blockerId}`,
        blocker?.location ? `Location: ${blocker.location}` : null,
        `Suggested fix: ${remediation.action}`,
        remediation.rationale ? `Why: ${remediation.rationale}` : null,
      ].filter((line): line is string => Boolean(line));
      feedback.push({
        source: 'reviewer_remediation',
        stage: 'review',
        text: lines.join('\n'),
        sourceRef: `artifact:${artifact.id}`,
        createdAt: artifact.createdAt ?? null,
      });
    }
  }
  return feedback;
}

