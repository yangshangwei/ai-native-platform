/**
 * End-to-end integration test for grill-me clarification style (PR2, PRD AC).
 *
 * Tests multi-round clarification flow with grill-me style:
 * - Single question per round
 * - Dynamic question generation based on conversation history
 * - Max rounds enforcement with forced convergence
 * - Interaction with default style (regression)
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classifyByLlm, type LlmFallbackDeps } from '../src/agents/coordinator/llm-fallback';
import { invalidateConfigCache } from '../src/config-client';

const realFetch = globalThis.fetch;

/** Minimal valid Coordinator JSON for proceed action. */
const PROCEED_JSON = JSON.stringify({
  action: 'proceed',
  routeCase: 'feature_clear',
  runType: 'feature',
  reason: 'sufficient context gathered',
});

/** Helper to create mock config with overrides */
function mockConfigWithOverrides(overrides: Record<string, unknown>) {
  globalThis.fetch = (async () => {
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

/** Helper to create deps that return sequential responses */
function makeSequentialDeps(responses: string[]): LlmFallbackDeps & { callCount: number } {
  let callCount = 0;
  return {
    callCount: 0,
    checkAvailability: async () => true,
    runOneShot: async () => {
      const response = responses[callCount] ?? PROCEED_JSON;
      callCount++;
      // @ts-expect-error: Mutating callCount for test inspection
      makeSequentialDeps.lastCallCount = callCount;
      return JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: response }] },
      });
    },
  };
}

beforeEach(() => {
  invalidateConfigCache();
  // Default: no overrides (registry defaults)
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ overrides: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('grill-me end-to-end flow', () => {
  it('simulates multi-round clarification with grill-me style', async () => {
    invalidateConfigCache();
    mockConfigWithOverrides({
      'coordinator.clarification_style': 'grill-me',
      'coordinator.max_clarification_rounds': 5,
    });

    // Round 1: Initial request (too vague)
    const deps1 = makeSequentialDeps([
      JSON.stringify({
        action: 'pause_for_human',
        questions: ['What specific user problem does this solve?'],
        reason: 'need problem context',
      }),
    ]);

    const r1 = await classifyByLlm(
      {
        userRequest: 'add a dashboard',
        messageHistory: [],
      },
      { deps: deps1 },
    );

    expect(r1.decision.action).toBe('pause_for_human');
    if (r1.decision.action === 'pause_for_human') {
      expect(r1.decision.questions).toEqual(['What specific user problem does this solve?']);
      expect(r1.decision.questions.length).toBe(1); // Single question in grill-me mode
    }

    // Round 2: User answers, coordinator asks follow-up
    invalidateConfigCache();
    mockConfigWithOverrides({
      'coordinator.clarification_style': 'grill-me',
      'coordinator.max_clarification_rounds': 5,
    });

    const deps2 = makeSequentialDeps([
      JSON.stringify({
        action: 'pause_for_human',
        questions: ['Who is the primary user of this dashboard?'],
        reason: 'need target user',
      }),
    ]);

    const r2 = await classifyByLlm(
      {
        userRequest: 'add a dashboard',
        messageHistory: [
          { role: 'coordinator', content: 'What specific user problem does this solve?' },
          { role: 'user', content: 'Help admins monitor system health' },
        ],
      },
      { deps: deps2 },
    );

    expect(r2.decision.action).toBe('pause_for_human');
    if (r2.decision.action === 'pause_for_human') {
      expect(r2.decision.questions).toEqual(['Who is the primary user of this dashboard?']);
      expect(r2.decision.questions.length).toBe(1);
    }

    // Round 3: Another follow-up
    invalidateConfigCache();
    mockConfigWithOverrides({
      'coordinator.clarification_style': 'grill-me',
      'coordinator.max_clarification_rounds': 5,
    });

    const deps3 = makeSequentialDeps([
      JSON.stringify({
        action: 'pause_for_human',
        questions: ['What are the 2-3 most critical metrics to display?'],
        reason: 'need scope',
      }),
    ]);

    const r3 = await classifyByLlm(
      {
        userRequest: 'add a dashboard',
        messageHistory: [
          { role: 'coordinator', content: 'What specific user problem does this solve?' },
          { role: 'user', content: 'Help admins monitor system health' },
          { role: 'coordinator', content: 'Who is the primary user of this dashboard?' },
          { role: 'user', content: 'System administrators' },
        ],
      },
      { deps: deps3 },
    );

    expect(r3.decision.action).toBe('pause_for_human');
    if (r3.decision.action === 'pause_for_human') {
      expect(r3.decision.questions).toEqual([
        'What are the 2-3 most critical metrics to display?',
      ]);
      expect(r3.decision.questions.length).toBe(1);
    }

    // Round 4: Enough context, proceed
    invalidateConfigCache();
    mockConfigWithOverrides({
      'coordinator.clarification_style': 'grill-me',
      'coordinator.max_clarification_rounds': 5,
    });

    const deps4 = makeSequentialDeps([PROCEED_JSON]);

    const r4 = await classifyByLlm(
      {
        userRequest: 'add a dashboard',
        messageHistory: [
          { role: 'coordinator', content: 'What specific user problem does this solve?' },
          { role: 'user', content: 'Help admins monitor system health' },
          { role: 'coordinator', content: 'Who is the primary user of this dashboard?' },
          { role: 'user', content: 'System administrators' },
          { role: 'coordinator', content: 'What are the 2-3 most critical metrics to display?' },
          { role: 'user', content: 'CPU usage, memory, active tasks' },
        ],
      },
      { deps: deps4 },
    );

    expect(r4.decision.action).toBe('proceed');
    if (r4.decision.action === 'proceed') {
      expect(r4.decision.routeCase).toBe('feature_clear');
      expect(r4.decision.runType).toBe('feature');
    }
  });

  it('enforces max clarification rounds with forced convergence', async () => {
    invalidateConfigCache();
    mockConfigWithOverrides({
      'coordinator.clarification_style': 'grill-me',
      'coordinator.max_clarification_rounds': 3,
    });

    let capturedSystemPrompt = '';
    const deps: LlmFallbackDeps = {
      checkAvailability: async () => true,
      runOneShot: async (_backend, system) => {
        capturedSystemPrompt = system;
        // Even though we're at limit, LLM might still try to ask
        // but we expect the system prompt to contain convergence instruction
        return JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'text',
                text: PROCEED_JSON,
              },
            ],
          },
        });
      },
    };

    const result = await classifyByLlm(
      {
        userRequest: 'do something',
        messageHistory: [
          { role: 'coordinator', content: 'Q1' },
          { role: 'user', content: 'A1' },
          { role: 'coordinator', content: 'Q2' },
          { role: 'user', content: 'A2' },
          { role: 'coordinator', content: 'Q3' },
          { role: 'user', content: 'A3' },
        ],
      },
      { deps },
    );

    // Should force convergence at round 3
    expect(capturedSystemPrompt).toContain('reached the maximum clarification rounds (3)');
    expect(capturedSystemPrompt).toContain('You MUST make a decision');
    expect(capturedSystemPrompt).toContain('Do not ask more questions');
    expect(result.decision.action).toBe('proceed');
  });

  it('combines grill-me style with max rounds enforcement', async () => {
    invalidateConfigCache();
    mockConfigWithOverrides({
      'coordinator.clarification_style': 'grill-me',
      'coordinator.max_clarification_rounds': 2,
    });

    let capturedSystemPrompt = '';
    const deps: LlmFallbackDeps = {
      checkAvailability: async () => true,
      runOneShot: async (_backend, system) => {
        capturedSystemPrompt = system;
        return JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  action: 'proceed',
                  routeCase: 'feature_brainstorm',
                  runType: 'feature',
                  reason: 'forced to converge at limit',
                }),
              },
            ],
          },
        });
      },
    };

    const result = await classifyByLlm(
      {
        userRequest: 'build feature',
        messageHistory: [
          { role: 'coordinator', content: 'First question' },
          { role: 'user', content: 'First answer' },
          { role: 'coordinator', content: 'Second question' },
          { role: 'user', content: 'Second answer' },
        ],
      },
      { deps },
    );

    // Should have BOTH grill-me prompt AND convergence instruction
    expect(capturedSystemPrompt).toContain('ONE question at a time');
    expect(capturedSystemPrompt).toContain('EXACTLY 1 element');
    expect(capturedSystemPrompt).toContain('reached the maximum clarification rounds (2)');
    expect(capturedSystemPrompt).toContain('You MUST make a decision');
    expect(result.decision.action).toBe('proceed');
  });

  it('respects grill-me single question constraint across multiple rounds', async () => {
    // Test that even if LLM returns multiple questions, we truncate to one
    invalidateConfigCache();
    mockConfigWithOverrides({
      'coordinator.clarification_style': 'grill-me',
      'coordinator.max_clarification_rounds': 5,
    });

    const deps = makeSequentialDeps([
      JSON.stringify({
        action: 'pause_for_human',
        questions: ['Q1', 'Q2', 'Q3'], // LLM violated instructions
        reason: 'multiple despite grill-me',
      }),
    ]);

    const result = await classifyByLlm(
      {
        userRequest: 'unclear request',
        messageHistory: [],
      },
      { deps },
    );

    expect(result.decision.action).toBe('pause_for_human');
    if (result.decision.action === 'pause_for_human') {
      // Should be truncated to single question
      expect(result.decision.questions).toEqual(['Q1']);
      expect(result.decision.questions.length).toBe(1);
    }
  });

  it('stops asking when LLM decides to proceed before max rounds', async () => {
    invalidateConfigCache();
    mockConfigWithOverrides({
      'coordinator.clarification_style': 'grill-me',
      'coordinator.max_clarification_rounds': 5,
    });

    const deps = makeSequentialDeps([PROCEED_JSON]);

    const result = await classifyByLlm(
      {
        userRequest: 'very clear request with all details',
        messageHistory: [
          { role: 'coordinator', content: 'What is the goal?' },
          { role: 'user', content: 'Build admin dashboard showing CPU and memory' },
        ],
      },
      { deps },
    );

    expect(result.decision.action).toBe('proceed');
    // Only 1 coordinator message in history, well below limit of 5
  });
});

describe('grill-me regression: default mode unchanged', () => {
  it('default mode allows multiple questions (up to 2)', async () => {
    invalidateConfigCache();
    mockConfigWithOverrides({
      'coordinator.clarification_style': 'default',
      'coordinator.max_clarification_rounds': 5,
    });

    const deps = makeSequentialDeps([
      JSON.stringify({
        action: 'pause_for_human',
        questions: ['What is the goal?', 'Who is the user?'],
        reason: 'need clarification',
      }),
    ]);

    const result = await classifyByLlm(
      {
        userRequest: 'vague request',
        messageHistory: [],
      },
      { deps },
    );

    expect(result.decision.action).toBe('pause_for_human');
    if (result.decision.action === 'pause_for_human') {
      // Should NOT be truncated in default mode
      expect(result.decision.questions).toEqual(['What is the goal?', 'Who is the user?']);
      expect(result.decision.questions.length).toBe(2);
    }
  });

  it('default mode uses default system prompt', async () => {
    invalidateConfigCache();
    mockConfigWithOverrides({
      'coordinator.clarification_style': 'default',
    });

    let capturedSystemPrompt = '';
    const deps: LlmFallbackDeps = {
      checkAvailability: async () => true,
      runOneShot: async (_backend, system) => {
        capturedSystemPrompt = system;
        return JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'text',
                text: PROCEED_JSON,
              },
            ],
          },
        });
      },
    };

    await classifyByLlm(
      {
        userRequest: 'request',
        messageHistory: [],
      },
      { deps },
    );

    expect(capturedSystemPrompt).toContain('ask AT MOST 2');
    expect(capturedSystemPrompt).not.toContain('ONE question at a time');
  });

  it('default mode still enforces max rounds', async () => {
    invalidateConfigCache();
    mockConfigWithOverrides({
      'coordinator.clarification_style': 'default',
      'coordinator.max_clarification_rounds': 2,
    });

    let capturedSystemPrompt = '';
    const deps: LlmFallbackDeps = {
      checkAvailability: async () => true,
      runOneShot: async (_backend, system) => {
        capturedSystemPrompt = system;
        return JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'text',
                text: PROCEED_JSON,
              },
            ],
          },
        });
      },
    };

    await classifyByLlm(
      {
        userRequest: 'request',
        messageHistory: [
          { role: 'coordinator', content: 'Q1' },
          { role: 'user', content: 'A1' },
          { role: 'coordinator', content: 'Q2' },
          { role: 'user', content: 'A2' },
        ],
      },
      { deps },
    );

    // Max rounds works in both modes
    expect(capturedSystemPrompt).toContain('reached the maximum clarification rounds (2)');
    expect(capturedSystemPrompt).toContain('ask AT MOST 2'); // Still default prompt
  });
});

describe('grill-me edge cases', () => {
  it('handles invalid clarification_style by falling back to default', async () => {
    invalidateConfigCache();
    mockConfigWithOverrides({
      'coordinator.clarification_style': 'invalid-style-name',
    });

    let capturedSystemPrompt = '';
    const deps: LlmFallbackDeps = {
      checkAvailability: async () => true,
      runOneShot: async (_backend, system) => {
        capturedSystemPrompt = system;
        return JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'text',
                text: PROCEED_JSON,
              },
            ],
          },
        });
      },
    };

    await classifyByLlm(
      {
        userRequest: 'request',
        messageHistory: [],
      },
      { deps },
    );

    // Should fall back to default prompt
    expect(capturedSystemPrompt).toContain('ask AT MOST 2');
    expect(capturedSystemPrompt).not.toContain('ONE question at a time');
  });

  it('works with minimal max_clarification_rounds of 1 (immediate convergence)', async () => {
    invalidateConfigCache();
    mockConfigWithOverrides({
      'coordinator.clarification_style': 'grill-me',
      'coordinator.max_clarification_rounds': 1,
    });

    let capturedSystemPrompt = '';
    const deps: LlmFallbackDeps = {
      checkAvailability: async () => true,
      runOneShot: async (_backend, system) => {
        capturedSystemPrompt = system;
        return JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'text',
                text: PROCEED_JSON,
              },
            ],
          },
        });
      },
    };

    await classifyByLlm(
      {
        userRequest: 'request',
        messageHistory: [
          { role: 'coordinator', content: 'Q1' },
          { role: 'user', content: 'A1' },
        ],
      },
      { deps },
    );

    // Should show convergence instruction after 1 round
    expect(capturedSystemPrompt).toContain('reached the maximum clarification rounds (1)');
    expect(capturedSystemPrompt).toContain('You MUST make a decision');
  });

  it('counts only coordinator messages for max rounds check', async () => {
    invalidateConfigCache();
    mockConfigWithOverrides({
      'coordinator.clarification_style': 'grill-me',
      'coordinator.max_clarification_rounds': 2,
    });

    let capturedSystemPrompt = '';
    const deps: LlmFallbackDeps = {
      checkAvailability: async () => true,
      runOneShot: async (_backend, system) => {
        capturedSystemPrompt = system;
        return JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'text',
                text: PROCEED_JSON,
              },
            ],
          },
        });
      },
    };

    await classifyByLlm(
      {
        userRequest: 'request',
        messageHistory: [
          { role: 'coordinator', content: 'Q1' },
          { role: 'user', content: 'A1 with many details' },
          { role: 'user', content: 'Additional user clarification' },
          { role: 'coordinator', content: 'Q2' },
          { role: 'user', content: 'A2' },
        ],
      },
      { deps },
    );

    // Only 2 coordinator messages, should trigger convergence
    expect(capturedSystemPrompt).toContain('reached the maximum clarification rounds (2)');
  });
});
