import type { Iso8601, WorkflowRequestId } from './ids';

/**
 * Conversational intake messages that flow between the user and the
 * Coordinator before a WorkflowRun is created.
 *
 * `user` messages are typed in the web UI; `coordinator` messages are
 * questions the Coordinator emits during pause_for_human. Once a decision
 * with action=proceed lands, the request transitions out of the chat phase
 * and the runner spawns a WorkflowRun.
 */
export type MessageRole = 'user' | 'coordinator';

export interface RequestMessage {
  id: string;
  workflowRequestId: WorkflowRequestId;
  role: MessageRole;
  content: string;
  /** Set on coordinator messages that render a specific decision's questions. */
  coordinatorDecisionId: string | null;
  createdAt: Iso8601;
}
