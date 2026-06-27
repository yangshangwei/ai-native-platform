import type {
  GraphDefinition,
  GraphNodeRun,
  GraphRun,
  WorkflowRunId,
  WorkflowStage,
} from '@ainp/shared';
import { newId, nowIso } from '@ainp/shared';
import { audit } from './audit';
import { store } from './store/store';

const RESUMABLE_NODE_STATUSES = new Set<GraphNodeRun['status']>([
  'failed',
  'cancelled',
  'blocked',
]);

export interface ResumeGraphNodeParams {
  workflowRunId: WorkflowRunId;
  nodeRunId: string;
  graphVersion?: string;
  resumeCursor?: string | null;
  actor: string;
}

export interface ResumeGraphNodeResult {
  graphDefinition: GraphDefinition;
  graphRun: GraphRun;
  previousNodeRun: GraphNodeRun;
  nodeRun: GraphNodeRun;
}

export function resumeGraphNode(params: ResumeGraphNodeParams): ResumeGraphNodeResult {
  const previousNodeRun = store.graphNodeRuns.get(params.nodeRunId);
  if (!previousNodeRun) throw new Error(`graph node run not found: ${params.nodeRunId}`);
  if (previousNodeRun.workflowRunId !== params.workflowRunId) {
    throw new Error('nodeRunId does not belong to workflowRunId');
  }

  const graphRun = store.graphRuns.get(previousNodeRun.graphRunId);
  if (!graphRun) throw new Error(`graph run not found: ${previousNodeRun.graphRunId}`);
  if (graphRun.workflowRunId !== params.workflowRunId) {
    throw new Error('graphRunId does not belong to workflowRunId');
  }
  const graphDefinition = store.graphDefinitions.get(graphRun.graphDefinitionId);
  if (!graphDefinition) throw new Error(`graph definition not found: ${graphRun.graphDefinitionId}`);
  if (params.graphVersion !== undefined && params.graphVersion !== graphRun.graphVersion) {
    throw new Error(`graph version mismatch: ${params.graphVersion} !== ${graphRun.graphVersion}`);
  }
  if (graphDefinition.version !== graphRun.graphVersion) {
    throw new Error(`graph definition version mismatch: ${graphDefinition.version} !== ${graphRun.graphVersion}`);
  }
  if (!graphDefinition.nodes.some((node) => node.id === previousNodeRun.nodeId)) {
    throw new Error(`nodeId does not belong to graphDefinition: ${previousNodeRun.nodeId}`);
  }
  if (previousNodeRun.status === 'passed') {
    throw new Error('cannot resume completed graph node without explicit evidence reuse');
  }
  if (!RESUMABLE_NODE_STATUSES.has(previousNodeRun.status)) {
    throw new Error(`cannot resume graph node with status ${previousNodeRun.status}`);
  }
  if (!previousNodeRun.stepCheckpointId) {
    throw new Error('cannot resume graph node without a StepCheckpoint');
  }
  const checkpoint = store.stepCheckpoints.get(previousNodeRun.stepCheckpointId);
  if (!checkpoint) throw new Error(`step checkpoint not found: ${previousNodeRun.stepCheckpointId}`);
  if (checkpoint.workflowRunId !== params.workflowRunId) {
    throw new Error('stepCheckpointId does not belong to workflowRunId');
  }
  if (previousNodeRun.stepRunId && checkpoint.stepRunId !== previousNodeRun.stepRunId) {
    throw new Error('stepCheckpointId does not belong to stepRunId');
  }
  const expectedCursor = previousNodeRun.resumeCursor ?? checkpoint.resumeCursor;
  if (params.resumeCursor !== undefined && params.resumeCursor !== expectedCursor) {
    throw new Error('invalid resume cursor');
  }

  const attempt = store.graphNodeRuns.byNode(graphRun.id, previousNodeRun.nodeId).length + 1;
  const ts = nowIso();
  const nodeRun: GraphNodeRun = {
    id: newId('gnr'),
    graphRunId: graphRun.id,
    workflowRunId: params.workflowRunId,
    nodeId: previousNodeRun.nodeId,
    attempt,
    status: 'ready',
    stepRunId: null,
    stepCheckpointId: null,
    resumeCursor: expectedCursor,
    idempotencyKey: `${graphRun.id}:${previousNodeRun.nodeId}:${attempt}:resume`,
    dependencyState: previousNodeRun.dependencyState,
    startedAt: null,
    completedAt: null,
    metadata: {
      resumeOfNodeRunId: previousNodeRun.id,
      sourceCheckpointId: checkpoint.id,
      actor: params.actor,
    },
  };
  const updatedGraphRun: GraphRun = {
    ...graphRun,
    status: 'running',
    activeNodeIds: [...new Set([...graphRun.activeNodeIds, previousNodeRun.nodeId])],
    updatedAt: ts,
  };
  store.graphNodeRuns.upsert(nodeRun);
  store.graphRuns.upsert(updatedGraphRun);
  store.graphEvents.insert({
    id: newId('gevt'),
    graphRunId: graphRun.id,
    workflowRunId: params.workflowRunId,
    nodeId: previousNodeRun.nodeId,
    type: 'resume_requested',
    createdAt: ts,
    payload: {
      previousNodeRunId: previousNodeRun.id,
      nodeRunId: nodeRun.id,
      sourceCheckpointId: checkpoint.id,
      actor: params.actor,
    },
  });
  audit(params.workflowRunId, 'graph_node.resume_requested', {
    previousNodeRunId: previousNodeRun.id,
    nodeRunId: nodeRun.id,
    nodeId: nodeRun.nodeId,
    actor: params.actor,
  });
  return {
    graphDefinition,
    graphRun: updatedGraphRun,
    previousNodeRun,
    nodeRun,
  };
}

export function resumeGraphStage(params: {
  workflowRunId: WorkflowRunId;
  stage: WorkflowStage;
  actor: string;
}): ResumeGraphNodeResult | null {
  const graph = store.graphRuntime.byWorkflow(params.workflowRunId);
  if (!graph.graphRun || !graph.graphDefinition) return null;
  const node = graph.graphDefinition.nodes.find((candidate) => candidate.stage === params.stage);
  if (!node) return null;
  const latest = graph.nodeRuns
    .filter((candidate) => candidate.nodeId === node.id)
    .sort((a, b) => a.attempt - b.attempt)
    .at(-1);
  if (!latest) return null;
  return resumeGraphNode({
    workflowRunId: params.workflowRunId,
    nodeRunId: latest.id,
    graphVersion: graph.graphRun.graphVersion,
    resumeCursor: latest.resumeCursor,
    actor: params.actor,
  });
}
