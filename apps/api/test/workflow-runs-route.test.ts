import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, expect, test } from 'vitest';
import {
  GRAPH_RUNTIME_SCHEMA_VERSION,
  RUNNER_TOOL_SPECS,
  newId,
  nowIso,
  type GraphDefinition,
  type GraphEvent,
  type GraphNodeRun,
  type GraphRun,
  type KnowledgeArtifact,
  type Artifact,
  type HandoffRecord,
  type Project,
  type StepCheckpoint,
  type StepRun,
  type ToolInvocation,
  type WorkflowRun,
} from '@ainp/shared';

process.env.AINP_DB_PATH = join(
  mkdtempSync(join(tmpdir(), 'ainp-workflow-runs-route-test-')),
  'ainp.sqlite',
);
process.env.AINP_HOME = join(
  mkdtempSync(join(tmpdir(), 'ainp-workflow-runs-route-home-')),
  '.ai-native',
);

let app: Awaited<typeof import('../src/app')>['app'];
let storeMod: typeof import('../src/store/store');

beforeAll(async () => {
  ({ app } = await import('../src/app'));
  storeMod = await import('../src/store/store');
});

function registerProject(name: string): Project {
  const project: Project = {
    id: newId('proj'),
    name,
    localPath: '/tmp/route-test-fixture',
    sourceKind: 'local',
    sourceUrl: null,
    sourceAuthKind: 'none',
    sourceUsername: null,
    sourceCredential: null,
    status: 'active',
    archivedAt: null,
    agentBackend: 'claude_code',
    language: 'java',
    buildTool: 'maven',
    defaultBranch: 'main',
    sourceBranches: ['main'],
    registeredAt: nowIso(),
  };
  storeMod.store.projects.set(project.id, project);
  return project;
}

async function createRun(projectName: string, title: string): Promise<WorkflowRun> {
  const project = registerProject(projectName);
  const res = await app.request('/workflow-runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectName: project.name,
      type: 'feature',
      title,
    }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as WorkflowRun;
}

function graphDefinitionForResume(): GraphDefinition {
  return {
    id: 'gdef_resume_v1',
    schemaVersion: GRAPH_RUNTIME_SCHEMA_VERSION,
    version: '1',
    sourceFlowId: 'feature.fastforward',
    description: 'Fastforward resume graph',
    nodes: [{
      id: 'node:feature.fastforward:0:implementation',
      stage: 'implementation',
      kind: 'agent',
      skillId: 'cs-feat-impl',
      label: 'implementation',
      inputSelectors: [],
      outputNames: [],
      retryPolicy: { maxAttempts: 2, backoff: 'none' },
      resumePolicy: 'new_attempt',
      failurePolicy: 'fail_fast',
      joinPolicy: 'none',
      metadata: {},
    }],
    edges: [],
    entryNodeIds: ['node:feature.fastforward:0:implementation'],
    createdAt: nowIso(),
    metadata: { generatedFrom: 'test' },
  };
}

async function postArtifact(run: WorkflowRun, suffix: string): Promise<Artifact> {
  const res = await app.request('/runner/events/artifact', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowRunId: run.id,
      stepRunId: null,
      kind: 'other',
      uri: `mem://${run.id}/${suffix}.md`,
      size: 10,
      contentType: 'text/markdown',
      metadata: { source: suffix },
    }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { artifact: Artifact }).artifact;
}

async function postAgentSession(
  run: WorkflowRun,
  stage: string,
  parentSessionId: string | null = null,
): Promise<{ taskId: string; sessionId: string }> {
  const taskRes = await app.request('/runner/events/agent-task-started', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowRunId: run.id,
      stepRunId: null,
      kind: stage,
      backend: 'codex',
      prompt: `${stage} prompt`,
      inputArtifactIds: [],
    }),
  });
  expect(taskRes.status).toBe(201);
  const taskBody = (await taskRes.json()) as { task: { id: string } };
  const sessionRes = await app.request('/runner/events/agent-session-started', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowRunId: run.id,
      agentTaskId: taskBody.task.id,
      stage,
      skillId: `skill.${stage}`,
      skillVersion: '1.0.0',
      contextPackId: `ctx_${stage}`,
      parentSessionId,
      metadata: parentSessionId ? { linkKind: 'handoff_child' } : {},
    }),
  });
  expect(sessionRes.status).toBe(201);
  const sessionBody = (await sessionRes.json()) as { session: { id: string } };
  return { taskId: taskBody.task.id, sessionId: sessionBody.session.id };
}

// ---------------------------------------------------------------------------
// V2 W2-3 PR2 — POST /workflow-runs honors body.flowId end-to-end.
// PRD W2-3 AC-9 / AC-10 (HTTP route plumbing).
// ---------------------------------------------------------------------------

test('POST /workflow-runs without flowId creates a full standard feature run', async () => {
  const project = registerProject('ff-route-default');

  const res = await app.request('/workflow-runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectName: project.name,
      type: 'feature',
      title: 'no flowId in body',
    }),
  });

  expect(res.status).toBe(201);
  const run = (await res.json()) as WorkflowRun;
  expect(run.flowId).toBe('feature.standard');
  expect(run.startStage).toBeNull();
});

test('GET /workflow-runs/:id/agent-sessions returns empty list for legacy runs', async () => {
  const project = registerProject('agent-sessions-empty-route');
  const create = await app.request('/workflow-runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectName: project.name,
      type: 'feature',
      title: 'legacy run has no sessions yet',
    }),
  });
  const run = (await create.json()) as WorkflowRun;

  const res = await app.request(`/workflow-runs/${encodeURIComponent(run.id)}/agent-sessions`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ items: [] });
});

test('GET /workflow-runs/:id/step-checkpoints returns empty list for legacy runs', async () => {
  const run = await createRun('step-checkpoints-empty-route', 'legacy run has no checkpoints yet');

  const res = await app.request(`/workflow-runs/${encodeURIComponent(run.id)}/step-checkpoints`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ items: [] });
});

test('GET /workflow-runs/:id/graph returns empty graph metadata for legacy runs', async () => {
  const run = await createRun('graph-empty-route', 'legacy run has no graph rows yet');

  const res = await app.request(`/workflow-runs/${encodeURIComponent(run.id)}/graph`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    graphDefinition: null,
    graphRun: null,
    nodeRuns: [],
    events: [],
  });
});

test('graph ledger persists and exposes graph run, node run, checkpoint link, and events', async () => {
  const run = await createRun('graph-ledger-route', 'record graph ledger rows');
  const step = {
    id: 'step_graph_impl',
    workflowRunId: run.id,
    stage: 'implementation',
    name: 'Implementation',
    status: 'passed',
    startedAt: nowIso(),
    completedAt: nowIso(),
  } satisfies StepRun;
  storeMod.store.stepRuns.set(step.id, step);
  const checkpoint: StepCheckpoint = {
    id: 'scp_graph_impl',
    workflowRunId: run.id,
    stepRunId: step.id,
    stage: 'implementation',
    status: 'passed',
    inputArtifactIds: [],
    outputArtifactIds: [],
    contextPackId: null,
    agentSessionIds: [],
    toolInvocationIds: [],
    gateRunIds: [],
    retryIndex: 0,
    resumeCursor: 'graph://feature.standard/implementation',
    failureReason: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    metadata: {},
  };
  storeMod.store.stepCheckpoints.upsert(checkpoint);

  const graphDefinition: GraphDefinition = {
    id: 'gdef_feature_standard_v1',
    schemaVersion: GRAPH_RUNTIME_SCHEMA_VERSION,
    version: '1',
    sourceFlowId: 'feature.standard',
    description: 'Feature standard linear graph',
    nodes: [{
      id: 'feature.standard:3:implementation',
      stage: 'implementation',
      kind: 'agent',
      skillId: 'cs-feat-impl',
      label: 'Implementation',
      inputSelectors: [],
      outputNames: [],
      retryPolicy: { maxAttempts: 2, backoff: 'none' },
      resumePolicy: 'new_attempt',
      failurePolicy: 'fail_fast',
      joinPolicy: 'none',
      metadata: {},
    }],
    edges: [],
    entryNodeIds: ['feature.standard:3:implementation'],
    createdAt: nowIso(),
    metadata: { source: 'test' },
  };
  const graphRun: GraphRun = {
    id: 'grun_feature_standard_1',
    workflowRunId: run.id,
    graphDefinitionId: graphDefinition.id,
    graphVersion: graphDefinition.version,
    status: 'running',
    activeNodeIds: ['feature.standard:3:implementation'],
    interruptedReason: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    metadata: {},
  };
  const nodeRun: GraphNodeRun = {
    id: 'gnr_feature_standard_impl_1',
    graphRunId: graphRun.id,
    workflowRunId: run.id,
    nodeId: 'feature.standard:3:implementation',
    attempt: 1,
    status: 'passed',
    stepRunId: step.id,
    stepCheckpointId: checkpoint.id,
    resumeCursor: checkpoint.resumeCursor,
    idempotencyKey: `${graphRun.id}:feature.standard:3:implementation:1`,
    dependencyState: {
      upstreamNodeIds: [],
      satisfiedNodeIds: [],
      blockedNodeIds: [],
    },
    startedAt: step.startedAt,
    completedAt: step.completedAt,
    metadata: { evidenceRefs: [checkpoint.id] },
  };
  const event: GraphEvent = {
    id: 'gevt_feature_standard_impl_1',
    graphRunId: graphRun.id,
    workflowRunId: run.id,
    nodeId: nodeRun.nodeId,
    type: 'node_finished',
    createdAt: nowIso(),
    payload: { nodeRunId: nodeRun.id },
  };

  storeMod.store.graphDefinitions.upsert(graphDefinition);
  storeMod.store.graphRuns.upsert(graphRun);
  storeMod.store.graphNodeRuns.upsert(nodeRun);
  storeMod.store.graphEvents.insert(event);

  const res = await app.request(`/workflow-runs/${encodeURIComponent(run.id)}/graph`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    graphDefinition: GraphDefinition | null;
    graphRun: GraphRun | null;
    nodeRuns: GraphNodeRun[];
    events: GraphEvent[];
  };
  expect(body.graphDefinition?.id).toBe(graphDefinition.id);
  expect(body.graphRun).toMatchObject({ id: graphRun.id, workflowRunId: run.id });
  expect(body.nodeRuns).toMatchObject([{
    id: nodeRun.id,
    stepRunId: step.id,
    stepCheckpointId: checkpoint.id,
    dependencyState: {
      upstreamNodeIds: [],
      satisfiedNodeIds: [],
      blockedNodeIds: [],
    },
  }]);
  expect(body.events).toMatchObject([{ id: event.id, type: 'node_finished' }]);

  const full = await app.request(`/workflow-runs/${encodeURIComponent(run.id)}`);
  expect(full.status).toBe(200);
  expect(((await full.json()) as { graph: unknown }).graph).toMatchObject({
    graphRun: { id: graphRun.id },
    nodeRuns: [{ id: nodeRun.id }],
  });
});

test('runner graph events persist graph and node state into the read model', async () => {
  const run = await createRun('graph-runner-events-route', 'record graph runner events');
  const graphDefinition: GraphDefinition = {
    id: 'gdef_runner_events_v1',
    schemaVersion: GRAPH_RUNTIME_SCHEMA_VERSION,
    version: '1',
    sourceFlowId: 'feature.fastforward',
    description: 'Fastforward linear graph',
    nodes: [{
      id: 'node:feature.fastforward:0:implementation',
      stage: 'implementation',
      kind: 'agent',
      skillId: 'cs-feat-impl',
      label: 'implementation',
      inputSelectors: [],
      outputNames: [],
      retryPolicy: { maxAttempts: 1, backoff: 'none' },
      resumePolicy: 'new_attempt',
      failurePolicy: 'fail_fast',
      joinPolicy: 'none',
      metadata: {},
    }],
    edges: [],
    entryNodeIds: ['node:feature.fastforward:0:implementation'],
    createdAt: nowIso(),
    metadata: { generatedFrom: 'test' },
  };

  const graphRunRes = await app.request('/runner/events/graph-run-started', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowRunId: run.id,
      graphDefinition,
    }),
  });
  expect(graphRunRes.status).toBe(201);
  const graphRun = ((await graphRunRes.json()) as { graphRun: GraphRun }).graphRun;

  const nodeRunRes = await app.request('/runner/events/graph-node-started', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowRunId: run.id,
      graphRunId: graphRun.id,
      nodeId: graphDefinition.nodes[0]!.id,
      dependencyState: {
        upstreamNodeIds: [],
        satisfiedNodeIds: [],
        blockedNodeIds: [],
      },
      idempotencyKey: `${graphRun.id}:${graphDefinition.nodes[0]!.id}:1`,
    }),
  });
  expect(nodeRunRes.status).toBe(201);
  const nodeRun = ((await nodeRunRes.json()) as { nodeRun: GraphNodeRun }).nodeRun;

  const step = {
    id: 'step_graph_runner_event_impl',
    workflowRunId: run.id,
    stage: 'implementation',
    name: 'Implementation',
    status: 'passed',
    startedAt: nowIso(),
    completedAt: nowIso(),
  } satisfies StepRun;
  storeMod.store.stepRuns.set(step.id, step);
  const checkpoint: StepCheckpoint = {
    id: 'scp_graph_runner_event_impl',
    workflowRunId: run.id,
    stepRunId: step.id,
    stage: 'implementation',
    status: 'passed',
    inputArtifactIds: [],
    outputArtifactIds: [],
    contextPackId: null,
    agentSessionIds: [],
    toolInvocationIds: [],
    gateRunIds: [],
    retryIndex: 0,
    resumeCursor: null,
    failureReason: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    metadata: {},
  };
  storeMod.store.stepCheckpoints.upsert(checkpoint);

  const nodeFinishRes = await app.request('/runner/events/graph-node-finished', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeRunId: nodeRun.id,
      status: 'passed',
      stepRunId: step.id,
      stepCheckpointId: checkpoint.id,
    }),
  });
  expect(nodeFinishRes.status).toBe(200);

  const graphRes = await app.request(`/workflow-runs/${encodeURIComponent(run.id)}/graph`);
  expect(graphRes.status).toBe(200);
  const graphBody = (await graphRes.json()) as {
    graphRun: GraphRun | null;
    nodeRuns: GraphNodeRun[];
    events: GraphEvent[];
  };
  expect(graphBody.graphRun).toMatchObject({ id: graphRun.id, status: 'running' });
  expect(graphBody.nodeRuns).toMatchObject([{
    id: nodeRun.id,
    status: 'passed',
    stepRunId: step.id,
    stepCheckpointId: checkpoint.id,
  }]);
  expect(graphBody.events.map((event) => event.type)).toEqual([
    'graph_planned',
    'node_started',
    'node_finished',
  ]);
});

test('graph node run rejects a step run from another workflow', async () => {
  const run = await createRun('graph-cross-link-a', 'graph owner run');
  const other = await createRun('graph-cross-link-b', 'other workflow run');
  storeMod.store.graphRuns.upsert({
    id: 'grun_cross_link',
    workflowRunId: run.id,
    graphDefinitionId: 'gdef_cross_link',
    graphVersion: '1',
    status: 'running',
    activeNodeIds: ['node_a'],
    interruptedReason: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    metadata: {},
  });
  storeMod.store.stepRuns.set('step_cross_other', {
    id: 'step_cross_other',
    workflowRunId: other.id,
    stage: 'implementation',
    name: 'Implementation',
    status: 'passed',
    startedAt: nowIso(),
    completedAt: nowIso(),
  });

  expect(() =>
    storeMod.store.graphNodeRuns.upsert({
      id: 'gnr_cross_invalid',
      graphRunId: 'grun_cross_link',
      workflowRunId: run.id,
      nodeId: 'node_a',
      attempt: 1,
      status: 'passed',
      stepRunId: 'step_cross_other',
      stepCheckpointId: null,
      resumeCursor: null,
      idempotencyKey: 'grun_cross_link:node_a:1',
      dependencyState: {
        upstreamNodeIds: [],
        satisfiedNodeIds: [],
        blockedNodeIds: [],
      },
      startedAt: nowIso(),
      completedAt: nowIso(),
      metadata: {},
    }),
  ).toThrow(/stepRunId does not belong to workflowRunId/);
});

test('graph resume creates a ready node attempt from a failed checkpointed node', async () => {
  const run = await createRun('graph-resume-route', 'resume failed graph node');
  const step = {
    id: 'step_graph_resume_failed',
    workflowRunId: run.id,
    stage: 'implementation',
    name: 'Implementation',
    status: 'failed',
    startedAt: nowIso(),
    completedAt: nowIso(),
  } satisfies StepRun;
  storeMod.store.stepRuns.set(step.id, step);
  const checkpoint: StepCheckpoint = {
    id: 'scp_graph_resume_failed',
    workflowRunId: run.id,
    stepRunId: step.id,
    stage: 'implementation',
    status: 'failed',
    inputArtifactIds: [],
    outputArtifactIds: [],
    contextPackId: null,
    agentSessionIds: [],
    toolInvocationIds: [],
    gateRunIds: [],
    retryIndex: 0,
    resumeCursor: 'graph://resume/implementation',
    failureReason: 'agent failed',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    metadata: {},
  };
  storeMod.store.stepCheckpoints.upsert(checkpoint);
  const graphDefinition = graphDefinitionForResume();
  const graphRun: GraphRun = {
    id: 'grun_resume',
    workflowRunId: run.id,
    graphDefinitionId: graphDefinition.id,
    graphVersion: graphDefinition.version,
    status: 'failed',
    activeNodeIds: [],
    interruptedReason: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    metadata: {},
  };
  const failedNodeRun: GraphNodeRun = {
    id: 'gnr_resume_failed_1',
    graphRunId: graphRun.id,
    workflowRunId: run.id,
    nodeId: graphDefinition.nodes[0]!.id,
    attempt: 1,
    status: 'failed',
    stepRunId: step.id,
    stepCheckpointId: checkpoint.id,
    resumeCursor: checkpoint.resumeCursor,
    idempotencyKey: `${graphRun.id}:${graphDefinition.nodes[0]!.id}:1`,
    dependencyState: {
      upstreamNodeIds: [],
      satisfiedNodeIds: [],
      blockedNodeIds: [],
    },
    startedAt: step.startedAt,
    completedAt: step.completedAt,
    metadata: {},
  };
  storeMod.store.graphDefinitions.upsert(graphDefinition);
  storeMod.store.graphRuns.upsert(graphRun);
  storeMod.store.graphNodeRuns.upsert(failedNodeRun);

  const res = await app.request(`/workflow-runs/${encodeURIComponent(run.id)}/graph/resume-node`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeRunId: failedNodeRun.id,
      graphVersion: graphDefinition.version,
      resumeCursor: checkpoint.resumeCursor,
      actor: 'test',
    }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { nodeRun: GraphNodeRun };
  expect(body.nodeRun).toMatchObject({
    graphRunId: graphRun.id,
    workflowRunId: run.id,
    nodeId: failedNodeRun.nodeId,
    attempt: 2,
    status: 'ready',
    stepRunId: null,
    stepCheckpointId: null,
    resumeCursor: checkpoint.resumeCursor,
    metadata: {
      resumeOfNodeRunId: failedNodeRun.id,
      sourceCheckpointId: checkpoint.id,
      actor: 'test',
    },
  });

  const startReady = await app.request('/runner/events/graph-node-started', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowRunId: run.id,
      graphRunId: graphRun.id,
      nodeRunId: body.nodeRun.id,
      nodeId: body.nodeRun.nodeId,
      dependencyState: body.nodeRun.dependencyState,
      idempotencyKey: body.nodeRun.idempotencyKey,
    }),
  });
  expect(startReady.status).toBe(201);
  expect(((await startReady.json()) as { nodeRun: GraphNodeRun }).nodeRun).toMatchObject({
    id: body.nodeRun.id,
    attempt: 2,
    status: 'running',
  });

  const graphRes = await app.request(`/workflow-runs/${encodeURIComponent(run.id)}/graph`);
  const graphBody = (await graphRes.json()) as { events: GraphEvent[] };
  expect(graphBody.events.map((event) => event.type)).toContain('resume_requested');
});

test('graph resume rejects completed nodes and invalid resume cursors', async () => {
  const run = await createRun('graph-resume-reject-route', 'reject invalid graph resume');
  const graphDefinition = graphDefinitionForResume();
  const graphRun: GraphRun = {
    id: 'grun_resume_reject',
    workflowRunId: run.id,
    graphDefinitionId: graphDefinition.id,
    graphVersion: graphDefinition.version,
    status: 'running',
    activeNodeIds: [],
    interruptedReason: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    metadata: {},
  };
  const step: StepRun = {
    id: 'step_graph_resume_passed',
    workflowRunId: run.id,
    stage: 'implementation',
    name: 'Implementation',
    status: 'passed',
    startedAt: nowIso(),
    completedAt: nowIso(),
  };
  const checkpoint: StepCheckpoint = {
    id: 'scp_graph_resume_passed',
    workflowRunId: run.id,
    stepRunId: step.id,
    stage: 'implementation',
    status: 'passed',
    inputArtifactIds: [],
    outputArtifactIds: [],
    contextPackId: null,
    agentSessionIds: [],
    toolInvocationIds: [],
    gateRunIds: [],
    retryIndex: 0,
    resumeCursor: 'graph://resume/passed',
    failureReason: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    metadata: {},
  };
  storeMod.store.stepRuns.set(step.id, step);
  storeMod.store.stepCheckpoints.upsert(checkpoint);
  storeMod.store.graphDefinitions.upsert(graphDefinition);
  storeMod.store.graphRuns.upsert(graphRun);
  storeMod.store.graphNodeRuns.upsert({
    id: 'gnr_resume_passed_1',
    graphRunId: graphRun.id,
    workflowRunId: run.id,
    nodeId: graphDefinition.nodes[0]!.id,
    attempt: 1,
    status: 'passed',
    stepRunId: step.id,
    stepCheckpointId: checkpoint.id,
    resumeCursor: checkpoint.resumeCursor,
    idempotencyKey: `${graphRun.id}:${graphDefinition.nodes[0]!.id}:1`,
    dependencyState: { upstreamNodeIds: [], satisfiedNodeIds: [], blockedNodeIds: [] },
    startedAt: step.startedAt,
    completedAt: step.completedAt,
    metadata: {},
  });

  const passedRes = await app.request(`/workflow-runs/${encodeURIComponent(run.id)}/graph/resume-node`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeRunId: 'gnr_resume_passed_1',
      graphVersion: graphDefinition.version,
      resumeCursor: checkpoint.resumeCursor,
    }),
  });
  expect(passedRes.status).toBe(400);
  expect(await passedRes.json()).toMatchObject({ error: expect.stringContaining('cannot resume completed') });

  const cursorRes = await app.request(`/workflow-runs/${encodeURIComponent(run.id)}/graph/resume-node`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeRunId: 'gnr_resume_passed_1',
      graphVersion: graphDefinition.version,
      resumeCursor: 'wrong-cursor',
    }),
  });
  expect(cursorRes.status).toBe(400);
});

test('graph resume preserves Workflow Engine and Gate Engine authority (R5)', async () => {
  const run = await createRun('graph-resume-authority-route', 'resume must not touch workflow status or gates');

  // Snapshot the WorkflowRun status + gate verdicts BEFORE any graph resume.
  // R5: Graph Runtime owns scheduling readiness only — it must never write
  // WorkflowRun.status (Workflow Engine authority) or decide GateRun verdicts
  // (Gate Engine authority).
  const before = await app.request(`/workflow-runs/${encodeURIComponent(run.id)}`);
  const beforeBody = (await before.json()) as { run: WorkflowRun; gates: unknown[] };
  const statusBefore = beforeBody.run.status;
  expect(beforeBody.gates).toEqual([]);

  const step: StepRun = {
    id: 'step_graph_authority_failed',
    workflowRunId: run.id,
    stage: 'implementation',
    name: 'Implementation',
    status: 'failed',
    startedAt: nowIso(),
    completedAt: nowIso(),
  };
  const checkpoint: StepCheckpoint = {
    id: 'scp_graph_authority_failed',
    workflowRunId: run.id,
    stepRunId: step.id,
    stage: 'implementation',
    status: 'failed',
    inputArtifactIds: [],
    outputArtifactIds: [],
    contextPackId: null,
    agentSessionIds: [],
    toolInvocationIds: [],
    gateRunIds: [],
    retryIndex: 0,
    resumeCursor: 'graph://resume/authority',
    failureReason: 'agent failed',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    metadata: {},
  };
  const graphDefinition = graphDefinitionForResume();
  const graphRun: GraphRun = {
    id: 'grun_authority',
    workflowRunId: run.id,
    graphDefinitionId: graphDefinition.id,
    graphVersion: graphDefinition.version,
    status: 'failed',
    activeNodeIds: [],
    interruptedReason: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    metadata: {},
  };
  const failedNodeRun: GraphNodeRun = {
    id: 'gnr_authority_failed_1',
    graphRunId: graphRun.id,
    workflowRunId: run.id,
    nodeId: graphDefinition.nodes[0]!.id,
    attempt: 1,
    status: 'failed',
    stepRunId: step.id,
    stepCheckpointId: checkpoint.id,
    resumeCursor: checkpoint.resumeCursor,
    idempotencyKey: `${graphRun.id}:${graphDefinition.nodes[0]!.id}:1`,
    dependencyState: { upstreamNodeIds: [], satisfiedNodeIds: [], blockedNodeIds: [] },
    startedAt: step.startedAt,
    completedAt: step.completedAt,
    metadata: {},
  };
  storeMod.store.stepRuns.set(step.id, step);
  storeMod.store.stepCheckpoints.upsert(checkpoint);
  storeMod.store.graphDefinitions.upsert(graphDefinition);
  storeMod.store.graphRuns.upsert(graphRun);
  storeMod.store.graphNodeRuns.upsert(failedNodeRun);

  const res = await app.request(`/workflow-runs/${encodeURIComponent(run.id)}/graph/resume-node`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeRunId: failedNodeRun.id,
      graphVersion: graphDefinition.version,
      resumeCursor: checkpoint.resumeCursor,
      actor: 'test',
    }),
  });
  expect(res.status).toBe(201);

  // The resume created a new graph node attempt (graph-owned state)...
  const graphRes = await app.request(`/workflow-runs/${encodeURIComponent(run.id)}/graph`);
  const graphBody = (await graphRes.json()) as { nodeRuns: GraphNodeRun[] };
  expect(graphBody.nodeRuns.some((n) => n.attempt === 2 && n.status === 'ready')).toBe(true);

  // ...but Workflow Engine + Gate Engine authority is untouched.
  const after = await app.request(`/workflow-runs/${encodeURIComponent(run.id)}`);
  const afterBody = (await after.json()) as { run: WorkflowRun; gates: unknown[] };
  expect(afterBody.run.status).toBe(statusBefore);
  expect(afterBody.gates).toEqual([]);
});

test('retry-step creates a graph resume attempt when graph metadata exists', async () => {
  const run = await createRun('graph-retry-facade-route', 'retry graph-backed stage');
  const graphDefinition = graphDefinitionForResume();
  const graphRun: GraphRun = {
    id: 'grun_retry_facade',
    workflowRunId: run.id,
    graphDefinitionId: graphDefinition.id,
    graphVersion: graphDefinition.version,
    status: 'failed',
    activeNodeIds: [],
    interruptedReason: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    metadata: {},
  };
  const step: StepRun = {
    id: 'step_retry_facade_failed',
    workflowRunId: run.id,
    stage: 'implementation',
    name: 'Implementation',
    status: 'failed',
    startedAt: nowIso(),
    completedAt: nowIso(),
  };
  const checkpoint: StepCheckpoint = {
    id: 'scp_retry_facade_failed',
    workflowRunId: run.id,
    stepRunId: step.id,
    stage: 'implementation',
    status: 'failed',
    inputArtifactIds: [],
    outputArtifactIds: [],
    contextPackId: null,
    agentSessionIds: [],
    toolInvocationIds: [],
    gateRunIds: [],
    retryIndex: 0,
    resumeCursor: 'graph://retry/implementation',
    failureReason: 'failed',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    metadata: {},
  };
  storeMod.store.stepRuns.set(step.id, step);
  storeMod.store.stepCheckpoints.upsert(checkpoint);
  storeMod.store.graphDefinitions.upsert(graphDefinition);
  storeMod.store.graphRuns.upsert(graphRun);
  storeMod.store.graphNodeRuns.upsert({
    id: 'gnr_retry_facade_failed_1',
    graphRunId: graphRun.id,
    workflowRunId: run.id,
    nodeId: graphDefinition.nodes[0]!.id,
    attempt: 1,
    status: 'failed',
    stepRunId: step.id,
    stepCheckpointId: checkpoint.id,
    resumeCursor: checkpoint.resumeCursor,
    idempotencyKey: `${graphRun.id}:${graphDefinition.nodes[0]!.id}:1`,
    dependencyState: { upstreamNodeIds: [], satisfiedNodeIds: [], blockedNodeIds: [] },
    startedAt: step.startedAt,
    completedAt: step.completedAt,
    metadata: {},
  });

  const res = await app.request(`/workflow-runs/${encodeURIComponent(run.id)}/retry-step`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stage: 'implementation', actor: 'test' }),
  });
  expect(res.status).toBe(200);
  const graph = storeMod.store.graphRuntime.byWorkflow(run.id);
  expect(graph.nodeRuns.at(-1)).toMatchObject({
    nodeId: graphDefinition.nodes[0]!.id,
    attempt: 2,
    status: 'ready',
  });
});

test('runner events merge agent, tool, gate and failure refs into a step checkpoint', async () => {
  const run = await createRun('step-checkpoints-route', 'record step checkpoint evidence');
  const input = await postArtifact(run, 'design-input');
  const output = await postArtifact(run, 'implementation-output');
  const stepStarted = await app.request('/runner/events/step-started', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowRunId: run.id,
      stage: 'implementation',
      name: 'skill.implementation',
    }),
  });
  expect(stepStarted.status).toBe(200);
  const step = ((await stepStarted.json()) as { step: { id: string } }).step;

  const taskRes = await app.request('/runner/events/agent-task-started', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowRunId: run.id,
      stepRunId: step.id,
      kind: 'implementation',
      backend: 'codex',
      prompt: 'ContextPack: ctx_checkpoint',
      inputArtifactIds: [input.id],
    }),
  });
  expect(taskRes.status).toBe(201);
  const task = ((await taskRes.json()) as { task: { id: string } }).task;
  const sessionRes = await app.request('/runner/events/agent-session-started', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowRunId: run.id,
      agentTaskId: task.id,
      stage: 'implementation',
      skillId: 'skill.implementation',
      skillVersion: '1.0.0',
      contextPackId: 'ctx_checkpoint',
      retryIndex: 1,
    }),
  });
  expect(sessionRes.status).toBe(201);
  const session = ((await sessionRes.json()) as { session: { id: string } }).session;
  const resultRes = await app.request('/runner/events/agent-task-finished', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      taskId: task.id,
      status: 'success',
      summary: 'implementation produced diff',
      outputArtifactIds: [output.id],
    }),
  });
  expect(resultRes.status).toBe(201);
  const result = ((await resultRes.json()) as { result: { id: string } }).result;
  const finishedSession = await app.request('/runner/events/agent-session-finished', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId: session.id,
      status: 'success',
      agentResultId: result.id,
    }),
  });
  expect(finishedSession.status).toBe(201);

  const spec = RUNNER_TOOL_SPECS['runner.git_diff_capture'];
  const toolInvocation: ToolInvocation = {
    id: 'tinv_checkpoint_diff',
    workflowRunId: run.id,
    stepRunId: step.id,
    toolId: spec.id,
    toolName: spec.name,
    schemaVersion: spec.schemaVersion,
    status: 'success',
    sideEffect: spec.sideEffect,
    permissionTier: spec.permissionTier,
    permissionDecision: 'not_required',
    argumentsDigest: 'digest_args_checkpoint',
    resultRefs: [{ kind: 'artifact', id: output.id }],
    startedAt: nowIso(),
    completedAt: nowIso(),
    durationMs: 3,
    error: null,
    metadata: { changedFiles: ['src/App.java'] },
  };
  const toolRecord = await app.request('/runner/events/tool-invocation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ toolInvocation }),
  });
  expect(toolRecord.status).toBe(200);

  const gateRes = await app.request('/runner/events/run-gate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowRunId: run.id,
      stepRunId: step.id,
      gateId: 'diff_scope_gate',
      params: { changedFiles: ['docs/notes.md'], allowedPrefixes: ['src/'] },
    }),
  });
  expect(gateRes.status).toBe(200);
  const gate = ((await gateRes.json()) as { gate: { id: string; status: string } }).gate;
  expect(gate.status).toBe('fail');

  const stepFinished = await app.request('/runner/events/step-finished', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      stepRunId: step.id,
      status: 'failed',
      failureReason: 'diff_scope_gate failed; aborting',
    }),
  });
  expect(stepFinished.status).toBe(200);

  const res = await app.request(`/workflow-runs/${encodeURIComponent(run.id)}/step-checkpoints`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { items: StepCheckpoint[] };
  expect(body.items).toMatchObject([{
    stepRunId: step.id,
    stage: 'implementation',
    status: 'failed',
    inputArtifactIds: [input.id],
    outputArtifactIds: [output.id],
    contextPackId: 'ctx_checkpoint',
    agentSessionIds: [session.id],
    toolInvocationIds: ['tinv_checkpoint_diff'],
    gateRunIds: [gate.id],
    retryIndex: 1,
    failureReason: 'diff_scope_gate failed; aborting',
  }]);
});

test('runner checkpoint event records stage context metadata maps', async () => {
  const run = await createRun('stage-context-checkpoint-route', 'record stage context maps');
  const input = await postArtifact(run, 'requirement-input');
  const output = await postArtifact(run, 'design-output');
  const stepStarted = await app.request('/runner/events/step-started', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowRunId: run.id,
      stage: 'design',
      name: 'skill.design',
    }),
  });
  expect(stepStarted.status).toBe(200);
  const step = ((await stepStarted.json()) as { step: { id: string } }).step;

  const startSnapshot = {
    phase: 'start',
    workflowRunId: run.id,
    stepRunId: step.id,
    stage: 'design',
    inputs: { 'requirement.md': 'REQ: keep behavior compatible' },
    inputArtifactIds: { 'requirement.md': input.id },
    producedArtifactIds: {},
    contextPackArtifactIds: ['ctxpack_base_artifact'],
    createdAt: nowIso(),
  };
  const startRes = await app.request('/runner/events/step-checkpoint', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowRunId: run.id,
      stepRunId: step.id,
      stage: 'design',
      status: 'running',
      inputArtifactIds: [input.id],
      metadata: {
        stageContextPhase: 'start',
        stageContextStart: startSnapshot,
      },
    }),
  });
  expect(startRes.status).toBe(200);

  const finishSnapshot = {
    ...startSnapshot,
    phase: 'finish',
    inputs: {
      ...startSnapshot.inputs,
      'design.md': 'Design summary',
    },
    inputArtifactIds: {
      ...startSnapshot.inputArtifactIds,
      'design.md': output.id,
    },
    producedArtifactIds: { 'design.md': output.id },
    createdAt: nowIso(),
  };
  const finishRes = await app.request('/runner/events/step-checkpoint', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowRunId: run.id,
      stepRunId: step.id,
      stage: 'design',
      status: 'passed',
      outputArtifactIds: [output.id],
      metadata: {
        stageContextPhase: 'finish',
        stageContextFinish: finishSnapshot,
      },
    }),
  });
  expect(finishRes.status).toBe(200);
  const checkpoint = ((await finishRes.json()) as { checkpoint: StepCheckpoint }).checkpoint;

  expect(checkpoint).toMatchObject({
    stepRunId: step.id,
    stage: 'design',
    status: 'passed',
    inputArtifactIds: [input.id],
    outputArtifactIds: [output.id],
  });
  expect(checkpoint.metadata.stageContextStart).toMatchObject({
    inputs: { 'requirement.md': 'REQ: keep behavior compatible' },
    inputArtifactIds: { 'requirement.md': input.id },
  });
  expect(checkpoint.metadata.stageContextFinish).toMatchObject({
    inputs: {
      'requirement.md': 'REQ: keep behavior compatible',
      'design.md': 'Design summary',
    },
    inputArtifactIds: {
      'requirement.md': input.id,
      'design.md': output.id,
    },
    producedArtifactIds: { 'design.md': output.id },
  });
});

test('runner event ingress records and exposes agent sessions by workflow run', async () => {
  const project = registerProject('agent-sessions-route');
  const create = await app.request('/workflow-runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectName: project.name,
      type: 'feature',
      title: 'record an agent session',
    }),
  });
  const run = (await create.json()) as WorkflowRun;

  const taskRes = await app.request('/runner/events/agent-task-started', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowRunId: run.id,
      stepRunId: null,
      kind: 'implementation',
      backend: 'codex',
      prompt: 'implement',
      inputArtifactIds: [],
    }),
  });
  const taskBody = (await taskRes.json()) as { task: { id: string } };
  const started = await app.request('/runner/events/agent-session-started', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowRunId: run.id,
      agentTaskId: taskBody.task.id,
      stage: 'implementation',
      skillId: 'skill.implementation',
      skillVersion: '1.0.0',
      contextPackId: 'ctx_route',
    }),
  });
  expect(started.status).toBe(201);
  const startedBody = (await started.json()) as { session: { id: string } };
  const resultRes = await app.request('/runner/events/agent-task-finished', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      taskId: taskBody.task.id,
      status: 'success',
      summary: 'done',
      outputArtifactIds: [],
    }),
  });
  const resultBody = (await resultRes.json()) as { result: { id: string } };
  const finished = await app.request('/runner/events/agent-session-finished', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId: startedBody.session.id,
      status: 'success',
      agentResultId: resultBody.result.id,
    }),
  });
  expect(finished.status).toBe(201);

  const res = await app.request(`/workflow-runs/${encodeURIComponent(run.id)}/agent-sessions`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { items: Array<{ id: string; status: string; agentResultId: string }> };
  expect(body.items).toMatchObject([
    {
      id: startedBody.session.id,
      status: 'success',
      agentResultId: resultBody.result.id,
    },
  ]);
});

test('runner event ingress records and exposes tool invocations by workflow run', async () => {
  const project = registerProject('tool-invocations-route');
  const create = await app.request('/workflow-runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectName: project.name,
      type: 'feature',
      title: 'record tool invocation',
    }),
  });
  const run = (await create.json()) as WorkflowRun;
  const spec = RUNNER_TOOL_SPECS['runner.command'];
  const toolInvocation: ToolInvocation = {
    id: 'tinv_route_command',
    workflowRunId: run.id,
    stepRunId: null,
    toolId: spec.id,
    toolName: spec.name,
    schemaVersion: spec.schemaVersion,
    status: 'success',
    sideEffect: spec.sideEffect,
    permissionTier: spec.permissionTier,
    permissionDecision: 'allowed',
    argumentsDigest: 'digest_args',
    resultRefs: [{ kind: 'command_run', id: 'cmd_route', digest: 'digest_cmd' }],
    startedAt: nowIso(),
    completedAt: nowIso(),
    durationMs: 10,
    error: null,
    metadata: { command: 'bun test' },
  };

  const record = await app.request('/runner/events/tool-invocation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ toolInvocation }),
  });
  expect(record.status).toBe(200);

  const res = await app.request(`/workflow-runs/${encodeURIComponent(run.id)}`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { toolInvocations: ToolInvocation[] };
  expect(body.toolInvocations).toMatchObject([{
    id: 'tinv_route_command',
    toolId: 'runner.command',
    status: 'success',
    resultRefs: [{ kind: 'command_run', id: 'cmd_route', digest: 'digest_cmd' }],
  }]);
});

test('runner event ingress rejects invalid tool invocation trust-boundary fields', async () => {
  const project = registerProject('tool-invocations-invalid-route');
  const create = await app.request('/workflow-runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectName: project.name,
      type: 'feature',
      title: 'reject invalid tool invocation',
    }),
  });
  const run = (await create.json()) as WorkflowRun;
  const spec = RUNNER_TOOL_SPECS['runner.command'];
  const invalidInvocation = {
    id: 'tinv_invalid',
    workflowRunId: run.id,
    stepRunId: null,
    toolId: spec.id,
    toolName: spec.name,
    schemaVersion: spec.schemaVersion,
    status: 'skipped',
    sideEffect: spec.sideEffect,
    permissionTier: spec.permissionTier,
    permissionDecision: 'allowed',
    argumentsDigest: 'digest_args',
    resultRefs: [],
    startedAt: nowIso(),
    completedAt: nowIso(),
    durationMs: 1,
    error: null,
    metadata: {},
  };

  const record = await app.request('/runner/events/tool-invocation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ toolInvocation: invalidInvocation }),
  });

  expect(record.status).toBe(400);
  const body = (await record.json()) as { error: string };
  expect(body.error).toContain('unknown tool invocation status');
  expect(storeMod.store.toolInvocations.get('tinv_invalid')).toBeUndefined();
});

test('runner event ingress records and exposes bounded handoffs by workflow run', async () => {
  const run = await createRun('handoff-route', 'record bounded handoff evidence');
  const input = await postArtifact(run, 'implementation-diff');
  const output = await postArtifact(run, 'review-findings');
  const parent = await postAgentSession(run, 'implementation');
  const child = await postAgentSession(run, 'review', parent.sessionId);

  const record = await app.request('/runner/events/handoff', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowRunId: run.id,
      parentSessionId: parent.sessionId,
      childSessionId: child.sessionId,
      fromRole: 'main',
      toRole: 'reviewer',
      reason: 'Independent implementation review.',
      inputArtifactIds: [input.id],
      expectedOutput: {
        schemaVersion: 'ainp.handoff.review.v1',
        artifactKind: 'other',
        description: 'Review findings artifact.',
      },
      stopCondition: 'Stop after one review artifact.',
      status: 'completed',
      adoptionDecision: 'needs_review',
      outputArtifactIds: [output.id],
      metadata: { gateAuthority: 'gate_engine' },
    }),
  });
  expect(record.status).toBe(201);
  const recorded = (await record.json()) as { handoff: HandoffRecord };
  expect(recorded.handoff).toMatchObject({
    workflowRunId: run.id,
    parentSessionId: parent.sessionId,
    childSessionId: child.sessionId,
    fromRole: 'main',
    toRole: 'reviewer',
    status: 'completed',
    adoptionDecision: 'needs_review',
    inputArtifactIds: [input.id],
    outputArtifactIds: [output.id],
  });

  const handoffs = await app.request(`/workflow-runs/${encodeURIComponent(run.id)}/handoffs`);
  expect(handoffs.status).toBe(200);
  expect((await handoffs.json()) as { items: HandoffRecord[] }).toMatchObject({
    items: [{ id: recorded.handoff.id, toRole: 'reviewer' }],
  });

  const summary = await app.request(`/workflow-runs/${encodeURIComponent(run.id)}`);
  const summaryBody = (await summary.json()) as { run: WorkflowRun; handoffs: HandoffRecord[] };
  expect(summaryBody.run.status).not.toBe('passed');
  expect(summaryBody.handoffs).toMatchObject([{ id: recorded.handoff.id }]);
});

test('runner event ingress rejects malformed handoffs without input refs or expected output schema', async () => {
  const run = await createRun('handoff-invalid-route', 'reject malformed handoff');
  const missingInputRefs = await app.request('/runner/events/handoff', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowRunId: run.id,
      fromRole: 'main',
      toRole: 'reviewer',
      reason: 'Review without refs should fail.',
      inputArtifactIds: [],
      expectedOutput: {
        schemaVersion: 'ainp.handoff.review.v1',
        artifactKind: 'other',
        description: 'Review findings artifact.',
      },
      stopCondition: 'Stop after one review artifact.',
    }),
  });
  expect(missingInputRefs.status).toBe(400);
  expect(((await missingInputRefs.json()) as { error: string }).error).toContain('inputArtifactIds');

  const input = await postArtifact(run, 'implementation-diff');
  const missingSchema = await app.request('/runner/events/handoff', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowRunId: run.id,
      fromRole: 'main',
      toRole: 'reviewer',
      reason: 'Review without expected schema should fail.',
      inputArtifactIds: [input.id],
      expectedOutput: { artifactKind: 'other' },
      stopCondition: 'Stop after one review artifact.',
    }),
  });
  expect(missingSchema.status).toBe(400);
  expect(((await missingSchema.json()) as { error: string }).error).toContain('expectedOutput');
});

test('runner event ingress validates agent session finish envelopes', async () => {
  const project = registerProject('agent-sessions-validation-route');
  const create = await app.request('/workflow-runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectName: project.name,
      type: 'feature',
      title: 'validate agent session finish',
    }),
  });
  const run = (await create.json()) as WorkflowRun;

  const missing = await app.request('/runner/events/agent-session-finished', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'ags_missing',
      status: 'failed',
    }),
  });
  expect(missing.status).toBe(404);

  const taskA = await app.request('/runner/events/agent-task-started', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowRunId: run.id,
      stepRunId: null,
      kind: 'implementation',
      backend: 'codex',
      prompt: 'implement A',
      inputArtifactIds: [],
    }),
  });
  const taskABody = (await taskA.json()) as { task: { id: string } };
  const taskB = await app.request('/runner/events/agent-task-started', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowRunId: run.id,
      stepRunId: null,
      kind: 'implementation',
      backend: 'codex',
      prompt: 'implement B',
      inputArtifactIds: [],
    }),
  });
  const taskBBody = (await taskB.json()) as { task: { id: string } };
  const started = await app.request('/runner/events/agent-session-started', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowRunId: run.id,
      agentTaskId: taskABody.task.id,
      stage: 'implementation',
      skillId: 'skill.implementation',
      skillVersion: '1.0.0',
      contextPackId: 'ctx_validate',
    }),
  });
  const startedBody = (await started.json()) as { session: { id: string } };
  const resultB = await app.request('/runner/events/agent-task-finished', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      taskId: taskBBody.task.id,
      status: 'success',
      summary: 'done',
      outputArtifactIds: [],
    }),
  });
  const resultBBody = (await resultB.json()) as { result: { id: string } };

  const running = await app.request('/runner/events/agent-session-finished', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId: startedBody.session.id,
      status: 'running',
    }),
  });
  expect(running.status).toBe(400);

  const mismatch = await app.request('/runner/events/agent-session-finished', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId: startedBody.session.id,
      status: 'success',
      agentResultId: resultBBody.result.id,
    }),
  });
  expect(mismatch.status).toBe(400);
});

test('POST /workflow-runs without flowId ignores accepted-design startStage skips', async () => {
  const project = registerProject('route-knowledge-skip-default');
  storeMod.store.knowledgeArtifacts.insert(
    fakeKnowledgeArtifact({
      projectId: project.id,
      kind: 'design',
      entityId: 'DSN-login-captcha-switch',
      metadata: { title: 'login captcha switch design' },
    }),
  );

  const res = await app.request('/workflow-runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectName: project.name,
      type: 'feature',
      title: 'implement login captcha switch from accepted design knowledge',
    }),
  });

  expect(res.status).toBe(201);
  const run = (await res.json()) as WorkflowRun;
  expect(run.flowId).toBe('feature.standard');
  expect(run.startStage).toBeNull();

  const created = storeMod.store.auditLog
    .byWorkflow(run.id)
    .find((entry) => entry.kind === 'workflow_run.created');
  const rec = created!.payload.routerRecommendation as
    | { flowId: string; startStage: string | null; rulesFired: string[] }
    | undefined;
  expect(rec).toBeDefined();
  expect(rec!.startStage).toBe('implementation');
  expect(rec!.rulesFired).toContain('startStage.has_accepted_design');
});

test('POST /workflow-runs honors body.flowId = feature.fastforward (W2-3 AC-9)', async () => {
  const project = registerProject('ff-route-explicit');

  const res = await app.request('/workflow-runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectName: project.name,
      type: 'feature',
      title: 'fastforward via body',
      flowId: 'feature.fastforward',
    }),
  });

  expect(res.status).toBe(201);
  const run = (await res.json()) as WorkflowRun;
  expect(run.flowId).toBe('feature.fastforward');

  // Persistence sanity: the row in workflow_runs.flow_id matches.
  const reloaded = storeMod.store.workflowRuns.get(run.id);
  expect(reloaded?.flowId).toBe('feature.fastforward');
});

test('POST /workflow-runs honors body.flowId = feature.standard (explicit form of default)', async () => {
  const project = registerProject('ff-route-explicit-standard');

  const res = await app.request('/workflow-runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectName: project.name,
      type: 'feature',
      title: 'standard via body',
      flowId: 'feature.standard',
    }),
  });

  expect(res.status).toBe(201);
  const run = (await res.json()) as WorkflowRun;
  expect(run.flowId).toBe('feature.standard');
});

test('POST /workflow-runs honors body.flowId = issue.standard (W2-2a AC-20)', async () => {
  const project = registerProject('issue-route-explicit');

  const res = await app.request('/workflow-runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectName: project.name,
      type: 'bugfix',
      title: 'issue via body',
      flowId: 'issue.standard',
    }),
  });

  expect(res.status).toBe(201);
  const run = (await res.json()) as WorkflowRun;
  expect(run.flowId).toBe('issue.standard');
  // PRD ADR Q2: FlowDef.kind='bugfix' but type plumbed from body.type;
  // route doesn't enforce type↔flow correspondence (W2-4 router will).
  expect(run.type).toBe('bugfix');

  // Persistence sanity: the row in workflow_runs.flow_id matches.
  const reloaded = storeMod.store.workflowRuns.get(run.id);
  expect(reloaded?.flowId).toBe('issue.standard');
});

test('POST /workflow-runs honors body.flowId = refactor.standard (W2-2b AC-18)', async () => {
  const project = registerProject('refactor-route-explicit');

  const res = await app.request('/workflow-runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectName: project.name,
      type: 'refactor',
      title: 'refactor via body',
      flowId: 'refactor.standard',
    }),
  });

  expect(res.status).toBe(201);
  const run = (await res.json()) as WorkflowRun;
  expect(run.flowId).toBe('refactor.standard');
  // PRD ADR Q2=A: WorkflowRunType extended; FlowDef.kind='refactor' matches
  // body.type='refactor' (clean naming, unlike W2-2a's 'bugfix' asymmetry).
  expect(run.type).toBe('refactor');

  // Persistence sanity: the row in workflow_runs.flow_id matches.
  const reloaded = storeMod.store.workflowRuns.get(run.id);
  expect(reloaded?.flowId).toBe('refactor.standard');
});

test('POST /workflow-runs rejects an unknown flowId with 400 (trust-boundary validation)', async () => {
  const project = registerProject('ff-route-bogus');

  const res = await app.request('/workflow-runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectName: project.name,
      type: 'feature',
      title: 'should reject',
      flowId: 'feature.bogus',
    }),
  });

  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: string };
  expect(body.error).toContain('feature.bogus');
  expect(body.error).toContain('feature.standard');
  expect(body.error).toContain('feature.fastforward');
  expect(body.error).toContain('issue.standard');
  expect(body.error).toContain('refactor.standard');
});

function fakeKnowledgeArtifact(args: {
  projectId: string;
  kind: KnowledgeArtifact['kind'];
  entityId: string;
  status?: KnowledgeArtifact['status'];
  metadata?: Record<string, unknown>;
}): KnowledgeArtifact {
  return {
    id: newId('kart'),
    kind: args.kind,
    uri: `mem://${args.entityId}.md`,
    projectId: args.projectId,
    size: 1,
    contentType: 'text/markdown',
    status: args.status ?? 'accepted',
    version: 1,
    entityId: args.entityId,
    derivedFromArtifactId: null,
    subtype: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    metadata: args.metadata ?? {},
  };
}

// ---------------------------------------------------------------------------
// V2 W2-4 / PR4 — body.startStage plumbing for direct UI override path.
// ---------------------------------------------------------------------------

test('POST /workflow-runs honors body.startStage = design (W2-4 PR4)', async () => {
  const project = registerProject('startstage-design');

  const res = await app.request('/workflow-runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectName: project.name,
      type: 'feature',
      title: 'manual override starting at design stage with a longer description here',
      flowId: 'feature.standard',
      startStage: 'design',
    }),
  });

  expect(res.status).toBe(201);
  const run = (await res.json()) as WorkflowRun;
  expect(run.flowId).toBe('feature.standard');
  expect(run.startStage).toBe('design');
});

test('POST /workflow-runs rejects an unknown startStage with 400', async () => {
  const project = registerProject('startstage-bogus');

  const res = await app.request('/workflow-runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectName: project.name,
      type: 'feature',
      title: 'should reject unknown stage',
      flowId: 'feature.standard',
      startStage: 'fictional_stage',
    }),
  });

  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: string };
  expect(body.error).toContain('fictional_stage');
});
