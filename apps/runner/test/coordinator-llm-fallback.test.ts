/**
 * Coordinator LLM fallback selection-strategy tests (PR3, PRD §P0-1).
 *
 * Covers the new project-aware backend ordering without spawning real
 * `claude` or `codex` processes by injecting `LlmFallbackDeps`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classifyByLlm, type LlmFallbackDeps } from '../src/agents/coordinator/llm-fallback';
import { invalidateConfigCache } from '../src/config-client';

const realFetch = globalThis.fetch;

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
});
