import { Hono } from 'hono';
import { recordApproval } from '../workflow-engine';
import { store } from '../store/store';
import type { GateRun } from '@ainp/shared';

export const approvals = new Hono();

approvals.get('/', (c) => {
  const workflowRunId = c.req.query('workflowRunId');
  const items = workflowRunId ? store.approvals.byWorkflow(workflowRunId) : [];
  return c.json({ items });
});

approvals.post('/', async (c) => {
  const body = (await c.req.json()) as {
    workflowRunId: string;
    gateId: GateRun['gateId'];
    approved: boolean;
    actor: string;
    comment?: string | null;
  };
  if (!body.workflowRunId || !body.gateId || typeof body.approved !== 'boolean' || !body.actor) {
    return c.json({ error: 'workflowRunId, gateId, approved, actor required' }, 400);
  }
  if (body.approved === false) {
    const trimmed = typeof body.comment === 'string' ? body.comment.trim() : '';
    if (trimmed.length === 0) {
      return c.json({ error: 'comment required and must be non-empty when approved is false' }, 400);
    }
  }
  const result = recordApproval({
    workflowRunId: body.workflowRunId,
    gateId: body.gateId,
    approved: body.approved,
    actor: body.actor,
    comment: body.comment ?? null,
  });
  return c.json({ ok: true, ...result }, 201);
});
