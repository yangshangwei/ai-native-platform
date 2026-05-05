/**
 * ClaudeCodeBackend post-result grace shutdown test (Issue 1 fix).
 *
 * Validates that when the Claude Code CLI emits its `result` event but
 * doesn't terminate (the failure mode documented in
 * `CodeStable/issues/2026-05-05-claude-code-implementation-no-exit/`),
 * the runner actively SIGTERMs the child within `postResultGraceMs` and
 * reports `exitCode = 0` because the assistant work was completed
 * successfully.
 *
 * Without this fix, the runner waited the full `DEFAULT_TIMEOUT_MS`
 * (10 minutes) before killing the hung process and reporting failure.
 */
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SkillSpec } from '@ainp/shared';
import { api } from '../src/api-client';
import { ClaudeCodeBackend } from '../src/agents/claude-code';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ClaudeCodeBackend post-result grace shutdown', () => {
  it('terminates and reports success when CLI hangs after emitting result', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ainp-claude-grace-'));
    const workspacePath = join(root, 'workspace');
    const artifactsDir = join(root, 'artifacts');
    mkdirSync(workspacePath, { recursive: true });
    mkdirSync(artifactsDir, { recursive: true });

    vi.spyOn(api, 'postAgentEvent').mockResolvedValue({ ok: true });

    const start = Date.now();
    const backend = new ClaudeCodeBackend({
      bin: hangAfterResultBin(root),
      timeoutMs: 30_000, // far above grace; must NOT be the bottleneck
      postResultGraceMs: 200,
    });

    const result = await backend.run(implementationSkill(), {
      workflowRunId: 'run_hang_test',
      stepRunId: 'step_hang_test',
      workspacePath,
      branch: 'main',
      title: 'exercise grace shutdown',
      artifactsDir,
      inputs: {},
    });

    const elapsedMs = Date.now() - start;

    // Should have terminated within ~grace + small overhead, NOT 30 seconds.
    expect(elapsedMs).toBeLessThan(5_000);
    expect(result.outputs.length).toBeGreaterThanOrEqual(1);
  });

  it('reports failure when CLI hangs without ever emitting result', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ainp-claude-no-result-'));
    const workspacePath = join(root, 'workspace');
    const artifactsDir = join(root, 'artifacts');
    mkdirSync(workspacePath, { recursive: true });
    mkdirSync(artifactsDir, { recursive: true });

    vi.spyOn(api, 'postAgentEvent').mockResolvedValue({ ok: true });

    const backend = new ClaudeCodeBackend({
      bin: hangNoResultBin(root),
      timeoutMs: 300, // hard timeout fires; no result was seen
      postResultGraceMs: 5_000,
    });

    await expect(
      backend.run(implementationSkill(), {
        workflowRunId: 'run_no_result_test',
        stepRunId: 'step_no_result_test',
        workspacePath,
        branch: 'main',
        title: 'exercise hard timeout',
        artifactsDir,
        inputs: {},
      }),
    ).rejects.toThrow(/claude exited/);
  });
});

function implementationSkill(): SkillSpec {
  return {
    id: 'test-implementation',
    version: '1.0.0',
    stage: 'implementation',
    instructions: 'Return without editing files.',
    inputs: [],
    outputs: [],
    toolPolicy: {
      allowedCommands: [],
      writableGlobs: ['**/*'],
      networkAllowed: false,
    },
    requiredGates: [],
    compatibleBackends: ['claude_code'],
  };
}

/**
 * Fake `claude` written in Node.js: prints a successful `result` event
 * and then idles via `setInterval` so the process keeps running until a
 * signal arrives.
 *
 * No explicit SIGTERM handler — Node's default signal disposition is to
 * terminate, which is what we want. The parent then observes
 * `{ code: null, signal: 'SIGTERM' }` and the runner reconciles:
 *   - `result` was seen with subtype=success
 *   - graceShutdownInitiated is true (we sent the SIGTERM)
 *   - hard timeout did NOT fire
 *   → effective exitCode = 0
 *
 * This mimics the failure mode reported in
 * `2026-05-05-claude-code-implementation-no-exit`: the assistant work is
 * complete (result event emitted) but the process keeps running.
 */
function hangAfterResultBin(dir: string): string {
  const bin = join(dir, 'claude-hang-after-result.mjs');
  writeFileSync(
    bin,
    [
      '#!/usr/bin/env node',
      `console.log(JSON.stringify({type:'result',subtype:'success',result:'done',duration_ms:1,total_cost_usd:0}));`,
      `setInterval(() => {}, 60000);`,
      '',
    ].join('\n'),
    'utf8',
  );
  chmodSync(bin, 0o755);
  return bin;
}

/**
 * Fake `claude` that idles without ever emitting a result — exercises the
 * hard-timeout code path. Same default SIGTERM disposition.
 */
function hangNoResultBin(dir: string): string {
  const bin = join(dir, 'claude-hang-no-result.mjs');
  writeFileSync(
    bin,
    [
      '#!/usr/bin/env node',
      `setInterval(() => {}, 60000);`,
      '',
    ].join('\n'),
    'utf8',
  );
  chmodSync(bin, 0o755);
  return bin;
}
