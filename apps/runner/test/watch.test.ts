import { describe, expect, it } from 'vitest';

describe('runner watch workflow request processing', () => {
  it('claims the oldest pending request, orchestrates it, and completes it', async () => {
    const { processNextWorkflowRequest } = await import('../src/cmd/watch');
    const calls: string[] = [];

    const result = await processNextWorkflowRequest({
      runnerId: 'runner@test',
      listPending: async () => [
        { id: 'wreq_1', projectId: 'proj_1', title: 'build UI workbench' },
      ],
      claim: async (requestId, runnerId) => {
        calls.push(`claim:${requestId}:${runnerId}`);
        return { id: requestId, projectId: 'proj_1', title: 'build UI workbench' };
      },
      orchestrate: async (request) => {
        calls.push(`orchestrate:${request.projectId}:${request.title}`);
        return { workflowRunId: 'run_1', ok: true };
      },
      complete: async (requestId, completion) => {
        calls.push(`complete:${requestId}:${completion.workflowRunId}:${completion.ok}`);
      },
    });

    expect(result).toBe('processed');
    expect(calls).toEqual([
      'claim:wreq_1:runner@test',
      'orchestrate:proj_1:build UI workbench',
      'complete:wreq_1:run_1:true',
    ]);
  });

  it('marks the request failed when orchestration throws after claim', async () => {
    const { processNextWorkflowRequest } = await import('../src/cmd/watch');
    const completions: Array<{ requestId: string; ok: boolean; error: string | null }> = [];

    await expect(
      processNextWorkflowRequest({
        runnerId: 'runner@test',
        listPending: async () => [{ id: 'wreq_fail', projectId: 'proj_1', title: 'bad task' }],
        claim: async (requestId) => ({ id: requestId, projectId: 'proj_1', title: 'bad task' }),
        orchestrate: async () => {
          throw new Error('boom');
        },
        complete: async (requestId, completion) => {
          completions.push({ requestId, ok: completion.ok, error: completion.error });
        },
      }),
    ).resolves.toBe('failed');

    expect(completions).toEqual([
      { requestId: 'wreq_fail', ok: false, error: 'boom' },
    ]);
  });
});
