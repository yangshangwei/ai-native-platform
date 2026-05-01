import type { WorkflowRun } from './workflow';
import type { CommandSpec, CommandRun } from './command';
import type { ArtifactRef } from './artifact';

/**
 * Reference to a prepared workspace. For the MVP this is always a git worktree
 * on the local filesystem. Future implementations may point to a container or
 * remote sandbox.
 */
export interface WorkspaceRef {
  workflowRunId: string;
  /** Absolute path on the runner host. */
  path: string;
  branch: string;
  /** Set by the environment so the same ref can describe non-local backends. */
  environmentKind: 'trusted_local_worktree' | 'docker_sandbox' | 'k8s' | 'microvm';
}

/**
 * The execution surface the platform talks to. Runner implements this;
 * future backends (Docker, K8s, microVM) implement the same interface.
 */
export interface ExecutionEnvironment {
  prepare(run: WorkflowRun): Promise<WorkspaceRef>;
  runCommand(workspace: WorkspaceRef, command: CommandSpec): Promise<CommandRun>;
  collectArtifacts(workspace: WorkspaceRef): Promise<ArtifactRef[]>;
  cleanup(workspace: WorkspaceRef): Promise<void>;
}
