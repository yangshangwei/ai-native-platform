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
  it('builds an agent-facing brief from the persisted clarification conversation', async () => {
    const { buildClarifiedTaskBrief } = await import('../src/cmd/watch');

    const brief = buildClarifiedTaskBrief({
      title: 'Build import workflow',
      messages: [
        { role: 'user', content: 'I need importing from CSV.' },
        { role: 'coordinator', content: 'Which columns and validation rules matter?' },
        { role: 'user', content: 'Name and email are required; duplicates should be skipped.' },
      ],
    });

    expect(brief).toContain('Original request title:');
    expect(brief).toContain('Build import workflow');
    expect(brief).toContain('Coordinator: Which columns and validation rules matter?');
    expect(brief).toContain('User: Name and email are required; duplicates should be skipped.');
  });

  it('keeps title-only behavior when no clarification messages exist', async () => {
    const { buildClarifiedTaskBrief } = await import('../src/cmd/watch');

    expect(buildClarifiedTaskBrief({ title: '  Build import workflow  ', messages: [] })).toBe(
      '  Build import workflow  ',
    );
  });

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

  it('passes a clarified brief to orchestration while preserving the request title', async () => {
    const { buildClarifiedTaskBrief, processNextWorkflowRequest } = await import('../src/cmd/watch');
    const calls: string[] = [];
    const captured: { title?: string; agentTaskBrief?: string } = {};

    const result = await processNextWorkflowRequest({
      runnerId: 'runner@test',
      listPending: async () => [
        { id: 'wreq_chat', projectId: 'proj_1', title: 'Build import workflow', branch: 'main' },
      ],
      triage: async () => ({ action: 'proceed', runType: 'feature', decision: fakeDecision() }),
      claim: async (requestId) => ({
        id: requestId,
        projectId: 'proj_1',
        title: 'Build import workflow',
        branch: 'main',
      }),
      buildAgentTaskBrief: async (request) => {
        calls.push(`brief:${request.id}:${request.title}`);
        return buildClarifiedTaskBrief({
          title: request.title,
          messages: [
            { role: 'user', content: 'I need importing from CSV.' },
            { role: 'coordinator', content: 'Which columns and validation rules matter?' },
            { role: 'user', content: 'Name and email are required; duplicates should be skipped.' },
          ],
        });
      },
      orchestrate: async (request, runType, agentTaskBrief) => {
        calls.push(`orchestrate:${request.title}:${runType}`);
        captured.title = request.title;
        captured.agentTaskBrief = agentTaskBrief;
        return { workflowRunId: 'run_chat', ok: true };
      },
      complete: async () => {},
    });

    expect(result).toBe('processed');
    expect(calls).toEqual([
      'brief:wreq_chat:Build import workflow',
      'orchestrate:Build import workflow:feature',
    ]);
    expect(captured.title).toBe('Build import workflow');
    expect(captured.agentTaskBrief).toContain('Coordinator: Which columns and validation rules matter?');
    expect(captured.agentTaskBrief).toContain(
      'User: Name and email are required; duplicates should be skipped.',
    );
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

  // 05-08 new-task-form-flow-startstage-override (PRD Q1=A): explicit user
  // flowId in the request makes the runner skip the Coordinator round-trip
  // and derive runType from FLOW_REGISTRY[flowId].kind.
  it('skips triage and derives runType from FlowDef.kind when request.flowId is set', async () => {
    const { processNextWorkflowRequest } = await import('../src/cmd/watch');
    const calls: string[] = [];

    const result = await processNextWorkflowRequest({
      runnerId: 'runner@test',
      listPending: async () => [
        {
          id: 'wreq_pinned',
          projectId: 'proj_1',
          title: 'refactor entity layer',
          branch: 'main',
          flowId: 'refactor.standard',
          startStage: null,
        },
      ],
      triage: async () => {
        calls.push('triage:should-not-run');
        return { action: 'proceed', runType: 'feature', decision: fakeDecision() };
      },
      claim: async (requestId, runnerId) => {
        calls.push(`claim:${requestId}:${runnerId}`);
        return {
          id: requestId,
          projectId: 'proj_1',
          title: 'refactor entity layer',
          branch: 'main',
          flowId: 'refactor.standard',
          startStage: null,
        };
      },
      orchestrate: async (request, runType) => {
        calls.push(
          `orchestrate:${request.projectId}:${request.flowId}:${request.startStage}:${runType}`,
        );
        return { workflowRunId: 'run_pinned', ok: true };
      },
      complete: async (requestId, completion) => {
        calls.push(`complete:${requestId}:${completion.ok}`);
      },
    });

    expect(result).toBe('processed');
    // Triage MUST NOT have run.
    expect(calls).not.toContain('triage:should-not-run');
    // runType must come from FLOW_REGISTRY['refactor.standard'].kind = 'refactor'.
    expect(calls).toContain('orchestrate:proj_1:refactor.standard:null:refactor');
    expect(calls).toContain('complete:wreq_pinned:true');
  });

  it('forwards both flowId and startStage from a pinned feature.standard request', async () => {
    const { processNextWorkflowRequest } = await import('../src/cmd/watch');
    const calls: string[] = [];

    await processNextWorkflowRequest({
      runnerId: 'runner@test',
      listPending: async () => [
        {
          id: 'wreq_resume',
          projectId: 'proj_1',
          title: 'resume from review',
          branch: 'develop',
          flowId: 'feature.standard',
          startStage: 'review',
        },
      ],
      triage: async () => {
        throw new Error('triage should not run when flowId is pinned');
      },
      claim: async (requestId) => ({
        id: requestId,
        projectId: 'proj_1',
        title: 'resume from review',
        branch: 'develop',
        flowId: 'feature.standard',
        startStage: 'review',
      }),
      orchestrate: async (request, runType) => {
        calls.push(`orchestrate:${request.flowId}:${request.startStage}:${runType}`);
        return { workflowRunId: 'run_resume', ok: true };
      },
      complete: async () => {},
    });

    // FLOW_REGISTRY['feature.standard'].kind === 'feature'.
    expect(calls).toEqual(['orchestrate:feature.standard:review:feature']);
  });
});
