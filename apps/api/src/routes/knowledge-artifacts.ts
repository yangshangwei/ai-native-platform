/**
 * Knowledge artifacts REST endpoints (V2 P0-1, PR2).
 *
 * Sibling to `routes/artifacts.ts`, but operates on the project-scoped
 * `knowledge_artifacts` table. See PRD at
 * `.trellis/tasks/05-04-v2-artifact-kind-expansion/prd.md` for the
 * data model and ADRs (Q1/Q2/Q3/Q4).
 *
 * Mounted under `/knowledge-artifacts` in `app.ts`.
 */

import { Hono } from 'hono';
import {
  isKnowledgeArtifactKind,
  type KnowledgeArtifactKind,
  type KnowledgeArtifactStatus,
  type PromoteRequest,
} from '@ainp/shared';
import { store } from '../store/store';
import {
  createKnowledgeArtifact,
  setKnowledgeArtifactStatus,
  KnowledgeArtifactValidationError,
} from '../workflow-engine';
import { promoteDraftInTransaction } from '../promote';

export const knowledgeArtifacts = new Hono();

// ---- write -----------------------------------------------------------------

knowledgeArtifacts.post('/projects/:projectId', async (c) => {
  const projectId = c.req.param('projectId');
  const body = (await c.req.json()) as {
    kind: KnowledgeArtifactKind;
    uri: string;
    size: number;
    contentType: string;
    status?: KnowledgeArtifactStatus;
    version?: number;
    entityId?: string | null;
    derivedFromArtifactId?: string | null;
    subtype?: string | null;
    metadata?: Record<string, unknown>;
  };

  // Confused-tier protection: per-run kinds must NOT be written here.
  if (!isKnowledgeArtifactKind(body.kind)) {
    return c.json(
      {
        error: `kind '${String(body.kind)}' is not a KnowledgeArtifactKind. Use POST /runner/events/artifact for per-run artifacts.`,
      },
      400,
    );
  }

  try {
    const artifact = createKnowledgeArtifact({
      projectId,
      kind: body.kind,
      uri: body.uri,
      size: body.size,
      contentType: body.contentType,
      status: body.status,
      version: body.version,
      entityId: body.entityId,
      derivedFromArtifactId: body.derivedFromArtifactId,
      subtype: body.subtype,
      metadata: body.metadata,
    });
    return c.json({ ok: true, artifact }, 201);
  } catch (err) {
    if (err instanceof KnowledgeArtifactValidationError) {
      return c.json({ error: err.message, field: err.field }, 400);
    }
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// ---- promote (V2 P0-2 / Q5=5-A) -------------------------------------------
//
// Single canonical entry point for turning an accepted per-run draft
// (`requirement_draft` / `design_doc`) into a knowledge entity. The full
// 6-step pipeline runs inside one db.transaction in
// `promoteDraftInTransaction`. Runner-side code (PR5) is a thin HTTP
// wrapper that just forwards the request and surfaces the response.
//
// Errors:
//   - 400 KnowledgeArtifactValidationError (bad kind, missing refReq, etc.)
//   - 409 SQLITE FK / constraint violation (refers to non-existent REQ)
//   - 500 anything else

knowledgeArtifacts.post('/promote', async (c) => {
  const body = (await c.req.json()) as PromoteRequest;

  // Shallow shape check before handing off to the transaction.
  for (const field of [
    'projectId',
    'kind',
    'draftArtifactId',
    'draftText',
    'uri',
    'contentType',
  ] as const) {
    if (typeof body[field] !== 'string' || body[field].length === 0) {
      return c.json(
        { error: `missing or invalid required string field: '${field}'` },
        400,
      );
    }
  }
  if (typeof body.size !== 'number' || !Number.isFinite(body.size) || body.size < 0) {
    return c.json({ error: `missing or invalid 'size' (must be a non-negative number)` }, 400);
  }
  if (body.kind !== 'requirement_draft' && body.kind !== 'design_doc') {
    return c.json(
      {
        error: `kind '${String(body.kind)}' is not a promotable draft kind (allowed: requirement_draft, design_doc)`,
      },
      400,
    );
  }

  try {
    const result = await promoteDraftInTransaction(body);
    return c.json({ ok: true, result }, 201);
  } catch (err) {
    if (err instanceof KnowledgeArtifactValidationError) {
      return c.json({ error: err.message, field: err.field }, 400);
    }
    const msg = err instanceof Error ? err.message : String(err);
    // SQLite FK / unique violations land here (the transaction rolled back).
    if (/FOREIGN KEY|UNIQUE|constraint/i.test(msg)) {
      return c.json({ error: msg, code: 'CONSTRAINT_VIOLATION' }, 409);
    }
    return c.json({ error: msg }, 500);
  }
});

// ---- read ------------------------------------------------------------------

knowledgeArtifacts.get('/projects/:projectId', (c) => {
  const projectId = c.req.param('projectId');
  const kindFilter = c.req.query('kind');
  if (kindFilter !== undefined) {
    if (!isKnowledgeArtifactKind(kindFilter)) {
      return c.json({ error: `invalid kind filter: '${kindFilter}'` }, 400);
    }
    return c.json({
      ok: true,
      artifacts: store.knowledgeArtifacts.byKind(projectId, kindFilter),
    });
  }
  return c.json({
    ok: true,
    artifacts: store.knowledgeArtifacts.byProject(projectId),
  });
});

knowledgeArtifacts.get('/projects/:projectId/by-entity/:entityId', (c) => {
  const projectId = c.req.param('projectId');
  const entityId = c.req.param('entityId');
  return c.json({
    ok: true,
    artifacts: store.knowledgeArtifacts.byEntityId(projectId, entityId),
  });
});

knowledgeArtifacts.get('/:id', (c) => {
  const id = c.req.param('id');
  const artifact = store.knowledgeArtifacts.get(id);
  if (!artifact) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true, artifact });
});

// ---- mutate ----------------------------------------------------------------

knowledgeArtifacts.patch('/:id/status', async (c) => {
  const id = c.req.param('id');
  const body = (await c.req.json()) as { status: KnowledgeArtifactStatus };
  if (!body.status || !['draft', 'accepted', 'superseded'].includes(body.status)) {
    return c.json({ error: `invalid status: '${String(body.status)}'` }, 400);
  }
  try {
    const artifact = setKnowledgeArtifactStatus(id, body.status);
    return c.json({ ok: true, artifact });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 404);
  }
});
