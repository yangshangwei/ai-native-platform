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

/**
 * Workspace-relative directory a CLI backend may stage artifacts in while it
 * runs. Codex's tool router hard-blocks `apply_patch` outside `--cd`, so
 * produce-file stages write here and the runner copies the result out to the
 * canonical `artifactsDir` (see `agents/codex.ts` header).
 *
 * Single source of truth on purpose: `codexStageDir()` builds paths under it
 * and the workspace-mutation guard excludes it. Without the exclusion every
 * Codex reviewer would report itself as a contract violation.
 */
export const WORKSPACE_AGENT_STAGING_DIR = '.ainp-artifacts';

/**
 * Workspace-relative directory the review stage collects UI evidence from.
 * `executeVerifier` reads it out of the worktree and copies each file to
 * `<runArtifactsDir>/verifier/` (see `orchestrator/verifier-media.ts`); the
 * convention is documented in
 * `.trellis/spec/shared/backend/evidence-verifier-protocol.md`.
 *
 * Excluded from the workspace-mutation guard for the same reason as
 * `WORKSPACE_AGENT_STAGING_DIR`: it is platform-owned staging that the runner
 * copies out, not a change to the deliverable. It has to be listed separately
 * because the review agent runs immediately BEFORE `executeVerifier` in the
 * same stage, so the reviewer is exactly who deposits these files — and
 * `skill.review` is the skill declaring `workspaceMutationPolicy: 'deny'`.
 */
export const WORKSPACE_VERIFIER_MEDIA_DIR = '.ainp-verifier';

/**
 * Every in-worktree directory the platform itself stages through. The
 * workspace-mutation guard subtracts these before judging a contract.
 */
export const WORKSPACE_PLATFORM_STAGING_DIRS = [
  WORKSPACE_AGENT_STAGING_DIR,
  WORKSPACE_VERIFIER_MEDIA_DIR,
] as const;
