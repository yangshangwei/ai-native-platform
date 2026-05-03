import { describe, expect, it } from 'vitest';
import type { CoordinatorDecision } from '@ainp/shared';

function fakeDecision(overrides: Partial<CoordinatorDecision> = {}): CoordinatorDecision {
  return {
    id: 'coord_test',
    workflowRequestId: 'wreq_1',
    workflowRunId: null,
    source: 'rules',
    decision: { action: 'proceed', routeCase: 'feature_clear', runType: 'feature', reason: 't' },
    confidence: 0.9,
    rulesFired: ['rule.feature_keywords_dominant'],
    decidedAt: '2026-05-03T00:00:00.000Z',
    ...overrides,
  };
}

describe('runner watch workflow request processing', () => {
  it('claims the oldest pending request, orchestrates it, and completes it', async () => {
    const { processNextWorkflowRequest } = await import('../src/cmd/watch');
    const calls: string[] = [];

    const result = await processNextWorkflowRequest({
      runnerId: 'runner@test',
      listPending: async () => [
        { id: 'wreq_1', projectId: 'proj_1', title: 'build UI workbench', branch: 'develop' },
      ],
      triage: async (req) => {
        calls.push(`triage:${req.id}`);
        return { action: 'proceed', runType: 'feature', decision: fakeDecision() };
      },
      claim: async (requestId, runnerId) => {
        calls.push(`claim:${requestId}:${runnerId}`);
        return { id: requestId, projectId: 'proj_1', title: 'build UI workbench', branch: 'develop' };
      },
      orchestrate: async (request, runType) => {
        calls.push(`orchestrate:${request.projectId}:${request.title}:${request.branch}:${runType}`);
        return { workflowRunId: 'run_1', ok: true };
      },
      complete: async (requestId, completion) => {
        calls.push(`complete:${requestId}:${completion.workflowRunId}:${completion.ok}`);
      },
    });

    expect(result).toBe('processed');
    expect(calls).toEqual([
      'triage:wreq_1',
      'claim:wreq_1:runner@test',
      'orchestrate:proj_1:build UI workbench:develop:feature',
      'complete:wreq_1:run_1:true',
    ]);
  });

  it('marks the request failed when orchestration throws after claim', async () => {
    const { processNextWorkflowRequest } = await import('../src/cmd/watch');
    const completions: Array<{ requestId: string; ok: boolean; error: string | null }> = [];

    await expect(
      processNextWorkflowRequest({
        runnerId: 'runner@test',
        listPending: async () => [{ id: 'wreq_fail', projectId: 'proj_1', title: 'bad task', branch: 'main' }],
        triage: async () => ({ action: 'proceed', runType: 'feature', decision: fakeDecision() }),
        claim: async (requestId) => ({ id: requestId, projectId: 'proj_1', title: 'bad task', branch: 'main' }),
        orchestrate: async () => {
          throw new Error('boom');
        },
        complete: async (requestId, completion) => {
          completions.push({ requestId, ok: completion.ok, error: completion.error });
        },
      }),
    ).resolves.toBe('failed');

    expect(completions).toEqual([{ requestId: 'wreq_fail', ok: false, error: 'boom' }]);
  });

  it('skips claim+orchestrate and returns paused when triage pauses for human', async () => {
    const { processNextWorkflowRequest } = await import('../src/cmd/watch');
    const calls: string[] = [];

    const result = await processNextWorkflowRequest({
      runnerId: 'runner@test',
      listPending: async () => [{ id: 'wreq_p', projectId: 'proj_1', title: '权限', branch: 'main' }],
      triage: async () => ({
        action: 'paused',
        decision: fakeDecision({
          decision: { action: 'pause_for_human', questions: ['scope?'], reason: 'too vague' },
        }),
      }),
      claim: async () => {
        calls.push('claim');
        return null;
      },
      orchestrate: async () => {
        calls.push('orchestrate');
        return { workflowRunId: '', ok: false };
      },
      complete: async () => {
        calls.push('complete');
      },
    });

    expect(result).toBe('paused');
    expect(calls).toEqual([]);
  });

  it('returns aborted and skips downstream when triage aborts', async () => {
    const { processNextWorkflowRequest } = await import('../src/cmd/watch');
    const calls: string[] = [];

    const result = await processNextWorkflowRequest({
      runnerId: 'runner@test',
      listPending: async () => [{ id: 'wreq_a', projectId: 'proj_1', title: 'cancel', branch: 'main' }],
      triage: async () => ({
        action: 'aborted',
        decision: fakeDecision({
          decision: { action: 'abort', reason: 'off-topic' },
        }),
      }),
      claim: async () => {
        calls.push('claim');
        return null;
      },
      orchestrate: async () => {
        calls.push('orchestrate');
        return { workflowRunId: '', ok: false };
      },
      complete: async () => {
        calls.push('complete');
      },
    });

    expect(result).toBe('aborted');
    expect(calls).toEqual([]);
  });
});
