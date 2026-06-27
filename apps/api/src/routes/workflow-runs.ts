import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AgentStreamEvent, FlowId, GateRun, Project, WorkflowRunType, WorkflowStage } from '@ainp/shared';
import { KNOWN_FLOW_IDS, WORKFLOW_STAGES, errorMessage, isFlowId, isWorkflowStage } from '@ainp/shared';
import { store } from '../store/store';
import {
  createWorkflowRun,
  recordAcceptanceDecision,
  recordKnowledgeAction,
  recordRequirementAction,
  recordWorkflowAction,
  retryStage,
  reEvaluateGate,
} from '../workflow-engine';
import { resumeGraphNode, resumeGraphStage } from '../graph-runtime';
import {
  generateCompletionReport,
  generateKnowledgeCandidate,
  generateRetroEvalScenarioDraft,
  generateRetroReport,
} from '../reports';
import { runEvidenceGate } from '../gate-engine';
import { buildContextGovernanceReadModel } from '../context-governance';
import { subscribe } from '../agent-stream-bus';
import { jsonError, requireWorkflowRun } from './helpers';

export const workflowRuns = new Hono();

workflowRuns.get('/', (c) => {
  const projectId = c.req.query('projectId');
  const items = projectId
    ? store.workflowRunsByProject(projectId)
    : [...store.workflowRuns.values()];
  return c.json({ items });
});

workflowRuns.get('/:id/context', (c) => {
  const id = c.req.param('id');
  try {
    return c.json(buildContextGovernanceReadModel(id));
  } catch (err) {
    const message = errorMessage(err);
    const status = message.includes('not found') ? 404 : 400;
    return jsonError(c, message, status);
  }
});

workflowRuns.get('/:id/agent-sessions', (c) => {
  const id = c.req.param('id');
  const missing = requireWorkflowRun(c, id);
  if (missing) return missing;
  return c.json({ items: store.agentSessions.byWorkflow(id) });
});

workflowRuns.get('/:id/handoffs', (c) => {
  const id = c.req.param('id');
  const missing = requireWorkflowRun(c, id);
  if (missing) return missing;
  return c.json({ items: store.handoffs.byWorkflow(id) });
});

workflowRuns.get('/:id/step-checkpoints', (c) => {
  const id = c.req.param('id');
  const missing = requireWorkflowRun(c, id);
  if (missing) return missing;
  return c.json({ items: store.stepCheckpoints.byWorkflow(id) });
});

workflowRuns.get('/:id/graph', (c) => {
  const id = c.req.param('id');
  const missing = requireWorkflowRun(c, id);
  if (missing) return missing;
  return c.json(store.graphRuntime.byWorkflow(id));
});

workflowRuns.post('/', async (c) => {
  const body = (await c.req.json()) as {
    projectId?: string;
    projectName?: string;
    type?: WorkflowRunType;
    title?: string;
    sourceBranch?: string;
    flowId?: string;
    startStage?: string;
  };

  let projectId = body.projectId;
  if (!projectId && body.projectName) {
    projectId = store.projectByName(body.projectName)?.id;
  }
  if (!projectId) return jsonError(c, 'projectId or projectName required', 400);
  const project = store.projects.get(projectId);
  if (!project) {
    return jsonError(c, `project ${projectId} not registered`, 404);
  }
  if ((project.status ?? 'active') === 'archived') return jsonError(c, 'project is archived', 400);
  const runType = body.type ?? 'smoke';
  const backendError = runType === 'smoke' ? null : projectAgentBackendError(project);
  if (backendError) return c.json({ error: backendError, needsAgentBackendSetup: true }, 400);
  if (!body.title) return jsonError(c, 'title required', 400);

  // V2 W2-3: optional flowId in body. If supplied, must be a registered
  // FlowId; otherwise createWorkflowRun() applies the conservative default for
  // the run type at the API layer (PRD W2-1 ADR Q3, W2-3 ADR Q3).
  let flowId: FlowId | undefined;
  if (body.flowId !== undefined) {
    if (!isFlowId(body.flowId)) {
      return c.json(
        { error: `unknown flowId: ${body.flowId} (known: ${KNOWN_FLOW_IDS.join(', ')})` },
        400,
      );
    }
    flowId = body.flowId;
  }

  // V2 W2-4 / PR4: optional startStage in body. Set by the UI override
  // path (智能推荐 card → "override") or by automation that already knows
  // which stage to skip from. Validated against `WorkflowStage`; the
  // orchestrator then re-validates that the stage is actually present
  // in the chosen flow (R-Risk-1).
  let startStage: WorkflowStage | null | undefined;
  if (body.startStage !== undefined) {
    if (body.startStage === null) {
      startStage = null;
    } else if (!isWorkflowStage(body.startStage)) {
      return c.json(
        { error: `unknown startStage: ${body.startStage} (known: ${WORKFLOW_STAGES.join(', ')})` },
        400,
      );
    } else {
      startStage = body.startStage;
    }
  }

  const run = createWorkflowRun({
    projectId,
    type: runType,
    title: body.title,
    sourceBranch: body.sourceBranch?.trim() || project.defaultBranch,
    flowId,
    startStage,
  });
  return c.json(run, 201);
});

function projectAgentBackendError(project: Project): string | null {
  if (!project.agentBackend) {
    return 'Agent Backend is not configured for this project. Choose Claude Code or Codex before creating a workflow run.';
  }
  return null;
}

workflowRuns.get('/:id', (c) => {
  const id = c.req.param('id');
  const run = store.workflowRuns.get(id);
  if (!run) return jsonError(c, 'not found', 404);
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
  const agentSessions = store.agentSessions.byWorkflow(id);
  const toolInvocations = store.toolInvocations.byWorkflow(id);
  const handoffs = store.handoffs.byWorkflow(id);
  const stepCheckpoints = store.stepCheckpoints.byWorkflow(id);
  const graph = store.graphRuntime.byWorkflow(id);
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
    agentSessions,
    toolInvocations,
    handoffs,
    stepCheckpoints,
    graph,
    audit,
  });
});

workflowRuns.post('/:id/requirement-actions', async (c) => {
  const id = c.req.param('id');
  const missing = requireWorkflowRun(c, id);
  if (missing) return missing;
  const body = (await c.req.json()) as {
    targetId?: string;
    action?: string;
    actor?: string;
    payload?: Record<string, unknown>;
  };
  if (!body.targetId || !body.action) {
    return jsonError(c, 'targetId and action required', 400);
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
  const missing = requireWorkflowRun(c, id);
  if (missing) return missing;
  const body = (await c.req.json()) as {
    decision?: string;
    actor?: string;
    comment?: string | null;
    payload?: Record<string, unknown>;
  };
  if (!body.decision) return jsonError(c, 'decision required', 400);
  if (body.decision === 'reject') {
    const trimmed = typeof body.comment === 'string' ? body.comment.trim() : '';
    if (trimmed.length === 0) {
      return jsonError(c, 'comment required and must be non-empty when decision is reject', 400);
    }
  }
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
  const missing = requireWorkflowRun(c, id);
  if (missing) return missing;
  const body = (await c.req.json()) as {
    targetId?: string;
    action?: 'accepted' | 'edited' | 'ignored' | string;
    actor?: string;
    payload?: Record<string, unknown>;
  };
  if (!body.targetId || !body.action) {
    return jsonError(c, 'targetId and action required', 400);
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

workflowRuns.post('/:id/graph/resume-node', async (c) => {
  const id = c.req.param('id');
  const missing = requireWorkflowRun(c, id);
  if (missing) return missing;
  const body = (await c.req.json()) as {
    nodeRunId?: string;
    graphVersion?: string;
    resumeCursor?: string | null;
    actor?: string;
  };
  if (!body.nodeRunId) return jsonError(c, 'nodeRunId required', 400);
  try {
    const result = resumeGraphNode({
      workflowRunId: id,
      nodeRunId: body.nodeRunId,
      graphVersion: body.graphVersion,
      resumeCursor: body.resumeCursor,
      actor: body.actor ?? 'web',
    });
    return c.json({ ok: true, ...result }, 201);
  } catch (err) {
    return jsonError(c, errorMessage(err), 400);
  }
});

workflowRuns.post('/:id/completion-report', async (c) => {
  const id = c.req.param('id');
  const missing = requireWorkflowRun(c, id);
  if (missing) return missing;
  const evidenceGate = runEvidenceGate({ workflowRunId: id, stepRunId: null });
  if (evidenceGate.status === 'fail') {
    return c.json({ error: 'evidence_gate failed', gate: evidenceGate }, 409);
  }
  const report = await generateCompletionReport(id);
  return c.json({ ok: true, evidenceGate, ...report }, 201);
});

workflowRuns.post('/:id/retry-step', async (c) => {
  const id = c.req.param('id');
  const missing = requireWorkflowRun(c, id);
  if (missing) return missing;
  const body = (await c.req.json()) as { stage?: string; actor?: string };
  if (!body.stage) return jsonError(c, 'stage required', 400);
  if (!isWorkflowStage(body.stage)) {
    return jsonError(c, `unknown stage: ${body.stage}`, 400);
  }
  try {
    const graphResume = resumeGraphStage({
      workflowRunId: id,
      stage: body.stage,
      actor: body.actor ?? 'web',
    });
    const result = retryStage({
      workflowRunId: id,
      stage: body.stage,
      actor: body.actor ?? 'web',
    });
    return c.json({ ok: true, run: result.run, step: result.step, graphResume }, 200);
  } catch (err) {
    return jsonError(c, (err as Error).message, 400);
  }
});

workflowRuns.post('/:id/re-evaluate-gate', async (c) => {
  const id = c.req.param('id');
  const missing = requireWorkflowRun(c, id);
  if (missing) return missing;
  const body = (await c.req.json()) as { gateId?: string; actor?: string };
  if (!body.gateId) return jsonError(c, 'gateId required', 400);
  try {
    const gate = reEvaluateGate({
      workflowRunId: id,
      gateId: body.gateId as GateRun['gateId'],
      actor: body.actor ?? 'web',
    });
    return c.json({ ok: true, gate }, 200);
  } catch (err) {
    return jsonError(c, (err as Error).message, 400);
  }
});

workflowRuns.post('/:id/knowledge-candidate', async (c) => {
  const id = c.req.param('id');
  const missing = requireWorkflowRun(c, id);
  if (missing) return missing;
  const candidate = await generateKnowledgeCandidate(id);
  return c.json({ ok: true, ...candidate }, 201);
});

workflowRuns.post('/:id/retro', async (c) => {
  const id = c.req.param('id');
  const missing = requireWorkflowRun(c, id);
  if (missing) return missing;
  const retro = await generateRetroReport(id);
  return c.json({ ok: true, ...retro }, 201);
});

workflowRuns.post('/:id/retro-actions', async (c) => {
  const id = c.req.param('id');
  const missing = requireWorkflowRun(c, id);
  if (missing) return missing;
  const body = (await c.req.json()) as {
    candidateId?: string;
    targetId?: string;
    action?: string;
    actor?: string;
    payload?: Record<string, unknown>;
  };
  const targetId = body.targetId?.trim() || body.candidateId?.trim();
  const actionName = body.action?.trim();
  if (!targetId || !actionName) {
    return jsonError(c, 'candidateId/targetId and action required', 400);
  }
  const payload = isRecord(body.payload) ? body.payload : {};
  const actor = body.actor?.trim() || 'web';

  if (
    actionName === 'create_eval_scenario'
    || actionName === 'create_eval_case'
    || actionName === 'create_eval_candidate'
  ) {
    const artifact = await generateRetroEvalScenarioDraft(id, {
      targetId,
      actor,
      payload,
    });
    const action = recordWorkflowAction({
      workflowRunId: id,
      kind: 'retro_candidate_action',
      targetId,
      action: 'create_eval_scenario',
      actor,
      payload: {
        ...payload,
        retroAction: actionName,
        draftArtifactId: artifact.id,
      },
    });
    return c.json({ ok: true, action, artifact }, 201);
  }

  const knowledgeAction = retroKnowledgeAction(actionName, payload);
  if (!knowledgeAction) {
    return jsonError(c, `unsupported retro action: ${actionName}`, 400);
  }
  const action = recordKnowledgeAction({
    workflowRunId: id,
    targetId,
    action: knowledgeAction,
    actor,
    payload: {
      ...payload,
      retroAction: actionName,
      retroCandidateId: targetId,
    },
  });
  return c.json({ ok: true, action }, 201);
});

function retroKnowledgeAction(actionName: string, payload: Record<string, unknown>): string | null {
  const explicit = typeof payload.knowledgeAction === 'string' ? payload.knowledgeAction.trim() : '';
  if (isKnowledgeReviewAction(explicit)) return explicit;
  if (isKnowledgeReviewAction(actionName)) return actionName;
  if (
    actionName === 'record_knowledge_review'
    || actionName === 'create_knowledge_review'
    || actionName === 'review_before_knowledge_promotion'
    || actionName === 'inspect_command_log'
    || actionName === 'require_digest_backed_command_evidence'
  ) {
    return 'needs_review';
  }
  return null;
}

function isKnowledgeReviewAction(actionName: string): boolean {
  return actionName === 'upgrade'
    || actionName === 'downgrade'
    || actionName === 'supersede'
    || actionName === 'mark_stale'
    || actionName === 'needs_review'
    || actionName === 'upgrade_candidate'
    || actionName === 'downgrade_candidate';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** History dump (no streaming). Use `?sinceSeq=N` to paginate. */
workflowRuns.get('/:id/agent-events', (c) => {
  const id = c.req.param('id');
  const missing = requireWorkflowRun(c, id);
  if (missing) return missing;
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
  const missing = requireWorkflowRun(c, id);
  if (missing) return missing;
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
    const unsubscribe = subscribe({ kind: 'run', id }, (ev) => {
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

      const history = store.agentEvents.byWorkflow(id, lastSeq);
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
