/**
 * 08-08 p0-2-typed-reviewerverdict-gate (R6) — ReviewerVerdict contract tests.
 *
 * `parseReviewerVerdict` is the single judgement of "what is a legal verdict",
 * called by the runner (write side) and the api Gate Engine (verify side). A
 * rejection rule that regresses here silently widens what both sides accept,
 * so every rejection path gets its own case.
 */
import { describe, expect, test } from 'vitest';
import {
  REVIEW_BLOCKER_SEVERITIES,
  REVIEW_MARKDOWN_OUTPUT_NAME,
  REVIEW_VERDICT_OUTPUT_NAME,
  REVIEW_VERDICT_ROLES,
  REVIEW_VERDICT_SCHEMA_VERSION,
  REVIEW_VERDICT_STATUSES,
  isReviewBlockerSeverity,
  isReviewVerdictRole,
  isReviewVerdictStatus,
  parseReviewerVerdict,
  type ReviewerVerdict,
} from '../src';

/** A legal verdict body; overrides drive each rejection case. */
function verdictBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: REVIEW_VERDICT_SCHEMA_VERSION,
    role: 'reviewer',
    status: 'pass',
    summary: 'Change is scoped and covered by tests.',
    blocking: [],
    remediation: [],
    advisory: [],
    evidenceRefs: [],
    provenance: {
      agentSessionId: 'ags_1',
      backend: 'claude_code',
      skillId: 'skill.review',
      producedAt: '2026-08-08T00:00:00.000Z',
    },
    unavailableReason: null,
    ...overrides,
  });
}

function blocker(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'B1',
    severity: 'blocker',
    summary: 'Retry path swallows the operational reason.',
    location: 'apps/runner/src/orchestrator/steps.ts:1490',
    evidenceRefs: [],
    ...overrides,
  };
}

/** Asserts the parse failed and returns the error message for further checks. */
function rejection(text: string, opts?: { knownArtifactIds?: readonly string[] }): string {
  const parsed = parseReviewerVerdict(text, opts);
  expect(parsed.ok).toBe(false);
  if (parsed.ok) throw new Error('expected rejection');
  return parsed.error;
}

describe('review verdict constants and guards', () => {
  test('schema version and output names are the contract both sides key on', () => {
    expect(REVIEW_VERDICT_SCHEMA_VERSION).toBe('ainp.review_verdict.v1');
    expect(REVIEW_VERDICT_OUTPUT_NAME).toBe('review-verdict.json');
    expect(REVIEW_MARKDOWN_OUTPUT_NAME).toBe('review.md');
  });

  test('isReviewVerdictStatus accepts the closed set and rejects near-misses', () => {
    for (const status of REVIEW_VERDICT_STATUSES) {
      expect(isReviewVerdictStatus(status)).toBe(true);
    }
    expect(REVIEW_VERDICT_STATUSES).toEqual(['pass', 'fail', 'unavailable']);
    expect(isReviewVerdictStatus('passed')).toBe(false);
    expect(isReviewVerdictStatus('PASS')).toBe(false);
    expect(isReviewVerdictStatus('warn')).toBe(false);
    expect(isReviewVerdictStatus(null)).toBe(false);
    expect(isReviewVerdictStatus(undefined)).toBe(false);
    expect(isReviewVerdictStatus(0)).toBe(false);
  });

  test('isReviewVerdictRole accepts the closed set and rejects near-misses', () => {
    for (const role of REVIEW_VERDICT_ROLES) {
      expect(isReviewVerdictRole(role)).toBe(true);
    }
    expect(REVIEW_VERDICT_ROLES).toEqual(['reviewer', 'verifier', 'debugger']);
    expect(isReviewVerdictRole('review')).toBe(false);
    expect(isReviewVerdictRole('executor')).toBe(false);
    expect(isReviewVerdictRole({ role: 'reviewer' })).toBe(false);
  });

  test('isReviewBlockerSeverity accepts the closed set and rejects near-misses', () => {
    for (const severity of REVIEW_BLOCKER_SEVERITIES) {
      expect(isReviewBlockerSeverity(severity)).toBe(true);
    }
    expect(REVIEW_BLOCKER_SEVERITIES).toEqual(['blocker', 'major', 'minor']);
    expect(isReviewBlockerSeverity('blocking')).toBe(false);
    expect(isReviewBlockerSeverity('critical')).toBe(false);
    expect(isReviewBlockerSeverity('')).toBe(false);
  });
});

describe('parseReviewerVerdict — success', () => {
  test('accepts a complete verdict and returns every field', () => {
    const text = JSON.stringify({
      schemaVersion: REVIEW_VERDICT_SCHEMA_VERSION,
      role: 'verifier',
      status: 'fail',
      summary: '  Acceptance evidence does not cover the exception path.  ',
      blocking: [
        blocker({
          id: 'B1',
          severity: 'blocker',
          evidenceRefs: [{ artifactId: 'art_diff', claim: 'the diff has no guard' }],
        }),
        blocker({ id: 'B2', severity: 'minor', summary: 'Naming drift', location: null }),
      ],
      remediation: [
        { blockerId: 'B1', action: 'Add the guard and a regression test', rationale: 'AC-3 needs it' },
        { blockerId: 'B2', action: 'Rename to matchGateSection', rationale: null },
      ],
      advisory: ['Consider extracting the matcher'],
      evidenceRefs: [{ artifactId: 'art_review', claim: 'overall reasoning' }],
      provenance: {
        agentSessionId: 'ags_9',
        backend: 'codex',
        skillId: 'skill.review',
        producedAt: '2026-08-08T12:00:00.000Z',
      },
      unavailableReason: null,
    });

    const parsed = parseReviewerVerdict(text, {
      knownArtifactIds: ['art_diff', 'art_review'],
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.evidenceVerified).toBe(true);
    const expected: ReviewerVerdict = {
      schemaVersion: REVIEW_VERDICT_SCHEMA_VERSION,
      role: 'verifier',
      status: 'fail',
      // Surrounding whitespace is normalized away.
      summary: 'Acceptance evidence does not cover the exception path.',
      blocking: [
        {
          id: 'B1',
          severity: 'blocker',
          summary: 'Retry path swallows the operational reason.',
          location: 'apps/runner/src/orchestrator/steps.ts:1490',
          evidenceRefs: [{ artifactId: 'art_diff', claim: 'the diff has no guard' }],
        },
        {
          id: 'B2',
          severity: 'minor',
          summary: 'Naming drift',
          location: null,
          evidenceRefs: [],
        },
      ],
      remediation: [
        { blockerId: 'B1', action: 'Add the guard and a regression test', rationale: 'AC-3 needs it' },
        { blockerId: 'B2', action: 'Rename to matchGateSection', rationale: null },
      ],
      advisory: ['Consider extracting the matcher'],
      evidenceRefs: [{ artifactId: 'art_review', claim: 'overall reasoning' }],
      provenance: {
        agentSessionId: 'ags_9',
        backend: 'codex',
        skillId: 'skill.review',
        producedAt: '2026-08-08T12:00:00.000Z',
      },
      unavailableReason: null,
    };
    expect(parsed.verdict).toEqual(expected);
  });

  test("accepts status 'unavailable' when a reason is given", () => {
    const parsed = parseReviewerVerdict(
      verdictBody({ status: 'unavailable', unavailableReason: 'diff artifact was unreadable' }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.verdict.status).toBe('unavailable');
    expect(parsed.verdict.unavailableReason).toBe('diff artifact was unreadable');
  });

  test("accepts status 'pass' alongside non-blocker findings", () => {
    const parsed = parseReviewerVerdict(
      verdictBody({
        blocking: [blocker({ id: 'B1', severity: 'major' }), blocker({ id: 'B2', severity: 'minor' })],
        remediation: [{ blockerId: 'B2', action: 'Rename it', rationale: null }],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.verdict.blocking.map((item) => item.severity)).toEqual(['major', 'minor']);
    // Remediation is not required for every finding — that policy call belongs
    // to the Gate Engine, not to the parser.
    expect(parsed.verdict.remediation).toHaveLength(1);
  });
});

describe('parseReviewerVerdict — R2 rejection rules', () => {
  test('rejects a non-matching schemaVersion', () => {
    expect(rejection(verdictBody({ schemaVersion: 'ainp.review_verdict.v2' })))
      .toContain('schemaVersion');
    expect(rejection(verdictBody({ schemaVersion: undefined }))).toContain('schemaVersion');
  });

  test('rejects a role outside the enum', () => {
    expect(rejection(verdictBody({ role: 'executor' }))).toContain('role');
    expect(rejection(verdictBody({ role: null }))).toContain('role');
  });

  test('rejects a status outside the enum', () => {
    expect(rejection(verdictBody({ status: 'warn' }))).toContain('status');
    expect(rejection(verdictBody({ status: 'passed' }))).toContain('status');
  });

  test('rejects a severity outside the enum', () => {
    const error = rejection(verdictBody({
      status: 'fail',
      blocking: [blocker({ severity: 'critical' })],
      remediation: [{ blockerId: 'B1', action: 'fix', rationale: null }],
    }));
    expect(error).toContain('severity');
    expect(error).toContain('blocking[0]');
  });

  test("rejects status 'fail' with an empty blocking list", () => {
    expect(rejection(verdictBody({ status: 'fail', blocking: [] })))
      .toContain("status 'fail' requires at least one blocking entry");
  });

  test("rejects status 'pass' carrying a severity 'blocker' entry", () => {
    const error = rejection(verdictBody({
      status: 'pass',
      blocking: [blocker({ id: 'B1', severity: 'blocker' })],
      remediation: [{ blockerId: 'B1', action: 'fix it', rationale: null }],
    }));
    expect(error).toContain("status 'pass' cannot carry a severity 'blocker' entry");
  });

  test("rejects status 'unavailable' without a reason", () => {
    expect(rejection(verdictBody({ status: 'unavailable', unavailableReason: null })))
      .toContain("status 'unavailable' requires unavailableReason");
    // Whitespace-only is the same as absent.
    expect(rejection(verdictBody({ status: 'unavailable', unavailableReason: '   ' })))
      .toContain("status 'unavailable' requires unavailableReason");
    expect(rejection(verdictBody({ status: 'unavailable' })))
      .toContain("status 'unavailable' requires unavailableReason");
  });

  test('rejects a remediation whose blockerId matches no blocking entry', () => {
    const error = rejection(verdictBody({
      status: 'fail',
      blocking: [blocker({ id: 'B1' })],
      remediation: [{ blockerId: 'B9', action: 'fix something else', rationale: null }],
    }));
    expect(error).toContain('remediation[0].blockerId does not match any blocking[].id');
    expect(error).toContain('B9');
  });

  test('rejects evidence citing an artifactId the caller cannot vouch for', () => {
    const topLevel = rejection(
      verdictBody({ evidenceRefs: [{ artifactId: 'art_ghost', claim: 'imagined' }] }),
      { knownArtifactIds: ['art_diff'] },
    );
    expect(topLevel).toContain('evidenceRefs cites unknown artifactId art_ghost');

    const nested = rejection(
      verdictBody({
        status: 'fail',
        blocking: [blocker({ evidenceRefs: [{ artifactId: 'art_ghost', claim: 'imagined' }] })],
        remediation: [{ blockerId: 'B1', action: 'fix', rationale: null }],
      }),
      { knownArtifactIds: ['art_diff'] },
    );
    expect(nested).toContain('blocking[0].evidenceRefs cites unknown artifactId art_ghost');
  });

  test('an empty knownArtifactIds list still rejects every citation', () => {
    // `[]` is a real (empty) universe, not "unknown universe" — a caller that
    // posted no artifacts must not accidentally waive the rule.
    expect(rejection(
      verdictBody({ evidenceRefs: [{ artifactId: 'art_diff', claim: 'diff' }] }),
      { knownArtifactIds: [] },
    )).toContain('unknown artifactId art_diff');
  });

  test('omitting knownArtifactIds accepts citations but reports them unverified', () => {
    const parsed = parseReviewerVerdict(
      verdictBody({ evidenceRefs: [{ artifactId: 'art_unchecked', claim: 'not cross-checked' }] }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.evidenceVerified).toBe(false);
    expect(parsed.verdict.evidenceRefs).toEqual([
      { artifactId: 'art_unchecked', claim: 'not cross-checked' },
    ]);
  });
});

describe('parseReviewerVerdict — structural rejections', () => {
  test('rejects non-JSON and non-object payloads', () => {
    expect(rejection('not json at all')).toBe('verdict is not valid JSON');
    expect(rejection('')).toBe('verdict is not valid JSON');
    expect(rejection('"a string"')).toBe('verdict must be a JSON object');
    expect(rejection('[]')).toBe('verdict must be a JSON object');
    expect(rejection('null')).toBe('verdict must be a JSON object');
    expect(rejection('42')).toBe('verdict must be a JSON object');
  });

  test('rejects a missing or empty summary', () => {
    expect(rejection(verdictBody({ summary: '' }))).toContain('summary');
    expect(rejection(verdictBody({ summary: '   ' }))).toContain('summary');
    expect(rejection(verdictBody({ summary: undefined }))).toContain('summary');
    expect(rejection(verdictBody({ summary: 42 }))).toContain('summary');
  });

  test('rejects non-array blocking / remediation / advisory / evidenceRefs', () => {
    expect(rejection(verdictBody({ blocking: {} }))).toBe('blocking must be an array');
    expect(rejection(verdictBody({ blocking: undefined }))).toBe('blocking must be an array');
    expect(rejection(verdictBody({ remediation: 'none' }))).toBe('remediation must be an array');
    expect(rejection(verdictBody({ advisory: 'just one' }))).toBe('advisory must be an array');
    expect(rejection(verdictBody({ evidenceRefs: null }))).toBe('evidenceRefs must be an array');
  });

  test('rejects an advisory entry that is not a non-empty string', () => {
    expect(rejection(verdictBody({ advisory: ['ok', 3] }))).toBe('advisory[1] must be a non-empty string');
    expect(rejection(verdictBody({ advisory: [''] }))).toBe('advisory[0] must be a non-empty string');
    expect(rejection(verdictBody({ advisory: [null] }))).toBe('advisory[0] must be a non-empty string');
  });

  test('rejects a duplicate blocker id', () => {
    // Duplicates make `remediation.blockerId` ambiguous and let the same defect
    // be counted twice by any downstream consumer.
    const error = rejection(verdictBody({
      status: 'fail',
      blocking: [blocker({ id: 'B1' }), blocker({ id: 'B1', summary: 'Different words, same id' })],
      remediation: [{ blockerId: 'B1', action: 'fix', rationale: null }],
    }));
    expect(error).toContain('blocking[1].id duplicates an earlier blocker');
    expect(error).toContain('B1');
  });

  test('rejects malformed blocking entries field by field', () => {
    const bad = (override: Record<string, unknown>): string =>
      rejection(verdictBody({
        status: 'fail',
        blocking: [blocker(override)],
        remediation: [],
      }));
    expect(rejection(verdictBody({ status: 'fail', blocking: ['B1'], remediation: [] })))
      .toBe('blocking[0] must be an object');
    expect(bad({ id: '' })).toBe('blocking[0].id must be a non-empty string');
    expect(bad({ id: 7 })).toBe('blocking[0].id must be a non-empty string');
    expect(bad({ summary: '  ' })).toBe('blocking[0].summary must be a non-empty string');
    expect(bad({ location: 42 })).toBe('blocking[0].location must be a string or null');
    expect(bad({ evidenceRefs: 'art_diff' })).toBe('blocking[0].evidenceRefs must be an array');
  });

  test('rejects malformed remediation entries field by field', () => {
    const bad = (override: Record<string, unknown>): string =>
      rejection(verdictBody({
        status: 'fail',
        blocking: [blocker({ id: 'B1' })],
        remediation: [{ blockerId: 'B1', action: 'fix it', rationale: null, ...override }],
      }));
    expect(rejection(verdictBody({
      status: 'fail',
      blocking: [blocker({ id: 'B1' })],
      remediation: ['B1'],
    }))).toBe('remediation[0] must be an object');
    expect(bad({ blockerId: '' })).toBe('remediation[0].blockerId must be a non-empty string');
    expect(bad({ action: '' })).toBe('remediation[0].action must be a non-empty string');
    expect(bad({ action: undefined })).toBe('remediation[0].action must be a non-empty string');
    expect(bad({ rationale: 12 })).toBe('remediation[0].rationale must be a string or null');
  });

  test('rejects malformed evidenceRefs entries field by field', () => {
    expect(rejection(verdictBody({ evidenceRefs: ['art_diff'] })))
      .toBe('evidenceRefs[0] must be an object');
    expect(rejection(verdictBody({ evidenceRefs: [{ claim: 'no id' }] })))
      .toBe('evidenceRefs[0].artifactId must be a non-empty string');
    expect(rejection(verdictBody({ evidenceRefs: [{ artifactId: 'art_diff' }] })))
      .toBe('evidenceRefs[0].claim must be a non-empty string');
    expect(rejection(verdictBody({ evidenceRefs: [{ artifactId: 'art_diff', claim: '   ' }] })))
      .toBe('evidenceRefs[0].claim must be a non-empty string');
  });

  test('rejects malformed provenance field by field', () => {
    expect(rejection(verdictBody({ provenance: null }))).toBe('provenance must be an object');
    expect(rejection(verdictBody({ provenance: 'claude_code' }))).toBe('provenance must be an object');
    const bad = (override: Record<string, unknown>): string =>
      rejection(verdictBody({
        provenance: {
          agentSessionId: 'ags_1',
          backend: 'claude_code',
          skillId: 'skill.review',
          producedAt: '2026-08-08T00:00:00.000Z',
          ...override,
        },
      }));
    expect(bad({ agentSessionId: 5 })).toBe('provenance.agentSessionId must be a string or null');
    expect(bad({ backend: [] })).toBe('provenance.backend must be a string or null');
    expect(bad({ skillId: {} })).toBe('provenance.skillId must be a string or null');
    expect(bad({ producedAt: null })).toBe('provenance.producedAt must be a non-empty ISO-8601 string');
    expect(bad({ producedAt: '' })).toBe('provenance.producedAt must be a non-empty ISO-8601 string');
  });

  test('rejects a non-string unavailableReason', () => {
    expect(rejection(verdictBody({ unavailableReason: 12 })))
      .toBe('unavailableReason must be a string or null');
  });
});

describe('parseReviewerVerdict — nullable field three-state semantics', () => {
  // Nullable fields distinguish three cases: explicit null (fine), absent
  // (treated as null), and wrong type (rejected). Collapsing "wrong type" into
  // "absent" would let `location: 42` through as `null` and quietly lose data.
  test('explicit null, absent, and empty string all normalize to null', () => {
    for (const provenance of [
      { agentSessionId: null, backend: null, skillId: null, producedAt: '2026-08-08T00:00:00.000Z' },
      { producedAt: '2026-08-08T00:00:00.000Z' },
      { agentSessionId: '', backend: '  ', skillId: '', producedAt: '2026-08-08T00:00:00.000Z' },
    ]) {
      const parsed = parseReviewerVerdict(verdictBody({ provenance }));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) throw new Error(parsed.error);
      expect(parsed.verdict.provenance).toEqual({
        agentSessionId: null,
        backend: null,
        skillId: null,
        producedAt: '2026-08-08T00:00:00.000Z',
      });
    }
  });

  test('an absent nullable field is not confused with a wrong-typed one', () => {
    const absent = parseReviewerVerdict(verdictBody({
      status: 'fail',
      blocking: [{ id: 'B1', severity: 'blocker', summary: 'no location key', evidenceRefs: [] }],
      remediation: [],
    }));
    expect(absent.ok).toBe(true);
    if (!absent.ok) throw new Error(absent.error);
    expect(absent.verdict.blocking[0]?.location).toBeNull();

    // Same field, wrong type — must NOT fall through to null.
    expect(rejection(verdictBody({
      status: 'fail',
      blocking: [blocker({ location: { file: 'a.ts' } })],
      remediation: [],
    }))).toBe('blocking[0].location must be a string or null');
  });

  test('unavailableReason absent is null, but wrong type is rejected', () => {
    const parsed = parseReviewerVerdict(verdictBody({ unavailableReason: undefined }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.verdict.unavailableReason).toBeNull();
    expect(rejection(verdictBody({ unavailableReason: false })))
      .toBe('unavailableReason must be a string or null');
  });
});
