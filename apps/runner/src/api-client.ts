import type {
  CommandRun,
  WorkflowRun,
  WorkflowRequest,
  WorkflowRequestStatus,
  WorkflowStage,
  Project,
  GateRun,
  Artifact,
  ArtifactKind,
  AgentStreamEventInput,
  AgentBackendKind,
  AgentTaskKind,
  CoordinatorDecision,
  RequestMessage,
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

  registerProject: (params: {
    name: string;
    localPath?: string;
    sourceKind?: Project['sourceKind'];
    sourceUrl?: string;
    sourceAuthKind?: Project['sourceAuthKind'];
    sourceUsername?: string;
    sourceCredential?: string;
    agentBackend?: Project['agentBackend'];
    defaultBranch?: string;
  }) => request<Project>('POST', '/projects', params),

  getProject: (idOrName: string) => request<Project>('GET', `/projects/${encodeURIComponent(idOrName)}?includeSecret=1`),

  createWorkflowRun: (params: {
    projectName: string;
    title: string;
    type?: 'smoke' | 'feature' | 'bugfix';
    sourceBranch?: string;
  }) =>
    request<WorkflowRun>('POST', '/workflow-runs', { ...params, type: params.type ?? 'smoke' }),

  listWorkflowRequests: (params: { status?: WorkflowRequest['status'] } = {}) => {
    const qs = params.status ? `?status=${encodeURIComponent(params.status)}` : '';
    return request<{ items: WorkflowRequest[] }>('GET', `/workflow-requests${qs}`);
  },

  createWorkflowRequest: (params: {
    projectId?: string;
    projectName?: string;
    title: string;
    type?: 'smoke' | 'feature' | 'bugfix';
    branch?: string;
  }) =>
    request<WorkflowRequest>('POST', '/workflow-requests', {
      ...params,
      type: params.type ?? 'feature',
    }),

  claimWorkflowRequest: async (params: { requestId: string; runnerId: string }) => {
    try {
      return await request<WorkflowRequest>(
        'POST',
        `/workflow-requests/${encodeURIComponent(params.requestId)}/claim`,
        { runnerId: params.runnerId },
      );
    } catch (err) {
      if (err instanceof Error && err.message.includes('-> 409:')) return null;
      throw err;
    }
  },

  completeWorkflowRequest: (params: {
    requestId: string;
    workflowRunId: string | null;
    ok: boolean;
    error?: string | null;
  }) =>
    request<WorkflowRequest>(
      'POST',
      `/workflow-requests/${encodeURIComponent(params.requestId)}/complete`,
      {
        workflowRunId: params.workflowRunId,
        ok: params.ok,
        error: params.error ?? null,
      },
    ),

  workflowRequestRunStarted: (params: { requestId: string; workflowRunId: string }) =>
    request<WorkflowRequest>(
      'POST',
      `/workflow-requests/${encodeURIComponent(params.requestId)}/run-started`,
      { workflowRunId: params.workflowRunId },
    ),

  getWorkflowRun: (id: string) =>
    request<{
      run: WorkflowRun;
      steps: unknown[];
      commands: CommandRun[];
      actions: Array<{
        id: string;
        workflowRunId: string;
        kind: string;
        targetId: string | null;
        action: string;
        actor: string;
        payload: Record<string, unknown>;
        createdAt: string;
      }>;
    }>(
      'GET',
      `/workflow-runs/${id}`,
    ),

  getArtifactContent: (id: string) =>
    request<{
      artifact: Artifact;
      text: string;
      contentType: string;
      filename: string;
    }>('GET', `/artifacts/${encodeURIComponent(id)}/content`),

  getLatestArtifactContent: (params: { workflowRunId: string; kind: ArtifactKind }) =>
    request<{
      artifact: Artifact;
      text: string;
      contentType: string;
      filename: string;
    }>(
      'GET',
      `/artifacts/workflow-runs/${encodeURIComponent(params.workflowRunId)}/${encodeURIComponent(
        params.kind,
      )}/latest/content`,
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

  agentTaskStarted: (params: {
    workflowRunId: string;
    stepRunId: string | null;
    kind: AgentTaskKind;
    backend: AgentBackendKind;
    prompt: string;
    inputArtifactIds?: string[];
  }) =>
    request<{ ok: boolean; task: { id: string } }>(
      'POST',
      '/runner/events/agent-task-started',
      params,
    ),

  agentTaskFinished: (params: {
    taskId: string;
    status: 'success' | 'failed' | 'cancelled';
    summary: string;
    outputArtifactIds?: string[];
  }) =>
    request<{ ok: boolean; result: { id: string } }>(
      'POST',
      '/runner/events/agent-task-finished',
      params,
    ),

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
    const found = [...r.items].reverse().find((a) => a.gateId === gateId);
    return found ? found.decision : null;
  },

  /** Push a single agent stream event so the API can persist + broadcast it. */
  postAgentEvent: (input: AgentStreamEventInput) =>
    request('POST', '/runner/events/agent-stream', input),

  // ---- Coordinator chat thread (Phase B) ----------------------------------

  listRequestMessages: (requestId: string) =>
    request<{
      messages: RequestMessage[];
      decision: CoordinatorDecision | null;
      status: WorkflowRequestStatus;
    }>('GET', `/workflow-requests/${encodeURIComponent(requestId)}/messages`),

  postRequestMessage: (params: {
    requestId: string;
    role: 'user' | 'coordinator';
    content: string;
    coordinatorDecisionId?: string | null;
  }) =>
    request<RequestMessage>(
      'POST',
      `/workflow-requests/${encodeURIComponent(params.requestId)}/messages`,
      {
        role: params.role,
        content: params.content,
        coordinatorDecisionId: params.coordinatorDecisionId ?? null,
      },
    ),

  setRequestStatus: (params: { requestId: string; status: WorkflowRequestStatus }) =>
    request<WorkflowRequest>(
      'PATCH',
      `/workflow-requests/${encodeURIComponent(params.requestId)}/status`,
      { status: params.status },
    ),

  persistCoordinatorDecision: (decision: CoordinatorDecision) =>
    request<CoordinatorDecision>('POST', '/coordinator-decisions', decision),
};
