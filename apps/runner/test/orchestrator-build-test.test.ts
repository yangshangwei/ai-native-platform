import { describe, expect, test, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommandRun, StepRun } from '@ainp/shared';
import { executeBuildTest, executeImplementation, type StepDeps } from '../src/orchestrator/steps';
import type { RunCommandInput } from '../src/command-runner';
import { projectFixture, runCtxFixture, skillFixture } from './helpers/orchestrator-fixtures';

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
      mavenBuild: vi.fn(async (params: Record<string, unknown>) => {
        mavenBuildCalls.push(params);
        return {
          buildRun: { status: 'passed' },
          compileGate: { status: 'pass' },
          testGate: { status: 'pass' },
        };
      }),
    },
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
        runGate: vi.fn(async () => ({ gate: { status: 'pass' } })),
        stepFinished: vi.fn(async () => ({})),
        awaitHuman: vi.fn(async () => ({})),
      },
      mustSkill: vi.fn(async () => skillFixture('implementation')),
      invokeSkill: vi.fn(async () => ({
        task: { id: 'agtask_impl' },
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
    expect(deps.finishAgentSuccess).toHaveBeenCalledWith(
      expect.anything(),
      ['art_diff'],
      'implementation produced 2 changed file(s)',
    );
    expect(c.inputs.diff).toBe('diff --git a/src/app.ts b/src/app.ts\n');
  });
});
