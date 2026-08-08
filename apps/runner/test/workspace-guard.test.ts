/**
 * 08-09 p0-3-executioncontract-reviewer-scope-creep (R2/R3/R5) — the
 * workspace-mutation guard.
 *
 * Two layers of coverage:
 *  - parser tests against `git status --porcelain` / `git diff --stat` output
 *    captured verbatim from a real repo (see the fixture comments);
 *  - end-to-end tests that drive the guard over an actual temp git repo, so
 *    the fixtures can never drift away from what git really prints.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { isOperationalError, type SkillSpec } from '@ainp/shared';
import { sh } from '../src/sh';
import { WORKSPACE_AGENT_STAGING_DIR, WORKSPACE_VERIFIER_MEDIA_DIR } from '../src/config';
import {
  ExecutionContractViolationError,
  captureExecutionContractBaseline,
  captureWorkspaceFingerprint,
  detectExecutionContractViolations,
  enforceExecutionContract,
  isPlatformStagingPath,
  parseGitDiffStat,
  parseGitStatusPorcelain,
  workspaceFingerprintDelta,
  workspaceFingerprintEntries,
  type WorkspaceFingerprint,
} from '../src/orchestrator/workspace-guard';

// ---------------------------------------------------------------------------
// Fixtures — captured verbatim from `git status --porcelain` on a scratch repo
// (macOS, git 2.x). Two status characters, a space, then the path. Note the
// untracked DIRECTORY collapse on `.ainp-artifacts/`: git does not list the
// files underneath it, which is exactly the shape the exclusion must handle.
// ---------------------------------------------------------------------------
const REAL_PORCELAIN = [
  ' M src/a.ts',
  'D  src/b.ts',
  'A  src/d.ts',
  'R  src/toRename.ts -> src/renamed.ts',
  '?? .ainp-artifacts/',
  '?? src/c.ts',
].join('\n');

// Captured verbatim from `git diff --stat=4096,4096 HEAD` on the same repo.
const REAL_DIFF_STAT = [
  ' src/a.ts                        | 1 +',
  ' src/b.ts                        | 1 -',
  ' src/d.ts                        | 1 +',
  ' src/{toRename.ts => renamed.ts} | 0',
  ' 4 files changed, 2 insertions(+), 1 deletion(-)',
].join('\n');

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

async function makeWorktree(): Promise<string> {
  const repo = mkdtempSync(join(tmpdir(), 'ainp-workspace-guard-'));
  tempDirs.push(repo);
  await sh('git', ['init', '-b', 'main'], { cwd: repo });
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 1;\n', 'utf8');
  writeFileSync(join(repo, 'package.json'), '{"name":"fixture"}\n', 'utf8');
  await sh('git', ['add', '-A'], { cwd: repo });
  await sh(
    'git',
    ['-c', 'user.email=ainp@test', '-c', 'user.name=ainp', 'commit', '-m', 'initial'],
    { cwd: repo },
  );
  return repo;
}

function skill(overrides: Partial<SkillSpec> = {}): SkillSpec {
  return {
    id: 'skill.test',
    version: '0.1.0',
    stage: 'review',
    instructions: '',
    inputs: [],
    outputs: [],
    toolPolicy: { allowedCommands: [], writableGlobs: [], networkAllowed: false },
    requiredGates: [],
    compatibleBackends: ['claude_code', 'codex'],
    ...overrides,
  };
}

const denySkill = skill({
  id: 'skill.review',
  executionContract: {
    workspaceMutationPolicy: 'deny',
    allowedPaths: [],
    maxChangedFiles: null,
    expectedOutputs: [],
  },
});

function guardCtx(workspacePath: string, artifactsDir: string) {
  return {
    workflowRunId: 'run_test',
    stepRunId: 'step_test',
    workspacePath,
    artifactsDir,
  };
}

function recordingDeps() {
  const posted: Array<{ kind: string; metadata: Record<string, unknown> }> = [];
  return {
    posted,
    deps: {
      postArtifact: async (input: { kind: 'other'; metadata: Record<string, unknown> }) => {
        posted.push({ kind: input.kind, metadata: input.metadata });
        return { id: 'art_violation' };
      },
    },
  };
}

describe('parseGitStatusPorcelain', () => {
  test('reads every real status shape, keyed by path', () => {
    expect(parseGitStatusPorcelain(REAL_PORCELAIN)).toEqual({
      'src/a.ts': ' M',
      'src/b.ts': 'D ',
      'src/d.ts': 'A ',
      // A rename is a change at both ends; evidence should name both.
      'src/toRename.ts': 'R :source',
      'src/renamed.ts': 'R :target',
      '.ainp-artifacts/': '??',
      'src/c.ts': '??',
    });
  });

  test('a copy also carries two paths', () => {
    // Unlike every other fixture in this file, this one is NOT captured
    // output: `git status` leaves copy detection off, and it would not emit a
    // `C` code even with `status.renames=copies` in a scratch repo. The code
    // and the `<orig> -> <path>` field shape come from git's documented
    // porcelain v1 format, and the branch exists so a `C` line — if a host's
    // config ever produces one — yields two real paths instead of one mangled
    // `a -> b` string in the evidence.
    expect(parseGitStatusPorcelain('C  src/a.ts -> src/copy.ts')).toEqual({
      'src/a.ts': 'C :source',
      'src/copy.ts': 'C :target',
    });
  });

  test('unquotes a path git had to quote', () => {
    expect(parseGitStatusPorcelain('A  "src/a b.ts"')).toEqual({ 'src/a b.ts': 'A ' });
  });

  test('ignores blank and truncated lines', () => {
    expect(parseGitStatusPorcelain('\n \n?? \n')).toEqual({});
  });
});

describe('parseGitDiffStat', () => {
  test('reads paths and churn, skipping the summary line', () => {
    expect(parseGitDiffStat(REAL_DIFF_STAT)).toEqual({
      'src/a.ts': '1 +',
      'src/b.ts': '1 -',
      'src/d.ts': '1 +',
      // git renders a rename as `src/{old => new}`; the new path is the key.
      'src/renamed.ts': '0',
    });
  });

  test('handles the brace form that adds or drops a directory segment', () => {
    expect(parseGitDiffStat(' src/{ => nested}/a.ts | 2 ++')).toEqual({
      'src/nested/a.ts': '2 ++',
    });
    expect(parseGitDiffStat(' src/{nested => }/a.ts | 2 --')).toEqual({
      'src/a.ts': '2 --',
    });
  });

  test('keeps binary churn as-is', () => {
    expect(parseGitDiffStat(' assets/logo.png | Bin 0 -> 12 bytes')).toEqual({
      'assets/logo.png': 'Bin 0 -> 12 bytes',
    });
  });
});

describe('workspaceFingerprintDelta', () => {
  function fingerprint(
    statusStdout: string,
    diffStatStdout = '',
    churnAvailable = true,
  ): WorkspaceFingerprint {
    return { entries: workspaceFingerprintEntries(statusStdout, diffStatStdout), churnAvailable };
  }

  test('an unchanged workspace has no delta even while it is dirty', () => {
    // The review stage runs on the worktree the implementation already
    // dirtied, so "dirty" must not by itself mean "the reviewer wrote".
    const before = fingerprint(REAL_PORCELAIN, REAL_DIFF_STAT);
    const after = fingerprint(REAL_PORCELAIN, REAL_DIFF_STAT);
    expect(workspaceFingerprintDelta(before, after)).toEqual([]);
  });

  test('a further edit to an already-modified file is caught by churn', () => {
    // The porcelain code stays ` M src/a.ts`; only the stat line moves.
    const before = fingerprint(' M src/a.ts', ' src/a.ts | 1 +');
    const after = fingerprint(' M src/a.ts', ' src/a.ts | 2 ++');
    expect(workspaceFingerprintDelta(before, after)).toEqual(['src/a.ts']);
  });

  test('a new untracked file appears in the delta', () => {
    const before = fingerprint('');
    const after = fingerprint('?? notes.md');
    expect(workspaceFingerprintDelta(before, after)).toEqual(['notes.md']);
  });

  test('churn is dropped from comparison when either side could not read it', () => {
    const before = fingerprint(' M src/a.ts', ' src/a.ts | 1 +', false);
    const after = fingerprint(' M src/a.ts', ' src/a.ts | 2 ++', true);
    expect(workspaceFingerprintDelta(before, after)).toEqual([]);
  });
});

describe('platform staging dir exclusion', () => {
  test('matches the collapsed directory entry and everything under it', () => {
    for (const dir of [WORKSPACE_AGENT_STAGING_DIR, WORKSPACE_VERIFIER_MEDIA_DIR]) {
      expect(isPlatformStagingPath(`${dir}/`)).toBe(true);
      expect(isPlatformStagingPath(dir)).toBe(true);
      expect(isPlatformStagingPath(`${dir}/review/review.md`)).toBe(true);
    }
    expect(isPlatformStagingPath('src/.ainp-artifacts-notes.md')).toBe(false);
    expect(isPlatformStagingPath('src/.ainp-verifier-notes.md')).toBe(false);
    expect(isPlatformStagingPath('src/a.ts')).toBe(false);
  });

  test('a Codex sidecar write does not make the reviewer look guilty', () => {
    const before: WorkspaceFingerprint = {
      entries: workspaceFingerprintEntries(' M src/a.ts', ' src/a.ts | 1 +'),
      churnAvailable: true,
    };
    const after: WorkspaceFingerprint = {
      entries: workspaceFingerprintEntries(
        [' M src/a.ts', `?? ${WORKSPACE_AGENT_STAGING_DIR}/`].join('\n'),
        ' src/a.ts | 1 +',
      ),
      churnAvailable: true,
    };
    expect(workspaceFingerprintDelta(before, after)).toEqual([]);
    expect(
      detectExecutionContractViolations({
        contract: denySkill.executionContract!,
        before,
        after,
      }),
    ).toEqual({ changedPaths: [], violations: [] });
  });
});

describe('detectExecutionContractViolations', () => {
  test('degrades to "not measured" when a fingerprint is missing', () => {
    const present: WorkspaceFingerprint = { entries: { 'src/a.ts': 'status=??' }, churnAvailable: true };
    expect(
      detectExecutionContractViolations({
        contract: denySkill.executionContract!,
        before: null,
        after: present,
      }),
    ).toEqual({ changedPaths: [], violations: [] });
    expect(
      detectExecutionContractViolations({
        contract: denySkill.executionContract!,
        before: present,
        after: null,
      }),
    ).toEqual({ changedPaths: [], violations: [] });
  });
});

describe('captureExecutionContractBaseline', () => {
  test('an allow_any skill is never measured', async () => {
    // No contract declared: the guard must not even look at the workspace, so
    // a path that is not a git repo at all is fine.
    expect(await captureExecutionContractBaseline(skill(), '/definitely/not/a/repo')).toBeNull();
  });

  test('a contract-bearing skill in a non-repo path degrades to null', async () => {
    const notARepo = mkdtempSync(join(tmpdir(), 'ainp-not-a-repo-'));
    tempDirs.push(notARepo);
    expect(await captureExecutionContractBaseline(denySkill, notARepo)).toBeNull();
  });

  test('a contract-bearing skill in a real worktree gets a fingerprint', async () => {
    const repo = await makeWorktree();
    const fingerprint = await captureExecutionContractBaseline(denySkill, repo);
    expect(fingerprint).not.toBeNull();
    expect(fingerprint?.churnAvailable).toBe(true);
  });
});

describe('enforceExecutionContract over a real git worktree', () => {
  test('a deny skill that writes fails with the file list as evidence', async () => {
    const repo = await makeWorktree();
    const artifactsDir = join(repo, '..', 'artifacts-deny');
    const { posted, deps } = recordingDeps();
    const before = await captureWorkspaceFingerprint(repo);

    // The reviewer edits the code it was supposed to be judging.
    writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 2;\n', 'utf8');

    const err = await enforceExecutionContract(denySkill, guardCtx(repo, artifactsDir), before, deps)
      .then(() => null)
      .catch((caught: unknown) => caught);

    expect(err).toBeInstanceOf(ExecutionContractViolationError);
    const violation = err as ExecutionContractViolationError;
    expect(violation.changedPaths).toEqual(['src/a.ts']);
    expect(violation.violations[0]?.kind).toBe('workspace_mutation_denied');
    expect(violation.violations[0]?.paths).toEqual(['src/a.ts']);
    expect(violation.message).toContain('src/a.ts');

    // ADR-2: a contract violation is a BUSINESS failure. Routing it through
    // the operational path would pause the run and stop counting it as rework.
    expect(isOperationalError(violation)).toBe(false);

    expect(posted).toHaveLength(1);
    expect(posted[0]?.kind).toBe('other');
    expect(posted[0]?.metadata.schemaVersion).toBe('ainp.execution_contract_violation.v1');
    expect(posted[0]?.metadata.output).toBe('execution-contract-violation.json');
    expect(posted[0]?.metadata.violationKinds).toEqual(['workspace_mutation_denied']);
    expect(posted[0]?.metadata.changedPathCount).toBe(1);
  });

  test('a deny skill that writes only into the staging dir passes', async () => {
    const repo = await makeWorktree();
    const { posted, deps } = recordingDeps();
    const before = await captureWorkspaceFingerprint(repo);

    // What Codex actually does for a produce-file stage.
    mkdirSync(join(repo, WORKSPACE_AGENT_STAGING_DIR, 'review'), { recursive: true });
    writeFileSync(
      join(repo, WORKSPACE_AGENT_STAGING_DIR, 'review', 'review.md'),
      '# review\n',
      'utf8',
    );

    await expect(
      enforceExecutionContract(denySkill, guardCtx(repo, join(repo, '..', 'a')), before, deps),
    ).resolves.toBeUndefined();
    expect(posted).toEqual([]);
  });

  test('a deny skill that drops UI evidence in the verifier dir passes', async () => {
    // `executeVerifier` runs right after the review agent and reads
    // `<worktree>/.ainp-verifier/`, copying each file out to the run artifacts
    // dir. The reviewer is therefore the expected author of these files, and
    // it is also the skill declaring `deny` — without the exclusion, every UI
    // review that supplied its screenshots would fail its own contract.
    const repo = await makeWorktree();
    const { posted, deps } = recordingDeps();
    const before = await captureWorkspaceFingerprint(repo);

    mkdirSync(join(repo, WORKSPACE_VERIFIER_MEDIA_DIR), { recursive: true });
    writeFileSync(join(repo, WORKSPACE_VERIFIER_MEDIA_DIR, 'before.png'), 'png', 'utf8');
    writeFileSync(join(repo, WORKSPACE_VERIFIER_MEDIA_DIR, 'after.png'), 'png', 'utf8');

    await expect(
      enforceExecutionContract(denySkill, guardCtx(repo, join(repo, '..', 'a')), before, deps),
    ).resolves.toBeUndefined();
    expect(posted).toEqual([]);
  });

  test('a deny skill that touches nothing passes', async () => {
    const repo = await makeWorktree();
    const { deps } = recordingDeps();
    const before = await captureWorkspaceFingerprint(repo);
    await expect(
      enforceExecutionContract(denySkill, guardCtx(repo, join(repo, '..', 'a')), before, deps),
    ).resolves.toBeUndefined();
  });

  test('an allow_declared skill staying inside its scope passes', async () => {
    const repo = await makeWorktree();
    const { deps } = recordingDeps();
    const implementation = skill({
      id: 'skill.implementation',
      stage: 'implementation',
      executionContract: {
        workspaceMutationPolicy: 'allow_declared',
        allowedPaths: ['src/**'],
        maxChangedFiles: null,
        expectedOutputs: [],
      },
    });
    const before = await captureWorkspaceFingerprint(repo);
    writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 2;\n', 'utf8');
    writeFileSync(join(repo, 'src', 'new.ts'), 'export const n = 1;\n', 'utf8');
    await expect(
      enforceExecutionContract(implementation, guardCtx(repo, join(repo, '..', 'a')), before, deps),
    ).resolves.toBeUndefined();
  });

  test('an allow_declared skill editing a lockfile outside its scope fails', async () => {
    const repo = await makeWorktree();
    const { posted, deps } = recordingDeps();
    const implementation = skill({
      id: 'skill.implementation',
      stage: 'implementation',
      executionContract: {
        workspaceMutationPolicy: 'allow_declared',
        allowedPaths: ['src/**'],
        maxChangedFiles: null,
        expectedOutputs: [],
      },
    });
    const before = await captureWorkspaceFingerprint(repo);
    writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 2;\n', 'utf8');
    writeFileSync(join(repo, 'package.json'), '{"name":"fixture","dependencies":{}}\n', 'utf8');

    const err = await enforceExecutionContract(
      implementation,
      guardCtx(repo, join(repo, '..', 'a')),
      before,
      deps,
    )
      .then(() => null)
      .catch((caught: unknown) => caught as ExecutionContractViolationError);

    expect(err).toBeInstanceOf(ExecutionContractViolationError);
    expect(err?.violations[0]?.kind).toBe('path_not_declared');
    expect(err?.violations[0]?.paths).toEqual(['package.json']);
    expect(err?.changedPaths).toEqual(['package.json', 'src/a.ts']);
    expect(posted[0]?.metadata.violationKinds).toEqual(['path_not_declared']);
  });

  test('an allow_declared skill over maxChangedFiles fails on scope creep', async () => {
    const repo = await makeWorktree();
    const { deps } = recordingDeps();
    const capped = skill({
      id: 'skill.implementation',
      stage: 'implementation',
      executionContract: {
        workspaceMutationPolicy: 'allow_declared',
        allowedPaths: ['src/**'],
        maxChangedFiles: 1,
        expectedOutputs: [],
      },
    });
    const before = await captureWorkspaceFingerprint(repo);
    writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 2;\n', 'utf8');
    writeFileSync(join(repo, 'src', 'b.ts'), 'export const b = 1;\n', 'utf8');

    const err = await enforceExecutionContract(capped, guardCtx(repo, join(repo, '..', 'a')), before, deps)
      .then(() => null)
      .catch((caught: unknown) => caught as ExecutionContractViolationError);

    expect(err?.violations.map((violation) => violation.kind)).toEqual([
      'max_changed_files_exceeded',
    ]);
    expect(err?.changedPaths).toEqual(['src/a.ts', 'src/b.ts']);
  });

  test('a null baseline means the step is not measured, never failed', async () => {
    const repo = await makeWorktree();
    const { deps } = recordingDeps();
    writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 3;\n', 'utf8');
    await expect(
      enforceExecutionContract(denySkill, guardCtx(repo, join(repo, '..', 'a')), null, deps),
    ).resolves.toBeUndefined();
  });

  test('a deleted file is caught as a workspace mutation', async () => {
    const repo = await makeWorktree();
    const { deps } = recordingDeps();
    const before = await captureWorkspaceFingerprint(repo);
    rmSync(join(repo, 'src', 'a.ts'));

    const err = await enforceExecutionContract(denySkill, guardCtx(repo, join(repo, '..', 'a')), before, deps)
      .then(() => null)
      .catch((caught: unknown) => caught as ExecutionContractViolationError);

    expect(err?.changedPaths).toEqual(['src/a.ts']);
  });
});
