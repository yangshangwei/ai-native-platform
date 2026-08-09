import type {
  Artifact,
  AutoReworkDecision,
  AutoReworkFailingGate,
  AutoReworkSnapshot,
  CommandRun,
  GateRun,
  WorkflowRun,
  WorkflowStage,
} from '@ainp/shared';
import {
  AUTO_REWORK_ACTOR,
  REVIEW_VERDICT_SCHEMA_VERSION,
  actionableRejectionComment,
  actionableRemediation,
  decideAutoRework,
  parseReviewerVerdict,
  withAutoReworkAttempt,
} from '@ainp/shared';
import { store } from './store/store';
import { readArtifactContent } from './artifact-content';
import { audit } from './audit';
import { retryStage } from './workflow-engine';

/**
 * Bounded auto-rework, api side (08-09 P1-2b).
 *
 * The judgement itself lives in `@ainp/shared`
 * (`packages/shared/src/types/auto-rework.ts`) as a pure function over a
 * snapshot. This file only assembles that snapshot out of the store and, when
 * the judgement grants a retry, performs it.
 *
 * Split that way for one reason: the rule that decides whether a platform may
 * spend money re-running a stage should be testable without a database, and it
 * must have exactly one implementation. See the shared module's header for what
 * is structurally guaranteed (operational pauses never reach here) and must
 * therefore NOT be re-checked.
 */

/**
 * Assemble the decision inputs for a failed run.
 *
 * Reads only. Every field it collects is scoped to the stage the run failed at,
 * because that is the only stage this round retries.
 */
export function autoReworkSnapshot(run: WorkflowRun): AutoReworkSnapshot {
  const stage = run.currentStage;
  return {
    runStatus: run.status,
    stage,
    ledger: run.autoRework ?? {},
    failingGates: failingGatesForStage(run.id, stage),
    failedCommandExits: failedCommandExits(run.id),
    hasActionableFeedback: hasActionableFeedback(run.id),
  };
}

/**
 * Decide, then — only on a grant — persist the attempt and reset the stage.
 *
 * Ordering is the safety property, not an implementation detail: the ledger is
 * written BEFORE `retryStage`. A crash in between costs one retry that never
 * happened; the reverse ordering would leave a retry that was never counted,
 * which is an unbounded loop.
 *
 * Never throws. A failure to evaluate must not turn a recorded run failure into
 * a 5xx on the runner's completion event — the run already failed, and that
 * fact is more important than the retry.
 */
export function maybeAutoRework(run: WorkflowRun): AutoReworkDecision {
  let decision: AutoReworkDecision;
  try {
    decision = decideAutoRework(autoReworkSnapshot(run));
  } catch (err) {
    return {
      retry: false,
      reason: 'unattributed_failure',
      detail: `auto-rework evaluation failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!decision.retry) {
    // Refusals are audited too. "Why did it not retry?" is asked far more often
    // than "why did it retry", and an unrecorded refusal is indistinguishable
    // from a trigger that never ran.
    audit(run.id, 'auto_rework.declined', {
      stage: run.currentStage,
      reason: decision.reason,
      detail: decision.detail,
    });
    return decision;
  }

  try {
    store.workflowRuns.set(run.id, {
      ...run,
      autoRework: withAutoReworkAttempt(run.autoRework ?? {}, decision.stage, decision.fingerprint),
    });
    audit(run.id, 'auto_rework.granted', {
      stage: decision.stage,
      attempt: decision.attempt,
      fingerprint: decision.fingerprint,
    });
    // `actor` is what separates this from a human click in the `stage.retry`
    // audit row — the only place the two retry paths are told apart after the
    // fact (PRD AC "审计能区分自动与人工重试").
    retryStage({ workflowRunId: run.id, stage: decision.stage, actor: AUTO_REWORK_ACTOR });
    return decision;
  } catch (err) {
    audit(run.id, 'auto_rework.declined', {
      stage: decision.stage,
      reason: 'unattributed_failure',
      detail: `auto-rework retry failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    return {
      retry: false,
      reason: 'unattributed_failure',
      detail: 'auto-rework retry could not be performed',
    };
  }
}

// ---- snapshot assembly -----------------------------------------------------

/**
 * Latest failing gate per gateId, restricted to the failing stage.
 *
 * "Latest per gateId" matters for the fingerprint: gate runs accumulate across
 * attempts, so summing every historical failure would make attempt 2's
 * fingerprint differ from attempt 1's by construction and the no-progress stop
 * would never fire.
 */
function failingGatesForStage(
  workflowRunId: string,
  stage: WorkflowStage,
): AutoReworkFailingGate[] {
  const latestByGate = new Map<string, GateRun>();
  for (const gate of store.gateRuns.byWorkflow(workflowRunId)) {
    latestByGate.set(gate.gateId, gate);
  }
  return [...latestByGate.values()]
    .filter((gate) => gate.status === 'fail' && gateBelongsToStage(gate, stage))
    .map((gate) => ({
      gateId: gate.gateId,
      failedRuleIds: gate.ruleResults
        .filter((rule) => rule.status === 'fail')
        .map((rule) => rule.ruleId),
      hasHumanDecision: Boolean(store.approvals.latestForGate(workflowRunId, gate.gateId)),
    }));
}

/**
 * A gate belongs to the stage whose step produced it. Gates recorded without a
 * step are run-level and count for whichever stage is currently failing.
 */
function gateBelongsToStage(gate: GateRun, stage: WorkflowStage): boolean {
  if (!gate.stepRunId) return true;
  return store.stepRuns.get(gate.stepRunId)?.stage === stage;
}

/**
 * Latest non-zero exit per command stage, as `compile=1`.
 *
 * Same "latest wins" rule as the gates, and for the same reason. `null` exit
 * codes are commands that never reported one — unknown, not failed.
 */
function failedCommandExits(workflowRunId: string): string[] {
  const latestByStage = new Map<CommandRun['stage'], CommandRun>();
  for (const command of store.commandRunsByWorkflow(workflowRunId)) {
    latestByStage.set(command.stage, command);
  }
  return [...latestByStage.values()]
    .filter((command) => command.exitCode !== null && command.exitCode !== 0)
    .map((command) => `${command.stage}=${command.exitCode}`);
}

/**
 * Whether the run carries something the next attempt can act on.
 *
 * The predicate itself is `@ainp/shared`'s (`types/prior-feedback.ts`) — the
 * same one the runner's `collectPriorFeedback` extracts with. This is not
 * tidiness: if this decider were the more permissive of the two, the platform
 * would grant a paid retry whose ContextPack then contains nothing new, which
 * is precisely what PRD ADR-3 forbids. Sharing the judgement makes the two
 * unable to disagree; the api cannot import from the runner, which is why the
 * predicate lives in shared rather than being copied here.
 */
function hasActionableFeedback(workflowRunId: string): boolean {
  const rejectionComment = store.approvals
    .byWorkflow(workflowRunId)
    .some((approval) => actionableRejectionComment(approval) !== null);
  if (rejectionComment) return true;

  return store.artifacts
    .byWorkflow(workflowRunId)
    .some((artifact) => verdictHasRemediation(artifact));
}

function verdictHasRemediation(artifact: Artifact): boolean {
  if (artifact.metadata?.schemaVersion !== REVIEW_VERDICT_SCHEMA_VERSION) return false;
  try {
    const parsed = parseReviewerVerdict(readArtifactContent(artifact).text);
    return parsed.ok && actionableRemediation(parsed.verdict).length > 0;
  } catch {
    // Unreadable evidence is not actionable feedback.
    return false;
  }
}
