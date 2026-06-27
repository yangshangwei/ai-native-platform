import {
  GRAPH_RUNTIME_SCHEMA_VERSION,
  type GraphDefinition,
  type GraphEdgeDefinition,
  type GraphEdgeMode,
  type GraphNodeDefinition,
} from '../types/graph-runtime';
import type { StageStepKind, WorkflowStage } from '../types/workflow';

const DEFAULT_GRAPH_CREATED_AT = '1970-01-01T00:00:00.000Z';

export interface BranchFanOutGraphOptions {
  version?: string;
  createdAt?: string;
  edgeMode?: GraphEdgeMode;
}

export function branchFanOutGraphDefinition(
  options: BranchFanOutGraphOptions = {},
): GraphDefinition {
  const version = options.version ?? '1';
  const edgeMode = options.edgeMode ?? 'all_success';
  const nodes = [
    graphFixtureNode(0, 'implementation', 'agent', 'cs-feat-impl'),
    graphFixtureNode(1, 'build_test', 'engine', null),
    graphFixtureNode(2, 'review', 'agent', 'cs-feat-accept'),
  ];
  const [source, buildTest, review] = nodes;
  if (!source || !buildTest || !review) throw new Error('branch fan-out graph is incomplete');
  const edges: GraphEdgeDefinition[] = [
    graphFixtureEdge(0, source.id, buildTest.id, edgeMode),
    graphFixtureEdge(1, source.id, review.id, edgeMode),
  ];
  return {
    id: `graph:fixture.branch-fanout:${version}`,
    schemaVersion: GRAPH_RUNTIME_SCHEMA_VERSION,
    version,
    sourceFlowId: null,
    description: 'Deterministic branch fan-out graph fixture',
    nodes,
    edges,
    entryNodeIds: [source.id],
    createdAt: options.createdAt ?? DEFAULT_GRAPH_CREATED_AT,
    metadata: {
      fixture: 'branch_fanout',
      linear: false,
    },
  };
}

function graphFixtureNode(
  index: number,
  stage: WorkflowStage,
  kind: StageStepKind,
  skillId: string | null,
): GraphNodeDefinition {
  return {
    id: `node:fixture.branch-fanout:${index}:${stage}`,
    stage,
    kind,
    skillId,
    label: stage,
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
      fixture: 'branch_fanout',
      stageIndex: index,
    },
  };
}

function graphFixtureEdge(
  index: number,
  fromNodeId: string,
  toNodeId: string,
  mode: GraphEdgeMode,
): GraphEdgeDefinition {
  return {
    id: `edge:fixture.branch-fanout:${index}:${fromNodeId}->${toNodeId}`,
    fromNodeId,
    toNodeId,
    mode,
    condition: null,
    metadata: {
      fixture: 'branch_fanout',
    },
  };
}
