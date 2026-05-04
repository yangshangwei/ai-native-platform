import type { Iso8601, ProjectId, WorkflowRunId, WorkflowRequestId, StepRunId } from './ids';

export type WorkflowStage =
  | 'init'
  | 'context_pack'
  | 'requirement'
  | 'design'
  | 'implementation'
  | 'build_test'
  | 'review'
  | 'completion'
  | 'knowledge';

export type WorkflowRunStatus =
  | 'pending'
  | 'running'
  | 'awaiting_human'
  | 'passed'
  | 'failed'
  | 'cancelled';

export type WorkflowRunType = 'feature' | 'bugfix' | 'smoke';

// ---------------------------------------------------------------------------
// V2 W2-1: FLOW_REGISTRY contracts (shared types)
//
// V1 hard-coded a single 9-stage pipeline inside `runWorkflow()`. V2 Wave 2
// extracts the pipeline shape into a declarative `FLOW_REGISTRY` keyed by
// {@link FlowId}; this PR ships the cross-layer types only — the runtime
// registry, orchestrator refactor, and DB migration land in subsequent
// PRs of the same task.
//
// See:
//   - `.trellis/tasks/05-04-v2-w2-1-flow-registry-bootstrap/prd.md` ADR Q1=α
//   - `.trellis/tasks/archive/2026-05/05-04-v2-wave2-workflow-polymorphism/prd.md`
//     (Wave 2 roadmap — locks naming + path conventions)
//   - V2 design notes § 2.1 (work-type polymorphism) + § 5
// ---------------------------------------------------------------------------

/**
 * Identifier of a flow definition in the FLOW_REGISTRY.
 *
 * Shape: `<work_kind>.<variant>` (lowercase alphabetic + dot + alphabetic).
 *
 * Currently only `'feature.standard'` is shipped (W2-1). Future tasks add:
 *   - `'feature.fastforward'`           (W2-3)
 *   - `'issue.standard'`                (W2-2)
 *   - `'refactor.standard'`             (W2-2)
 *
 * Kept as a string-literal union (not a free `string`) so that
 * `runWorkflow(run.flowId)` and FLOW_REGISTRY indexing are type-checked
 * end-to-end. New flows must add their FlowId to this union.
 */
export type FlowId = 'feature.standard';

/**
 * Classification of how a single {@link StageStep} is executed.
 *
 *   `'agent'`   — orchestrator spawns an LLM-driven skill (most stages)
 *   `'gate'`    — runs a deterministic gate engine on accumulated artifacts
 *   `'human'`   — orchestrator pauses and awaits a human approval / decision
 *   `'engine'`  — runner-side native logic (e.g. mvn build_test, completion
 *                 report generation, knowledge promotion)
 *
 * In the W2-1 *thin* implementation (PRD ADR Q1=α) this field is set on
 * every StageStep but **not yet read at runtime** — `runWorkflow` keeps the
 * existing per-stage dispatch (`runContextPack` / `runStage` helpers /
 * extracted `executeXxx` named functions). W2-3 onwards begins consuming
 * `kind` / `skillId` to drive a generic dispatcher.
 */
export type StageStepKind = 'agent' | 'gate' | 'human' | 'engine';

/**
 * One step in a flow definition. Carries the {@link WorkflowStage} that
 * runs at that position plus dispatch metadata.
 *
 * `skillId` is the canonical id of a skill (cs-feat-design / cs-issue-fix
 * / etc.) that the agent dispatcher picks up. Optional because non-agent
 * steps (gate / human / engine) don't have an associated skill.
 */
export interface StageStep {
  stage: WorkflowStage;
  kind: StageStepKind;
  skillId?: string;
}

/**
 * Flow definition: an ordered list of {@link StageStep}s plus metadata
 * describing what kind of work it serves.
 *
 * `kind` ties the flow to a {@link WorkflowRunType}; routing (W2-4) uses
 * this to filter eligible flows for a given run-type. Multiple flows may
 * share the same `kind` and differ in variant (e.g. feature.standard vs
 * feature.fastforward both have `kind: 'feature'`).
 */
export interface FlowDef {
  id: FlowId;
  kind: WorkflowRunType;
  /** Human-readable summary surfaced in UI / docs. */
  description: string;
  /** Ordered list of stage steps; the orchestrator iterates in order. */
  stages: readonly StageStep[];
}

export interface WorkflowRun {
  id: WorkflowRunId;
  projectId: ProjectId;
  type: WorkflowRunType;
  status: WorkflowRunStatus;
  currentStage: WorkflowStage;
  /** Reserved for future configuration snapshot reference. */
  configSnapshotId: string | null;
  /** Source branch used as the base when preparing the run worktree. */
  sourceBranch: string;
  /** ai/{runId}-{slug} */
  branch: string;
  /** Path to the worktree workspace, set after Runner prepares it. */
  workspacePath: string | null;
  title: string;
  createdAt: Iso8601;
  updatedAt: Iso8601;
}

export type WorkflowRequestStatus =
  | 'pending'
  | 'awaiting_clarification'
  | 'claimed'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface WorkflowRequest {
  id: WorkflowRequestId;
  projectId: ProjectId;
  type: WorkflowRunType;
  title: string;
  branch: string;
  status: WorkflowRequestStatus;
  claimedBy: string | null;
  workflowRunId: WorkflowRunId | null;
  error: string | null;
  createdAt: Iso8601;
  updatedAt: Iso8601;
}

export type StepRunStatus =
  | 'pending'
  | 'running'
  | 'passed'
  | 'failed'
  | 'skipped'
  | 'cancelled';

export interface StepRun {
  id: StepRunId;
  workflowRunId: WorkflowRunId;
  stage: WorkflowStage;
  name: string;
  status: StepRunStatus;
  startedAt: Iso8601 | null;
  completedAt: Iso8601 | null;
}
