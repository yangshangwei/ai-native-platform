import type { WorkflowRequest } from '@ainp/shared';
import { api } from '../api-client';
import { sendHeartbeat } from '../heartbeat';
import { cmdOrchestrate } from '../orchestrator';

type PendingRequest = Pick<WorkflowRequest, 'id' | 'projectId' | 'title' | 'branch'>;
type ClaimedRequest = Pick<WorkflowRequest, 'id' | 'projectId' | 'title' | 'branch'>;

export type WatchProcessResult = 'idle' | 'lost' | 'processed' | 'failed';

export interface ProcessNextWorkflowRequestDeps {
  runnerId: string;
  listPending(): Promise<PendingRequest[]>;
  claim(requestId: string, runnerId: string): Promise<ClaimedRequest | null>;
  orchestrate(request: ClaimedRequest): Promise<{ workflowRunId: string; ok: boolean }>;
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

  const claimed = await deps.claim(next.id, deps.runnerId);
  if (!claimed) return 'lost';

  try {
    const result = await deps.orchestrate(claimed);
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

export async function cmdWatch(opts: WatchOpts = {}): Promise<void> {
  const { runnerId } = await sendHeartbeat();
  const pollMs = opts.pollMs ?? 2_000;
  console.log(`[runner] watch started as ${runnerId} (poll=${pollMs}ms)`);

  do {
    const result = await processNextWorkflowRequest({
      runnerId,
      listPending: async () => (await api.listWorkflowRequests({ status: 'pending' })).items,
      claim: (requestId, id) => api.claimWorkflowRequest({ requestId, runnerId: id }),
      orchestrate: (request) =>
        cmdOrchestrate({
          project: request.projectId,
          title: request.title,
          sourceBranch: request.branch,
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
