import type { Iso8601, ArtifactId, ProjectId, WorkflowRunId, StepRunId } from './ids';
import {
  isContextFreshness,
  isContextTrustLevel,
  isKnowledgeClass,
  type ContextFreshness,
  type ContextTrustLevel,
  type KnowledgeClass,
} from './context';

// ---------------------------------------------------------------------------
// Artifact kinds
//
// V1 had a single flat `ArtifactKind` union. V2 splits it into two unions
// reflecting the different lifecycles (see V2 design § 3.4):
//
//   - PerRunArtifactKind       — one-shot, run-scoped, never edited
//                                (lives in `artifacts` table, NOT NULL workflow_run_id)
//   - KnowledgeArtifactKind    — long-lived, project-scoped, editable, versioned
//                                (lives in `knowledge_artifacts` table, project_id)
//
// `ArtifactKind` remains exported as the union of both for backward compatibility:
// every existing reference to `ArtifactKind` continues to type-check unchanged.
// ---------------------------------------------------------------------------

/**
 * V1 per-run artifact kinds (12 entries). Strongly bound to a single
 * `workflow_run_id`; one-shot evidence captured during a workflow run.
 */
export type PerRunArtifactKind =
  | 'project_profile'
  | 'context_pack'
  | 'requirement_draft'
  | 'design_doc'
  | 'traceability'
  | 'diff'
  | 'command_log'
  | 'surefire_report'
  | 'failsafe_report'
  | 'completion_report'
  | 'knowledge_candidate'
  /**
   * Captures the human reviewer's rejection reason at a manual gate.
   * Produced by the runner just before the reject-throw; consumed by a
   * later context-pack stage (handled in a follow-up L3 task) to seed
   * prompt revision context for a re-run.
   */
  | 'rejection_feedback'
  | 'other';

/**
 * V2 knowledge artifact kinds (10 entries). Project-scoped, long-lived,
 * editable, versioned via the `promoteToKnowledge` upgrade flow. Lives in
 * the dedicated `knowledge_artifacts` table (added in PR2).
 *
 * Fine-grained sub-classifications (e.g. `lesson` ⇒ pitfall vs knowledge)
 * are expressed via `metadata.subtype` — see `KNOWLEDGE_SUBTYPES`.
 */
export type KnowledgeArtifactKind =
  | 'requirement'
  | 'design'
  | 'architecture'
  | 'roadmap'
  | 'decision'
  | 'lesson'
  | 'pattern'
  | 'explore'
  | 'dev_guide'
  | 'api_doc';

/**
 * Union of per-run + knowledge kinds. Existing references stay valid.
 */
export type ArtifactKind = PerRunArtifactKind | KnowledgeArtifactKind;

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

const PER_RUN_KIND_SET: ReadonlySet<PerRunArtifactKind> = new Set<PerRunArtifactKind>([
  'project_profile',
  'context_pack',
  'requirement_draft',
  'design_doc',
  'traceability',
  'diff',
  'command_log',
  'surefire_report',
  'failsafe_report',
  'completion_report',
  'knowledge_candidate',
  'rejection_feedback',
  'other',
]);

const KNOWLEDGE_KIND_SET: ReadonlySet<KnowledgeArtifactKind> = new Set<KnowledgeArtifactKind>([
  'requirement',
  'design',
  'architecture',
  'roadmap',
  'decision',
  'lesson',
  'pattern',
  'explore',
  'dev_guide',
  'api_doc',
]);

export function isPerRunArtifactKind(value: unknown): value is PerRunArtifactKind {
  return typeof value === 'string' && PER_RUN_KIND_SET.has(value as PerRunArtifactKind);
}

export function isKnowledgeArtifactKind(value: unknown): value is KnowledgeArtifactKind {
  return typeof value === 'string' && KNOWLEDGE_KIND_SET.has(value as KnowledgeArtifactKind);
}

// ---------------------------------------------------------------------------
// Metadata schemas (V2 § 3.4 / Q4 ADR: core typed + extension freeform)
// ---------------------------------------------------------------------------

/**
 * Lifecycle status of a knowledge artifact.
 *
 *   draft       — produced by an agent, awaiting human acceptance
 *   accepted    — current authoritative version of the entity
 *   superseded  — historical version, replaced by a newer accepted version
 */
export type KnowledgeArtifactStatus = 'draft' | 'accepted' | 'superseded';

export const KNOWLEDGE_ARTIFACT_STATUSES = [
  'draft',
  'accepted',
  'superseded',
] as const satisfies readonly KnowledgeArtifactStatus[];

export function isKnowledgeArtifactStatus(value: unknown): value is KnowledgeArtifactStatus {
  return typeof value === 'string'
    && (KNOWLEDGE_ARTIFACT_STATUSES as readonly string[]).includes(value);
}

export const MEMORY_KINDS = ['semantic', 'episodic', 'procedural'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const MEMORY_REVIEW_STATUSES = [
  'none',
  'needs_review',
  'conflict',
  'stale',
  'superseded',
  'upgrade_candidate',
  'downgrade_candidate',
] as const;
export type MemoryReviewStatus = (typeof MEMORY_REVIEW_STATUSES)[number];

export const MEMORY_SCOPES = ['run', 'task', 'project', 'workspace', 'global'] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export const MEMORY_STATUSES = ['candidate', 'current', 'stale', 'superseded', 'rejected'] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

export const MEMORY_DECAY_POLICIES = [
  'none',
  'time',
  'code_churn',
  'evidence_conflict',
  'manual_review',
] as const;
export type MemoryDecayPolicy = (typeof MEMORY_DECAY_POLICIES)[number];

export function isMemoryKind(value: unknown): value is MemoryKind {
  return typeof value === 'string'
    && (MEMORY_KINDS as readonly string[]).includes(value);
}

export function isMemoryReviewStatus(value: unknown): value is MemoryReviewStatus {
  return typeof value === 'string'
    && (MEMORY_REVIEW_STATUSES as readonly string[]).includes(value);
}

function normalizeMemoryReviewStatus(value: unknown): MemoryReviewStatus | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return isMemoryReviewStatus(normalized) ? normalized : null;
}

export function isMemoryScope(value: unknown): value is MemoryScope {
  return typeof value === 'string'
    && (MEMORY_SCOPES as readonly string[]).includes(value);
}

export function isMemoryStatus(value: unknown): value is MemoryStatus {
  return typeof value === 'string'
    && (MEMORY_STATUSES as readonly string[]).includes(value);
}

export function isMemoryDecayPolicy(value: unknown): value is MemoryDecayPolicy {
  return typeof value === 'string'
    && (MEMORY_DECAY_POLICIES as readonly string[]).includes(value);
}

/**
 * Strongly-typed core fields every knowledge artifact carries. Additional
 * per-kind fields (e.g. lesson severity, decision supersedes-id) ride
 * alongside these as freeform JSON via `KnowledgeArtifactMetadata`.
 */
export interface KnowledgeMetadataCore {
  /**
   * Optional fine-grain subtype (per-kind enum, see KNOWLEDGE_SUBTYPES).
   * App-layer validated via `isValidKnowledgeSubtype` before write.
   */
  subtype?: string;
  /** Lifecycle status. */
  status: KnowledgeArtifactStatus;
  /** Version counter; bumped each time the entity is re-promoted. Starts at 1. */
  version: number;
  /**
   * Project-scoped business identifier (REQ-001 / DSN-001 / ADR-001 / LSN-001 / …).
   * In P0-1 uniqueness is enforced at the application layer; P0-2 promotes
   * this to a DB-level constraint via dedicated entity tables.
   */
  entityId?: string;
  /**
   * Back-pointer to the per-run artifact this entity was promoted from
   * (acceptance gate hook in PR3). Null when entity was authored directly
   * via the UI rather than through a workflow run.
   */
  derivedFromArtifactId?: string;
}

/**
 * Context-injection classification fields stored in the existing
 * `knowledge_artifacts.metadata_json` blob. These deliberately live in
 * metadata first so Seed / Recovered / Confirmed can ship without a DB
 * migration; callers should use the helpers below at trust boundaries.
 */
export interface KnowledgeContextMetadata {
  knowledgeClass?: KnowledgeClass;
  trustLevel?: ContextTrustLevel;
  freshness?: ContextFreshness;
  sourceRefs?: string[];
  confidence?: number;
  memoryKind?: MemoryKind;
  reviewStatus?: MemoryReviewStatus;
  memoryScope?: MemoryScope;
  memoryStatus?: MemoryStatus;
  decayPolicy?: MemoryDecayPolicy;
  lastValidatedAt?: Iso8601 | null;
  expiresAt?: Iso8601 | null;
  decayReason?: string | null;
  supersededBy?: string[];
  supersedes?: string[];
  hitCount?: number;
  lastUsedAt?: Iso8601 | null;
}

export interface NormalizedKnowledgeContextMetadata {
  knowledgeClass: KnowledgeClass;
  trustLevel: ContextTrustLevel;
  freshness: ContextFreshness;
  sourceRefs: string[];
  confidence: number;
}

export interface NormalizedMemoryLifecycleMetadata {
  memoryKind: MemoryKind;
  reviewStatus: MemoryReviewStatus;
  memoryScope: MemoryScope;
  memoryStatus: MemoryStatus;
  decayPolicy: MemoryDecayPolicy;
  lastValidatedAt: Iso8601 | null;
  expiresAt: Iso8601 | null;
  decayReason: string | null;
  supersededBy: string[];
  supersedes: string[];
  hitCount: number;
  lastUsedAt: Iso8601 | null;
}

/**
 * Knowledge artifact metadata: typed core + freeform extension.
 *
 * Use this for any `Artifact` whose `kind` is a `KnowledgeArtifactKind`.
 */
export type KnowledgeArtifactMetadata =
  KnowledgeMetadataCore & KnowledgeContextMetadata & Record<string, unknown>;

/**
 * Per-run artifact metadata: stays freeform (V1 behavior preserved).
 */
export type PerRunArtifactMetadata = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Verifier evidence metadata (M3)
// ---------------------------------------------------------------------------

export const VERIFIER_AC_MATRIX_SCHEMA_VERSION = 'ainp.verifier_ac_matrix.v1' as const;
export const VERIFIER_MEDIA_SCHEMA_VERSION = 'ainp.verifier_media.v1' as const;

export type VerifierMediaRole = 'screenshot_before' | 'screenshot_after' | 'video';
export type VerifierStatus = 'pass' | 'fail' | 'blocked';

export interface VerifierEvidenceRef extends EvidenceRef {
  role?: VerifierMediaRole | 'ac_matrix';
}

export interface VerifierAcceptanceCriterionEvidence {
  id: string;
  text?: string;
  status: VerifierStatus;
  evidenceRefs: VerifierEvidenceRef[];
  notes?: string;
}

export interface VerifierAcMatrix {
  schemaVersion: typeof VERIFIER_AC_MATRIX_SCHEMA_VERSION;
  workflowRunId: WorkflowRunId;
  stepRunId?: StepRunId | null;
  verifierRequired: boolean;
  verifierStatus: VerifierStatus;
  acceptanceCriteria: VerifierAcceptanceCriterionEvidence[];
  createdAt: Iso8601;
}

export interface VerifierArtifactMetadata extends PerRunArtifactMetadata {
  schemaVersion?: typeof VERIFIER_AC_MATRIX_SCHEMA_VERSION | typeof VERIFIER_MEDIA_SCHEMA_VERSION;
  reportKind?: 'verifier_ac_matrix' | 'verifier_media';
  verifierRequired?: boolean;
  verifierStatus?: VerifierStatus;
  verifierArtifactType?: VerifierMediaRole | 'ac_matrix';
  verifierRole?: VerifierMediaRole | 'ac_matrix';
  capture?: 'before' | 'after';
  subStage?: 'verifier';
}

export interface NormalizeKnowledgeContextMetadataOptions {
  status?: KnowledgeArtifactStatus;
  fallbackSourceRefs?: readonly string[];
}

/**
 * Default bridge from existing lifecycle status to Context Injection
 * knowledge metadata. `accepted` maps to confirmed unless explicit metadata
 * overrides it with a valid `knowledgeClass`.
 */
export function defaultKnowledgeContextMetadataForStatus(
  status: KnowledgeArtifactStatus = 'draft',
): Omit<NormalizedKnowledgeContextMetadata, 'sourceRefs'> {
  switch (status) {
    case 'accepted':
      return {
        knowledgeClass: 'confirmed',
        trustLevel: 'accepted_knowledge',
        freshness: 'possibly_stale',
        confidence: 0.9,
      };
    case 'superseded':
      return {
        knowledgeClass: 'recovered',
        trustLevel: 'summary',
        freshness: 'historical',
        confidence: 0.4,
      };
    case 'draft':
      return {
        knowledgeClass: 'recovered',
        trustLevel: 'summary',
        freshness: 'possibly_stale',
        confidence: 0.5,
      };
  }
}

/**
 * Returns field-level validation errors for standardized knowledge metadata.
 * Use this at API/CLI trust boundaries before persisting freeform metadata.
 */
export function knowledgeContextMetadataValidationErrors(
  metadata: Record<string, unknown> | undefined,
): string[] {
  if (!metadata) return [];
  const errors: string[] = [];
  if ('knowledgeClass' in metadata && !isKnowledgeClass(metadata.knowledgeClass)) {
    errors.push(`metadata.knowledgeClass must be one of: seed, recovered, confirmed`);
  }
  if ('trustLevel' in metadata && !isContextTrustLevel(metadata.trustLevel)) {
    errors.push(`metadata.trustLevel must be one of: source, accepted_knowledge, summary, inference`);
  }
  if ('freshness' in metadata && !isContextFreshness(metadata.freshness)) {
    errors.push(`metadata.freshness must be one of: current, possibly_stale, historical`);
  }
  if ('memoryKind' in metadata && !isMemoryKind(metadata.memoryKind)) {
    errors.push(`metadata.memoryKind must be one of: semantic, episodic, procedural`);
  }
  if ('reviewStatus' in metadata && !isMemoryReviewStatus(metadata.reviewStatus)) {
    errors.push(`metadata.reviewStatus must be one of: none, needs_review, conflict, stale, superseded, upgrade_candidate, downgrade_candidate`);
  }
  if ('memoryScope' in metadata && !isMemoryScope(metadata.memoryScope)) {
    errors.push(`metadata.memoryScope must be one of: run, task, project, workspace, global`);
  }
  if ('memoryStatus' in metadata && !isMemoryStatus(metadata.memoryStatus)) {
    errors.push(`metadata.memoryStatus must be one of: candidate, current, stale, superseded, rejected`);
  }
  if ('decayPolicy' in metadata && !isMemoryDecayPolicy(metadata.decayPolicy)) {
    errors.push(`metadata.decayPolicy must be one of: none, time, code_churn, evidence_conflict, manual_review`);
  }
  if ('lastValidatedAt' in metadata && !isNullableIso8601String(metadata.lastValidatedAt)) {
    errors.push(`metadata.lastValidatedAt must be an ISO-8601 string or null`);
  }
  if ('expiresAt' in metadata && !isNullableIso8601String(metadata.expiresAt)) {
    errors.push(`metadata.expiresAt must be an ISO-8601 string or null`);
  }
  if ('decayReason' in metadata && !isNullableNonEmptyString(metadata.decayReason)) {
    errors.push(`metadata.decayReason must be a non-empty string or null`);
  }
  if ('supersededBy' in metadata && !isStringArray(metadata.supersededBy)) {
    errors.push(`metadata.supersededBy must be an array of non-empty strings`);
  }
  if ('sourceRefs' in metadata && !isStringArray(metadata.sourceRefs)) {
    errors.push(`metadata.sourceRefs must be an array of non-empty strings`);
  }
  if ('supersedes' in metadata && !isStringArray(metadata.supersedes)) {
    errors.push(`metadata.supersedes must be an array of non-empty strings`);
  }
  if ('hitCount' in metadata && !isNonNegativeInteger(metadata.hitCount)) {
    errors.push(`metadata.hitCount must be a non-negative integer`);
  }
  if ('lastUsedAt' in metadata && !isNullableIso8601String(metadata.lastUsedAt)) {
    errors.push(`metadata.lastUsedAt must be an ISO-8601 string or null`);
  }
  if ('confidence' in metadata && !isConfidence(metadata.confidence)) {
    errors.push(`metadata.confidence must be a number between 0 and 1`);
  }
  return errors;
}

export function normalizeMemoryLifecycleMetadata(
  metadata: Record<string, unknown> | undefined,
  options: { knowledgeKind?: KnowledgeArtifactKind; status?: KnowledgeArtifactStatus } = {},
): NormalizedMemoryLifecycleMetadata {
  const reviewStatus = normalizeMemoryReviewStatus(metadata?.reviewStatus);
  return {
    memoryKind: isMemoryKind(metadata?.memoryKind)
      ? metadata.memoryKind
      : defaultMemoryKindForKnowledgeKind(options.knowledgeKind),
    reviewStatus: reviewStatus ?? 'none',
    memoryScope: isMemoryScope(metadata?.memoryScope)
      ? metadata.memoryScope
      : defaultMemoryScope(metadata, options),
    memoryStatus: isMemoryStatus(metadata?.memoryStatus)
      ? metadata.memoryStatus
      : defaultMemoryStatus(metadata, options.status),
    decayPolicy: isMemoryDecayPolicy(metadata?.decayPolicy)
      ? metadata.decayPolicy
      : defaultMemoryDecayPolicy(metadata),
    lastValidatedAt: isNullableIso8601String(metadata?.lastValidatedAt) ? metadata.lastValidatedAt : null,
    expiresAt: isNullableIso8601String(metadata?.expiresAt) ? metadata.expiresAt : null,
    decayReason: isNullableNonEmptyString(metadata?.decayReason) ? metadata.decayReason : null,
    supersededBy: Array.isArray(metadata?.supersededBy)
      ? normalizeSourceRefs(metadata.supersededBy.filter((item): item is string => typeof item === 'string'))
      : [],
    supersedes: Array.isArray(metadata?.supersedes)
      ? normalizeSourceRefs(metadata.supersedes.filter((item): item is string => typeof item === 'string'))
      : [],
    hitCount: isNonNegativeInteger(metadata?.hitCount) ? metadata.hitCount : 0,
    lastUsedAt: isNullableIso8601String(metadata?.lastUsedAt) ? metadata.lastUsedAt : null,
  };
}

export function normalizeKnowledgeContextMetadata(
  metadata: Record<string, unknown> | undefined,
  options: NormalizeKnowledgeContextMetadataOptions = {},
): NormalizedKnowledgeContextMetadata {
  const defaults = defaultKnowledgeContextMetadataForStatus(options.status);
  const fallbackSourceRefs = normalizeSourceRefs(options.fallbackSourceRefs ?? []);
  const metadataSourceRefs = isStringArray(metadata?.sourceRefs)
    ? normalizeSourceRefs(metadata.sourceRefs)
    : [];
  return {
    knowledgeClass: isKnowledgeClass(metadata?.knowledgeClass)
      ? metadata.knowledgeClass
      : defaults.knowledgeClass,
    trustLevel: isContextTrustLevel(metadata?.trustLevel)
      ? metadata.trustLevel
      : defaults.trustLevel,
    freshness: isContextFreshness(metadata?.freshness)
      ? metadata.freshness
      : defaults.freshness,
    sourceRefs: metadataSourceRefs.length > 0 ? metadataSourceRefs : fallbackSourceRefs,
    confidence: isConfidence(metadata?.confidence) ? metadata.confidence : defaults.confidence,
  };
}

export function withNormalizedKnowledgeContextMetadata(
  metadata: Record<string, unknown> | undefined,
  options: NormalizeKnowledgeContextMetadataOptions = {},
): Record<string, unknown> & NormalizedKnowledgeContextMetadata {
  const normalized = normalizeKnowledgeContextMetadata(metadata, options);
  return {
    ...(metadata ?? {}),
    ...normalized,
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every((item) => typeof item === 'string' && item.trim().length > 0);
}

function normalizeSourceRefs(sourceRefs: readonly string[]): string[] {
  return [...new Set(sourceRefs.map((ref) => ref.trim()).filter(Boolean))];
}

function isConfidence(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isNullableIso8601String(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && !Number.isNaN(Date.parse(value)));
}

function isNullableNonEmptyString(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.trim().length > 0);
}

function defaultMemoryKindForKnowledgeKind(kind: KnowledgeArtifactKind | undefined): MemoryKind {
  switch (kind) {
    case 'pattern':
    case 'dev_guide':
    case 'api_doc':
      return 'procedural';
    case 'lesson':
    case 'explore':
      return 'episodic';
    case 'requirement':
    case 'design':
    case 'architecture':
    case 'roadmap':
    case 'decision':
    default:
      return 'semantic';
  }
}

function defaultMemoryScope(
  metadata: Record<string, unknown> | undefined,
  _options: { knowledgeKind?: KnowledgeArtifactKind; status?: KnowledgeArtifactStatus },
): MemoryScope {
  return metadata && 'memoryScope' in metadata ? 'run' : 'project';
}

function defaultMemoryStatus(
  metadata: Record<string, unknown> | undefined,
  status: KnowledgeArtifactStatus | undefined,
): MemoryStatus {
  if (metadata && 'memoryStatus' in metadata) return 'candidate';
  switch (status) {
    case 'accepted':
      return 'current';
    case 'superseded':
      return 'superseded';
    case 'draft':
    default:
      return 'candidate';
  }
}

function defaultMemoryDecayPolicy(metadata: Record<string, unknown> | undefined): MemoryDecayPolicy {
  return metadata && 'decayPolicy' in metadata ? 'manual_review' : 'none';
}

// ---------------------------------------------------------------------------
// Subtype catalog
// ---------------------------------------------------------------------------

/**
 * Allowed `metadata.subtype` values per knowledge artifact kind.
 * App-layer validation only — not enforced at DB level in P0-1.
 *
 * Empty array = the kind does not accept a subtype (writing one is invalid).
 */
export const KNOWLEDGE_SUBTYPES: Record<KnowledgeArtifactKind, readonly string[]> = {
  requirement: [],
  design: [],
  architecture: [],
  roadmap: ['feature', 'milestone', 'vision'],
  decision: ['tech_stack', 'architecture', 'constraint', 'convention'],
  lesson: ['pitfall', 'knowledge'],
  pattern: ['pattern', 'library', 'technique'],
  explore: ['question', 'module_overview', 'spike'],
  dev_guide: [],
  api_doc: [],
} as const;

/**
 * Returns true iff `subtype` is a permitted value for `kind`.
 *
 *   isValidKnowledgeSubtype('lesson', 'pitfall')      → true
 *   isValidKnowledgeSubtype('lesson', 'invalid')      → false
 *   isValidKnowledgeSubtype('lesson', undefined)      → true   (no subtype is OK)
 *   isValidKnowledgeSubtype('requirement', undefined) → true   (no subtype expected)
 *   isValidKnowledgeSubtype('requirement', 'foo')     → false  (does not accept any)
 */
export function isValidKnowledgeSubtype(
  kind: KnowledgeArtifactKind,
  subtype: string | undefined,
): boolean {
  if (subtype === undefined) return true;
  const allowed = KNOWLEDGE_SUBTYPES[kind];
  return allowed.length > 0 && allowed.includes(subtype);
}

// ---------------------------------------------------------------------------
// Artifact reference shapes (V1 — kept verbatim for compatibility)
// ---------------------------------------------------------------------------

export interface ArtifactRef {
  id: ArtifactId;
  kind: ArtifactKind;
  /** URI: file://, mem:// or http(s):// */
  uri: string;
}

export interface Artifact extends ArtifactRef {
  workflowRunId: WorkflowRunId;
  stepRunId: StepRunId | null;
  size: number;
  contentType: string;
  /** SHA-256 digest of the referenced file content. Null for non-file or legacy artifacts. */
  sha256?: string | null;
  createdAt: Iso8601;
  /** Free-form metadata, e.g. {testTotal: 3} */
  metadata: Record<string, unknown>;
}

/**
 * Pointer used by Gate / Report to cite a piece of evidence.
 * Anything load-bearing in a GateRun must have at least one evidenceRef.
 */
export interface EvidenceRef {
  artifactId: ArtifactId;
  /** What this artifact proves. e.g. "mvn test exit=0" */
  claim: string;
}

// ---------------------------------------------------------------------------
// Knowledge artifact shape (V2 P0-1)
//
// Mirrors `Artifact` but lives in the dedicated `knowledge_artifacts` table
// (see DB migration in apps/api/src/store/db.ts). Project-scoped (no
// `workflowRunId`). Carries the strongly-typed `KnowledgeMetadataCore`
// fields surfaced as first-class columns; remaining freeform metadata
// rides under the `metadata` field.
// ---------------------------------------------------------------------------

export interface KnowledgeArtifact {
  id: ArtifactId;
  kind: KnowledgeArtifactKind;
  /** URI: file://, mem:// or http(s):// */
  uri: string;
  projectId: ProjectId;
  size: number;
  contentType: string;
  /** Lifecycle status (mirrors metadata.status; surfaced as a column). */
  status: KnowledgeArtifactStatus;
  /** Version counter; bumped each time the entity is re-promoted. */
  version: number;
  /** REQ-### / DSN-### / ADR-### etc. App-layer-enforced uniqueness in P0-1. */
  entityId: string | null;
  /** Back-pointer to the per-run artifact this entity was promoted from. */
  derivedFromArtifactId: ArtifactId | null;
  /** Per-kind subtype (must satisfy KNOWLEDGE_SUBTYPES). */
  subtype: string | null;
  createdAt: Iso8601;
  updatedAt: Iso8601;
  /** Free-form extension metadata (typed core fields are NOT duplicated here). */
  metadata: Record<string, unknown>;
}
