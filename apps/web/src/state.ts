/**
 * Global app state + read-only selectors.
 *
 * Single source of truth for server data (`data`), cross-page UI state
 * (`ui`), and the per-feature cache Maps/Sets that must survive `render()`
 * calls. Selectors at the bottom are pure reads over this state. Moved out
 * of `main.ts` (T2.1 base-layer split); the only rewrite was mechanical:
 * former module-level `let` bindings became properties of the `ui` object,
 * because ES-module `export let` is a read-only live binding for importers.
 * Page-private state now lives in its page module (T2.2: settings/reports/
 * knowledge/stream); coordinator drafts and new-task drafts still live in
 * `main.ts` until those modules move (T2.3).
 */

import type {
  AgentBackendKind,
  AgentBackendPreflightDto,
  AppData,
  ArtifactContentDto,
  CommandLogsDto,
  ContextGovernanceDto,
  LocalDirectoryPickerState,
  Page,
  ProjectAgentBackendKind,
  ProjectDto,
  ProjectSourceFormState,
  RunnerDto,
  StatusKind,
  WorkflowRequestDto,
} from './types';
import {
  latestArtifactOfKind,
  parseKnowledgeArtifact,
  type ArtifactDto,
  type KnowledgeSuggestion,
  type RunDetail,
} from './projection';

export const data: AppData = {
  health: null,
  projects: [],
  runners: [],
  requests: [],
  runs: [],
  activeDetail: null,
  runnerControl: null,
};

// Cross-module mutable UI state. These were bare module-level `let`s in
// main.ts; they are grouped into one object so other modules can assign
// them (`ui.activePage = …`).
//
// IME composition guards (spec: .trellis/spec/web/frontend/state-management.md
// "Defer root rebuild while an IME composition is active"):
// - `coordinatorReplyComposing` / `knowledgeEditComposing` track an active
//   composition by stable entity id; render() must not rebuild the root
//   while either is set, because the rebuild would destroy the composing
//   node and lose the uncommitted IME text along with the caret.
// - The matching `*RenderDeferred` flags record that at least one render
//   was skipped so `compositionend` can catch up via queueMicrotask.
// - `isReplacingAppRootForRender` marks blur events caused by the root
//   rebuild itself so they are not treated as user intent.
export const ui = {
  activePage: 'workbench' as Page,
  activeRunId: null as string | null,
  activeTaskRequestId: null as string | null,
  loadingDetailFor: null as string | null,
  runnerStartInFlight: false,
  lastError: null as string | null,
  projectsLoadError: null as string | null,
  knowledgeEditComposing: null as { key: string } | null,
  knowledgeEditRenderDeferred: false,
  coordinatorReplyComposing: null as { requestId: string } | null,
  coordinatorReplyRenderDeferred: false,
  isReplacingAppRootForRender: false,
};

export const artifactContent = new Map<string, ArtifactContentDto | null>();
export const openArtifactViewers = new Set<string>();
export const commandLogs = new Map<string, CommandLogsDto | null>();
export const contextGovernanceByRun = new Map<string, ContextGovernanceDto | null>();
export const contextGovernanceInFlight = new Set<string>();
export const approvalInFlight = new Set<string>();
export const approvalLastSubmittedAt = new Map<string, number>();
export const projectActionInFlight = new Set<string>();
export const projectBranchRefreshInFlight = new Set<string>();
export const agentBackendPreflight = new Map<string, AgentBackendPreflightDto>();
export const agentBackendPreflightInFlight = new Set<string>();
export const runnerAutoStartAttemptedForRequest = new Set<string>();

export const localDirectoryPicker: LocalDirectoryPickerState = {
  open: false,
  loading: false,
  error: null,
  listing: null,
};

export const projectSourceForm: ProjectSourceFormState = {
  editingProjectId: null,
  sourceKind: 'github',
  agentBackend: '',
  name: '',
  sourceValue: '',
  sourceAuthKind: 'none',
  sourceUsername: '',
  sourceCredential: '',
  defaultBranch: 'main',
  detectResult: null,
  detecting: false,
};

export function projectName(projectId: string): string {
  return data.projects.find((p) => p.id === projectId)?.name ?? projectId;
}

export function selectedProject(): ProjectDto | null {
  const active = data.activeDetail?.run.projectId ?? data.runs[0]?.projectId ?? data.projects[0]?.id;
  return data.projects.find((p) => p.id === active) ?? data.projects[0] ?? null;
}

export function activeProjects(): ProjectDto[] {
  return data.projects.filter((p) => (p.status ?? 'active') === 'active');
}

export function sourceBranchesForProject(project: ProjectDto | null | undefined): string[] {
  if (!project) return ['main'];
  return normalizeBranchList(project.defaultBranch, project.sourceBranches);
}

export function normalizeBranchList(defaultBranch: string | null | undefined, branches: string[] | null | undefined): string[] {
  const normalized = [defaultBranch ?? 'main', ...(branches ?? [])]
    .map((branch) => branch.trim())
    .filter(Boolean);
  const unique = [...new Set(normalized)];
  return unique.length ? unique : ['main'];
}

export function latestRunner(): RunnerDto | null {
  return [...data.runners].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))[0] ?? null;
}

export function activeTaskRequest(): WorkflowRequestDto | null {
  if (!ui.activeTaskRequestId) return null;
  return data.requests.find((request) => request.id === ui.activeTaskRequestId) ?? null;
}

export function agentBackendDisplayName(kind: AgentBackendKind | null | undefined): string {
  if (kind === 'claude_code') return 'Claude Code';
  if (kind === 'codex') return 'Codex';
  return 'Legacy test backend';
}

export function selectedProjectBackend(): ProjectAgentBackendKind | null {
  return selectedProject()?.agentBackend ?? null;
}

export function activeRunAgentBackend(): AgentBackendKind | null {
  const tasks = data.activeDetail?.agentTasks ?? [];
  const backend = tasks.at(-1)?.backend;
  if (backend === 'claude_code' || backend === 'codex' || backend === 'native') return backend;
  return null;
}

export function agentBackendLabel(): string {
  const runBackend = activeRunAgentBackend();
  if (runBackend) return agentBackendDisplayName(runBackend);
  const projectBackend = selectedProjectBackend();
  return projectBackend ? agentBackendDisplayName(projectBackend) : '未配置';
}

export function agentBackendStatusForProject(project: ProjectDto | null): { label: string; kind: StatusKind } {
  if (!project?.agentBackend) return { label: '待配置', kind: 'warn' };
  const check = preflightForProjectBackend(project);
  if (!check) return { label: '未检测', kind: 'muted' };
  if (check.runnable) return { label: '已连接', kind: 'good' };
  if (check.status === 'needs_login') return { label: '需要登录', kind: 'warn' };
  if (check.status === 'missing_cli') return { label: '缺少 CLI', kind: 'bad' };
  return { label: '检测失败', kind: 'bad' };
}

export function projectAvailability(project: ProjectDto): { label: string; kind: StatusKind } {
  if ((project.status ?? 'active') === 'archived') return { label: '已归档', kind: 'warn' };
  if (!project.agentBackend) return { label: '待配置', kind: 'warn' };
  const backend = agentBackendStatusForProject(project);
  if (backend.kind === 'bad') return { label: '检测失败', kind: 'bad' };
  if (backend.label === '需要登录') return { label: '待配置', kind: 'warn' };
  return { label: '可用', kind: 'good' };
}

export function agentBackendContextLabel(project: ProjectDto | null): { value: string; kind: StatusKind } {
  const backend = agentBackendLabel();
  const status = agentBackendStatusForProject(project);
  return {
    value: backend === '未配置' ? '待配置' : `${backend} · ${status.label}`,
    kind: status.kind,
  };
}

export function agentBackendLabelForProject(project: ProjectDto | null): string {
  if (!project) return '未选择项目';
  return project.agentBackend ? agentBackendDisplayName(project.agentBackend) : '未配置';
}

export function preflightForProjectBackend(project: ProjectDto | null): AgentBackendPreflightDto | null {
  if (!project?.agentBackend) return null;
  const check = agentBackendPreflight.get(project.id);
  return check?.backend === project.agentBackend ? check : null;
}

export function buildEnvLabel(): string {
  const runner = latestRunner();
  if (!runner) return '等待 runner heartbeat';
  const jdk = runner.jdkVersion ? `JDK ${runner.jdkVersion}` : 'JDK ?';
  const mvn = runner.mavenVersion ? `Maven ${runner.mavenVersion.split('\n')[0]}` : 'Maven ?';
  return `${jdk} · ${mvn}`;
}

// ---- Artifact text selectors (moved verbatim from main.ts, T2.2 page
// split) — pure reads over `artifactContent` + a passed RunDetail, shared
// by the task-detail/reports/knowledge renderers.

export function artifactText(detail: RunDetail, kind: string): string {
  const artifact = latestArtifactOfKind(detail.artifacts, kind);
  return artifact ? (artifactContent.get(artifact.id)?.text ?? '') : '';
}

export function artifactTextBy(
  detail: RunDetail,
  kind: string,
  predicate: (artifact: ArtifactDto) => boolean,
): string {
  const artifact =
    detail.artifacts
      .filter((candidate) => candidate.kind === kind && predicate(candidate))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .at(-1) ?? null;
  return artifact ? (artifactContent.get(artifact.id)?.text ?? '') : '';
}

export function markdownArtifactText(detail: RunDetail, kind: string): string {
  return (
    artifactTextBy(
      detail,
      kind,
      (artifact) =>
        artifact.contentType.includes('markdown') ||
        (typeof artifact.metadata?.output === 'string' && artifact.metadata.output.endsWith('.md')),
    ) || artifactText(detail, kind)
  );
}

export function structuredArtifactText(detail: RunDetail, kind: string): string {
  return artifactTextBy(
    detail,
    kind,
    (artifact) =>
      artifact.contentType === 'application/json' ||
      artifact.metadata?.structured === true ||
      (typeof artifact.metadata?.output === 'string' && artifact.metadata.output.endsWith('.json')),
  );
}

export function parsedKnowledge(detail: RunDetail): KnowledgeSuggestion[] {
  return parseKnowledgeArtifact(
    markdownArtifactText(detail, 'knowledge_candidate'),
    structuredArtifactText(detail, 'knowledge_candidate'),
  );
}
