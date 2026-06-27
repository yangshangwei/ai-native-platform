import { describe, expect, test, vi } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Artifact, StepRun } from '@ainp/shared';
import {
  restoreRunCtxInputsFromStageCheckpoint,
  runStage,
  type StepDeps,
} from '../src/orchestrator/steps';
import type { InvokedAgent } from '../src/orchestrator/types';
import { runCtxFixture, skillFixture } from './helpers/orchestrator-fixtures';

// ---------------------------------------------------------------------------
// T3.1 de-closure: `runStage` used to be an inner closure of `cmdOrchestrate`
// and had zero direct tests. These injected tests pin the three decision
// paths of the post-stage gate block: rule gate pass + approval approved,
// rule gate fail, approval rejected (with rejection_feedback persistence).
// ---------------------------------------------------------------------------

function agentFixture(outputs: InvokedAgent['outputs'] = []): InvokedAgent {
  return {
    taskId: 'task_stage',
    sessionId: 'ags_stage',
    invocationId: 'ctxinv_stage',
    contextPackArtifactId: 'art_context_pack_stage',
    outputs,
    contextPack: { id: 'cp_stage' } as InvokedAgent['contextPack'],
    contextRequest: null,
  };
}

function baseDeps(overrides: {
  gateStatus?: 'pass' | 'fail';
  approval?: { approved: boolean; comment: string | null };
  agent?: InvokedAgent;
} = {}) {
  const calls: string[] = [];
  const postRejectionFeedback = vi.fn(async () => {});
  const postArtifact = vi.fn(async (params: { kind: string }) => (
    { id: `art_${params.kind}` } as unknown as Artifact
  ));
  const deps = {
    api: {
      stepStarted: vi.fn(async () => {
        calls.push('stepStarted');
        return { step: { id: 'step_stage' } as unknown as StepRun };
      }),
      stepFinished: vi.fn(async (params: { status: string }) => {
        calls.push(`stepFinished:${params.status}`);
        return {};
      }),
      stepCheckpoint: vi.fn(async (params: { metadata?: Record<string, unknown> }) => ({
        checkpoint: {
          id: 'scp_stage',
          metadata: params.metadata ?? {},
        },
      })),
      postArtifact,
      recordHandoff: vi.fn(async () => ({})),
      runGate: vi.fn(async (params: { gateId: string }) => {
        calls.push(`runGate:${params.gateId}`);
        return { gate: { status: overrides.gateStatus ?? 'pass' } };
      }),
      awaitHuman: vi.fn(async (params: { stage: string }) => {
        calls.push(`awaitHuman:${params.stage}`);
        return {};
      }),
    },
    mustSkill: vi.fn(async () => skillFixture('requirement')),
    invokeSkill: vi.fn(async () => overrides.agent ?? agentFixture()),
    finishAgentSuccess: vi.fn(async () => {
      calls.push('finishAgentSuccess');
    }),
    awaitApproval: vi.fn(async (_runId: string, gateId: string) => {
      calls.push(`awaitApproval:${gateId}`);
      return overrides.approval ?? { approved: true, comment: null };
    }),
    postRejectionFeedback,
  };
  return { deps: deps as unknown as StepDeps, raw: deps, calls };
}

describe('runStage (de-closured)', () => {
  test('gate pass + approval approved: posts artifacts, tracks drafts, finishes step', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'runstage-'));
    const draftPath = join(dir, 'requirement.md');
    await writeFile(draftPath, '# REQ-001\n', 'utf8');
    const agent = agentFixture([
      { name: 'requirement.md', path: draftPath, contentType: 'text/markdown', size: 11 },
    ]);
    const { deps, raw, calls } = baseDeps({ agent });
    const c = runCtxFixture();

    await runStage(c, 'requirement', 'requirement_draft', 'requirement_gate', deps);

    expect(c.ok.value).toBe(true);
    expect(c.inputs['requirement.md']).toBe('# REQ-001\n');
    expect(c.inputArtifactIds['requirement.md']).toBe('art_requirement_draft');
    expect(raw.api.stepCheckpoint).toHaveBeenNthCalledWith(1, expect.objectContaining({
      stage: 'requirement',
      status: 'running',
      metadata: expect.objectContaining({
        stageContextPhase: 'start',
        stageContextStart: expect.objectContaining({
          phase: 'start',
          inputs: expect.objectContaining({
            user_request: 'Orchestrator de-closure test run',
          }),
        }),
      }),
    }));
    expect(raw.api.stepCheckpoint).toHaveBeenNthCalledWith(2, expect.objectContaining({
      stage: 'requirement',
      status: 'passed',
      outputArtifactIds: ['art_requirement_draft'],
      metadata: expect.objectContaining({
        stageContextPhase: 'finish',
        stageContextFinish: expect.objectContaining({
          phase: 'finish',
          inputArtifactIds: expect.objectContaining({
            'requirement.md': 'art_requirement_draft',
          }),
          producedArtifactIds: {
            'requirement.md': 'art_requirement_draft',
          },
          contextPackArtifactIds: expect.arrayContaining(['art_context_pack_stage']),
        }),
      }),
    }));
    const finishMetadata = raw.api.stepCheckpoint.mock.calls[1][0].metadata;
    expect(restoreRunCtxInputsFromStageCheckpoint({ metadata: finishMetadata })).toEqual({
      inputs: expect.objectContaining({ 'requirement.md': '# REQ-001\n' }),
      inputArtifactIds: expect.objectContaining({ 'requirement.md': 'art_requirement_draft' }),
    });
    expect(c.draftsToPromote).toHaveLength(1);
    expect(c.draftsToPromote[0]).toMatchObject({
      kind: 'requirement_draft',
      text: '# REQ-001\n',
    });
    expect(raw.api.postArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'requirement_draft', stepRunId: 'step_stage' }),
    );
    expect(calls).toEqual([
      'stepStarted',
      'finishAgentSuccess',
      'stepFinished:passed',
      'runGate:requirement_gate',
      'awaitHuman:requirement',
      'awaitApproval:requirement_gate',
    ]);
    expect(raw.postRejectionFeedback).not.toHaveBeenCalled();
  });

  test('rule gate fail: marks run failed, throws, never reaches human approval', async () => {
    const { deps, raw, calls } = baseDeps({ gateStatus: 'fail' });
    const c = runCtxFixture();

    await expect(
      runStage(c, 'design', 'design_doc', 'design_gate', deps),
    ).rejects.toThrow('design_gate failed');

    expect(c.ok.value).toBe(false);
    expect(calls).toContain('runGate:design_gate');
    expect(raw.api.awaitHuman).not.toHaveBeenCalled();
    expect(raw.awaitApproval).not.toHaveBeenCalled();
  });

  test('approval rejected: persists rejection_feedback comment, marks failed, throws', async () => {
    const { deps, raw } = baseDeps({
      approval: { approved: false, comment: 'REQ list incomplete' },
    });
    const c = runCtxFixture();

    await expect(
      runStage(c, 'requirement', 'requirement_draft', 'requirement_gate', deps),
    ).rejects.toThrow('requirement_gate rejected');

    expect(c.ok.value).toBe(false);
    expect(raw.postRejectionFeedback).toHaveBeenCalledWith({
      workflowRunId: 'run_orch',
      stepRunId: null,
      gateId: 'requirement_gate',
      comment: 'REQ list incomplete',
    });
  });

  test('review stage with null gate id runs no gate/approval block', async () => {
    const { deps, raw } = baseDeps();
    const c = runCtxFixture();

    await runStage(c, 'review', 'other', null, deps);

    expect(raw.api.runGate).not.toHaveBeenCalled();
    expect(raw.api.awaitHuman).not.toHaveBeenCalled();
    expect(raw.awaitApproval).not.toHaveBeenCalled();
    expect(c.ok.value).toBe(true);
  });

  test('review stage records bounded reviewer handoff from implementation session', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'runstage-review-handoff-'));
    const reviewPath = join(dir, 'review.md');
    await writeFile(reviewPath, '# Review\n\nNeeds follow-up.\n', 'utf8');
    const agent = agentFixture([
      { name: 'review.md', path: reviewPath, contentType: 'text/markdown', size: 26 },
    ]);
    const { deps, raw } = baseDeps({ agent });
    const c = runCtxFixture({
      handoffContext: {
        implementationSessionId: 'ags_impl',
        implementationArtifactIds: ['art_diff'],
      },
    });

    await runStage(c, 'review', 'other', null, deps);

    expect(raw.invokeSkill).toHaveBeenCalledWith(
      c,
      expect.anything(),
      expect.objectContaining({
        parentSessionId: 'ags_impl',
      }),
    );
    expect(raw.api.recordHandoff).toHaveBeenCalledWith(expect.objectContaining({
      parentSessionId: 'ags_impl',
      childSessionId: 'ags_stage',
      fromRole: 'executor',
      toRole: 'reviewer',
      status: 'completed',
      adoptionDecision: 'needs_review',
      inputArtifactIds: ['art_diff'],
      outputArtifactIds: ['art_other'],
    }));
  });
});
