import type { Iso8601, WorkflowRunId, StepRunId } from './ids';
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

export interface AgentStreamEvent {
  id: string;
  workflowRunId: WorkflowRunId;
  stepRunId: StepRunId | null;
  agentKind: AgentBackendKind;
  /**
   * Monotonic per-workflowRunId sequence. UI uses this to dedupe and resume
   * after reconnect via `?sinceSeq=`.
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
  workflowRunId: WorkflowRunId;
  stepRunId: StepRunId | null;
  agentKind: AgentBackendKind;
  type: AgentStreamEventType;
  payload: Record<string, unknown>;
  text: string | null;
}
