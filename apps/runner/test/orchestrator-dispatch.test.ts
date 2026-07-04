import { describe, expect, test, vi } from 'vitest';
import type { StageStep } from '@ainp/shared';
import { dispatchStep, type DispatchDeps } from '../src/orchestrator';
import { runCtxFixture } from './helpers/orchestrator-fixtures';

// ---------------------------------------------------------------------------
// T3.1 de-closure: `dispatchStep` remains the single-point router (spec
// flow-registry.md — every stage MUST flow through it); these tests verify
// each WorkflowStage routes to exactly the right step implementation using
// spy deps. Production callers use the default deps wired to the real
// implementations.
// ---------------------------------------------------------------------------

function spyDeps() {
  const calls: string[] = [];
  const deps: DispatchDeps = {
    runContextPack: vi.fn(async () => {
      calls.push('runContextPack');
    }),
    runStage: vi.fn(async (_c, stage, artifactKind, rulebasedGateId) => {
      calls.push(`runStage:${stage}:${artifactKind}:${String(rulebasedGateId)}`);
    }),
    executeImplementation: vi.fn(async () => {
      calls.push('executeImplementation');
    }),
    executeBuildTest: vi.fn(async () => {
      calls.push('executeBuildTest');
    }),
    executeVerifier: vi.fn(async () => {
      calls.push('executeVerifier');
    }),
    executeAcceptance: vi.fn(async () => {
      calls.push('executeAcceptance');
    }),
    executeCompletion: vi.fn(async () => {
      calls.push('executeCompletion');
    }),
    executeKnowledgePromotion: vi.fn(async () => {
      calls.push('executeKnowledgePromotion');
    }),
    executeInventory: vi.fn(async () => {
      calls.push('executeInventory');
    }),
    executeProfileBootstrap: vi.fn(async () => {
      calls.push('executeProfileBootstrap');
    }),
    executeAgentMarkdownStage: vi.fn(async (stage) => {
      calls.push(`executeAgentMarkdownStage:${stage}`);
    }),
  };
  return { deps, calls };
}

function step(stage: StageStep['stage']): StageStep {
  return { stage, kind: 'agent' };
}

describe('dispatchStep single-point routing (de-closured)', () => {
  test.each([
    ['context_pack', ['runContextPack']],
    ['requirement', ['runStage:requirement:requirement_draft:requirement_gate']],
    ['design', ['runStage:design:design_doc:design_gate']],
    ['implementation', ['executeImplementation']],
    ['build_test', ['executeBuildTest']],
    ['completion', ['executeCompletion']],
    ['knowledge', ['executeKnowledgePromotion']],
    ['inventory', ['executeInventory']],
    ['profile', ['executeProfileBootstrap']],
    ['report', ['executeAgentMarkdownStage:report']],
    ['analyze', ['executeAgentMarkdownStage:analyze']],
    ['scan', ['executeAgentMarkdownStage:scan']],
    ['plan', ['executeAgentMarkdownStage:plan']],
  ] as const)('%s routes to %j', async (stage, expected) => {
    const { deps, calls } = spyDeps();
    const ctx = runCtxFixture();

    await dispatchStep(step(stage), ctx, deps);

    expect(calls).toEqual(expected);
  });

  test('review routes to runStage(review) then verifier then acceptance, in order', async () => {
    const { deps, calls } = spyDeps();
    const ctx = runCtxFixture();

    await dispatchStep(step('review'), ctx, deps);

    expect(calls).toEqual([
      'runStage:review:other:null',
      'executeVerifier',
      'executeAcceptance',
    ]);
  });

  test('every step implementation receives the same RunCtx instance', async () => {
    const { deps } = spyDeps();
    const ctx = runCtxFixture();

    await dispatchStep(step('implementation'), ctx, deps);
    await dispatchStep(step('review'), ctx, deps);

    expect(deps.executeImplementation).toHaveBeenCalledWith(ctx);
    expect(deps.runStage).toHaveBeenCalledWith(ctx, 'review', 'other', null);
    expect(deps.executeVerifier).toHaveBeenCalledWith(ctx);
    expect(deps.executeAcceptance).toHaveBeenCalledWith(ctx);
  });

  test("'init' is rejected as a status placeholder, never dispatched", async () => {
    const { deps, calls } = spyDeps();
    const ctx = runCtxFixture();

    await expect(dispatchStep(step('init'), ctx, deps)).rejects.toThrow(
      "'init' is not a dispatchable stage",
    );
    expect(calls).toEqual([]);
  });
});
