/**
 * 07-26 operational-unavailable-state — runner-side classification tests.
 *
 * `handleOrchestrationError` is the single decision point between the paused
 * path (operational error → workflow-paused report, worktree kept) and the
 * historical failure path (everything else, byte-for-byte unchanged — R7).
 * `executeImplementation` missing-outputs is pinned as `backend_protocol`.
 */
import { describe, expect, test, vi } from 'vitest';
import { OperationalError, isOperationalError } from '@ainp/shared';
import {
  finalizeOrchestration,
  handleOrchestrationError,
  recordGraphNodeFailure,
  type OperationalPauseDeps,
  type OrchestrationFinalizationDeps,
  type OrchestrationGraphFailureDeps,
} from '../src/orchestrator';
import { executeImplementation, type StepDeps } from '../src/orchestrator/steps';
import type { InvokedAgent } from '../src/orchestrator/types';
import { runCtxFixture, skillFixture } from './helpers/orchestrator-fixtures';

function pauseDeps(overrides: Partial<OperationalPauseDeps> = {}) {
  const workflowPaused = vi.fn(async () => ({}));
  const isWorkflowPaused = vi.fn(async () => false);
  const resolveWorktreeHead = vi.fn(async () => 'headsha123');
  const log = vi.fn();
  const deps: OperationalPauseDeps = {
    workflowPaused: workflowPaused as unknown as OperationalPauseDeps['workflowPaused'],
    isWorkflowPaused,
    resolveWorktreeHead,
    log,
    ...overrides,
  };
  return { deps, workflowPaused, isWorkflowPaused, resolveWorktreeHead, log };
}

describe('handleOrchestrationError (R3/R4/R7 classification)', () => {
  test('operational error reports workflow-paused with reason/detail/worktreeHead and returns true', async () => {
    const { deps, workflowPaused } = pauseDeps();

    const paused = await handleOrchestrationError({
      err: new OperationalError('backend_timeout', 'claude exited -1 during implementation'),
      workflowRunId: 'run_pause_1',
      stage: 'implementation',
      workspacePath: '/tmp/ws',
      deps,
    });

    expect(paused).toBe(true);
    expect(workflowPaused).toHaveBeenCalledTimes(1);
    expect(workflowPaused).toHaveBeenCalledWith({
      workflowRunId: 'run_pause_1',
      stage: 'implementation',
      reason: 'backend_timeout',
      detail: 'claude exited -1 during implementation',
      worktreeHead: 'headsha123',
    });
  });

  test('business error returns false and never reports workflow-paused (R7)', async () => {
    const { deps, workflowPaused } = pauseDeps();

    const paused = await handleOrchestrationError({
      err: new Error('diff_scope_gate failed; aborting'),
      workflowRunId: 'run_pause_2',
      stage: 'implementation',
      workspacePath: '/tmp/ws',
      deps,
    });

    expect(paused).toBe(false);
    expect(workflowPaused).not.toHaveBeenCalled();
  });

  test('failed pause report falls back to the failure path (returns false, logs)', async () => {
    const { deps, log } = pauseDeps({
      workflowPaused: vi.fn(async () => {
        throw new Error('API POST /runner/events/workflow-paused -> 500');
      }) as unknown as OperationalPauseDeps['workflowPaused'],
    });

    const paused = await handleOrchestrationError({
      err: new OperationalError('backend_unavailable', 'Claude Code is not ready (needs_login).'),
      workflowRunId: 'run_pause_3',
      stage: 'context_pack',
      workspacePath: '/tmp/ws',
      deps,
    });

    expect(paused).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('workflow-paused report failed'));
  });

  test('keeps the pause path when the event committed but its response was lost', async () => {
    const { deps: baseDeps, log } = pauseDeps({
      workflowPaused: vi.fn(async () => {
        throw new Error('socket closed after request body was sent');
      }) as unknown as OperationalPauseDeps['workflowPaused'],
    });
    const isWorkflowPaused = vi.fn(async () => true);
    const deps = { ...baseDeps, isWorkflowPaused } as OperationalPauseDeps & {
      isWorkflowPaused: typeof isWorkflowPaused;
    };

    const paused = await handleOrchestrationError({
      err: new OperationalError('backend_timeout', 'claude timed out'),
      workflowRunId: 'run_pause_response_lost',
      stage: 'implementation',
      workspacePath: '/tmp/ws',
      deps,
    });

    expect(paused).toBe(true);
    expect(isWorkflowPaused).toHaveBeenCalledWith('run_pause_response_lost');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('confirmed paused after response failure'));
  });

  test('worktree HEAD resolution failure is tolerated (pause proceeds with null head)', async () => {
    const { deps, workflowPaused } = pauseDeps({
      resolveWorktreeHead: vi.fn(async () => {
        throw new Error('not a git repo');
      }),
    });

    const paused = await handleOrchestrationError({
      err: new OperationalError('backend_protocol', 'implementation: missing diff outputs'),
      workflowRunId: 'run_pause_4',
      stage: 'implementation',
      workspacePath: '/tmp/ws',
      deps,
    });

    expect(paused).toBe(true);
    expect(workflowPaused).toHaveBeenCalledWith(
      expect.objectContaining({ worktreeHead: null, reason: 'backend_protocol' }),
    );
  });
});

describe('executeImplementation missing outputs (R2 → backend_protocol)', () => {
  function agentFixture(outputs: InvokedAgent['outputs']): InvokedAgent {
    return {
      taskId: 'task_impl',
      sessionId: 'ags_impl',
      invocationId: 'ctxinv_impl',
      contextPackArtifactId: 'art_cp_impl',
      outputs,
      contextPack: { id: 'cp_impl' } as InvokedAgent['contextPack'],
      contextRequest: null,
    };
  }

  test('agent finishing without diff outputs throws OperationalError(backend_protocol)', async () => {
    const deps = {
      api: {
        stepStarted: vi.fn(async () => ({ step: { id: 'step_impl' } })),
        stepFinished: vi.fn(async () => ({})),
        stepCheckpoint: vi.fn(async (params: { metadata?: Record<string, unknown> }) => ({
          checkpoint: { id: 'scp_impl', metadata: params.metadata ?? {} },
        })),
      },
      mustSkill: vi.fn(async () => skillFixture('implementation')),
      invokeSkill: vi.fn(async () => agentFixture([])),
    } as unknown as StepDeps;
    const c = runCtxFixture();

    let caught: unknown = null;
    try {
      await executeImplementation(c, deps);
    } catch (err) {
      caught = err;
    }

    expect(caught).not.toBeNull();
    expect(isOperationalError(caught)).toBe(true);
    expect((caught as OperationalError).reason).toBe('backend_protocol');
    expect((caught as OperationalError).message).toBe('implementation: missing diff outputs');
    expect((caught as OperationalError).detail).toBe('implementation: missing diff outputs');
  });
});

describe('orchestration lifecycle finalization (R4/R7)', () => {
  function finalizationDeps() {
    const workflowCompleted = vi.fn(async () => ({}));
    const cleanup = vi.fn(async () => {});
    const setExitCode = vi.fn();
    const log = vi.fn();
    const deps: OrchestrationFinalizationDeps = {
      workflowCompleted: workflowCompleted as unknown as OrchestrationFinalizationDeps['workflowCompleted'],
      cleanup,
      setExitCode,
      log,
    };
    return { deps, workflowCompleted, cleanup, setExitCode, log };
  }

  test('operational pause normalizes a prior ok=false to exit-success semantics', async () => {
    const { deps: pauseDecisionDeps } = pauseDeps();
    const paused = await handleOrchestrationError({
      err: new OperationalError('backend_timeout', 'claude timed out'),
      workflowRunId: 'run_lifecycle_paused',
      stage: 'implementation',
      workspacePath: '/tmp/worktree-kept',
      deps: pauseDecisionDeps,
    });
    const { deps, workflowCompleted, cleanup, setExitCode, log } = finalizationDeps();

    const result = await finalizeOrchestration({
      workflowRunId: 'run_lifecycle_paused',
      workspacePath: '/tmp/worktree-kept',
      // profile.bootstrap can set ok=false before a backend failure rethrows;
      // paused remains an operational state, not a failed process result.
      ok: false,
      paused,
      cleanupEnabled: true,
      setFailureExitCode: true,
      deps,
    });

    expect(result).toEqual({ workflowRunId: 'run_lifecycle_paused', ok: true, paused: true });
    expect(workflowCompleted).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
    expect(setExitCode).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('worktree kept'));
  });

  test.each([
    ['compile', 'compile failed; aborting'],
    ['test_gate', 'test_gate failed; aborting'],
    ['diff_scope', 'diff_scope_gate failed; aborting'],
  ])('business %s failure retains completion, cleanup, failure result, and exit code', async (kind, message) => {
    const err = new Error(message);
    expect(isOperationalError(err)).toBe(false);
    const { deps: pauseDecisionDeps, workflowPaused } = pauseDeps();
    const workflowRunId = `run_lifecycle_failed_${kind}`;
    const paused = await handleOrchestrationError({
      err,
      workflowRunId,
      stage: 'build_test',
      workspacePath: '/tmp/worktree-cleaned',
      deps: pauseDecisionDeps,
    });
    const { deps, workflowCompleted, cleanup, setExitCode } = finalizationDeps();

    const result = await finalizeOrchestration({
      workflowRunId,
      workspacePath: '/tmp/worktree-cleaned',
      ok: false,
      paused,
      cleanupEnabled: true,
      setFailureExitCode: true,
      deps,
    });

    expect(paused).toBe(false);
    expect(workflowPaused).not.toHaveBeenCalled();
    expect(result).toEqual({ workflowRunId, ok: false, paused: false });
    expect(workflowCompleted).toHaveBeenCalledWith({ workflowRunId, ok: false });
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(setExitCode).toHaveBeenCalledWith(1);
  });
});

describe('operational step and graph failure evidence (R10)', () => {
  test('keeps failed states and adds operational evidence metadata', async () => {
    const stepFinished = vi.fn(async () => ({}));
    const finishedNode = { id: 'gnr_operational_failed' };
    const graphNodeFinished = vi.fn(async () => finishedNode);
    const deps: OrchestrationGraphFailureDeps = {
      stepFinished: stepFinished as unknown as OrchestrationGraphFailureDeps['stepFinished'],
      graphNodeFinished: graphNodeFinished as unknown as OrchestrationGraphFailureDeps['graphNodeFinished'],
    };

    const result = await recordGraphNodeFailure({
      err: new OperationalError('backend_protocol', 'implementation: missing diff outputs'),
      nodeRunId: 'gnr_started',
      stepRunId: 'step_implementation',
      stepCheckpointId: 'scp_implementation',
      resumeCursor: 'graph://implementation',
      deps,
    });

    expect(result).toBe(finishedNode);
    expect(stepFinished).toHaveBeenCalledWith({
      stepRunId: 'step_implementation',
      status: 'failed',
      failureReason: 'operational: implementation: missing diff outputs',
    });
    expect(graphNodeFinished).toHaveBeenCalledWith({
      nodeRunId: 'gnr_started',
      status: 'failed',
      stepRunId: 'step_implementation',
      stepCheckpointId: 'scp_implementation',
      resumeCursor: 'graph://implementation',
      metadata: {
        error: 'implementation: missing diff outputs',
        operational: true,
      },
    });
  });
});
