import { Hono } from 'hono';
import type { ArtifactKind } from '@ainp/shared';
import { store } from '../store/store';
import { readArtifactContent } from '../artifact-content';

export const artifacts = new Hono();

artifacts.get('/workflow-runs/:workflowRunId/:kind/latest/content', (c) => {
  const workflowRunId = c.req.param('workflowRunId');
  const kind = c.req.param('kind') as ArtifactKind;
  const artifact = store.artifacts.byKind(workflowRunId, kind).at(-1) ?? null;
  if (!artifact) return c.json({ error: 'not found' }, 404);
  try {
    const content = readArtifactContent(artifact);
    return c.json({ artifact, ...content });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

artifacts.get('/:id/content', (c) => {
  const id = c.req.param('id');
  const artifact = store.artifacts.get(id);
  if (!artifact) return c.json({ error: 'not found' }, 404);
  try {
    const content = readArtifactContent(artifact);
    return c.json({ artifact, ...content });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});
