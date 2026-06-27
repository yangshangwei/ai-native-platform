/**
 * Shared DTO / view-state type definitions for the web SPA.
 *
 * Pure types only — no values, no DOM, no fetch. DTOs that mirror a
 * `@ainp/shared` entity are *derived* from it (T2.4) so shared-type changes
 * become compile errors here instead of silent drift; api-private shapes
 * (no shared source) stay hand-aligned with a comment pointing at the
 * source. UI-side state shapes (`AppData`, picker/form state) are web-owned.
 */

import type {
  ArtifactDto,
  KnowledgeSuggestion,
  RunDetail,
  WorkflowRunDto,
} from './projection';
import type {
  AgentBackendPreflight,
  KnowledgeArtifact,
  Project,
  ProjectAgentBackendKind,
  ProjectSourceAuthKind,
  ProjectSourceKind,
  StageProducedArtifactRef,
  WorkflowRequest,
} from '@ainp/shared/browser';

// Re-exported verbatim from @ainp/shared (previously hand-copied here).
export type {
  AgentBackendKind,
  ProjectAgentBackendKind,
  ProjectSourceAuthKind,
  ProjectSourceKind,
} from '@ainp/shared/browser';

export type Page = 'workbench' | 'my-todos' | 'task' | 'projects' | 'new-task' | 'reports' | 'knowledge' | 'settings';
export type StatusKind = 'good' | 'warn' | 'bad' | 'info' | 'muted';
export type KnowledgeArtifactDto = KnowledgeArtifact;
export type KnowledgeActionDecision = 'accepted' | 'ignored' | 'edited';
export type KnowledgeViewId = 'pending' | 'accepted' | 'usage' | 'maintenance';
export type ReportViewId = 'all' | 'attention' | 'acceptable' | 'running';

/**
 * Project as serialized by the API (apps/api/src/routes/projects.ts:529-536):
 * the shared {@link Project} minus the runner-only `sourceCredential` secret
 * (the API redacts it), plus the API-derived `hasSourceCredential` flag.
 */
export type ProjectDto = Omit<Project, 'sourceCredential'> & {
  /** API-added replacement for the redacted credential (routes/projects.ts:535). */
  hasSourceCredential?: boolean;
};

export interface SourceDetectSuccess {
  ok: true;
  sourceKind: ProjectSourceKind;
  sourceUrl: string | null;
  localPath: string | null;
  projectName: string;
  defaultBranch: string;
  branches: string[];
  metadata: Record<string, string>;
}

export interface SourceDetectFailure {
  ok: false;
  error: string;
}

export type SourceDetectResult = SourceDetectSuccess | SourceDetectFailure;

export type ProjectBranchListResult =
  | {
      ok: true;
      defaultBranch: string;
      detectedDefaultBranch: string;
      branches: string[];
      metadata: Record<string, string>;
    }
  | { ok: false; error: string };

export interface LocalDirectoryItem {
  name: string;
  path: string;
}

export interface LocalDirectoryList {
  path: string;
  parent: string;
  directories: LocalDirectoryItem[];
}

export interface LocalDirectoryPickerState {
  open: boolean;
  loading: boolean;
  error: string | null;
  listing: LocalDirectoryList | null;
}

export interface ProjectSourceFormState {
  editingProjectId: string | null;
  sourceKind: ProjectSourceKind;
  agentBackend: ProjectAgentBackendKind | '';
  name: string;
  sourceValue: string;
  sourceAuthKind: ProjectSourceAuthKind;
  sourceUsername: string;
  sourceCredential: string;
  defaultBranch: string;
  buildCompileCommand: string;
  buildTestCommand: string;
  detectResult: SourceDetectResult | null;
  detecting: boolean;
}

/** Exactly the shared {@link AgentBackendPreflight} — the API serializes it verbatim. */
export type AgentBackendPreflightDto = AgentBackendPreflight;

export interface ProjectDeletePreviewDto {
  canHardDelete: boolean;
  canArchive: boolean;
  activeRequests: number;
  activeRuns: number;
  totalRequests: number;
  totalRuns: number;
  recommendation: 'hard_delete' | 'archive' | 'blocked_active_work' | 'already_archived';
}

export interface RunnerDto {
  id: string;
  host: string;
  version: string;
  jdkVersion: string | null;
  mavenVersion: string | null;
  gitVersion: string | null;
  lastSeenAt: string;
  status: 'online' | 'stale' | 'offline';
}

/**
 * Exactly the shared {@link WorkflowRequest} — the API list/detail responses
 * serialize the entity verbatim (including the always-present, nullable
 * `flowId` / `startStage` UI overrides).
 */
export type WorkflowRequestDto = WorkflowRequest;

export interface HealthDto {
  ok: boolean;
  counts: Record<string, number>;
}

export interface ArtifactContentDto {
  artifact: ArtifactDto;
  text: string;
  contentType: string;
  filename: string;
  digest: DigestVerificationDto;
}

export interface CommandLogsDto {
  commandRun: RunDetail['commands'][number];
  stdout: { text: string; contentType: string; filename: string; digest: DigestVerificationDto };
  stderr: { text: string; contentType: string; filename: string; digest: DigestVerificationDto };
}

export type DigestVerificationDto =
  | { algorithm: 'sha256'; expected: string; actual: string; verified: boolean }
  | { algorithm: 'sha256'; expected: null; actual: string; verified: null };

/**
 * Hand-aligned with the api-private read model in
 * apps/api/src/context-governance.ts. No shared source exists for this DTO yet.
 */
export interface ContextGovernanceDto {
  schemaVersion: 'ainp.context_governance.v1';
  workflowRunId: string;
  projectId: string;
  contextPacks: Array<{
    contextPackId: string;
    source: string;
    artifactId: string | null;
    taskId: string | null;
    stage: string | null;
    mode: string | null;
    role: string | null;
    invocationId: string | null;
    retryIndex: number | null;
    contextRequestId: string | null;
    baseContextPackId: string | null;
    baseContextPackArtifactId: string | null;
    supplement: unknown;
    manifest: ContextManifestDto[];
    retrievalHints: unknown[];
    calibrationSignals: unknown[];
    contextPack: unknown | null;
  }>;
  manifest: ContextManifestDto[];
  sourceRefs: Array<{
    sourceRef: string;
    contextPackIds: string[];
    manifestRefs: string[];
    trustLevels: string[];
    knowledgeClasses: string[];
  }>;
  trustLevels: Record<string, number>;
  budgetDecisions: Array<{
    contextPackId: string;
    ref: string;
    mode: string | null;
    degradedFrom: string | null;
    degradationReason: string | null;
    score: number | null;
  }>;
  contextRequests: Array<{
    id: string;
    actionId: string;
    status: string;
    priority: number | null;
    reason: string;
    requestedRefs: string[];
    questions: string[];
    sourceName: string | null;
    taskId: string | null;
    baseContextPackId: string | null;
    baseContextPackArtifactId: string | null;
    supplementContextPackId: string | null;
    requestArtifactId: string | null;
    supplementArtifactId: string | null;
    createdAt: string;
  }>;
  stageHandoffs: ContextStageHandoffDto[];
  metrics: {
    impactCoverage: RatioMetricDto;
    evidenceTraceability: RatioMetricDto;
    irrelevantContextRatio: RatioMetricDto;
    contextRequestCount: { value: number; explanation: string };
    downstreamReworkSignal: {
      value: number;
      rejectedApprovals: number;
      failedGates: number;
      failedAgentResults: number;
      explanation: string;
    };
  };
}

export interface ContextStageHandoffDto {
  id: string;
  artifactId: string | null;
  fromStage: string;
  toStage: string;
  summary: string;
  decisions: string[];
  risks: string[];
  openQuestions: string[];
  producedArtifacts: StageProducedArtifactRef[];
  createdAt: string;
}

export interface ContextManifestDto {
  contextPackId: string;
  ref: string;
  reason: string;
  priority: number | null;
  mode: string | null;
  knowledgeClass: string | null;
  trustLevel: string | null;
  freshness: string | null;
  sourceType: string | null;
  sourceRefs: string[];
  score: number | null;
  selectionReasons: string[];
  degradedFrom: string | null;
  degradationReason: string | null;
}

export interface RatioMetricDto {
  value: number;
  numerator: number;
  denominator: number;
  explanation: string;
}

export interface RunnerControlStatusDto {
  mode: 'api-managed-local-runner';
  running: boolean;
  pid: number | null;
  startedAt: string | null;
  stoppedAt: string | null;
  command: string[];
  lastExit: { code: number | null; signal: string | null; at: string } | null;
  recentLogs: string[];
  latestHeartbeat: RunnerDto | null;
}

export interface KnowledgeArtifactsState {
  projectId: string | null;
  loading: boolean;
  loadedOnce: boolean;
  error: string | null;
  artifacts: KnowledgeArtifactDto[];
}

export interface KnowledgeSuggestionItem {
  suggestion: KnowledgeSuggestion;
  index: number;
  key: string;
  targetId: string;
  decision: KnowledgeActionDecision | undefined;
  text: string;
}

export interface AppData {
  health: HealthDto | null;
  projects: ProjectDto[];
  runners: RunnerDto[];
  requests: WorkflowRequestDto[];
  runs: WorkflowRunDto[];
  activeDetail: RunDetail | null;
  runnerControl: RunnerControlStatusDto | null;
}
