import { describe, expect, test } from 'vitest';
import type { AgentStreamEvent } from '@ainp/shared';
import { publish, subscribe, subscriberCount } from '../src/agent-stream-bus';

function makeEvent(
  channel: { workflowRunId?: string | null; workflowRequestId?: string | null },
  sequence = 0,
): AgentStreamEvent {
  return {
    id: `aev_${sequence}`,
    workflowRunId: channel.workflowRunId ?? null,
    workflowRequestId: channel.workflowRequestId ?? null,
    stepRunId: null,
    agentKind: 'claude_code',
    sequence,
    type: 'meta',
    payload: { event: 'started' },
    text: '[meta:started]',
    ts: '2026-05-10T00:00:00.000Z',
  };
}

describe('agent-stream-bus PR1: channel isolation', () => {
  test('run channel and request channel route independently', () => {
    const runEvents: AgentStreamEvent[] = [];
    const reqEvents: AgentStreamEvent[] = [];
    const offRun = subscribe({ kind: 'run', id: 'wfr_iso_a' }, (e) => runEvents.push(e));
    const offReq = subscribe({ kind: 'request', id: 'wfr_iso_a' }, (e) => reqEvents.push(e));

    publish(makeEvent({ workflowRunId: 'wfr_iso_a' }, 0));
    publish(makeEvent({ workflowRequestId: 'wfr_iso_a' }, 0));

    expect(runEvents).toHaveLength(1);
    expect(runEvents[0]!.workflowRunId).toBe('wfr_iso_a');
    expect(reqEvents).toHaveLength(1);
    expect(reqEvents[0]!.workflowRequestId).toBe('wfr_iso_a');

    offRun();
    offReq();
  });

  test('multiple subscribers on the same channel all receive', () => {
    const a: number[] = [];
    const b: number[] = [];
    const offA = subscribe({ kind: 'run', id: 'wfr_multi' }, (e) => a.push(e.sequence));
    const offB = subscribe({ kind: 'run', id: 'wfr_multi' }, (e) => b.push(e.sequence));

    publish(makeEvent({ workflowRunId: 'wfr_multi' }, 1));
    publish(makeEvent({ workflowRunId: 'wfr_multi' }, 2));

    expect(a).toEqual([1, 2]);
    expect(b).toEqual([1, 2]);

    offA();
    offB();
  });

  test('unsubscribe stops delivery without disturbing other subscribers', () => {
    const a: number[] = [];
    const b: number[] = [];
    const offA = subscribe({ kind: 'run', id: 'wfr_unsub' }, (e) => a.push(e.sequence));
    const offB = subscribe({ kind: 'run', id: 'wfr_unsub' }, (e) => b.push(e.sequence));

    publish(makeEvent({ workflowRunId: 'wfr_unsub' }, 1));
    offA();
    publish(makeEvent({ workflowRunId: 'wfr_unsub' }, 2));

    expect(a).toEqual([1]);
    expect(b).toEqual([1, 2]);

    offB();
  });

  test('subscriberCount tracks per-channel and goes to zero after unsubscribe', () => {
    expect(subscriberCount({ kind: 'request', id: 'wfr_count' })).toBe(0);
    const off = subscribe({ kind: 'request', id: 'wfr_count' }, () => {});
    expect(subscriberCount({ kind: 'request', id: 'wfr_count' })).toBe(1);
    expect(subscriberCount({ kind: 'run', id: 'wfr_count' })).toBe(0); // different channel kind, same id
    off();
    expect(subscriberCount({ kind: 'request', id: 'wfr_count' })).toBe(0);
  });

  test('events with neither id are silently dropped', () => {
    const recv: AgentStreamEvent[] = [];
    const off = subscribe({ kind: 'run', id: 'wfr_neither' }, (e) => recv.push(e));
    publish(makeEvent({}, 0));
    expect(recv).toHaveLength(0);
    off();
  });

  test('subscriber failures do not stop other listeners', () => {
    const calls: string[] = [];
    const offA = subscribe({ kind: 'run', id: 'wfr_throw' }, () => {
      calls.push('a');
      throw new Error('boom');
    });
    const offB = subscribe({ kind: 'run', id: 'wfr_throw' }, () => {
      calls.push('b');
    });

    publish(makeEvent({ workflowRunId: 'wfr_throw' }, 0));

    expect(calls).toEqual(['a', 'b']);

    offA();
    offB();
  });
});
