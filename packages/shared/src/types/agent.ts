import type {
  AgentTaskId,
  AgentResultId,
  WorkflowRunId,
  StepRunId,
  Iso8601,
  ArtifactId,
} from './ids';

/**
 * Backend kinds that may appear in historical AgentTask / AgentStreamEvent
 * rows. `native` is retained for legacy test fixtures only; product-facing
 * project configuration must use ProjectAgentBackendKind.
 */
export type AgentBackendKind = 'native' | 'codex' | 'claude_code';

export type ProjectAgentBackendKind = 'codex' | 'claude_code';

export const PROJECT_AGENT_BACKENDS = ['claude_code', 'codex'] as const satisfies readonly ProjectAgentBackendKind[];

export function isProjectAgentBackendKind(value: unknown): value is ProjectAgentBackendKind {
  return value === 'codex' || value === 'claude_code';
}

export function agentBackendDisplayName(kind: ProjectAgentBackendKind | AgentBackendKind | null | undefined): string {
  if (kind === 'claude_code') return 'Claude Code';
  if (kind === 'codex') return 'Codex';
  return 'Legacy test backend';
}

export type AgentBackendPreflightStatus =
  | 'not_configured'
  | 'connected'
  | 'missing_cli'
  | 'needs_login'
  | 'not_runnable';

export interface AgentBackendPreflight {
  backend: ProjectAgentBackendKind | null;
  label: string;
  bin: string | null;
  installed: boolean;
  runnable: boolean;
  authenticated: boolean | null;
  version: string | null;
  status: AgentBackendPreflightStatus;
  error: string | null;
  remediationHint: string;
  checkedAt: Iso8601;
}

export type AgentTaskKind =
  | 'context_pack'
  | 'requirement_draft'
  | 'design_draft'
  | 'implementation'
  | 'review'
  | 'debug'
  | 'noop';

export interface AgentTask {
  id: AgentTaskId;
  workflowRunId: WorkflowRunId;
  stepRunId: StepRunId | null;
  kind: AgentTaskKind;
  backend: AgentBackendKind;
  /** Resolved prompt / instructions. The platform owns this, not the backend. */
  prompt: string;
  /** Inputs used by the backend (artifacts, context-pack refs, etc.). */
  inputArtifactIds: ArtifactId[];
  createdAt: Iso8601;
}

export interface AgentResult {
  id: AgentResultId;
  taskId: AgentTaskId;
  status: 'success' | 'failed' | 'cancelled';
  /** Free-form summary from the agent — never used to advance state. */
  summary: string;
  outputArtifactIds: ArtifactId[];
  startedAt: Iso8601;
  completedAt: Iso8601;
}
