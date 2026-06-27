import { describe, expect, test } from 'vitest';
import {
  FLOW_REGISTRY,
  branchFanOutGraphDefinition,
  flowToGraphDefinition,
  type GraphDefinition,
  type GraphNodeRun,
  type GraphRun,
} from '@ainp/shared';
import {
  computeRunnableGraphNodes,
  nextRunnableGraphNode,
} from '../src/orchestrator/graph-scheduler';

const graph = flowToGraphDefinition(FLOW_REGISTRY['feature.fastforward']);

function graphRun(version = graph.version): GraphRun {
  return {
    id: 'grun_scheduler',
    workflowRunId: 'run_scheduler',
    graphDefinitionId: graph.id,
    graphVersion: version,
    status: 'running',
    activeNodeIds: [],
    interruptedReason: null,
    createdAt: '2026-06-27T00:00:00.000Z',
    updatedAt: '2026-06-27T00:00:00.000Z',
    metadata: {},
  };
}

function nodeRun(nodeId: string, status: GraphNodeRun['status'], attempt = 1): GraphNodeRun {
  return {
    id: `gnr_${attempt}_${nodeId.replaceAll(':', '_')}`,
    graphRunId: 'grun_scheduler',
    workflowRunId: 'run_scheduler',
    nodeId,
    attempt,
    status,
    stepRunId: null,
    stepCheckpointId: null,
    resumeCursor: null,
    idempotencyKey: `grun_scheduler:${nodeId}:${attempt}`,
    dependencyState: {
      upstreamNodeIds: [],
      satisfiedNodeIds: [],
      blockedNodeIds: [],
    },
    startedAt: null,
    completedAt: null,
    metadata: {},
  };
}

describe('linear graph scheduler', () => {
  test('returns one runnable node at a time for a linear flow', () => {
    expect(nextRunnableGraphNode({ graph, graphRun: graphRun(), nodeRuns: [] })?.stage)
      .toBe('implementation');

    const implementation = graph.nodes[0]!;
    expect(nextRunnableGraphNode({
      graph,
      graphRun: graphRun(),
      nodeRuns: [nodeRun(implementation.id, 'passed')],
    })?.stage).toBe('build_test');
  });

  test('does not run a node whose predecessor has not completed', () => {
    const buildTest = graph.nodes[1]!;

    expect(computeRunnableGraphNodes({
      graph,
      graphRun: graphRun(),
      nodeRuns: [],
      allowedNodeIds: [buildTest.id],
    })).toEqual([]);
  });

  test('treats a start-stage slice as the dispatchable subgraph', () => {
    const buildTest = graph.nodes[1]!;
    const review = graph.nodes[2]!;

    expect(computeRunnableGraphNodes({
      graph,
      graphRun: graphRun(),
      nodeRuns: [],
      allowedNodeIds: [buildTest.id, review.id],
      ignoreExternalIncoming: true,
    }).map((node) => node.stage)).toEqual(['build_test']);
  });

  test('returns a ready resume attempt as runnable', () => {
    const implementation = graph.nodes[0]!;

    expect(nextRunnableGraphNode({
      graph,
      graphRun: graphRun(),
      nodeRuns: [nodeRun(implementation.id, 'ready', 2)],
    })?.id).toBe(implementation.id);
  });

  test('rejects graph version mismatch before scheduling', () => {
    expect(() =>
      computeRunnableGraphNodes({
        graph,
        graphRun: graphRun('stale-version'),
        nodeRuns: [],
      }),
    ).toThrow(/graph version mismatch/);
  });
});

describe('branch graph scheduler', () => {
  test('returns every ready fan-out branch in graph node order', () => {
    const fanOut = branchFanOutGraphDefinition();
    const source = fanOut.nodes[0]!;

    expect(computeRunnableGraphNodes({
      graph: fanOut,
      nodeRuns: [nodeRun(source.id, 'passed')],
    }).map((node) => node.stage)).toEqual(['build_test', 'review']);
  });

  test('releases always edges after the predecessor reaches a terminal status', () => {
    const fanOut = branchFanOutGraphDefinition({ edgeMode: 'always' });
    const source = fanOut.nodes[0]!;

    expect(computeRunnableGraphNodes({
      graph: fanOut,
      nodeRuns: [nodeRun(source.id, 'failed')],
    }).map((node) => node.stage)).toEqual(['build_test', 'review']);
  });

  test('keeps manual edges blocked without an explicit release event', () => {
    const fanOut = branchFanOutGraphDefinition({ edgeMode: 'manual' });
    const source = fanOut.nodes[0]!;

    expect(computeRunnableGraphNodes({
      graph: fanOut,
      nodeRuns: [nodeRun(source.id, 'passed')],
    })).toEqual([]);
  });

  test('satisfies any_success when one sibling edge into the target passes', () => {
    const fanOut = branchFanOutGraphDefinition();
    const graph: GraphDefinition = {
      ...fanOut,
      nodes: [
        ...fanOut.nodes,
        {
          ...fanOut.nodes[0]!,
          id: 'node:fixture.branch-fanout:3:completion',
          stage: 'completion',
          kind: 'engine',
          skillId: null,
          label: 'completion',
          metadata: { fixture: 'branch_fanout', stageIndex: 3 },
        },
      ],
      edges: [
        ...fanOut.edges,
        {
          id: `edge:any:${fanOut.nodes[1]!.id}->completion`,
          fromNodeId: fanOut.nodes[1]!.id,
          toNodeId: 'node:fixture.branch-fanout:3:completion',
          mode: 'any_success',
          condition: null,
          metadata: {},
        },
        {
          id: `edge:any:${fanOut.nodes[2]!.id}->completion`,
          fromNodeId: fanOut.nodes[2]!.id,
          toNodeId: 'node:fixture.branch-fanout:3:completion',
          mode: 'any_success',
          condition: null,
          metadata: {},
        },
      ],
    };

    expect(computeRunnableGraphNodes({
      graph,
      nodeRuns: [
        nodeRun(fanOut.nodes[0]!.id, 'passed'),
        nodeRun(fanOut.nodes[1]!.id, 'passed'),
      ],
    }).map((node) => node.stage)).toEqual(['review', 'completion']);
  });
});
