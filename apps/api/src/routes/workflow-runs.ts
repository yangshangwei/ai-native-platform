import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AgentStreamEvent, WorkflowRunType } from '@ainp/shared';
import { store } from '../store/store';
import {
  createWorkflowRun,
  recordAcceptanceDecision,
  recordKnowledgeAction,
  recordRequirementAction,
} from '../workflow-engine';
import { generateCompletionReport, generateKnowledgeCandidate } from '../reports';
import { subscribe } from '../agent-stream-bus';

export const workflowRuns = new Hono();

workflowRuns.get('/', (c) => {
  const projectId = c.req.query('projectId');
  const items = projectId
    ? store.workflowRunsByProject(projectId)
    : [...store.workflowRuns.values()];
  return c.json({ items });
});

workflowRuns.post('/', async (c) => {
  const body = (await c.req.json()) as {
    projectId?: string;
    projectName?: string;
    type?: WorkflowRunType;
    title?: string;
  };

  let projectId = body.projectId;
  if (!projectId && body.projectName) {
    projectId = store.projectByName(body.projectName)?.id;
  }
  if (!projectId) return c.json({ error: 'projectId or projectName required' }, 400);
  if (!store.projects.has(projectId)) {
    return c.json({ error: `project ${projectId} not registered` }, 404);
  }
  if (!body.title) return c.json({ error: 'title required' }, 400);

  const run = createWorkflowRun({
    projectId,
    type: body.type ?? 'smoke',
    title: body.title,
  });
  return c.json(run, 201);
});

workflowRuns.get('/:id', (c) => {
  const id = c.req.param('id');
  const run = store.workflowRuns.get(id);
  if (!run) return c.json({ error: 'not found' }, 404);
  const steps = store.stepRuns.byWorkflow(id);
  const commands = store.commandRunsByWorkflow(id);
  const gates = store.gateRuns.byWorkflow(id);
  const artifacts = store.artifacts.byWorkflow(id);
  const builds = store.buildRuns.byWorkflow(id);
  const tests = builds.flatMap((b) => store.testRuns.byBuild(b.id));
  const approvals = store.approvals.byWorkflow(id);
  const actions = store.workflowActions.byWorkflow(id);
  const agentTasks = store.agentTasks.byWorkflow(id);
  const agentResults = store.agentResults.byWorkflow(id);
  const audit = store.auditLog.byWorkflow(id);
  return c.json({
    run,
    steps,
    commands,
    gates,
    artifacts,
    builds,
    tests,
    approvals,
    actions,
    agentTasks,
    agentResults,
    audit,
  });
});

workflowRuns.post('/:id/requirement-actions', async (c) => {
  const id = c.req.param('id');
  if (!store.workflowRuns.has(id)) return c.json({ error: 'not found' }, 404);
  const body = (await c.req.json()) as {
    targetId?: string;
    action?: string;
    actor?: string;
    payload?: Record<string, unknown>;
  };
  if (!body.targetId || !body.action) {
    return c.json({ error: 'targetId and action required' }, 400);
  }
  const action = recordRequirementAction({
    workflowRunId: id,
    targetId: body.targetId,
    action: body.action,
    actor: body.actor ?? 'web',
    payload: body.payload ?? {},
  });
  return c.json({ ok: true, action }, 201);
});

workflowRuns.post('/:id/acceptance-decision', async (c) => {
  const id = c.req.param('id');
  if (!store.workflowRuns.has(id)) return c.json({ error: 'not found' }, 404);
  const body = (await c.req.json()) as {
    decision?: string;
    actor?: string;
    comment?: string | null;
    payload?: Record<string, unknown>;
  };
  if (!body.decision) return c.json({ error: 'decision required' }, 400);
  const result = recordAcceptanceDecision({
    workflowRunId: id,
    decision: body.decision,
    actor: body.actor ?? 'web',
    comment: body.comment ?? null,
    payload: body.payload ?? {},
  });
  return c.json({ ok: true, ...result }, 201);
});

workflowRuns.post('/:id/knowledge-actions', async (c) => {
  const id = c.req.param('id');
  if (!store.workflowRuns.has(id)) return c.json({ error: 'not found' }, 404);
  const body = (await c.req.json()) as {
    targetId?: string;
    action?: 'accepted' | 'edited' | 'ignored' | string;
    actor?: string;
    payload?: Record<string, unknown>;
  };
  if (!body.targetId || !body.action) {
    return c.json({ error: 'targetId and action required' }, 400);
  }
  const action = recordKnowledgeAction({
    workflowRunId: id,
    targetId: body.targetId,
    action: body.action,
    actor: body.actor ?? 'web',
    payload: body.payload ?? {},
  });
  return c.json({ ok: true, action }, 201);
});

workflowRuns.post('/:id/completion-report', async (c) => {
  const id = c.req.param('id');
  if (!store.workflowRuns.has(id)) return c.json({ error: 'not found' }, 404);
  const report = await generateCompletionReport(id);
  return c.json({ ok: true, ...report }, 201);
});

workflowRuns.post('/:id/knowledge-candidate', async (c) => {
  const id = c.req.param('id');
  if (!store.workflowRuns.has(id)) return c.json({ error: 'not found' }, 404);
  const candidate = await generateKnowledgeCandidate(id);
  return c.json({ ok: true, ...candidate }, 201);
});

/** History dump (no streaming). Use `?sinceSeq=N` to paginate. */
workflowRuns.get('/:id/agent-events', (c) => {
  const id = c.req.param('id');
  if (!store.workflowRuns.has(id)) return c.json({ error: 'not found' }, 404);
  const sinceSeq = Number(c.req.query('sinceSeq') ?? -1);
  const items = store.agentEvents.byWorkflow(id, Number.isFinite(sinceSeq) ? sinceSeq : -1);
  return c.json({ items });
});

/**
 * Live SSE tail of agent events. Replays history > sinceSeq, then attaches
 * a subscriber for newly-published events. Closes when client disconnects.
 *
 * Wire format: `event: <type>\nid: <sequence>\ndata: <AgentStreamEvent json>\n\n`.
 */
workflowRuns.get('/:id/agent-stream', (c) => {
  const id = c.req.param('id');
  if (!store.workflowRuns.has(id)) return c.json({ error: 'not found' }, 404);
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

    // Send a `ready` ping so the client knows the connection is live before
    // any history events arrive.
    await stream.writeSSE({ event: 'ready', data: JSON.stringify({ sinceSeq }) });

    let lastSeq = Number.isFinite(sinceSeq) ? sinceSeq : -1;
    const history = store.agentEvents.byWorkflow(id, lastSeq);
    for (const ev of history) {
      await writeEvent(ev);
      lastSeq = ev.sequence;
      if (aborted) return;
    }

    const queue: AgentStreamEvent[] = [];
    let resolveNext: (() => void) | null = null;
    const unsubscribe = subscribe(id, (ev) => {
      if (ev.sequence <= lastSeq) return; // dedupe across history/live race
      queue.push(ev);
      if (resolveNext) {
        const fn = resolveNext;
        resolveNext = null;
        fn();
      }
    });

    try {
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
          await writeEvent(ev);
          lastSeq = ev.sequence;
        }
      }
    } finally {
      unsubscribe();
    }
  });
});
