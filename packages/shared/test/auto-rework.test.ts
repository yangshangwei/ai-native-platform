/**
 * 08-09 P1-2b bounded auto-rework (R1–R3) — the pure judgement.
 *
 * Every test here is a refusal test except the last few: the decision's job is
 * to say no, and a condition that silently stops guarding looks exactly like a
 * condition that is guarding. `auto-rework-trigger.test.ts` (api) covers the
 * same conditions end-to-end through the route.
 */
import { describe, expect, test } from 'vitest';
import {
  AUTO_REWORK_FORBIDDEN_GATES,
  AUTO_REWORK_MAX_ATTEMPTS,
  autoReworkAttempts,
  autoReworkFingerprint,
  computeAutoReworkFingerprint,
  decideAutoRework,
  isAutoReworkForbiddenGate,
  withAutoReworkAttempt,
  type AutoReworkFailingGate,
  type AutoReworkSnapshot,
} from '../src/types/auto-rework';

function failingGate(overrides: Partial<AutoReworkFailingGate> = {}): AutoReworkFailingGate {
  return {
    gateId: 'compile_gate',
    failedRuleIds: ['compile.exit_code'],
    hasHumanDecision: false,
    ...overrides,
  };
}

/** A snapshot that satisfies every condition — each test breaks exactly one. */
function grantable(overrides: Partial<AutoReworkSnapshot> = {}): AutoReworkSnapshot {
  return {
    runStatus: 'failed',
    stage: 'build_test',
    ledger: {},
    failingGates: [failingGate()],
    failedCommandExits: ['compile=1'],
    hasActionableFeedback: true,
    ...overrides,
  };
}

describe('the baseline actually grants', () => {
  // Without this, every refusal test below would pass even if the decision
  // refused unconditionally.
  test('a snapshot meeting all five conditions is retried once', () => {
    const decision = decideAutoRework(grantable());
    expect(decision).toEqual({
      retry: true,
      stage: 'build_test',
      fingerprint: expect.any(String),
      attempt: 1,
    });
  });
});

describe('R3.1 — only a business failure', () => {
  test.each(['running', 'passed', 'awaiting_human', 'cancelled', 'pending'] as const)(
    'refuses a run whose status is %s',
    (runStatus) => {
      expect(decideAutoRework(grantable({ runStatus }))).toMatchObject({
        retry: false,
        reason: 'run_not_failed',
      });
    },
  );

  test('refuses a paused run — operational failures never spend the budget', () => {
    // Structurally this snapshot cannot arrive (pauses go to /workflow-paused),
    // but the judgement refuses it anyway so a future caller cannot route one
    // in by mistake.
    expect(decideAutoRework(grantable({ runStatus: 'paused' }))).toMatchObject({
      retry: false,
      reason: 'run_not_failed',
    });
  });
});

describe('R3.2 — forbidden and human-decided gates', () => {
  test.each(AUTO_REWORK_FORBIDDEN_GATES)('refuses when %s failed', (gateId) => {
    const decision = decideAutoRework(
      grantable({ failingGates: [failingGate({ gateId })] }),
    );
    expect(decision).toMatchObject({ retry: false, reason: 'forbidden_gate' });
    expect(isAutoReworkForbiddenGate(gateId)).toBe(true);
  });

  test('refuses even when a forbidden gate is only one of several failures', () => {
    expect(
      decideAutoRework(
        grantable({
          failingGates: [failingGate(), failingGate({ gateId: 'sensitive_change_gate' })],
        }),
      ),
    ).toMatchObject({ retry: false, reason: 'forbidden_gate' });
  });

  test('refuses a gate a human already ruled on', () => {
    expect(
      decideAutoRework(
        grantable({ failingGates: [failingGate({ hasHumanDecision: true })] }),
      ),
    ).toMatchObject({ retry: false, reason: 'human_decided_gate' });
  });

  test('refuses when nothing identifiable failed', () => {
    // A thrown error leaves no failing gate. Retrying blind is the coin flip
    // this feature exists to avoid, and the fingerprint would be meaningless.
    expect(decideAutoRework(grantable({ failingGates: [] }))).toMatchObject({
      retry: false,
      reason: 'unattributed_failure',
    });
  });

  test('ordinary gates are not forbidden', () => {
    expect(isAutoReworkForbiddenGate('compile_gate')).toBe(false);
    expect(isAutoReworkForbiddenGate('test_gate')).toBe(false);
    expect(isAutoReworkForbiddenGate('acceptance_gate')).toBe(false);
  });
});

describe('R3.3 — per-(run, stage) budget', () => {
  test('refuses once the stage has spent its attempts', () => {
    expect(
      decideAutoRework(
        grantable({
          ledger: { build_test: { attempts: AUTO_REWORK_MAX_ATTEMPTS, fingerprint: 'other' } },
        }),
      ),
    ).toMatchObject({ retry: false, reason: 'budget_exhausted' });
  });

  test('another stage spending its budget does not block this one', () => {
    // (run, stage), not (run): implementation burning its attempt must leave
    // review's untouched.
    expect(
      decideAutoRework(
        grantable({
          stage: 'review',
          ledger: { implementation: { attempts: AUTO_REWORK_MAX_ATTEMPTS, fingerprint: 'x' } },
        }),
      ),
    ).toMatchObject({ retry: true, stage: 'review' });
  });

  test('an explicit cap overrides the default in both directions', () => {
    const ledger = { build_test: { attempts: 1, fingerprint: 'other' } };
    expect(decideAutoRework(grantable({ ledger, maxAttempts: 2 }))).toMatchObject({
      retry: true,
      attempt: 2,
    });
    expect(decideAutoRework(grantable({ ledger: {}, maxAttempts: 0 }))).toMatchObject({
      retry: false,
      reason: 'budget_exhausted',
    });
  });
});

describe('R3.4 — no-progress fingerprint', () => {
  test('refuses an identical failure even with budget left', () => {
    const snapshot = grantable({ maxAttempts: 5 });
    const fingerprint = computeAutoReworkFingerprint({
      stage: snapshot.stage,
      failingGates: snapshot.failingGates,
      failedCommandExits: snapshot.failedCommandExits,
    });
    expect(
      decideAutoRework({
        ...snapshot,
        ledger: { build_test: { attempts: 1, fingerprint } },
      }),
    ).toMatchObject({ retry: false, reason: 'no_progress' });
  });

  test('a different failure with budget left is retried', () => {
    expect(
      decideAutoRework(
        grantable({
          maxAttempts: 5,
          ledger: { build_test: { attempts: 1, fingerprint: 'stage=build_test|rules=|exits=' } },
        }),
      ),
    ).toMatchObject({ retry: true, attempt: 2 });
  });

  test('is stable under rule and command ordering', () => {
    // The whole stop depends on this: if iteration order leaked in, every
    // comparison would look like progress and the check would never fire.
    const a = computeAutoReworkFingerprint({
      stage: 'build_test',
      failingGates: [
        failingGate({ failedRuleIds: ['b', 'a'] }),
        failingGate({ gateId: 'test_gate', failedRuleIds: ['z'] }),
      ],
      failedCommandExits: ['test=2', 'compile=1'],
    });
    const b = computeAutoReworkFingerprint({
      stage: 'build_test',
      failingGates: [
        failingGate({ gateId: 'test_gate', failedRuleIds: ['z'] }),
        failingGate({ failedRuleIds: ['a', 'b'] }),
      ],
      failedCommandExits: ['compile=1', 'test=2'],
    });
    expect(a).toBe(b);
  });

  test('distinguishes stage, failing rules, and exit codes', () => {
    const base = {
      stage: 'build_test' as const,
      failingGates: [failingGate()],
      failedCommandExits: ['compile=1'],
    };
    const fingerprint = computeAutoReworkFingerprint(base);
    expect(computeAutoReworkFingerprint({ ...base, stage: 'review' })).not.toBe(fingerprint);
    expect(
      computeAutoReworkFingerprint({
        ...base,
        failingGates: [failingGate({ failedRuleIds: ['compile.other'] })],
      }),
    ).not.toBe(fingerprint);
    expect(
      computeAutoReworkFingerprint({ ...base, failedCommandExits: ['compile=2'] }),
    ).not.toBe(fingerprint);
  });
});

describe('R3.5 — something to act on (ADR-3)', () => {
  test('refuses when there is no remediation and no rejection comment', () => {
    expect(decideAutoRework(grantable({ hasActionableFeedback: false }))).toMatchObject({
      retry: false,
      reason: 'no_actionable_feedback',
    });
  });
});

describe('ledger arithmetic', () => {
  test('an empty ledger reads as zero attempts and no fingerprint', () => {
    expect(autoReworkAttempts({}, 'review')).toBe(0);
    expect(autoReworkFingerprint({}, 'review')).toBeNull();
  });

  test('recording an attempt is per-stage and leaves other stages alone', () => {
    const first = withAutoReworkAttempt({}, 'review', 'fp-1');
    expect(autoReworkAttempts(first, 'review')).toBe(1);
    expect(autoReworkFingerprint(first, 'review')).toBe('fp-1');

    const second = withAutoReworkAttempt(first, 'implementation', 'fp-2');
    expect(autoReworkAttempts(second, 'review')).toBe(1);
    expect(autoReworkAttempts(second, 'implementation')).toBe(1);
    expect(autoReworkFingerprint(second, 'review')).toBe('fp-1');
  });

  test('does not mutate the ledger it was given', () => {
    const ledger = {};
    withAutoReworkAttempt(ledger, 'review', 'fp');
    expect(ledger).toEqual({});
  });
});
