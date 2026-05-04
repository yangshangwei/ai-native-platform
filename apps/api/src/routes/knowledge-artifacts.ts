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
} from '@ainp/shared';
import { store } from '../store/store';
import {
  createKnowledgeArtifact,
  setKnowledgeArtifactStatus,
  KnowledgeArtifactValidationError,
} from '../workflow-engine';

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
