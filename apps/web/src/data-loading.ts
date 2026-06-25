/**
 * Data loading — fetch orchestration that fills global state.
 *
 * `loadData` is the polling backbone (health/projects/runners/requests/
 * runs/runner-control in one sweep); `loadRunDetail` + the `ensure*`
 * helpers lazily fill the per-run caches in `state.ts` and trigger
 * `render()` when fresh data lands. Moved verbatim out of `main.ts`
 * (T2.1 base-layer split) with one wiring change: the SSE stream
 * controller (now `stream.ts`, T2.2) is a feature module above this base
 * layer, so its two entry points are injected by main.ts via
 * `setStreamHooks` instead of being imported (keeps the base layer free
 * of feature-module imports).
 */

import type { ArtifactDto, RunDetail, WorkflowRunDto } from './projection';
import type {
  AgentBackendPreflightDto,
  ArtifactContentDto,
  CommandLogsDto,
  ContextGovernanceDto,
  HealthDto,
  ProjectAgentBackendKind,
  ProjectDto,
  RunnerControlStatusDto,
  RunnerDto,
  WorkflowRequestDto,
} from './types';
import { errorMessage } from '@ainp/shared/browser';
import { api } from './api';
import {
  activeTaskRequest,
  agentBackendPreflight,
  agentBackendPreflightInFlight,
  approvalInFlight,
  approvalLastSubmittedAt,
  artifactContent,
  commandLogs,
  contextGovernanceByRun,
  contextGovernanceInFlight,
  data,
  ui,
} from './state';
import { render } from './render-core';

interface StreamHooks {
  syncActiveStreamSubscription: () => void;
  attachRunStream: (runId: string) => void;
}

// Registered by main.ts at bootstrap. The SSE controller (stream.ts) is a
// feature module above this base layer; these hooks keep the import
// direction one-way.
let streamHooks: StreamHooks = {
  syncActiveStreamSubscription: () => {},
  attachRunStream: () => {},
};

export function setStreamHooks(hooks: StreamHooks): void {
  streamHooks = hooks;
}

export async function loadData(opts: { render?: boolean; keepDetail?: boolean } = {}): Promise<void> {
  // Show skeleton loading state
  if (opts.render !== false && !data.health) {
    ui.isLoadingData = true;
    render();
  }

  try {
    const [health, projects, runners, requests, runs, runnerControl] = await Promise.all([
      api<HealthDto>('/health').catch(() => null),
      api<{ items: ProjectDto[] }>('/projects')
        .then((r) => ({ items: r.items, error: null as string | null }))
        .catch((err) => ({
          items: [] as ProjectDto[],
          error: errorMessage(err),
        })),
      api<{ items: RunnerDto[] }>('/runners').then((r) => r.items).catch(() => []),
      api<{ items: WorkflowRequestDto[] }>('/workflow-requests').then((r) => r.items).catch(() => []),
      api<{ items: WorkflowRunDto[] }>('/workflow-runs').then((r) => r.items).catch(() => []),
      api<RunnerControlStatusDto>('/runner/control/status').catch(() => null),
    ]);
    data.health = health;
    data.projects = projects.items;
    ui.projectsLoadError = projects.error;
    data.runners = runners;
    // 06-25 ask-flow: API already filters kind='ask', but defense-in-depth filter here too
    data.requests = requests.filter(r => r.kind !== 'ask');
    data.runs = [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    data.runnerControl = runnerControl;

    const taskRequest = activeTaskRequest();
    if (taskRequest?.workflowRunId) ui.activeRunId = taskRequest.workflowRunId;
    if (!ui.activeRunId && ui.activePage !== 'task' && data.runs.length > 0) ui.activeRunId = data.runs[0]!.id;
    if (ui.activeRunId && (!opts.keepDetail || data.activeDetail?.run.id !== ui.activeRunId)) {
      await loadRunDetail(ui.activeRunId, false);
    } else if (!ui.activeRunId && ui.activePage === 'task') {
      data.activeDetail = null;
    }
    ui.lastError = null;
  } catch (err) {
    ui.lastError = errorMessage(err);
  } finally {
    ui.isLoadingData = false;
  }
  streamHooks.syncActiveStreamSubscription();
  if (opts.render !== false) render();
}

export async function loadRunDetail(runId: string, shouldRender = true): Promise<void> {
  if (ui.loadingDetailFor === runId) return;
  ui.loadingDetailFor = runId;
  try {
    data.activeDetail = await api<RunDetail>(`/workflow-runs/${encodeURIComponent(runId)}`);
    ui.activeRunId = runId;
    primeArtifactPreviews(data.activeDetail.artifacts);
    void ensureContextGovernance(runId);
    streamHooks.attachRunStream(runId);
  } catch (err) {
    ui.lastError = errorMessage(err);
  } finally {
    ui.loadingDetailFor = null;
  }
  if (shouldRender) render();
}

export async function ensureContextGovernance(runId: string): Promise<void> {
  if (contextGovernanceByRun.has(runId) || contextGovernanceInFlight.has(runId)) return;
  contextGovernanceInFlight.add(runId);
  contextGovernanceByRun.set(runId, null);
  try {
    contextGovernanceByRun.set(
      runId,
      await api<ContextGovernanceDto>(`/workflow-runs/${encodeURIComponent(runId)}/context`),
    );
  } catch {
    contextGovernanceByRun.set(runId, null);
  } finally {
    contextGovernanceInFlight.delete(runId);
  }
  if (data.activeDetail?.run.id === runId) render();
}

export function primeArtifactPreviews(artifacts: ArtifactDto[]): void {
  const previewKinds = new Set([
    'requirement_draft',
    'design_doc',
    'traceability',
    'diff',
    'context_pack',
    'project_profile',
    'other',
    'completion_report',
    'knowledge_candidate',
    'surefire_report',
    'failsafe_report',
  ]);
  for (const artifact of artifacts) {
    if (previewKinds.has(artifact.kind)) void ensureArtifactContent(artifact.id);
  }
}

export async function ensureCommandLogs(commandRunId: string): Promise<void> {
  if (commandLogs.has(commandRunId)) return;
  commandLogs.set(commandRunId, null);
  try {
    commandLogs.set(
      commandRunId,
      await api<CommandLogsDto>(`/command-runs/${encodeURIComponent(commandRunId)}/logs`),
    );
  } catch {
    commandLogs.set(commandRunId, null);
  }
  render();
}

export async function ensureArtifactContent(artifactId: string): Promise<void> {
  if (artifactContent.has(artifactId)) return;
  artifactContent.set(artifactId, null);
  try {
    artifactContent.set(
      artifactId,
      await api<ArtifactContentDto>(`/artifacts/${encodeURIComponent(artifactId)}/content`),
    );
  } catch {
    artifactContent.set(artifactId, null);
  }
  if (data.activeDetail?.artifacts.some((a) => a.id === artifactId)) render();
}

// ---- Shared fetch actions (moved verbatim from main.ts, T2.2 page split) --
// Used by more than one page module (settings/projects/new-task/task-detail/
// knowledge), so they live in the base layer to keep page imports one-way.

export function formAgentBackendKey(backend: ProjectAgentBackendKind | null): string | null {
  return backend ? `backend:${backend}` : null;
}

export async function checkAgentBackend(
  backend: ProjectAgentBackendKind | null,
  projectId: string | null,
): Promise<AgentBackendPreflightDto | null> {
  const key = projectId ?? formAgentBackendKey(backend);
  if (!backend || !key || agentBackendPreflightInFlight.has(key)) return null;
  agentBackendPreflightInFlight.add(key);
  render();
  try {
    const path = projectId
      ? `/projects/${encodeURIComponent(projectId)}/agent-backend/preflight`
      : '/projects/agent-backend/preflight';
    const result = await api<AgentBackendPreflightDto>(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentBackend: backend }),
    });
    agentBackendPreflight.set(key, result);
    if (projectId) agentBackendPreflight.set(formAgentBackendKey(backend)!, result);
    ui.lastError = result.runnable ? null : `${result.label}: ${result.remediationHint}${result.error ? ` (${result.error})` : ''}`;
    return result;
  } catch (err) {
    ui.lastError = errorMessage(err);
    return null;
  } finally {
    agentBackendPreflightInFlight.delete(key);
    render();
  }
}

export async function ensureRunnerStarted(): Promise<void> {
  if (ui.runnerStartInFlight) return;
  ui.runnerStartInFlight = true;
  render();
  try {
    data.runnerControl = await api<RunnerControlStatusDto>('/runner/control/start', { method: 'POST' });
    ui.lastError = null;
    await loadData({ render: false, keepDetail: true });
  } catch (err) {
    ui.lastError =
      err instanceof Error
        ? `${err.message}。可以临时在命令行执行 bun run runner -- watch 作为兜底。`
        : String(err);
  } finally {
    ui.runnerStartInFlight = false;
    render();
  }
}

export async function submitApproval(
  workflowRunId: string,
  gateId: string,
  approved: boolean,
  comment?: string,
): Promise<void> {
  const key = `${workflowRunId}:${gateId}`;
  const now = Date.now();
  const last = approvalLastSubmittedAt.get(key) ?? 0;
  if (approvalInFlight.has(key) || now - last < 2_000) return;
  approvalInFlight.add(key);
  approvalLastSubmittedAt.set(key, now);
  render();
  try {
    const userComment = comment?.trim();
    const finalComment = userComment && userComment.length > 0
      ? userComment
      : approved
        ? 'approved via workbench UI'
        : 'rejected via workbench UI';
    await api('/approvals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflowRunId,
        gateId,
        approved,
        actor: 'web',
        comment: finalComment,
      }),
    });
    await loadRunDetail(workflowRunId, false);
    await loadData({ render: false, keepDetail: true });
    ui.lastError = null;
  } catch (err) {
    ui.lastError = errorMessage(err);
  } finally {
    approvalInFlight.delete(key);
    render();
  }
}
