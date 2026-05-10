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
  isContextFreshness,
  isContextTrustLevel,
  isKnowledgeClass,
  isKnowledgeArtifactKind,
  isKnowledgeArtifactStatus,
  normalizeKnowledgeContextMetadata,
  type ContextFreshness,
  type ContextTrustLevel,
  type KnowledgeArtifact,
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

knowledgeArtifacts.post('/projects/:projectId/seed', async (c) => {
  const projectId = c.req.param('projectId');
  const body = (await c.req.json()) as {
    kind?: KnowledgeArtifactKind;
    title?: string;
    text?: string;
    uri?: string;
    size?: number;
    contentType?: string;
    status?: KnowledgeArtifactStatus;
    version?: number;
    entityId?: string | null;
    derivedFromArtifactId?: string | null;
    subtype?: string | null;
    sourceRefs?: string[];
    trustLevel?: ContextTrustLevel;
    freshness?: ContextFreshness;
    confidence?: number;
    metadata?: Record<string, unknown>;
  };
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return c.json({ error: 'text required for seed knowledge' }, 400);
  const kind = body.kind ?? 'dev_guide';
  if (!isKnowledgeArtifactKind(kind)) {
    return c.json({ error: `kind '${String(kind)}' is not a KnowledgeArtifactKind` }, 400);
  }
  if (body.trustLevel !== undefined && !isContextTrustLevel(body.trustLevel)) {
    return c.json({ error: `invalid trustLevel: '${String(body.trustLevel)}'` }, 400);
  }
  if (body.freshness !== undefined && !isContextFreshness(body.freshness)) {
    return c.json({ error: `invalid freshness: '${String(body.freshness)}'` }, 400);
  }
  if (body.status !== undefined && !isKnowledgeArtifactStatus(body.status)) {
    return c.json({ error: `invalid status: '${String(body.status)}'` }, 400);
  }

  try {
    const artifact = createKnowledgeArtifact({
      projectId,
      kind,
      uri: body.uri
        ?? `mem://seed/${encodeURIComponent(body.entityId ?? body.title ?? 'project-seed')}.md`,
      size: body.size ?? Buffer.byteLength(text, 'utf8'),
      contentType: body.contentType ?? 'text/markdown',
      status: body.status ?? 'accepted',
      version: body.version,
      entityId: body.entityId,
      derivedFromArtifactId: body.derivedFromArtifactId,
      subtype: body.subtype,
      metadata: {
        ...(body.metadata ?? {}),
        title: body.title,
        text,
        knowledgeClass: 'seed',
        trustLevel: body.trustLevel ?? 'summary',
        freshness: body.freshness ?? 'current',
        sourceRefs: body.sourceRefs ?? ['seed:api'],
        confidence: body.confidence ?? 0.6,
      },
    });
    return c.json({ ok: true, artifact }, 201);
  } catch (err) {
    if (err instanceof KnowledgeArtifactValidationError) {
      return c.json({ error: err.message, field: err.field }, 400);
    }
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

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
  if (body.status !== undefined && !isKnowledgeArtifactStatus(body.status)) {
    return c.json({ error: `invalid status: '${String(body.status)}'` }, 400);
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
  const knowledgeClassFilter = c.req.query('knowledgeClass');
  if (knowledgeClassFilter !== undefined && !isKnowledgeClass(knowledgeClassFilter)) {
    return c.json({ error: `invalid knowledgeClass filter: '${knowledgeClassFilter}'` }, 400);
  }
  let artifacts: KnowledgeArtifact[];
  if (kindFilter !== undefined) {
    if (!isKnowledgeArtifactKind(kindFilter)) {
      return c.json({ error: `invalid kind filter: '${kindFilter}'` }, 400);
    }
    artifacts = store.knowledgeArtifacts.byKind(projectId, kindFilter);
  } else {
    artifacts = store.knowledgeArtifacts.byProject(projectId);
  }
  if (knowledgeClassFilter) {
    artifacts = artifacts.filter((artifact) => (
      normalizeKnowledgeContextMetadata(artifact.metadata, {
        status: artifact.status,
      }).knowledgeClass === knowledgeClassFilter
    ));
  }
  return c.json({ ok: true, artifacts });
});

knowledgeArtifacts.get('/projects/:projectId/seed', (c) => {
  const projectId = c.req.param('projectId');
  const artifacts = store.knowledgeArtifacts.byProject(projectId).filter((artifact) => (
    normalizeKnowledgeContextMetadata(artifact.metadata, {
      status: artifact.status,
    }).knowledgeClass === 'seed'
  ));
  return c.json({
    ok: true,
    artifacts,
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
  if (!isKnowledgeArtifactStatus(body.status)) {
    return c.json({ error: `invalid status: '${String(body.status)}'` }, 400);
  }
  try {
    const artifact = setKnowledgeArtifactStatus(id, body.status);
    return c.json({ ok: true, artifact });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 404);
  }
});
