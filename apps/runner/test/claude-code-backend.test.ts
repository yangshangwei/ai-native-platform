import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SkillSpec } from '@ainp/shared';
import { api } from '../src/api-client';
import { ClaudeCodeBackend } from '../src/agents/claude-code';

const ORIGINAL_CAPTURE_ARGS = process.env.CAPTURE_CLAUDE_ARGS;
const ORIGINAL_CAPTURE_ENV = process.env.CAPTURE_CLAUDE_ENV;
const ORIGINAL_CLAUDE_BIN = process.env.AINP_CLAUDE_BIN;
const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR;
const ORIGINAL_XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME;
const ORIGINAL_HOME_ISOLATION = process.env.AINP_CLAUDE_HOME_ISOLATION;

afterEach(() => {
  vi.restoreAllMocks();
  if (ORIGINAL_CAPTURE_ARGS === undefined) delete process.env.CAPTURE_CLAUDE_ARGS;
  else process.env.CAPTURE_CLAUDE_ARGS = ORIGINAL_CAPTURE_ARGS;
  if (ORIGINAL_CAPTURE_ENV === undefined) delete process.env.CAPTURE_CLAUDE_ENV;
  else process.env.CAPTURE_CLAUDE_ENV = ORIGINAL_CAPTURE_ENV;
  if (ORIGINAL_CLAUDE_BIN === undefined) delete process.env.AINP_CLAUDE_BIN;
  else process.env.AINP_CLAUDE_BIN = ORIGINAL_CLAUDE_BIN;
  if (ORIGINAL_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = ORIGINAL_HOME;
  if (ORIGINAL_CLAUDE_CONFIG_DIR === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = ORIGINAL_CLAUDE_CONFIG_DIR;
  if (ORIGINAL_XDG_CONFIG_HOME === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = ORIGINAL_XDG_CONFIG_HOME;
  if (ORIGINAL_HOME_ISOLATION === undefined) delete process.env.AINP_CLAUDE_HOME_ISOLATION;
  else process.env.AINP_CLAUDE_HOME_ISOLATION = ORIGINAL_HOME_ISOLATION;
});

describe('ClaudeCodeBackend runtime invocation', () => {
  it('uses stream-json runtime args without bare mode', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ainp-claude-backend-'));
    const workspacePath = join(root, 'workspace');
    const artifactsDir = join(root, 'artifacts');
    mkdirSync(workspacePath, { recursive: true });
    mkdirSync(artifactsDir, { recursive: true });

    const capturePath = join(root, 'args.bin');
    process.env.CAPTURE_CLAUDE_ARGS = capturePath;
    vi.spyOn(api, 'postAgentEvent').mockResolvedValue({ ok: true });

    await new ClaudeCodeBackend({ bin: fakeClaudeBin(root), timeoutMs: 3_000 }).run(implementationSkill(), {
      workflowRunId: 'run_claude_args',
      stepRunId: 'step_claude_args',
      workspacePath,
      branch: 'main',
      title: 'exercise claude runtime args',
      artifactsDir,
      inputs: {},
    });

    const args = readFileSync(capturePath).toString('utf8').split('\0').filter(Boolean);
    expect(args).toContain('--print');
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
    expect(args).toContain('--no-session-persistence');
    expect(args).not.toContain('--bare');
  });

  it('uses the shared env override resolver when no constructor bin is provided', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ainp-claude-backend-env-'));
    const workspacePath = join(root, 'workspace');
    const artifactsDir = join(root, 'artifacts');
    mkdirSync(workspacePath, { recursive: true });
    mkdirSync(artifactsDir, { recursive: true });

    const capturePath = join(root, 'args.bin');
    process.env.CAPTURE_CLAUDE_ARGS = capturePath;
    process.env.AINP_CLAUDE_BIN = fakeClaudeBin(root);
    vi.spyOn(api, 'postAgentEvent').mockResolvedValue({ ok: true });

    await new ClaudeCodeBackend({ timeoutMs: 3_000 }).run(implementationSkill(), {
      workflowRunId: 'run_claude_env_args',
      stepRunId: 'step_claude_env_args',
      workspacePath,
      branch: 'main',
      title: 'exercise claude env resolver',
      artifactsDir,
      inputs: {},
    });

    const args = readFileSync(capturePath).toString('utf8').split('\0').filter(Boolean);
    expect(args).toContain('--print');
    expect(args).toContain('stream-json');
  });

  it('inherits local Claude Code HOME and config env by default', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ainp-claude-backend-home-'));
    const workspacePath = join(root, 'workspace');
    const artifactsDir = join(root, 'artifacts');
    const localHome = join(root, 'local-home');
    const claudeConfigDir = join(root, 'claude-config');
    const xdgConfigHome = join(root, 'xdg-config');
    mkdirSync(workspacePath, { recursive: true });
    mkdirSync(artifactsDir, { recursive: true });
    mkdirSync(localHome, { recursive: true });
    mkdirSync(claudeConfigDir, { recursive: true });
    mkdirSync(xdgConfigHome, { recursive: true });

    const capturePath = join(root, 'env.json');
    process.env.CAPTURE_CLAUDE_ENV = capturePath;
    process.env.HOME = localHome;
    process.env.CLAUDE_CONFIG_DIR = claudeConfigDir;
    process.env.XDG_CONFIG_HOME = xdgConfigHome;
    delete process.env.AINP_CLAUDE_HOME_ISOLATION;
    vi.spyOn(api, 'postAgentEvent').mockResolvedValue({ ok: true });

    await new ClaudeCodeBackend({ bin: fakeClaudeBin(root), timeoutMs: 3_000 }).run(implementationSkill(), {
      workflowRunId: 'run_claude_home',
      stepRunId: 'step_claude_home',
      workspacePath,
      branch: 'main',
      title: 'exercise claude local home',
      artifactsDir,
      inputs: {},
    });

    const env = JSON.parse(readFileSync(capturePath, 'utf8')) as {
      HOME?: string;
      CLAUDE_CONFIG_DIR?: string;
      XDG_CONFIG_HOME?: string;
    };
    expect(env.HOME).toBe(localHome);
    expect(env.CLAUDE_CONFIG_DIR).toBe(claudeConfigDir);
    expect(env.XDG_CONFIG_HOME).toBe(xdgConfigHome);
  });

  it('uses an isolated HOME only when explicitly opted in', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ainp-claude-backend-isolated-home-'));
    const workspacePath = join(root, 'workspace');
    const artifactsDir = join(root, 'artifacts');
    const localHome = join(root, 'local-home');
    const claudeConfigDir = join(root, 'claude-config');
    const xdgConfigHome = join(root, 'xdg-config');
    mkdirSync(workspacePath, { recursive: true });
    mkdirSync(artifactsDir, { recursive: true });
    mkdirSync(localHome, { recursive: true });
    mkdirSync(claudeConfigDir, { recursive: true });
    mkdirSync(xdgConfigHome, { recursive: true });

    const capturePath = join(root, 'env.json');
    process.env.CAPTURE_CLAUDE_ENV = capturePath;
    process.env.HOME = localHome;
    process.env.CLAUDE_CONFIG_DIR = claudeConfigDir;
    process.env.XDG_CONFIG_HOME = xdgConfigHome;
    process.env.AINP_CLAUDE_HOME_ISOLATION = '1';
    vi.spyOn(api, 'postAgentEvent').mockResolvedValue({ ok: true });

    await new ClaudeCodeBackend({ bin: fakeClaudeBin(root), timeoutMs: 3_000 }).run(implementationSkill(), {
      workflowRunId: 'run_claude_isolated_home',
      stepRunId: 'step_claude_isolated_home',
      workspacePath,
      branch: 'main',
      title: 'exercise claude isolated home',
      artifactsDir,
      inputs: {},
    });

    const env = JSON.parse(readFileSync(capturePath, 'utf8')) as {
      HOME?: string;
      CLAUDE_CONFIG_DIR?: string;
      XDG_CONFIG_HOME?: string;
    };
    expect(env.HOME).not.toBe(localHome);
    expect(env.HOME).toContain('ainp-claude-home-');
    expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
    expect(env.XDG_CONFIG_HOME).toBeUndefined();
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

function fakeClaudeBin(dir: string): string {
  const bin = join(dir, 'claude');
  writeFileSync(bin, [
    '#!/bin/sh',
    'if [ -n "$CAPTURE_CLAUDE_ARGS" ]; then',
    '  : > "$CAPTURE_CLAUDE_ARGS"',
    '  for arg in "$@"; do printf "%s\\0" "$arg" >> "$CAPTURE_CLAUDE_ARGS"; done',
    'fi',
    'if [ -n "$CAPTURE_CLAUDE_ENV" ]; then',
    '  node -e "require(\'fs\').writeFileSync(process.env.CAPTURE_CLAUDE_ENV, JSON.stringify({ HOME: process.env.HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME }))"',
    'fi',
    'printf "%s\\n" \'{"type":"result","subtype":"success","result":"done"}\'',
    'exit 0',
    '',
  ].join('\n'), 'utf8');
  chmodSync(bin, 0o755);
  return bin;
}
