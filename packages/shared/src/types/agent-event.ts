import type { Iso8601, WorkflowRequestId, WorkflowRunId, StepRunId } from './ids';
import type { AgentBackendKind } from './agent';

/**
 * Streaming event emitted by an AgentBackend (Claude Code CLI, etc.) and
 * relayed runner→API→UI in near-real-time. Designed so the UI can render the
 * same content the operator sees in their terminal.
 */
export type AgentStreamEventType =
  /** CC `system` events: init, hook lifecycle, model info. */
  | 'system'
  /** CC `assistant` message — may contain text deltas or tool_use blocks. */
  | 'assistant'
  /** CC `user` message — typically a tool_result returned by a tool. */
  | 'user'
  /** CC `result` — terminal event with cost / duration / final output. */
  | 'result'
  /** A line from stderr (auth errors, runtime warnings). */
  | 'stderr'
  /** A line that did not parse as JSON. */
  | 'raw'
  /** Backend-internal lifecycle: started / finished / cancelled / fallback. */
  | 'meta';

/**
 * Channel discriminator for stream events. Every event MUST belong to exactly
 * one channel:
 *   - `run` channel keyed by `workflowRunId`: events from real workflow runs
 *     (build/test/implementation stages).
 *   - `request` channel keyed by `workflowRequestId`: events from pre-run
 *     phases such as Coordinator triage, when no workflow run exists yet.
 *
 * Mutual exclusion is a runtime invariant: exactly one of `workflowRunId` /
 * `workflowRequestId` is non-null. The TS type intentionally allows both
 * fields independently to keep the wire format simple; `isAgentStreamChannel`
 * is the canonical guard that callers (API ingest, bus router, SSE routes)
 * must use to derive the routing key.
 */
export interface AgentStreamEvent {
  id: string;
  workflowRunId: WorkflowRunId | null;
  workflowRequestId?: WorkflowRequestId | null;
  stepRunId: StepRunId | null;
  agentKind: AgentBackendKind;
  /**
   * Monotonic per-channel sequence. The `run` and `request` channels have
   * independent sequences. UI uses this to dedupe and resume after reconnect
   * via `?sinceSeq=`.
   */
  sequence: number;
  type: AgentStreamEventType;
  /** Parsed JSON payload from the upstream stream-json line, or backend-meta. */
  payload: Record<string, unknown>;
  /** Pre-rendered short human-readable line for terminal-style display. */
  text: string | null;
  ts: Iso8601;
}

/**
 * Wire format runner→API. The API assigns id+sequence+ts so the runner can
 * fire-and-forget without coordinating IDs.
 */
export interface AgentStreamEventInput {
  workflowRunId: WorkflowRunId | null;
  workflowRequestId?: WorkflowRequestId | null;
  stepRunId: StepRunId | null;
  agentKind: AgentBackendKind;
  type: AgentStreamEventType;
  payload: Record<string, unknown>;
  text: string | null;
}

/**
 * The two stream channel kinds. Routing keys live as `${kind}:${id}` so the
 * bus and SSE routes can multiplex without colliding ids across channels.
 */
export type AgentStreamChannelKind = 'run' | 'request';

export interface AgentStreamChannel {
  kind: AgentStreamChannelKind;
  id: string;
}

/**
 * Derive the channel for an event or input. Returns `null` if the mutual
 * exclusion invariant is violated (both ids set, or both null). Callers
 * SHOULD treat null as a 400 / programming error.
 */
export function isAgentStreamChannel(
  input: Pick<AgentStreamEvent, 'workflowRunId' | 'workflowRequestId'>,
): AgentStreamChannel | null {
  const hasRun = typeof input.workflowRunId === 'string' && input.workflowRunId.length > 0;
  const hasReq =
    typeof input.workflowRequestId === 'string' && input.workflowRequestId.length > 0;
  if (hasRun === hasReq) return null;
  return hasRun
    ? { kind: 'run', id: input.workflowRunId as string }
    : { kind: 'request', id: input.workflowRequestId as string };
}

/** String form of a channel: `run:<id>` / `request:<id>`. */
export function agentStreamChannelKey(channel: AgentStreamChannel): string {
  return `${channel.kind}:${channel.id}`;
}
