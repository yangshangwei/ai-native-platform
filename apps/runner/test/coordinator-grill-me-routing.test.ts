import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { triageRequest } from '../src/agents/coordinator';
import type { LlmFallbackDeps } from '../src/agents/coordinator/llm-fallback';
import { invalidateConfigCache } from '../src/config-client';

const realFetch = globalThis.fetch;

function mockConfigWithOverrides(overrides: Record<string, unknown>): void {
  globalThis.fetch = (async (input) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.endsWith('/runner/events/agent-stream')) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    const overrideEntries: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(overrides)) {
      overrideEntries[key] = {
        key,
        scope: 'global',
        valueJson: JSON.stringify(value),
        updatedAt: new Date().toISOString(),
        updatedBy: null,
      };
    }

    return new Response(JSON.stringify({ overrides: overrideEntries }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

function codexDepsReturningPause(
  questions: string[],
  capture: { calls: number; systemPrompt: string },
): LlmFallbackDeps {
  return {
    checkAvailability: async (backend) => backend === 'codex',
    runOneShot: async (_backend, system) => {
      capture.calls += 1;
      capture.systemPrompt = system;
      return JSON.stringify({
        action: 'pause_for_human',
        questions,
        reason: 'need deeper clarification',
      });
    },
  };
}

beforeEach(() => {
  invalidateConfigCache();
  mockConfigWithOverrides({});
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('triageRequest Grill Me routing policy', () => {
  it('routes too-short rule clarification through Grill Me when enabled', async () => {
    invalidateConfigCache();
    mockConfigWithOverrides({
      'coordinator.clarification_style': 'grill-me',
      'coordinator.max_clarification_rounds': 10,
    });
    const capture = { calls: 0, systemPrompt: '' };

    const decision = await triageRequest({
      workflowRequestId: 'wreq_grill_rules_too_short' as never,
      userRequest: '权限',
      messageHistory: [],
      preferredBackend: 'codex',
      llmDeps: codexDepsReturningPause(
        ['What concrete permission problem are you trying to solve?', 'Who is blocked?'],
        capture,
      ),
    });

    expect(capture.calls).toBe(1);
    expect(capture.systemPrompt).toContain('ONE question at a time');
    expect(decision.source).toBe('llm');
    expect(decision.decision.action).toBe('pause_for_human');
    if (decision.decision.action === 'pause_for_human') {
      expect(decision.decision.questions).toEqual([
        'What concrete permission problem are you trying to solve?',
      ]);
    }
  });

  it('routes large-scope rule clarification through Grill Me when enabled', async () => {
    invalidateConfigCache();
    mockConfigWithOverrides({
      'coordinator.clarification_style': 'grill-me',
      'coordinator.max_clarification_rounds': 10,
    });
    const capture = { calls: 0, systemPrompt: '' };

    const decision = await triageRequest({
      workflowRequestId: 'wreq_grill_rules_large_scope' as never,
      userRequest: '我想要一个完整的权限系统，包括用户、角色、资源、审计',
      messageHistory: [],
      preferredBackend: 'codex',
      llmDeps: codexDepsReturningPause(
        ['Which single permission workflow must work first?', 'What can wait?'],
        capture,
      ),
    });

    expect(capture.calls).toBe(1);
    expect(capture.systemPrompt).toContain('ONE question at a time');
    expect(decision.source).toBe('llm');
    expect(decision.decision.action).toBe('pause_for_human');
    if (decision.decision.action === 'pause_for_human') {
      expect(decision.decision.questions).toEqual([
        'Which single permission workflow must work first?',
      ]);
    }
  });

  it('preserves default style rule clarification behavior', async () => {
    invalidateConfigCache();
    mockConfigWithOverrides({
      'coordinator.clarification_style': 'default',
      'coordinator.max_clarification_rounds': 10,
    });

    const decision = await triageRequest({
      workflowRequestId: 'wreq_default_rules_too_short' as never,
      userRequest: '权限',
      messageHistory: [],
      preferredBackend: 'codex',
      llmDeps: {
        checkAvailability: async () => true,
        runOneShot: async () => {
          throw new Error('default style should not call LLM for high-confidence rule pause');
        },
      },
    });

    expect(decision.source).toBe('rules');
    expect(decision.decision.action).toBe('pause_for_human');
    if (decision.decision.action === 'pause_for_human') {
      expect(decision.decision.questions.length).toBeGreaterThan(1);
    }
  });

  it('does not emit another clarification after max rounds are reached', async () => {
    invalidateConfigCache();
    mockConfigWithOverrides({
      'coordinator.clarification_style': 'grill-me',
      'coordinator.max_clarification_rounds': 2,
    });
    const capture = { calls: 0, systemPrompt: '' };

    const decision = await triageRequest({
      workflowRequestId: 'wreq_grill_rules_max_rounds' as never,
      userRequest: '权限',
      messageHistory: [
        { role: 'coordinator', content: 'Q1' },
        { role: 'user', content: 'A1' },
        { role: 'coordinator', content: 'Q2' },
        { role: 'user', content: 'A2' },
      ],
      preferredBackend: 'codex',
      llmDeps: codexDepsReturningPause(['Can you clarify one more thing?'], capture),
    });

    expect(capture.calls).toBe(1);
    expect(capture.systemPrompt).toContain('reached the maximum clarification rounds (2)');
    expect(decision.decision.action).toBe('abort');
    expect(decision.rulesFired).toContain('coordinator.max_clarification_rounds_reached');
  });
});
