import { Hono } from 'hono';
import type { WorkflowRequestStatus, WorkflowRunType } from '@ainp/shared';
import { store } from '../store/store';
import {
  claimWorkflowRequest,
  completeWorkflowRequest,
  createWorkflowRequest,
  markWorkflowRequestRunStarted,
} from '../workflow-engine';

export const workflowRequests = new Hono();

const STATUSES: readonly WorkflowRequestStatus[] = [
  'pending',
  'claimed',
  'completed',
  'failed',
  'cancelled',
];

workflowRequests.get('/', (c) => {
  const status = c.req.query('status') as WorkflowRequestStatus | undefined;
  if (status && !STATUSES.includes(status)) {
    return c.json({ error: `invalid workflow request status: ${status}` }, 400);
  }
  const items = status ? store.workflowRequests.byStatus(status) : store.workflowRequests.values();
  return c.json({ items });
});

workflowRequests.get('/:id', (c) => {
  const request = store.workflowRequests.get(c.req.param('id'));
  if (!request) return c.json({ error: 'not found' }, 404);
  return c.json(request);
});

workflowRequests.post('/', async (c) => {
  const body = (await c.req.json()) as {
    projectId?: string;
    projectName?: string;
    type?: WorkflowRunType;
    title?: string;
    branch?: string;
  };

  let project = body.projectId ? store.projects.get(body.projectId) : undefined;
  if (!project && body.projectName) project = store.projectByName(body.projectName);
  if (!project) return c.json({ error: 'projectId or projectName required' }, 400);
  if ((project.status ?? 'active') === 'archived') return c.json({ error: 'project is archived' }, 400);
  if (!body.title?.trim()) return c.json({ error: 'title required' }, 400);

  const request = createWorkflowRequest({
    projectId: project.id,
    type: body.type ?? 'feature',
    title: body.title.trim(),
    branch: body.branch?.trim() || project.defaultBranch,
  });
  return c.json(request, 201);
});

workflowRequests.post('/:id/claim', async (c) => {
  const requestId = c.req.param('id');
  const body = (await c.req.json()) as { runnerId?: string };
  if (!body.runnerId?.trim()) return c.json({ error: 'runnerId required' }, 400);

  const claimed = claimWorkflowRequest({ requestId, runnerId: body.runnerId.trim() });
  if (!claimed) {
    const current = store.workflowRequests.get(requestId);
    if (!current) return c.json({ error: 'not found' }, 404);
    return c.json({ error: 'request is not pending', request: current }, 409);
  }
  return c.json(claimed);
});

workflowRequests.post('/:id/run-started', async (c) => {
  const requestId = c.req.param('id');
  const body = (await c.req.json()) as { workflowRunId?: string };
  if (!body.workflowRunId?.trim()) return c.json({ error: 'workflowRunId required' }, 400);
  try {
    return c.json(
      markWorkflowRequestRunStarted({
        requestId,
        workflowRunId: body.workflowRunId.trim(),
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, message.includes('not found') ? 404 : 409);
  }
});

workflowRequests.post('/:id/complete', async (c) => {
  const requestId = c.req.param('id');
  const body = (await c.req.json()) as {
    workflowRunId?: string | null;
    ok?: boolean;
    error?: string | null;
  };
  if (typeof body.ok !== 'boolean') return c.json({ error: 'ok boolean required' }, 400);

  try {
    const completed = completeWorkflowRequest({
      requestId,
      workflowRunId: body.workflowRunId ?? null,
      ok: body.ok,
      error: body.error ?? null,
    });
    return c.json(completed);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 404);
  }
});
