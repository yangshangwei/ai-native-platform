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

export interface WorkflowRun {
  id: WorkflowRunId;
  projectId: ProjectId;
  type: WorkflowRunType;
  status: WorkflowRunStatus;
  currentStage: WorkflowStage;
  /** Reserved for future configuration snapshot reference. */
  configSnapshotId: string | null;
  /** ai/{runId}-{slug} */
  branch: string;
  /** Path to the worktree workspace, set after Runner prepares it. */
  workspacePath: string | null;
  title: string;
  createdAt: Iso8601;
  updatedAt: Iso8601;
}

export type WorkflowRequestStatus = 'pending' | 'claimed' | 'completed' | 'failed' | 'cancelled';

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
