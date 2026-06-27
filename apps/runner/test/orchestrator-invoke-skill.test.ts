import { describe, expect, test, vi } from 'vitest';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Artifact } from '@ainp/shared';
import { finishAgentSuccess, invokeSkill, type InvokeSkillDeps } from '../src/orchestrator/invoke-skill';
import { backendFixture, runCtxFixture, skillFixture } from './helpers/orchestrator-fixtures';

// ---------------------------------------------------------------------------
// T3.1 de-closure: `invokeSkill` used to be an inner closure of
// `cmdOrchestrate` capturing ctx/project/run/backend/inputArtifactIds. These
// injected tests pin the two outcome paths: a normal agent run (no
// context_request) and a structured context_request that gets captured,
// persisted and recorded.
// ---------------------------------------------------------------------------

function depsFixture() {
  let artifactSeq = 0;
  let taskSeq = 0;
  let resultSeq = 0;
  let sessionSeq = 0;
  const deps = {
    agentTaskStarted: vi.fn(async () => {
      taskSeq += 1;
      return { task: { id: taskSeq === 1 ? 'task_invoke' : `task_invoke_${taskSeq}` } };
    }),
    agentTaskFinished: vi.fn(async () => {
      resultSeq += 1;
      return { result: { id: resultSeq === 1 ? 'agr_invoke' : `agr_invoke_${resultSeq}` } };
    }),
    agentSessionStarted: vi.fn(async () => {
      sessionSeq += 1;
      return { session: { id: sessionSeq === 1 ? 'ags_invoke' : `ags_invoke_${sessionSeq}` } };
    }),
    agentSessionFinished: vi.fn(async () => ({})),
    postArtifact: vi.fn(async (params: { kind: string }) => {
      artifactSeq += 1;
      return { id: `art_${artifactSeq}_${params.kind}` } as unknown as Artifact;
    }),
    recordContextRequest: vi.fn(async () => ({})),
    recordKnowledgeUsage: vi.fn(async () => ({})),
    recordKnowledgeAction: vi.fn(async () => ({})),
  };
  return { deps: deps as unknown as InvokeSkillDeps, raw: deps };
}

describe('invokeSkill (de-closured)', () => {
  test('normal run: starts an agent task, returns outputs with no context request', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'invokeskill-'));
    const outPath = join(dir, 'requirement.md');
    await writeFile(outPath, '# REQ-001 requirement draft\n', 'utf8');
    const { deps, raw } = depsFixture();
    const backendRun = vi.fn(async () => ({
      outputs: [
        { name: 'requirement.md', path: outPath, contentType: 'text/markdown', size: 28 },
      ],
      lastMessage: 'requirement drafted',
    }));
    const c = runCtxFixture({ backend: backendFixture(backendRun) });
    const skill = skillFixture('requirement');

    const agent = await invokeSkill(c, skill, {
      workflowRunId: c.run.id,
      stepRunId: 'step_req',
      workspacePath: c.workspace.path,
      branch: c.workspace.branch,
      title: c.opts.title,
      artifactsDir: dir,
      inputs: c.inputs,
    }, deps);

    expect(agent.taskId).toBe('task_invoke');
    expect(agent.sessionId).toBe('ags_invoke');
    expect(agent.outputs).toHaveLength(1);
    expect(agent.contextRequest).toBeNull();
    expect(agent.contextPack.stage).toBe('requirement');
    expect(agent.contextPack.taskBrief).toBe('Orchestrator de-closure test run');
    expect(raw.agentTaskStarted).toHaveBeenCalledWith(expect.objectContaining({
      workflowRunId: 'run_orch',
      stepRunId: 'step_req',
      kind: 'requirement_draft',
      backend: 'native',
      prompt: expect.stringContaining('Skill: skill.requirement@1.0.0'),
    }));
    expect(raw.agentSessionStarted).toHaveBeenCalledWith(expect.objectContaining({
      workflowRunId: 'run_orch',
      agentTaskId: 'task_invoke',
      stage: 'requirement',
      skillId: 'skill.requirement',
      skillVersion: '1.0.0',
      contextPackId: agent.contextPack.id,
    }));
    // The backend received the platform-built context pack.
    expect(backendRun).toHaveBeenCalledWith(skill, expect.objectContaining({
      contextPack: expect.objectContaining({ stage: 'requirement' }),
    }));
    // Success finishing is the caller's job (finishAgentSuccess) — not here.
    expect(raw.agentTaskFinished).not.toHaveBeenCalled();
    expect(raw.recordContextRequest).not.toHaveBeenCalled();
  });

  test('context_request in last message: retries same skill with supplement context', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'invokeskill-ctxreq-'));
    const outPath = join(dir, 'implementation.md');
    const { deps, raw } = depsFixture();
    const lastMessage = [
      'I need more context before continuing.',
      '```json',
      JSON.stringify({
        type: 'context_request',
        reason: 'need the gate engine source',
        requestedRefs: ['apps/api/src/gates.ts'],
        questions: ['which gate ids are rule-based?'],
        priority: 2,
      }),
      '```',
    ].join('\n');
    const backendRun = vi.fn(async () => {
      if (backendRun.mock.calls.length === 1) {
        return { outputs: [], lastMessage };
      }
      await writeFile(outPath, '# implementation after supplement\n', 'utf8');
      return {
        outputs: [
          { name: 'implementation.md', path: outPath, contentType: 'text/markdown', size: 34 },
        ],
        lastMessage: 'implemented after supplement',
      };
    });
    const c = runCtxFixture({
      backend: backendFixture(backendRun),
    });
    const skill = skillFixture('implementation');

    const agent = await invokeSkill(c, skill, {
      workflowRunId: c.run.id,
      stepRunId: 'step_impl',
      workspacePath: c.workspace.path,
      branch: c.workspace.branch,
      title: c.opts.title,
      artifactsDir: dir,
      inputs: c.inputs,
    }, deps);

    expect(backendRun).toHaveBeenCalledTimes(2);
    expect(agent.taskId).toBe('task_invoke_2');
    expect(agent.sessionId).toBe('ags_invoke_2');
    expect(agent.contextRequest).not.toBeNull();
    const capture = agent.contextRequest!;
    expect(capture.sourceName).toBe('last_message');
    expect(capture.request.requestedRefs).toEqual(['apps/api/src/gates.ts']);
    expect(capture.requestArtifactId).toBe('art_1_other');
    expect(capture.supplementArtifactId).toBe('art_2_context_pack');
    expect(capture.supplementContextPack.supplement).toMatchObject({
      contextRequestId: capture.request.id,
      baseContextPackId: capture.baseContextPackId,
      retryIndex: 1,
    });
    expect(capture.supplementContextPackId).toBe(agent.contextPack.id);

    // RunCtx mutations: chain + inputs + artifact ids.
    expect(c.contextRequestChain).toEqual([capture]);
    expect(c.inputs[`context_request.${capture.request.id}.json`]).toContain('need the gate engine source');
    expect(c.inputArtifactIds[`context_supplement.${capture.request.id}.json`])
      .toBe('art_2_context_pack');

    // Request + supplement were persisted to disk and recorded via the API.
    const persisted = await readdir(join(dir, 'context-requests'));
    expect(persisted).toHaveLength(2);
    expect(raw.recordContextRequest).toHaveBeenCalledWith(expect.objectContaining({
      workflowRunId: 'run_orch',
      supplementContextPackId: capture.supplementContextPackId,
      requestArtifactId: 'art_1_other',
      supplementArtifactId: 'art_2_context_pack',
    }));
    expect(raw.agentTaskFinished).toHaveBeenCalledWith({
      taskId: 'task_invoke',
      status: 'success',
      summary: expect.stringContaining(`context_request ${capture.request.id} captured`),
      outputArtifactIds: ['art_1_other', 'art_2_context_pack'],
    });
    expect(raw.agentSessionFinished).toHaveBeenCalledWith({
      sessionId: 'ags_invoke',
      status: 'success',
      agentResultId: 'agr_invoke',
      metadata: {
        contextRequestId: capture.request.id,
        supplementContextPackId: capture.supplementContextPackId,
        retryPlanned: true,
      },
    });
    expect(raw.agentSessionStarted).toHaveBeenNthCalledWith(2, expect.objectContaining({
      parentSessionId: 'ags_invoke',
      retryIndex: 1,
      contextPackId: capture.supplementContextPackId,
    }));
  });

  test('repeated context_request after retry limit fails and finishes retry session', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'invokeskill-ctxreq-loop-'));
    const { deps, raw } = depsFixture();
    const repeated = [
      'Still need context.',
      '```json',
      JSON.stringify({
        type: 'context_request',
        reason: 'need the same file again',
        requestedRefs: ['apps/api/src/gates.ts'],
        priority: 2,
      }),
      '```',
    ].join('\n');
    const c = runCtxFixture({
      backend: backendFixture(async () => ({ outputs: [], lastMessage: repeated })),
    });

    await expect(invokeSkill(c, skillFixture('implementation'), {
      workflowRunId: c.run.id,
      stepRunId: 'step_impl',
      workspacePath: c.workspace.path,
      branch: c.workspace.branch,
      title: c.opts.title,
      artifactsDir: dir,
      inputs: c.inputs,
    }, deps)).rejects.toThrow('context_request retry limit reached');

    expect(raw.agentSessionStarted).toHaveBeenNthCalledWith(2, expect.objectContaining({
      parentSessionId: 'ags_invoke',
      retryIndex: 1,
    }));
    expect(raw.agentSessionFinished).toHaveBeenLastCalledWith(expect.objectContaining({
      sessionId: 'ags_invoke_2',
      status: 'failed',
      agentResultId: 'agr_invoke_2',
      metadata: expect.objectContaining({
        error: expect.stringContaining('context_request retry limit reached'),
      }),
    }));
  });

  test('sensitive-only context_request is filtered and does not retry', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'invokeskill-sensitive-ctxreq-'));
    const { deps, raw } = depsFixture();
    const sensitiveRequest = [
      'Need secrets.',
      '```json',
      JSON.stringify({
        type: 'context_request',
        reason: 'need .env and private key',
        requestedRefs: ['.env', '.ssh/id_rsa'],
        questions: ['Read .ssh/id_rsa?'],
        priority: 1,
      }),
      '```',
    ].join('\n');
    const backendRun = vi.fn(async () => ({ outputs: [], lastMessage: sensitiveRequest }));
    const c = runCtxFixture({
      backend: backendFixture(backendRun),
    });

    const agent = await invokeSkill(c, skillFixture('implementation'), {
      workflowRunId: c.run.id,
      stepRunId: 'step_impl',
      workspacePath: c.workspace.path,
      branch: c.workspace.branch,
      title: c.opts.title,
      artifactsDir: dir,
      inputs: c.inputs,
    }, deps);

    expect(agent.taskId).toBe('task_invoke');
    expect(agent.contextRequest).toBeNull();
    expect(backendRun).toHaveBeenCalledTimes(1);
    expect(raw.agentSessionStarted).toHaveBeenCalledTimes(1);
    expect(raw.agentTaskFinished).not.toHaveBeenCalled();
  });

  test('backend failure: finishes the agent task as failed and rethrows', async () => {
    const { deps, raw } = depsFixture();
    const c = runCtxFixture({
      backend: backendFixture(async () => {
        throw new Error('backend exploded');
      }),
    });

    await expect(invokeSkill(c, skillFixture('review'), {
      workflowRunId: c.run.id,
      stepRunId: 'step_review',
      workspacePath: c.workspace.path,
      branch: c.workspace.branch,
      title: c.opts.title,
      artifactsDir: '/tmp/unused',
      inputs: c.inputs,
    }, deps)).rejects.toThrow('backend exploded');

    expect(raw.agentTaskFinished).toHaveBeenCalledWith({
      taskId: 'task_invoke',
      status: 'failed',
      summary: 'backend exploded',
      outputArtifactIds: [],
    });
    expect(raw.agentSessionFinished).toHaveBeenCalledWith({
      sessionId: 'ags_invoke',
      status: 'failed',
      agentResultId: 'agr_invoke',
      metadata: { error: 'backend exploded' },
    });
  });

  test('finishAgentSuccess links successful AgentResult back to the AgentSession', async () => {
    const agentTaskFinished = vi.fn(async () => ({ result: { id: 'agr_success' } }));
    const agentSessionFinished = vi.fn(async () => ({ session: { id: 'ags_success' } }));

    await finishAgentSuccess(
      {
        taskId: 'task_success',
        sessionId: 'ags_success',
        outputs: [],
        contextPack: {} as never,
        contextRequest: null,
      },
      ['art_output'],
      'produced output',
      agentTaskFinished as never,
      agentSessionFinished as never,
    );

    expect(agentTaskFinished).toHaveBeenCalledWith({
      taskId: 'task_success',
      status: 'success',
      summary: 'produced output',
      outputArtifactIds: ['art_output'],
    });
    expect(agentSessionFinished).toHaveBeenCalledWith({
      sessionId: 'ags_success',
      status: 'success',
      agentResultId: 'agr_success',
      metadata: {
        outputArtifactIds: ['art_output'],
        contextRequestId: null,
        supplementContextPackId: null,
      },
    });
  });
});
