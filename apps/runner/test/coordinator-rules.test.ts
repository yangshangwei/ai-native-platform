import { describe, expect, it } from 'vitest';
import { classifyByRules } from '../src/agents/coordinator/rules';

describe('classifyByRules', () => {
  it('classifies clear bug reports as bugfix with high confidence', () => {
    const r = classifyByRules({
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

  it('classifies clear feature requests as feature_clear', () => {
    const r = classifyByRules({
      userRequest: '为报告页增加导出 Markdown 按钮，验收标准是 mvn test 通过',
      messageHistory: [],
    });
    expect(r.decision.action).toBe('proceed');
    if (r.decision.action === 'proceed') {
      expect(r.decision.routeCase).toBe('feature_clear');
      expect(r.decision.runType).toBe('feature');
    }
  });

  it('flags vague one-word requests as needing clarification', () => {
    const r = classifyByRules({
      userRequest: '权限',
      messageHistory: [],
    });
    expect(r.decision.action).toBe('pause_for_human');
    if (r.decision.action === 'pause_for_human') {
      expect(r.decision.questions.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('flags large-scope requests as needing decomposition', () => {
    const r = classifyByRules({
      userRequest: '我想要一个完整的权限系统，包括用户、角色、资源、审计',
      messageHistory: [],
    });
    expect(r.decision.action).toBe('pause_for_human');
    if (r.decision.action === 'pause_for_human') {
      expect(r.decision.reason).toMatch(/scope|系统|权限|大|decompose/i);
    }
  });

  it('returns low confidence for ambiguous requests so LLM fallback can take over', () => {
    const r = classifyByRules({
      userRequest: '稍微调整一下这块的处理逻辑就行',
      messageHistory: [],
    });
    expect(r.confidence).toBeLessThan(0.65);
  });

  it('always reports rulesFired so the audit trail can show why', () => {
    const r = classifyByRules({
      userRequest: '点击按钮报错',
      messageHistory: [],
    });
    expect(r.rulesFired.length).toBeGreaterThan(0);
    for (const id of r.rulesFired) expect(id).toMatch(/^rule\./);
  });
});
