import { describe, expect, test, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isOperationalError, type CommandRun, type StepRun, type TestSurfaceReport } from '@ainp/shared';
import {
  finalizeOrchestration,
  handleOrchestrationError,
  type OperationalPauseDeps,
  type OrchestrationFinalizationDeps,
} from '../src/orchestrator';
import { executeBuildTest, executeImplementation, type StepDeps } from '../src/orchestrator/steps';
import type { RunCommandInput } from '../src/command-runner';
import { projectFixture, runCtxFixture, skillFixture } from './helpers/orchestrator-fixtures';

const EMPTY_SURFACE_REPORT: TestSurfaceReport = {
  schemaVersion: 'test-surface-report/v1',
  baseRef: 'a'.repeat(40),
  files: [],
  harness: { changedPaths: [], pomTestConfigChanged: false },
  baselineAvailable: true,
  notes: [],
};

// ---------------------------------------------------------------------------
// T3.2 build-command de-hardcoding: executeBuildTest gets its first direct
// unit tests (StepDeps fully stubbed). Pins:
//   - default Maven fallback emits byte-for-byte the historical commands and
//     no project-level extraAllow entries;
//   - mvnw detection still picks ./mvnw on the default path;
//   - custom project commands replace the defaults and are passed to
//     runWhitelistedCommand as exact-match extraAllow entries (the whitelist
//     gate itself stays inside command-runner).
// ---------------------------------------------------------------------------

function buildTestDeps() {
  const commandInputs: RunCommandInput[] = [];
  const mavenBuildCalls: Array<Record<string, unknown>> = [];
  const deps = {
    api: {
      stepStarted: vi.fn(async () => ({ step: { id: 'step_bt' } as unknown as StepRun })),
      stepFinished: vi.fn(async () => ({})),
      commandRun: vi.fn(async () => ({})),
      toolInvocation: vi.fn(async () => ({})),
      postArtifact: vi.fn(async (params: { metadata?: Record<string, unknown> }) => ({
        id: params.metadata?.reportKind === 'handoff_debugger_input'
          ? 'art_debugger_input'
          : 'art_debugger_analysis',
      })),
      recordHandoff: vi.fn(async () => ({})),
      runGate: vi.fn(async () => ({ gate: { status: 'pass', ruleResults: [] } })),
      mavenBuild: vi.fn(async (params: Record<string, unknown>) => {
        mavenBuildCalls.push(params);
        return {
          buildRun: { status: 'passed' },
          compileGate: { status: 'pass' },
          testGate: { status: 'pass' },
        };
      }),
    },
    collectTestSurfaceReport: vi.fn(async () => EMPTY_SURFACE_REPORT),
    runWhitelistedCommand: vi.fn(async (input: RunCommandInput) => {
      commandInputs.push(input);
      return {
        id: `cmd_${input.stage}`,
        command: input.command,
        stage: input.stage,
        status: 'passed',
        exitCode: 0,
        finishedAt: '2026-06-27T00:00:01.000Z',
        durationMs: 1,
        combinedSha256: `digest_${input.stage}`,
      } as unknown as CommandRun;
    }),
    collectReports: vi.fn(async () => []),
  };
  return { deps: deps as unknown as StepDeps, raw: deps, commandInputs, mavenBuildCalls };
}

async function expectHistoricalBusinessFailure(params: {
  execute: () => Promise<void>;
  c: ReturnType<typeof runCtxFixture>;
  stage: 'implementation' | 'build_test';
}): Promise<Error> {
  let caught: unknown;
  try {
    await params.execute();
  } catch (err) {
    caught = err;
  }

  expect(caught).toBeInstanceOf(Error);
  expect(isOperationalError(caught)).toBe(false);
  expect(params.c.ok.value).toBe(false);

  const workflowPaused = vi.fn(async () => ({}));
  const paused = await handleOrchestrationError({
    err: caught,
    workflowRunId: params.c.run.id,
    stage: params.stage,
    workspacePath: params.c.workspace.path,
    deps: {
      workflowPaused: workflowPaused as unknown as OperationalPauseDeps['workflowPaused'],
      isWorkflowPaused: vi.fn(async () => false),
      resolveWorktreeHead: vi.fn(async () => 'business-head'),
      log: vi.fn(),
    },
  });
  expect(paused).toBe(false);
  expect(workflowPaused).not.toHaveBeenCalled();

  const workflowCompleted = vi.fn(async () => ({}));
  const cleanup = vi.fn(async () => {});
  const setExitCode = vi.fn();
  const result = await finalizeOrchestration({
    workflowRunId: params.c.run.id,
    workspacePath: params.c.workspace.path,
    ok: params.c.ok.value,
    paused,
    cleanupEnabled: true,
    setFailureExitCode: true,
    deps: {
      workflowCompleted: workflowCompleted as unknown as OrchestrationFinalizationDeps['workflowCompleted'],
      cleanup,
      setExitCode,
      log: vi.fn(),
    },
  });

  expect(result).toEqual({
    workflowRunId: params.c.run.id,
    ok: false,
    paused: false,
    autoReworkStage: null,
  });
  expect(workflowCompleted).toHaveBeenCalledWith({ workflowRunId: params.c.run.id, ok: false });
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(setExitCode).toHaveBeenCalledWith(1);
  return caught as Error;
}

describe('executeBuildTest (T3.2 command source)', () => {
  test('default path without custom commands keeps the historical mvn commands and empty extraAllow', async () => {
    const { deps, raw, commandInputs, mavenBuildCalls } = buildTestDeps();
    const c = runCtxFixture(); // workspace.path has no mvnw → plain mvn

    await executeBuildTest(c, deps);

    expect(commandInputs.map((i) => [i.command, i.stage])).toEqual([
      ['mvn -B -DskipTests compile', 'compile'],
      ['mvn -B test', 'test'],
    ]);
    for (const input of commandInputs) {
      expect(input.extraAllow).toEqual([]);
    }
    expect(raw.api.stepStarted).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'build_test', name: 'mvn -B test' }),
    );
    expect(mavenBuildCalls[0]).toMatchObject({
      mavenCommand: 'mvn -B -DskipTests compile && mvn -B test',
      jdkVersion: null,
      compileCommandRunId: 'cmd_compile',
      testCommandRunId: 'cmd_test',
      reports: [],
    });
    expect(raw.api.stepFinished).toHaveBeenCalledWith({ stepRunId: 'step_bt', status: 'passed' });
    // Test Integrity Gate: surface report artifact + gate run before Maven.
    expect(raw.collectTestSurfaceReport).toHaveBeenCalledWith(c.workspace.path);
    expect(raw.api.postArtifact).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'test_surface_report',
      contentType: 'application/json',
      metadata: expect.objectContaining({
        schemaVersion: 'test-surface-report/v1',
        baselineAvailable: true,
        output: 'test-surface-report.json',
      }),
    }));
    expect(raw.api.runGate).toHaveBeenCalledWith(expect.objectContaining({
      gateId: 'test_integrity_gate',
      stepRunId: 'step_bt',
    }));
    expect(raw.api.toolInvocation).toHaveBeenCalledTimes(2);
    expect(raw.api.toolInvocation).toHaveBeenNthCalledWith(1, expect.objectContaining({
      toolId: 'runner.command',
      status: 'success',
      permissionDecision: 'allowed',
      resultRefs: [expect.objectContaining({
        kind: 'command_run',
        id: 'cmd_compile',
        digest: 'digest_compile',
      })],
    }));
    expect(c.ok.value).toBe(true);
  });

  test('default path picks ./mvnw when the workspace has a wrapper', async () => {
    const { deps, commandInputs } = buildTestDeps();
    const workspace = mkdtempSync(join(tmpdir(), 'ainp-bt-mvnw-'));
    writeFileSync(join(workspace, 'mvnw'), '#!/bin/sh\n', 'utf8');
    const c = runCtxFixture();
    c.workspace.path = workspace;

    await executeBuildTest(c, deps);

    expect(commandInputs.map((i) => i.command)).toEqual([
      './mvnw -B -DskipTests compile',
      './mvnw -B test',
    ]);
  });

  test('custom project commands replace the defaults and ride in as exact-match extraAllow', async () => {
    const { deps, raw, commandInputs, mavenBuildCalls } = buildTestDeps();
    const c = runCtxFixture({
      project: {
        ...projectFixture(),
        buildCompileCommand: 'gradle assemble',
        buildTestCommand: 'gradle test',
      },
    });

    await executeBuildTest(c, deps);

    expect(commandInputs.map((i) => [i.command, i.stage])).toEqual([
      ['gradle assemble', 'compile'],
      ['gradle test', 'test'],
    ]);
    for (const input of commandInputs) {
      expect(input.extraAllow).toEqual(['gradle assemble', 'gradle test']);
    }
    expect(raw.api.stepStarted).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'build_test', name: 'gradle test' }),
    );
    expect(mavenBuildCalls[0]).toMatchObject({
      mavenCommand: 'gradle assemble && gradle test',
    });
  });

  test('partial custom config: only the test command is overridden, compile falls back to Maven', async () => {
    const { deps, commandInputs } = buildTestDeps();
    const c = runCtxFixture({
      project: { ...projectFixture(), buildTestCommand: 'npm test' },
    });

    await executeBuildTest(c, deps);

    expect(commandInputs.map((i) => i.command)).toEqual(['mvn -B -DskipTests compile', 'npm test']);
    for (const input of commandInputs) {
      expect(input.extraAllow).toEqual(['npm test']);
    }
  });

  test('compile command failure remains a historical business failure', async () => {
    const { deps, raw } = buildTestDeps();
    raw.runWhitelistedCommand.mockResolvedValueOnce({
      id: 'cmd_compile_failed',
      command: 'mvn -B -DskipTests compile',
      stage: 'compile',
      status: 'failed',
      exitCode: 1,
      finishedAt: '2026-07-27T00:00:01.000Z',
      durationMs: 1,
      combinedSha256: 'digest_compile_failed',
    } as unknown as CommandRun);
    const c = runCtxFixture({
      runArtifactsDir: mkdtempSync(join(tmpdir(), 'ainp-bt-compile-failed-')),
    });

    const error = await expectHistoricalBusinessFailure({
      execute: () => executeBuildTest(c, deps),
      c,
      stage: 'build_test',
    });

    expect(error.message).toBe('compile command failed');
  });

  test('test gate failure records debugger handoff evidence without applying a fix', async () => {
    const { deps, raw } = buildTestDeps();
    raw.api.mavenBuild.mockResolvedValueOnce({
      buildRun: { status: 'failed' },
      compileGate: { status: 'pass' },
      testGate: { status: 'fail' },
    });
    const c = runCtxFixture({
      runArtifactsDir: mkdtempSync(join(tmpdir(), 'ainp-bt-debugger-')),
    });

    const error = await expectHistoricalBusinessFailure({
      execute: () => executeBuildTest(c, deps),
      c,
      stage: 'build_test',
    });

    expect(error.message).toBe('test_gate failed');
    expect(raw.api.postArtifact).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'other',
      contentType: 'application/json',
      metadata: expect.objectContaining({
        reportKind: 'handoff_debugger_input',
        phase: 'test_gate',
      }),
    }));
    expect(raw.api.postArtifact).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'other',
      contentType: 'text/markdown',
      metadata: expect.objectContaining({
        reportKind: 'handoff_debugger_analysis',
        noAutoFixApplied: true,
      }),
    }));
    expect(raw.api.recordHandoff).toHaveBeenCalledWith(expect.objectContaining({
      fromRole: 'main',
      toRole: 'debugger',
      status: 'completed',
      adoptionDecision: 'needs_review',
      inputArtifactIds: ['art_debugger_input'],
      outputArtifactIds: ['art_debugger_analysis'],
      metadata: expect.objectContaining({
        noAutoFixApplied: true,
        compileCommandRunId: 'cmd_compile',
        testCommandRunId: 'cmd_test',
      }),
    }));
    expect(c.ok.value).toBe(false);
    expect(raw.api.stepFinished).toHaveBeenCalledWith({
      stepRunId: 'step_bt',
      status: 'failed',
      failureReason: 'compile_gate=pass test_gate=fail',
    });
  });

  test('test_integrity_gate failure aborts the step before any Maven command spawns', async () => {
    const { deps, raw, commandInputs } = buildTestDeps();
    raw.api.runGate.mockResolvedValueOnce({
      gate: {
        status: 'fail',
        ruleResults: [
          {
            ruleId: 'integrity.test_files_deleted',
            status: 'fail',
            message: 'test file(s) deleted: src/test/java/sample/CalculatorTest.java',
            evidenceRefs: [],
          },
        ],
      },
    });
    const c = runCtxFixture({
      runArtifactsDir: mkdtempSync(join(tmpdir(), 'ainp-bt-integrity-')),
    });

    await expect(executeBuildTest(c, deps)).rejects.toThrow('test_integrity_gate failed');

    // AC-008: gate fail happens before compile — no command was spawned.
    expect(commandInputs).toEqual([]);
    expect(raw.api.mavenBuild).not.toHaveBeenCalled();
    expect(c.ok.value).toBe(false);
    expect(raw.api.stepFinished).toHaveBeenCalledWith({
      stepRunId: 'step_bt',
      status: 'failed',
      failureReason:
        'test_integrity_gate failed: test file(s) deleted: src/test/java/sample/CalculatorTest.java',
    });
  });

  test('denied command records a denied ToolInvocation without posting CommandRun', async () => {
    const { deps, raw } = buildTestDeps();
    raw.runWhitelistedCommand.mockRejectedValueOnce(new Error('command not on whitelist: rm -rf /'));
    const c = runCtxFixture({
      project: {
        ...projectFixture(),
        buildCompileCommand: 'rm -rf /',
        buildTestCommand: 'npm test',
      },
    });

    await expect(executeBuildTest(c, deps)).rejects.toThrow('command not on whitelist');

    expect(raw.api.commandRun).not.toHaveBeenCalled();
    expect(raw.api.toolInvocation).toHaveBeenCalledWith(expect.objectContaining({
      toolId: 'runner.command',
      status: 'denied',
      permissionDecision: 'denied',
      resultRefs: [],
      error: 'command not on whitelist: rm -rf /',
    }));
  });
});

describe('executeImplementation ToolInvocation evidence', () => {
  test('records git diff capture with diff artifact evidence and changed-file metadata', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'ainp-impl-tool-'));
    const diffPath = join(workspace, 'diff.patch');
    const changedFilesPath = join(workspace, 'changed-files.txt');
    writeFileSync(diffPath, 'diff --git a/src/app.ts b/src/app.ts\n', 'utf8');
    writeFileSync(changedFilesPath, 'src/app.ts\nsrc/app.test.ts\n', 'utf8');
    const c = runCtxFixture({
      workspace: {
        workflowRunId: 'run_orch',
        path: workspace,
        branch: 'ai/run-1',
        environmentKind: 'trusted_local_worktree',
      },
      runArtifactsDir: workspace,
    });
    const deps = {
      api: {
        stepStarted: vi.fn(async () => ({ step: { id: 'step_impl' } as unknown as StepRun })),
        postArtifact: vi.fn(async () => ({
          id: 'art_diff',
          sha256: 'diff_sha',
        })),
        toolInvocation: vi.fn(async () => ({})),
        stepCheckpoint: vi.fn(async () => ({ checkpoint: { id: 'scp_impl' } })),
        runGate: vi.fn(async () => ({ gate: { status: 'pass' } })),
        stepFinished: vi.fn(async () => ({})),
        awaitHuman: vi.fn(async () => ({})),
      },
      mustSkill: vi.fn(async () => skillFixture('implementation')),
      invokeSkill: vi.fn(async () => ({
        taskId: 'agtask_impl',
        sessionId: 'ags_impl',
        invocationId: 'ctxinv_impl',
        contextPackArtifactId: 'art_ctxpack_impl',
        contextPack: { id: 'ctxpack_impl' },
        contextRequest: null,
        outputs: [
          { name: 'diff', path: diffPath, size: 36, contentType: 'text/x-diff' },
          { name: 'changed-files', path: changedFilesPath, size: 23, contentType: 'text/plain' },
        ],
      })),
      finishAgentSuccess: vi.fn(async () => ({})),
      enforceSensitiveChangeCheckpoint: vi.fn(async () => ({})),
      awaitApproval: vi.fn(async () => ({})),
      postRejectionFeedback: vi.fn(async () => ({})),
    };

    await executeImplementation(c, deps as unknown as StepDeps);

    expect(deps.api.postArtifact).toHaveBeenCalledWith(expect.objectContaining({
      workflowRunId: 'run_orch',
      stepRunId: 'step_impl',
      kind: 'diff',
      metadata: { changedFilesPath },
    }));
    expect(deps.api.toolInvocation).toHaveBeenCalledWith(expect.objectContaining({
      workflowRunId: 'run_orch',
      stepRunId: 'step_impl',
      toolId: 'runner.git_diff_capture',
      status: 'success',
      permissionDecision: 'not_required',
      resultRefs: [expect.objectContaining({
        kind: 'artifact',
        id: 'art_diff',
        digest: 'diff_sha',
      })],
      metadata: expect.objectContaining({
        diffPath,
        changedFilesPath,
        changedFileCount: 2,
        changedFiles: ['src/app.ts', 'src/app.test.ts'],
      }),
    }));
    expect(deps.api.stepCheckpoint).toHaveBeenNthCalledWith(1, expect.objectContaining({
      workflowRunId: 'run_orch',
      stepRunId: 'step_impl',
      stage: 'implementation',
      status: 'running',
      metadata: expect.objectContaining({ stageContextPhase: 'start' }),
    }));
    expect(deps.api.stepCheckpoint).toHaveBeenNthCalledWith(2, expect.objectContaining({
      workflowRunId: 'run_orch',
      stepRunId: 'step_impl',
      stage: 'implementation',
      status: 'passed',
      outputArtifactIds: ['art_diff'],
      contextPackId: 'ctxpack_impl',
      agentSessionIds: ['ags_impl'],
      metadata: expect.objectContaining({ stageContextPhase: 'finish' }),
    }));
    expect(deps.finishAgentSuccess).toHaveBeenCalledWith(
      expect.anything(),
      ['art_diff'],
      'implementation produced 2 changed file(s)',
    );
    expect(c.inputs.diff).toBe('diff --git a/src/app.ts b/src/app.ts\n');
  });

  test('diff_scope gate failure remains a historical business failure', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'ainp-impl-diff-scope-failed-'));
    const diffPath = join(workspace, 'diff.patch');
    const changedFilesPath = join(workspace, 'changed-files.txt');
    writeFileSync(diffPath, 'diff --git a/README.md b/README.md\n', 'utf8');
    writeFileSync(changedFilesPath, 'README.md\n', 'utf8');
    const c = runCtxFixture({
      workspace: {
        workflowRunId: 'run_orch',
        path: workspace,
        branch: 'ai/run-1',
        environmentKind: 'trusted_local_worktree',
      },
      runArtifactsDir: workspace,
    });
    const deps = {
      api: {
        stepStarted: vi.fn(async () => ({ step: { id: 'step_impl_diff_scope' } as unknown as StepRun })),
        postArtifact: vi.fn(async () => ({ id: 'art_diff_scope', sha256: 'diff_scope_sha' })),
        toolInvocation: vi.fn(async () => ({})),
        stepCheckpoint: vi.fn(async () => ({ checkpoint: { id: 'scp_impl_diff_scope' } })),
        runGate: vi.fn(async (params: { gateId: string }) => ({
          gate: { status: params.gateId === 'diff_scope_gate' ? 'fail' : 'pass' },
        })),
        stepFinished: vi.fn(async () => ({})),
        awaitHuman: vi.fn(async () => ({})),
      },
      mustSkill: vi.fn(async () => skillFixture('implementation')),
      invokeSkill: vi.fn(async () => ({
        taskId: 'agtask_impl_diff_scope',
        sessionId: 'ags_impl_diff_scope',
        invocationId: 'ctxinv_impl_diff_scope',
        contextPackArtifactId: 'art_ctxpack_impl_diff_scope',
        contextPack: { id: 'ctxpack_impl_diff_scope' },
        contextRequest: null,
        outputs: [
          { name: 'diff', path: diffPath, size: 36, contentType: 'text/x-diff' },
          { name: 'changed-files', path: changedFilesPath, size: 10, contentType: 'text/plain' },
        ],
      })),
      finishAgentSuccess: vi.fn(async () => ({})),
      enforceSensitiveChangeCheckpoint: vi.fn(async () => ({})),
      awaitApproval: vi.fn(async () => ({})),
      postRejectionFeedback: vi.fn(async () => ({})),
    };

    const error = await expectHistoricalBusinessFailure({
      execute: () => executeImplementation(c, deps as unknown as StepDeps),
      c,
      stage: 'implementation',
    });

    expect(error.message).toBe('diff_scope_gate failed; aborting');
    expect(deps.api.runGate).toHaveBeenCalledWith(expect.objectContaining({ gateId: 'diff_scope_gate' }));
    expect(deps.api.stepFinished).toHaveBeenCalledWith({
      stepRunId: 'step_impl_diff_scope',
      status: 'failed',
      failureReason: 'diff_scope_gate failed; aborting',
    });
  });
});
