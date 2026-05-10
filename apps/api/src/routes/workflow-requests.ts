import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type {
  AgentStreamEvent,
  FlowId,
  MessageRole,
  Project,
  WorkflowRequestStatus,
  WorkflowRunType,
  WorkflowStage,
} from '@ainp/shared';
import { store } from '../store/store';
import {
  claimWorkflowRequest,
  completeWorkflowRequest,
  createWorkflowRequest,
  markWorkflowRequestRunStarted,
} from '../workflow-engine';
import { subscribe } from '../agent-stream-bus';
import {
  KNOWN_FLOW_IDS,
  KNOWN_WORKFLOW_STAGES,
  isFlowId,
  isWorkflowStage,
} from './workflow-runs';

export const workflowRequests = new Hono();

const STATUSES: readonly WorkflowRequestStatus[] = [
  'pending',
  'awaiting_clarification',
  'claimed',
  'completed',
  'failed',
  'cancelled',
];

const ALLOWED_FIRST_MESSAGE_ROLES: readonly MessageRole[] = ['user', 'coordinator'];

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
    firstMessage?: { role?: MessageRole; content?: string };
    flowId?: string | null;
    startStage?: string | null;
  };

  let project = body.projectId ? store.projects.get(body.projectId) : undefined;
  if (!project && body.projectName) project = store.projectByName(body.projectName);
  if (!project) return c.json({ error: 'projectId or projectName required' }, 400);
  if ((project.status ?? 'active') === 'archived') return c.json({ error: 'project is archived' }, 400);
  const backendError = projectAgentBackendError(project);
  if (backendError) return c.json({ error: backendError, needsAgentBackendSetup: true }, 400);
  if (!body.title?.trim()) return c.json({ error: 'title required' }, 400);

  // Validate firstMessage BEFORE any DB write so the atomicity contract holds:
  // bad firstMessage MUST NOT leave a request behind without its message.
  let firstMessage: { role: MessageRole; content: string } | undefined;
  if (body.firstMessage !== undefined) {
    const role = body.firstMessage.role;
    const content = body.firstMessage.content;
    if (!role || !ALLOWED_FIRST_MESSAGE_ROLES.includes(role)) {
      return c.json(
        { error: `firstMessage.role must be one of ${ALLOWED_FIRST_MESSAGE_ROLES.join(', ')}` },
        400,
      );
    }
    if (typeof content !== 'string' || content.trim().length === 0) {
      return c.json({ error: 'firstMessage.content required' }, 400);
    }
    firstMessage = { role, content };
  }

  // Optional UI overrides from the New Task form 高级覆盖 disclosure.
  // null/undefined/'' all collapse to "no override" so the runner watch loop
  // falls back to Coordinator + Router. Validate the trust-boundary mirroring
  // /workflow-runs POST behaviour (PRD 05-08 Q2 = 400 hard error).
  let flowId: FlowId | null | undefined;
  if (body.flowId !== undefined && body.flowId !== null && body.flowId !== '') {
    if (!isFlowId(body.flowId)) {
      return c.json(
        { error: `unknown flowId: ${body.flowId} (known: ${KNOWN_FLOW_IDS.join(', ')})` },
        400,
      );
    }
    flowId = body.flowId;
  }

  let startStage: WorkflowStage | null | undefined;
  if (body.startStage !== undefined && body.startStage !== null && body.startStage !== '') {
    if (!isWorkflowStage(body.startStage)) {
      return c.json(
        { error: `unknown startStage: ${body.startStage} (known: ${KNOWN_WORKFLOW_STAGES.join(', ')})` },
        400,
      );
    }
    // Per FlowDef.startStage docstring: only `feature.standard` carries
    // non-null startStage values; other flows are short and run head-to-tail.
    if (flowId !== undefined && flowId !== 'feature.standard') {
      return c.json(
        { error: `startStage is only allowed when flowId is 'feature.standard'` },
        400,
      );
    }
    if (flowId === undefined) {
      return c.json(
        { error: `startStage requires flowId='feature.standard'` },
        400,
      );
    }
    startStage = body.startStage;
  }

  const request = createWorkflowRequest({
    projectId: project.id,
    type: body.type ?? 'feature',
    title: body.title.trim(),
    branch: body.branch?.trim() || project.defaultBranch,
    firstMessage,
    flowId: flowId ?? null,
    startStage: startStage ?? null,
  });
  return c.json(request, 201);
});

function projectAgentBackendError(project: Project): string | null {
  if (!project.agentBackend) {
    return 'Agent Backend is not configured for this project. Choose Claude Code or Codex before creating a workflow request.';
  }
  return null;
}

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

/**
 * History tail for the request channel — symmetric with
 * `/workflow-runs/:id/agent-events`. Returns events with `sequence > sinceSeq`
 * (default -1, i.e. full history). Used by clients before / instead of SSE.
 */
workflowRequests.get('/:id/agent-events', (c) => {
  const id = c.req.param('id');
  if (!store.workflowRequests.get(id)) return c.json({ error: 'not found' }, 404);
  const sinceSeq = Number(c.req.query('sinceSeq') ?? -1);
  const items = store.agentEvents.byRequest(id, Number.isFinite(sinceSeq) ? sinceSeq : -1);
  return c.json({ items });
});

/**
 * Live SSE tail of agent events for the request channel (Coordinator triage,
 * any future pre-workflow-run agent stage). Mirrors
 * `GET /workflow-runs/:id/agent-stream`: replays history > sinceSeq, then
 * attaches a subscriber for newly-published events. Closes when client
 * disconnects.
 *
 * Wire format: `event: <type>\nid: <sequence>\ndata: <AgentStreamEvent json>\n\n`.
 */
workflowRequests.get('/:id/agent-stream', (c) => {
  const id = c.req.param('id');
  if (!store.workflowRequests.get(id)) return c.json({ error: 'not found' }, 404);
  const sinceSeq = Number(c.req.query('sinceSeq') ?? -1);

  return streamSSE(c, async (stream) => {
    let aborted = false;
    stream.onAbort(() => {
      aborted = true;
    });

    const writeEvent = async (ev: AgentStreamEvent): Promise<void> => {
      await stream.writeSSE({
        id: String(ev.sequence),
        event: ev.type,
        data: JSON.stringify(ev),
      });
    };

    let lastSeq = Number.isFinite(sinceSeq) ? sinceSeq : -1;
    const queue: AgentStreamEvent[] = [];
    let resolveNext: (() => void) | null = null;
    const unsubscribe = subscribe({ kind: 'request', id }, (ev) => {
      if (ev.sequence <= lastSeq) return; // dedupe across history/live race
      queue.push(ev);
      if (resolveNext) {
        const fn = resolveNext;
        resolveNext = null;
        fn();
      }
    });

    try {
      // Subscribe before replaying history so events inserted between the
      // history query and live-tail setup cannot disappear during reconnects.
      await stream.writeSSE({ event: 'ready', data: JSON.stringify({ sinceSeq }) });

      const history = store.agentEvents.byRequest(id, lastSeq);
      for (const ev of history) {
        if (ev.sequence <= lastSeq) continue;
        await writeEvent(ev);
        lastSeq = ev.sequence;
        if (aborted) return;
      }

      while (!aborted) {
        if (queue.length === 0) {
          await new Promise<void>((res) => {
            resolveNext = res;
            // Tight ping interval (5s) keeps the underlying TCP connection
            // alive — Bun's idleTimeout (set to 255s on the server) and
            // proxies / load balancers won't drop us mid-stream.
            setTimeout(() => {
              if (resolveNext === res) {
                resolveNext = null;
                res();
              }
            }, 5_000);
          });
          if (queue.length === 0 && !aborted) {
            await stream.writeSSE({ event: 'ping', data: JSON.stringify({ ts: Date.now() }) });
            continue;
          }
        }
        while (queue.length > 0 && !aborted) {
          const ev = queue.shift()!;
          if (ev.sequence <= lastSeq) continue;
          await writeEvent(ev);
          lastSeq = ev.sequence;
        }
      }
    } finally {
      unsubscribe();
    }
  });
});
