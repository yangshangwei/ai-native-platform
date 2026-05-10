/**
 * Coordinator LLM fallback selection-strategy tests (PR3, PRD §P0-1).
 *
 * Most tests cover the project-aware backend ordering without spawning real
 * `claude` or `codex` processes by injecting `LlmFallbackDeps`; the final
 * block uses a fake CLI to lock the real spawn environment contract.
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classifyByLlm, type LlmFallbackDeps } from '../src/agents/coordinator/llm-fallback';
import { invalidateConfigCache } from '../src/config-client';

const realFetch = globalThis.fetch;
const ORIGINAL_CLAUDE_BIN = process.env.AINP_CLAUDE_BIN;
const ORIGINAL_CODEX_BIN = process.env.AINP_CODEX_BIN;
const ORIGINAL_CAPTURE_COORD_ENV = process.env.CAPTURE_COORD_ENV;
const ORIGINAL_CAPTURE_COORD_ARGS = process.env.CAPTURE_COORD_ARGS;
const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR;
const ORIGINAL_XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME;
const ORIGINAL_HOME_ISOLATION = process.env.AINP_CLAUDE_HOME_ISOLATION;
const ORIGINAL_LOAD_USER_SETTINGS = process.env.AINP_CLAUDE_LOAD_USER_SETTINGS;

const BLANK_INPUT = {
  userRequest: 'do the thing',
  messageHistory: [] as { role: 'user' | 'coordinator'; content: string }[],
};

/** Minimal valid Coordinator JSON the LLM is supposed to emit. */
const FAKE_PROCEED_JSON = JSON.stringify({
  action: 'proceed',
  routeCase: 'feature_clear',
  runType: 'feature',
  reason: 'mocked',
});

beforeEach(() => {
  invalidateConfigCache();
  // Stub the runtime-config endpoint so getConfig() returns registry defaults.
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ overrides: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  restoreEnv('AINP_CLAUDE_BIN', ORIGINAL_CLAUDE_BIN);
  restoreEnv('AINP_CODEX_BIN', ORIGINAL_CODEX_BIN);
  restoreEnv('CAPTURE_COORD_ENV', ORIGINAL_CAPTURE_COORD_ENV);
  restoreEnv('CAPTURE_COORD_ARGS', ORIGINAL_CAPTURE_COORD_ARGS);
  restoreEnv('HOME', ORIGINAL_HOME);
  restoreEnv('CLAUDE_CONFIG_DIR', ORIGINAL_CLAUDE_CONFIG_DIR);
  restoreEnv('XDG_CONFIG_HOME', ORIGINAL_XDG_CONFIG_HOME);
  restoreEnv('AINP_CLAUDE_HOME_ISOLATION', ORIGINAL_HOME_ISOLATION);
  restoreEnv('AINP_CLAUDE_LOAD_USER_SETTINGS', ORIGINAL_LOAD_USER_SETTINGS);
});

function makeDeps(opts: {
  claudeAvailable: boolean;
  codexAvailable: boolean;
  output?: { claude?: string; codex?: string };
  onCalled?: (backend: string) => void;
}): LlmFallbackDeps {
  return {
    checkAvailability: async (backend) =>
      backend === 'codex' ? opts.codexAvailable : opts.claudeAvailable,
    runOneShot: async (backend) => {
      opts.onCalled?.(backend);
      const out = backend === 'codex' ? opts.output?.codex : opts.output?.claude;
      // Codex path returns a plain string (mirrors `--output-last-message`),
      // claude path returns a fake stream-json line.
      if (backend === 'codex') return out ?? FAKE_PROCEED_JSON;
      return JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: out ?? FAKE_PROCEED_JSON }] },
      });
    },
  };
}

describe('classifyByLlm selection strategy (PR3)', () => {
  it('uses claude when claude available and codex unavailable (no preference)', async () => {
    const calls: string[] = [];
    const deps = makeDeps({
      claudeAvailable: true,
      codexAvailable: false,
      onCalled: (b) => calls.push(b),
    });
    const r = await classifyByLlm(BLANK_INPUT, { deps });
    expect(calls).toEqual(['claude_code']);
    expect(r.rulesFired).toContain('llm.classified.claude_code');
    expect(r.decision.action).toBe('proceed');
  });

  it('uses codex when codex available and claude unavailable (no preference)', async () => {
    const calls: string[] = [];
    const deps = makeDeps({
      claudeAvailable: false,
      codexAvailable: true,
      onCalled: (b) => calls.push(b),
    });
    const r = await classifyByLlm(BLANK_INPUT, { deps });
    expect(calls).toEqual(['codex']);
    expect(r.rulesFired).toContain('llm.classified.codex');
    expect(r.decision.action).toBe('proceed');
  });

  it('honours preferredBackend=codex (uses codex when both available)', async () => {
    const calls: string[] = [];
    const deps = makeDeps({
      claudeAvailable: true,
      codexAvailable: true,
      onCalled: (b) => calls.push(b),
    });
    const r = await classifyByLlm(BLANK_INPUT, { deps, preferredBackend: 'codex' });
    expect(calls).toEqual(['codex']);
    expect(r.rulesFired).toContain('llm.classified.codex');
  });

  it('honours preferredBackend=claude_code (uses claude when both available)', async () => {
    const calls: string[] = [];
    const deps = makeDeps({
      claudeAvailable: true,
      codexAvailable: true,
      onCalled: (b) => calls.push(b),
    });
    const r = await classifyByLlm(BLANK_INPUT, { deps, preferredBackend: 'claude_code' });
    expect(calls).toEqual(['claude_code']);
    expect(r.rulesFired).toContain('llm.classified.claude_code');
  });

  it('falls back to the other CLI when preferredBackend is unavailable', async () => {
    const calls: string[] = [];
    const deps = makeDeps({
      claudeAvailable: true,
      codexAvailable: false, // preferred is unavailable, must fall back
      onCalled: (b) => calls.push(b),
    });
    const r = await classifyByLlm(BLANK_INPUT, { deps, preferredBackend: 'codex' });
    expect(calls).toEqual(['claude_code']);
    expect(r.rulesFired).toContain('llm.classified.claude_code');
    expect(r.decision.action).toBe('proceed');
  });

  it('returns pause_for_human with llm.unavailable when neither CLI is runnable', async () => {
    const calls: string[] = [];
    const deps = makeDeps({
      claudeAvailable: false,
      codexAvailable: false,
      onCalled: (b) => calls.push(b),
    });
    const r = await classifyByLlm(BLANK_INPUT, { deps });
    expect(calls).toEqual([]);
    expect(r.decision.action).toBe('pause_for_human');
    expect(r.rulesFired).toContain('llm.unavailable');
  });

  it('degrades to pause_for_human when CLI throws (invocation_failed)', async () => {
    const deps: LlmFallbackDeps = {
      checkAvailability: async () => true,
      runOneShot: async () => {
        throw new Error('boom');
      },
    };
    const r = await classifyByLlm(BLANK_INPUT, { deps });
    expect(r.decision.action).toBe('pause_for_human');
    expect(r.rulesFired).toContain('llm.invocation_failed');
    if (r.decision.action === 'pause_for_human') {
      expect(r.decision.reason).toContain('boom');
    }
  });

  it('parses codex plain-text JSON output (mirrors --output-last-message)', async () => {
    const deps = makeDeps({
      claudeAvailable: false,
      codexAvailable: true,
      output: {
        codex: JSON.stringify({
          action: 'pause_for_human',
          questions: ['what scope?'],
          reason: 'too vague',
        }),
      },
    });
    const r = await classifyByLlm(BLANK_INPUT, { deps });
    expect(r.decision.action).toBe('pause_for_human');
    if (r.decision.action === 'pause_for_human') {
      expect(r.decision.questions).toEqual(['what scope?']);
    }
  });

  it('extracts codex JSON after a Skill session notice prefix', async () => {
    const deps = makeDeps({
      claudeAvailable: false,
      codexAvailable: true,
      output: {
        codex: [
          'Trellis SessionStart 已注入：workflow、当前任务状态、开发者身份、git 状态、active tasks、spec 索引已加载。',
          JSON.stringify({
            action: 'pause_for_human',
            questions: ['这是新增能力、修复现有问题，还是一次性验证？'],
            reason: 'need route',
          }),
        ].join('\n'),
      },
    });
    const r = await classifyByLlm(BLANK_INPUT, { deps });
    expect(r.decision.action).toBe('pause_for_human');
    if (r.decision.action === 'pause_for_human') {
      expect(r.decision.questions).toEqual(['这是新增能力、修复现有问题，还是一次性验证？']);
    }
  });

  it('extracts codex JSON from fenced markdown surrounded by prose', async () => {
    const deps = makeDeps({
      claudeAvailable: false,
      codexAvailable: true,
      output: {
        codex: [
          '我会先给出分诊结果：',
          '```json',
          JSON.stringify({
            action: 'proceed',
            routeCase: 'bugfix',
            runType: 'bugfix',
            reason: 'broken existing behavior',
          }),
          '```',
          '以上是机器可读结果。',
        ].join('\n'),
      },
    });
    const r = await classifyByLlm(BLANK_INPUT, { deps });
    expect(r.decision.action).toBe('proceed');
    if (r.decision.action === 'proceed') {
      expect(r.decision.routeCase).toBe('bugfix');
      expect(r.decision.runType).toBe('bugfix');
    }
  });

  it('skips non-decision JSON before the first valid coordinator JSON object', async () => {
    const deps = makeDeps({
      claudeAvailable: false,
      codexAvailable: true,
      output: {
        codex: [
          'debug metadata {"source":"skill","nested":{"ignored":true}}',
          JSON.stringify({
            action: 'abort',
            reason: 'off-topic',
          }),
        ].join('\n'),
      },
    });
    const r = await classifyByLlm(BLANK_INPUT, { deps });
    expect(r.decision.action).toBe('abort');
  });

  it('skips unknown-action JSON before a valid coordinator JSON object', async () => {
    const deps = makeDeps({
      claudeAvailable: false,
      codexAvailable: true,
      output: {
        codex: [
          'tool metadata {"action":"SessionStart","note":"not a coordinator decision"}',
          JSON.stringify({
            action: 'pause_for_human',
            questions: ['请确认是修复、功能还是验证？'],
            reason: 'valid later decision',
          }),
        ].join('\n'),
      },
    });
    const r = await classifyByLlm(BLANK_INPUT, { deps });
    expect(r.decision.action).toBe('pause_for_human');
    if (r.decision.action === 'pause_for_human') {
      expect(r.decision.questions).toEqual(['请确认是修复、功能还是验证？']);
    }
  });

  it('normalizes invalid proceed route fields to safe defaults', async () => {
    const deps = makeDeps({
      claudeAvailable: false,
      codexAvailable: true,
      output: {
        codex: JSON.stringify({
          action: 'proceed',
          routeCase: 'not-a-route',
          runType: 'not-a-run-type',
          reason: 'malformed enum values',
        }),
      },
    });
    const r = await classifyByLlm(BLANK_INPUT, { deps });
    expect(r.decision.action).toBe('proceed');
    if (r.decision.action === 'proceed') {
      expect(r.decision.routeCase).toBe('feature_clear');
      expect(r.decision.runType).toBe('feature');
    }
  });

  it('falls back to a user-friendly question when pause_for_human has no usable questions', async () => {
    const deps = makeDeps({
      claudeAvailable: false,
      codexAvailable: true,
      output: {
        codex: JSON.stringify({
          action: 'pause_for_human',
          questions: [null, 123],
          reason: 'malformed questions',
        }),
      },
    });
    const r = await classifyByLlm(BLANK_INPUT, { deps });
    expect(r.decision.action).toBe('pause_for_human');
    if (r.decision.action === 'pause_for_human') {
      expect(r.decision.questions).toEqual([
        '我还需要确认一下需求范围：这是新增能力、修复现有问题，还是一次性验证/冒烟检查？',
      ]);
      expect(r.decision.questions[0]).not.toMatch(/JSON|parse|LLM/i);
    }
  });

  it('parses claude stream-json wrapped JSON output', async () => {
    const deps = makeDeps({
      claudeAvailable: true,
      codexAvailable: false,
      output: {
        claude: JSON.stringify({
          action: 'abort',
          reason: 'off-topic',
        }),
      },
    });
    const r = await classifyByLlm(BLANK_INPUT, { deps });
    expect(r.decision.action).toBe('abort');
  });

  it('extracts claude stream-json assistant text when Skill text precedes JSON', async () => {
    const deps = makeDeps({
      claudeAvailable: true,
      codexAvailable: false,
      output: {
        claude: [
          'Trellis SessionStart 已注入：workflow、当前任务状态、开发者身份、git 状态、active tasks、spec 索引已加载。',
          JSON.stringify({
            action: 'pause_for_human',
            questions: ['请确认最小闭环是什么？'],
            reason: 'needs scope',
          }),
        ].join('\n'),
      },
    });
    const r = await classifyByLlm(BLANK_INPUT, { deps });
    expect(r.decision.action).toBe('pause_for_human');
    if (r.decision.action === 'pause_for_human') {
      expect(r.decision.questions).toEqual(['请确认最小闭环是什么？']);
    }
  });

  it('keeps invalid JSON diagnostics in reason while showing a user-friendly question', async () => {
    const deps = makeDeps({
      claudeAvailable: false,
      codexAvailable: true,
      output: {
        codex: 'Trellis SessionStart 已注入。\n{"action":"pause_for_human","questions":["missing close"]',
      },
    });
    const r = await classifyByLlm(BLANK_INPUT, { deps });
    expect(r.decision.action).toBe('pause_for_human');
    if (r.decision.action === 'pause_for_human') {
      expect(r.decision.questions).toEqual([
        '我还需要确认一下需求范围：这是新增能力、修复现有问题，还是一次性验证/冒烟检查？',
      ]);
      expect(r.decision.questions[0]).not.toMatch(/JSON|parse|LLM/i);
      expect(r.decision.reason).toContain('failed to parse LLM JSON');
      expect(r.decision.reason).toContain('Trellis SessionStart');
    }
  });
});

describe('classifyByLlm real Claude spawn environment', () => {
  it('inherits local Claude Code HOME and config env by default', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ainp-coord-claude-home-'));
    const localHome = join(root, 'local-home');
    const claudeConfigDir = join(root, 'claude-config');
    const xdgConfigHome = join(root, 'xdg-config');
    mkdirSync(localHome, { recursive: true });
    mkdirSync(claudeConfigDir, { recursive: true });
    mkdirSync(xdgConfigHome, { recursive: true });

    const capturePath = join(root, 'env.json');
    process.env.AINP_CLAUDE_BIN = fakeClaudeCoordinatorBin(root);
    process.env.AINP_CODEX_BIN = missingCliBin(root, 'codex');
    process.env.CAPTURE_COORD_ENV = capturePath;
    process.env.HOME = localHome;
    process.env.CLAUDE_CONFIG_DIR = claudeConfigDir;
    process.env.XDG_CONFIG_HOME = xdgConfigHome;
    delete process.env.AINP_CLAUDE_HOME_ISOLATION;

    const result = await classifyByLlm(BLANK_INPUT, { preferredBackend: 'claude_code' });

    expect(result.decision.action).toBe('proceed');
    const env = JSON.parse(readFileSync(capturePath, 'utf8')) as {
      HOME?: string;
      CLAUDE_CONFIG_DIR?: string;
      XDG_CONFIG_HOME?: string;
    };
    expect(env.HOME).toBe(localHome);
    expect(env.CLAUDE_CONFIG_DIR).toBe(claudeConfigDir);
    expect(env.XDG_CONFIG_HOME).toBe(xdgConfigHome);
  });

  it('isolates Claude Code HOME only when explicitly opted in', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ainp-coord-claude-isolated-'));
    const localHome = join(root, 'local-home');
    const claudeConfigDir = join(root, 'claude-config');
    const xdgConfigHome = join(root, 'xdg-config');
    mkdirSync(localHome, { recursive: true });
    mkdirSync(claudeConfigDir, { recursive: true });
    mkdirSync(xdgConfigHome, { recursive: true });

    const capturePath = join(root, 'env.json');
    process.env.AINP_CLAUDE_BIN = fakeClaudeCoordinatorBin(root);
    process.env.AINP_CODEX_BIN = missingCliBin(root, 'codex');
    process.env.CAPTURE_COORD_ENV = capturePath;
    process.env.HOME = localHome;
    process.env.CLAUDE_CONFIG_DIR = claudeConfigDir;
    process.env.XDG_CONFIG_HOME = xdgConfigHome;
    process.env.AINP_CLAUDE_HOME_ISOLATION = '1';

    const result = await classifyByLlm(BLANK_INPUT, { preferredBackend: 'claude_code' });

    expect(result.decision.action).toBe('proceed');
    const env = JSON.parse(readFileSync(capturePath, 'utf8')) as {
      HOME?: string;
      CLAUDE_CONFIG_DIR?: string;
      XDG_CONFIG_HOME?: string;
    };
    expect(env.HOME).not.toBe(localHome);
    expect(env.HOME).toContain('ainp-coord-home-');
    expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
    expect(env.XDG_CONFIG_HOME).toBeUndefined();
  });

  it('passes --settings hook overrides by default without dropping user settings sources', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ainp-coord-claude-settings-'));
    const capturePath = join(root, 'args.bin');
    process.env.AINP_CLAUDE_BIN = fakeClaudeCoordinatorBin(root);
    process.env.AINP_CODEX_BIN = missingCliBin(root, 'codex');
    process.env.CAPTURE_COORD_ARGS = capturePath;
    delete process.env.AINP_CLAUDE_LOAD_USER_SETTINGS;

    const result = await classifyByLlm(BLANK_INPUT, { preferredBackend: 'claude_code' });

    expect(result.decision.action).toBe('proceed');
    const args = readFileSync(capturePath, 'utf8').split('\0').filter(Boolean);
    expect(args).not.toContain('--setting-sources');
    const idx = args.indexOf('--settings');
    expect(idx).toBeGreaterThanOrEqual(0);
    const settings = JSON.parse(args[idx + 1]!) as { hooks: Record<string, unknown[]> };
    expect(settings.hooks.Stop).toEqual([]);
    expect(settings.hooks.PostToolUse).toEqual([]);
    expect(settings.hooks.UserPromptSubmit).toEqual([]);
  });

  it('keeps user-level hooks when AINP_CLAUDE_LOAD_USER_SETTINGS=1', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ainp-coord-claude-settings-on-'));
    const capturePath = join(root, 'args.bin');
    process.env.AINP_CLAUDE_BIN = fakeClaudeCoordinatorBin(root);
    process.env.AINP_CODEX_BIN = missingCliBin(root, 'codex');
    process.env.CAPTURE_COORD_ARGS = capturePath;
    process.env.AINP_CLAUDE_LOAD_USER_SETTINGS = '1';

    const result = await classifyByLlm(BLANK_INPUT, { preferredBackend: 'claude_code' });

    expect(result.decision.action).toBe('proceed');
    const args = readFileSync(capturePath, 'utf8').split('\0').filter(Boolean);
    expect(args).not.toContain('--settings');
    expect(args).not.toContain('--setting-sources');
  });
});

function restoreEnv(key: string, original: string | undefined): void {
  if (original === undefined) delete process.env[key];
  else process.env[key] = original;
}

function fakeClaudeCoordinatorBin(dir: string): string {
  const bin = join(dir, 'claude.mjs');
  const assistantEvent = JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'text', text: FAKE_PROCEED_JSON }] },
  });
  writeFileSync(bin, [
    '#!/usr/bin/env node',
    'import { writeFileSync } from "node:fs";',
    'if (process.argv[2] === "--version") {',
    '  console.log("claude 2.1.117");',
    '  process.exit(0);',
    '}',
    'if (process.env.CAPTURE_COORD_ENV) {',
    '  writeFileSync(process.env.CAPTURE_COORD_ENV, JSON.stringify({',
    '    HOME: process.env.HOME,',
    '    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,',
    '    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,',
    '  }));',
    '}',
    'if (process.env.CAPTURE_COORD_ARGS) {',
    '  writeFileSync(process.env.CAPTURE_COORD_ARGS, process.argv.slice(2).join("\\u0000"));',
    '}',
    `console.log(${JSON.stringify(assistantEvent)});`,
    '',
  ].join('\n'), 'utf8');
  chmodSync(bin, 0o755);
  return bin;
}

function missingCliBin(dir: string, name: string): string {
  const bin = join(dir, name);
  writeFileSync(bin, [
    '#!/bin/sh',
    'exit 127',
    '',
  ].join('\n'), 'utf8');
  chmodSync(bin, 0o755);
  return bin;
}
