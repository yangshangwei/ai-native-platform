import type { Iso8601, ArtifactId, WorkflowRunId, StepRunId } from './ids';

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
 * Knowledge artifact metadata: typed core + freeform extension.
 *
 * Use this for any `Artifact` whose `kind` is a `KnowledgeArtifactKind`.
 */
export type KnowledgeArtifactMetadata = KnowledgeMetadataCore & Record<string, unknown>;

/**
 * Per-run artifact metadata: stays freeform (V1 behavior preserved).
 */
export type PerRunArtifactMetadata = Record<string, unknown>;

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
