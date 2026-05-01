import type {
  AgentTaskId,
  AgentResultId,
  WorkflowRunId,
  StepRunId,
  Iso8601,
  ArtifactId,
} from './ids';

export type AgentBackendKind = 'native' | 'codex' | 'claude_code';

export type AgentTaskKind =
  | 'requirement_draft'
  | 'design_draft'
  | 'implementation'
  | 'review'
  | 'debug'
  | 'noop';

export interface AgentTask {
  id: AgentTaskId;
  workflowRunId: WorkflowRunId;
  stepRunId: StepRunId | null;
  kind: AgentTaskKind;
  backend: AgentBackendKind;
  /** Resolved prompt / instructions. The platform owns this, not the backend. */
  prompt: string;
  /** Inputs used by the backend (artifacts, context-pack refs, etc.). */
  inputArtifactIds: ArtifactId[];
  createdAt: Iso8601;
}

export interface AgentResult {
  id: AgentResultId;
  taskId: AgentTaskId;
  status: 'success' | 'failed' | 'cancelled';
  /** Free-form summary from the agent — never used to advance state. */
  summary: string;
  outputArtifactIds: ArtifactId[];
  startedAt: Iso8601;
  completedAt: Iso8601;
}
