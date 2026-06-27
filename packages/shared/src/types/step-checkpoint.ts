import type {
  AgentSessionId,
  ArtifactId,
  GateRunId,
  Iso8601,
  StepCheckpointId,
  StepRunId,
  WorkflowRunId,
} from './ids';
import type { WorkflowStage } from './workflow';

export const STEP_CHECKPOINT_STATUSES = [
  'pending',
  'running',
  'passed',
  'failed',
  'cancelled',
  'skipped',
] as const;

export type StepCheckpointStatus = (typeof STEP_CHECKPOINT_STATUSES)[number];

export interface StepCheckpoint {
  id: StepCheckpointId;
  workflowRunId: WorkflowRunId;
  stepRunId: StepRunId;
  stage: WorkflowStage;
  status: StepCheckpointStatus;
  inputArtifactIds: ArtifactId[];
  outputArtifactIds: ArtifactId[];
  contextPackId: string | null;
  agentSessionIds: AgentSessionId[];
  toolInvocationIds: string[];
  gateRunIds: GateRunId[];
  retryIndex: number;
  resumeCursor: string | null;
  failureReason: string | null;
  createdAt: Iso8601;
  updatedAt: Iso8601;
  metadata: Record<string, unknown>;
}

export function isStepCheckpointStatus(value: unknown): value is StepCheckpointStatus {
  return typeof value === 'string'
    && (STEP_CHECKPOINT_STATUSES as readonly string[]).includes(value);
}
