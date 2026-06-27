import { describe, expect, test } from 'vitest';
import type { AgentSession, AgentSessionLink } from '../src';
import { AGENT_SESSION_STATUSES, isAgentSessionStatus } from '../src';

describe('AgentSession shared contract', () => {
  test('status guard accepts only trajectory session statuses', () => {
    expect(AGENT_SESSION_STATUSES).toEqual(['running', 'success', 'failed', 'cancelled']);
    expect(isAgentSessionStatus('running')).toBe(true);
    expect(isAgentSessionStatus('success')).toBe(true);
    expect(isAgentSessionStatus('passed')).toBe(false);
    expect(isAgentSessionStatus(null)).toBe(false);
  });

  test('session shape supports normal invocation and retry linkage', () => {
    const retryLink: AgentSessionLink = {
      kind: 'retry',
      parentSessionId: 'ags_parent',
      retryIndex: 1,
      reason: 'context_request supplement',
    };
    const session: AgentSession = {
      id: 'ags_retry',
      workflowRunId: 'run_1',
      stepRunId: 'step_1',
      agentTaskId: 'agt_1',
      agentResultId: null,
      backend: 'codex',
      stage: 'implementation',
      skillId: 'skill.implementation',
      skillVersion: '1.0.0',
      contextPackId: 'ctx_1',
      parentSessionId: retryLink.parentSessionId,
      retryIndex: retryLink.retryIndex,
      status: 'running',
      startedAt: '2026-06-27T00:00:00.000Z',
      completedAt: null,
      metadata: { link: retryLink },
    };

    expect(session.parentSessionId).toBe('ags_parent');
    expect(session.retryIndex).toBe(1);
    expect(session.metadata.link).toMatchObject({ kind: 'retry' });
  });
});
