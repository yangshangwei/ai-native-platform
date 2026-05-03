import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { ProjectAgentBackendKind, ProjectSourceAuthKind, ProjectSourceKind } from '@ainp/shared';
import { api } from '../api-client';
import { sh } from '../sh';

export async function cmdRegister(opts: {
  path?: string;
  name: string;
  sourceKind?: ProjectSourceKind;
  sourceUrl?: string;
  defaultBranch?: string;
  sourceAuthKind?: ProjectSourceAuthKind;
  sourceUsername?: string;
  sourceCredential?: string;
  agentBackend?: ProjectAgentBackendKind;
}): Promise<void> {
  const sourceKind = opts.sourceKind ?? (opts.sourceUrl ? 'git' : 'local');

  if (sourceKind === 'local') {
    if (!opts.path) throw new Error('register --path is required for local projects');
    const localPath = resolve(opts.path);
    if (!existsSync(localPath)) throw new Error(`path does not exist: ${localPath}`);

    // Confirm the path is a git repo. The Trusted Local Worktree Mode needs one.
    const check = await sh('git', ['rev-parse', '--is-inside-work-tree'], { cwd: localPath });
    if (check.exitCode !== 0) {
      throw new Error(`not a git repo: ${localPath}\n${check.stderr}`);
    }

    const project = await api.registerProject({
      name: opts.name,
      localPath,
      sourceKind,
      agentBackend: opts.agentBackend,
      defaultBranch: opts.defaultBranch,
    });
    console.log(`[runner] registered project ${project.name} (${project.id}) [local] -> ${project.localPath}`);
    return;
  }

  if (!opts.sourceUrl) throw new Error('register --url is required for GitHub, Gitee, Git, and GitLab projects');
  const project = await api.registerProject({
    name: opts.name,
    sourceKind,
    sourceUrl: opts.sourceUrl,
    sourceAuthKind: opts.sourceAuthKind,
    sourceUsername: opts.sourceUsername,
    sourceCredential: opts.sourceCredential,
    agentBackend: opts.agentBackend,
    defaultBranch: opts.defaultBranch,
  });
  console.log(`[runner] registered project ${project.name} (${project.id}) [${sourceKind}] -> ${project.sourceUrl}`);
  console.log(`[runner] managed source path: ${project.localPath}`);
}
