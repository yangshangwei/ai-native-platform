/**
 * Shared DTO / view-state type definitions for the web SPA.
 *
 * Pure types only — no values, no DOM, no fetch. These mirror the API
 * response shapes (`/projects`, `/workflow-requests`, `/workflow-runs`, …)
 * plus a few UI-side state shapes (`AppData`, picker/form state). Moved
 * verbatim out of `main.ts` (T2.1 base-layer split); DTO/shared-type
 * unification is deliberately out of scope here.
 */

import type {
  ArtifactDto,
  FlowId,
  KnowledgeSuggestion,
  RunDetail,
  Stage,
  WorkflowRunDto,
} from './projection';
import type { KnowledgeArtifact } from '@ainp/shared';

export type Page = 'workbench' | 'task' | 'projects' | 'new-task' | 'reports' | 'knowledge' | 'settings';
export type StatusKind = 'good' | 'warn' | 'bad' | 'info' | 'muted';
export type ProjectAgentBackendKind = 'claude_code' | 'codex';
export type AgentBackendKind = ProjectAgentBackendKind | 'native';
export type KnowledgeArtifactDto = KnowledgeArtifact;
export type KnowledgeActionDecision = 'accepted' | 'ignored' | 'edited';
export type KnowledgeViewId = 'pending' | 'accepted' | 'usage' | 'maintenance';
export type ReportViewId = 'all' | 'attention' | 'acceptable' | 'running';

export interface ProjectDto {
  id: string;
  name: string;
  localPath: string;
  sourceKind?: ProjectSourceKind;
  sourceUrl?: string | null;
  sourceAuthKind?: ProjectSourceAuthKind;
  sourceUsername?: string | null;
  hasSourceCredential?: boolean;
  agentBackend?: ProjectAgentBackendKind | null;
  status?: 'active' | 'archived';
  archivedAt?: string | null;
  language: string;
  buildTool: string;
  /** Optional project-specific compile command; null/missing = Maven default. */
  buildCompileCommand?: string | null;
  /** Optional project-specific test command; null/missing = Maven default. */
  buildTestCommand?: string | null;
  defaultBranch: string;
  sourceBranches?: string[];
  registeredAt: string;
}


export type ProjectSourceKind = 'local' | 'github' | 'gitee' | 'git' | 'gitlab';
export type ProjectSourceAuthKind = 'none' | 'ssh' | 'token' | 'basic';

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

export interface AgentBackendPreflightDto {
  backend: ProjectAgentBackendKind | null;
  label: string;
  bin: string | null;
  installed: boolean;
  runnable: boolean;
  authenticated: boolean | null;
  version: string | null;
  status: 'not_configured' | 'connected' | 'missing_cli' | 'needs_login' | 'not_runnable';
  error: string | null;
  remediationHint: string;
  checkedAt: string;
}


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

export interface WorkflowRequestDto {
  id: string;
  projectId: string;
  type: 'feature' | 'bugfix' | 'smoke' | 'refactor';
  title: string;
  branch: string;
  status: 'pending' | 'awaiting_clarification' | 'claimed' | 'completed' | 'failed' | 'cancelled';
  claimedBy: string | null;
  workflowRunId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  // V2 W2: optional UI overrides serialized by the API. Drive the queued
  // lifecycle preview before a Workflow Run exists; null/absent → router
  // picks the flow (preview as feature.standard).
  flowId?: FlowId | null;
  startStage?: Stage | null;
}

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
    manifest: ContextManifestDto[];
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
    supplementContextPackId: string | null;
    requestArtifactId: string | null;
    supplementArtifactId: string | null;
    createdAt: string;
  }>;
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
