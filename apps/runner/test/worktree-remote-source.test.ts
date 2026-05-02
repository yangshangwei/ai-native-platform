import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { newId, nowIso, type Project, type WorkflowRun } from '@ainp/shared';
import { TrustedLocalWorktreeEnvironment } from '../src/worktree';
import { sh } from '../src/sh';

async function makeRemoteRepo(): Promise<string> {
  const repo = mkdtempSync(join(tmpdir(), 'ainp-remote-repo-'));
  await sh('git', ['init', '-b', 'main'], { cwd: repo });
  writeFileSync(join(repo, 'README.md'), '# remote fixture\n', 'utf8');
  await sh('git', ['add', 'README.md'], { cwd: repo });
  await sh('git', ['-c', 'user.email=ainp@test', '-c', 'user.name=ainp', 'commit', '-m', 'initial'], { cwd: repo });
  return repo;
}

function workflowRun(projectId: string): WorkflowRun {
  return {
    id: newId('run'),
    projectId,
    type: 'smoke',
    status: 'running',
    currentStage: 'context',
    configSnapshotId: null,
    branch: `ai/test-${Date.now()}`,
    workspacePath: null,
    title: 'remote worktree fixture',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

describe('TrustedLocalWorktreeEnvironment remote sources', () => {
  test('clones a registered remote Git source into the managed localPath before creating worktree', async () => {
    const remoteRepo = await makeRemoteRepo();
    const managedSource = join(mkdtempSync(join(tmpdir(), 'ainp-managed-source-')), 'source');
    const project: Project = {
      id: newId('proj'),
      name: 'remote-fixture',
      localPath: managedSource,
      sourceKind: 'gitee',
      sourceUrl: remoteRepo,
      sourceAuthKind: 'none',
      language: 'java',
      buildTool: 'maven',
      defaultBranch: 'main',
      registeredAt: nowIso(),
    };
    const run = workflowRun(project.id);
    const env = new TrustedLocalWorktreeEnvironment(project);

    const workspace = await env.prepare(run);

    expect(existsSync(join(managedSource, '.git'))).toBe(true);
    expect(existsSync(join(workspace.path, 'README.md'))).toBe(true);
    await env.cleanup(workspace);
  });
});
