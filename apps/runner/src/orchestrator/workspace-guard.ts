import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  EXECUTION_CONTRACT_VIOLATION_OUTPUT_NAME,
  EXECUTION_CONTRACT_VIOLATION_SCHEMA_VERSION,
  errorMessage,
  evaluateExecutionContract,
  executionContractRequiresWorkspaceMeasurement,
  executionContractViolationSummary,
  nowIso,
  pathToFileUri,
  resolveExecutionContract,
  type ExecutionContract,
  type ExecutionContractViolation,
  type ExecutionContractViolationEnvelope,
  type SkillSpec,
} from '@ainp/shared';
import { sh } from '../sh';
import { WORKSPACE_PLATFORM_STAGING_DIRS } from '../config';

/**
 * Workspace-mutation guard — the enforcement half of `ExecutionContract`
 * (task 08-09 p0-3-executioncontract-reviewer-scope-creep, R2/R3).
 *
 * The runner fingerprints the worktree immediately before and after an agent
 * invocation and reports the delta against the skill's contract. This is a
 * detection guard, not a sandbox (PRD ADR-1): both backends still run with
 * write access, because Codex's produce-file path has to write inside the
 * worktree. What changes is that a `deny` skill can no longer touch the
 * workspace unnoticed.
 *
 * Fingerprints are git's view (PRD ADR-3), never a whole-tree hash — a hash
 * would cost too much on a real repo and would fire on every build artifact
 * and `node_modules` entry that git already ignores. The platform's own
 * in-worktree staging directories are subtracted before judging; see
 * {@link isPlatformStagingPath}.
 */

/** Bounded so a wedged git can't stall a run. Two short local commands. */
const FINGERPRINT_TIMEOUT_MS = 30_000;

/**
 * Disable git's octal-escaping of non-ASCII paths so evidence names files the
 * way the operator sees them. Paths containing spaces or quotes still arrive
 * double-quoted; `unquoteGitPath` handles that.
 */
const GIT_QUOTE_PATH_OFF = ['-c', 'core.quotePath=false'];

export interface WorkspaceFingerprint {
  /** Workspace-relative posix path -> opaque state token. */
  entries: Record<string, string>;
  /**
   * False when `git diff` against HEAD was unavailable (a repo with no
   * commits). The churn dimension is then dropped from the comparison rather
   * than guessed at — see `workspaceFingerprintDelta`.
   */
  churnAvailable: boolean;
}

/**
 * Collect a fingerprint, or null when the workspace can't be measured (not a
 * git repo, git missing). Production worktrees are always git repos, so null
 * means the environment is broken rather than the agent misbehaving; callers
 * degrade to "not measured" instead of inventing a business failure.
 */
export async function captureWorkspaceFingerprint(
  workspacePath: string,
): Promise<WorkspaceFingerprint | null> {
  try {
    const status = await sh('git', [...GIT_QUOTE_PATH_OFF, 'status', '--porcelain'], {
      cwd: workspacePath,
      timeoutMs: FINGERPRINT_TIMEOUT_MS,
    });
    if (status.exitCode !== 0) return null;
    // `--stat` (not `--numstat`) per ADR-3; the explicit widths stop git from
    // abbreviating long paths to `.../tail.ts`, which would make the churn key
    // ambiguous. `HEAD` covers staged changes too — plain `git diff` would let
    // an agent hide further edits to an already-staged file.
    const churn = await sh(
      'git',
      [...GIT_QUOTE_PATH_OFF, 'diff', '--stat=4096,4096', 'HEAD'],
      { cwd: workspacePath, timeoutMs: FINGERPRINT_TIMEOUT_MS },
    );
    const churnAvailable = churn.exitCode === 0;
    return {
      entries: workspaceFingerprintEntries(status.stdout, churnAvailable ? churn.stdout : ''),
      churnAvailable,
    };
  } catch {
    return null;
  }
}

/** Merge the two git views into one path -> state token map. */
export function workspaceFingerprintEntries(
  statusStdout: string,
  diffStatStdout: string,
): Record<string, string> {
  const statuses = parseGitStatusPorcelain(statusStdout);
  const churn = parseGitDiffStat(diffStatStdout);
  const entries: Record<string, string> = {};
  for (const path of new Set([...Object.keys(statuses), ...Object.keys(churn)])) {
    entries[path] = [
      statuses[path] ? `status=${statuses[path]}` : '',
      churn[path] ? `churn=${churn[path]}` : '',
    ]
      .filter(Boolean)
      .join(';');
  }
  return entries;
}

/**
 * Parse `git status --porcelain`: two status characters, a space, then the
 * path. Real shapes this handles (verified against git, not from memory):
 *
 * ```
 *  M src/a.ts                             unstaged modification
 * D  src/b.ts                             staged delete
 * A  src/d.ts                             staged add
 * R  src/toRename.ts -> src/renamed.ts    staged rename
 * ?? src/c.ts                             untracked file
 * ?? .ainp-artifacts/                     untracked DIRECTORY — git collapses
 * A  "src/a b.ts"                         path needing quotes
 * ```
 *
 * The collapsed-directory form is why the staging-dir exclusion compares a
 * `.ainp-artifacts/` prefix rather than expecting file paths underneath it.
 */
export function parseGitStatusPorcelain(stdout: string): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const line of stdout.split('\n')) {
    if (line.length < 4) continue;
    const code = line.slice(0, 2);
    const rest = line.slice(3);
    // Renames and copies are the only codes that carry two paths. Both are a
    // change at each end, so record them separately — evidence should name the
    // file that disappeared as well as the one that appeared.
    const pairSplit = rest.split(' -> ');
    if ((code.includes('R') || code.includes('C')) && pairSplit.length === 2) {
      entries[unquoteGitPath(pairSplit[0] ?? '')] = `${code}:source`;
      entries[unquoteGitPath(pairSplit[1] ?? '')] = `${code}:target`;
      continue;
    }
    const path = unquoteGitPath(rest);
    if (path) entries[path] = code;
  }
  return entries;
}

/**
 * Parse `git diff --stat`: ` <path> | <churn>`, plus a trailing
 * ` N files changed, …` summary line that carries no `|` and is skipped.
 * Renames render as ` src/{old.ts => new.ts} | 0`; we key on the new path.
 */
export function parseGitDiffStat(stdout: string): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const line of stdout.split('\n')) {
    const separator = line.lastIndexOf('|');
    if (separator < 0) continue;
    const rawPath = line.slice(0, separator).trim();
    const churn = line.slice(separator + 1).trim();
    const path = unquoteGitPath(expandGitDiffStatRename(rawPath));
    if (path) entries[path] = churn;
  }
  return entries;
}

function expandGitDiffStatRename(rawPath: string): string {
  return rawPath.replace(/\{(.*?) => (.*?)\}/g, '$2').replace(/\/{2,}/g, '/');
}

function unquoteGitPath(raw: string): string {
  const value = raw.trim();
  if (!value.startsWith('"') || !value.endsWith('"') || value.length < 2) return value;
  return value.slice(1, -1).replace(/\\(["\\])/g, '$1');
}

/**
 * Paths whose state differs between the two fingerprints. Comparing the delta
 * (not absolute dirtiness) is what makes the guard usable at all: review runs
 * on the very worktree the implementation stage already dirtied, so "the
 * worktree has changes" is the normal case, and only *new* changes are the
 * reviewer's doing.
 */
export function workspaceFingerprintDelta(
  before: WorkspaceFingerprint,
  after: WorkspaceFingerprint,
): string[] {
  const comparable = before.churnAvailable && after.churnAvailable;
  const beforeEntries = comparable ? before.entries : dropChurn(before.entries);
  const afterEntries = comparable ? after.entries : dropChurn(after.entries);
  const changed: string[] = [];
  for (const path of new Set([...Object.keys(beforeEntries), ...Object.keys(afterEntries)])) {
    if (isPlatformStagingPath(path)) continue;
    if (beforeEntries[path] !== afterEntries[path]) changed.push(path);
  }
  return changed.sort();
}

function dropChurn(entries: Record<string, string>): Record<string, string> {
  const stripped: Record<string, string> = {};
  for (const [path, token] of Object.entries(entries)) {
    const kept = token
      .split(';')
      .filter((part) => !part.startsWith('churn='))
      .join(';');
    if (kept) stripped[path] = kept;
  }
  return stripped;
}

/**
 * True for a directory the platform itself stages through inside the worktree.
 * Excluded from every comparison, because the runner copies these out rather
 * than shipping them:
 *
 *  - `.ainp-artifacts/` — Codex has to write produced artifacts inside the
 *    worktree (its tool router rejects `apply_patch` outside `--cd`), so
 *    counting it would make every Codex reviewer fail its own contract.
 *  - `.ainp-verifier/` — the review stage's UI-evidence drop point. The review
 *    agent runs immediately before `executeVerifier` reads this directory, so
 *    the reviewer — the one skill declaring `deny` — is exactly who fills it.
 *
 * Both arrive as either a collapsed directory entry (`?? .ainp-verifier/`,
 * which is what `git status --porcelain` emits for an untracked directory) or
 * a path underneath it, so the prefix comparison has to cover both.
 */
export function isPlatformStagingPath(path: string): boolean {
  return WORKSPACE_PLATFORM_STAGING_DIRS.some((dir) => (
    path === dir || path.startsWith(`${dir}/`)
  ));
}

/**
 * Thrown when a skill breaks its contract. A plain Error on purpose: this is
 * a BUSINESS failure (the run goes `failed`), and `isOperationalError` must
 * not match it — see PRD ADR-2 and the `operational-error.ts` header, which
 * already excludes diff-scope violations by name.
 */
export class ExecutionContractViolationError extends Error {
  readonly violations: ExecutionContractViolation[];
  readonly changedPaths: string[];
  readonly skillId: string;

  constructor(input: {
    skillId: string;
    violations: ExecutionContractViolation[];
    changedPaths: string[];
  }) {
    super(
      `${input.skillId}: execution contract violated — ${executionContractViolationSummary(input.violations)}`,
    );
    this.name = 'ExecutionContractViolationError';
    this.violations = input.violations;
    this.changedPaths = input.changedPaths;
    this.skillId = input.skillId;
  }
}

export interface WorkspaceMutationMeasurement {
  changedPaths: string[];
  violations: ExecutionContractViolation[];
}

export function detectExecutionContractViolations(input: {
  contract: ExecutionContract;
  before: WorkspaceFingerprint | null;
  after: WorkspaceFingerprint | null;
}): WorkspaceMutationMeasurement {
  if (!input.before || !input.after) return { changedPaths: [], violations: [] };
  const changedPaths = workspaceFingerprintDelta(input.before, input.after);
  return {
    changedPaths,
    violations: evaluateExecutionContract({ contract: input.contract, changedPaths }),
  };
}

export interface ExecutionContractGuardContext {
  workflowRunId: string;
  stepRunId?: string | null;
  workspacePath: string;
  artifactsDir: string;
}

export interface ExecutionContractGuardDeps {
  postArtifact: (input: {
    workflowRunId: string;
    stepRunId: string | null;
    kind: 'other';
    uri: string;
    size: number;
    contentType: string;
    metadata: Record<string, unknown>;
  }) => Promise<{ id: string }>;
}

/**
 * Take the "before" fingerprint, or null when the skill's contract asks for
 * no measurement. Skipping here (rather than measuring and ignoring) is what
 * keeps every `allow_any` skill on its exact pre-contract code path, git
 * subprocesses included.
 */
export async function captureExecutionContractBaseline(
  skill: SkillSpec,
  workspacePath: string,
): Promise<WorkspaceFingerprint | null> {
  const contract = resolveExecutionContract(skill.executionContract);
  if (!executionContractRequiresWorkspaceMeasurement(contract)) return null;
  const fingerprint = await captureWorkspaceFingerprint(workspacePath);
  if (!fingerprint) {
    console.warn(
      `[runner] ${skill.id}: workspace fingerprint unavailable at ${workspacePath}; execution contract not measured`,
    );
  }
  return fingerprint;
}

/**
 * Compare against the baseline and fail the step when the contract was
 * broken. Persists the violation as its own artifact first so the evidence
 * outlives the throw — R2's "可举证" half.
 */
export async function enforceExecutionContract(
  skill: SkillSpec,
  ctx: ExecutionContractGuardContext,
  before: WorkspaceFingerprint | null,
  deps: ExecutionContractGuardDeps,
): Promise<void> {
  if (!before) return;
  const contract = resolveExecutionContract(skill.executionContract);
  const after = await captureWorkspaceFingerprint(ctx.workspacePath);
  if (!after) {
    console.warn(
      `[runner] ${skill.id}: workspace fingerprint unavailable after the agent ran; execution contract not measured`,
    );
    return;
  }
  const { changedPaths, violations } = detectExecutionContractViolations({
    contract,
    before,
    after,
  });
  if (violations.length === 0) return;

  const error = new ExecutionContractViolationError({
    skillId: skill.id,
    violations,
    changedPaths,
  });
  await persistExecutionContractViolation(skill, ctx, { contract, changedPaths, violations }, deps);
  console.error(`[runner] ${error.message}`);
  throw error;
}

async function persistExecutionContractViolation(
  skill: SkillSpec,
  ctx: ExecutionContractGuardContext,
  measurement: {
    contract: ExecutionContract;
    changedPaths: string[];
    violations: ExecutionContractViolation[];
  },
  deps: ExecutionContractGuardDeps,
): Promise<void> {
  const envelope: ExecutionContractViolationEnvelope = {
    schemaVersion: EXECUTION_CONTRACT_VIOLATION_SCHEMA_VERSION,
    workflowRunId: ctx.workflowRunId,
    stepRunId: ctx.stepRunId ?? null,
    stage: skill.stage,
    skillId: skill.id,
    skillVersion: skill.version,
    contract: measurement.contract,
    changedPaths: measurement.changedPaths,
    violations: measurement.violations,
    detectedAt: nowIso(),
  };
  const body = `${JSON.stringify(envelope, null, 2)}\n`;
  try {
    await mkdir(ctx.artifactsDir, { recursive: true });
    const outputPath = join(ctx.artifactsDir, EXECUTION_CONTRACT_VIOLATION_OUTPUT_NAME);
    await writeFile(outputPath, body, 'utf8');
    await deps.postArtifact({
      workflowRunId: ctx.workflowRunId,
      stepRunId: ctx.stepRunId ?? null,
      kind: 'other',
      uri: pathToFileUri(outputPath),
      size: Buffer.byteLength(body, 'utf8'),
      contentType: 'application/json',
      metadata: {
        schemaVersion: EXECUTION_CONTRACT_VIOLATION_SCHEMA_VERSION,
        output: EXECUTION_CONTRACT_VIOLATION_OUTPUT_NAME,
        stage: skill.stage,
        skill: skill.id,
        skillVersion: skill.version,
        workspaceMutationPolicy: measurement.contract.workspaceMutationPolicy,
        violationKinds: measurement.violations.map((violation) => violation.kind),
        changedPathCount: measurement.changedPaths.length,
      },
    });
  } catch (err) {
    // Losing the evidence artifact must not swallow the violation itself —
    // the thrown error still carries the paths.
    console.warn(
      `[runner] ${skill.id}: execution contract violation evidence was not persisted: ${errorMessage(err)}`,
    );
  }
}
