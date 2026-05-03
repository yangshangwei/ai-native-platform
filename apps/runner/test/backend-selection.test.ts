import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { newId, nowIso, type Project } from '@ainp/shared';

const ORIGINAL_CODEX_BIN = process.env.AINP_CODEX_BIN;
const ORIGINAL_CLAUDE_BIN = process.env.AINP_CLAUDE_BIN;
const ORIGINAL_AGENT_BACKEND = process.env.AINP_AGENT_BACKEND;

afterEach(() => {
  restoreEnv('AINP_CODEX_BIN', ORIGINAL_CODEX_BIN);
  restoreEnv('AINP_CLAUDE_BIN', ORIGINAL_CLAUDE_BIN);
  restoreEnv('AINP_AGENT_BACKEND', ORIGINAL_AGENT_BACKEND);
});

describe('runner backend selection', () => {
  it('selects the project Codex backend after login status preflight', async () => {
    const { selectAgentBackend } = await import('../src/backend-selection');
    const bin = fakeCodexBin({ loginStatus: 'logged_in' });
    process.env.AINP_CODEX_BIN = bin;

    const backend = await selectAgentBackend(project({ agentBackend: 'codex' }));

    expect(backend.kind).toBe('codex');
    expect(runtimeBin(backend)).toBe(bin);
  });

  it('classifies Codex logged-out login status as needs_login without secret dumps', async () => {
    const { preflightAgentBackend } = await import('../src/agent-backend-preflight');
    process.env.AINP_CODEX_BIN = fakeCodexBin({ loginStatus: 'logged_out' });

    const preflight = await preflightAgentBackend('codex');

    expect(preflight.status).toBe('needs_login');
    expect(preflight.error).toContain('not logged in');
    expect(preflight.error?.length).toBeLessThan(700);
    expect(preflight.error).not.toContain('sk-test-codex-secret');
  });

  it('classifies invalid Codex login status output as not_runnable with compact masked output', async () => {
    const { preflightAgentBackend } = await import('../src/agent-backend-preflight');
    process.env.AINP_CODEX_BIN = fakeCodexBin({ loginStatus: 'invalid' });

    const preflight = await preflightAgentBackend('codex');

    expect(preflight.status).toBe('not_runnable');
    expect(preflight.error).toContain('not recognized');
    expect(preflight.error).toContain('sk-[redacted]');
    expect(preflight.error?.length).toBeLessThan(700);
    expect(preflight.remediationHint).toContain('login status');
    expect(preflight.error).not.toContain('sk-test-codex-secret');
  });

  it('fails fast when Codex login status is not runnable', async () => {
    const { selectAgentBackend } = await import('../src/backend-selection');
    process.env.AINP_CODEX_BIN = fakeCodexBin({ loginStatus: 'invalid' });

    await expect(selectAgentBackend(project({ agentBackend: 'codex' }))).rejects.toThrow(/login status output was not recognized/);
  });

  it('fails fast when a project has no real backend configured', async () => {
    const { selectAgentBackend } = await import('../src/backend-selection');

    await expect(selectAgentBackend(project({ agentBackend: null }))).rejects.toThrow(/no Agent Backend configured/);
  });

  it('does not use runner env as a per-run or fallback backend selection', async () => {
    const { selectAgentBackend } = await import('../src/backend-selection');
    process.env.AINP_AGENT_BACKEND = 'codex';

    await expect(selectAgentBackend(project({ agentBackend: null }))).rejects.toThrow(/no Agent Backend configured/);
  });

  it('selects the project Claude Code backend after auth status preflight', async () => {
    const { selectAgentBackend } = await import('../src/backend-selection');
    const bin = fakeClaudeBin({ loggedIn: true });
    process.env.AINP_CLAUDE_BIN = bin;

    const backend = await selectAgentBackend(project({ agentBackend: 'claude_code' }));

    expect(backend.kind).toBe('claude_code');
    expect(runtimeBin(backend)).toBe(bin);
  });

  it('classifies Claude Code loggedOut auth status as needs_login without prompt dumps', async () => {
    const { preflightAgentBackend } = await import('../src/agent-backend-preflight');
    process.env.AINP_CLAUDE_BIN = fakeClaudeBin({ loggedIn: false });

    const preflight = await preflightAgentBackend('claude_code');

    expect(preflight.status).toBe('needs_login');
    expect(preflight.error).toContain('loggedIn=false');
    expect(preflight.error?.length).toBeLessThan(700);
    expect(preflight.error).not.toContain('plugins');
    expect(preflight.error).not.toContain('/Users/artisan');
    expect(preflight.error).not.toContain('AINP_PREFLIGHT_OK');
  });

  it('classifies invalid Claude Code auth status JSON as not_runnable with compact output', async () => {
    const { preflightAgentBackend } = await import('../src/agent-backend-preflight');
    process.env.AINP_CLAUDE_BIN = fakeClaudeInvalidAuthStatusBin();

    const preflight = await preflightAgentBackend('claude_code');

    expect(preflight.status).toBe('not_runnable');
    expect(preflight.error).toContain('invalid_json');
    expect(preflight.error?.length).toBeLessThan(700);
  });
});

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: newId('proj'),
    name: 'backend-selection-test',
    localPath: '/tmp/backend-selection-test',
    language: 'java',
    buildTool: 'maven',
    defaultBranch: 'main',
    registeredAt: nowIso(),
    ...overrides,
  };
}

function runtimeBin(backend: unknown): string | undefined {
  return (backend as { opts?: { bin?: string } }).opts?.bin;
}

function fakeCodexBin(opts: { loginStatus: 'logged_in' | 'logged_out' | 'invalid' }): string {
  const dir = mkdtempSync(join(tmpdir(), 'ainp-fake-codex-'));
  const bin = join(dir, 'codex');
  const loginLine = opts.loginStatus === 'logged_in'
    ? 'Logged in using an API key - sk-test-codex-secret'
    : opts.loginStatus === 'logged_out'
      ? 'Not logged in'
      : 'Codex status unknown: sk-test-codex-secret';
  writeFileSync(bin, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "codex 1.2.3"; exit 0; fi',
    `if [ "$1" = "login" ] && [ "$2" = "status" ]; then printf '%s\\n' '${loginLine}'; exit 0; fi`,
    'echo "unexpected args: $@" >&2',
    'exit 2',
    '',
  ].join('\n'), 'utf8');
  chmodSync(bin, 0o755);
  return bin;
}

function fakeClaudeBin(opts: { loggedIn: boolean }): string {
  const dir = mkdtempSync(join(tmpdir(), 'ainp-fake-claude-'));
  const bin = join(dir, 'claude');
  const authPayload = JSON.stringify({
    loggedIn: opts.loggedIn,
    authMethod: opts.loggedIn ? 'oauth_token' : null,
    apiProvider: opts.loggedIn ? 'firstParty' : null,
  });
  writeFileSync(bin, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "claude 2.1.117"; exit 0; fi',
    `if [ "$1" = "auth" ] && [ "$2" = "status" ]; then printf '%s\\n' '${authPayload}'; exit 0; fi`,
    'echo "unexpected args: $@" >&2',
    'exit 9',
    '',
  ].join('\n'), 'utf8');
  chmodSync(bin, 0o755);
  return bin;
}

function fakeClaudeInvalidAuthStatusBin(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ainp-fake-claude-invalid-auth-'));
  const bin = join(dir, 'claude');
  writeFileSync(bin, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "claude 2.1.117"; exit 0; fi',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "not json"; exit 0; fi',
    'echo "unexpected args: $@" >&2',
    'exit 9',
    '',
  ].join('\n'), 'utf8');
  chmodSync(bin, 0o755);
  return bin;
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
