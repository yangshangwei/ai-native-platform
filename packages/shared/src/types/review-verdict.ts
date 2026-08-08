import type { Iso8601 } from './ids';
import type { EvidenceRef } from './artifact';

/**
 * ReviewerVerdict — the machine-readable half of a review stage output
 * (task 08-08 p0-2-typed-reviewerverdict-gate, R1).
 *
 * A verdict is EVIDENCE AND OPINION, never state. The Gate Engine reads it as
 * one more input and still produces its own `RuleResult`s; `verdict.status`
 * may not become `GateRun.status` (PRD ADR-2). The human-readable `review.md`
 * stays alongside it — the verdict is a parallel artifact, not a replacement.
 *
 * Parsing and validation live here as a pure function so the runner (write
 * side) and the api Gate Engine (verify side) agree on what a legal verdict
 * is — the same single-judgement discipline `deriveGraphRunStatus` follows.
 */

export const REVIEW_VERDICT_SCHEMA_VERSION = 'ainp.review_verdict.v1' as const;

/** Skill output name the runner expects the reviewer to write. */
export const REVIEW_VERDICT_OUTPUT_NAME = 'review-verdict.json' as const;

/** Skill output name of the human-readable review that rides alongside. */
export const REVIEW_MARKDOWN_OUTPUT_NAME = 'review.md' as const;

export const REVIEW_VERDICT_STATUSES = ['pass', 'fail', 'unavailable'] as const;
export const REVIEW_VERDICT_ROLES = ['reviewer', 'verifier', 'debugger'] as const;
export const REVIEW_BLOCKER_SEVERITIES = ['blocker', 'major', 'minor'] as const;

export type ReviewVerdictStatus = (typeof REVIEW_VERDICT_STATUSES)[number];
export type ReviewVerdictRole = (typeof REVIEW_VERDICT_ROLES)[number];
export type ReviewBlockerSeverity = (typeof REVIEW_BLOCKER_SEVERITIES)[number];

export function isReviewVerdictStatus(value: unknown): value is ReviewVerdictStatus {
  return typeof value === 'string'
    && (REVIEW_VERDICT_STATUSES as readonly string[]).includes(value);
}

export function isReviewVerdictRole(value: unknown): value is ReviewVerdictRole {
  return typeof value === 'string'
    && (REVIEW_VERDICT_ROLES as readonly string[]).includes(value);
}

export function isReviewBlockerSeverity(value: unknown): value is ReviewBlockerSeverity {
  return typeof value === 'string'
    && (REVIEW_BLOCKER_SEVERITIES as readonly string[]).includes(value);
}

export interface ReviewBlocker {
  /** Stable handle so remediation can reference it and dedupe against it. */
  id: string;
  severity: ReviewBlockerSeverity;
  /** One sentence naming the defect. */
  summary: string;
  /** `file:line` or module name; null when the reviewer cannot localize it. */
  location: string | null;
  evidenceRefs: EvidenceRef[];
}

export interface ReviewRemediation {
  /** Must match some `ReviewBlocker.id` in the same verdict. */
  blockerId: string;
  /** Concretely how to fix it. */
  action: string;
  rationale: string | null;
}

export interface ReviewProvenance {
  agentSessionId: string | null;
  /** e.g. 'claude_code' | 'codex'. Free-form: backends are not a closed set here. */
  backend: string | null;
  skillId: string | null;
  producedAt: Iso8601;
}

export interface ReviewerVerdict {
  schemaVersion: typeof REVIEW_VERDICT_SCHEMA_VERSION;
  role: ReviewVerdictRole;
  status: ReviewVerdictStatus;
  summary: string;
  blocking: ReviewBlocker[];
  remediation: ReviewRemediation[];
  /** Non-blocking suggestions. */
  advisory: string[];
  /** Evidence behind the verdict as a whole. */
  evidenceRefs: EvidenceRef[];
  provenance: ReviewProvenance;
  /** Required when `status === 'unavailable'`. */
  unavailableReason: string | null;
}

export interface ParseReviewerVerdictOptions {
  /**
   * Artifact ids the caller can prove exist. When provided, every
   * `evidenceRefs[].artifactId` must be a member — a verdict citing an
   * artifact nobody wrote is not evidence.
   *
   * Shared stays pure, so the universe is passed in rather than read: the
   * runner passes what it has posted this run, the api passes the store.
   * Omitting it skips that one rule (`evidenceVerified: false` on success).
   */
  knownArtifactIds?: readonly string[];
}

export type ParseReviewerVerdictResult =
  | { ok: true; verdict: ReviewerVerdict; evidenceVerified: boolean }
  | { ok: false; error: string };

/**
 * Strict verdict parser. Every rejection below is deliberate: a verdict that
 * contradicts itself is worse than no verdict, because the Gate Engine would
 * otherwise cite it as evidence. Callers treat `ok: false` as a backend
 * protocol failure (required output unparseable), NOT as a review failure.
 */
export function parseReviewerVerdict(
  text: string,
  opts: ParseReviewerVerdictOptions = {},
): ParseReviewerVerdictResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, error: 'verdict is not valid JSON' };
  }
  if (!isRecord(raw)) return { ok: false, error: 'verdict must be a JSON object' };

  if (raw.schemaVersion !== REVIEW_VERDICT_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `schemaVersion must be ${REVIEW_VERDICT_SCHEMA_VERSION}, got ${describe(raw.schemaVersion)}`,
    };
  }
  if (!isReviewVerdictRole(raw.role)) {
    return { ok: false, error: `role must be one of ${REVIEW_VERDICT_ROLES.join(' | ')}, got ${describe(raw.role)}` };
  }
  if (!isReviewVerdictStatus(raw.status)) {
    return { ok: false, error: `status must be one of ${REVIEW_VERDICT_STATUSES.join(' | ')}, got ${describe(raw.status)}` };
  }
  const summary = nonEmptyString(raw.summary);
  if (summary === null) return { ok: false, error: 'summary must be a non-empty string' };

  const blocking: ReviewBlocker[] = [];
  const rawBlocking = raw.blocking;
  if (!Array.isArray(rawBlocking)) return { ok: false, error: 'blocking must be an array' };
  const blockerIds = new Set<string>();
  for (const [index, entry] of rawBlocking.entries()) {
    const parsed = parseBlocker(entry, index);
    if ('error' in parsed) return { ok: false, error: parsed.error };
    if (blockerIds.has(parsed.blocker.id)) {
      return { ok: false, error: `blocking[${index}].id duplicates an earlier blocker (${parsed.blocker.id})` };
    }
    blockerIds.add(parsed.blocker.id);
    blocking.push(parsed.blocker);
  }

  const rawRemediation = raw.remediation;
  if (!Array.isArray(rawRemediation)) return { ok: false, error: 'remediation must be an array' };
  const remediation: ReviewRemediation[] = [];
  for (const [index, entry] of rawRemediation.entries()) {
    const parsed = parseRemediation(entry, index);
    if ('error' in parsed) return { ok: false, error: parsed.error };
    if (!blockerIds.has(parsed.remediation.blockerId)) {
      return {
        ok: false,
        error: `remediation[${index}].blockerId does not match any blocking[].id (${parsed.remediation.blockerId})`,
      };
    }
    remediation.push(parsed.remediation);
  }

  const advisory = parseStringArray(raw.advisory, 'advisory');
  if ('error' in advisory) return { ok: false, error: advisory.error };

  const evidenceRefs = parseEvidenceRefs(raw.evidenceRefs, 'evidenceRefs');
  if ('error' in evidenceRefs) return { ok: false, error: evidenceRefs.error };

  const provenance = parseProvenance(raw.provenance);
  if ('error' in provenance) return { ok: false, error: provenance.error };

  const unavailableReason = optionalString(raw.unavailableReason);
  if (unavailableReason === undefined) {
    return { ok: false, error: 'unavailableReason must be a string or null' };
  }

  // Self-consistency. A status that disagrees with the body is a protocol
  // error, not a judgement we can pass along.
  if (raw.status === 'fail' && blocking.length === 0) {
    return { ok: false, error: "status 'fail' requires at least one blocking entry" };
  }
  if (raw.status === 'pass' && blocking.some((item) => item.severity === 'blocker')) {
    return { ok: false, error: "status 'pass' cannot carry a severity 'blocker' entry" };
  }
  if (raw.status === 'unavailable' && unavailableReason === null) {
    return { ok: false, error: "status 'unavailable' requires unavailableReason" };
  }

  const known = opts.knownArtifactIds;
  if (known) {
    const knownSet = new Set(known);
    const cited = [
      ...evidenceRefs.refs.map((ref) => ({ ref, where: 'evidenceRefs' })),
      ...blocking.flatMap((item, index) =>
        item.evidenceRefs.map((ref) => ({ ref, where: `blocking[${index}].evidenceRefs` })),
      ),
    ];
    for (const { ref, where } of cited) {
      if (!knownSet.has(ref.artifactId)) {
        return { ok: false, error: `${where} cites unknown artifactId ${ref.artifactId}` };
      }
    }
  }

  return {
    ok: true,
    evidenceVerified: Boolean(known),
    verdict: {
      schemaVersion: REVIEW_VERDICT_SCHEMA_VERSION,
      role: raw.role,
      status: raw.status,
      summary,
      blocking,
      remediation,
      advisory: advisory.values,
      evidenceRefs: evidenceRefs.refs,
      provenance: provenance.provenance,
      unavailableReason,
    },
  };
}

function parseBlocker(
  value: unknown,
  index: number,
): { blocker: ReviewBlocker } | { error: string } {
  if (!isRecord(value)) return { error: `blocking[${index}] must be an object` };
  const id = nonEmptyString(value.id);
  if (id === null) return { error: `blocking[${index}].id must be a non-empty string` };
  if (!isReviewBlockerSeverity(value.severity)) {
    return {
      error: `blocking[${index}].severity must be one of ${REVIEW_BLOCKER_SEVERITIES.join(' | ')}, got ${describe(value.severity)}`,
    };
  }
  const summary = nonEmptyString(value.summary);
  if (summary === null) return { error: `blocking[${index}].summary must be a non-empty string` };
  const location = optionalString(value.location);
  if (location === undefined) {
    return { error: `blocking[${index}].location must be a string or null` };
  }
  const evidenceRefs = parseEvidenceRefs(value.evidenceRefs, `blocking[${index}].evidenceRefs`);
  if ('error' in evidenceRefs) return { error: evidenceRefs.error };
  return { blocker: { id, severity: value.severity, summary, location, evidenceRefs: evidenceRefs.refs } };
}

function parseRemediation(
  value: unknown,
  index: number,
): { remediation: ReviewRemediation } | { error: string } {
  if (!isRecord(value)) return { error: `remediation[${index}] must be an object` };
  const blockerId = nonEmptyString(value.blockerId);
  if (blockerId === null) {
    return { error: `remediation[${index}].blockerId must be a non-empty string` };
  }
  const action = nonEmptyString(value.action);
  if (action === null) return { error: `remediation[${index}].action must be a non-empty string` };
  const rationale = optionalString(value.rationale);
  if (rationale === undefined) {
    return { error: `remediation[${index}].rationale must be a string or null` };
  }
  return { remediation: { blockerId, action, rationale } };
}

function parseProvenance(value: unknown): { provenance: ReviewProvenance } | { error: string } {
  if (!isRecord(value)) return { error: 'provenance must be an object' };
  const agentSessionId = optionalString(value.agentSessionId);
  if (agentSessionId === undefined) {
    return { error: 'provenance.agentSessionId must be a string or null' };
  }
  const backend = optionalString(value.backend);
  if (backend === undefined) return { error: 'provenance.backend must be a string or null' };
  const skillId = optionalString(value.skillId);
  if (skillId === undefined) return { error: 'provenance.skillId must be a string or null' };
  const producedAt = nonEmptyString(value.producedAt);
  if (producedAt === null) {
    return { error: 'provenance.producedAt must be a non-empty ISO-8601 string' };
  }
  return { provenance: { agentSessionId, backend, skillId, producedAt } };
}

function parseEvidenceRefs(
  value: unknown,
  where: string,
): { refs: EvidenceRef[] } | { error: string } {
  if (!Array.isArray(value)) return { error: `${where} must be an array` };
  const refs: EvidenceRef[] = [];
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry)) return { error: `${where}[${index}] must be an object` };
    const artifactId = nonEmptyString(entry.artifactId);
    if (artifactId === null) {
      return { error: `${where}[${index}].artifactId must be a non-empty string` };
    }
    const claim = nonEmptyString(entry.claim);
    if (claim === null) return { error: `${where}[${index}].claim must be a non-empty string` };
    refs.push({ artifactId, claim });
  }
  return { refs };
}

function parseStringArray(
  value: unknown,
  where: string,
): { values: string[] } | { error: string } {
  if (!Array.isArray(value)) return { error: `${where} must be an array` };
  const values: string[] = [];
  for (const [index, entry] of value.entries()) {
    const item = nonEmptyString(entry);
    if (item === null) return { error: `${where}[${index}] must be a non-empty string` };
    values.push(item);
  }
  return { values };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Non-empty trimmed string, or null when the value is unusable. */
function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Nullable string field. Returns `undefined` for a *type* violation so callers
 * can tell "explicitly absent" (null) from "wrong shape" (undefined).
 */
function optionalString(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function describe(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  return typeof value;
}
