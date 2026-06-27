import { expect, test } from 'vitest';
import {
  FLOW_REGISTRY,
  assertGraphMatchesFlowOrder,
  branchFanOutGraphDefinition,
  flowToGraphDefinition,
  graphStageOrder,
} from '../src';

test('flowToGraphDefinition converts every registered flow to an equivalent linear graph', () => {
  for (const flow of Object.values(FLOW_REGISTRY)) {
    const graph = flowToGraphDefinition(flow, {
      version: 'test',
      createdAt: '2026-06-27T00:00:00.000Z',
    });

    expect(graph.sourceFlowId).toBe(flow.id);
    expect(graph.nodes.map((node) => node.stage)).toEqual(flow.stages.map((step) => step.stage));
    expect(graph.entryNodeIds).toEqual(flow.stages[0] ? [graph.nodes[0].id] : []);
    expect(graph.edges).toHaveLength(Math.max(0, flow.stages.length - 1));
    expect(graphStageOrder(graph)).toEqual(flow.stages.map((step) => step.stage));
    expect(() => assertGraphMatchesFlowOrder(graph, flow)).not.toThrow();
  }
});

test('flowToGraphDefinition preserves stage dispatch metadata on each node', () => {
  const flow = FLOW_REGISTRY['feature.standard'];
  const graph = flowToGraphDefinition(flow);

  expect(graph.nodes[0]).toMatchObject({
    stage: 'context_pack',
    kind: 'agent',
    skillId: 'context_pack',
    resumePolicy: 'new_attempt',
    failurePolicy: 'fail_fast',
    joinPolicy: 'none',
  });
  expect(graph.nodes.at(-1)).toMatchObject({
    stage: 'knowledge',
    kind: 'engine',
    skillId: null,
  });
});

test('graphStageOrder rejects edges that reference unknown nodes', () => {
  const graph = flowToGraphDefinition(FLOW_REGISTRY['feature.fastforward']);
  graph.edges[0] = {
    ...graph.edges[0],
    toNodeId: 'node:missing',
  };

  expect(() => graphStageOrder(graph)).toThrow('unknown node');
});

test('branchFanOutGraphDefinition creates a deterministic non-linear fixture', () => {
  const graph = branchFanOutGraphDefinition({
    version: 'test',
    createdAt: '2026-06-28T00:00:00.000Z',
  });

  expect(graph.sourceFlowId).toBeNull();
  expect(graph.metadata).toMatchObject({ fixture: 'branch_fanout', linear: false });
  expect(graph.nodes.map((node) => node.stage)).toEqual(['implementation', 'build_test', 'review']);
  expect(graph.entryNodeIds).toEqual([graph.nodes[0]!.id]);
  expect(graph.edges.map((edge) => [edge.fromNodeId, edge.toNodeId, edge.mode])).toEqual([
    [graph.nodes[0]!.id, graph.nodes[1]!.id, 'all_success'],
    [graph.nodes[0]!.id, graph.nodes[2]!.id, 'all_success'],
  ]);
  expect(graphStageOrder(graph)).toEqual(['implementation', 'build_test', 'review']);
});
