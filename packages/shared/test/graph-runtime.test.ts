import { expect, test } from 'vitest';
import {
  GRAPH_RUNTIME_SCHEMA_VERSION,
  GRAPH_JOIN_POLICIES,
  GRAPH_NODE_STATUSES,
  deriveGraphRunStatus,
  isGraphFailurePolicy,
  isGraphJoinPolicy,
  isGraphNodeStatus,
  isGraphResumePolicy,
  isGraphRuntimeSchemaVersion,
  type GraphDefinition,
  type GraphNodeRun,
  type GraphNodeStatus,
} from '../src';

test('Graph Runtime shared contract enumerates node state and policies', () => {
  expect(GRAPH_NODE_STATUSES).toContain('ready');
  expect(GRAPH_NODE_STATUSES).toContain('blocked');
  expect(GRAPH_JOIN_POLICIES).toContain('all_of');
  expect(GRAPH_JOIN_POLICIES).toContain('manual_adopt');
  expect(isGraphNodeStatus('running')).toBe(true);
  expect(isGraphNodeStatus('complete')).toBe(false);
  expect(isGraphJoinPolicy('first_success')).toBe(true);
  expect(isGraphJoinPolicy('race')).toBe(false);
  expect(isGraphResumePolicy('new_attempt')).toBe(true);
  expect(isGraphResumePolicy('silent_rerun')).toBe(false);
  expect(isGraphFailurePolicy('fail_fast')).toBe(true);
  expect(isGraphFailurePolicy('ignore')).toBe(false);
  expect(isGraphRuntimeSchemaVersion(GRAPH_RUNTIME_SCHEMA_VERSION)).toBe(true);
  expect(isGraphRuntimeSchemaVersion('ainp.graph_runtime.v0')).toBe(false);
});

test('GraphDefinition shape preserves workflow authority boundaries', () => {
  const graph: GraphDefinition = {
    id: 'graph:feature.standard:1',
    schemaVersion: GRAPH_RUNTIME_SCHEMA_VERSION,
    version: '1',
    sourceFlowId: 'feature.standard',
    description: 'Linear feature graph',
    nodes: [{
      id: 'node:feature.standard:0:implementation',
      stage: 'implementation',
      kind: 'agent',
      skillId: 'cs-feat-impl',
      label: 'implementation',
      inputSelectors: [],
      outputNames: ['diff'],
      retryPolicy: { maxAttempts: 2, backoff: 'none' },
      resumePolicy: 'new_attempt',
      failurePolicy: 'fail_fast',
      joinPolicy: 'none',
      metadata: { source: 'test' },
    }],
    edges: [],
    entryNodeIds: ['node:feature.standard:0:implementation'],
    createdAt: '2026-06-27T00:00:00.000Z',
    metadata: { linear: true },
  };

  expect(graph.nodes[0].resumePolicy).toBe('new_attempt');
  expect(graph.nodes[0].failurePolicy).toBe('fail_fast');
});

test('GraphNodeRun links node attempts to StepCheckpoint evidence', () => {
  const nodeRun: GraphNodeRun = {
    id: 'gnr_1',
    graphRunId: 'grun_1',
    workflowRunId: 'run_1',
    nodeId: 'node:feature.standard:3:implementation',
    attempt: 2,
    status: 'failed',
    stepRunId: 'step_1',
    stepCheckpointId: 'scp_1',
    resumeCursor: 'node:feature.standard:3:implementation@attempt=2',
    idempotencyKey: 'run_1:node:feature.standard:3:implementation:attempt:2',
    dependencyState: {
      upstreamNodeIds: ['node:feature.standard:2:design'],
      satisfiedNodeIds: ['node:feature.standard:2:design'],
      blockedNodeIds: [],
    },
    startedAt: '2026-06-27T00:00:00.000Z',
    completedAt: '2026-06-27T00:00:01.000Z',
    metadata: { failureReason: 'diff_scope_gate failed' },
  };

  expect(nodeRun.attempt).toBe(2);
  expect(nodeRun.stepCheckpointId).toBe('scp_1');
  expect(nodeRun.idempotencyKey).toContain('attempt:2');
});

// ---- deriveGraphRunStatus (P0-1 R1) ---------------------------------------

const AGGREGATE_NODES = [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }];

function run(
  nodeId: string,
  status: GraphNodeStatus,
  attempt = 1,
): Pick<GraphNodeRun, 'nodeId' | 'attempt' | 'status'> {
  return { nodeId, attempt, status };
}

test('deriveGraphRunStatus prefers cancelled over every other node state', () => {
  expect(deriveGraphRunStatus({
    nodes: AGGREGATE_NODES,
    nodeRuns: [run('n1', 'passed'), run('n2', 'failed'), run('n3', 'cancelled')],
    currentStatus: 'running',
  })).toBe('cancelled');
});

test('deriveGraphRunStatus reports failed before blocked and active nodes', () => {
  expect(deriveGraphRunStatus({
    nodes: AGGREGATE_NODES,
    nodeRuns: [run('n1', 'passed'), run('n2', 'failed'), run('n3', 'running')],
    currentStatus: 'running',
  })).toBe('failed');
});

test('deriveGraphRunStatus reports blocked before active nodes', () => {
  expect(deriveGraphRunStatus({
    nodes: AGGREGATE_NODES,
    nodeRuns: [run('n1', 'passed'), run('n2', 'blocked'), run('n3', 'pending')],
    currentStatus: 'running',
  })).toBe('blocked');
});

test('deriveGraphRunStatus stays running while any node is active or unstarted', () => {
  expect(deriveGraphRunStatus({
    nodes: AGGREGATE_NODES,
    nodeRuns: [run('n1', 'passed'), run('n2', 'running')],
    currentStatus: 'running',
  })).toBe('running');
  // n3 has no node run at all: the graph is not finished.
  expect(deriveGraphRunStatus({
    nodes: AGGREGATE_NODES,
    nodeRuns: [run('n1', 'passed'), run('n2', 'passed')],
    currentStatus: 'running',
  })).toBe('running');
});

test('deriveGraphRunStatus converges to passed when every node is passed or skipped', () => {
  expect(deriveGraphRunStatus({
    nodes: AGGREGATE_NODES,
    nodeRuns: [run('n1', 'passed'), run('n2', 'skipped'), run('n3', 'passed')],
    currentStatus: 'running',
  })).toBe('passed');
});

test('deriveGraphRunStatus keeps the current status when nothing has run yet', () => {
  expect(deriveGraphRunStatus({
    nodes: AGGREGATE_NODES,
    nodeRuns: [],
    currentStatus: 'pending',
  })).toBe('pending');
});

test('deriveGraphRunStatus does not report a vacuous passed for an empty node set', () => {
  // A node run whose node is absent from the definition cannot be judged: the
  // definition is the denominator, so an empty one has nothing to converge.
  expect(deriveGraphRunStatus({
    nodes: [],
    nodeRuns: [run('n1', 'passed')],
    currentStatus: 'running',
  })).toBe('running');
  // Same guard with a node run that would otherwise have forced `failed`.
  expect(deriveGraphRunStatus({
    nodes: [],
    nodeRuns: [run('n1', 'failed')],
    currentStatus: 'running',
  })).toBe('running');
});

test('deriveGraphRunStatus ignores node runs outside the definition', () => {
  // n4 is not in the definition, so its failure does not enter the aggregate;
  // every defined node passed.
  expect(deriveGraphRunStatus({
    nodes: AGGREGATE_NODES,
    nodeRuns: [run('n1', 'passed'), run('n2', 'passed'), run('n3', 'passed'), run('n4', 'failed')],
    currentStatus: 'running',
  })).toBe('passed');
});

test('deriveGraphRunStatus judges only the latest attempt, so a resume returns to running', () => {
  const nodeRuns = [
    run('n1', 'passed'),
    run('n2', 'failed'),
    run('n3', 'skipped'),
  ];
  expect(deriveGraphRunStatus({ nodes: AGGREGATE_NODES, nodeRuns, currentStatus: 'running' }))
    .toBe('failed');
  // resumeGraphNode() re-opens n2 as a new `ready` attempt.
  expect(deriveGraphRunStatus({
    nodes: AGGREGATE_NODES,
    nodeRuns: [...nodeRuns, run('n2', 'ready', 2)],
    currentStatus: 'failed',
  })).toBe('running');
});
