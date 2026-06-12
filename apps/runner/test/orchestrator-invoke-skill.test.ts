import { describe, expect, test, vi } from 'vitest';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Artifact } from '@ainp/shared';
import { invokeSkill, type InvokeSkillDeps } from '../src/orchestrator/invoke-skill';
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
  const deps = {
    agentTaskStarted: vi.fn(async () => ({ task: { id: 'task_invoke' } })),
    agentTaskFinished: vi.fn(async () => ({})),
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
    // The backend received the platform-built context pack.
    expect(backendRun).toHaveBeenCalledWith(skill, expect.objectContaining({
      contextPack: expect.objectContaining({ stage: 'requirement' }),
    }));
    // Success finishing is the caller's job (finishAgentSuccess) — not here.
    expect(raw.agentTaskFinished).not.toHaveBeenCalled();
    expect(raw.recordContextRequest).not.toHaveBeenCalled();
  });

  test('context_request in last message: captured, persisted and recorded on RunCtx', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'invokeskill-ctxreq-'));
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
    const c = runCtxFixture({
      backend: backendFixture(async () => ({ outputs: [], lastMessage })),
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

    expect(agent.contextRequest).not.toBeNull();
    const capture = agent.contextRequest!;
    expect(capture.sourceName).toBe('last_message');
    expect(capture.request.requestedRefs).toEqual(['apps/api/src/gates.ts']);
    expect(capture.requestArtifactId).toBe('art_1_other');
    expect(capture.supplementArtifactId).toBe('art_2_context_pack');
    expect(capture.baseContextPackId).toBe(agent.contextPack.id);

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
  });
});
