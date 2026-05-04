import type { ArtifactId, Iso8601, ProjectId } from './ids';

// ---------------------------------------------------------------------------
// Knowledge entity tables (V2 P0-2)
//
// V2 § 3.6 introduces a head-pointer model for project-scoped knowledge:
// each entity table row represents the *current authoritative version* of
// an entity (REQ-### / DSN-### / etc.), pointing at a specific
// `knowledge_artifacts` row that holds the body. Historical versions
// remain in `knowledge_artifacts` and are reachable via
// `(project_id, entity_id)` index lookups.
//
// PR1 (this file) ships only the cross-layer TS types. PR2 adds the DB
// migration + store layer; PR3-PR5 add the API single-transaction promote
// path and runner refactor. See `.trellis/tasks/05-04-v2-entity-tables-bootstrap/prd.md`
// ADR-lite Q1-Q5.
// ---------------------------------------------------------------------------

/**
 * Lifecycle status of a knowledge entity (head-pointer status, not artifact
 * status — distinct from `KnowledgeArtifactStatus`):
 *
 *   draft     — entity head exists but the pointed-at artifact is not yet
 *               accepted (uncommon path; reserved for future workflows where
 *               an entity row is created before any acceptance).
 *   accepted  — head currently points at an accepted knowledge artifact;
 *               this is the "live" state for an active REQ / DSN.
 *   archived  — entity is logically removed but kept for traceability.
 *               Per Q3=3-B `designs.ref_req` is `ON DELETE RESTRICT`, so we
 *               archive instead of deleting once a design references it.
 */
export type RequirementEntityStatus = 'draft' | 'accepted' | 'archived';

/**
 * `requirements` entity-table row. Each row is the head pointer for a
 * single REQ-### in a project; historical versions live in
 * `knowledge_artifacts` (queried via `latestByEntityId` / `byEntityId`).
 *
 * `id` is the entity_id itself (e.g. "REQ-001") and is the DB primary key
 * per PRD R5. `(project_id, id)` carries an additional UNIQUE constraint
 * for project-scoped uniqueness (R7).
 *
 * @see `.trellis/tasks/05-04-v2-entity-tables-bootstrap/prd.md` ADR-lite Q2
 */
export interface RequirementEntity {
  /** Entity identifier (e.g. "REQ-001"). Acts as the DB primary key. */
  id: string;
  /** Owning project (entity tables are project-scoped, never cross-project). */
  projectId: ProjectId;
  /** Lifecycle status of this entity head. */
  status: RequirementEntityStatus;
  /**
   * Version number of the currently-pointed knowledge_artifacts row.
   * Increments by the API promote transaction's max+1 logic.
   */
  currentVersion: number;
  /**
   * Foreign-style reference to `knowledge_artifacts.id` for the current
   * accepted version. Per Q3=3-B this is **NOT** declared as a DB FK —
   * referential integrity is upheld by the API promote transaction
   * (which inserts the new knowledge_artifacts row and upserts this
   * pointer in the same `db.transaction(...)` block).
   */
  currentArtifactId: ArtifactId;
  createdAt: Iso8601;
  updatedAt: Iso8601;
}

/**
 * `designs` entity-table row. Same head-pointer shape as
 * {@link RequirementEntity}, plus a strong-FK reference to the requirement
 * this design realizes.
 *
 * Per Q3=3-B `refReq` corresponds to a DB-level
 * `REFERENCES requirements(id) ON DELETE RESTRICT` — the only FK introduced
 * in P0-2. This protects the V2 § 3.6 traceability invariant
 * (REQ↔DSN must be machine-traceable) at the storage layer.
 *
 * @see `.trellis/tasks/05-04-v2-entity-tables-bootstrap/prd.md` ADR-lite Q3
 */
export interface DesignEntity {
  /** Entity identifier (e.g. "DSN-001"). Acts as the DB primary key. */
  id: string;
  projectId: ProjectId;
  status: RequirementEntityStatus;
  currentVersion: number;
  currentArtifactId: ArtifactId;
  /**
   * The requirement (`requirements.id`) this design realizes. Strong DB
   * FK with `ON DELETE RESTRICT` — a requirement that has any design
   * pointing at it cannot be deleted; it must first be archived/orphaned
   * by application logic.
   */
  refReq: string;
  createdAt: Iso8601;
  updatedAt: Iso8601;
}

// ---------------------------------------------------------------------------
// Promote API contract (V2 P0-2 / Q5=5-A)
//
// `POST /knowledge-artifacts/promote` is the single canonical entry point
// for turning an accepted per-run draft (`requirement_draft` / `design_doc`)
// into a knowledge entity. The API server runs all 6 steps
// (frontmatter parse → max+1 → version bump → supersede prior → INSERT
// knowledge_artifact → UPSERT entity head) inside a single
// `db.transaction(...)` for race-free, atomic semantics.
//
// The runner side (`apps/runner/src/orchestrator.ts`) collapses to a thin
// HTTP wrapper that builds this request and surfaces the response.
// ---------------------------------------------------------------------------

/**
 * Per-run draft kinds eligible for promotion via the V2 promote endpoint.
 * A subset of `PerRunArtifactKind`. The matching `entityKind` is
 * `requirement` / `design` respectively (see {@link PromoteResponse}).
 */
export type PromotableDraftKind = 'requirement_draft' | 'design_doc';

/**
 * Knowledge entity kinds produced by promotion. A subset of
 * `KnowledgeArtifactKind` corresponding 1:1 to {@link PromotableDraftKind}.
 */
export type PromotedEntityKind = 'requirement' | 'design';

/**
 * Request payload for `POST /knowledge-artifacts/promote`.
 *
 * The runner sends the full draft markdown body (`draftText`) so the API
 * can extract any explicit `REQ-###` / `DSN-###` from frontmatter or body;
 * absent that, the API generates a fresh entity_id via the project-scoped
 * max+1 fallback. All decision logic lives server-side per Q5=5-A.
 */
export interface PromoteRequest {
  projectId: ProjectId;
  /** Per-run draft kind being promoted. */
  kind: PromotableDraftKind;
  /** ID of the per-run draft artifact (`artifacts` table) being promoted. */
  draftArtifactId: ArtifactId;
  /**
   * Full markdown body of the draft. Used by the API's regex extraction
   * step to discover an explicit entity_id; not stored separately —
   * `uri` already points at the persisted draft body on disk.
   */
  draftText: string;
  /** URI of the persisted draft file (e.g. `file:///.../requirement_draft.md`). */
  uri: string;
  /** Byte size of the draft body. */
  size: number;
  /** MIME content type of the draft body (e.g. `text/markdown`). */
  contentType: string;
}

/**
 * Response payload from `POST /knowledge-artifacts/promote`.
 *
 * On success, the API has atomically: (1) inserted a new
 * `knowledge_artifacts` row with `kind = entityKind`, `version`,
 * `entity_id = entityId`, `status = 'accepted'`, and (2) upserted the
 * entity head row in `requirements` / `designs` to point at this new
 * `knowledgeArtifactId` with `currentVersion = version`.
 *
 * Failures roll back the entire transaction and surface as HTTP 4xx/5xx —
 * the runner downgrades these to a log line per R12 / R28 (acceptance
 * gate must NOT be broken by a promote failure).
 */
export interface PromoteResponse {
  /** ID of the newly-created `knowledge_artifacts` row. */
  knowledgeArtifactId: ArtifactId;
  /** Resolved entity_id (e.g. "REQ-001" / "DSN-001"). */
  entityId: string;
  /** Knowledge artifact kind that was created. */
  entityKind: PromotedEntityKind;
  /** Version assigned to the new accepted row. */
  version: number;
}
