import type { ContextPack, SkillSpec } from '@ainp/shared';

/**
 * AgentBackend interface — runtime contract.
 *
 * Production orchestration uses Claude Code or Codex. `NativeBackend` remains
 * only as a deterministic fixture for legacy parser/sidecar tests.
 */
export interface AgentTaskContext {
  workflowRunId: string;
  /** Step run that owns this agent invocation. Used for streaming events.
   *  May be null when the orchestrator runs an agent outside of a step. */
  stepRunId?: string | null;
  workspacePath: string;
  branch: string;
  /** The user's original task title — what they typed in `runner orchestrate`. */
  title: string;
  /** Filesystem dir where the agent should drop produced artifacts. */
  artifactsDir: string;
  /** Previously-produced artifact text by skill input name. */
  inputs: Record<string, string>;
  /** Provider-neutral context selected by the platform for this invocation. */
  contextPack?: ContextPack;
  /** Context policy sensitive path patterns used for prompt-visible legacy inputs. */
  sensitivePathPatterns?: readonly string[];
  /** Optional parent AgentSession when this invocation is a bounded child handoff. */
  parentSessionId?: string | null;
}

export interface AgentArtifactOutput {
  /** Logical name (matches a SkillSpec output name). */
  name: string;
  /** Final filesystem path of the artifact (file:// URI computed downstream). */
  path: string;
  contentType: string;
  size: number;
}

export interface AgentBackend {
  kind: 'native' | 'codex' | 'claude_code';
  run(skill: SkillSpec, ctx: AgentTaskContext): Promise<AgentRunResult>;
}

export interface AgentRunResult {
  outputs: AgentArtifactOutput[];
  /** Final assistant message when the backend exposes it (for context_request parsing). */
  lastMessage?: string | null;
}
