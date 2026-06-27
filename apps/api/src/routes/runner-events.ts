import { Hono } from 'hono';
import type {
  CommandRun,
  ToolInvocation,
  WorkflowStage,
  ArtifactKind,
  GateRun,
  AgentStreamEventInput,
  AgentBackendKind,
  AgentSessionStatus,
  AgentTaskKind,
  ContextRequest,
  HandoffAdoptionDecision,
  HandoffExpectedOutput,
  HandoffRole,
  HandoffStatus,
  GraphDefinition,
  GraphNodeDependencyState,
} from '@ainp/shared';
import {
  errorMessage,
  isGraphNodeStatus,
  isGraphRuntimeSchemaVersion,
  isAgentSessionStatus,
  isContextRequestStatus,
  isHandoffAdoptionDecision,
  isHandoffRole,
  isHandoffStatus,
  isPerRunArtifactKind,
  isStepCheckpointStatus,
  isRunnerToolId,
  isToolInvocationStatus,
  isToolPermissionDecision,
  isToolPermissionTier,
  isToolSideEffectLevel,
  isWorkflowStage,
  newId,
  nowIso,
} from '@ainp/shared';
import {
  finishStep,
  recordCommandRun,
  recordToolInvocation,
  setWorkspace,
  startStep,
  transitionStage,
  completeWorkflowRun,
  recordHeartbeat,
  recordMavenBuild,
  createArtifact,
  awaitHuman,
  recordAgentEvent,
  recordAgentSessionFinished,
  recordAgentSessionStarted,
  recordAgentTask,
  recordAgentResult,
  recordContextRequestAction,
  recordHandoff,
  updateHandoff,
  type MavenBuildEvent,
} from '../workflow-engine';
import {
  runDiffScopeGate,
  runSensitiveChangeGate,
  runRequirementGate,
  runDesignGate,
  runAcceptanceTraceabilityGate,
  runEvidenceGate,
} from '../gate-engine';
import { store } from '../store/store';
import { assertReadableFileUri } from '../artifact-content';
import { mergeStepCheckpoint } from '../step-checkpoints';

/**
 * Runner-driven event ingress. The Runner is NOT a state writer — it tells
 * the Engine what happened and the Engine decides the new state.
 */
export const runnerEvents = new Hono();

runnerEvents.post('/workspace-prepared', async (c) => {
  const body = (await c.req.json()) as { workflowRunId: string; workspacePath: string };
  const run = setWorkspace(body.workflowRunId, body.workspacePath);
  return c.json({ ok: true, run });
});

runnerEvents.post('/step-started', async (c) => {
  const body = (await c.req.json()) as {
    workflowRunId: string;
    stage: WorkflowStage;
    name: string;
  };
  const step = startStep(body);
  return c.json({ ok: true, step });
});

runnerEvents.post('/step-finished', async (c) => {
  const body = (await c.req.json()) as {
    stepRunId: string;
    status: 'passed' | 'failed' | 'cancelled' | 'skipped';
    failureReason?: string | null;
  };
  const step = finishStep(body.stepRunId, body.status, body.failureReason ?? null);
  return c.json({ ok: true, step });
});

runnerEvents.post('/step-checkpoint', async (c) => {
  const body = (await c.req.json()) as {
    workflowRunId?: string;
    stepRunId?: string;
    stage?: string;
    status?: string;
    inputArtifactIds?: string[];
    outputArtifactIds?: string[];
    contextPackId?: string | null;
    agentSessionIds?: string[];
    retryIndex?: number;
    metadata?: Record<string, unknown>;
  };
  if (!body.workflowRunId || !body.stepRunId || !body.stage) {
    return c.json({ error: 'workflowRunId, stepRunId, stage required' }, 400);
  }
  if (!isWorkflowStage(body.stage)) {
    return c.json({ error: `unknown stage: ${body.stage}` }, 400);
  }
  if (body.status !== undefined && !isStepCheckpointStatus(body.status)) {
    return c.json({ error: `unknown checkpoint status: ${String(body.status)}` }, 400);
  }
  const checkpoint = mergeStepCheckpoint({
    workflowRunId: body.workflowRunId,
    stepRunId: body.stepRunId,
    stage: body.stage,
    status: body.status,
    inputArtifactIds: body.inputArtifactIds,
    outputArtifactIds: body.outputArtifactIds,
    contextPackId: body.contextPackId ?? undefined,
    agentSessionIds: body.agentSessionIds,
    retryIndex: body.retryIndex,
    metadata: body.metadata,
  });
  return c.json({ ok: true, checkpoint });
});

runnerEvents.post('/graph-run-started', async (c) => {
  const body = (await c.req.json()) as {
    workflowRunId?: string;
    graphDefinition?: GraphDefinition;
  };
  if (!body.workflowRunId || !body.graphDefinition) {
    return c.json({ error: 'workflowRunId and graphDefinition required' }, 400);
  }
  if (!store.workflowRuns.get(body.workflowRunId)) {
    return c.json({ error: `workflow run not found: ${body.workflowRunId}` }, 404);
  }
  const graphError = validateGraphDefinition(body.graphDefinition);
  if (graphError) return c.json({ error: graphError }, 400);

  const ts = nowIso();
  const graphRun = {
    id: newId('grun'),
    workflowRunId: body.workflowRunId,
    graphDefinitionId: body.graphDefinition.id,
    graphVersion: body.graphDefinition.version,
    status: 'running' as const,
    activeNodeIds: [],
    interruptedReason: null,
    createdAt: ts,
    updatedAt: ts,
    metadata: {},
  };
  try {
    store.graphDefinitions.upsert(body.graphDefinition);
    store.graphRuns.upsert(graphRun);
    store.graphEvents.insert({
      id: newId('gevt'),
      graphRunId: graphRun.id,
      workflowRunId: graphRun.workflowRunId,
      nodeId: null,
      type: 'graph_planned',
      createdAt: ts,
      payload: {
        graphDefinitionId: graphRun.graphDefinitionId,
        graphVersion: graphRun.graphVersion,
      },
    });
    return c.json({ ok: true, graphRun }, 201);
  } catch (err) {
    return c.json({ error: errorMessage(err) }, 400);
  }
});

runnerEvents.post('/graph-node-started', async (c) => {
  const body = (await c.req.json()) as {
    workflowRunId?: string;
    graphRunId?: string;
    nodeRunId?: string;
    nodeId?: string;
    dependencyState?: GraphNodeDependencyState;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
  };
  if (!body.workflowRunId || !body.graphRunId || !body.nodeId || !body.idempotencyKey) {
    return c.json({ error: 'workflowRunId, graphRunId, nodeId, idempotencyKey required' }, 400);
  }
  const dependencyError = validateDependencyState(body.dependencyState);
  if (dependencyError) return c.json({ error: dependencyError }, 400);
  if (body.metadata !== undefined && !isPlainObject(body.metadata)) {
    return c.json({ error: 'metadata must be an object' }, 400);
  }
  const graphRun = store.graphRuns.get(body.graphRunId);
  if (!graphRun) return c.json({ error: `graph run not found: ${body.graphRunId}` }, 404);
  if (graphRun.workflowRunId !== body.workflowRunId) {
    return c.json({ error: 'graphRunId does not belong to workflowRunId' }, 400);
  }
  const graphDefinition = store.graphDefinitions.get(graphRun.graphDefinitionId);
  if (!graphDefinition) {
    return c.json({ error: `graph definition not found: ${graphRun.graphDefinitionId}` }, 404);
  }
  if (!graphDefinition.nodes.some((node) => node.id === body.nodeId)) {
    return c.json({ error: `nodeId does not belong to graphDefinition: ${body.nodeId}` }, 400);
  }
  const ts = nowIso();
  const readyNodeRun = body.nodeRunId ? store.graphNodeRuns.get(body.nodeRunId) : undefined;
  if (body.nodeRunId && !readyNodeRun) {
    return c.json({ error: `graph node run not found: ${body.nodeRunId}` }, 404);
  }
  if (readyNodeRun) {
    if (readyNodeRun.graphRunId !== graphRun.id || readyNodeRun.workflowRunId !== graphRun.workflowRunId) {
      return c.json({ error: 'nodeRunId does not belong to graphRunId' }, 400);
    }
    if (readyNodeRun.nodeId !== body.nodeId) {
      return c.json({ error: 'nodeRunId does not belong to nodeId' }, 400);
    }
    if (readyNodeRun.status !== 'ready') {
      return c.json({ error: `graph node run is not ready: ${readyNodeRun.status}` }, 400);
    }
  }
  const attempt = readyNodeRun?.attempt ?? store.graphNodeRuns.byNode(graphRun.id, body.nodeId).length + 1;
  const nodeRun = {
    id: readyNodeRun?.id ?? newId('gnr'),
    graphRunId: graphRun.id,
    workflowRunId: graphRun.workflowRunId,
    nodeId: body.nodeId,
    attempt,
    status: 'running' as const,
    stepRunId: readyNodeRun?.stepRunId ?? null,
    stepCheckpointId: readyNodeRun?.stepCheckpointId ?? null,
    resumeCursor: readyNodeRun?.resumeCursor ?? null,
    idempotencyKey: readyNodeRun?.idempotencyKey ?? body.idempotencyKey,
    dependencyState: readyNodeRun?.dependencyState ?? body.dependencyState!,
    startedAt: ts,
    completedAt: null,
    metadata: {
      ...(readyNodeRun?.metadata ?? {}),
      ...(body.metadata ?? {}),
    },
  };
  try {
    store.graphNodeRuns.upsert(nodeRun);
    store.graphRuns.upsert({
      ...graphRun,
      activeNodeIds: [...new Set([...graphRun.activeNodeIds, body.nodeId])],
      updatedAt: ts,
    });
    store.graphEvents.insert({
      id: newId('gevt'),
      graphRunId: graphRun.id,
      workflowRunId: graphRun.workflowRunId,
      nodeId: body.nodeId,
      type: 'node_started',
      createdAt: ts,
      payload: { nodeRunId: nodeRun.id, attempt },
    });
    return c.json({ ok: true, nodeRun }, 201);
  } catch (err) {
    return c.json({ error: errorMessage(err) }, 400);
  }
});

runnerEvents.post('/graph-node-finished', async (c) => {
  const body = (await c.req.json()) as {
    nodeRunId?: string;
    status?: string;
    stepRunId?: string | null;
    stepCheckpointId?: string | null;
    resumeCursor?: string | null;
    metadata?: Record<string, unknown>;
  };
  if (!body.nodeRunId || !body.status) {
    return c.json({ error: 'nodeRunId and status required' }, 400);
  }
  if (!isGraphNodeStatus(body.status)) {
    return c.json({ error: `unknown graph node status: ${String(body.status)}` }, 400);
  }
  if (body.status === 'pending' || body.status === 'ready' || body.status === 'running') {
    return c.json({ error: `finished graph node status cannot be ${body.status}` }, 400);
  }
  if (body.metadata !== undefined && !isPlainObject(body.metadata)) {
    return c.json({ error: 'metadata must be an object' }, 400);
  }
  const existing = store.graphNodeRuns.get(body.nodeRunId);
  if (!existing) return c.json({ error: `graph node run not found: ${body.nodeRunId}` }, 404);
  const graphRun = store.graphRuns.get(existing.graphRunId);
  if (!graphRun) return c.json({ error: `graph run not found: ${existing.graphRunId}` }, 404);
  const ts = nowIso();
  const nodeRun = {
    ...existing,
    status: body.status,
    stepRunId: body.stepRunId ?? existing.stepRunId,
    stepCheckpointId: body.stepCheckpointId ?? existing.stepCheckpointId,
    resumeCursor: body.resumeCursor ?? existing.resumeCursor,
    completedAt: ts,
    metadata: {
      ...existing.metadata,
      ...(body.metadata ?? {}),
    },
  };
  try {
    store.graphNodeRuns.upsert(nodeRun);
    store.graphRuns.upsert({
      ...graphRun,
      activeNodeIds: graphRun.activeNodeIds.filter((id) => id !== existing.nodeId),
      status: body.status === 'failed' ? 'failed' : graphRun.status,
      updatedAt: ts,
    });
    store.graphEvents.insert({
      id: newId('gevt'),
      graphRunId: existing.graphRunId,
      workflowRunId: existing.workflowRunId,
      nodeId: existing.nodeId,
      type: 'node_finished',
      createdAt: ts,
      payload: {
        nodeRunId: existing.id,
        status: body.status,
        stepRunId: nodeRun.stepRunId,
        stepCheckpointId: nodeRun.stepCheckpointId,
      },
    });
    return c.json({ ok: true, nodeRun }, 200);
  } catch (err) {
    return c.json({ error: errorMessage(err) }, 400);
  }
});

runnerEvents.post('/command-run', async (c) => {
  const body = (await c.req.json()) as { commandRun: CommandRun };
  const cr = recordCommandRun(body.commandRun);
  return c.json({ ok: true, commandRun: cr });
});

runnerEvents.post('/tool-invocation', async (c) => {
  const body = (await c.req.json()) as { toolInvocation: ToolInvocation };
  const validationError = validateToolInvocation(body.toolInvocation);
  if (validationError) return c.json({ error: validationError }, 400);
  const invocation = recordToolInvocation(body.toolInvocation);
  return c.json({ ok: true, toolInvocation: invocation });
});

function validateToolInvocation(invocation: ToolInvocation | undefined): string | null {
  if (!invocation) return 'toolInvocation required';
  if (!invocation.id || !invocation.workflowRunId || !invocation.toolId || !invocation.argumentsDigest) {
    return 'toolInvocation id, workflowRunId, toolId, argumentsDigest required';
  }
  if (!store.workflowRuns.get(invocation.workflowRunId)) {
    return `workflow run not found: ${invocation.workflowRunId}`;
  }
  if (!isRunnerToolId(invocation.toolId)) {
    return `unknown toolId: ${String(invocation.toolId)}`;
  }
  if (!isToolInvocationStatus(invocation.status)) {
    return `unknown tool invocation status: ${String(invocation.status)}`;
  }
  if (!isToolSideEffectLevel(invocation.sideEffect)) {
    return `unknown tool sideEffect: ${String(invocation.sideEffect)}`;
  }
  if (!isToolPermissionTier(invocation.permissionTier)) {
    return `unknown tool permissionTier: ${String(invocation.permissionTier)}`;
  }
  if (!isToolPermissionDecision(invocation.permissionDecision)) {
    return `unknown tool permissionDecision: ${String(invocation.permissionDecision)}`;
  }
  if (!Array.isArray(invocation.resultRefs)) {
    return 'toolInvocation resultRefs must be an array';
  }
  if (!invocation.metadata || typeof invocation.metadata !== 'object' || Array.isArray(invocation.metadata)) {
    return 'toolInvocation metadata must be an object';
  }
  return null;
}

function validateGraphDefinition(graph: GraphDefinition): string | null {
  if (!graph.id || !graph.version) return 'graphDefinition id and version required';
  if (!isGraphRuntimeSchemaVersion(graph.schemaVersion)) {
    return `unknown graph schemaVersion: ${String(graph.schemaVersion)}`;
  }
  if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) {
    return 'graphDefinition nodes must be a non-empty array';
  }
  if (!Array.isArray(graph.edges)) return 'graphDefinition edges must be an array';
  if (!isStringArray(graph.entryNodeIds)) {
    return 'graphDefinition entryNodeIds must be an array of strings';
  }
  const nodeIds = new Set<string>();
  for (const node of graph.nodes) {
    if (!node.id || !isWorkflowStage(node.stage)) {
      return `invalid graph node: ${String(node.id)}`;
    }
    nodeIds.add(node.id);
  }
  for (const id of graph.entryNodeIds) {
    if (!nodeIds.has(id)) return `entry node not found: ${id}`;
  }
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId)) {
      return `graph edge references unknown node: ${edge.id}`;
    }
  }
  return null;
}

function validateDependencyState(value: unknown): string | null {
  if (!isPlainObject(value)) return 'dependencyState required';
  if (!isStringArray(value.upstreamNodeIds)) {
    return 'dependencyState.upstreamNodeIds must be an array of strings';
  }
  if (!isStringArray(value.satisfiedNodeIds)) {
    return 'dependencyState.satisfiedNodeIds must be an array of strings';
  }
  if (!isStringArray(value.blockedNodeIds)) {
    return 'dependencyState.blockedNodeIds must be an array of strings';
  }
  return null;
}

function validateHandoffCreate(body: {
  workflowRunId?: string;
  fromRole?: HandoffRole;
  toRole?: HandoffRole;
  reason?: string;
  inputArtifactIds?: string[];
  expectedOutput?: HandoffExpectedOutput;
  stopCondition?: string;
  status?: HandoffStatus;
  adoptionDecision?: HandoffAdoptionDecision;
  outputArtifactIds?: string[];
  metadata?: Record<string, unknown>;
}): string | null {
  if (!body.workflowRunId) return 'workflowRunId required';
  if (!store.workflowRuns.get(body.workflowRunId)) {
    return `workflow run not found: ${body.workflowRunId}`;
  }
  if (!isHandoffRole(body.fromRole)) return `unknown handoff fromRole: ${String(body.fromRole)}`;
  if (!isHandoffRole(body.toRole)) return `unknown handoff toRole: ${String(body.toRole)}`;
  if (!body.reason?.trim()) return 'reason required';
  if (!isNonEmptyStringArray(body.inputArtifactIds)) {
    return 'inputArtifactIds must include at least one artifact id';
  }
  if (!isExpectedOutput(body.expectedOutput)) {
    return 'expectedOutput requires schemaVersion, artifactKind, and description';
  }
  if (!body.stopCondition?.trim()) return 'stopCondition required';
  if (body.status !== undefined && !isHandoffStatus(body.status)) {
    return `unknown handoff status: ${String(body.status)}`;
  }
  if (
    body.adoptionDecision !== undefined
    && !isHandoffAdoptionDecision(body.adoptionDecision)
  ) {
    return `unknown handoff adoptionDecision: ${String(body.adoptionDecision)}`;
  }
  if (body.outputArtifactIds !== undefined && !isNonEmptyStringArray(body.outputArtifactIds)) {
    return 'outputArtifactIds must be an array of non-empty strings';
  }
  if (body.metadata !== undefined && !isPlainObject(body.metadata)) {
    return 'metadata must be an object';
  }
  return null;
}

function isExpectedOutput(value: unknown): value is HandoffExpectedOutput {
  if (!isPlainObject(value)) return false;
  return typeof value.schemaVersion === 'string'
    && value.schemaVersion.trim().length > 0
    && typeof value.artifactKind === 'string'
    && value.artifactKind.trim().length > 0
    && typeof value.description === 'string'
    && value.description.trim().length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length > 0
    && value.every((item) => typeof item === 'string' && item.trim().length > 0);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every((item) => typeof item === 'string' && item.trim().length > 0);
}

runnerEvents.post('/stage-transition', async (c) => {
  const body = (await c.req.json()) as {
    workflowRunId: string;
    stage: WorkflowStage;
    status?: 'running' | 'awaiting_human';
  };
  const run = transitionStage(body.workflowRunId, body.stage, body.status ?? 'running');
  return c.json({ ok: true, run });
});

runnerEvents.post('/await-human', async (c) => {
  const body = (await c.req.json()) as { workflowRunId: string; stage: WorkflowStage };
  const run = awaitHuman(body.workflowRunId, body.stage);
  return c.json({ ok: true, run });
});

runnerEvents.post('/workflow-completed', async (c) => {
  const body = (await c.req.json()) as { workflowRunId: string; ok: boolean };
  const run = completeWorkflowRun(body.workflowRunId, body.ok);
  return c.json({ ok: true, run });
});

runnerEvents.post('/heartbeat', async (c) => {
  const body = (await c.req.json()) as {
    id: string;
    host: string;
    version: string;
    jdkVersion: string | null;
    mavenVersion: string | null;
    gitVersion: string | null;
  };
  const runner = recordHeartbeat(body);
  return c.json({ ok: true, runner });
});

/**
 * Live agent stream ingest — runner POSTs each parsed CC stream-json line
 * (or backend-meta) here. Body accepts a single event or a `events` array
 * for batched submission.
 */
runnerEvents.post('/agent-stream', async (c) => {
  const body = (await c.req.json()) as AgentStreamEventInput | { events: AgentStreamEventInput[] };
  const inputs = Array.isArray((body as { events?: unknown }).events)
    ? (body as { events: AgentStreamEventInput[] }).events
    : [body as AgentStreamEventInput];
  for (const i of inputs) {
    const hasRun = typeof i.workflowRunId === 'string' && i.workflowRunId.length > 0;
    const hasReq =
      typeof i.workflowRequestId === 'string' && (i.workflowRequestId as string).length > 0;
    if (hasRun === hasReq) {
      return c.json(
        {
          error: 'each agent-stream event requires exactly one of workflowRunId or workflowRequestId',
        },
        400,
      );
    }
  }
  const stored = inputs.map((i) => recordAgentEvent(i));
  return c.json({ ok: true, count: stored.length, events: stored });
});

runnerEvents.post('/agent-task-started', async (c) => {
  const body = (await c.req.json()) as {
    workflowRunId: string;
    stepRunId: string | null;
    kind: AgentTaskKind;
    backend: AgentBackendKind;
    prompt: string;
    inputArtifactIds?: string[];
  };
  if (!body.workflowRunId || !body.kind || !body.backend) {
    return c.json({ error: 'workflowRunId, kind, backend required' }, 400);
  }
  const task = recordAgentTask({
    workflowRunId: body.workflowRunId,
    stepRunId: body.stepRunId ?? null,
    kind: body.kind,
    backend: body.backend,
    prompt: body.prompt ?? '',
    inputArtifactIds: body.inputArtifactIds ?? [],
  });
  return c.json({ ok: true, task }, 201);
});

runnerEvents.post('/agent-task-finished', async (c) => {
  const body = (await c.req.json()) as {
    taskId: string;
    status: 'success' | 'failed' | 'cancelled';
    summary: string;
    outputArtifactIds?: string[];
  };
  if (!body.taskId || !body.status) {
    return c.json({ error: 'taskId, status required' }, 400);
  }
  const result = recordAgentResult({
    taskId: body.taskId,
    status: body.status,
    summary: body.summary ?? '',
    outputArtifactIds: body.outputArtifactIds ?? [],
  });
  return c.json({ ok: true, result }, 201);
});

runnerEvents.post('/agent-session-started', async (c) => {
  const body = (await c.req.json()) as {
    workflowRunId?: string;
    agentTaskId?: string;
    stage?: string;
    skillId?: string;
    skillVersion?: string;
    contextPackId?: string;
    parentSessionId?: string | null;
    retryIndex?: number;
    metadata?: Record<string, unknown>;
  };
  if (!body.workflowRunId || !body.agentTaskId || !body.stage || !body.skillId || !body.skillVersion || !body.contextPackId) {
    return c.json({
      error: 'workflowRunId, agentTaskId, stage, skillId, skillVersion, contextPackId required',
    }, 400);
  }
  if (!isWorkflowStage(body.stage)) {
    return c.json({ error: `unknown stage: ${body.stage}` }, 400);
  }
  const task = store.agentTasks.get(body.agentTaskId);
  if (!task) return c.json({ error: `agent task not found: ${body.agentTaskId}` }, 404);
  if (task.workflowRunId !== body.workflowRunId) {
    return c.json({ error: 'agentTaskId does not belong to workflowRunId' }, 400);
  }
  const session = recordAgentSessionStarted({
    agentTaskId: body.agentTaskId,
    stage: body.stage,
    skillId: body.skillId,
    skillVersion: body.skillVersion,
    contextPackId: body.contextPackId,
    parentSessionId: body.parentSessionId ?? null,
    retryIndex: body.retryIndex ?? 0,
    metadata: body.metadata ?? {},
  });
  return c.json({ ok: true, session }, 201);
});

runnerEvents.post('/agent-session-finished', async (c) => {
  const body = (await c.req.json()) as {
    sessionId?: string;
    status?: AgentSessionStatus;
    agentResultId?: string | null;
    metadata?: Record<string, unknown>;
  };
  if (!body.sessionId || !body.status) {
    return c.json({ error: 'sessionId, status required' }, 400);
  }
  if (!isAgentSessionStatus(body.status)) {
    return c.json({ error: `unknown agent session status: ${String(body.status)}` }, 400);
  }
  if (body.status === 'running') {
    return c.json({ error: 'finished session status cannot be running' }, 400);
  }
  const existing = store.agentSessions.get(body.sessionId);
  if (!existing) {
    return c.json({ error: `agent session not found: ${body.sessionId}` }, 404);
  }
  if (body.agentResultId) {
    const result = store.agentResults.get(body.agentResultId);
    if (!result) {
      return c.json({ error: `agent result not found: ${body.agentResultId}` }, 404);
    }
    if (result.taskId !== existing.agentTaskId) {
      return c.json({ error: 'agentResultId does not belong to agentSession task' }, 400);
    }
  }
  const session = recordAgentSessionFinished({
    sessionId: body.sessionId,
    status: body.status,
    agentResultId: body.agentResultId ?? null,
    metadata: body.metadata ?? {},
  });
  return c.json({ ok: true, session }, 201);
});

runnerEvents.post('/handoff', async (c) => {
  const body = (await c.req.json()) as {
    workflowRunId?: string;
    stepRunId?: string | null;
    parentSessionId?: string | null;
    childSessionId?: string | null;
    fromRole?: HandoffRole;
    toRole?: HandoffRole;
    reason?: string;
    inputArtifactIds?: string[];
    expectedOutput?: HandoffExpectedOutput;
    stopCondition?: string;
    status?: HandoffStatus;
    adoptionDecision?: HandoffAdoptionDecision;
    outputArtifactIds?: string[];
    metadata?: Record<string, unknown>;
  };
  const validationError = validateHandoffCreate(body);
  if (validationError) return c.json({ error: validationError }, 400);
  try {
    const handoff = recordHandoff({
      workflowRunId: body.workflowRunId!,
      stepRunId: body.stepRunId ?? null,
      parentSessionId: body.parentSessionId ?? null,
      childSessionId: body.childSessionId ?? null,
      fromRole: body.fromRole!,
      toRole: body.toRole!,
      reason: body.reason!.trim(),
      inputArtifactIds: body.inputArtifactIds!,
      expectedOutput: body.expectedOutput!,
      stopCondition: body.stopCondition!.trim(),
      status: body.status ?? 'requested',
      adoptionDecision: body.adoptionDecision ?? 'pending',
      outputArtifactIds: body.outputArtifactIds ?? [],
      metadata: body.metadata ?? {},
    });
    return c.json({ ok: true, handoff }, 201);
  } catch (err) {
    return c.json({ error: errorMessage(err) }, 400);
  }
});

runnerEvents.post('/handoff/:id', async (c) => {
  const body = (await c.req.json()) as {
    status?: HandoffStatus;
    adoptionDecision?: HandoffAdoptionDecision;
    childSessionId?: string | null;
    outputArtifactIds?: string[];
    metadata?: Record<string, unknown>;
  };
  if (body.status !== undefined && !isHandoffStatus(body.status)) {
    return c.json({ error: `unknown handoff status: ${String(body.status)}` }, 400);
  }
  if (
    body.adoptionDecision !== undefined
    && !isHandoffAdoptionDecision(body.adoptionDecision)
  ) {
    return c.json({ error: `unknown handoff adoptionDecision: ${String(body.adoptionDecision)}` }, 400);
  }
  if (body.outputArtifactIds !== undefined && !isNonEmptyStringArray(body.outputArtifactIds)) {
    return c.json({ error: 'outputArtifactIds must be an array of non-empty strings' }, 400);
  }
  if (body.metadata !== undefined && !isPlainObject(body.metadata)) {
    return c.json({ error: 'metadata must be an object' }, 400);
  }
  try {
    const handoff = updateHandoff({
      handoffId: c.req.param('id'),
      status: body.status,
      adoptionDecision: body.adoptionDecision,
      childSessionId: body.childSessionId ?? undefined,
      outputArtifactIds: body.outputArtifactIds,
      metadata: body.metadata,
    });
    return c.json({ ok: true, handoff }, 200);
  } catch (err) {
    return c.json({ error: errorMessage(err) }, 400);
  }
});

runnerEvents.post('/context-request', async (c) => {
  const body = (await c.req.json()) as {
    workflowRunId: string;
    request: ContextRequest;
    sourceName?: string;
    taskId?: string;
    baseContextPackId?: string;
    baseContextPackArtifactId?: string | null;
    supplementContextPackId?: string;
    requestArtifactId?: string;
    supplementArtifactId?: string;
  };
  if (
    !body.workflowRunId
    || !body.request?.id
    || !body.taskId
    || !body.baseContextPackId
    || !body.supplementContextPackId
    || !body.requestArtifactId
    || !body.supplementArtifactId
  ) {
    return c.json({
      error: 'workflowRunId, request.id, taskId, baseContextPackId, supplementContextPackId, requestArtifactId, supplementArtifactId required',
    }, 400);
  }
  if (!store.workflowRuns.has(body.workflowRunId)) {
    return c.json({ error: `workflow run not found: ${body.workflowRunId}` }, 404);
  }
  const chainError = validateContextRequestChain(body.workflowRunId, {
    taskId: body.taskId,
    baseContextPackArtifactId: body.baseContextPackArtifactId ?? null,
    requestArtifactId: body.requestArtifactId,
    supplementArtifactId: body.supplementArtifactId,
  });
  if (chainError) return c.json({ error: chainError }, 400);
  const requestError = validateContextRequestPayload(body.workflowRunId, body.request);
  if (requestError) {
    return c.json({ error: requestError }, 400);
  }
  const action = recordContextRequestAction({
    workflowRunId: body.workflowRunId,
    request: body.request,
    sourceName: body.sourceName ?? 'unknown',
    taskId: body.taskId,
    baseContextPackId: body.baseContextPackId,
    baseContextPackArtifactId: body.baseContextPackArtifactId ?? null,
    supplementContextPackId: body.supplementContextPackId,
    requestArtifactId: body.requestArtifactId,
    supplementArtifactId: body.supplementArtifactId,
  });
  return c.json({ ok: true, action }, 201);
});

function validateContextRequestChain(
  workflowRunId: string,
  ids: {
    taskId: string;
    baseContextPackArtifactId: string | null;
    requestArtifactId: string;
    supplementArtifactId: string;
  },
): string | null {
  const task = store.agentTasks.get(ids.taskId);
  if (!task || task.workflowRunId !== workflowRunId) {
    return 'taskId must reference an agent task on this workflow run';
  }
  if (ids.baseContextPackArtifactId) {
    const baseArtifact = store.artifacts.get(ids.baseContextPackArtifactId);
    if (!baseArtifact || baseArtifact.workflowRunId !== workflowRunId) {
      return 'baseContextPackArtifactId must reference an artifact on this workflow run';
    }
  }
  const requestArtifact = store.artifacts.get(ids.requestArtifactId);
  if (!requestArtifact || requestArtifact.workflowRunId !== workflowRunId) {
    return 'requestArtifactId must reference an artifact on this workflow run';
  }
  const supplementArtifact = store.artifacts.get(ids.supplementArtifactId);
  if (!supplementArtifact || supplementArtifact.workflowRunId !== workflowRunId) {
    return 'supplementArtifactId must reference an artifact on this workflow run';
  }
  return null;
}

function validateContextRequestPayload(
  workflowRunId: string,
  request: ContextRequest,
): string | null {
  if (request.workflowRunId !== workflowRunId) {
    return 'request.workflowRunId must match workflowRunId';
  }
  if (typeof request.reason !== 'string' || request.reason.trim().length === 0) {
    return 'request.reason required';
  }
  if (!isWorkflowStage(request.stage)) {
    return 'request.stage invalid';
  }
  if (!Array.isArray(request.requestedRefs) || !request.requestedRefs.every(isNonEmptyString)) {
    return 'request.requestedRefs must be an array of non-empty strings';
  }
  if (!Array.isArray(request.questions) || !request.questions.every(isNonEmptyString)) {
    return 'request.questions must be an array of non-empty strings';
  }
  if (request.requestedRefs.length === 0 && request.questions.length === 0) {
    return 'request must include requestedRefs or questions';
  }
  if (request.priority !== 1 && request.priority !== 2 && request.priority !== 3) {
    return 'request.priority must be 1, 2, or 3';
  }
  if (!isContextRequestStatus(request.status)) {
    return 'request.status invalid';
  }
  if (typeof request.createdAt !== 'string' || Number.isNaN(Date.parse(request.createdAt))) {
    return 'request.createdAt must be an ISO timestamp';
  }
  return null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

runnerEvents.post('/maven-build', async (c) => {
  const body = (await c.req.json()) as MavenBuildEvent;
  const result = recordMavenBuild(body);
  return c.json({ ok: true, ...result });
});

runnerEvents.post('/artifact', async (c) => {
  const body = (await c.req.json()) as {
    workflowRunId: string;
    stepRunId: string | null;
    kind: ArtifactKind;
    uri: string;
    size: number;
    contentType: string;
    metadata?: Record<string, unknown>;
  };
  try {
    // V2 P0-1: confused-tier protection. The /runner/events/artifact entrypoint
    // is for per-run artifacts only. Knowledge kinds must go through
    // POST /knowledge-artifacts/projects/:projectId.
    if (!isPerRunArtifactKind(body.kind)) {
      return c.json(
        {
          error: `kind '${String(body.kind)}' is not a PerRunArtifactKind. Use POST /knowledge-artifacts/projects/:projectId for knowledge artifacts.`,
        },
        400,
      );
    }
    if (body.uri.startsWith('file://')) assertReadableFileUri(body.uri);
    const a = createArtifact({
      workflowRunId: body.workflowRunId,
      stepRunId: body.stepRunId,
      kind: body.kind,
      uri: body.uri,
      size: body.size,
      contentType: body.contentType,
      metadata: body.metadata ?? {},
    });
    return c.json({ ok: true, artifact: a });
  } catch (err) {
    return c.json({ error: errorMessage(err) }, 400);
  }
});

runnerEvents.post('/run-gate', async (c) => {
  const body = (await c.req.json()) as {
    workflowRunId: string;
    stepRunId: string | null;
    gateId: GateRun['gateId'];
    params?: { changedFiles?: string[]; allowedPrefixes?: string[] };
  };
  let gate: GateRun;
  switch (body.gateId) {
    case 'requirement_gate': {
      const a = latestMarkdownArtifact(body.workflowRunId, 'requirement_draft');
      gate = runRequirementGate({
        workflowRunId: body.workflowRunId,
        stepRunId: body.stepRunId,
        artifact: a,
      });
      break;
    }
    case 'design_gate': {
      const a = latestMarkdownArtifact(body.workflowRunId, 'design_doc');
      gate = runDesignGate({
        workflowRunId: body.workflowRunId,
        stepRunId: body.stepRunId,
        artifact: a,
      });
      break;
    }
    case 'diff_scope_gate': {
      const diff = store.artifacts.byKind(body.workflowRunId, 'diff').at(-1) ?? null;
      gate = runDiffScopeGate({
        workflowRunId: body.workflowRunId,
        stepRunId: body.stepRunId,
        changedFiles: body.params?.changedFiles ?? [],
        allowedPrefixes: body.params?.allowedPrefixes ?? ['src/'],
        diffArtifact: diff,
      });
      break;
    }
    case 'sensitive_change_gate': {
      const diff = store.artifacts.byKind(body.workflowRunId, 'diff').at(-1) ?? null;
      gate = runSensitiveChangeGate({
        workflowRunId: body.workflowRunId,
        stepRunId: body.stepRunId,
        changedFiles: body.params?.changedFiles ?? [],
        diffArtifact: diff,
      });
      break;
    }
    case 'acceptance_gate': {
      gate = runAcceptanceTraceabilityGate({
        workflowRunId: body.workflowRunId,
        stepRunId: body.stepRunId,
      });
      break;
    }
    case 'evidence_gate': {
      gate = runEvidenceGate({
        workflowRunId: body.workflowRunId,
        stepRunId: body.stepRunId,
      });
      break;
    }
    default:
      return c.json(
        { error: `gate ${body.gateId} not supported via /run-gate (manual gates use /approvals)` },
        400,
      );
  }
  return c.json({ ok: true, gate });
});

function latestMarkdownArtifact(workflowRunId: string, kind: ArtifactKind) {
  const artifacts = store.artifacts.byKind(workflowRunId, kind);
  return (
    artifacts
      .filter(
        (artifact) =>
          artifact.contentType.includes('markdown') ||
          (typeof artifact.metadata.output === 'string' && artifact.metadata.output.endsWith('.md')),
      )
      .at(-1) ??
    artifacts.at(-1) ??
    null
  );
}
