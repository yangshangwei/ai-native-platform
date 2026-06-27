import type { Iso8601, StepRunId, WorkflowRunId } from './ids';

export const TOOL_INVOCATION_STATUSES = ['running', 'success', 'failed', 'denied'] as const;
export type ToolInvocationStatus = (typeof TOOL_INVOCATION_STATUSES)[number];

export const TOOL_SIDE_EFFECT_LEVELS = ['read_only', 'writes_workspace', 'external_process'] as const;
export type ToolSideEffectLevel = (typeof TOOL_SIDE_EFFECT_LEVELS)[number];

export const TOOL_PERMISSION_TIERS = ['none', 'whitelist', 'approval_required'] as const;
export type ToolPermissionTier = (typeof TOOL_PERMISSION_TIERS)[number];

export const TOOL_PERMISSION_DECISIONS = ['not_required', 'allowed', 'denied'] as const;
export type ToolPermissionDecision = (typeof TOOL_PERMISSION_DECISIONS)[number];

export const RUNNER_TOOL_IDS = [
  'runner.command',
  'runner.git_diff_capture',
  'runner.artifact_read',
  'runner.context_supplement',
] as const;
export type RunnerToolId = (typeof RUNNER_TOOL_IDS)[number];

export type ToolResultRefKind =
  | 'command_run'
  | 'artifact'
  | 'context_pack'
  | 'agent_session'
  | 'other';

export interface ToolSpec {
  id: RunnerToolId;
  schemaVersion: string;
  name: string;
  sideEffect: ToolSideEffectLevel;
  permissionTier: ToolPermissionTier;
  description?: string;
}

export interface ToolResultRef {
  kind: ToolResultRefKind;
  id: string;
  digest?: string | null;
  claim?: string;
}

export interface ToolInvocation {
  id: string;
  workflowRunId: WorkflowRunId;
  stepRunId: StepRunId | null;
  toolId: RunnerToolId;
  toolName: string;
  schemaVersion: string;
  status: ToolInvocationStatus;
  sideEffect: ToolSideEffectLevel;
  permissionTier: ToolPermissionTier;
  permissionDecision: ToolPermissionDecision;
  argumentsDigest: string;
  resultRefs: ToolResultRef[];
  startedAt: Iso8601;
  completedAt: Iso8601 | null;
  durationMs: number | null;
  error: string | null;
  metadata: Record<string, unknown>;
}

export const RUNNER_TOOL_SPECS: Record<RunnerToolId, ToolSpec> = {
  'runner.command': {
    id: 'runner.command',
    schemaVersion: 'ainp.tool.runner.command.v1',
    name: 'Runner whitelisted command',
    sideEffect: 'external_process',
    permissionTier: 'whitelist',
    description: 'Executes a command only after runner whitelist approval.',
  },
  'runner.git_diff_capture': {
    id: 'runner.git_diff_capture',
    schemaVersion: 'ainp.tool.runner.git_diff_capture.v1',
    name: 'Runner git diff capture',
    sideEffect: 'read_only',
    permissionTier: 'none',
    description: 'Captures implementation diff and changed-file evidence.',
  },
  'runner.artifact_read': {
    id: 'runner.artifact_read',
    schemaVersion: 'ainp.tool.runner.artifact_read.v1',
    name: 'Runner artifact read',
    sideEffect: 'read_only',
    permissionTier: 'none',
    description: 'Reads persisted artifact content for audit or report assembly.',
  },
  'runner.context_supplement': {
    id: 'runner.context_supplement',
    schemaVersion: 'ainp.tool.runner.context_supplement.v1',
    name: 'Runner context supplement',
    sideEffect: 'read_only',
    permissionTier: 'none',
    description: 'Builds supplemental context after a structured context_request.',
  },
};

export function isToolInvocationStatus(value: unknown): value is ToolInvocationStatus {
  return typeof value === 'string' && (TOOL_INVOCATION_STATUSES as readonly string[]).includes(value);
}

export function isRunnerToolId(value: unknown): value is RunnerToolId {
  return typeof value === 'string' && (RUNNER_TOOL_IDS as readonly string[]).includes(value);
}

export function isToolSideEffectLevel(value: unknown): value is ToolSideEffectLevel {
  return typeof value === 'string' && (TOOL_SIDE_EFFECT_LEVELS as readonly string[]).includes(value);
}

export function isToolPermissionTier(value: unknown): value is ToolPermissionTier {
  return typeof value === 'string' && (TOOL_PERMISSION_TIERS as readonly string[]).includes(value);
}

export function isToolPermissionDecision(value: unknown): value is ToolPermissionDecision {
  return typeof value === 'string' && (TOOL_PERMISSION_DECISIONS as readonly string[]).includes(value);
}
