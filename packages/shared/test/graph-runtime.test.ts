import { expect, test } from 'vitest';
import {
  GRAPH_RUNTIME_SCHEMA_VERSION,
  GRAPH_JOIN_POLICIES,
  GRAPH_NODE_STATUSES,
  isGraphFailurePolicy,
  isGraphJoinPolicy,
  isGraphNodeStatus,
  isGraphResumePolicy,
  isGraphRuntimeSchemaVersion,
  type GraphDefinition,
  type GraphNodeRun,
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
