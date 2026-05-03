import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SkillSpec } from '@ainp/shared';
import { api } from '../src/api-client';
import { ClaudeCodeBackend } from '../src/agents/claude-code';

const ORIGINAL_CAPTURE_ARGS = process.env.CAPTURE_CLAUDE_ARGS;
const ORIGINAL_CLAUDE_BIN = process.env.AINP_CLAUDE_BIN;

afterEach(() => {
  vi.restoreAllMocks();
  if (ORIGINAL_CAPTURE_ARGS === undefined) delete process.env.CAPTURE_CLAUDE_ARGS;
  else process.env.CAPTURE_CLAUDE_ARGS = ORIGINAL_CAPTURE_ARGS;
  if (ORIGINAL_CLAUDE_BIN === undefined) delete process.env.AINP_CLAUDE_BIN;
  else process.env.AINP_CLAUDE_BIN = ORIGINAL_CLAUDE_BIN;
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
    ': > "$CAPTURE_CLAUDE_ARGS"',
    'for arg in "$@"; do printf "%s\\0" "$arg" >> "$CAPTURE_CLAUDE_ARGS"; done',
    'printf "%s\\n" \'{"type":"result","subtype":"success","result":"done"}\'',
    'exit 0',
    '',
  ].join('\n'), 'utf8');
  chmodSync(bin, 0o755);
  return bin;
}
