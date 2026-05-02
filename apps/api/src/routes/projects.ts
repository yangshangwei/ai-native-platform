import { Hono } from 'hono';
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { newId, nowIso, type Project, type ProjectSourceAuthKind, type ProjectSourceKind } from '@ainp/shared';
import { store } from '../store/store';

export const projects = new Hono();

const REMOTE_SOURCE_KINDS = new Set<ProjectSourceKind>(['github', 'gitee', 'git', 'gitlab']);

interface RegisterProjectBody {
  name?: string;
  localPath?: string;
  sourceKind?: string;
  sourceUrl?: string;
  sourceAuthKind?: string;
  sourceUsername?: string;
  sourceCredential?: string;
  language?: Project['language'];
  buildTool?: Project['buildTool'];
  defaultBranch?: string;
}

interface DetectSourceBody {
  sourceKind?: string;
  localPath?: string;
  sourceUrl?: string;
  sourceAuthKind?: string;
  sourceUsername?: string;
  sourceCredential?: string;
}

interface PublicProject extends Omit<Project, 'sourceCredential'> {
  hasSourceCredential: boolean;
}

interface ShellResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

projects.get('/', (c) => c.json({ items: [...store.projects.values()].map(publicProject) }));


projects.get('/local-directories', async (c) => {
  const requested = c.req.query('path')?.trim();
  const currentPath = resolve(requested || process.env.HOME || homedir());
  try {
    const entries = await readdir(currentPath, { withFileTypes: true });
    const directories = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => ({ name: entry.name, path: join(currentPath, entry.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return c.json({ path: currentPath, parent: dirname(currentPath), directories });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

projects.post('/detect-source', async (c) => {
  const body = (await c.req.json()) as DetectSourceBody;
  const result = await detectProjectSource(body);
  return c.json(result, 200);
});

projects.post('/', async (c) => {
  const body = (await c.req.json()) as RegisterProjectBody;
  const normalized = normalizeRegisterBody(body);
  if ('error' in normalized) return c.json({ error: normalized.error }, 400);

  const existing = store.projectByName(normalized.name);
  if (existing) return c.json(publicProject(existing), 200);

  const id = newId('proj');
  const project: Project = {
    id,
    name: normalized.name,
    localPath: normalized.sourceKind === 'local' ? normalized.localPath! : managedSourcePath(id),
    sourceKind: normalized.sourceKind,
    sourceUrl: normalized.sourceKind === 'local' ? null : normalized.sourceUrl,
    sourceAuthKind: normalized.sourceAuthKind,
    sourceUsername: normalized.sourceUsername,
    sourceCredential: normalized.sourceCredential,
    language: body.language ?? 'java',
    buildTool: body.buildTool ?? 'maven',
    defaultBranch: normalized.defaultBranch,
    registeredAt: nowIso(),
  };
  store.projects.set(project.id, project);
  return c.json(publicProject(project), 201);
});


projects.put('/:id', async (c) => {
  const id = c.req.param('id');
  const existing = store.projects.get(id) ?? store.projectByName(id);
  if (!existing) return c.json({ error: 'not found' }, 404);

  const body = (await c.req.json()) as RegisterProjectBody;
  const incomingSourceKind = (body.sourceKind ?? existing.sourceKind ?? 'local') as ProjectSourceKind;
  const incomingAuthKind = (body.sourceAuthKind ?? existing.sourceAuthKind ?? 'none') as ProjectSourceAuthKind;
  const retainedCredential =
    body.sourceCredential ??
    (incomingSourceKind === (existing.sourceKind ?? 'local') && incomingAuthKind === (existing.sourceAuthKind ?? 'none')
      ? existing.sourceCredential ?? undefined
      : undefined);
  const normalized = normalizeRegisterBody({
    ...body,
    name: body.name ?? existing.name,
    sourceKind: incomingSourceKind,
    sourceUrl: body.sourceUrl ?? existing.sourceUrl ?? undefined,
    localPath: body.localPath ?? existing.localPath,
    sourceAuthKind: incomingAuthKind,
    sourceCredential: retainedCredential ?? undefined,
    defaultBranch: body.defaultBranch ?? existing.defaultBranch,
  });
  if ('error' in normalized) return c.json({ error: normalized.error }, 400);

  const existingCredential = existing.sourceCredential ?? null;
  const explicitCredential = body.sourceCredential?.trim();
  const shouldKeepCredential =
    !explicitCredential &&
    normalized.sourceKind === (existing.sourceKind ?? 'local') &&
    normalized.sourceAuthKind === (existing.sourceAuthKind ?? 'none');

  const updated: Project = {
    ...existing,
    name: normalized.name,
    localPath: normalized.sourceKind === 'local' ? normalized.localPath! : existing.localPath || managedSourcePath(existing.id),
    sourceKind: normalized.sourceKind,
    sourceUrl: normalized.sourceKind === 'local' ? null : normalized.sourceUrl,
    sourceAuthKind: normalized.sourceAuthKind,
    sourceUsername: normalized.sourceUsername,
    sourceCredential: shouldKeepCredential ? existingCredential : normalized.sourceCredential,
    language: body.language ?? existing.language,
    buildTool: body.buildTool ?? existing.buildTool,
    defaultBranch: normalized.defaultBranch,
  };
  store.projects.set(updated.id, updated);
  return c.json(publicProject(updated), 200);
});

projects.get('/:id', (c) => {
  const id = c.req.param('id');
  const project = store.projects.get(id) ?? store.projectByName(id);
  if (!project) return c.json({ error: 'not found' }, 404);
  if (c.req.query('includeSecret') === '1') return c.json(project);
  return c.json(publicProject(project));
});

async function detectProjectSource(body: DetectSourceBody): Promise<
  | {
      ok: true;
      sourceKind: ProjectSourceKind;
      sourceUrl: string | null;
      localPath: string | null;
      projectName: string;
      defaultBranch: string;
      branches: string[];
      metadata: Record<string, string>;
    }
  | { ok: false; error: string }
> {
  const sourceKind = normalizeSourceKind(body.sourceKind, body.sourceUrl);
  if (!isProjectSourceKind(sourceKind)) return { ok: false, error: 'sourceKind must be one of local, github, gitee, git, gitlab' };
  const sourceAuthKind = normalizeAuthKind(sourceKind, body.sourceAuthKind);
  if (!isSourceAuthKind(sourceAuthKind)) return { ok: false, error: 'sourceAuthKind must be one of none, ssh, token, basic' };

  if (sourceKind === 'local') {
    const localPath = body.localPath?.trim();
    if (!localPath) return { ok: false, error: 'localPath is required for local projects' };
    const inside = await git(['rev-parse', '--is-inside-work-tree'], localPath);
    if (inside.exitCode !== 0) return { ok: false, error: inside.stderr || inside.stdout || 'not a git repository' };
    const branchRows = await git(['branch', '--format=%(refname:short)'], localPath);
    const branches = uniqueLines(branchRows.stdout);
    const current = await git(['branch', '--show-current'], localPath);
    const defaultBranch = current.stdout.trim() || pickDefaultBranch(branches);
    return {
      ok: true,
      sourceKind,
      sourceUrl: null,
      localPath,
      projectName: inferProjectName(localPath),
      defaultBranch,
      branches,
      metadata: { provider: 'local', authKind: 'none', transport: 'local' },
    };
  }

  const sourceUrl = normalizeSourceUrl(sourceKind, body.sourceUrl);
  if (!sourceUrl) return { ok: false, error: 'sourceUrl is required for remote projects' };
  const credentialError = validateCredentialInput(sourceKind, sourceAuthKind, body.sourceUsername, body.sourceCredential);
  if (credentialError) return { ok: false, error: credentialError };

  const probeUrl = credentialedUrl(sourceKind, sourceUrl, sourceAuthKind, body.sourceUsername, body.sourceCredential);
  const remote = await git(['ls-remote', '--symref', '--heads', probeUrl]);
  if (remote.exitCode !== 0) {
    return { ok: false, error: sanitizeGitError(remote.stderr || remote.stdout || 'git ls-remote failed', probeUrl, sourceUrl) };
  }
  const { branches, defaultBranch } = parseLsRemoteHeads(remote.stdout);
  return {
    ok: true,
    sourceKind,
    sourceUrl,
    localPath: null,
    projectName: inferProjectName(sourceUrl),
    defaultBranch,
    branches,
    metadata: {
      provider: sourceKind,
      authKind: sourceAuthKind,
      transport: 'remote',
      ...(remoteHost(sourceUrl) ? { remoteHost: remoteHost(sourceUrl)! } : {}),
    },
  };
}

function normalizeRegisterBody(body: RegisterProjectBody):
  | {
      name: string;
      localPath?: string;
      sourceKind: ProjectSourceKind;
      sourceUrl: string | null;
      sourceAuthKind: ProjectSourceAuthKind;
      sourceUsername: string | null;
      sourceCredential: string | null;
      defaultBranch: string;
    }
  | { error: string } {
  const name = body.name?.trim();
  const sourceKind = normalizeSourceKind(body.sourceKind, body.sourceUrl);
  if (!name) return { error: 'name is required' };
  if (!isProjectSourceKind(sourceKind)) return { error: 'sourceKind must be one of local, github, gitee, git, gitlab' };

  const sourceAuthKind = normalizeAuthKind(sourceKind, body.sourceAuthKind);
  if (!isSourceAuthKind(sourceAuthKind)) return { error: 'sourceAuthKind must be one of none, ssh, token, basic' };
  const defaultBranch = body.defaultBranch?.trim() || 'main';

  if (sourceKind === 'local') {
    if (!body.localPath?.trim()) return { error: 'localPath is required for local projects' };
    return {
      name,
      localPath: body.localPath.trim(),
      sourceKind,
      sourceUrl: null,
      sourceAuthKind: 'none',
      sourceUsername: null,
      sourceCredential: null,
      defaultBranch,
    };
  }

  const sourceUrl = normalizeSourceUrl(sourceKind, body.sourceUrl);
  if (!sourceUrl) return { error: 'sourceUrl is required for GitHub, Gitee, Git, and GitLab projects' };
  if (!isSupportedGitUrl(sourceUrl)) return { error: 'sourceUrl must be an http(s), ssh, scp-like, file, or local Git URL' };
  const credentialError = validateCredentialInput(sourceKind, sourceAuthKind, body.sourceUsername, body.sourceCredential);
  if (credentialError) return { error: credentialError };

  return {
    name,
    sourceKind,
    sourceUrl,
    sourceAuthKind,
    sourceUsername: body.sourceUsername?.trim() || null,
    sourceCredential: body.sourceCredential?.trim() || null,
    defaultBranch,
  };
}

function publicProject(project: Project): PublicProject {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { sourceCredential, ...rest } = project;
  return {
    ...rest,
    sourceKind: rest.sourceKind ?? 'local',
    sourceUrl: rest.sourceUrl ?? null,
    sourceAuthKind: rest.sourceAuthKind ?? 'none',
    sourceUsername: rest.sourceUsername ?? null,
    hasSourceCredential: Boolean(sourceCredential),
  };
}

function normalizeSourceKind(kind: string | undefined, sourceUrl: string | undefined): string {
  if (kind) return kind;
  return sourceUrl?.trim() ? 'git' : 'local';
}

function isProjectSourceKind(kind: string): kind is ProjectSourceKind {
  return kind === 'local' || kind === 'github' || kind === 'gitee' || kind === 'git' || kind === 'gitlab';
}

function normalizeAuthKind(sourceKind: ProjectSourceKind, authKind: string | undefined): string {
  if (sourceKind === 'local') return 'none';
  return authKind?.trim() || 'none';
}

function isSourceAuthKind(kind: string): kind is ProjectSourceAuthKind {
  return kind === 'none' || kind === 'ssh' || kind === 'token' || kind === 'basic';
}

function validateCredentialInput(
  sourceKind: ProjectSourceKind,
  authKind: ProjectSourceAuthKind,
  username: string | undefined,
  credential: string | undefined,
): string | null {
  if (sourceKind === 'local' || authKind === 'none' || authKind === 'ssh') return null;
  if (authKind === 'token' && !credential?.trim()) return 'sourceCredential is required for token auth';
  if (authKind === 'basic') {
    if (!username?.trim()) return 'sourceUsername is required for username/password auth';
    if (!credential?.trim()) return 'sourceCredential is required for username/password auth';
  }
  return null;
}

function normalizeSourceUrl(kind: ProjectSourceKind, sourceUrl: string | undefined): string | null {
  const value = sourceUrl?.trim();
  if (!value) return null;
  if ((kind === 'github' || kind === 'gitee') && /^[\w.-]+\/[\w.-]+$/.test(value)) {
    const host = kind === 'github' ? 'github.com' : 'gitee.com';
    return `https://${host}/${value}.git`;
  }
  return value;
}

function managedSourcePath(projectId: string): string {
  const home = process.env.AINP_HOME ?? join(homedir(), '.ai-native');
  const projectsDir = process.env.AINP_PROJECTS_DIR ?? join(home, 'projects');
  return join(projectsDir, projectId, 'source');
}

function isSupportedGitUrl(value: string): boolean {
  if (/^(https?|ssh|git|file):\/\/.+/.test(value)) return true;
  if (/^[\w.-]+@[\w.-]+:.+/.test(value)) return true;
  if (value.startsWith('/') || value.startsWith('./') || value.startsWith('../')) return true;
  return false;
}

function git(args: string[], cwd?: string): Promise<ShellResult> {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on('data', (b: Buffer) => stdoutChunks.push(b));
    child.stderr.on('data', (b: Buffer) => stderrChunks.push(b));
    child.on('error', (err) => resolve({ exitCode: null, stdout: '', stderr: err.message }));
    child.on('close', (code) =>
      resolve({
        exitCode: code,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      }),
    );
  });
}

function uniqueLines(value: string): string[] {
  return [...new Set(value.split('\n').map((line) => line.trim()).filter(Boolean))];
}

function parseLsRemoteHeads(output: string): { branches: string[]; defaultBranch: string } {
  let defaultBranch = '';
  const branches: string[] = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const symref = /^ref:\s+refs\/heads\/(.+?)\s+HEAD$/.exec(trimmed);
    if (symref) {
      defaultBranch = symref[1] ?? '';
      continue;
    }
    const branch = /refs\/heads\/(.+)$/.exec(trimmed)?.[1];
    if (branch) branches.push(branch);
  }
  const uniqueBranches = [...new Set(branches)];
  return { branches: uniqueBranches, defaultBranch: defaultBranch || pickDefaultBranch(uniqueBranches) };
}

function pickDefaultBranch(branches: string[]): string {
  return branches.includes('main') ? 'main' : branches.includes('master') ? 'master' : branches[0] ?? 'main';
}

function inferProjectName(value: string): string {
  const withoutTrailingSlash = value.replace(/\/+$/, '');
  if (/^[\w.-]+@[\w.-]+:.+/.test(withoutTrailingSlash)) {
    return basename(withoutTrailingSlash.split(':').at(-1) ?? withoutTrailingSlash).replace(/\.git$/, '');
  }
  try {
    const url = new URL(withoutTrailingSlash);
    return basename(url.pathname).replace(/\.git$/, '') || basename(withoutTrailingSlash).replace(/\.git$/, '');
  } catch {
    return basename(withoutTrailingSlash).replace(/\.git$/, '');
  }
}

function remoteHost(value: string): string | null {
  if (/^[\w.-]+@[\w.-]+:.+/.test(value)) return value.split('@')[1]?.split(':')[0] ?? null;
  try {
    return new URL(value).host || null;
  } catch {
    return null;
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


function sanitizeGitError(error: string, credentialed: string, canonical: string): string {
  return error.split(credentialed).join(canonical);
}
