import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import type { CoordinatorDecision, RequestMessage } from '@ainp/shared';

process.env.AINP_DB_PATH = join(mkdtempSync(join(tmpdir(), 'ainp-coord-store-')), 'ainp.sqlite');

let store: typeof import('../src/store/store').store;

beforeAll(async () => {
  store = (await import('../src/store/store')).store;
});

function decision(reqId: string, overrides: Partial<CoordinatorDecision> = {}): CoordinatorDecision {
  return {
    id: `coord_${Math.random().toString(16).slice(2)}`,
    workflowRequestId: reqId,
    workflowRunId: null,
    source: 'rules',
    decision: { action: 'proceed', routeCase: 'feature_clear', runType: 'feature', reason: 'test' },
    confidence: 0.9,
    rulesFired: ['rule.example'],
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

function message(reqId: string, overrides: Partial<RequestMessage> = {}): RequestMessage {
  return {
    id: `msg_${Math.random().toString(16).slice(2)}`,
    workflowRequestId: reqId,
    role: 'user',
    content: 'hello',
    coordinatorDecisionId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('coordinatorDecisions repo', () => {
  test('insert + latestForRequest roundtrips a proceed decision', () => {
    const reqId = 'wfreq_proceed_1';
    const d = decision(reqId, { confidence: 0.92, rulesFired: ['rule.has_action_verb'] });
    store.coordinatorDecisions.insert(d);

    const got = store.coordinatorDecisions.latestForRequest(reqId);
    expect(got).not.toBeNull();
    expect(got!.id).toBe(d.id);
    expect(got!.confidence).toBe(0.92);
    expect(got!.rulesFired).toEqual(['rule.has_action_verb']);
    expect(got!.decision.action).toBe('proceed');
    if (got!.decision.action === 'proceed') {
      expect(got!.decision.routeCase).toBe('feature_clear');
      expect(got!.decision.runType).toBe('feature');
    }
  });

  test('latestForRequest returns the most recent decision for a request', () => {
    const reqId = 'wfreq_multi_1';
    store.coordinatorDecisions.insert(decision(reqId, { confidence: 0.4, decidedAt: '2026-05-03T10:00:00.000Z' }));
    store.coordinatorDecisions.insert(decision(reqId, { confidence: 0.8, decidedAt: '2026-05-03T10:00:01.000Z' }));
    const got = store.coordinatorDecisions.latestForRequest(reqId);
    expect(got!.confidence).toBe(0.8);
  });

  test('preserves pause_for_human action shape including questions array', () => {
    const reqId = 'wfreq_pause_1';
    store.coordinatorDecisions.insert(
      decision(reqId, {
        decision: {
          action: 'pause_for_human',
          questions: ['scope?', 'timeline?'],
          reason: 'too vague',
        },
        confidence: 0.85,
      }),
    );
    const got = store.coordinatorDecisions.latestForRequest(reqId);
    expect(got!.decision.action).toBe('pause_for_human');
    if (got!.decision.action === 'pause_for_human') {
      expect(got!.decision.questions).toEqual(['scope?', 'timeline?']);
      expect(got!.decision.reason).toBe('too vague');
    }
  });

  test('returns null when no decision exists for the request', () => {
    expect(store.coordinatorDecisions.latestForRequest('wfreq_nope')).toBeNull();
  });
});

describe('requestMessages repo', () => {
  test('lists messages for a request in created_at order', () => {
    const reqId = 'wfreq_chat_1';
    store.requestMessages.insert(message(reqId, { role: 'user', content: 'first', createdAt: '2026-05-03T10:00:00.000Z' }));
    store.requestMessages.insert(message(reqId, { role: 'coordinator', content: 'second', createdAt: '2026-05-03T10:00:01.000Z' }));
    store.requestMessages.insert(message(reqId, { role: 'user', content: 'third', createdAt: '2026-05-03T10:00:02.000Z' }));

    const all = store.requestMessages.listForRequest(reqId);
    expect(all.map((m) => m.content)).toEqual(['first', 'second', 'third']);
    expect(all[1]!.role).toBe('coordinator');
  });

  test('isolates messages by request id', () => {
    store.requestMessages.insert(message('wfreq_iso_a', { content: 'A1' }));
    store.requestMessages.insert(message('wfreq_iso_b', { content: 'B1' }));
    expect(store.requestMessages.listForRequest('wfreq_iso_a').map((m) => m.content)).toEqual(['A1']);
    expect(store.requestMessages.listForRequest('wfreq_iso_b').map((m) => m.content)).toEqual(['B1']);
  });

  test('preserves coordinatorDecisionId link when set', () => {
    const reqId = 'wfreq_link_1';
    store.requestMessages.insert(
      message(reqId, { role: 'coordinator', content: 'q?', coordinatorDecisionId: 'coord_xyz' }),
    );
    const all = store.requestMessages.listForRequest(reqId);
    expect(all[0]!.coordinatorDecisionId).toBe('coord_xyz');
  });
});
