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
  type EntityFileFrontmatter,
} from '@ainp/shared';
import { db } from './store/db';
import { store } from './store/store';
import {
  createKnowledgeArtifact,
  KnowledgeArtifactValidationError,
  setKnowledgeArtifactStatus,
} from './workflow-engine';
import {
  ensureCodestableDir,
  isPathSafeEntityId,
  renderEntityMarkdown,
  writeEntityFile,
} from './promote-file';

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
 * Single-transaction promote: 6 DB steps + dual-write file output.
 *
 * V2 P1-1 / Q3 (Stage-then-Finalize):
 *   1. Pre-tx: validate project exists + has localPath; ensureCodestableDir
 *      (mkdir -p `<localPath>/codestable/<kind-plural>/`). Fail-fast.
 *   2. Tx: PR3 6-step DB pipeline unchanged.
 *   3. Post-tx: render frontmatter with FINAL values from the tx
 *      (entityId, version, knowledgeArtifactId), writeEntityFile to the
 *      canonical `<entityId>.md` path. Failure here is logged but does
 *      NOT roll back DB (R10 / R11) — would require compensating tx
 *      complexity for marginal benefit.
 *
 * Returns immediately on success even if file-write logging surfaces an
 * error — the runner-side wrapper preserves "never break acceptance gate"
 * (R12 / R28); ops can reconcile via the future drift-scan task.
 *
 * @throws {KnowledgeArtifactValidationError} for missing refReq on a design
 *   draft, invalid kind, or unknown projectId.
 * @throws {Error} for DB / FK errors (transaction rolled back automatically)
 *   and ensureCodestableDir failures (mkdir / permission / disk full).
 */
export async function promoteDraftInTransaction(
  input: PromoteRequest,
): Promise<PromoteResponse> {
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

  // P1-1 / Q3 step 1 (pre-tx): resolve project + ensure codestable dir
  // exists. mkdir -p is fail-fast — disk full / permission / missing
  // localPath all surface here BEFORE the DB transaction starts.
  const project = store.projects.get(input.projectId);
  if (!project) {
    throw new KnowledgeArtifactValidationError(
      `project '${input.projectId}' does not exist; cannot promote into a missing project`,
      'projectId',
    );
  }
  await ensureCodestableDir(project.localPath, entityKind);

  let response!: PromoteResponse;
  let createdRow!: KnowledgeArtifact;
  let resolvedEntityId!: string;
  let resolvedVersion!: number;
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
      setKnowledgeArtifactStatus(e.id, 'superseded');
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
    createdRow = created;
    resolvedEntityId = entityId;
    resolvedVersion = nextVersion;
  });

  txn();

  // P1-1 / Q3 step 3 (post-tx): write entity markdown file. Re-render with
  // FINAL values from the tx (entityId might have changed due to in-tx
  // max+1 fallback). Failure here is logged but does NOT roll back DB
  // per R10 / R11 — drift recoverable via future scan task.
  if (isPathSafeEntityId(resolvedEntityId)) {
    try {
      const fm: EntityFileFrontmatter =
        entityKind === 'requirement'
          ? {
              entity_id: resolvedEntityId,
              kind: 'requirement',
              status: 'accepted',
              version: resolvedVersion,
              updated_at: createdRow.updatedAt,
              knowledge_artifact_id: createdRow.id,
            }
          : {
              entity_id: resolvedEntityId,
              kind: 'design',
              status: 'accepted',
              version: resolvedVersion,
              updated_at: createdRow.updatedAt,
              knowledge_artifact_id: createdRow.id,
              ref_req: extractedRefReq as string,
            };

      const contents = renderEntityMarkdown({ frontmatter: fm, body: input.draftText });

      await writeEntityFile({
        projectLocalPath: project.localPath,
        entityKind,
        entityId: resolvedEntityId,
        contents,
      });
    } catch (err) {
      // R10 / R11: file write failure does NOT trigger DB rollback. Log
      // with the DB row id + entity_id so ops can reconcile via the
      // future drift-scan task; surface it back to the caller as a
      // warning side-channel (the response below still indicates DB
      // success).
      console.error(
        `[promote] file write failed for ${resolvedEntityId} (kart=${createdRow.id}): ${
          err instanceof Error ? err.message : String(err)
        } — DB row is committed; filesystem may diverge`,
      );
    }
  } else {
    // Path-unsafe entity_id (regex-mismatched). DB row is committed; we
    // skip file write entirely and log so ops can decide on a manual
    // reconcile path. This branch is exotic — entity_id is normally
    // produced by the API itself and matches REQ-### / DSN-### exactly.
    console.error(
      `[promote] entity_id '${resolvedEntityId}' fails path-safety; skipping file write (kart=${createdRow.id})`,
    );
  }

  return response;
}
