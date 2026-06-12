import { describe, expect, test, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommandRun, StepRun } from '@ainp/shared';
import { executeBuildTest, type StepDeps } from '../src/orchestrator/steps';
import type { RunCommandInput } from '../src/command-runner';
import { projectFixture, runCtxFixture } from './helpers/orchestrator-fixtures';

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
});
