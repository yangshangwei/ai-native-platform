import type {
  CommandRun,
  WorkflowRun,
  WorkflowStage,
  Project,
  GateRun,
  Artifact,
  ArtifactKind,
} from '@ainp/shared';
import { API_BASE } from './config';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${method} ${path} -> ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => request<{ ok: boolean }>('GET', '/health'),

  registerProject: (params: { name: string; localPath: string }) =>
    request<Project>('POST', '/projects', params),

  getProject: (idOrName: string) => request<Project>('GET', `/projects/${idOrName}`),

  createWorkflowRun: (params: {
    projectName: string;
    title: string;
    type?: 'smoke' | 'feature' | 'bugfix';
  }) =>
    request<WorkflowRun>('POST', '/workflow-runs', { ...params, type: params.type ?? 'smoke' }),

  getWorkflowRun: (id: string) =>
    request<{ run: WorkflowRun; steps: unknown[]; commands: CommandRun[] }>(
      'GET',
      `/workflow-runs/${id}`,
    ),

  workspacePrepared: (params: { workflowRunId: string; workspacePath: string }) =>
    request('POST', '/runner/events/workspace-prepared', params),

  stepStarted: (params: { workflowRunId: string; stage: WorkflowStage; name: string }) =>
    request<{ ok: boolean; step: { id: string } }>(
      'POST',
      '/runner/events/step-started',
      params,
    ),

  stepFinished: (params: {
    stepRunId: string;
    status: 'passed' | 'failed' | 'cancelled' | 'skipped';
  }) => request('POST', '/runner/events/step-finished', params),

  commandRun: (commandRun: CommandRun) =>
    request('POST', '/runner/events/command-run', { commandRun }),

  stageTransition: (params: {
    workflowRunId: string;
    stage: WorkflowStage;
    status?: 'running' | 'awaiting_human';
  }) => request('POST', '/runner/events/stage-transition', params),

  awaitHuman: (params: { workflowRunId: string; stage: WorkflowStage }) =>
    request('POST', '/runner/events/await-human', params),

  workflowCompleted: (params: { workflowRunId: string; ok: boolean }) =>
    request('POST', '/runner/events/workflow-completed', params),

  heartbeat: (params: {
    id: string;
    host: string;
    version: string;
    jdkVersion: string | null;
    mavenVersion: string | null;
    gitVersion: string | null;
  }) => request('POST', '/runner/events/heartbeat', params),

  mavenBuild: (params: {
    workflowRunId: string;
    stepRunId: string | null;
    jdkVersion: string | null;
    mavenCommand: string;
    compileCommandRunId: string | null;
    testCommandRunId: string;
    reports: Array<{
      framework: 'maven-surefire' | 'maven-failsafe';
      reportFiles: string[];
      aggregate: { total: number; passed: number; failed: number; skipped: number; errors: number };
    }>;
  }) =>
    request<{
      ok: boolean;
      buildRun: { id: string; status: string };
      compileGate: GateRun | null;
      testGate: GateRun | null;
    }>('POST', '/runner/events/maven-build', params),

  postArtifact: (params: {
    workflowRunId: string;
    stepRunId: string | null;
    kind: ArtifactKind;
    uri: string;
    size: number;
    contentType: string;
    metadata?: Record<string, unknown>;
  }) =>
    request<Artifact>('POST', '/runner/events/artifact', params).then(
      (r) => (r as unknown as { artifact: Artifact }).artifact ?? r,
    ),

  runGate: (params: {
    workflowRunId: string;
    stepRunId: string | null;
    gateId: GateRun['gateId'];
    params?: { changedFiles?: string[]; allowedPrefixes?: string[] };
  }) => request<{ ok: boolean; gate: GateRun }>('POST', '/runner/events/run-gate', params),

  approve: (params: {
    workflowRunId: string;
    gateId: GateRun['gateId'];
    approved: boolean;
    actor: string;
    comment?: string | null;
  }) =>
    request<{ ok: boolean; gate: GateRun }>('POST', '/approvals', params),

  listApprovals: (workflowRunId: string) =>
    request<{
      items: Array<{ gateId: string; decision: 'approved' | 'rejected' }>;
    }>('GET', `/approvals?workflowRunId=${encodeURIComponent(workflowRunId)}`),

  findApproval: async (
    workflowRunId: string,
    gateId: GateRun['gateId'],
  ): Promise<'approved' | 'rejected' | null> => {
    const r = await request<{ items: Array<{ gateId: string; decision: 'approved' | 'rejected' }> }>(
      'GET',
      `/approvals?workflowRunId=${encodeURIComponent(workflowRunId)}`,
    );
    const found = r.items.find((a) => a.gateId === gateId);
    return found ? found.decision : null;
  },
};
