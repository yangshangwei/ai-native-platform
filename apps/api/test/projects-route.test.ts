import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
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
    agentBackend: null,
    sourceAuthKind: 'none',
    localPath: '/repos/local-sample',
    sourceUrl: null,
    hasSourceCredential: false,
    defaultBranch: 'main',
  });
});

test('stores project-level real agent backend and rejects unsupported backend values', async () => {
  const created = await app.request('/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: `backend-project-${Date.now()}`,
      localPath: '/repos/backend-project',
      defaultBranch: 'main',
      agentBackend: 'claude_code',
    }),
  });
  expect(created.status).toBe(201);
  const project = (await created.json()) as { id: string; agentBackend: string };
  expect(project.agentBackend).toBe('claude_code');

  const updated = await app.request(`/projects/${project.id}/agent-backend`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agentBackend: 'codex' }),
  });
  expect(updated.status).toBe(200);
  expect(await updated.json()).toMatchObject({ agentBackend: 'codex' });

  const bad = await app.request(`/projects/${project.id}/agent-backend`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agentBackend: 'native' }),
  });
  expect(bad.status).toBe(400);
  expect(await bad.json()).toMatchObject({ error: expect.stringContaining('claude_code') });
});

test('does not expose legacy persisted backend values as user-selectable project backends', async () => {
  const { store } = await import('../src/store/store');
  const id = `proj_legacy_backend_${Date.now()}`;
  store.projects.set(id, {
    id,
    name: `legacy-backend-${Date.now()}`,
    localPath: '/repos/legacy-backend',
    agentBackend: 'native' as never,
    language: 'java',
    buildTool: 'maven',
    defaultBranch: 'main',
    registeredAt: new Date().toISOString(),
  });

  const res = await app.request(`/projects/${id}`);

  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ id, agentBackend: null });
});

test('preflights Codex backend through version and login status', async () => {
  const previous = process.env.AINP_CODEX_BIN;
  process.env.AINP_CODEX_BIN = fakeCodexBin({ loginStatus: 'logged_in' });
  try {
    const res = await app.request('/projects/agent-backend/preflight', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentBackend: 'codex' }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      backend: 'codex',
      installed: true,
      runnable: true,
      authenticated: true,
      version: 'codex 9.9.9',
      status: 'connected',
    });
  } finally {
    if (previous === undefined) delete process.env.AINP_CODEX_BIN;
    else process.env.AINP_CODEX_BIN = previous;
  }
});

test('reports Codex logged-out login status as needs_login without secret dumps', async () => {
  const previous = process.env.AINP_CODEX_BIN;
  process.env.AINP_CODEX_BIN = fakeCodexBin({ loginStatus: 'logged_out' });
  try {
    const res = await app.request('/projects/agent-backend/preflight', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentBackend: 'codex' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; error: string; remediationHint: string };
    expect(body.status).toBe('needs_login');
    expect(body.error).toContain('not logged in');
    expect(body.remediationHint).toContain('login');
    expect(body.error.length).toBeLessThan(700);
    expect(body.error).not.toContain('sk-test-codex-secret');
  } finally {
    if (previous === undefined) delete process.env.AINP_CODEX_BIN;
    else process.env.AINP_CODEX_BIN = previous;
  }
});

test('reports invalid Codex login status output as not_runnable with compact masked output', async () => {
  const previous = process.env.AINP_CODEX_BIN;
  process.env.AINP_CODEX_BIN = fakeCodexBin({ loginStatus: 'invalid' });
  try {
    const res = await app.request('/projects/agent-backend/preflight', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentBackend: 'codex' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; error: string; remediationHint: string };
    expect(body.status).toBe('not_runnable');
    expect(body.error).toContain('not recognized');
    expect(body.error).toContain('sk-[redacted]');
    expect(body.error.length).toBeLessThan(700);
    expect(body.remediationHint).toContain('login status');
    expect(body.error).not.toContain('sk-test-codex-secret');
  } finally {
    if (previous === undefined) delete process.env.AINP_CODEX_BIN;
    else process.env.AINP_CODEX_BIN = previous;
  }
});

test('preflights Claude Code backend through version and auth status JSON', async () => {
  const previous = process.env.AINP_CLAUDE_BIN;
  process.env.AINP_CLAUDE_BIN = fakeClaudeAuthBin({ loggedIn: true });
  try {
    const res = await app.request('/projects/agent-backend/preflight', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentBackend: 'claude_code' }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      backend: 'claude_code',
      installed: true,
      runnable: true,
      authenticated: true,
      version: 'claude 2.1.117',
      status: 'connected',
    });
  } finally {
    if (previous === undefined) delete process.env.AINP_CLAUDE_BIN;
    else process.env.AINP_CLAUDE_BIN = previous;
  }
});

test('reports Claude Code auth status loggedOut as needs_login without prompt dumps', async () => {
  const previous = process.env.AINP_CLAUDE_BIN;
  process.env.AINP_CLAUDE_BIN = fakeClaudeAuthBin({ loggedIn: false });
  try {
    const res = await app.request('/projects/agent-backend/preflight', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentBackend: 'claude_code' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; error: string; remediationHint: string };
    expect(body.status).toBe('needs_login');
    expect(body.error).toContain('loggedIn=false');
    expect(body.remediationHint).toContain('login');
    expect(body.error.length).toBeLessThan(700);
    expect(body.error).not.toContain('plugins');
    expect(body.error).not.toContain('/Users/artisan');
    expect(body.error).not.toContain('AINP_PREFLIGHT_OK');
  } finally {
    if (previous === undefined) delete process.env.AINP_CLAUDE_BIN;
    else process.env.AINP_CLAUDE_BIN = previous;
  }
});

test('reports invalid Claude Code auth status JSON as not_runnable with compact output', async () => {
  const previous = process.env.AINP_CLAUDE_BIN;
  process.env.AINP_CLAUDE_BIN = fakeClaudeInvalidAuthStatusBin();
  try {
    const res = await app.request('/projects/agent-backend/preflight', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentBackend: 'claude_code' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; error: string; remediationHint: string };
    expect(body.status).toBe('not_runnable');
    expect(body.error).toContain('invalid_json');
    expect(body.error.length).toBeLessThan(700);
    expect(body.remediationHint).toContain('auth status');
    expect(body.error).not.toContain('AINP_PREFLIGHT_OK');
  } finally {
    if (previous === undefined) delete process.env.AINP_CLAUDE_BIN;
    else process.env.AINP_CLAUDE_BIN = previous;
  }
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
    body: JSON.stringify({ name, localPath: `/tmp/${name}`, defaultBranch: 'main', agentBackend: 'codex' }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; name: string };
}

function fakeCodexBin(opts: { loginStatus: 'logged_in' | 'logged_out' | 'invalid' }): string {
  const dir = mkdtempSync(join(tmpdir(), 'ainp-project-route-fake-codex-'));
  const bin = join(dir, 'codex');
  const loginLine = opts.loginStatus === 'logged_in'
    ? 'Logged in using an API key - sk-test-codex-secret'
    : opts.loginStatus === 'logged_out'
      ? 'Not logged in'
      : 'Codex status unknown: sk-test-codex-secret';
  writeFileSync(bin, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "codex 9.9.9"; exit 0; fi',
    `if [ "$1" = "login" ] && [ "$2" = "status" ]; then printf '%s\\n' '${loginLine}'; exit 0; fi`,
    'echo "unexpected args: $@" >&2',
    'exit 2',
    '',
  ].join('\n'), 'utf8');
  chmodSync(bin, 0o755);
  return bin;
}

function fakeClaudeAuthBin(opts: { loggedIn: boolean }): string {
  const dir = mkdtempSync(join(tmpdir(), 'ainp-project-route-fake-claude-'));
  const bin = join(dir, 'claude');
  const authPayload = JSON.stringify({
    loggedIn: opts.loggedIn,
    authMethod: opts.loggedIn ? 'oauth_token' : null,
    apiProvider: opts.loggedIn ? 'firstParty' : null,
  });
  writeFileSync(bin, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "claude 2.1.117"; exit 0; fi',
    `if [ "$1" = "auth" ] && [ "$2" = "status" ]; then printf '%s\\n' '${authPayload}'; exit 0; fi`,
    'echo "unexpected args: $@" >&2',
    'exit 9',
    '',
  ].join('\n'), 'utf8');
  chmodSync(bin, 0o755);
  return bin;
}

function fakeClaudeInvalidAuthStatusBin(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ainp-project-route-fake-claude-invalid-auth-'));
  const bin = join(dir, 'claude');
  writeFileSync(bin, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "claude 2.1.117"; exit 0; fi',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "not json"; exit 0; fi',
    'echo "unexpected args: $@" >&2',
    'exit 9',
    '',
  ].join('\n'), 'utf8');
  chmodSync(bin, 0o755);
  return bin;
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
