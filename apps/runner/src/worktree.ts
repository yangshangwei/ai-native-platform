import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { sh } from './sh';
import { WORKTREES_DIR } from './config';
import type { ExecutionEnvironment, WorkflowRun, WorkspaceRef, CommandSpec, CommandRun, ArtifactRef } from '@ainp/shared';

/**
 * Trusted Local Worktree environment.
 *
 *   path  = ~/.ai-native/worktrees/{projectId}/{runId}/workspace
 *   branch = run.branch (already set by Workflow Engine to ai/{runId}-{slug})
 *
 * Important: this is NOT a security sandbox. We only isolate the working
 * directory and branch — commands still run as the host user with host env.
 */
export class TrustedLocalWorktreeEnvironment implements ExecutionEnvironment {
  constructor(private readonly project: { id: string; localPath: string }) {}

  workspacePath(runId: string): string {
    return join(WORKTREES_DIR, this.project.id, runId, 'workspace');
  }

  async prepare(run: WorkflowRun): Promise<WorkspaceRef> {
    const workspacePath = this.workspacePath(run.id);
    if (existsSync(workspacePath)) {
      throw new Error(`worktree path already exists: ${workspacePath}`);
    }
    await mkdir(join(WORKTREES_DIR, this.project.id, run.id), { recursive: true });

    // Create the worktree from the project's source repo.
    const result = await sh(
      'git',
      ['worktree', 'add', '-b', run.branch, workspacePath, 'HEAD'],
      { cwd: this.project.localPath },
    );
    if (result.exitCode !== 0) {
      throw new Error(
        `git worktree add failed (exit=${result.exitCode}): ${result.stderr || result.stdout}`,
      );
    }
    return {
      workflowRunId: run.id,
      path: workspacePath,
      branch: run.branch,
      environmentKind: 'trusted_local_worktree',
    };
  }

  async runCommand(_workspace: WorkspaceRef, _spec: CommandSpec): Promise<CommandRun> {
    throw new Error('runCommand handled by command-runner.ts to keep CommandRun assembly local');
  }

  async collectArtifacts(_workspace: WorkspaceRef): Promise<ArtifactRef[]> {
    // Surefire/Failsafe parsing arrives in a later milestone; MVP returns []
    return [];
  }

  async cleanup(workspace: WorkspaceRef): Promise<void> {
    // Try the friendly path first: tell git to remove the worktree.
    const result = await sh(
      'git',
      ['worktree', 'remove', '--force', workspace.path],
      { cwd: this.project.localPath },
    );
    if (result.exitCode !== 0) {
      // Fall back to filesystem removal so leftover dirs don't block reruns.
      if (existsSync(workspace.path)) {
        await rm(workspace.path, { recursive: true, force: true });
      }
    }
    // Best-effort branch delete; ignore failure.
    await sh('git', ['branch', '-D', workspace.branch], { cwd: this.project.localPath });
  }
}
