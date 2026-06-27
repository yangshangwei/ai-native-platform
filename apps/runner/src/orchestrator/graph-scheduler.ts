import type {
  GraphDefinition,
  GraphEdgeDefinition,
  GraphEvent,
  GraphNodeDefinition,
  GraphNodeRun,
  GraphRun,
} from '@ainp/shared';

const TERMINAL_SUCCESS = new Set<GraphNodeRun['status']>(['passed']);
const TERMINAL_BLOCKING = new Set<GraphNodeRun['status']>([
  'failed',
  'blocked',
  'skipped',
  'cancelled',
]);
const ACTIVE = new Set<GraphNodeRun['status']>(['pending', 'ready', 'running']);

export interface ComputeRunnableGraphNodesInput {
  graph: GraphDefinition;
  graphRun?: GraphRun | null;
  nodeRuns: readonly GraphNodeRun[];
  /**
   * Optional dispatch window. Used for startStage/retry compatibility: the
   * graph snapshot remains full, while scheduling considers only this slice.
   */
  allowedNodeIds?: readonly string[];
  /**
   * When true, dependencies from nodes outside allowedNodeIds are treated as
   * intentionally skipped by the dispatch window.
   */
  ignoreExternalIncoming?: boolean;
  events?: readonly GraphEvent[];
}

export function computeRunnableGraphNodes(
  input: ComputeRunnableGraphNodesInput,
): GraphNodeDefinition[] {
  if (input.graphRun) assertGraphRunMatchesDefinition(input.graph, input.graphRun);

  const nodesById = new Map(input.graph.nodes.map((node) => [node.id, node]));
  const allowed = input.allowedNodeIds
    ? new Set(input.allowedNodeIds)
    : new Set(input.graph.nodes.map((node) => node.id));

  for (const id of allowed) {
    if (!nodesById.has(id)) throw new Error(`allowed graph node not found: ${id}`);
  }

  const latestRuns = latestNodeRunsByNode(input.nodeRuns);
  const incoming = incomingDependencies(input.graph, allowed, input.ignoreExternalIncoming ?? false);
  const events = input.events ?? [];

  return input.graph.nodes.filter((node) => {
    if (!allowed.has(node.id)) return false;
    const latest = latestRuns.get(node.id);
    if (latest?.status === 'ready') return true;
    if (latest && (TERMINAL_SUCCESS.has(latest.status) || TERMINAL_BLOCKING.has(latest.status) || ACTIVE.has(latest.status))) {
      return false;
    }
    const upstream = incoming.get(node.id) ?? [];
    return upstream.every((edge) => edgeSatisfied(edge, upstream, latestRuns, events));
  });
}

export function nextRunnableGraphNode(
  input: ComputeRunnableGraphNodesInput,
): GraphNodeDefinition | null {
  return computeRunnableGraphNodes(input)[0] ?? null;
}

export function assertGraphRunMatchesDefinition(graph: GraphDefinition, graphRun: GraphRun): void {
  if (graphRun.graphDefinitionId !== graph.id) {
    throw new Error(
      `graph definition mismatch: ${graphRun.graphDefinitionId} !== ${graph.id}`,
    );
  }
  if (graphRun.graphVersion !== graph.version) {
    throw new Error(`graph version mismatch: ${graphRun.graphVersion} !== ${graph.version}`);
  }
}

export function latestNodeRunsByNode(
  nodeRuns: readonly GraphNodeRun[],
): Map<string, GraphNodeRun> {
  const latest = new Map<string, GraphNodeRun>();
  for (const run of nodeRuns) {
    const existing = latest.get(run.nodeId);
    if (!existing || run.attempt > existing.attempt) latest.set(run.nodeId, run);
  }
  return latest;
}

function incomingDependencies(
  graph: GraphDefinition,
  allowed: Set<string>,
  ignoreExternalIncoming: boolean,
): Map<string, GraphEdgeDefinition[]> {
  const nodesById = new Set(graph.nodes.map((node) => node.id));
  const incoming = new Map<string, GraphEdgeDefinition[]>();
  for (const node of graph.nodes) incoming.set(node.id, []);
  for (const edge of graph.edges) {
    if (!nodesById.has(edge.fromNodeId) || !nodesById.has(edge.toNodeId)) {
      throw new Error(`graph edge references unknown node: ${edge.id}`);
    }
    if (!allowed.has(edge.toNodeId)) continue;
    if (!allowed.has(edge.fromNodeId)) {
      if (ignoreExternalIncoming) continue;
      incoming.set(edge.toNodeId, [...(incoming.get(edge.toNodeId) ?? []), edge]);
      continue;
    }
    incoming.set(edge.toNodeId, [...(incoming.get(edge.toNodeId) ?? []), edge]);
  }
  return incoming;
}

function edgeSatisfied(
  edge: GraphEdgeDefinition,
  targetIncomingEdges: readonly GraphEdgeDefinition[],
  latestRuns: ReadonlyMap<string, GraphNodeRun>,
  events: readonly GraphEvent[],
): boolean {
  const fromStatus = latestRuns.get(edge.fromNodeId)?.status;
  switch (edge.mode) {
    case 'all_success':
      return fromStatus === 'passed';
    case 'any_success':
      return targetIncomingEdges.some((candidate) =>
        candidate.mode === 'any_success'
        && latestRuns.get(candidate.fromNodeId)?.status === 'passed',
      );
    case 'always':
      return fromStatus !== undefined && isTerminalStatus(fromStatus);
    case 'manual':
      return manualEdgeReleased(edge, events);
    default: {
      const _exhaustive: never = edge.mode;
      throw new Error(`unknown graph edge mode: ${String(_exhaustive)}`);
    }
  }
}

function isTerminalStatus(status: GraphNodeRun['status']): boolean {
  return TERMINAL_SUCCESS.has(status) || TERMINAL_BLOCKING.has(status);
}

function manualEdgeReleased(edge: GraphEdgeDefinition, events: readonly GraphEvent[]): boolean {
  return events.some((event) => {
    const { payload } = event;
    if (payload.edgeId === edge.id && (payload.released === true || payload.action === 'edge_released')) {
      return true;
    }
    return Array.isArray(payload.edgeIds)
      && payload.edgeIds.includes(edge.id)
      && (payload.released === true || payload.action === 'edge_released');
  });
}
