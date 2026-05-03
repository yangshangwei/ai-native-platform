import { Hono } from 'hono';
import type {
  CoordinatorDecision,
  MessageRole,
  RequestMessage,
  WorkflowRequestStatus,
} from '@ainp/shared';
import { newId, nowIso } from '@ainp/shared';
import { store } from '../store/store';

/**
 * Chat-style intake routes used by the conversational web UI before a
 * WorkflowRun exists. The runner posts CoordinatorDecisions; the UI posts
 * user messages and reads the running thread + latest decision.
 */

export const workflowRequestChat = new Hono();

const ALLOWED_ROLES: readonly MessageRole[] = ['user', 'coordinator'];
const ALLOWED_STATUSES: readonly WorkflowRequestStatus[] = [
  'pending',
  'awaiting_clarification',
  'claimed',
  'completed',
  'failed',
  'cancelled',
];

/**
 * State-machine whitelist for `PATCH /workflow-requests/:id/status`.
 *
 * Same-state writes (e.g. `pending → pending`) are accepted as no-ops and
 * return the existing record unchanged. Terminal states (completed / failed
 * / cancelled) refuse any outward transition; rewinding from a terminal
 * status requires creating a new request, not flipping the old one.
 *
 * Note: this whitelist governs client-driven (web/runner) transitions.
 * The Workflow Engine (`workflow-engine.ts`) still owns programmatic
 * lifecycle moves (`pending → claimed`, etc.) via dedicated functions.
 */
const ALLOWED_TRANSITIONS: Record<WorkflowRequestStatus, readonly WorkflowRequestStatus[]> = {
  pending: ['awaiting_clarification', 'claimed', 'cancelled'],
  awaiting_clarification: ['pending', 'cancelled'],
  claimed: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

workflowRequestChat.post('/workflow-requests/:id/messages', async (c) => {
  const id = c.req.param('id');
  const request = store.workflowRequests.get(id);
  if (!request) return c.json({ error: 'workflow request not found' }, 404);

  const body = (await c.req.json()) as {
    role?: MessageRole;
    content?: string;
    coordinatorDecisionId?: string | null;
  };

  if (!body.role || !ALLOWED_ROLES.includes(body.role)) {
    return c.json({ error: `role must be one of ${ALLOWED_ROLES.join(', ')}` }, 400);
  }
  if (!body.content || body.content.trim().length === 0) {
    return c.json({ error: 'content required' }, 400);
  }

  const message: RequestMessage = {
    id: newId('msg'),
    workflowRequestId: id,
    role: body.role,
    content: body.content,
    coordinatorDecisionId: body.coordinatorDecisionId ?? null,
    createdAt: nowIso(),
  };
  store.requestMessages.insert(message);
  return c.json(message, 201);
});

workflowRequestChat.get('/workflow-requests/:id/messages', (c) => {
  const id = c.req.param('id');
  const request = store.workflowRequests.get(id);
  if (!request) return c.json({ error: 'workflow request not found' }, 404);

  const messages = store.requestMessages.listForRequest(id);
  const decision = store.coordinatorDecisions.latestForRequest(id);
  return c.json({ messages, decision, status: request.status });
});

workflowRequestChat.patch('/workflow-requests/:id/status', async (c) => {
  const id = c.req.param('id');
  const body = (await c.req.json()) as { status?: WorkflowRequestStatus };
  if (!body.status || !ALLOWED_STATUSES.includes(body.status)) {
    return c.json({ error: `status must be one of ${ALLOWED_STATUSES.join(', ')}` }, 400);
  }
  const current = store.workflowRequests.get(id);
  if (!current) return c.json({ error: 'workflow request not found' }, 404);

  const next = body.status;
  // Same-state writes are no-ops — return the unchanged row instead of
  // creating an audit-noisy redundant write.
  if (current.status === next) return c.json(current);

  const allowed = ALLOWED_TRANSITIONS[current.status];
  if (!allowed.includes(next)) {
    return c.json(
      { error: `illegal status transition: ${current.status} -> ${next}` },
      409,
    );
  }

  const updated = store.workflowRequests.updateStatus(id, next);
  if (!updated) return c.json({ error: 'workflow request not found' }, 404);
  return c.json(updated);
});

workflowRequestChat.post('/coordinator-decisions', async (c) => {
  const body = (await c.req.json()) as Partial<CoordinatorDecision> & {
    workflowRequestId?: string;
  };

  if (!body.workflowRequestId) return c.json({ error: 'workflowRequestId required' }, 400);
  if (!body.decision) return c.json({ error: 'decision required' }, 400);
  if (typeof body.confidence !== 'number') return c.json({ error: 'confidence required' }, 400);
  if (!body.source) return c.json({ error: 'source required' }, 400);

  const request = store.workflowRequests.get(body.workflowRequestId);
  if (!request) return c.json({ error: 'workflow request not found' }, 404);

  const decision: CoordinatorDecision = {
    id: body.id ?? newId('coord'),
    workflowRequestId: body.workflowRequestId,
    workflowRunId: body.workflowRunId ?? null,
    source: body.source,
    decision: body.decision,
    confidence: body.confidence,
    rulesFired: Array.isArray(body.rulesFired) ? body.rulesFired : [],
    decidedAt: body.decidedAt ?? nowIso(),
  };
  store.coordinatorDecisions.insert(decision);
  return c.json(decision, 201);
});
