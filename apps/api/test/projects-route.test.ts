import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, expect, test } from 'vitest';
import { sh } from '../../runner/src/sh';

process.env.AINP_DB_PATH = join(mkdtempSync(join(tmpdir(), 'ainp-project-route-test-')), 'ainp.sqlite');
process.env.AINP_HOME = join(mkdtempSync(join(tmpdir(), 'ainp-project-route-home-')), '.ai-native');

let app: Awaited<typeof import('../src/app')>['app'];

beforeAll(async () => {
  ({ app } = await import('../src/app'));
});

async function makeGitRepo(branches: string[] = ['main']): Promise<string> {
  const repo = mkdtempSync(join(tmpdir(), 'ainp-detect-repo-'));
  await sh('git', ['init', '-b', branches[0] ?? 'main'], { cwd: repo });
  writeFileSync(join(repo, 'README.md'), '# detect fixture\n', 'utf8');
  await sh('git', ['add', 'README.md'], { cwd: repo });
  await sh('git', ['-c', 'user.email=ainp@test', '-c', 'user.name=ainp', 'commit', '-m', 'initial'], { cwd: repo });
  for (const branch of branches.slice(1)) {
    await sh('git', ['checkout', '-b', branch], { cwd: repo });
    writeFileSync(join(repo, `${branch.replace(/[^a-zA-Z0-9.-]/g, '-')}.txt`), branch, 'utf8');
    await sh('git', ['add', `${branch}.txt`], { cwd: repo });
    await sh('git', ['-c', 'user.email=ainp@test', '-c', 'user.name=ainp', 'commit', '-m', `add ${branch}`], { cwd: repo });
  }
  await sh('git', ['checkout', branches[0] ?? 'main'], { cwd: repo });
  return repo;
}

test('detects a local git project and returns project name, branches, and metadata', async () => {
  const repo = await makeGitRepo(['main', 'develop']);

  const res = await app.request('/projects/detect-source', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sourceKind: 'local', localPath: repo }),
  });

  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    ok: true,
    sourceKind: 'local',
    projectName: expect.stringContaining('ainp-detect-repo-'),
    defaultBranch: 'main',
    branches: expect.arrayContaining(['main', 'develop']),
    metadata: { transport: 'local' },
  });
});

test('detects a remote git source and returns normalized URL, branches, and provider metadata', async () => {
  const repo = await makeGitRepo(['main', 'release/1.0']);

  const res = await app.request('/projects/detect-source', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sourceKind: 'gitee',
      sourceUrl: repo,
      sourceAuthKind: 'none',
    }),
  });

  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    ok: true,
    sourceKind: 'gitee',
    sourceUrl: repo,
    projectName: expect.stringContaining('ainp-detect-repo-'),
    defaultBranch: 'main',
    branches: expect.arrayContaining(['main', 'release/1.0']),
    metadata: { provider: 'gitee', authKind: 'none', transport: 'remote' },
  });
});

test('returns a structured detect failure instead of registering incomplete remote input', async () => {
  const res = await app.request('/projects/detect-source', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sourceKind: 'gitlab', sourceUrl: '', sourceAuthKind: 'token' }),
  });

  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    ok: false,
    error: expect.stringContaining('sourceUrl'),
  });
});

test('registers a local git project with backward-compatible localPath', async () => {
  const res = await app.request('/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'local-sample',
      localPath: '/repos/local-sample',
      defaultBranch: 'main',
    }),
  });

  expect(res.status).toBe(201);
  expect(await res.json()).toMatchObject({
    name: 'local-sample',
    sourceKind: 'local',
    sourceAuthKind: 'none',
    localPath: '/repos/local-sample',
    sourceUrl: null,
    hasSourceCredential: false,
    defaultBranch: 'main',
  });
});

test('stores and refreshes source branch options for a registered project', async () => {
  const repo = await makeGitRepo(['main', 'develop']);
  const res = await app.request('/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: `branch-options-${Date.now()}`,
      sourceKind: 'local',
      localPath: repo,
      defaultBranch: 'main',
      sourceBranches: ['main', 'develop'],
    }),
  });

  expect(res.status).toBe(201);
  const project = (await res.json()) as { id: string; sourceBranches: string[] };
  expect(project.sourceBranches).toEqual(['main', 'develop']);

  const branches = await app.request(`/projects/${project.id}/branches`);
  expect(branches.status).toBe(200);
  expect(await branches.json()).toMatchObject({
    ok: true,
    defaultBranch: 'main',
    branches: expect.arrayContaining(['main', 'develop']),
  });
});

test('registers GitHub, Gitee, generic Git, and private GitLab sources by repo URL', async () => {
  for (const input of [
    {
      name: 'github-sample',
      sourceKind: 'github',
      sourceUrl: 'https://github.com/acme/widgets.git',
      sourceAuthKind: 'token',
      sourceCredential: 'ghp_test_token',
    },
    {
      name: 'gitee-sample',
      sourceKind: 'gitee',
      sourceUrl: 'https://gitee.com/acme/widgets.git',
      sourceAuthKind: 'basic',
      sourceUsername: 'robot',
      sourceCredential: 'password-test',
    },
    {
      name: 'generic-git-sample',
      sourceKind: 'git',
      sourceUrl: 'ssh://git@example.com/acme/widgets.git',
      sourceAuthKind: 'ssh',
    },
    {
      name: 'private-gitlab-sample',
      sourceKind: 'gitlab',
      sourceUrl: 'git@gitlab.internal.example.com:platform/widgets.git',
      sourceAuthKind: 'ssh',
    },
  ] as const) {
    const res = await app.request('/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...input, defaultBranch: 'main' }),
    });

    expect(res.status, `${input.name} should register`).toBe(201);
    const project = (await res.json()) as { id: string; localPath: string; sourceCredential?: string };
    expect(project).toMatchObject({
      name: input.name,
      sourceKind: input.sourceKind,
      sourceUrl: input.sourceUrl,
      sourceAuthKind: input.sourceAuthKind,
      hasSourceCredential: Boolean('sourceCredential' in input),
      defaultBranch: 'main',
    });
    expect(project).not.toHaveProperty('sourceCredential');
    if ('sourceCredential' in input) {
      const secretRes = await app.request(`/projects/${project.id}?includeSecret=1`);
      expect(await secretRes.json()).toMatchObject({ sourceCredential: input.sourceCredential });
    }
    expect(project.localPath).toMatch(new RegExp(`${project.id}/source$`));
  }
});

test('rejects source-specific registrations missing the required source field', async () => {
  const missingLocal = await app.request('/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'missing-local', sourceKind: 'local' }),
  });
  expect(missingLocal.status).toBe(400);
  expect(await missingLocal.json()).toMatchObject({ error: expect.stringContaining('localPath') });

  const missingUrl = await app.request('/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'missing-url', sourceKind: 'gitlab' }),
  });
  expect(missingUrl.status).toBe(400);
  expect(await missingUrl.json()).toMatchObject({ error: expect.stringContaining('sourceUrl') });
});

test('rejects unknown project source kinds', async () => {
  const res = await app.request('/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'bad-source-kind',
      sourceKind: 'bitbucket',
      sourceUrl: 'https://bitbucket.example.com/acme/widgets.git',
    }),
  });

  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: expect.stringContaining('sourceKind') });
});

test('lists local folders for the local project picker without returning files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ainp-local-picker-'));
  const child = join(root, 'repo-dir');
  const hidden = join(root, '.hidden-dir');
  const file = join(root, 'README.md');
  await Bun.$`mkdir -p ${child} ${hidden}`;
  writeFileSync(file, 'not a directory', 'utf8');

  const res = await app.request(`/projects/local-directories?path=${encodeURIComponent(root)}`);

  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    path: root,
    parent: expect.any(String),
    directories: [
      { name: 'repo-dir', path: child },
    ],
  });
});

test('updates an existing project while keeping saved credential when omitted', async () => {
  const createdRes = await app.request('/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'editable-gitee',
      sourceKind: 'gitee',
      sourceUrl: 'https://gitee.com/acme/old.git',
      sourceAuthKind: 'token',
      sourceCredential: 'old-secret',
      defaultBranch: 'main',
    }),
  });
  expect(createdRes.status).toBe(201);
  const created = (await createdRes.json()) as { id: string; localPath: string };

  const updateRes = await app.request(`/projects/${created.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'editable-gitee-renamed',
      sourceKind: 'gitee',
      sourceUrl: 'https://gitee.com/acme/new.git',
      sourceAuthKind: 'token',
      defaultBranch: 'master',
    }),
  });

  expect(updateRes.status).toBe(200);
  expect(await updateRes.json()).toMatchObject({
    id: created.id,
    name: 'editable-gitee-renamed',
    localPath: created.localPath,
    sourceUrl: 'https://gitee.com/acme/new.git',
    sourceAuthKind: 'token',
    hasSourceCredential: true,
    defaultBranch: 'master',
  });

  const secretRes = await app.request(`/projects/${created.id}?includeSecret=1`);
  expect(await secretRes.json()).toMatchObject({ sourceCredential: 'old-secret' });
});

async function registerLocalProject(name: string): Promise<{ id: string; name: string }> {
  const res = await app.request('/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, localPath: `/tmp/${name}`, defaultBranch: 'main' }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; name: string };
}

test('hard deletes a project only when it has no linked workflow history', async () => {
  const project = await registerLocalProject(`delete-empty-${Date.now()}`);

  const preview = await app.request(`/projects/${project.id}/delete-preview`);
  expect(preview.status).toBe(200);
  expect(await preview.json()).toMatchObject({
    canHardDelete: true,
    canArchive: true,
    totalRequests: 0,
    totalRuns: 0,
    recommendation: 'hard_delete',
  });

  const deleted = await app.request(`/projects/${project.id}`, { method: 'DELETE' });
  expect(deleted.status).toBe(200);
  expect(await deleted.json()).toMatchObject({ ok: true, action: 'hard_deleted' });

  const byId = await app.request(`/projects/${project.id}`);
  expect(byId.status).toBe(404);
});

test('blocks project archive while active workflow requests exist', async () => {
  const project = await registerLocalProject(`delete-active-${Date.now()}`);
  const requestRes = await app.request('/workflow-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId: project.id, title: 'pending feature', type: 'feature' }),
  });
  expect(requestRes.status).toBe(201);

  const preview = await app.request(`/projects/${project.id}/delete-preview`);
  expect(await preview.json()).toMatchObject({
    canHardDelete: false,
    canArchive: false,
    activeRequests: 1,
    recommendation: 'blocked_active_work',
  });

  const archive = await app.request(`/projects/${project.id}/archive`, { method: 'POST' });
  expect(archive.status).toBe(409);
  expect(await archive.json()).toMatchObject({ error: expect.stringContaining('active') });
});

test('archives a project with completed history and keeps it out of active project lists', async () => {
  const project = await registerLocalProject(`archive-history-${Date.now()}`);
  const requestRes = await app.request('/workflow-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId: project.id, title: 'historical feature', type: 'feature' }),
  });
  const request = (await requestRes.json()) as { id: string };
  await app.request(`/workflow-requests/${request.id}/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ runnerId: 'runner@archive-test' }),
  });
  await app.request(`/workflow-requests/${request.id}/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ok: true, workflowRunId: null }),
  });

  const preview = await app.request(`/projects/${project.id}/delete-preview`);
  expect(await preview.json()).toMatchObject({
    canHardDelete: false,
    canArchive: true,
    totalRequests: 1,
    activeRequests: 0,
    recommendation: 'archive',
  });

  const archive = await app.request(`/projects/${project.id}/archive`, { method: 'POST' });
  expect(archive.status).toBe(200);
  expect(await archive.json()).toMatchObject({ status: 'archived', archivedAt: expect.any(String) });

  const activeList = await app.request('/projects?status=active');
  const activeItems = ((await activeList.json()) as { items: Array<{ id: string }> }).items;
  expect(activeItems.map((p) => p.id)).not.toContain(project.id);

  const createAfterArchive = await app.request('/workflow-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId: project.id, title: 'should be blocked', type: 'feature' }),
  });
  expect(createAfterArchive.status).toBe(400);
});
