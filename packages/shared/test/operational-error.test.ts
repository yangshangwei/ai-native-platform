/**
 * 07-26 operational-unavailable-state (R1) — OperationalError taxonomy tests.
 */
import { describe, expect, test } from 'vitest';
import {
  OPERATIONAL_ERROR_REASONS,
  OperationalError,
  isOperationalError,
  isOperationalErrorReason,
} from '../src/utils/operational-error';

describe('OperationalError', () => {
  test('carries reason, message, and detail (detail defaults to message)', () => {
    const err = new OperationalError('backend_timeout', 'claude exited -1 during implementation');
    expect(err.name).toBe('OperationalError');
    expect(err.reason).toBe('backend_timeout');
    expect(err.message).toBe('claude exited -1 during implementation');
    expect(err.detail).toBe('claude exited -1 during implementation');
  });

  test('explicit detail is preserved separately from message', () => {
    const err = new OperationalError('backend_unavailable', 'backend not ready', 'Claude Code is not ready (needs_login). Run `claude login`.');
    expect(err.message).toBe('backend not ready');
    expect(err.detail).toBe('Claude Code is not ready (needs_login). Run `claude login`.');
  });

  test('isOperationalError matches instances and cross-bundle shaped errors', () => {
    expect(isOperationalError(new OperationalError('backend_protocol', 'x'))).toBe(true);

    // Cross-bundle case: a different copy of the class produces a plain Error
    // with the marker name + reason — the guard must still match.
    const foreign = new Error('codex exited 3 for stage design');
    foreign.name = 'OperationalError';
    (foreign as Error & { reason: string }).reason = 'backend_protocol';
    expect(isOperationalError(foreign)).toBe(true);
  });

  test('isOperationalError rejects business errors and invalid reasons', () => {
    expect(isOperationalError(new Error('diff_scope_gate failed; aborting'))).toBe(false);
    expect(isOperationalError('backend_timeout')).toBe(false);
    expect(isOperationalError(null)).toBe(false);

    const wrongReason = new Error('x');
    wrongReason.name = 'OperationalError';
    (wrongReason as Error & { reason: string }).reason = 'gate_failed';
    expect(isOperationalError(wrongReason)).toBe(false);
  });

  test('isOperationalErrorReason validates the closed reason set', () => {
    for (const reason of OPERATIONAL_ERROR_REASONS) {
      expect(isOperationalErrorReason(reason)).toBe(true);
    }
    expect(isOperationalErrorReason('business_failure')).toBe(false);
    expect(isOperationalErrorReason(undefined)).toBe(false);
  });
});
