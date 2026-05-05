import type { ArtifactId, ProjectId } from './ids';
import type { FlowId, WorkflowRunType, WorkflowStage } from './workflow';

// ---------------------------------------------------------------------------
// V2 Wave 2 / W2-4 — Smart Router types (cross-layer contracts).
//
// The smart-router lives at `apps/api/src/router.ts`. Given a user request,
// it picks a FlowId, an optional start stage (skip prefix), a list of
// relevant accepted KnowledgeArtifact ids to inject, and time/token
// estimates. V1 is rules-only; LLM fallback is Wave 3.
//
// Coordinator (`apps/runner/src/agents/coordinator/`) is the upstream
// intent classifier (text → routeCase + runType). Router takes Coordinator
// output + repo state → FlowId/startStage/knowledge/estimates. Coordinator
// does NOT call the router; the API server-side `createWorkflowRun()` does
// (when body.flowId is missing). UI calls the router separately via
// `POST /router/recommend` for dry-run preview.
//
// References:
//   - V2 design notes § 3.2 (Routing over Prescribing)
//   - W2-4 PRD: `.trellis/tasks/05-05-v2-w2-4-smart-router/prd.md`
//   - Spec: `.trellis/spec/api/backend/smart-router.md`
// ---------------------------------------------------------------------------

/**
 * Input to the smart-router.
 *
 * `runType` is the upstream Coordinator's output (intent classification).
 * `messageHistory` is optional — useful when the router is called via the
 * dry-run endpoint with chat context; createWorkflowRun integration omits
 * it (no chat history at run-creation time).
 */
export interface RouterInput {
  projectId: ProjectId;
  /** User-supplied description (typically `workflow_request.title` or `body.title`). */
  title: string;
  /** Coordinator's classification — primary signal for flow selection. */
  runType: WorkflowRunType;
  /** Optional chat history (router doesn't currently use it; reserved for Wave 3 LLM fallback). */
  messageHistory?: { role: 'user' | 'coordinator'; content: string }[];
}

/**
 * Output of the smart-router. All fields populated; `startStage` may be
 * null when the router recommends starting from the flow's first stage.
 */
export interface RouterRecommendation {
  /** Recommended flow id (key into `FLOW_REGISTRY`). */
  flowId: FlowId;
  /**
   * Recommended starting stage. `null` means "start from the first stage".
   * Non-null only for `feature.standard` (other flows are short and run
   * from head-to-tail). Must be a stage present in the chosen flow's
   * stage list — orchestrator will throw `unknown startStage in flow`
   * otherwise.
   */
  startStage: WorkflowStage | null;
  /**
   * Top-N (currently N=5) accepted KnowledgeArtifact ids ranked by
   * keyword overlap with the user request. Empty array if no project
   * knowledge matches. Wave 3 will deepen this matching.
   */
  relevantKnowledge: ArtifactId[];
  /**
   * Static estimate (V1) — agent stages = 90 sec / 8000 tokens, engine
   * stages = 30 sec / 0 tokens. Wave 3 calibrates from history.
   */
  estimates: {
    timeSec: number;
    tokens: number;
  };
  /** Human-readable summary of why this recommendation. UI surface. */
  reason: string;
  /**
   * Rule ids that fired during decision. Mirrors Coordinator's
   * `rulesFired` field for debugging/audit consistency.
   */
  rulesFired: string[];
  /**
   * 0..1 — V1 rules-only path always emits 1.0 (deterministic). Wave 3
   * LLM-augmented path will produce real probabilities.
   */
  confidence: number;
}
