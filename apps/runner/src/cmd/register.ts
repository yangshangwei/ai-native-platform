import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { api } from '../api-client';
import { sh } from '../sh';

export async function cmdRegister(opts: { path: string; name: string }): Promise<void> {
  const localPath = resolve(opts.path);
  if (!existsSync(localPath)) throw new Error(`path does not exist: ${localPath}`);

  // Confirm the path is a git repo. The Trusted Local Worktree Mode needs one.
  const check = await sh('git', ['rev-parse', '--is-inside-work-tree'], { cwd: localPath });
  if (check.exitCode !== 0) {
    throw new Error(`not a git repo: ${localPath}\n${check.stderr}`);
  }

  const project = await api.registerProject({ name: opts.name, localPath });
  console.log(`[runner] registered project ${project.name} (${project.id}) -> ${project.localPath}`);
}
