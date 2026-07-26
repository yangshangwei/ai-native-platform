import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  TEST_SURFACE_REPORT_SCHEMA_VERSION,
  countTestSurface,
  errorMessage,
  extractPomTestConfig,
  isJavaTestFile,
  type TestSurfaceFileEntry,
  type TestSurfaceReport,
} from '@ainp/shared';
import { sh } from './sh';

/**
 * Test-surface collector (test_integrity_gate evidence).
 *
 * The implementation stage produces uncommitted working-tree changes only
 * (its toolPolicy has no commit), so the doer-turn baseline is worktree
 * `HEAD`. This collector diffs HEAD vs the working tree, counts the Java
 * test surface on both sides via the shared pure functions, and assembles
 * a `TestSurfaceReport` the API-side Gate Engine judges.
 *
 * Failure philosophy (PRD R6, fail-open):
 *   - any git failure (rev-parse / diff / show) → `baselineAvailable: false`
 *     + a note; the gate skips every rule with a `not applicable:` message;
 *   - a workspace file read failure → note + missing `after` counts on that
 *     entry; the gate skips only the rules that needed those counts.
 * This function never throws.
 */
export async function collectTestSurfaceReport(workspacePath: string): Promise<TestSurfaceReport> {
  const notes: string[] = [];
  const files: TestSurfaceFileEntry[] = [];
  const changedPaths: string[] = [];
  let pomTestConfigChanged = false;
  let baselineAvailable = true;

  const failOpen = (baseRef: string | null): TestSurfaceReport => ({
    schemaVersion: TEST_SURFACE_REPORT_SCHEMA_VERSION,
    baseRef,
    files,
    harness: { changedPaths, pomTestConfigChanged },
    baselineAvailable: false,
    notes,
  });

  const headOut = await git(workspacePath, ['rev-parse', 'HEAD'], notes);
  if (headOut === null) return failOpen(null);
  const baseRef = headOut.trim();

  // -M pairs renames so a moved test file is compared old-vs-new instead of
  // being misread as a deletion. The doer turn never stages (implementation
  // toolPolicy has no `git add`), so new paths are untracked and invisible to
  // a plain `git diff HEAD` — a worktree rename would read as a bare `D`.
  // A throwaway index (seeded from HEAD + intent-to-add) lets untracked files
  // join rename detection without touching the real index.
  const diffOut = await renameAwareNameStatus(workspacePath, notes);
  if (diffOut === null) return failOpen(baseRef);

  for (const line of diffOut.split('\n')) {
    if (!line.trim()) continue;
    const cols = line.split('\t');
    const rawStatus = cols[0] ?? '';
    const renamed = rawStatus.startsWith('R') || rawStatus.startsWith('C');
    const oldPath = renamed ? cols[1] : undefined;
    const path = renamed ? cols[2] : cols[1];
    if (!path) {
      notes.push(`unparsable name-status line: ${line}`);
      continue;
    }
    const status: TestSurfaceFileEntry['status'] = rawStatus.startsWith('R')
      ? 'renamed'
      : rawStatus.startsWith('C') || rawStatus === 'A'
        ? 'added'
        : rawStatus === 'D'
          ? 'deleted'
          : 'modified';

    if (isPomPath(path) || (oldPath && isPomPath(oldPath))) {
      const beforeText = status === 'added'
        ? ''
        : await git(workspacePath, ['show', `HEAD:${oldPath ?? path}`], notes);
      if (beforeText === null) return failOpen(baseRef);
      const afterText = status === 'deleted' ? '' : await readWorkspaceFile(workspacePath, path, notes);
      if (afterText === null) {
        // Cannot compare — record the doubt without inventing a verdict.
        baselineAvailable = false;
        continue;
      }
      if (extractPomTestConfig(beforeText) !== extractPomTestConfig(afterText)) {
        pomTestConfigChanged = true;
      }
      continue;
    }

    if (isHarnessPath(path) || (oldPath && isHarnessPath(oldPath))) {
      changedPaths.push(oldPath && oldPath !== path ? `${oldPath} -> ${path}` : path);
      continue;
    }

    const oldIsTest = Boolean(oldPath && isJavaTestFile(oldPath));
    const newIsTest = isJavaTestFile(path);
    if (!oldIsTest && !newIsTest) continue;

    const entry: TestSurfaceFileEntry = { path, status };
    if (oldPath) entry.oldPath = oldPath;
    if (status !== 'added' && (status !== 'renamed' || oldIsTest)) {
      const beforeText = await git(workspacePath, ['show', `HEAD:${oldPath ?? path}`], notes);
      if (beforeText === null) return failOpen(baseRef);
      entry.before = countTestSurface(beforeText);
    }
    if (status !== 'deleted' && newIsTest) {
      const afterText = await readWorkspaceFile(workspacePath, path, notes);
      if (afterText !== null) entry.after = countTestSurface(afterText);
    }
    files.push(entry);
  }

  return {
    schemaVersion: TEST_SURFACE_REPORT_SCHEMA_VERSION,
    baseRef,
    files,
    harness: { changedPaths, pomTestConfigChanged },
    baselineAvailable,
    notes,
  };
}

function isPomPath(path: string): boolean {
  return path === 'pom.xml' || path.endsWith('/pom.xml');
}

function isHarnessPath(path: string): boolean {
  return (
    path === 'mvnw'
    || path === 'mvnw.cmd'
    || path.startsWith('.mvn/')
    || path.endsWith('/mvnw')
    || path.endsWith('/mvnw.cmd')
    || path.includes('/.mvn/')
  );
}

/**
 * `git diff --name-status -M HEAD` with untracked files visible to rename
 * detection. Points GIT_INDEX_FILE at a temp index seeded from HEAD, records
 * intent-to-add entries for the whole worktree (`add -A -N`, no blobs
 * written), and diffs HEAD against the worktree through that index. The real
 * index is never touched, so later diff captures are unaffected.
 */
async function renameAwareNameStatus(
  workspacePath: string,
  notes: string[],
): Promise<string | null> {
  const indexDir = await mkdtemp(join(tmpdir(), 'ainp-test-surface-index-'));
  const env = { GIT_INDEX_FILE: join(indexDir, 'index') };
  try {
    if (await git(workspacePath, ['read-tree', 'HEAD'], notes, env) === null) return null;
    if (await git(workspacePath, ['add', '-A', '-N'], notes, env) === null) return null;
    return await git(workspacePath, ['diff', '--name-status', '-M', 'HEAD'], notes, env);
  } finally {
    await rm(indexDir, { recursive: true, force: true });
  }
}

/** Runs a runner-internal git command; null + note on any failure. */
async function git(
  cwd: string,
  args: string[],
  notes: string[],
  env?: Record<string, string>,
): Promise<string | null> {
  try {
    const result = await sh('git', args, { cwd, env });
    if (result.exitCode !== 0) {
      notes.push(`git ${args.join(' ')} failed (exit=${result.exitCode ?? 'null'}): ${result.stderr.trim().slice(0, 200)}`);
      return null;
    }
    return result.stdout;
  } catch (err) {
    notes.push(`git ${args.join(' ')} failed: ${errorMessage(err)}`);
    return null;
  }
}

async function readWorkspaceFile(
  workspacePath: string,
  path: string,
  notes: string[],
): Promise<string | null> {
  try {
    return await Bun.file(join(workspacePath, path)).text();
  } catch (err) {
    notes.push(`read failed: ${path}: ${errorMessage(err)}`);
    return null;
  }
}
