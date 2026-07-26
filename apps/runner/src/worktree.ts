import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { sh } from './sh';
import { WORKTREES_DIR } from './config';
import type { ExecutionEnvironment, WorkflowRun, WorkspaceRef, CommandSpec, CommandRun, ArtifactRef, Project, ProjectSourceAuthKind, ProjectSourceKind } from '@ainp/shared';

/**
 * Trusted Local Worktree environment.
 *
 *   path  = ~/.ai-native/worktrees/{projectId}/{runId}/workspace
 *   sourceBranch = run.sourceBranch (registered project default unless the request overrides it)
 *   branch = run.branch (already set by Workflow Engine to ai/{runId}-{slug})
 *
 * Important: this is NOT a security sandbox. We only isolate the working
 * directory and branch — commands still run as the host user with host env.
 */
export class TrustedLocalWorktreeEnvironment implements ExecutionEnvironment {
  constructor(
    private readonly project: Pick<Project, 'id' | 'localPath' | 'sourceKind' | 'sourceUrl' | 'sourceAuthKind' | 'sourceUsername' | 'sourceCredential' | 'defaultBranch'>,
    private readonly options: { worktreesDir?: string } = {},
  ) {}

  private worktreesDir(): string {
    return this.options.worktreesDir ?? WORKTREES_DIR;
  }

  workspacePath(runId: string): string {
    return join(this.worktreesDir(), this.project.id, runId, 'workspace');
  }

  async prepare(run: WorkflowRun): Promise<WorkspaceRef> {
    const sourceBranch = run.sourceBranch || this.project.defaultBranch;
    const workspacePath = this.workspacePath(run.id);

    // 07-26 operational pause (R6): resuming a paused run reuses the kept
    // worktree. If the same run's path already holds a valid git worktree on
    // the run's branch, return it as-is — no rebuild, no error. Any other
    // pre-existing path keeps the historical hard failure.
    if (existsSync(workspacePath)) {
      const existing = await this.existingWorkspaceForRun(run, workspacePath);
      if (existing) return existing;
      throw new Error(`worktree path already exists: ${workspacePath}`);
    }

    await this.ensureSourceRepository(sourceBranch);
    await mkdir(join(this.worktreesDir(), this.project.id, run.id), { recursive: true });

    // Create the worktree from the project's source repo. When the run's
    // branch survived a partial cleanup (worktree dir gone, branch kept),
    // check it out instead of failing on `-b` branch creation.
    const branchExists = await this.runBranchExists(run.branch);
    const addArgs = branchExists
      ? ['worktree', 'add', workspacePath, run.branch]
      : ['worktree', 'add', '-b', run.branch, workspacePath, sourceBranch || 'HEAD'];
    const result = await sh('git', addArgs, { cwd: this.project.localPath });
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

  /**
   * Returns the WorkspaceRef when `workspacePath` is a valid git worktree
   * checked out on the run's branch (paused-run resume), otherwise null.
   */
  private async existingWorkspaceForRun(
    run: WorkflowRun,
    workspacePath: string,
  ): Promise<WorkspaceRef | null> {
    const inside = await sh('git', ['rev-parse', '--is-inside-work-tree'], { cwd: workspacePath });
    if (inside.exitCode !== 0 || inside.stdout.trim() !== 'true') return null;
    const branch = await sh('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: workspacePath });
    if (branch.exitCode !== 0 || branch.stdout.trim() !== run.branch) return null;
    return {
      workflowRunId: run.id,
      path: workspacePath,
      branch: run.branch,
      environmentKind: 'trusted_local_worktree',
    };
  }

  private async runBranchExists(branch: string): Promise<boolean> {
    const result = await sh(
      'git',
      ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`],
      { cwd: this.project.localPath },
    );
    return result.exitCode === 0;
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

  private async ensureSourceRepository(sourceBranch: string): Promise<void> {
    if ((this.project.sourceKind ?? 'local') === 'local') return;
    if (!this.project.sourceUrl) throw new Error(`sourceUrl required for ${this.project.sourceKind} project`);

    if (!existsSync(join(this.project.localPath, '.git'))) {
      await mkdir(dirname(this.project.localPath), { recursive: true });
      const cloneUrl = this.authenticatedSourceUrl();
      const clone = await sh('git', ['clone', '--branch', sourceBranch, cloneUrl, this.project.localPath]);
      if (clone.exitCode !== 0) {
        throw new Error(`git clone failed (exit=${clone.exitCode}): ${this.sanitizeGitError(clone.stderr || clone.stdout)}`);
      }
      if (cloneUrl !== this.project.sourceUrl) {
        await sh('git', ['remote', 'set-url', 'origin', this.project.sourceUrl], { cwd: this.project.localPath });
      }
      return;
    }

    const fetch = await sh('git', ['fetch', this.authenticatedSourceUrl(), sourceBranch, '--prune'], { cwd: this.project.localPath });
    if (fetch.exitCode !== 0) {
      throw new Error(`git fetch failed (exit=${fetch.exitCode}): ${this.sanitizeGitError(fetch.stderr || fetch.stdout)}`);
    }
    const checkout = await sh('git', ['checkout', '-B', sourceBranch, 'FETCH_HEAD'], { cwd: this.project.localPath });
    if (checkout.exitCode !== 0) {
      throw new Error(`git checkout ${sourceBranch} failed (exit=${checkout.exitCode}): ${checkout.stderr || checkout.stdout}`);
    }
    const reset = await sh('git', ['reset', '--hard', 'FETCH_HEAD'], { cwd: this.project.localPath });
    if (reset.exitCode !== 0) {
      throw new Error(`git reset failed (exit=${reset.exitCode}): ${reset.stderr || reset.stdout}`);
    }
  }

  private sanitizeGitError(error: string): string {
    return error.split(this.authenticatedSourceUrl()).join(this.project.sourceUrl ?? '');
  }

  private authenticatedSourceUrl(): string {
    return credentialedUrl(
      this.project.sourceKind ?? 'git',
      this.project.sourceUrl ?? '',
      this.project.sourceAuthKind ?? 'none',
      this.project.sourceUsername ?? undefined,
      this.project.sourceCredential ?? undefined,
    );
  }
}

function credentialedUrl(
  sourceKind: ProjectSourceKind,
  sourceUrl: string,
  authKind: ProjectSourceAuthKind,
  username: string | undefined,
  credential: string | undefined,
): string {
  if (authKind === 'none' || authKind === 'ssh' || !credential?.trim() || !/^https?:\/\//.test(sourceUrl)) return sourceUrl;
  const url = new URL(sourceUrl);
  url.username = username?.trim() || defaultTokenUsername(sourceKind);
  url.password = credential.trim();
  return url.toString();
}

function defaultTokenUsername(sourceKind: ProjectSourceKind): string {
  if (sourceKind === 'github') return 'x-access-token';
  if (sourceKind === 'gitlab' || sourceKind === 'gitee') return 'oauth2';
  return 'git';
}
