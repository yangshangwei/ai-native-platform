/**
 * OperationalError — typed classification for infrastructure / operations
 * failures (task 07-26 operational-unavailable-state, R1).
 *
 * An operational failure means the platform could not run the agent backend
 * at all (CLI missing / not logged in, hard timeout kill, spawn failure,
 * unparseable or missing CLI output). It is NOT a business verdict: gate
 * failures, compile/test failures, and diff-scope violations must never be
 * wrapped in this type — those keep the historical `failed` path.
 *
 * The orchestrator uses {@link isOperationalError} to route these errors to
 * the `workflow-paused` event (run/request status `paused`, worktree kept,
 * manual resume via retry-run) instead of `workflow-completed(ok=false)`.
 */

export const OPERATIONAL_ERROR_REASONS = [
  /** Backend CLI is missing, not logged in, or otherwise not runnable (preflight). */
  'backend_unavailable',
  /** The runner hard-timeout killed the backend CLI. */
  'backend_timeout',
  /** Spawn failure, non-zero CLI exit, or required outputs missing/unparseable. */
  'backend_protocol',
  /**
   * The reviewer ran and produced a well-formed `ReviewerVerdict` declaring
   * `status: 'unavailable'` — it could not reach a judgement (task 08-08
   * p0-2-typed-reviewerverdict-gate, ADR-1).
   *
   * Distinct from `backend_protocol`: the CLI worked fine, so reporting a
   * protocol fault would send operators looking at the wrong thing. Still
   * operational rather than business, because no verdict was produced at all —
   * this is not a gate failure and must not count as product rework.
   */
  'reviewer_unavailable',
] as const;

export type OperationalErrorReason = (typeof OPERATIONAL_ERROR_REASONS)[number];

export function isOperationalErrorReason(value: unknown): value is OperationalErrorReason {
  return typeof value === 'string'
    && (OPERATIONAL_ERROR_REASONS as readonly string[]).includes(value);
}

export class OperationalError extends Error {
  readonly reason: OperationalErrorReason;
  /** Original human-readable failure text (the pre-classification message). */
  readonly detail: string;

  constructor(reason: OperationalErrorReason, message: string, detail?: string) {
    super(message);
    this.name = 'OperationalError';
    this.reason = reason;
    this.detail = detail ?? message;
  }
}

/**
 * Cross-bundle-safe type guard. runner / api / web each bundle their own copy
 * of @ainp/shared, so `instanceof OperationalError` is NOT reliable across
 * package boundaries — match on the `name` marker plus a valid `reason`.
 */
export function isOperationalError(err: unknown): err is OperationalError {
  return err instanceof Error
    && err.name === 'OperationalError'
    && isOperationalErrorReason((err as { reason?: unknown }).reason);
}
