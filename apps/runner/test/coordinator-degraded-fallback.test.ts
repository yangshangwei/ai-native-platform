/**
 * Coordinator triage degraded-fallback test (Issue 2 fix).
 *
 * Validates that when the LLM fallback fails for a transient reason
 * (CLI throw / unavailable / empty output) AND the rule classifier
 * already produced a `proceed` decision, `triageRequest` keeps the rule's
 * `proceed` answer instead of pausing the user.
 *
 * Reproduces the failure mode documented in
 * `CodeStable/issues/2026-05-05-coordinator-fallback-pauses-concrete-request/`:
 * a concrete WorkflowRequest like "增加一个 subtract 方法并补测试" was
 * blocked at `awaiting_clarification` because the Claude one-shot timed
 * out, even though the rules already classified it as feature_clear.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { triageRequest } from '../src/agents/coordinator';
import type { LlmFallbackDeps } from '../src/agents/coordinator/llm-fallback';
import { invalidateConfigCache } from '../src/config-client';
import type { AgentStreamEventInput } from '@ainp/shared';

const realFetch = globalThis.fetch;

beforeEach(() => {
  invalidateConfigCache();
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ overrides: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function captureAgentEvents(): AgentStreamEventInput[] {
  const events: AgentStreamEventInput[] = [];
  globalThis.fetch = (async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (url.endsWith('/runner/events/agent-stream')) {
      events.push(JSON.parse(String(init?.body ?? '{}')) as AgentStreamEventInput);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ overrides: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return events;
}

describe('triageRequest degraded fallback (Issue 2 fix)', () => {
  it('keeps rule proceed when LLM throws on a concrete request', async () => {
    // Title with one feature keyword (`增加`) — rule classifier yields
    // ambiguous-default `proceed/feature_clear@0.4` (below the 0.65
    // threshold), so the entry calls the LLM fallback.
    const throwingDeps: LlmFallbackDeps = {
      checkAvailability: async () => true,
      runOneShot: async () => {
        throw new Error('claude one-shot timed out');
      },
    };

    const decision = await triageRequest({
      workflowRequestId: 'wreq_degraded_test' as never,
      userRequest: '增加一个 subtract 方法并补测试',
      messageHistory: [],
      preferredBackend: 'claude_code',
      llmDeps: throwingDeps,
    });

    expect(decision.decision.action).toBe('proceed');
    expect(decision.source).toBe('rules');
    expect(decision.rulesFired).toContain('llm.degraded.invocation_failed');
  });

  it('streams the final degraded rule decision, not the intermediate LLM failure', async () => {
    const events = captureAgentEvents();
    const throwingDeps: LlmFallbackDeps = {
      checkAvailability: async (backend) => backend === 'claude_code',
      runOneShot: async () => {
        throw new Error('claude one-shot timed out');
      },
    };

    const decision = await triageRequest({
      workflowRequestId: 'wreq_degraded_stream_test' as never,
      userRequest: '增加一个 subtract 方法并补测试',
      messageHistory: [],
      preferredBackend: 'claude_code',
      llmDeps: throwingDeps,
    });

    expect(decision.decision.action).toBe('proceed');
    const eventOrder = events.map((event) =>
      event.type === 'meta' ? event.payload.event : event.type,
    );
    expect(eventOrder).toEqual(['cli_started', 'cli_finished', 'decided']);
    const decided = events.at(-1);
    expect(decided).toMatchObject({
      workflowRunId: null,
      workflowRequestId: 'wreq_degraded_stream_test',
      agentKind: 'claude_code',
      type: 'meta',
      payload: {
        event: 'decided',
        source: 'rules',
        action: 'proceed',
        routeCase: 'feature_clear',
        runType: 'feature',
      },
    });
    expect((decided?.payload.rulesFired as string[] | undefined) ?? []).toContain(
      'llm.degraded.invocation_failed',
    );
  });

  it('keeps rule proceed when no LLM backend is available', async () => {
    const noBackendDeps: LlmFallbackDeps = {
      checkAvailability: async () => false,
      runOneShot: async () => {
        throw new Error('should not be called');
      },
    };

    const decision = await triageRequest({
      workflowRequestId: 'wreq_unavailable_test' as never,
      userRequest: '增加一个 subtract 方法并补测试',
      messageHistory: [],
      llmDeps: noBackendDeps,
    });

    expect(decision.decision.action).toBe('proceed');
    expect(decision.source).toBe('rules');
    expect(decision.rulesFired).toContain('llm.degraded.unavailable');
  });

  it('honors LLM pause when LLM judged input ambiguous (invalid_json)', async () => {
    // When the LLM CLI returns malformed output (not a transient failure),
    // we MUST NOT silently route the user — the LLM-judged pause stands.
    const malformedDeps: LlmFallbackDeps = {
      checkAvailability: async () => true,
      runOneShot: async () =>
        // Wrap a non-JSON string in a stream-json line so the parser sees
        // text content but JSON.parse on the cleaned text fails.
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'this is not json' }] },
        }),
    };

    const decision = await triageRequest({
      workflowRequestId: 'wreq_invalid_json_test' as never,
      userRequest: '增加一个 subtract 方法并补测试',
      messageHistory: [],
      preferredBackend: 'claude_code',
      llmDeps: malformedDeps,
    });

    // Rule's proceed must NOT override an LLM that actually answered.
    expect(decision.decision.action).toBe('pause_for_human');
    expect(decision.source).toBe('llm');
  });

  it('does not degrade when rule itself paused (e.g. too short)', async () => {
    // Very-short input → rules emit pause with confidence 0.85 (≥ threshold),
    // LLM is never called, no degraded path triggers.
    const decision = await triageRequest({
      workflowRequestId: 'wreq_too_short_test' as never,
      userRequest: '?',
      messageHistory: [],
    });

    expect(decision.decision.action).toBe('pause_for_human');
    expect(decision.source).toBe('rules');
  });
});
