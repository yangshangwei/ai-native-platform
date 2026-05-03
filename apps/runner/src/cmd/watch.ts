import type { CoordinatorDecision, WorkflowRequest, WorkflowRunType } from '@ainp/shared';
import { api } from '../api-client';
import { sendHeartbeat } from '../heartbeat';
import { cmdOrchestrate } from '../orchestrator';
import { triageRequest } from '../agents/coordinator';
import { getConfig } from '../config-client';

type PendingRequest = Pick<WorkflowRequest, 'id' | 'projectId' | 'title' | 'branch'>;
type ClaimedRequest = Pick<WorkflowRequest, 'id' | 'projectId' | 'title' | 'branch'>;

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
  orchestrate(
    request: ClaimedRequest,
    runType: WorkflowRunType,
  ): Promise<{ workflowRunId: string; ok: boolean }>;
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
  const [next] = await deps.listPending();
  if (!next) return 'idle';

  const triage = await deps.triage(next);
  if (triage.action === 'paused') return 'paused';
  if (triage.action === 'aborted') return 'aborted';

  const claimed = await deps.claim(next.id, deps.runnerId);
  if (!claimed) return 'lost';

  try {
    const result = await deps.orchestrate(claimed, triage.runType);
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
      error: err instanceof Error ? err.message : String(err),
    });
    return 'failed';
  }
}

/**
 * Default triage implementation used by the watch daemon. Pulls chat history,
 * runs the Coordinator, persists the decision, and (on pause) posts each
 * question to the chat thread + flips request status to awaiting_clarification.
 */
export async function defaultTriage(req: PendingRequest): Promise<TriageOutcome> {
  const { messages } = await api.listRequestMessages(req.id);

  // If the user hasn't posted any chat messages yet (the request was created
  // by a non-chat path), use the request title as the initial user intent.
  const userRequest = messages.length > 0
    ? (messages.filter((m) => m.role === 'user').at(-1)?.content ?? req.title)
    : req.title;

  const decision = await triageRequest({
    workflowRequestId: req.id,
    userRequest,
    messageHistory: messages.map((m) => ({ role: m.role, content: m.content })),
  });

  await api.persistCoordinatorDecision(decision);
  console.log(
    `[runner] coordinator (${decision.source}) -> ${decision.decision.action}` +
      (decision.decision.action === 'proceed'
        ? ` routeCase=${decision.decision.routeCase}`
        : ` confidence=${decision.confidence}`),
  );

  if (decision.decision.action === 'proceed') {
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

export async function cmdWatch(opts: WatchOpts = {}): Promise<void> {
  const { runnerId } = await sendHeartbeat();
  const pollMs = opts.pollMs ?? (await getConfig('runner.watch.poll_ms'));
  console.log(`[runner] watch started as ${runnerId} (poll=${pollMs}ms)`);

  do {
    const result = await processNextWorkflowRequest({
      runnerId,
      listPending: async () => (await api.listWorkflowRequests({ status: 'pending' })).items,
      triage: defaultTriage,
      claim: (requestId, id) => api.claimWorkflowRequest({ requestId, runnerId: id }),
      orchestrate: (request, runType) =>
        cmdOrchestrate({
          project: request.projectId,
          title: request.title,
          sourceBranch: request.branch,
          workflowRequestId: request.id,
          runType,
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
