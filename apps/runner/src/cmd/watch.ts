import type {
  CoordinatorDecision,
  FlowDef,
  ProjectAgentBackendKind,
  RequestMessage,
  WorkflowRequest,
  WorkflowRunType,
  WorkflowStage,
} from '@ainp/shared';
import { AUTO_REWORK_MAX_ATTEMPTS, FLOW_REGISTRY, errorMessage } from '@ainp/shared';
import { api } from '../api-client';
import { sendHeartbeat } from '../heartbeat';
import { cmdOrchestrate } from '../orchestrator';
import { triageRequest, type LlmBackendKind } from '../agents/coordinator';
import { getConfig } from '../config-client';

type PendingRequest = Pick<
  WorkflowRequest,
  'id' | 'projectId' | 'title' | 'branch' | 'agentBackend' | 'flowId' | 'startStage' | 'kind'
>;
type ClaimedRequest = Pick<
  WorkflowRequest,
  'id' | 'projectId' | 'title' | 'branch' | 'agentBackend' | 'flowId' | 'startStage' | 'kind'
>;

export type TriageOutcome =
  | { action: 'proceed'; runType: WorkflowRunType; decision: CoordinatorDecision }
  | { action: 'paused'; decision: CoordinatorDecision }
  | { action: 'aborted'; decision: CoordinatorDecision };

export type WatchProcessResult =
  | 'idle'
  | 'lost'
  | 'processed'
  | 'failed'
  | 'paused'
  | 'aborted';

export interface ProcessNextWorkflowRequestDeps {
  runnerId: string;
  listPending(): Promise<PendingRequest[]>;
  triage(req: PendingRequest): Promise<TriageOutcome>;
  claim(requestId: string, runnerId: string): Promise<ClaimedRequest | null>;
  buildAgentTaskBrief?(request: ClaimedRequest): Promise<string>;
  orchestrate(
    request: ClaimedRequest,
    runType: WorkflowRunType,
    agentTaskBrief?: string,
    /**
     * 08-09 P1-2b: set on an auto-rework re-entry. Resumes the existing run at
     * the stage the engine reset, instead of creating a second run.
     */
    resume?: { workflowRunId: string; startStage: WorkflowStage },
  ): Promise<{
    workflowRunId: string;
    ok: boolean;
    paused?: boolean;
    autoReworkStage?: WorkflowStage | null;
  }>;
  complete(
    requestId: string,
    completion: { workflowRunId: string | null; ok: boolean; error: string | null },
  ): Promise<void>;
}

export interface WatchOpts {
  once?: boolean;
  pollMs?: number;
  keepWorktree?: boolean;
}

export async function processNextWorkflowRequest(
  deps: ProcessNextWorkflowRequestDeps,
): Promise<WatchProcessResult> {
  const next = (await deps.listPending()).find((request) => request.kind !== 'ask');
  if (!next) return 'idle';

  // 05-08 new-task-form-flow-startstage-override (PRD Q1=A): when the user
  // explicitly pinned a flowId in the New Task form's 高级覆盖 disclosure,
  // the request is the source of truth — skip Coordinator + Router entirely
  // and derive runType from the FlowDef's `kind`. Saves a Coordinator round
  // trip and avoids "AI vs user" mismatch noise (the user already decided).
  let runType: WorkflowRunType;
  if (next.flowId) {
    const flowDef: FlowDef = FLOW_REGISTRY[next.flowId];
    runType = flowDef.kind;
    console.log(
      `[runner] skipping Coordinator: request.flowId=${next.flowId} -> runType=${runType}`,
    );
  } else {
    const triage = await deps.triage(next);
    if (triage.action === 'paused') return 'paused';
    if (triage.action === 'aborted') return 'aborted';
    if (triage.runType === 'ask') {
      console.log(`[runner] request ${next.id} routed as ask; skipping WorkflowRun creation`);
      return 'paused';
    }
    runType = triage.runType;
  }

  const claimed = await deps.claim(next.id, deps.runnerId);
  if (!claimed) return 'lost';

  try {
    const agentTaskBrief = deps.buildAgentTaskBrief
      ? await deps.buildAgentTaskBrief(claimed)
      : undefined;
    let result = await deps.orchestrate(claimed, runType, agentTaskBrief);
    // 07-26 operational pause (R4): a paused run must NOT complete the
    // request — the engine already linked it (claimed → paused) when the
    // runner reported workflow-paused. Resume is manual via retry-run.
    if (result.paused) {
      console.log(
        `[runner] request ${claimed.id} paused (operational) with run ${result.workflowRunId}; awaiting manual resume`,
      );
      return 'paused';
    }
    // 08-09 P1-2b: the engine granted a bounded auto-rework and already reset
    // the run to the failed stage. Re-enter orchestration there rather than
    // completing the request as failed.
    //
    // The engine owns the budget — the runner keeps no counter of its own,
    // because a second counter would be a second budget that could disagree.
    // The loop bound is the *declared* cap read from the same shared constant
    // the engine decides with: a circuit breaker for an engine that keeps
    // granting, not an independent policy. It can only ever stop the loop
    // earlier than the engine would, never extend it.
    for (
      let reworks = 0;
      result.autoReworkStage && reworks < AUTO_REWORK_MAX_ATTEMPTS;
      reworks += 1
    ) {
      const stage = result.autoReworkStage;
      console.log(
        `[runner] request ${claimed.id} auto-rework at ${stage} for run ${result.workflowRunId}`,
      );
      result = await deps.orchestrate(claimed, runType, agentTaskBrief, {
        workflowRunId: result.workflowRunId,
        startStage: stage,
      });
      if (result.paused) {
        console.log(
          `[runner] request ${claimed.id} paused (operational) during auto-rework of run ${result.workflowRunId}`,
        );
        return 'paused';
      }
    }
    await deps.complete(claimed.id, {
      workflowRunId: result.workflowRunId,
      ok: result.ok,
      error: result.ok ? null : 'orchestration failed',
    });
    return result.ok ? 'processed' : 'failed';
  } catch (err) {
    await deps.complete(claimed.id, {
      workflowRunId: null,
      ok: false,
      error: errorMessage(err),
    });
    return 'failed';
  }
}

export function buildClarifiedTaskBrief(input: {
  title: string;
  messages: ReadonlyArray<Pick<RequestMessage, 'role' | 'content'>>;
}): string {
  const title = input.title;
  const lines = input.messages
    .map((message) => ({ role: message.role, content: message.content.trim() }))
    .filter((message) => message.content.length > 0)
    .map((message, index) => {
      const speaker = message.role === 'coordinator' ? 'Coordinator' : 'User';
      return `${index + 1}. ${speaker}: ${message.content}`;
    });

  if (lines.length === 0) return title;

  return [
    'Original request title:',
    title,
    '',
    'Clarification conversation:',
    ...lines,
    '',
    'Use the full conversation above as the clarified task brief for downstream requirement generation.',
  ].join('\n');
}

export async function defaultAgentTaskBrief(req: ClaimedRequest): Promise<string> {
  const { messages } = await api.listRequestMessages(req.id);
  return buildClarifiedTaskBrief({ title: req.title, messages });
}

/**
 * Default triage implementation used by the watch daemon. Pulls chat history,
 * runs the Coordinator, persists the decision, and (on pause) posts each
 * question to the chat thread + flips request status to awaiting_clarification.
 *
 * (PR3, PRD §P0-1) Reads the project's configured `agentBackend` and
 * forwards it as `preferredBackend` so the Coordinator's LLM fallback runs
 * the user's chosen CLI first. Failure to resolve the project is non-fatal
 * — triage proceeds without a preference (legacy claude-first behaviour).
 */
export async function defaultTriage(req: PendingRequest): Promise<TriageOutcome> {
  const { messages } = await api.listRequestMessages(req.id);

  // If the user hasn't posted any chat messages yet (the request was created
  // by a non-chat path), use the request title as the initial user intent.
  const userRequest = messages.length > 0
    ? (messages.filter((m) => m.role === 'user').at(-1)?.content ?? req.title)
    : req.title;

  let preferredBackend: LlmBackendKind | undefined = requestBackendPreference(req.agentBackend);
  try {
    const project = await api.getProject(req.projectId);
    if (!preferredBackend && (project.agentBackend === 'claude_code' || project.agentBackend === 'codex')) {
      preferredBackend = project.agentBackend;
    }
  } catch {
    // Project lookup is best-effort; continue triage without a preference.
  }

  const decision = await triageRequest({
    workflowRequestId: req.id,
    userRequest,
    messageHistory: messages.map((m) => ({ role: m.role, content: m.content })),
    preferredBackend,
  });

  await api.persistCoordinatorDecision(decision);
  console.log(
    `[runner] coordinator (${decision.source}) -> ${decision.decision.action}` +
      (decision.decision.action === 'proceed'
        ? ` routeCase=${decision.decision.routeCase}`
        : ` confidence=${decision.confidence}`),
  );

  if (decision.decision.action === 'proceed') {
    if (decision.decision.runType === 'ask') {
      await api.setRequestStatus({ requestId: req.id, status: 'awaiting_clarification' });
      console.log(`[runner] request ${req.id} -> awaiting_clarification (ask route skips WorkflowRun)`);
      return { action: 'paused', decision };
    }
    return { action: 'proceed', runType: decision.decision.runType, decision };
  }
  if (decision.decision.action === 'pause_for_human') {
    for (const q of decision.decision.questions) {
      await api.postRequestMessage({
        requestId: req.id,
        role: 'coordinator',
        content: q,
        coordinatorDecisionId: decision.id,
      });
    }
    await api.setRequestStatus({ requestId: req.id, status: 'awaiting_clarification' });
    console.log(`[runner] request ${req.id} -> awaiting_clarification (${decision.decision.questions.length} question(s))`);
    return { action: 'paused', decision };
  }
  // action === 'abort'
  await api.setRequestStatus({ requestId: req.id, status: 'cancelled' });
  console.log(`[runner] request ${req.id} -> cancelled (${decision.decision.reason})`);
  return { action: 'aborted', decision };
}

function requestBackendPreference(
  backend: ProjectAgentBackendKind | null | undefined,
): LlmBackendKind | undefined {
  return backend === 'claude_code' || backend === 'codex' ? backend : undefined;
}

export async function cmdWatch(opts: WatchOpts = {}): Promise<void> {
  const { runnerId } = await sendHeartbeat();
  const pollMs = opts.pollMs ?? (await getConfig('runner.watch.poll_ms'));
  console.log(`[runner] watch started as ${runnerId} (poll=${pollMs}ms)`);

  do {
    const result = await processNextWorkflowRequest({
      runnerId,
      listPending: async () => (await api.listWorkflowRequests({ status: 'pending' })).items.filter((request) => request.kind !== 'ask'),
      triage: defaultTriage,
      claim: (requestId, id) => api.claimWorkflowRequest({ requestId, runnerId: id }),
      buildAgentTaskBrief: defaultAgentTaskBrief,
      orchestrate: (request, runType, agentTaskBrief, resume) =>
        cmdOrchestrate({
          project: request.projectId,
          title: request.title,
          userRequest: agentTaskBrief,
          sourceBranch: request.branch,
          workflowRequestId: request.id,
          runType,
          agentBackend: request.agentBackend,
          flowId: request.flowId ?? undefined,
          // On an auto-rework re-entry the run already exists and the engine
          // decided where it restarts; the request's original overrides would
          // send it back to the wrong stage.
          startStage: resume?.startStage ?? request.startStage ?? undefined,
          workflowRunId: resume?.workflowRunId,
          cleanup: !opts.keepWorktree,
          setExitCode: false,
        }),
      complete: async (requestId, completion) => {
        await api.completeWorkflowRequest({ requestId, ...completion });
      },
    });

    if (result === 'idle') {
      if (opts.once) {
        console.log('[runner] watch once: no pending workflow requests');
        return;
      }
      await sleep(pollMs);
      continue;
    }

    console.log(`[runner] workflow request ${result}`);
    if (opts.once) return;
  } while (true);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
