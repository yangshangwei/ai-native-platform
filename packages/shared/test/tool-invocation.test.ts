import { expect, test } from 'vitest';
import {
  RUNNER_TOOL_SPECS,
  isRunnerToolId,
  isToolInvocationStatus,
  type ToolInvocation,
} from '../src';

test('ToolInvocation shared contract enumerates runner-owned MVP tools', () => {
  expect(isRunnerToolId('runner.command')).toBe(true);
  expect(isRunnerToolId('runner.git_diff_capture')).toBe(true);
  expect(isRunnerToolId('backend.native_tool_call')).toBe(false);
  expect(RUNNER_TOOL_SPECS['runner.command']).toMatchObject({
    sideEffect: 'external_process',
    permissionTier: 'whitelist',
  });
});

test('ToolInvocation status guard rejects unknown trust-boundary values', () => {
  expect(isToolInvocationStatus('success')).toBe(true);
  expect(isToolInvocationStatus('denied')).toBe(true);
  expect(isToolInvocationStatus('skipped')).toBe(false);
});

test('ToolInvocation can link a command run and digest evidence without replacing it', () => {
  const invocation: ToolInvocation = {
    id: 'tinv_1',
    workflowRunId: 'run_1',
    stepRunId: 'step_1',
    toolId: 'runner.command',
    toolName: RUNNER_TOOL_SPECS['runner.command'].name,
    schemaVersion: RUNNER_TOOL_SPECS['runner.command'].schemaVersion,
    status: 'success',
    sideEffect: 'external_process',
    permissionTier: 'whitelist',
    permissionDecision: 'allowed',
    argumentsDigest: 'abc123',
    resultRefs: [{
      kind: 'command_run',
      id: 'cmd_1',
      digest: 'digest_1',
      claim: 'command completed with digest-backed logs',
    }],
    startedAt: '2026-06-27T00:00:00.000Z',
    completedAt: '2026-06-27T00:00:01.000Z',
    durationMs: 1000,
    error: null,
    metadata: { command: 'bun test' },
  };

  expect(invocation.resultRefs[0]?.kind).toBe('command_run');
  expect(invocation.resultRefs[0]?.digest).toBe('digest_1');
});
