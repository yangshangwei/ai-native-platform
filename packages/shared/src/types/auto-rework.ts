import type { GateId } from './gate';
import type { WorkflowRunStatus, WorkflowStage } from './workflow';

/**
 * Bounded auto-rework (08-09 P1-2b).
 *
 * P1-2 made a *manual* retry carry the previous attempt's feedback into its
 * prompt. This module decides when that retry may happen without a human
 * clicking it.
 *
 * Everything here is written refusal-first: {@link decideAutoRework} returns a
 * typed refusal at the first unmet condition and only grants a retry to a run
 * that survives all of them. A trigger that re-runs stages is the one place in
 * this codebase where a logic slip spends real money in a loop, so "why we did
 * NOT retry" is the answer that must be cheap to produce.
 *
 * Structurally guaranteed and therefore NOT re-checked here: operational
 * failures never reach this code. They arrive on `/runner/events/workflow-paused`
 * -> `pauseWorkflowRun`, a route that is mutually exclusive with the
 * `/runner/events/workflow-completed` failure branch which calls us.
 * `reviewer_unavailable` (P0-2) is one of those pause reasons. Do not add a
 * redundant "is this an outage?" check — the routing already answers it, and a
 * second answer would be a second truth.
 */

/** `StepRun`/audit actor recorded for an engine-initiated retry. */
export const AUTO_REWORK_ACTOR = 'auto-rework' as const;

/**
 * Default cap per `(run, stage)`. PRD ADR-2: one, not two. This round re-runs a
 * single stage rather than a repair sub-graph, and a grant already requires
 * concrete remediation — failing twice *with* instructions is not a case where
 * a third paid attempt is likely to converge. Raising it is a one-line change
 * once real data says one is not enough; lowering it after a runaway is not.
 */
export const AUTO_REWORK_MAX_ATTEMPTS = 1;

/**
 * Gates that are never auto-reworked, whatever else holds.
 *
 * Both are human-judgement gates: re-running them automatically is exactly the
 * decision they exist to keep a person in.
 */
export const AUTO_REWORK_FORBIDDEN_GATES = [
  'sensitive_change_gate',
  'knowledge_gate',
] as const satisfies readonly GateId[];

export function isAutoReworkForbiddenGate(gateId: GateId): boolean {
  return (AUTO_REWORK_FORBIDDEN_GATES as readonly string[]).includes(gateId);
}

/** Per-stage bookkeeping. Manual retries never touch it (PRD R1). */
export interface AutoReworkStageState {
  /** Auto-rework attempts spent on this stage. Manual retries are not counted. */
  attempts: number;
  /** Fingerprint of the failure that the last auto-rework was granted for. */
  fingerprint: string | null;
}

/**
 * `(run, stage)`-keyed ledger carried on {@link WorkflowRun}. Partial because a
 * stage that never auto-reworked has no entry — absence means zero, so the
 * ledger of a normal run stays `{}`.
 */
export type AutoReworkLedger = Partial<Record<WorkflowStage, AutoReworkStageState>>;

export type AutoReworkRefusalReason =
  /** The run did not fail (or failed into `paused`, which we never touch). */
  | 'run_not_failed'
  /** Nothing identifiable failed — no failing gate to attribute the failure to. */
  | 'unattributed_failure'
  /** A failing gate is on {@link AUTO_REWORK_FORBIDDEN_GATES}. */
  | 'forbidden_gate'
  /** A failing gate already carries a human approval decision. */
  | 'human_decided_gate'
  /** This `(run, stage)` has spent its budget. */
  | 'budget_exhausted'
  /** Identical failure to the attempt we already granted. */
  | 'no_progress'
  /** No remediation and no rejection comment for the next attempt to act on. */
  | 'no_actionable_feedback';

export type AutoReworkDecision =
  | { retry: true; stage: WorkflowStage; fingerprint: string; attempt: number }
  | { retry: false; reason: AutoReworkRefusalReason; detail: string };

/** One failing gate, reduced to what the decision and the fingerprint need. */
export interface AutoReworkFailingGate {
  gateId: GateId;
  /** Ids of the rules that failed inside this gate. Order is irrelevant. */
  failedRuleIds: readonly string[];
  /** Whether a person has recorded an approval decision on this gate. */
  hasHumanDecision: boolean;
}

export interface AutoReworkSnapshot {
  runStatus: WorkflowRunStatus;
  /** Stage the run failed at — the only stage this round retries. */
  stage: WorkflowStage;
  ledger: AutoReworkLedger;
  /** Latest failing gate per gateId, attributed to {@link stage}. */
  failingGates: readonly AutoReworkFailingGate[];
  /** Latest non-zero command exit per command stage, e.g. `compile=1`. */
  failedCommandExits: readonly string[];
  /**
   * Whether the run carries remediation or a rejection comment that the next
   * attempt's ContextPack would actually receive (P1-2). PRD ADR-3 makes this
   * a hard condition: without it the agent gets the context it just failed
   * with, which is the same dice roll at twice the price.
   */
  hasActionableFeedback: boolean;
  /** Overridable cap; defaults to {@link AUTO_REWORK_MAX_ATTEMPTS}. */
  maxAttempts?: number;
}

/**
 * Identify a failure by what actually failed, so an unchanged outcome is
 * recognisable across attempts.
 *
 * Both lists are sorted: the fingerprint must not depend on iteration order, or
 * every comparison would look like a change and the no-progress stop would
 * never fire.
 */
export function computeAutoReworkFingerprint(input: {
  stage: WorkflowStage;
  failingGates: readonly AutoReworkFailingGate[];
  failedCommandExits: readonly string[];
}): string {
  const rules = input.failingGates
    .flatMap((gate) => gate.failedRuleIds.map((ruleId) => `${gate.gateId}:${ruleId}`))
    .sort();
  const exits = [...input.failedCommandExits].sort();
  return [`stage=${input.stage}`, `rules=${rules.join(',')}`, `exits=${exits.join(',')}`].join('|');
}

export function autoReworkAttempts(ledger: AutoReworkLedger, stage: WorkflowStage): number {
  return ledger[stage]?.attempts ?? 0;
}

export function autoReworkFingerprint(
  ledger: AutoReworkLedger,
  stage: WorkflowStage,
): string | null {
  return ledger[stage]?.fingerprint ?? null;
}

/**
 * Apply one granted attempt to the ledger. Pure — the caller persists the
 * result BEFORE calling `retryStage`, so a crash between the two costs one lost
 * retry (safe) rather than an unbounded loop (not).
 */
export function withAutoReworkAttempt(
  ledger: AutoReworkLedger,
  stage: WorkflowStage,
  fingerprint: string,
): AutoReworkLedger {
  return {
    ...ledger,
    [stage]: { attempts: autoReworkAttempts(ledger, stage) + 1, fingerprint },
  };
}

/**
 * The single judgement. Every writer and every reader of "may this run retry
 * itself?" calls this function — the same discipline `deriveGraphRunStatus`
 * follows, for the same reason: an aggregate rule with two implementations is
 * an aggregate rule with two answers.
 *
 * Conditions are PRD R3, in refusal order.
 */
export function decideAutoRework(snapshot: AutoReworkSnapshot): AutoReworkDecision {
  // (1) Only a business failure reported through `/workflow-completed` gets
  // here with `failed`. `paused` runs are the operational path and are refused
  // by this same check if a caller ever routes one here by mistake.
  if (snapshot.runStatus !== 'failed') {
    return {
      retry: false,
      reason: 'run_not_failed',
      detail: `run status is ${snapshot.runStatus}, not failed`,
    };
  }

  if (snapshot.failingGates.length === 0) {
    // A thrown error or a crashed step leaves nothing to characterise. Retrying
    // blind is the coin flip this feature exists to avoid, and it would also
    // make the fingerprint meaningless.
    return {
      retry: false,
      reason: 'unattributed_failure',
      detail: `no failing gate attributed to stage ${snapshot.stage}`,
    };
  }

  // (2) Forbidden gates, then gates a person already ruled on. A human's
  // rejection is an instruction to change something, not a signal to try the
  // same thing again.
  const forbidden = snapshot.failingGates.find((gate) => isAutoReworkForbiddenGate(gate.gateId));
  if (forbidden) {
    return {
      retry: false,
      reason: 'forbidden_gate',
      detail: `${forbidden.gateId} is never auto-reworked`,
    };
  }
  const humanDecided = snapshot.failingGates.find((gate) => gate.hasHumanDecision);
  if (humanDecided) {
    return {
      retry: false,
      reason: 'human_decided_gate',
      detail: `${humanDecided.gateId} already carries a human decision`,
    };
  }

  // (3) Budget for this (run, stage).
  const maxAttempts = snapshot.maxAttempts ?? AUTO_REWORK_MAX_ATTEMPTS;
  const spent = autoReworkAttempts(snapshot.ledger, snapshot.stage);
  if (spent >= maxAttempts) {
    return {
      retry: false,
      reason: 'budget_exhausted',
      detail: `${snapshot.stage} has spent ${spent}/${maxAttempts} auto-rework attempts`,
    };
  }

  // (4) No progress. Stops earlier than the budget would: the same failure
  // twice is evidence the retry changed nothing.
  const fingerprint = computeAutoReworkFingerprint({
    stage: snapshot.stage,
    failingGates: snapshot.failingGates,
    failedCommandExits: snapshot.failedCommandExits,
  });
  if (fingerprint === autoReworkFingerprint(snapshot.ledger, snapshot.stage)) {
    return {
      retry: false,
      reason: 'no_progress',
      detail: 'failure is identical to the previous auto-rework attempt',
    };
  }

  // (5) Something to act on (PRD ADR-3).
  if (!snapshot.hasActionableFeedback) {
    return {
      retry: false,
      reason: 'no_actionable_feedback',
      detail: 'no remediation or rejection comment for the next attempt to consume',
    };
  }

  return { retry: true, stage: snapshot.stage, fingerprint, attempt: spent + 1 };
}
