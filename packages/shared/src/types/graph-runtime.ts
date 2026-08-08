import type {
  GraphDefinitionId,
  GraphEventId,
  GraphNodeRunId,
  GraphRunId,
  Iso8601,
  StepCheckpointId,
  StepRunId,
  WorkflowRunId,
} from './ids';
import type {
  FlowId,
  StageStepKind,
  WorkflowStage,
} from './workflow';

export const GRAPH_RUNTIME_SCHEMA_VERSION = 'ainp.graph_runtime.v1' as const;

export const GRAPH_NODE_STATUSES = [
  'pending',
  'ready',
  'running',
  'passed',
  'failed',
  'blocked',
  'skipped',
  'cancelled',
] as const;

export type GraphNodeStatus = (typeof GRAPH_NODE_STATUSES)[number];

/**
 * Node lifecycle partition shared by the runner scheduler
 * (`computeRunnableGraphNodes`) and the aggregate status derivation
 * ({@link deriveGraphRunStatus}). Kept here so scheduling and read-model
 * semantics cannot drift apart.
 */
export const GRAPH_NODE_TERMINAL_SUCCESS_STATUSES = [
  'passed',
] as const satisfies readonly GraphNodeStatus[];

export const GRAPH_NODE_TERMINAL_BLOCKING_STATUSES = [
  'failed',
  'blocked',
  'skipped',
  'cancelled',
] as const satisfies readonly GraphNodeStatus[];

export const GRAPH_NODE_ACTIVE_STATUSES = [
  'pending',
  'ready',
  'running',
] as const satisfies readonly GraphNodeStatus[];

/**
 * Node statuses `resumeGraphNode()` accepts. A `passed` node needs explicit
 * evidence reuse, and an active node has nothing to resume from.
 */
export const GRAPH_NODE_RESUMABLE_STATUSES = [
  'failed',
  'blocked',
  'cancelled',
] as const satisfies readonly GraphNodeStatus[];

export const GRAPH_RUN_STATUSES = [
  'pending',
  'running',
  'blocked',
  'passed',
  'failed',
  'cancelled',
] as const;

export type GraphRunStatus = (typeof GRAPH_RUN_STATUSES)[number];

export const GRAPH_EDGE_MODES = [
  'all_success',
  'any_success',
  'always',
  'manual',
] as const;

export type GraphEdgeMode = (typeof GRAPH_EDGE_MODES)[number];

export const GRAPH_JOIN_POLICIES = [
  'none',
  'all_of',
  'any_of',
  'first_success',
  'quorum',
  'manual_adopt',
] as const;

export type GraphJoinPolicy = (typeof GRAPH_JOIN_POLICIES)[number];

export const GRAPH_RESUME_POLICIES = [
  'none',
  'new_attempt',
  'reuse_evidence',
  'manual_only',
] as const;

export type GraphResumePolicy = (typeof GRAPH_RESUME_POLICIES)[number];

export const GRAPH_FAILURE_POLICIES = [
  'fail_fast',
  'continue',
  'skip_dependents',
  'require_human',
] as const;

export type GraphFailurePolicy = (typeof GRAPH_FAILURE_POLICIES)[number];

export const GRAPH_EVENT_TYPES = [
  'graph_planned',
  'node_scheduled',
  'node_started',
  'node_finished',
  'node_blocked',
  'resume_requested',
  'join_evaluated',
] as const;

export type GraphEventType = (typeof GRAPH_EVENT_TYPES)[number];

export interface GraphRetryPolicy {
  maxAttempts: number;
  backoff: 'none' | 'fixed' | 'exponential';
}

export interface GraphNodeDefinition {
  id: string;
  stage: WorkflowStage;
  kind: StageStepKind;
  skillId: string | null;
  label: string;
  inputSelectors: string[];
  outputNames: string[];
  retryPolicy: GraphRetryPolicy;
  resumePolicy: GraphResumePolicy;
  failurePolicy: GraphFailurePolicy;
  joinPolicy: GraphJoinPolicy;
  metadata: Record<string, unknown>;
}

export interface GraphEdgeDefinition {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  mode: GraphEdgeMode;
  condition: string | null;
  metadata: Record<string, unknown>;
}

export interface GraphDefinition {
  id: GraphDefinitionId;
  schemaVersion: typeof GRAPH_RUNTIME_SCHEMA_VERSION;
  version: string;
  sourceFlowId: FlowId | null;
  description: string;
  nodes: GraphNodeDefinition[];
  edges: GraphEdgeDefinition[];
  entryNodeIds: string[];
  createdAt: Iso8601;
  metadata: Record<string, unknown>;
}

export interface GraphRun {
  id: GraphRunId;
  workflowRunId: WorkflowRunId;
  graphDefinitionId: GraphDefinitionId;
  graphVersion: string;
  status: GraphRunStatus;
  activeNodeIds: string[];
  interruptedReason: string | null;
  createdAt: Iso8601;
  updatedAt: Iso8601;
  metadata: Record<string, unknown>;
}

export interface GraphNodeDependencyState {
  upstreamNodeIds: string[];
  satisfiedNodeIds: string[];
  blockedNodeIds: string[];
}

export interface GraphNodeRun {
  id: GraphNodeRunId;
  graphRunId: GraphRunId;
  workflowRunId: WorkflowRunId;
  nodeId: string;
  attempt: number;
  status: GraphNodeStatus;
  stepRunId: StepRunId | null;
  stepCheckpointId: StepCheckpointId | null;
  resumeCursor: string | null;
  idempotencyKey: string;
  dependencyState: GraphNodeDependencyState;
  startedAt: Iso8601 | null;
  completedAt: Iso8601 | null;
  metadata: Record<string, unknown>;
}

export interface GraphEvent {
  id: GraphEventId;
  graphRunId: GraphRunId;
  workflowRunId: WorkflowRunId;
  nodeId: string | null;
  type: GraphEventType;
  createdAt: Iso8601;
  payload: Record<string, unknown>;
}

export function isGraphNodeStatus(value: unknown): value is GraphNodeStatus {
  return includesString(GRAPH_NODE_STATUSES, value);
}

export function isGraphRunStatus(value: unknown): value is GraphRunStatus {
  return includesString(GRAPH_RUN_STATUSES, value);
}

export function isGraphEdgeMode(value: unknown): value is GraphEdgeMode {
  return includesString(GRAPH_EDGE_MODES, value);
}

export function isGraphJoinPolicy(value: unknown): value is GraphJoinPolicy {
  return includesString(GRAPH_JOIN_POLICIES, value);
}

export function isGraphResumePolicy(value: unknown): value is GraphResumePolicy {
  return includesString(GRAPH_RESUME_POLICIES, value);
}

export function isGraphFailurePolicy(value: unknown): value is GraphFailurePolicy {
  return includesString(GRAPH_FAILURE_POLICIES, value);
}

export function isGraphEventType(value: unknown): value is GraphEventType {
  return includesString(GRAPH_EVENT_TYPES, value);
}

export function isGraphRuntimeSchemaVersion(
  value: unknown,
): value is typeof GRAPH_RUNTIME_SCHEMA_VERSION {
  return value === GRAPH_RUNTIME_SCHEMA_VERSION;
}

/**
 * Reduce node runs to the latest attempt per node — the single "which attempt
 * counts" rule behind {@link deriveGraphRunStatus}, the runner's
 * `computeRunnableGraphNodes` and the web graph projection. Generic over the
 * run shape so callers can pass a full `GraphNodeRun` or a narrow projection
 * of one.
 */
export function latestGraphNodeRunsByNode<T extends Pick<GraphNodeRun, 'nodeId' | 'attempt'>>(
  nodeRuns: readonly T[],
): Map<string, T> {
  const latest = new Map<string, T>();
  for (const run of nodeRuns) {
    const existing = latest.get(run.nodeId);
    if (!existing || run.attempt > existing.attempt) latest.set(run.nodeId, run);
  }
  return latest;
}

export interface DeriveGraphRunStatusInput {
  /** The graph definition's node set — the denominator of the aggregate. */
  nodes: readonly Pick<GraphNodeDefinition, 'id'>[];
  /** Every node run of the graph run; only the latest attempt per node counts. */
  nodeRuns: readonly Pick<GraphNodeRun, 'nodeId' | 'attempt' | 'status'>[];
  /** The persisted aggregate status, returned verbatim when nothing has run yet. */
  currentStatus: GraphRunStatus;
}

/**
 * Aggregate a GraphRun's status from its node runs. The single judgement used
 * by both the write side (`/runner/events/graph-node-finished`) and any read
 * model, so `GraphRun.status` never disagrees with the node ledger.
 *
 * Priority, evaluated over the latest attempt of every defined node:
 *   1. any `cancelled` -> `cancelled`
 *   2. any `failed`    -> `failed`
 *   3. any `blocked`   -> `blocked`
 *   4. any node still active (`pending`/`ready`/`running`) or never run
 *      -> `running` (this is what returns a resumed graph to `running`)
 *   5. every node terminal and non-blocking (`passed`/`skipped`) -> `passed`
 *   6. no node run at all -> keep the current status (a planned-but-unstarted
 *      graph stays `pending`)
 *
 * `skipped` is the normal product of `skip_dependents`, so it is terminal but
 * does not block convergence to `passed`.
 *
 * Node runs whose node is absent from `nodes` do not count: the definition is
 * the denominator. An empty `nodes` therefore has nothing to converge and
 * keeps the current status rather than reporting a vacuous `passed`.
 */
export function deriveGraphRunStatus(input: DeriveGraphRunStatusInput): GraphRunStatus {
  if (input.nodeRuns.length === 0 || input.nodes.length === 0) return input.currentStatus;

  const latest = latestGraphNodeRunsByNode(input.nodeRuns);
  const statuses = input.nodes.map((node) => latest.get(node.id)?.status);
  if (statuses.includes('cancelled')) return 'cancelled';
  if (statuses.includes('failed')) return 'failed';
  if (statuses.includes('blocked')) return 'blocked';
  if (statuses.some((status) => status === undefined || isActiveGraphNodeStatus(status))) {
    return 'running';
  }
  return 'passed';
}

export function isActiveGraphNodeStatus(value: GraphNodeStatus): boolean {
  return includesString(GRAPH_NODE_ACTIVE_STATUSES, value);
}

export function isTerminalGraphNodeStatus(value: GraphNodeStatus): boolean {
  return includesString(GRAPH_NODE_TERMINAL_SUCCESS_STATUSES, value)
    || includesString(GRAPH_NODE_TERMINAL_BLOCKING_STATUSES, value);
}

export function isResumableGraphNodeStatus(value: GraphNodeStatus): boolean {
  return includesString(GRAPH_NODE_RESUMABLE_STATUSES, value);
}

function includesString(values: readonly string[], value: unknown): boolean {
  return typeof value === 'string' && values.includes(value);
}
