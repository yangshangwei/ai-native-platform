import type {
  AgentSessionId,
  ArtifactId,
  HandoffId,
  Iso8601,
  StepRunId,
  WorkflowRunId,
} from './ids';
import type { InputInjectionMode } from './context';
import type { WorkflowStage } from './workflow';
import { isWorkflowStage } from './workflow';

export const STAGE_HANDOFF_SCHEMA_VERSION = 'ainp.stage_handoff.v1' as const;
export const REQUIREMENT_DESIGN_STAGE_HANDOFF_INPUT = 'stage_handoff.requirement.design.md' as const;

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

export type StageHandoffInjectionPreference = Extract<
  InputInjectionMode,
  'full' | 'summary' | 'reference'
>;

export interface StageProducedArtifactRef {
  key: string;
  artifactId: ArtifactId;
  kind: string;
  injectionPreference: StageHandoffInjectionPreference;
}

export interface StageHandoffMetadata {
  schemaVersion: typeof STAGE_HANDOFF_SCHEMA_VERSION;
  workflowRunId: WorkflowRunId;
  fromStage: WorkflowStage;
  toStage: WorkflowStage;
  summary: string;
  decisions: string[];
  risks: string[];
  openQuestions: string[];
  producedArtifacts: StageProducedArtifactRef[];
  createdAt: Iso8601;
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

export function isStageHandoffInjectionPreference(
  value: unknown,
): value is StageHandoffInjectionPreference {
  return value === 'full' || value === 'summary' || value === 'reference';
}

export function isStageProducedArtifactRef(value: unknown): value is StageProducedArtifactRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.key === 'string'
    && record.key.trim().length > 0
    && typeof record.artifactId === 'string'
    && record.artifactId.trim().length > 0
    && typeof record.kind === 'string'
    && record.kind.trim().length > 0
    && isStageHandoffInjectionPreference(record.injectionPreference);
}

export function isStageHandoffMetadata(value: unknown): value is StageHandoffMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === STAGE_HANDOFF_SCHEMA_VERSION
    && typeof record.workflowRunId === 'string'
    && record.workflowRunId.trim().length > 0
    && isWorkflowStage(record.fromStage)
    && isWorkflowStage(record.toStage)
    && typeof record.summary === 'string'
    && Array.isArray(record.decisions)
    && record.decisions.every((item) => typeof item === 'string')
    && Array.isArray(record.risks)
    && record.risks.every((item) => typeof item === 'string')
    && Array.isArray(record.openQuestions)
    && record.openQuestions.every((item) => typeof item === 'string')
    && Array.isArray(record.producedArtifacts)
    && record.producedArtifacts.every(isStageProducedArtifactRef)
    && typeof record.createdAt === 'string'
    && record.createdAt.trim().length > 0;
}

export function stageHandoffFromMetadata(
  metadata: Record<string, unknown>,
): StageHandoffMetadata | null {
  const value = metadata.stageHandoff;
  return isStageHandoffMetadata(value) ? value : null;
}
