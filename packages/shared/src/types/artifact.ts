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
}

export interface NormalizedKnowledgeContextMetadata {
  knowledgeClass: KnowledgeClass;
  trustLevel: ContextTrustLevel;
  freshness: ContextFreshness;
  sourceRefs: string[];
  confidence: number;
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
  if ('sourceRefs' in metadata && !isStringArray(metadata.sourceRefs)) {
    errors.push(`metadata.sourceRefs must be an array of non-empty strings`);
  }
  if ('confidence' in metadata && !isConfidence(metadata.confidence)) {
    errors.push(`metadata.confidence must be a number between 0 and 1`);
  }
  return errors;
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
