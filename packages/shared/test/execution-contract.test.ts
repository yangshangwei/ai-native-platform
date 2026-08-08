/**
 * 08-09 p0-3-executioncontract-reviewer-scope-creep (R1/R5) — ExecutionContract
 * type guards, defaults, and the pure violation judgement.
 */
import { describe, expect, test } from 'vitest';
import {
  DEFAULT_EXECUTION_CONTRACT,
  EXECUTION_CONTRACT_VIOLATION_KINDS,
  WORKSPACE_MUTATION_POLICIES,
  evaluateExecutionContract,
  executionContractOutputConflicts,
  executionContractRequiresWorkspaceMeasurement,
  executionContractViolationSummary,
  isExecutionContractViolationKind,
  isPathAllowedByExecutionContract,
  isWorkspaceMutationPolicy,
  resolveExecutionContract,
  type ExecutionContract,
} from '../src/types/execution-contract';

function contract(overrides: Partial<ExecutionContract> = {}): ExecutionContract {
  return { ...DEFAULT_EXECUTION_CONTRACT, ...overrides };
}

describe('WorkspaceMutationPolicy', () => {
  test('accepts every declared policy and rejects near-misses', () => {
    for (const policy of WORKSPACE_MUTATION_POLICIES) {
      expect(isWorkspaceMutationPolicy(policy)).toBe(true);
    }
    expect(isWorkspaceMutationPolicy('allow')).toBe(false);
    expect(isWorkspaceMutationPolicy('denied')).toBe(false);
    expect(isWorkspaceMutationPolicy('read_only')).toBe(false);
    expect(isWorkspaceMutationPolicy(undefined)).toBe(false);
  });

  test('violation kinds guard is exhaustive and narrow', () => {
    for (const kind of EXECUTION_CONTRACT_VIOLATION_KINDS) {
      expect(isExecutionContractViolationKind(kind)).toBe(true);
    }
    expect(isExecutionContractViolationKind('workspace_mutation')).toBe(false);
    expect(isExecutionContractViolationKind('expected_output_missing')).toBe(false);
  });
});

describe('default contract semantics', () => {
  test('an undeclared contract is allow_any and unbounded', () => {
    expect(DEFAULT_EXECUTION_CONTRACT).toEqual({
      workspaceMutationPolicy: 'allow_any',
      allowedPaths: [],
      maxChangedFiles: null,
      expectedOutputs: [],
    });
    expect(resolveExecutionContract(undefined)).toBe(DEFAULT_EXECUTION_CONTRACT);
    expect(resolveExecutionContract(null)).toBe(DEFAULT_EXECUTION_CONTRACT);
  });

  test('allow_any with no cap needs no measurement at all', () => {
    // This is what keeps every pre-contract skill on its original code path:
    // the runner never even spawns git for it.
    expect(executionContractRequiresWorkspaceMeasurement(DEFAULT_EXECUTION_CONTRACT)).toBe(false);
    expect(executionContractRequiresWorkspaceMeasurement(contract({ maxChangedFiles: 5 }))).toBe(true);
    expect(
      executionContractRequiresWorkspaceMeasurement(contract({ workspaceMutationPolicy: 'deny' })),
    ).toBe(true);
    expect(
      executionContractRequiresWorkspaceMeasurement(
        contract({ workspaceMutationPolicy: 'allow_declared', allowedPaths: ['src/**'] }),
      ),
    ).toBe(true);
  });

  test('allow_any never reports a violation however much changed', () => {
    const violations = evaluateExecutionContract({
      contract: DEFAULT_EXECUTION_CONTRACT,
      changedPaths: ['src/a.ts', 'package.json', 'docs/x.md'],
    });
    expect(violations).toEqual([]);
  });
});

describe('deny policy', () => {
  test('any changed path is a violation, and the paths are the evidence', () => {
    const violations = evaluateExecutionContract({
      contract: contract({ workspaceMutationPolicy: 'deny' }),
      changedPaths: ['src/b.ts', 'src/a.ts'],
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.kind).toBe('workspace_mutation_denied');
    expect(violations[0]?.paths).toEqual(['src/a.ts', 'src/b.ts']);
    expect(violations[0]?.message).toContain('2 path(s) changed');
  });

  test('no change means no violation', () => {
    expect(
      evaluateExecutionContract({
        contract: contract({ workspaceMutationPolicy: 'deny' }),
        changedPaths: [],
      }),
    ).toEqual([]);
  });

  test('duplicate paths collapse before counting', () => {
    const violations = evaluateExecutionContract({
      contract: contract({ workspaceMutationPolicy: 'deny' }),
      changedPaths: ['src/a.ts', 'src/a.ts'],
    });
    expect(violations[0]?.paths).toEqual(['src/a.ts']);
    expect(violations[0]?.message).toContain('1 path(s) changed');
  });
});

describe('allow_declared policy', () => {
  const declared = contract({
    workspaceMutationPolicy: 'allow_declared',
    allowedPaths: ['src/**', 'examples/**'],
  });

  test('changes inside the declared scope pass', () => {
    expect(
      evaluateExecutionContract({
        contract: declared,
        changedPaths: ['src/a.ts', 'src/deep/nested/b.ts', 'examples/demo/c.ts'],
      }),
    ).toEqual([]);
  });

  test('a dependency change outside the scope is reported (R3 "did too much")', () => {
    const violations = evaluateExecutionContract({
      contract: declared,
      changedPaths: ['src/a.ts', 'package.json', 'bun.lockb'],
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.kind).toBe('path_not_declared');
    expect(violations[0]?.paths).toEqual(['bun.lockb', 'package.json']);
    expect(violations[0]?.message).toContain('src/**, examples/**');
  });

  test('an untracked directory entry is matched by its prefix', () => {
    // `git status --porcelain` collapses a new directory to `?? src/newdir/`.
    expect(
      evaluateExecutionContract({ contract: declared, changedPaths: ['src/newdir/'] }),
    ).toEqual([]);
    const violations = evaluateExecutionContract({
      contract: declared,
      changedPaths: ['docs/'],
    });
    expect(violations[0]?.paths).toEqual(['docs/']);
  });
});

describe('isPathAllowedByExecutionContract', () => {
  test('** crosses directory separators, * does not', () => {
    expect(isPathAllowedByExecutionContract('src/a/b/c.ts', ['src/**'])).toBe(true);
    expect(isPathAllowedByExecutionContract('src/a/b/c.ts', ['src/*'])).toBe(false);
    expect(isPathAllowedByExecutionContract('src/c.ts', ['src/*'])).toBe(true);
  });

  test('**/ also matches zero segments', () => {
    expect(isPathAllowedByExecutionContract('a.ts', ['**/*.ts'])).toBe(true);
    expect(isPathAllowedByExecutionContract('deep/a.ts', ['**/*.ts'])).toBe(true);
    expect(isPathAllowedByExecutionContract('deep/a.md', ['**/*.ts'])).toBe(false);
  });

  test('regex metacharacters in a pattern stay literal', () => {
    expect(isPathAllowedByExecutionContract('src/a.ts', ['src/a.ts'])).toBe(true);
    expect(isPathAllowedByExecutionContract('src/axts', ['src/a.ts'])).toBe(false);
    expect(isPathAllowedByExecutionContract('src/(x)/a.ts', ['src/(x)/**'])).toBe(true);
  });

  test('? matches one non-separator character', () => {
    expect(isPathAllowedByExecutionContract('src/a.ts', ['src/?.ts'])).toBe(true);
    expect(isPathAllowedByExecutionContract('src/ab.ts', ['src/?.ts'])).toBe(false);
  });

  test('windows separators are normalized before matching', () => {
    expect(isPathAllowedByExecutionContract('src\\a\\b.ts', ['src/**'])).toBe(true);
  });

  test('an empty scope allows nothing, and blank patterns are ignored', () => {
    expect(isPathAllowedByExecutionContract('src/a.ts', [])).toBe(false);
    expect(isPathAllowedByExecutionContract('src/a.ts', ['  '])).toBe(false);
  });
});

describe('maxChangedFiles', () => {
  test('over the cap is scope creep even inside the declared scope', () => {
    const violations = evaluateExecutionContract({
      contract: contract({
        workspaceMutationPolicy: 'allow_declared',
        allowedPaths: ['src/**'],
        maxChangedFiles: 2,
      }),
      changedPaths: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.kind).toBe('max_changed_files_exceeded');
    expect(violations[0]?.message).toContain('at most 2');
    expect(violations[0]?.paths).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  test('exactly at the cap passes', () => {
    expect(
      evaluateExecutionContract({
        contract: contract({
          workspaceMutationPolicy: 'allow_declared',
          allowedPaths: ['src/**'],
          maxChangedFiles: 2,
        }),
        changedPaths: ['src/a.ts', 'src/b.ts'],
      }),
    ).toEqual([]);
  });

  test('an out-of-scope path over the cap reports both violations', () => {
    const violations = evaluateExecutionContract({
      contract: contract({
        workspaceMutationPolicy: 'allow_declared',
        allowedPaths: ['src/**'],
        maxChangedFiles: 1,
      }),
      changedPaths: ['src/a.ts', 'docs/x.md'],
    });
    expect(violations.map((violation) => violation.kind)).toEqual([
      'path_not_declared',
      'max_changed_files_exceeded',
    ]);
  });
});

describe('executionContractViolationSummary', () => {
  test('names the kind, the reason, and the paths', () => {
    const summary = executionContractViolationSummary(
      evaluateExecutionContract({
        contract: contract({ workspaceMutationPolicy: 'deny' }),
        changedPaths: ['src/a.ts'],
      }),
    );
    expect(summary).toContain('workspace_mutation_denied');
    expect(summary).toContain('src/a.ts');
  });

  test('bounds the path list so a runaway diff cannot flood the message', () => {
    const changedPaths = Array.from({ length: 25 }, (_, index) => `src/f${index}.ts`);
    const summary = executionContractViolationSummary(
      evaluateExecutionContract({
        contract: contract({ workspaceMutationPolicy: 'deny' }),
        changedPaths,
      }),
      3,
    );
    expect(summary).toContain('…(+22 more)');
  });
});

describe('executionContractOutputConflicts', () => {
  test('a skill without a contract has nothing to conflict with', () => {
    expect(
      executionContractOutputConflicts({
        outputs: [{ name: 'review.md', required: true }],
      }),
    ).toEqual([]);
  });

  test('agreeing declarations produce no conflict', () => {
    expect(
      executionContractOutputConflicts({
        outputs: [
          { name: 'review.md', required: true },
          { name: 'review-verdict.json', required: true },
          { name: 'optional.json', required: false },
        ],
        executionContract: contract({
          workspaceMutationPolicy: 'deny',
          expectedOutputs: ['review.md', 'review-verdict.json'],
        }),
      }),
    ).toEqual([]);
  });

  test('an expected output the skill never declares is a conflict', () => {
    expect(
      executionContractOutputConflicts({
        outputs: [{ name: 'review.md', required: true }],
        executionContract: contract({ expectedOutputs: ['review.md', 'ghost.json'] }),
      }),
    ).toEqual([{ outputName: 'ghost.json', reason: 'expected_output_not_declared' }]);
  });

  test('a required output the contract forgets is a conflict', () => {
    expect(
      executionContractOutputConflicts({
        outputs: [
          { name: 'review.md', required: true },
          { name: 'review-verdict.json', required: true },
        ],
        executionContract: contract({ expectedOutputs: ['review.md'] }),
      }),
    ).toEqual([{ outputName: 'review-verdict.json', reason: 'required_output_not_expected' }]);
  });
});
