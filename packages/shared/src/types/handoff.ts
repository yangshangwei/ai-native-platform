import type {
  AgentSessionId,
  ArtifactId,
  HandoffId,
  Iso8601,
  StepRunId,
  WorkflowRunId,
} from './ids';
import type { WorkflowStage } from './workflow';

export const HANDOFF_STATUSES = [
  'requested',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;
export type HandoffStatus = (typeof HANDOFF_STATUSES)[number];

export const HANDOFF_ADOPTION_DECISIONS = [
  'pending',
  'adopted',
  'rejected',
  'needs_review',
] as const;
export type HandoffAdoptionDecision = (typeof HANDOFF_ADOPTION_DECISIONS)[number];

export const HANDOFF_ROLES = [
  'main',
  'reviewer',
  'debugger',
  'verifier',
  'planner',
  'executor',
] as const;
export type HandoffRole = (typeof HANDOFF_ROLES)[number];

export interface HandoffExpectedOutput {
  schemaVersion: string;
  artifactKind: string;
  description: string;
}

export interface HandoffRecord {
  id: HandoffId;
  workflowRunId: WorkflowRunId;
  stepRunId: StepRunId | null;
  parentSessionId: AgentSessionId | null;
  childSessionId: AgentSessionId | null;
  fromRole: HandoffRole;
  toRole: HandoffRole;
  reason: string;
  inputArtifactIds: ArtifactId[];
  expectedOutput: HandoffExpectedOutput;
  stopCondition: string;
  status: HandoffStatus;
  adoptionDecision: HandoffAdoptionDecision;
  outputArtifactIds: ArtifactId[];
  createdAt: Iso8601;
  updatedAt: Iso8601;
  completedAt: Iso8601 | null;
  metadata: Record<string, unknown>;
}

export function isHandoffStatus(value: unknown): value is HandoffStatus {
  return typeof value === 'string'
    && (HANDOFF_STATUSES as readonly string[]).includes(value);
}

export function isHandoffAdoptionDecision(value: unknown): value is HandoffAdoptionDecision {
  return typeof value === 'string'
    && (HANDOFF_ADOPTION_DECISIONS as readonly string[]).includes(value);
}

export function isHandoffRole(value: unknown): value is HandoffRole {
  return typeof value === 'string'
    && (HANDOFF_ROLES as readonly string[]).includes(value);
}
