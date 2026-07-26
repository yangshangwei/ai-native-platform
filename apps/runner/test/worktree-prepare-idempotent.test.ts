/**
 * 07-26 operational-unavailable-state (R6) — `prepare()` idempotence for
 * paused-run resume: the kept worktree of the same run is reused as-is;
 * foreign pre-existing paths keep the historical hard failure; a surviving
 * run branch (partial cleanup) is checked out instead of failing `-b`.
 */
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { newId, nowIso, type Project, type WorkflowRun } from '@ainp/shared';
import { TrustedLocalWorktreeEnvironment } from '../src/worktree';
import { sh } from '../src/sh';

async function makeLocalRepo(): Promise<string> {
  const repo = mkdtempSync(join(tmpdir(), 'ainp-local-repo-'));
  await sh('git', ['init', '-b', 'main'], { cwd: repo });
  writeFileSync(join(repo, 'README.md'), '# local fixture\n', 'utf8');
  await sh('git', ['add', 'README.md'], { cwd: repo });
  await sh('git', ['-c', 'user.email=ainp@test', '-c', 'user.name=ainp', 'commit', '-m', 'initial'], { cwd: repo });
  return repo;
}

function localProject(localPath: string): Pick<
  Project,
  'id' | 'localPath' | 'sourceKind' | 'sourceUrl' | 'sourceAuthKind' | 'sourceUsername' | 'sourceCredential' | 'defaultBranch'
> {
  return {
    id: newId('proj'),
    localPath,
    sourceKind: 'local',
    sourceUrl: null,
    sourceAuthKind: 'none',
    sourceUsername: null,
    sourceCredential: null,
    defaultBranch: 'main',
  };
}

function workflowRun(projectId: string): WorkflowRun {
  const id = newId('run');
  return {
    id,
    projectId,
    type: 'feature',
    status: 'running',
    currentStage: 'implementation',
    flowId: 'feature.standard',
    startStage: null,
    configSnapshotId: null,
    sourceBranch: 'main',
    branch: `ai/${id}-idempotent-fixture`,
    workspacePath: null,
    title: 'idempotent worktree fixture',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

describe('TrustedLocalWorktreeEnvironment.prepare idempotence (paused-run resume)', () => {
  test('second prepare for the same run reuses the kept worktree (no rebuild, no error)', async () => {
    const repo = await makeLocalRepo();
    const worktreesDir = mkdtempSync(join(tmpdir(), 'ainp-worktrees-idem-'));
    const project = localProject(repo);
    const env = new TrustedLocalWorktreeEnvironment(project, { worktreesDir });
    const run = workflowRun(project.id);

    const first = await env.prepare(run);
    // Leave a marker to prove the worktree is NOT rebuilt on resume.
    writeFileSync(join(first.path, 'resume-marker.txt'), 'kept\n', 'utf8');

    const second = await env.prepare(run);

    expect(second.path).toBe(first.path);
    expect(second.branch).toBe(run.branch);
    expect(existsSync(join(second.path, 'resume-marker.txt'))).toBe(true);

    await env.cleanup(second);
  });

  test('a pre-existing path that is not the run worktree still fails hard', async () => {
    const repo = await makeLocalRepo();
    const worktreesDir = mkdtempSync(join(tmpdir(), 'ainp-worktrees-foreign-'));
    const project = localProject(repo);
    const env = new TrustedLocalWorktreeEnvironment(project, { worktreesDir });
    const run = workflowRun(project.id);

    // Occupy the workspace path with a plain (non-git-worktree) directory.
    mkdirSync(env.workspacePath(run.id), { recursive: true });
    writeFileSync(join(env.workspacePath(run.id), 'junk.txt'), 'junk\n', 'utf8');

    await expect(env.prepare(run)).rejects.toThrow(/worktree path already exists/);
  });

  test('a surviving run branch after partial cleanup is checked out instead of failing -b', async () => {
    const repo = await makeLocalRepo();
    const worktreesDir = mkdtempSync(join(tmpdir(), 'ainp-worktrees-branch-'));
    const project = localProject(repo);
    const env = new TrustedLocalWorktreeEnvironment(project, { worktreesDir });
    const run = workflowRun(project.id);

    const first = await env.prepare(run);
    // Simulate partial cleanup: worktree directory gone, branch kept.
    await rm(first.path, { recursive: true, force: true });
    await sh('git', ['worktree', 'prune'], { cwd: repo });
    const branchStillThere = await sh('git', ['rev-parse', '--verify', `refs/heads/${run.branch}`], { cwd: repo });
    expect(branchStillThere.exitCode).toBe(0);

    const second = await env.prepare(run);

    expect(second.branch).toBe(run.branch);
    const head = await sh('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: second.path });
    expect(head.stdout.trim()).toBe(run.branch);

    await env.cleanup(second);
  });
});
