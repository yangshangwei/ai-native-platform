import { describe, expect, test, vi } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isOperationalError,
  REQUIREMENT_DESIGN_STAGE_HANDOFF_INPUT,
  REVIEW_VERDICT_OUTPUT_NAME,
  REVIEW_VERDICT_SCHEMA_VERSION,
  STAGE_HANDOFF_SCHEMA_VERSION,
  type Artifact,
  type OperationalError,
  type ReviewerVerdict,
  type StepRun,
} from '@ainp/shared';
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

/** A legal `ainp.review_verdict.v1` body; overrides drive the rejection cases. */
function reviewVerdictJson(overrides: Partial<ReviewerVerdict> = {}): string {
  const verdict: ReviewerVerdict = {
    schemaVersion: REVIEW_VERDICT_SCHEMA_VERSION,
    role: 'reviewer',
    status: 'pass',
    summary: 'Change is scoped and covered.',
    blocking: [],
    remediation: [],
    advisory: [],
    evidenceRefs: [],
    provenance: {
      agentSessionId: 'ags_stage',
      backend: 'native',
      skillId: 'skill.review',
      producedAt: '2026-08-08T00:00:00.000Z',
    },
    unavailableReason: null,
    ...overrides,
  };
  return `${JSON.stringify(verdict, null, 2)}\n`;
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
    const requirementMarkdown = [
      '---',
      'doc_type: requirement',
      'pitch: Keep design grounded in confirmed requirement constraints.',
      'status: draft',
      '---',
      '# REQ-001',
      '',
      '## 边界',
      '- Constraint: preserve existing handoff authority boundaries.',
      '',
      '## 风险',
      '- Handoff evidence must not drive gate status.',
      '',
    ].join('\n');
    await writeFile(draftPath, requirementMarkdown, 'utf8');
    const agent = agentFixture([
      { name: 'requirement.md', path: draftPath, contentType: 'text/markdown', size: Buffer.byteLength(requirementMarkdown, 'utf8') },
    ]);
    const { deps, raw, calls } = baseDeps({ agent });
    const c = runCtxFixture();

    await runStage(c, 'requirement', 'requirement_draft', 'requirement_gate', deps);

    expect(c.ok.value).toBe(true);
    expect(c.inputs['requirement.md']).toBe(requirementMarkdown);
    expect(c.inputArtifactIds['requirement.md']).toBe('art_requirement_draft');
    expect(c.inputs[REQUIREMENT_DESIGN_STAGE_HANDOFF_INPUT]).toContain(
      '# Stage Handoff: requirement -> design',
    );
    expect(c.inputArtifactIds[REQUIREMENT_DESIGN_STAGE_HANDOFF_INPUT]).toBe('art_other');
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
      outputArtifactIds: expect.arrayContaining(['art_requirement_draft', 'art_other']),
      metadata: expect.objectContaining({
        stageContextPhase: 'finish',
        stageContextFinish: expect.objectContaining({
          phase: 'finish',
          inputArtifactIds: expect.objectContaining({
            'requirement.md': 'art_requirement_draft',
            [REQUIREMENT_DESIGN_STAGE_HANDOFF_INPUT]: 'art_other',
          }),
          producedArtifactIds: expect.objectContaining({
            'requirement.md': 'art_requirement_draft',
            [REQUIREMENT_DESIGN_STAGE_HANDOFF_INPUT]: 'art_other',
          }),
          contextPackArtifactIds: expect.arrayContaining(['art_context_pack_stage']),
        }),
      }),
    }));
    const finishMetadata = raw.api.stepCheckpoint.mock.calls[1][0].metadata;
    expect(restoreRunCtxInputsFromStageCheckpoint({ metadata: finishMetadata })).toEqual({
      inputs: expect.objectContaining({
        'requirement.md': requirementMarkdown,
        [REQUIREMENT_DESIGN_STAGE_HANDOFF_INPUT]: expect.stringContaining('Produced Artifacts'),
      }),
      inputArtifactIds: expect.objectContaining({
        'requirement.md': 'art_requirement_draft',
        [REQUIREMENT_DESIGN_STAGE_HANDOFF_INPUT]: 'art_other',
      }),
    });
    expect(c.draftsToPromote).toHaveLength(1);
    expect(c.draftsToPromote[0]).toMatchObject({
      kind: 'requirement_draft',
      text: requirementMarkdown,
    });
    expect(raw.api.postArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'requirement_draft', stepRunId: 'step_stage' }),
    );
    expect(raw.api.postArtifact).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'other',
      stepRunId: 'step_stage',
      metadata: expect.objectContaining({
        schemaVersion: STAGE_HANDOFF_SCHEMA_VERSION,
        reportKind: 'stage_handoff',
        stageHandoff: expect.objectContaining({
          schemaVersion: STAGE_HANDOFF_SCHEMA_VERSION,
          fromStage: 'requirement',
          toStage: 'design',
          producedArtifacts: [expect.objectContaining({
            key: 'requirement.md',
            artifactId: 'art_requirement_draft',
            injectionPreference: 'summary',
          })],
        }),
      }),
    }));
    expect(raw.api.recordHandoff).toHaveBeenCalledWith(expect.objectContaining({
      fromRole: 'main',
      toRole: 'planner',
      inputArtifactIds: ['art_requirement_draft'],
      outputArtifactIds: ['art_other'],
      expectedOutput: expect.objectContaining({
        schemaVersion: STAGE_HANDOFF_SCHEMA_VERSION,
      }),
      metadata: expect.objectContaining({
        stageHandoff: expect.objectContaining({
          schemaVersion: STAGE_HANDOFF_SCHEMA_VERSION,
        }),
      }),
    }));
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

  test('design stage receives requirement handoff input before invocation', async () => {
    const { deps, raw } = baseDeps();
    const c = runCtxFixture({
      inputs: {
        user_request: 'Orchestrator de-closure test run',
        'requirement.md': '# REQ-001\n',
        [REQUIREMENT_DESIGN_STAGE_HANDOFF_INPUT]: '# Stage Handoff: requirement -> design\n',
      },
      inputArtifactIds: {
        'requirement.md': 'art_requirement_draft',
        [REQUIREMENT_DESIGN_STAGE_HANDOFF_INPUT]: 'art_stage_handoff',
      },
    });

    await runStage(c, 'design', 'design_doc', 'design_gate', deps);

    expect(raw.invokeSkill).toHaveBeenCalledWith(
      c,
      expect.anything(),
      expect.objectContaining({
        inputs: expect.objectContaining({
          [REQUIREMENT_DESIGN_STAGE_HANDOFF_INPUT]: '# Stage Handoff: requirement -> design\n',
        }),
      }),
    );
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
    const verdictPath = join(dir, REVIEW_VERDICT_OUTPUT_NAME);
    const verdictBody = reviewVerdictJson();
    await writeFile(verdictPath, verdictBody, 'utf8');
    const agent = agentFixture([
      { name: 'review.md', path: reviewPath, contentType: 'text/markdown', size: 26 },
      {
        name: REVIEW_VERDICT_OUTPUT_NAME,
        path: verdictPath,
        contentType: 'application/json',
        size: Buffer.byteLength(verdictBody, 'utf8'),
      },
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
      // Both review outputs land as kind='other', so `postArtifact` returns the
      // same stubbed id twice; the handoff records the deduped set.
      outputArtifactIds: ['art_other', 'art_other'],
    }));
  });

  // ---- 08-08 P0-2 R2/R3: reviewer verdict enforcement --------------------

  test('review stage without the verdict output pauses as backend_protocol', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'runstage-review-no-verdict-'));
    const reviewPath = join(dir, 'review.md');
    await writeFile(reviewPath, '# Review\n\nLGTM.\n', 'utf8');
    const agent = agentFixture([
      { name: 'review.md', path: reviewPath, contentType: 'text/markdown', size: 16 },
    ]);
    const { deps } = baseDeps({ agent });
    const c = runCtxFixture();

    const caught = await runStage(c, 'review', 'other', null, deps).catch((err: unknown) => err);

    expect(isOperationalError(caught)).toBe(true);
    expect((caught as OperationalError).reason).toBe('backend_protocol');
    expect((caught as OperationalError).message).toContain(REVIEW_VERDICT_OUTPUT_NAME);
  });

  test('review stage with a self-contradictory verdict pauses as backend_protocol', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'runstage-review-bad-verdict-'));
    const reviewPath = join(dir, 'review.md');
    await writeFile(reviewPath, '# Review\n\nBroken.\n', 'utf8');
    const verdictPath = join(dir, REVIEW_VERDICT_OUTPUT_NAME);
    // status 'fail' with an empty blocking list — R2 rejects this.
    const verdictBody = reviewVerdictJson({ status: 'fail', blocking: [], remediation: [] });
    await writeFile(verdictPath, verdictBody, 'utf8');
    const agent = agentFixture([
      { name: 'review.md', path: reviewPath, contentType: 'text/markdown', size: 18 },
      {
        name: REVIEW_VERDICT_OUTPUT_NAME,
        path: verdictPath,
        contentType: 'application/json',
        size: Buffer.byteLength(verdictBody, 'utf8'),
      },
    ]);
    const { deps } = baseDeps({ agent });
    const c = runCtxFixture();

    const caught = await runStage(c, 'review', 'other', null, deps).catch((err: unknown) => err);

    expect(isOperationalError(caught)).toBe(true);
    expect((caught as OperationalError).reason).toBe('backend_protocol');
  });

  test("review stage with status 'unavailable' pauses as reviewer_unavailable, not a gate fail", async () => {
    const dir = await mkdtemp(join(tmpdir(), 'runstage-review-unavailable-'));
    const reviewPath = join(dir, 'review.md');
    await writeFile(reviewPath, '# Review\n\nCannot judge.\n', 'utf8');
    const verdictPath = join(dir, REVIEW_VERDICT_OUTPUT_NAME);
    const verdictBody = reviewVerdictJson({
      status: 'unavailable',
      unavailableReason: 'diff artifact was unreadable',
    });
    await writeFile(verdictPath, verdictBody, 'utf8');
    const agent = agentFixture([
      { name: 'review.md', path: reviewPath, contentType: 'text/markdown', size: 24 },
      {
        name: REVIEW_VERDICT_OUTPUT_NAME,
        path: verdictPath,
        contentType: 'application/json',
        size: Buffer.byteLength(verdictBody, 'utf8'),
      },
    ]);
    const { deps, raw } = baseDeps({ agent });
    const c = runCtxFixture();

    const caught = await runStage(c, 'review', 'other', null, deps).catch((err: unknown) => err);

    expect(isOperationalError(caught)).toBe(true);
    expect((caught as OperationalError).reason).toBe('reviewer_unavailable');
    expect((caught as OperationalError).message).toContain('diff artifact was unreadable');
    // Never a gate decision: no gate ran, no approval was requested.
    expect(raw.api.runGate).not.toHaveBeenCalled();
    expect(raw.awaitApproval).not.toHaveBeenCalled();
  });

  test('review stage verdict citing an unknown artifactId pauses as backend_protocol', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'runstage-review-unknown-evidence-'));
    const reviewPath = join(dir, 'review.md');
    await writeFile(reviewPath, '# Review\n\nLGTM.\n', 'utf8');
    const verdictPath = join(dir, REVIEW_VERDICT_OUTPUT_NAME);
    const verdictBody = reviewVerdictJson({
      evidenceRefs: [{ artifactId: 'art_never_written', claim: 'imagined evidence' }],
    });
    await writeFile(verdictPath, verdictBody, 'utf8');
    const agent = agentFixture([
      { name: 'review.md', path: reviewPath, contentType: 'text/markdown', size: 16 },
      {
        name: REVIEW_VERDICT_OUTPUT_NAME,
        path: verdictPath,
        contentType: 'application/json',
        size: Buffer.byteLength(verdictBody, 'utf8'),
      },
    ]);
    const { deps } = baseDeps({ agent });
    const c = runCtxFixture();

    const caught = await runStage(c, 'review', 'other', null, deps).catch((err: unknown) => err);

    expect(isOperationalError(caught)).toBe(true);
    expect((caught as OperationalError).reason).toBe('backend_protocol');
    expect((caught as OperationalError).message).toContain('art_never_written');
  });
});
