/**
 * Data loading — fetch orchestration that fills global state.
 *
 * `loadData` is the polling backbone (health/projects/runners/requests/
 * runs/runner-control in one sweep); `loadRunDetail` + the `ensure*`
 * helpers lazily fill the per-run caches in `state.ts` and trigger
 * `render()` when fresh data lands. Moved verbatim out of `main.ts`
 * (T2.1 base-layer split) with one wiring change: the SSE stream
 * controller still lives in `main.ts`, so its two entry points are
 * injected via `setStreamHooks` instead of being imported (avoids a
 * main.ts <-> data-loading import cycle until the stream module moves).
 */

import type { ArtifactDto, RunDetail, WorkflowRunDto } from './projection';
import type {
  ArtifactContentDto,
  CommandLogsDto,
  ContextGovernanceDto,
  HealthDto,
  KnowledgeArtifactDto,
  ProjectDto,
  RunnerControlStatusDto,
  RunnerDto,
  WorkflowRequestDto,
} from './types';
import { errorMessage } from '@ainp/shared';
import { api } from './api';
import {
  activeTaskRequest,
  artifactContent,
  commandLogs,
  contextGovernanceByRun,
  contextGovernanceInFlight,
  data,
  knowledgeArtifactsState,
  ui,
} from './state';
import { render } from './render-core';

interface StreamHooks {
  syncActiveStreamSubscription: () => void;
  attachRunStream: (runId: string) => void;
}

// Registered by main.ts at bootstrap. The SSE controller has not been
// extracted yet (T2.3); these hooks keep the import direction one-way.
let streamHooks: StreamHooks = {
  syncActiveStreamSubscription: () => {},
  attachRunStream: () => {},
};

export function setStreamHooks(hooks: StreamHooks): void {
  streamHooks = hooks;
}

export async function loadData(opts: { render?: boolean; keepDetail?: boolean } = {}): Promise<void> {
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
    data.requests = requests;
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

export async function loadKnowledgeArtifacts(projectId: string, shouldRender = true): Promise<void> {
  if (knowledgeArtifactsState.loading && knowledgeArtifactsState.projectId === projectId) return;
  const staleProject = knowledgeArtifactsState.projectId !== projectId;
  knowledgeArtifactsState.projectId = projectId;
  knowledgeArtifactsState.loading = true;
  knowledgeArtifactsState.error = null;
  if (staleProject) {
    knowledgeArtifactsState.loadedOnce = false;
    knowledgeArtifactsState.artifacts = [];
  }
  try {
    const body = await api<{ ok: boolean; artifacts: KnowledgeArtifactDto[] }>(
      `/knowledge-artifacts/projects/${encodeURIComponent(projectId)}`,
    );
    knowledgeArtifactsState.artifacts = [...(body.artifacts ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    knowledgeArtifactsState.loadedOnce = true;
  } catch (err) {
    knowledgeArtifactsState.error = errorMessage(err);
    knowledgeArtifactsState.artifacts = [];
  } finally {
    knowledgeArtifactsState.loading = false;
  }
  if (shouldRender && ui.activePage === 'knowledge') render();
}
