import type { Iso8601, CommandRunId, WorkflowRunId, StepRunId } from './ids';

export type CommandStage = 'compile' | 'test' | 'package' | 'verify' | 'git' | 'other';
export type CommandStatus = 'running' | 'passed' | 'failed' | 'timeout' | 'cancelled';

/**
 * What the runner is asked to execute. Validated against a whitelist before spawn.
 */
export interface CommandSpec {
  command: string;
  cwd: string;
  stage: CommandStage;
  timeoutMs: number;
  /** Hard cap on stdout/stderr size (each, in bytes). */
  maxLogBytes: number;
  /** Extra env to merge into the child process. */
  env?: Record<string, string>;
}

/**
 * Recorded outcome of one command. Source of truth for Compile/Test Gate.
 * stdoutRef / stderrRef are URIs (file:// for MVP) — full output never inlined.
 */
export interface CommandRun {
  id: CommandRunId;
  workflowRunId: WorkflowRunId;
  stepRunId: StepRunId | null;
  cwd: string;
  command: string;
  stage: CommandStage;
  status: CommandStatus;
  exitCode: number | null;
  startedAt: Iso8601;
  finishedAt: Iso8601 | null;
  durationMs: number | null;
  stdoutRef: string;
  stderrRef: string;
  stdoutBytes: number;
  stderrBytes: number;
  timedOut: boolean;
  truncated: boolean;
}
