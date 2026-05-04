import {
  isKnowledgeArtifactKind,
  type ArtifactId,
  type KnowledgeArtifact,
  type KnowledgeArtifactKind,
  type ProjectId,
  type PromotableDraftKind,
  type PromotedEntityKind,
  type PromoteRequest,
  type PromoteResponse,
} from '@ainp/shared';
import { db } from './store/db';
import { store } from './store/store';
import {
  createKnowledgeArtifact,
  KnowledgeArtifactValidationError,
} from './workflow-engine';

// ---------------------------------------------------------------------------
// V2 P0-2 / Q5=5-A: API-side single-transaction promote
//
// Lifts an accepted per-run draft (`requirement_draft` / `design_doc`) into a
// project-scoped knowledge entity (REQ-### / DSN-###). All 6 steps run inside
// one `db.transaction(...)` so the operation is atomic with respect to
// concurrent runners and partial failures.
//
// Steps:
//   1. Map `kind` (requirement_draft | design_doc) → `entityKind` (requirement | design)
//   2. Resolve `entityId`: extract REQ-### / DSN-### from `draftText`; on absence
//      fall back to project-scoped max(existing entity_id) + 1.
//   3. (designs only) Extract `refReq` (first REQ-### in draftText). Required
//      per R29 — design without a referenced requirement is rejected.
//   4. Compute `nextVersion`: 1 if first promote of this entity, else
//      max(existing.version) + 1 over `knowledge_artifacts.byEntityId`.
//   5. Mark all prior `status='accepted'` rows for this entity as `superseded`.
//   6. INSERT new `status='accepted'` `knowledge_artifacts` row + UPSERT
//      entity head row (`requirements` / `designs`).
//
// FK behavior:
//   - First-time INSERT into `designs` triggers SQLite's
//     `FOREIGN KEY(ref_req) REFERENCES requirements(id) ON DELETE RESTRICT`.
//     A non-existent `refReq` causes the entire transaction to ROLLBACK.
//   - `current_artifact_id` is bare TEXT (no DB FK per Q3=3-B); referential
//     integrity is upheld by step 6 happening in the same transaction as
//     step 6's INSERT (we always upsert the head pointing at a row we just
//     inserted in step 6's first half).
//
// Failure semantics (R12 / R28):
//   - Validation errors throw `KnowledgeArtifactValidationError` (HTTP 400).
//   - FK / DB errors propagate as plain Error (HTTP 500). Either way the
//     transaction rolls back. The runner-side wrapper logs and downgrades
//     so the acceptance gate is never broken (PR5 will adjust runner code).
//
// See `.trellis/tasks/05-04-v2-entity-tables-bootstrap/prd.md` ADR Q1-Q5.
// ---------------------------------------------------------------------------

const REQ_PREFIX = 'REQ' as const;
const DSN_PREFIX = 'DSN' as const;

const KIND_TO_ENTITY: Record<PromotableDraftKind, PromotedEntityKind> = {
  requirement_draft: 'requirement',
  design_doc: 'design',
};

const ENTITY_TO_PREFIX: Record<PromotedEntityKind, typeof REQ_PREFIX | typeof DSN_PREFIX> = {
  requirement: REQ_PREFIX,
  design: DSN_PREFIX,
};

function extractFirstId(prefix: string, text: string): string | null {
  const match = text.match(new RegExp(`\\b${prefix}-(\\d{1,6})\\b`));
  if (!match || !match[1]) return null;
  return `${prefix}-${match[1].padStart(3, '0')}`;
}

function nextEntityIdFallback(
  projectId: ProjectId,
  entityKind: KnowledgeArtifactKind,
  prefix: string,
): string {
  const existing = store.knowledgeArtifacts.byKind(projectId, entityKind);
  const maxNum = existing
    .map((a) => a.entityId)
    .filter((id): id is string => Boolean(id))
    .map((id) => id.match(new RegExp(`^${prefix}-(\\d+)$`))?.[1])
    .filter((n): n is string => Boolean(n))
    .map(Number)
    .reduce((acc, n) => Math.max(acc, n), 0);
  return `${prefix}-${String(maxNum + 1).padStart(3, '0')}`;
}

/**
 * Single-transaction promote: 6 steps + entity head upsert. See module
 * docstring for the algorithm and FK behavior contract.
 *
 * @throws {KnowledgeArtifactValidationError} for missing refReq on a design
 *   draft, or invalid input shape.
 * @throws {Error} for DB / FK errors (caught at the transaction boundary;
 *   rolled back automatically by bun:sqlite's transaction primitive).
 */
export function promoteDraftInTransaction(input: PromoteRequest): PromoteResponse {
  const entityKind = KIND_TO_ENTITY[input.kind];
  if (!entityKind || !isKnowledgeArtifactKind(entityKind)) {
    throw new KnowledgeArtifactValidationError(
      `kind '${String(input.kind)}' is not a promotable draft kind`,
      'kind',
    );
  }
  const prefix = ENTITY_TO_PREFIX[entityKind];

  // Pre-extract IDs from `draftText` outside the transaction (pure work).
  const extractedEntityId = extractFirstId(prefix, input.draftText);
  const extractedRefReq =
    entityKind === 'design' ? extractFirstId(REQ_PREFIX, input.draftText) : null;

  // For designs, refReq is mandatory per R29: no silent drop.
  if (entityKind === 'design' && !extractedRefReq) {
    throw new KnowledgeArtifactValidationError(
      'design_doc draft must reference an existing REQ-### in its body or frontmatter',
      'draftText',
    );
  }

  let response!: PromoteResponse;
  const txn = db.transaction(() => {
    // Step 2-cont: resolve entity_id (frontmatter hint OR max+1 fallback).
    // Fallback runs in-tx so concurrent promotes serialize on SQLite's write
    // lock and don't collide on the same number.
    const entityId =
      extractedEntityId ?? nextEntityIdFallback(input.projectId, entityKind, prefix);

    // Step 4: compute nextVersion based on existing same-entity rows.
    const sameEntity = store.knowledgeArtifacts.byEntityId(input.projectId, entityId);
    const nextVersion =
      sameEntity.length === 0 ? 1 : Math.max(...sameEntity.map((e) => e.version)) + 1;

    // Step 5: supersede prior accepted rows.
    for (const e of sameEntity.filter((e) => e.status === 'accepted')) {
      store.knowledgeArtifacts.updateStatus(e.id, 'superseded', new Date().toISOString());
    }

    // Step 6a: INSERT new accepted knowledge_artifacts row via the canonical
    // factory (validates kind / subtype, generates id, stamps timestamps).
    const created: KnowledgeArtifact = createKnowledgeArtifact({
      projectId: input.projectId,
      kind: entityKind,
      uri: input.uri,
      size: input.size,
      contentType: input.contentType,
      status: 'accepted',
      version: nextVersion,
      entityId,
      derivedFromArtifactId: input.draftArtifactId as ArtifactId,
    });

    // Step 6b: UPSERT entity head row.
    const now = new Date().toISOString();
    if (entityKind === 'requirement') {
      store.requirementEntities.upsertHead({
        id: entityId,
        projectId: input.projectId,
        status: 'accepted',
        currentVersion: nextVersion,
        currentArtifactId: created.id,
        now,
      });
    } else {
      // entityKind === 'design'; extractedRefReq is guaranteed non-null above.
      store.designEntities.upsertHead({
        id: entityId,
        projectId: input.projectId,
        status: 'accepted',
        currentVersion: nextVersion,
        currentArtifactId: created.id,
        refReq: extractedRefReq as string,
        now,
      });
    }

    response = {
      knowledgeArtifactId: created.id,
      entityId,
      entityKind,
      version: nextVersion,
    };
  });

  txn();
  return response;
}
