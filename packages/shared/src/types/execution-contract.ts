import type { Iso8601 } from './ids';
import type { WorkflowStage } from './workflow';

/**
 * ExecutionContract — what a skill invocation is allowed to do to the
 * workspace, stated so the platform can measure it (task 08-09
 * p0-3-executioncontract-reviewer-scope-creep, R1).
 *
 * Before this contract the only statement of write scope was
 * `ToolPolicy.writableGlobs`, and it had no enforcer: its single consumer
 * renders it into the prompt (`apps/runner/src/context/renderer.ts`), so it
 * was advice to the agent rather than a constraint on it. The contract adds
 * the platform-side half — an objective measurement the runner takes around
 * every agent invocation.
 *
 * The judgement lives here as a pure function so the write side (the runner
 * guard) and every read side (gate rule messages, UI evidence) agree on what
 * counts as a violation — the same single-judgement discipline
 * `deriveGraphRunStatus` and `parseReviewerVerdict` follow.
 *
 * A violation is a BUSINESS failure, never an `OperationalError`: the agent
 * did the wrong thing, the platform ran fine. See `operational-error.ts`,
 * which already excludes diff-scope violations by name.
 */

export const WORKSPACE_MUTATION_POLICIES = ['deny', 'allow_declared', 'allow_any'] as const;

export type WorkspaceMutationPolicy = (typeof WORKSPACE_MUTATION_POLICIES)[number];

export function isWorkspaceMutationPolicy(value: unknown): value is WorkspaceMutationPolicy {
  return typeof value === 'string'
    && (WORKSPACE_MUTATION_POLICIES as readonly string[]).includes(value);
}

export interface ExecutionContract {
  workspaceMutationPolicy: WorkspaceMutationPolicy;
  /** Only meaningful under `allow_declared`; same glob semantics as `writableGlobs`. */
  allowedPaths: string[];
  /** Exceeding this is scope creep; null means unbounded. */
  maxChangedFiles: number | null;
  /** Output names the invocation is expected to produce ("did too little"). */
  expectedOutputs: string[];
}

/**
 * What a skill gets when it declares no contract. `allow_any` keeps every
 * pre-contract skill behaving exactly as before — the guard measures nothing
 * and spawns no git process.
 */
export const DEFAULT_EXECUTION_CONTRACT: ExecutionContract = {
  workspaceMutationPolicy: 'allow_any',
  allowedPaths: [],
  maxChangedFiles: null,
  expectedOutputs: [],
};

export function resolveExecutionContract(
  contract: ExecutionContract | null | undefined,
): ExecutionContract {
  return contract ?? DEFAULT_EXECUTION_CONTRACT;
}

/**
 * True when the contract asks for no measurement at all. Callers use this to
 * skip fingerprint collection entirely rather than collect-then-ignore.
 */
export function executionContractRequiresWorkspaceMeasurement(
  contract: ExecutionContract,
): boolean {
  return contract.workspaceMutationPolicy !== 'allow_any'
    || contract.maxChangedFiles !== null;
}

export const EXECUTION_CONTRACT_VIOLATION_KINDS = [
  /** A `deny` skill changed the workspace at all. */
  'workspace_mutation_denied',
  /** An `allow_declared` skill changed a path outside `allowedPaths`. */
  'path_not_declared',
  /** More files changed than `maxChangedFiles` permits. */
  'max_changed_files_exceeded',
] as const;

export type ExecutionContractViolationKind = (typeof EXECUTION_CONTRACT_VIOLATION_KINDS)[number];

export function isExecutionContractViolationKind(
  value: unknown,
): value is ExecutionContractViolationKind {
  return typeof value === 'string'
    && (EXECUTION_CONTRACT_VIOLATION_KINDS as readonly string[]).includes(value);
}

export interface ExecutionContractViolation {
  kind: ExecutionContractViolationKind;
  /** Operator-facing sentence; safe to surface as a gate rule message. */
  message: string;
  /** The workspace-relative paths that prove it. This is the evidence. */
  paths: string[];
}

export interface ExecutionContractEvaluationInput {
  contract: ExecutionContract;
  /** Workspace-relative posix paths the invocation changed (git's view). */
  changedPaths: readonly string[];
}

/**
 * The single judgement: given a contract and what actually changed, what was
 * violated. Pure — the caller owns the measurement and the consequences.
 */
export function evaluateExecutionContract(
  input: ExecutionContractEvaluationInput,
): ExecutionContractViolation[] {
  const changed = [...new Set(input.changedPaths)].sort();
  const violations: ExecutionContractViolation[] = [];
  if (changed.length === 0) return violations;

  const { workspaceMutationPolicy: policy, allowedPaths, maxChangedFiles } = input.contract;
  if (policy === 'deny') {
    violations.push({
      kind: 'workspace_mutation_denied',
      message: `workspace mutation is denied for this step, but ${changed.length} path(s) changed`,
      paths: changed,
    });
  } else if (policy === 'allow_declared') {
    const undeclared = changed.filter((path) => !isPathAllowedByExecutionContract(path, allowedPaths));
    if (undeclared.length > 0) {
      violations.push({
        kind: 'path_not_declared',
        message: `${undeclared.length} path(s) changed outside the declared write scope (${allowedPaths.join(', ') || 'none declared'})`,
        paths: undeclared,
      });
    }
  }
  if (maxChangedFiles !== null && changed.length > maxChangedFiles) {
    violations.push({
      kind: 'max_changed_files_exceeded',
      message: `changed ${changed.length} path(s); the contract allows at most ${maxChangedFiles}`,
      paths: changed,
    });
  }
  return violations;
}

/**
 * Glob match against a declared write scope. `**` crosses directory
 * separators, `*` and `?` do not — the semantics `writableGlobs` already
 * implied when it was prompt-only text.
 */
export function isPathAllowedByExecutionContract(
  path: string,
  allowedPaths: readonly string[],
): boolean {
  const normalized = path.replace(/\\/g, '/');
  return allowedPaths.some((pattern) => {
    const trimmed = pattern.trim();
    if (!trimmed) return false;
    return globToRegExp(trimmed.replace(/\\/g, '/')).test(normalized);
  });
}

function globToRegExp(pattern: string): RegExp {
  let source = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        i += 1;
        // `**/` also matches zero segments, so `**/x.ts` covers a root-level x.ts.
        if (pattern[i + 1] === '/') {
          i += 1;
          source += '(?:.*/)?';
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
      continue;
    }
    if (ch === '?') {
      source += '[^/]';
      continue;
    }
    source += ch === undefined ? '' : ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

/** One line per violation, suitable for an error message or a gate rule message. */
export function executionContractViolationSummary(
  violations: readonly ExecutionContractViolation[],
  maxPathsPerViolation = 20,
): string {
  return violations
    .map((violation) => {
      const shown = violation.paths.slice(0, maxPathsPerViolation);
      const rest = violation.paths.length - shown.length;
      const paths = shown.join(', ') + (rest > 0 ? `, …(+${rest} more)` : '');
      return `${violation.kind}: ${violation.message}${paths ? ` [${paths}]` : ''}`;
    })
    .join('; ');
}

// ---------------------------------------------------------------------------
// Violation evidence artifact
// ---------------------------------------------------------------------------

export const EXECUTION_CONTRACT_VIOLATION_SCHEMA_VERSION = 'ainp.execution_contract_violation.v1' as const;

/** Artifact output name; distinct from every review / verifier output name. */
export const EXECUTION_CONTRACT_VIOLATION_OUTPUT_NAME = 'execution-contract-violation.json' as const;

export interface ExecutionContractViolationEnvelope {
  schemaVersion: typeof EXECUTION_CONTRACT_VIOLATION_SCHEMA_VERSION;
  workflowRunId: string;
  stepRunId: string | null;
  stage: WorkflowStage;
  skillId: string;
  skillVersion: string;
  contract: ExecutionContract;
  /** Everything the measurement saw change, before the contract was applied. */
  changedPaths: string[];
  violations: ExecutionContractViolation[];
  detectedAt: Iso8601;
}

// ---------------------------------------------------------------------------
// Contract / skill-outputs consistency (R3, "did too little")
// ---------------------------------------------------------------------------

export interface ExecutionContractOutputConflict {
  outputName: string;
  reason: 'expected_output_not_declared' | 'required_output_not_expected';
}

/**
 * Cross-check `expectedOutputs` against the skill's own output declarations.
 * Returns nothing for a skill that declares no contract — there is no second
 * declaration to disagree with.
 *
 * "Missing required output" is already enforced by the backends via
 * `SkillIO.required`, and 07-26 deliberately classifies it as an operational
 * pause rather than a business failure. So this task does NOT add a second
 * runtime check that would reclassify it — it keeps the two declarations from
 * drifting apart, which is exactly what R3 asks for.
 */
export function executionContractOutputConflicts(skill: {
  outputs: readonly { name: string; required: boolean }[];
  executionContract?: ExecutionContract;
}): ExecutionContractOutputConflict[] {
  const contract = skill.executionContract;
  if (!contract) return [];
  const declared = new Set(skill.outputs.map((output) => output.name));
  const required = skill.outputs.filter((output) => output.required).map((output) => output.name);
  const expected = new Set(contract.expectedOutputs);
  return [
    ...contract.expectedOutputs
      .filter((name) => !declared.has(name))
      .map((name) => ({ outputName: name, reason: 'expected_output_not_declared' as const })),
    ...required
      .filter((name) => !expected.has(name))
      .map((name) => ({ outputName: name, reason: 'required_output_not_expected' as const })),
  ];
}
