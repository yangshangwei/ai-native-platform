import type { Iso8601, ProjectId, StepRunId, WorkflowRunId } from './ids';
import type { FlowId, WorkflowRunType, WorkflowStage } from './workflow';

export type ProjectMaturityStage = 'greenfield' | 'growing' | 'legacy';
export type CodebaseAge = 'empty' | 'early' | 'established' | 'unknown';
export type KnowledgeCoverage = 'seeded' | 'partial' | 'recovered' | 'confirmed';
export type EvidenceDensity = 'low' | 'medium' | 'high';
export type Volatility = 'high' | 'medium' | 'low';
export type ProjectPrimaryNeed = 'bootstrap' | 'calibrate' | 'recover';

export interface ProjectMaturityProfile {
  stage: ProjectMaturityStage;
  codebaseAge: CodebaseAge;
  knowledgeCoverage: KnowledgeCoverage;
  evidenceDensity: EvidenceDensity;
  volatility: Volatility;
  primaryNeed: ProjectPrimaryNeed;
}

export type KnowledgeClass = 'seed' | 'recovered' | 'confirmed';
export type ContextTrustLevel = 'source' | 'accepted_knowledge' | 'summary' | 'inference';
export type ContextFreshness = 'current' | 'possibly_stale' | 'historical';

export type ContextManifestItemType =
  | 'project_profile'
  | 'seed'
  | 'domain'
  | 'architecture'
  | 'decision'
  | 'nfr'
  | 'convention'
  | 'task_artifact'
  | 'code_probe';

export type ContextInclusionMode =
  | 'full'
  | 'summary'
  | 'snippet'
  | 'metadata_only'
  | 'retrieval_hint';

export type ContextTrustRequirement = 'source' | 'accepted_knowledge' | 'inference_ok';

export type ContextSourceType =
  | 'task_brief'
  | 'workflow_metadata'
  | 'project_profile'
  | 'knowledge_artifact'
  | 'run_artifact'
  | 'current_input';

export interface ContextManifestItem {
  type: ContextManifestItemType;
  ref: string;
  reason: string;
  priority: 1 | 2 | 3;
  mode: ContextInclusionMode;
  knowledgeClass: KnowledgeClass;
  trustRequired?: ContextTrustRequirement;
  sourceRefs?: string[];
  trustLevel?: ContextTrustLevel;
  freshness?: ContextFreshness;
  confidence?: number;
  sourceType?: ContextSourceType;
  score?: number;
  selectionReasons?: string[];
  degradedFrom?: ContextInclusionMode;
  degradationReason?: string;
}

export interface ContextSection {
  id: string;
  title: string;
  content: string;
  sourceRefs: string[];
  reason: string;
  priority: 1 | 2 | 3;
  knowledgeClass: KnowledgeClass;
  trustLevel: ContextTrustLevel;
  freshness: ContextFreshness;
  confidence: number;
  mode: ContextInclusionMode;
  sourceType?: ContextSourceType;
  score?: number;
  selectionReasons?: string[];
  degradedFrom?: ContextInclusionMode;
  degradationReason?: string;
}

export interface RetrievalHint {
  id: string;
  title: string;
  query: string;
  reason: string;
  sourceRefs: string[];
  priority: 1 | 2 | 3;
}

export type ContextPackMode = 'bootstrap' | 'calibration' | 'recovery' | 'task_execution';

export type KnowledgeReviewSignalKind =
  | 'conflict'
  | 'stale'
  | 'superseded'
  | 'upgrade_candidate'
  | 'downgrade_candidate';

export type KnowledgeReviewSeverity = 'info' | 'warning' | 'review_required';

export interface KnowledgeReviewSignal {
  id: string;
  kind: KnowledgeReviewSignalKind;
  severity: KnowledgeReviewSeverity;
  message: string;
  subjectRefs: string[];
  evidenceRefs: string[];
  recommendedAction: string;
  createdAt: Iso8601;
}

export interface ContextPackBudget {
  maxTokens: number;
  reservedForReasoning: number;
  reservedForOutput: number;
}

export interface ContextPackRunMetadata {
  projectId: ProjectId;
  projectName: string;
  workflowRunId: WorkflowRunId;
  stepRunId: StepRunId | null;
  flowId: FlowId;
  runType: WorkflowRunType;
  sourceBranch: string;
  executionBranch: string;
  workspacePath: string;
}

export interface ContextPack {
  id: string;
  workflowRunId: WorkflowRunId;
  stepRunId: StepRunId | null;
  taskBrief: string;
  stage: WorkflowStage;
  maturityProfile: ProjectMaturityProfile;
  budget: ContextPackBudget;
  mode: ContextPackMode;
  projectSnapshot: string;
  manifest: ContextManifestItem[];
  sections: ContextSection[];
  retrievalHints: RetrievalHint[];
  calibrationSignals?: KnowledgeReviewSignal[];
  run: ContextPackRunMetadata;
  /**
   * Present when this pack is an incremental supplement generated in
   * response to a structured ContextRequest. Optional so historical packs and
   * fixtures remain compatible.
   */
  supplement?: ContextPackSupplement;
  createdAt: Iso8601;
}

export type ContextRequestStatus = 'open' | 'fulfilled' | 'dismissed';

export interface ContextPackSupplement {
  contextRequestId: string;
  baseContextPackId: string | null;
  createdAt: Iso8601;
}

export interface ContextRequest {
  id: string;
  workflowRunId: WorkflowRunId;
  stepRunId: StepRunId | null;
  stage: WorkflowStage;
  reason: string;
  requestedRefs: string[];
  questions: string[];
  priority: 1 | 2 | 3;
  status: ContextRequestStatus;
  createdAt: Iso8601;
}

export const KNOWLEDGE_CLASSES = ['seed', 'recovered', 'confirmed'] as const satisfies readonly KnowledgeClass[];
export const CONTEXT_TRUST_LEVELS = ['source', 'accepted_knowledge', 'summary', 'inference'] as const satisfies readonly ContextTrustLevel[];
export const CONTEXT_FRESHNESS_VALUES = ['current', 'possibly_stale', 'historical'] as const satisfies readonly ContextFreshness[];
export const CONTEXT_PACK_MODES = ['bootstrap', 'calibration', 'recovery', 'task_execution'] as const satisfies readonly ContextPackMode[];
export const CONTEXT_REQUEST_STATUSES = ['open', 'fulfilled', 'dismissed'] as const satisfies readonly ContextRequestStatus[];
export const KNOWLEDGE_REVIEW_SIGNAL_KINDS = [
  'conflict',
  'stale',
  'superseded',
  'upgrade_candidate',
  'downgrade_candidate',
] as const satisfies readonly KnowledgeReviewSignalKind[];
export const KNOWLEDGE_REVIEW_SEVERITIES = [
  'info',
  'warning',
  'review_required',
] as const satisfies readonly KnowledgeReviewSeverity[];

export function isKnowledgeClass(value: unknown): value is KnowledgeClass {
  return typeof value === 'string' && (KNOWLEDGE_CLASSES as readonly string[]).includes(value);
}

export function isContextTrustLevel(value: unknown): value is ContextTrustLevel {
  return typeof value === 'string' && (CONTEXT_TRUST_LEVELS as readonly string[]).includes(value);
}

export function isContextFreshness(value: unknown): value is ContextFreshness {
  return typeof value === 'string' && (CONTEXT_FRESHNESS_VALUES as readonly string[]).includes(value);
}

export function isContextPackMode(value: unknown): value is ContextPackMode {
  return typeof value === 'string' && (CONTEXT_PACK_MODES as readonly string[]).includes(value);
}

export function isContextRequestStatus(value: unknown): value is ContextRequestStatus {
  return typeof value === 'string' && (CONTEXT_REQUEST_STATUSES as readonly string[]).includes(value);
}

export function isKnowledgeReviewSignalKind(value: unknown): value is KnowledgeReviewSignalKind {
  return typeof value === 'string'
    && (KNOWLEDGE_REVIEW_SIGNAL_KINDS as readonly string[]).includes(value);
}

export function isKnowledgeReviewSeverity(value: unknown): value is KnowledgeReviewSeverity {
  return typeof value === 'string'
    && (KNOWLEDGE_REVIEW_SEVERITIES as readonly string[]).includes(value);
}
