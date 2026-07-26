import { describe, expect, it } from 'vitest';
import type { CoordinatorDecision, WorkflowRequest } from '@ainp/shared';

type TestWorkflowRequest = Pick<
  WorkflowRequest,
  'id' | 'projectId' | 'title' | 'branch' | 'flowId' | 'startStage' | 'kind'
>;

function testRequest(overrides: Partial<TestWorkflowRequest> = {}): TestWorkflowRequest {
  return {
    id: 'wreq_1',
    projectId: 'proj_1',
    title: 'build UI workbench',
    branch: 'main',
    agentBackend: null,
    flowId: null,
    startStage: null,
    kind: null,
    ...overrides,
  };
}

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
        testRequest({ id: 'wreq_1', title: 'build UI workbench', branch: 'develop' }),
      ],
      triage: async (req) => {
        calls.push(`triage:${req.id}`);
        return { action: 'proceed', runType: 'feature', decision: fakeDecision() };
      },
      claim: async (requestId, runnerId) => {
        calls.push(`claim:${requestId}:${runnerId}`);
        return testRequest({ id: requestId, title: 'build UI workbench', branch: 'develop' });
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

  it('passes request-level backend override through to orchestration', async () => {
    const { processNextWorkflowRequest } = await import('../src/cmd/watch');
    const captured: string[] = [];

    const result = await processNextWorkflowRequest({
      runnerId: 'runner@test',
      listPending: async () => [
        testRequest({ id: 'wreq_backend', agentBackend: 'claude_code' }),
      ],
      triage: async () => ({ action: 'proceed', runType: 'feature', decision: fakeDecision() }),
      claim: async (requestId) => testRequest({ id: requestId, agentBackend: 'claude_code' }),
      orchestrate: async (request) => {
        captured.push(request.agentBackend ?? 'none');
        return { workflowRunId: 'run_backend', ok: true };
      },
      complete: async () => {},
    });

    expect(result).toBe('processed');
    expect(captured).toEqual(['claude_code']);
  });

  it('passes a clarified brief to orchestration while preserving the request title', async () => {
    const { buildClarifiedTaskBrief, processNextWorkflowRequest } = await import('../src/cmd/watch');
    const calls: string[] = [];
    const captured: { title?: string; agentTaskBrief?: string } = {};

    const result = await processNextWorkflowRequest({
      runnerId: 'runner@test',
      listPending: async () => [
        testRequest({ id: 'wreq_chat', title: 'Build import workflow' }),
      ],
      triage: async () => ({ action: 'proceed', runType: 'feature', decision: fakeDecision() }),
      claim: async (requestId) => ({
        ...testRequest({ id: requestId, title: 'Build import workflow' }),
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
        listPending: async () => [testRequest({ id: 'wreq_fail', title: 'bad task' })],
        triage: async () => ({ action: 'proceed', runType: 'feature', decision: fakeDecision() }),
        claim: async (requestId) => testRequest({ id: requestId, title: 'bad task' }),
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
      listPending: async () => [testRequest({ id: 'wreq_p', title: '权限' })],
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

  it('07-26 operational pause: does NOT complete the request when orchestrate returns paused', async () => {
    const { processNextWorkflowRequest } = await import('../src/cmd/watch');
    const completions: string[] = [];

    const result = await processNextWorkflowRequest({
      runnerId: 'runner@test',
      listPending: async () => [testRequest({ id: 'wreq_op_pause', title: 'operational pause task' })],
      triage: async () => ({ action: 'proceed', runType: 'feature', decision: fakeDecision() }),
      claim: async (requestId) => testRequest({ id: requestId, title: 'operational pause task' }),
      orchestrate: async () => ({ workflowRunId: 'run_op_pause', ok: false, paused: true }),
      complete: async (requestId) => {
        completions.push(requestId);
      },
    });

    // The engine already linked the request (claimed → paused) via the
    // workflow-paused event; completing it here would overwrite that state.
    expect(result).toBe('paused');
    expect(completions).toEqual([]);
  });

  it('returns aborted and skips downstream when triage aborts', async () => {
    const { processNextWorkflowRequest } = await import('../src/cmd/watch');
    const calls: string[] = [];

    const result = await processNextWorkflowRequest({
      runnerId: 'runner@test',
      listPending: async () => [testRequest({ id: 'wreq_a', title: 'cancel' })],
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

  it('skips ask pending requests without letting them block normal work', async () => {
    const { processNextWorkflowRequest } = await import('../src/cmd/watch');
    const calls: string[] = [];

    const result = await processNextWorkflowRequest({
      runnerId: 'runner@test',
      listPending: async () => [
        testRequest({ id: 'wreq_ask', title: 'Where is the router?', kind: 'ask' }),
        testRequest({ id: 'wreq_normal', title: 'build normal task' }),
      ],
      triage: async (req) => {
        calls.push(`triage:${req.id}`);
        return { action: 'proceed', runType: 'feature', decision: fakeDecision() };
      },
      claim: async (requestId) => {
        calls.push(`claim:${requestId}`);
        return testRequest({ id: requestId, title: 'build normal task' });
      },
      orchestrate: async (request, runType) => {
        calls.push(`orchestrate:${request.id}:${runType}`);
        return { workflowRunId: 'run_normal', ok: true };
      },
      complete: async (requestId) => {
        calls.push(`complete:${requestId}`);
      },
    });

    expect(result).toBe('processed');
    expect(calls).toEqual([
      'triage:wreq_normal',
      'claim:wreq_normal',
      'orchestrate:wreq_normal:feature',
      'complete:wreq_normal',
    ]);
  });

  it('does not claim or orchestrate requests triaged as ask', async () => {
    const { processNextWorkflowRequest } = await import('../src/cmd/watch');
    const calls: string[] = [];

    const result = await processNextWorkflowRequest({
      runnerId: 'runner@test',
      listPending: async () => [testRequest({ id: 'wreq_question', title: 'Where is routing configured?' })],
      triage: async () => {
        calls.push('triage');
        return {
          action: 'proceed',
          runType: 'ask',
          decision: fakeDecision({
            decision: { action: 'proceed', routeCase: 'ask', runType: 'ask', reason: 'question' },
          }),
        };
      },
      claim: async () => {
        calls.push('claim');
        return null;
      },
      orchestrate: async () => {
        calls.push('orchestrate');
        return { workflowRunId: 'run_should_not_exist', ok: true };
      },
      complete: async () => {
        calls.push('complete');
      },
    });

    expect(result).toBe('paused');
    expect(calls).toEqual(['triage']);
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
        testRequest({
          id: 'wreq_pinned',
          title: 'refactor entity layer',
          flowId: 'refactor.standard',
        }),
      ],
      triage: async () => {
        calls.push('triage:should-not-run');
        return { action: 'proceed', runType: 'feature', decision: fakeDecision() };
      },
      claim: async (requestId, runnerId) => {
        calls.push(`claim:${requestId}:${runnerId}`);
        return testRequest({
          id: requestId,
          title: 'refactor entity layer',
          flowId: 'refactor.standard',
        });
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

  it('claims profile.bootstrap requests as profile runs without Coordinator triage', async () => {
    const { processNextWorkflowRequest } = await import('../src/cmd/watch');
    const calls: string[] = [];

    const result = await processNextWorkflowRequest({
      runnerId: 'runner@test',
      listPending: async () => [
        testRequest({
          id: 'wreq_profile',
          title: 'Generate legacy project profile',
          flowId: 'profile.bootstrap',
        }),
      ],
      triage: async () => {
        calls.push('triage:should-not-run');
        return { action: 'proceed', runType: 'feature', decision: fakeDecision() };
      },
      claim: async (requestId, runnerId) => {
        calls.push(`claim:${requestId}:${runnerId}`);
        return testRequest({
          id: requestId,
          title: 'Generate legacy project profile',
          flowId: 'profile.bootstrap',
        });
      },
      orchestrate: async (request, runType) => {
        calls.push(`orchestrate:${request.flowId}:${request.startStage}:${runType}`);
        return { workflowRunId: 'run_profile', ok: true };
      },
      complete: async (requestId, completion) => {
        calls.push(`complete:${requestId}:${completion.workflowRunId}:${completion.ok}`);
      },
    });

    expect(result).toBe('processed');
    expect(calls).not.toContain('triage:should-not-run');
    expect(calls).toEqual([
      'claim:wreq_profile:runner@test',
      'orchestrate:profile.bootstrap:null:profile',
      'complete:wreq_profile:run_profile:true',
    ]);
  });

  it('forwards both flowId and startStage from a pinned feature.standard request', async () => {
    const { processNextWorkflowRequest } = await import('../src/cmd/watch');
    const calls: string[] = [];

    await processNextWorkflowRequest({
      runnerId: 'runner@test',
      listPending: async () => [
        testRequest({
          id: 'wreq_resume',
          title: 'resume from review',
          branch: 'develop',
          flowId: 'feature.standard',
          startStage: 'review',
        }),
      ],
      triage: async () => {
        throw new Error('triage should not run when flowId is pinned');
      },
      claim: async (requestId) => testRequest({
        id: requestId,
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
