import type { Iso8601, WorkflowRequestId, WorkflowRunId } from './ids';

/**
 * Where the user's intent should be routed after Coordinator triage.
 *
 * Mirrors cs-brainstorm's three cases plus an explicit bugfix track and an
 * `unclear` escape hatch that always pauses for human clarification.
 */
export type RouteCase =
  | 'feature_clear'
  | 'feature_brainstorm'
  | 'roadmap_needed'
  | 'bugfix'
  | 'unclear';

/**
 * Structured Coordinator decision. Coordinator never writes workflow state;
 * it only emits one of these and the runner / API decide what to do.
 *
 * `proceed` advances to WorkflowRun creation with the chosen runType.
 * `pause_for_human` posts the questions to the chat thread and flips the
 *   request to `awaiting_clarification`.
 * `abort` cancels the request entirely (used for off-topic / impossible).
 */
export type CoordinatorAction =
  | {
      action: 'proceed';
      routeCase: RouteCase;
      runType: 'feature' | 'bugfix' | 'smoke';
      reason: string;
    }
  | {
      action: 'pause_for_human';
      questions: string[];
      reason: string;
    }
  | {
      action: 'abort';
      reason: string;
    };

export type DecisionSource = 'rules' | 'llm' | 'human';

export interface CoordinatorDecision {
  id: string;
  workflowRequestId: WorkflowRequestId;
  /** Filled in once the runner creates the WorkflowRun for this decision. */
  workflowRunId: WorkflowRunId | null;
  source: DecisionSource;
  decision: CoordinatorAction;
  /** 0..1; rules path emits ≥0.65 to skip LLM fallback. */
  confidence: number;
  /** Rule IDs that fired (empty for pure-LLM decisions). */
  rulesFired: string[];
  decidedAt: Iso8601;
}
