import type { GateRun } from '@ainp/shared';
import { errorMessage, nowIso } from '@ainp/shared';
import { api } from '../api-client';

/**
 * Persist a `rejection_feedback` artifact carrying the human reviewer's
 * comment, just before a manual gate's reject-throw. Failures here MUST NOT
 * block the throw — the original gate-rejected error must still surface,
 * otherwise the reject signal is masked.
 *
 * Producer-only: a follow-up L3 task wires up the consumer (context_pack
 * stage reads the latest `rejection_feedback` to seed prompt revision).
 */
export async function postRejectionFeedback(input: {
  workflowRunId: string;
  stepRunId: string | null;
  gateId: GateRun['gateId'];
  comment: string;
}): Promise<void> {
  try {
    await api.postArtifact({
      workflowRunId: input.workflowRunId,
      stepRunId: input.stepRunId,
      kind: 'rejection_feedback',
      uri: `mem://rejection_feedback/${input.workflowRunId}/${input.gateId}`,
      size: Buffer.byteLength(input.comment, 'utf8'),
      contentType: 'text/plain',
      metadata: {
        gateId: input.gateId,
        comment: input.comment,
        rejectedAt: nowIso(),
      },
    });
  } catch (err) {
    console.warn(
      `[runner] rejection_feedback artifact persist failed for ${input.gateId} on ${input.workflowRunId}:`,
      errorMessage(err),
    );
  }
}

export async function awaitApproval(
  workflowRunId: string,
  gateId: GateRun['gateId'],
): Promise<{ approved: boolean; comment: string | null }> {
  return waitForApprovalDecision({
    workflowRunId,
    gateId,
    findApproval: api.findApproval,
    sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
    timeoutMs: approvalTimeoutMsFromEnv(),
  });
}

export async function waitForApprovalDecision(params: {
  workflowRunId: string;
  gateId: GateRun['gateId'];
  findApproval(
    workflowRunId: string,
    gateId: GateRun['gateId'],
  ): Promise<{ decision: 'approved' | 'rejected'; comment: string | null } | null>;
  sleep(ms: number): Promise<void>;
  timeoutMs?: number | null;
  pollMs?: number;
}): Promise<{ approved: boolean; comment: string | null }> {
  const startedAt = Date.now();
  const pollMs = params.pollMs ?? 500;
  while (params.timeoutMs == null || Date.now() - startedAt < params.timeoutMs) {
    const decision = await params.findApproval(params.workflowRunId, params.gateId);
    if (decision) return { approved: decision.decision === 'approved', comment: decision.comment };
    await params.sleep(pollMs);
  }
  throw new Error(`approval timeout for ${params.gateId} on ${params.workflowRunId}`);
}

function approvalTimeoutMsFromEnv(): number | null {
  const raw = process.env.AINP_APPROVAL_TIMEOUT_MS;
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export interface SensitiveChangeCheckpointDeps {
  awaitHuman(params: { workflowRunId: string; stage: 'implementation' }): Promise<unknown>;
  stepFinished(params: {
    stepRunId: string;
    status: 'passed' | 'failed' | 'cancelled' | 'skipped';
  }): Promise<unknown>;
  awaitApproval(
    workflowRunId: string,
    gateId: 'sensitive_change_gate',
  ): Promise<{ approved: boolean; comment: string | null }>;
  /**
   * Optional. Called just before the reject-throw when a non-empty comment
   * was supplied, to persist a `rejection_feedback` artifact. Failures here
   * MUST NOT prevent the throw — implementations should swallow + log.
   */
  postRejectionFeedback?: (input: {
    workflowRunId: string;
    stepRunId: string | null;
    gateId: GateRun['gateId'];
    comment: string;
  }) => Promise<void>;
}

export async function enforceSensitiveChangeCheckpoint(params: {
  workflowRunId: string;
  stepRunId: string;
  gate: Pick<GateRun, 'status'>;
  deps: SensitiveChangeCheckpointDeps;
}): Promise<void> {
  if (params.gate.status !== 'warn') return;

  await params.deps.awaitHuman({
    workflowRunId: params.workflowRunId,
    stage: 'implementation',
  });
  console.log('[runner] awaiting sensitive_change_gate approval…');
  const { approved, comment } = await params.deps.awaitApproval(
    params.workflowRunId,
    'sensitive_change_gate',
  );
  const rejectSummary = !approved && comment
    ? `: ${comment.slice(0, 200)}${comment.length > 200 ? '…' : ''}`
    : '';
  console.log(
    `[runner]   sensitive_change_gate -> ${approved ? 'approved' : 'rejected'}${rejectSummary}`,
  );
  if (!approved) {
    if (comment && params.deps.postRejectionFeedback) {
      await params.deps.postRejectionFeedback({
        workflowRunId: params.workflowRunId,
        stepRunId: params.stepRunId,
        gateId: 'sensitive_change_gate',
        comment,
      });
    }
    await params.deps.stepFinished({ stepRunId: params.stepRunId, status: 'failed' });
    throw new Error('sensitive_change_gate rejected');
  }
}
