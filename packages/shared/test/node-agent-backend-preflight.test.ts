import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  preflightAgentBackend,
  preflightTimeoutMs,
  runCli,
  runFirstSuccessfulCli,
} from '../src/node/agent-backend-preflight';

const ORIGINAL_CODEX_BIN = process.env.AINP_CODEX_BIN;
const ORIGINAL_TIMEOUT_MS = process.env.AINP_AGENT_PREFLIGHT_TIMEOUT_MS;

afterEach(() => {
  restoreEnv('AINP_CODEX_BIN', ORIGINAL_CODEX_BIN);
  restoreEnv('AINP_AGENT_PREFLIGHT_TIMEOUT_MS', ORIGINAL_TIMEOUT_MS);
});

describe('runCli', () => {
  it('captures exit code, stdout and stderr from a real subprocess', async () => {
    const result = await runCli('sh', ['-c', 'printf out; printf err >&2; exit 3']);

    expect(result).toEqual({ exitCode: 3, stdout: 'out', stderr: 'err', timedOut: false, error: null });
  });

  it('pipes stdin to the subprocess when provided', async () => {
    const result = await runCli('sh', ['-c', 'cat'], { stdin: 'ping' });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('ping');
  });

  it('reports a spawn error for a missing binary instead of throwing', async () => {
    const result = await runCli(join(tmpdir(), 'ainp-no-such-bin'), ['--version']);

    expect(result.exitCode).toBeNull();
    expect(result.error).toBeTruthy();
    expect(result.timedOut).toBe(false);
  });

  it('kills subprocesses that exceed the timeout', async () => {
    const result = await runCli('sh', ['-c', 'sleep 5'], { timeoutMs: 100 });

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });
});

describe('runFirstSuccessfulCli', () => {
  it('returns the first candidate whose run exits 0', async () => {
    const bin = fakeBin('if [ "$1" = "--version" ]; then echo "codex 0.0.0"; exit 0; fi\nexit 2');
    process.env.AINP_CODEX_BIN = bin;

    const run = await runFirstSuccessfulCli('codex', ['--version'], { timeoutMs: 4_000 });

    expect(run.ok).toBe(true);
    expect(run.bin).toBe(bin);
    expect(run.result.stdout).toContain('codex 0.0.0');
  });

  it('reports the first failure when no candidate succeeds', async () => {
    const bin = fakeBin('exit 7');
    process.env.AINP_CODEX_BIN = bin;

    const run = await runFirstSuccessfulCli('codex', ['--version'], { timeoutMs: 4_000 });

    expect(run.ok).toBe(false);
    expect(run.bin).toBe(bin);
    expect(run.result.exitCode).toBe(7);
  });
});

describe('preflightAgentBackend', () => {
  it('returns not_configured without spawning when backend is null or undefined', async () => {
    for (const backend of [null, undefined]) {
      const preflight = await preflightAgentBackend(backend);
      expect(preflight.status).toBe('not_configured');
      expect(preflight.backend).toBeNull();
      expect(preflight.installed).toBe(false);
    }
  });
});

describe('preflightTimeoutMs', () => {
  it('reads a positive override from the environment', () => {
    process.env.AINP_AGENT_PREFLIGHT_TIMEOUT_MS = '2500';
    expect(preflightTimeoutMs()).toBe(2_500);
  });

  it('falls back to the default for unset, non-numeric, or non-positive values', () => {
    delete process.env.AINP_AGENT_PREFLIGHT_TIMEOUT_MS;
    expect(preflightTimeoutMs()).toBe(12_000);

    process.env.AINP_AGENT_PREFLIGHT_TIMEOUT_MS = 'abc';
    expect(preflightTimeoutMs()).toBe(12_000);

    process.env.AINP_AGENT_PREFLIGHT_TIMEOUT_MS = '-5';
    expect(preflightTimeoutMs()).toBe(12_000);
  });
});

function fakeBin(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ainp-preflight-shell-'));
  const bin = join(dir, 'codex');
  writeFileSync(bin, `#!/bin/sh\n${script}\n`, 'utf8');
  chmodSync(bin, 0o755);
  return bin;
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
