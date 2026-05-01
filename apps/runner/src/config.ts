import { homedir } from 'node:os';
import { join } from 'node:path';

export const RUNNER_HOME = process.env.AINP_HOME ?? join(homedir(), '.ai-native');
export const WORKTREES_DIR = join(RUNNER_HOME, 'worktrees');
export const PROJECTS_DIR = process.env.AINP_PROJECTS_DIR ?? join(RUNNER_HOME, 'projects');

export const API_BASE =
  process.env.AINP_API_BASE ?? 'http://127.0.0.1:8787';

/** Default per-command timeout (ms). Maven compile/test fits comfortably. */
export const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/** Hard cap per stream so a runaway log can't blow up disk. */
export const DEFAULT_MAX_LOG_BYTES = 8 * 1024 * 1024;
