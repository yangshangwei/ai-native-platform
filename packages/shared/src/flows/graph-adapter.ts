import type { FlowDef, WorkflowStage } from '../types/workflow';
import {
  GRAPH_RUNTIME_SCHEMA_VERSION,
  type GraphDefinition,
  type GraphEdgeDefinition,
  type GraphNodeDefinition,
} from '../types/graph-runtime';

const DEFAULT_GRAPH_CREATED_AT = '1970-01-01T00:00:00.000Z';

export interface FlowGraphOptions {
  version?: string;
  createdAt?: string;
}

export function flowToGraphDefinition(
  flow: FlowDef,
  options: FlowGraphOptions = {},
): GraphDefinition {
  const version = options.version ?? '1';
  const nodes = flow.stages.map((step, index): GraphNodeDefinition => ({
    id: graphNodeId(flow.id, index, step.stage),
    stage: step.stage,
    kind: step.kind,
    skillId: step.skillId ?? null,
    label: step.stage,
    inputSelectors: [],
    outputNames: [],
    retryPolicy: {
      maxAttempts: 1,
      backoff: 'none',
    },
    resumePolicy: 'new_attempt',
    failurePolicy: 'fail_fast',
    joinPolicy: 'none',
    metadata: {
      sourceFlowId: flow.id,
      stageIndex: index,
    },
  }));
  const edges: GraphEdgeDefinition[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const from = nodes[i];
    const to = nodes[i + 1];
    if (!from || !to) {
      throw new Error(`cannot build graph edge for flow ${flow.id} at index ${i}`);
    }
    edges.push({
      id: graphEdgeId(flow.id, i, from.id, to.id),
      fromNodeId: from.id,
      toNodeId: to.id,
      mode: 'all_success',
      condition: null,
      metadata: {
        sourceFlowId: flow.id,
        fromStageIndex: i,
        toStageIndex: i + 1,
      },
    });
  }
  return {
    id: `graph:${flow.id}:${version}`,
    schemaVersion: GRAPH_RUNTIME_SCHEMA_VERSION,
    version,
    sourceFlowId: flow.id,
    description: flow.description,
    nodes,
    edges,
    entryNodeIds: nodes[0] ? [nodes[0].id] : [],
    createdAt: options.createdAt ?? DEFAULT_GRAPH_CREATED_AT,
    metadata: {
      kind: flow.kind,
      generatedFrom: 'FLOW_REGISTRY',
      linear: true,
    },
  };
}

export function graphStageOrder(graph: GraphDefinition): WorkflowStage[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, string[]>();
  const incomingCount = new Map<string, number>();
  for (const node of graph.nodes) incomingCount.set(node.id, 0);
  for (const edge of graph.edges) {
    if (!byId.has(edge.fromNodeId) || !byId.has(edge.toNodeId)) {
      throw new Error(`graph edge references unknown node: ${edge.id}`);
    }
    outgoing.set(edge.fromNodeId, [...(outgoing.get(edge.fromNodeId) ?? []), edge.toNodeId]);
    incomingCount.set(edge.toNodeId, (incomingCount.get(edge.toNodeId) ?? 0) + 1);
  }
  const queue = graph.nodes
    .filter((node) => (incomingCount.get(node.id) ?? 0) === 0)
    .map((node) => node.id);
  const order: WorkflowStage[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = byId.get(id);
    if (!node) throw new Error(`graph node not found: ${id}`);
    order.push(node.stage);
    for (const next of outgoing.get(id) ?? []) {
      const remaining = (incomingCount.get(next) ?? 0) - 1;
      incomingCount.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }
  if (order.length !== graph.nodes.length) {
    throw new Error('graph contains a cycle or disconnected dependency state');
  }
  return order;
}

export function assertGraphMatchesFlowOrder(graph: GraphDefinition, flow: FlowDef): void {
  const graphStages = graphStageOrder(graph);
  const flowStages = flow.stages.map((step) => step.stage);
  if (graphStages.length !== flowStages.length) {
    throw new Error(`graph stage count mismatch for flow ${flow.id}`);
  }
  for (let i = 0; i < flowStages.length; i++) {
    if (graphStages[i] !== flowStages[i]) {
      throw new Error(
        `graph stage order mismatch for flow ${flow.id} at index ${i}: ${graphStages[i]} !== ${flowStages[i]}`,
      );
    }
  }
}

function graphNodeId(flowId: string, index: number, stage: string): string {
  return `node:${flowId}:${index}:${stage}`;
}

function graphEdgeId(flowId: string, index: number, fromNodeId: string, toNodeId: string): string {
  return `edge:${flowId}:${index}:${fromNodeId}->${toNodeId}`;
}
