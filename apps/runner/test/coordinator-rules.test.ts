import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classifyByRules } from '../src/agents/coordinator/rules';
import { invalidateConfigCache } from '../src/config-client';

const realFetch = globalThis.fetch;

beforeEach(() => {
  invalidateConfigCache();
  // Pretend the API is up but has no overrides — getConfig will fall
  // through to the registry defaults (which mirror the byte-for-byte
  // pre-PR2 hardcoded values).
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ overrides: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('classifyByRules', () => {
  it('classifies clear bug reports as bugfix with high confidence', async () => {
    const r = await classifyByRules({
      userRequest: '点击报告导出按钮后弹出空白对话框，预期应下载 markdown 但实际不工作',
      messageHistory: [],
    });
    expect(r.decision.action).toBe('proceed');
    if (r.decision.action === 'proceed') {
      expect(r.decision.routeCase).toBe('bugfix');
      expect(r.decision.runType).toBe('bugfix');
    }
    expect(r.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('classifies clear feature requests as feature_clear', async () => {
    const r = await classifyByRules({
      userRequest: '为报告页增加导出 Markdown 按钮，验收标准是 mvn test 通过',
      messageHistory: [],
    });
    expect(r.decision.action).toBe('proceed');
    if (r.decision.action === 'proceed') {
      expect(r.decision.routeCase).toBe('feature_clear');
      expect(r.decision.runType).toBe('feature');
    }
  });

  it('flags vague one-word requests as needing clarification', async () => {
    const r = await classifyByRules({
      userRequest: '权限',
      messageHistory: [],
    });
    expect(r.decision.action).toBe('pause_for_human');
    if (r.decision.action === 'pause_for_human') {
      expect(r.decision.questions.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('flags large-scope requests as needing decomposition', async () => {
    const r = await classifyByRules({
      userRequest: '我想要一个完整的权限系统，包括用户、角色、资源、审计',
      messageHistory: [],
    });
    expect(r.decision.action).toBe('pause_for_human');
    if (r.decision.action === 'pause_for_human') {
      expect(r.decision.reason).toMatch(/scope|系统|权限|大|decompose/i);
    }
  });

  it('returns low confidence for ambiguous requests so LLM fallback can take over', async () => {
    const r = await classifyByRules({
      userRequest: '稍微调整一下这块的处理逻辑就行',
      messageHistory: [],
    });
    expect(r.confidence).toBeLessThan(0.65);
  });

  it('always reports rulesFired so the audit trail can show why', async () => {
    const r = await classifyByRules({
      userRequest: '点击按钮报错',
      messageHistory: [],
    });
    expect(r.rulesFired.length).toBeGreaterThan(0);
    for (const id of r.rulesFired) expect(id).toMatch(/^rule\./);
  });

  it('honours UI overrides — adding "panic" to bug_keywords classifies "服务 panic 了" as bugfix', async () => {
    invalidateConfigCache();
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          overrides: {
            'coordinator.bug_keywords': {
              key: 'coordinator.bug_keywords',
              scope: 'global',
              valueJson: JSON.stringify(['panic', 'oops']),
              updatedAt: '2026-01-01T00:00:00Z',
              updatedBy: 'test',
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch;

    const r = await classifyByRules({
      userRequest: '服务 panic 了，oops 全炸了',
      messageHistory: [],
    });
    expect(r.decision.action).toBe('proceed');
    if (r.decision.action === 'proceed') {
      expect(r.decision.routeCase).toBe('bugfix');
    }
    expect(r.rulesFired).toContain('rule.bug_keywords_dominant');
  });

  it('classifies Chinese refactor requests as refactor with refactor_clear route', async () => {
    const r = await classifyByRules({
      userRequest: '重构 user 模块，把 auth 抽离成独立 service',
      messageHistory: [],
    });
    expect(r.decision.action).toBe('proceed');
    if (r.decision.action === 'proceed') {
      expect(r.decision.routeCase).toBe('refactor_clear');
      expect(r.decision.runType).toBe('refactor');
    }
    expect(r.rulesFired).toContain('rule.refactor_keywords_dominant');
  });

  it('classifies English refactor requests as refactor', async () => {
    const r = await classifyByRules({
      userRequest: 'refactor the auth flow and extract a helper module',
      messageHistory: [],
    });
    expect(r.decision.action).toBe('proceed');
    if (r.decision.action === 'proceed') {
      expect(r.decision.runType).toBe('refactor');
    }
    expect(r.rulesFired).toContain('rule.refactor_keywords_dominant');
  });

  it('refactor branch fires before bug-vs-feature for "优化 query 性能"', async () => {
    const r = await classifyByRules({
      userRequest: '优化 query 性能，目标减少 50% 时间',
      messageHistory: [],
    });
    expect(r.decision.action).toBe('proceed');
    if (r.decision.action === 'proceed') {
      expect(r.decision.runType).toBe('refactor');
    }
  });

  it('refactor keyword in too-short input still triggers too_short (length < 6 wins)', async () => {
    const r = await classifyByRules({
      userRequest: '重构',
      messageHistory: [],
    });
    expect(r.decision.action).toBe('pause_for_human');
    expect(r.rulesFired).toContain('rule.too_short');
  });
});
