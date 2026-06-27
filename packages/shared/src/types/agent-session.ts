import type {
  AgentResultId,
  AgentSessionId,
  AgentTaskId,
  Iso8601,
  StepRunId,
  WorkflowRunId,
} from './ids';
import type { AgentBackendKind } from './agent';
import type { WorkflowStage } from './workflow';

export const AGENT_SESSION_STATUSES = [
  'running',
  'success',
  'failed',
  'cancelled',
] as const;

export type AgentSessionStatus = (typeof AGENT_SESSION_STATUSES)[number];

export function isAgentSessionStatus(value: unknown): value is AgentSessionStatus {
  return typeof value === 'string'
    && (AGENT_SESSION_STATUSES as readonly string[]).includes(value);
}

export type AgentSessionLinkKind = 'retry' | 'handoff_child';

export interface AgentSessionLink {
  kind: AgentSessionLinkKind;
  parentSessionId: AgentSessionId;
  retryIndex: number;
  reason?: string | null;
}

export interface AgentSession {
  id: AgentSessionId;
  workflowRunId: WorkflowRunId;
  stepRunId: StepRunId | null;
  agentTaskId: AgentTaskId;
  agentResultId: AgentResultId | null;
  backend: AgentBackendKind;
  stage: WorkflowStage;
  skillId: string;
  skillVersion: string;
  contextPackId: string;
  parentSessionId: AgentSessionId | null;
  retryIndex: number;
  status: AgentSessionStatus;
  startedAt: Iso8601;
  completedAt: Iso8601 | null;
  metadata: Record<string, unknown>;
}
