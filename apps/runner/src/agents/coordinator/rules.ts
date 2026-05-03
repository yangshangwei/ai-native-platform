import type { CoordinatorAction } from '@ainp/shared';

/**
 * Rule-based first-pass classifier for Coordinator triage.
 *
 * Mirrors cs-brainstorm's three cases (case 1 / 2 / 3) plus a bugfix track:
 *
 *   - Very short input → pause_for_human ("not enough to triage")
 *   - Large-scope keyword (X 系统 / SSO / 完整的 ...) → pause_for_human
 *     ("decompose first")
 *   - Bug-leaning vocabulary (报错 / 异常 / 期望 vs 实际) dominant → bugfix
 *   - Feature-leaning vocabulary (增加 / 加一个 / 实现) dominant → feature_clear
 *   - Otherwise: emit a low-confidence default so the LLM fallback in the
 *     parent agent picks it up. Never silently classify ambiguous input.
 *
 * Returns a structured ClassifyOutput; the parent agent wraps it as a
 * CoordinatorDecision and persists it via the API.
 */

export interface ClassifyInput {
  userRequest: string;
  messageHistory: { role: 'user' | 'coordinator'; content: string }[];
}

export interface ClassifyOutput {
  decision: CoordinatorAction;
  /** 0..1; ≥0.65 means rules are confident enough that the LLM fallback is skipped. */
  confidence: number;
  rulesFired: string[];
}

const BUG_KEYWORDS = [
  'bug',
  '错误',
  '异常',
  '报错',
  '崩溃',
  '失败',
  'crash',
  'error',
  '弹出空白',
  '无法',
  '不能',
  '不工作',
  '不对',
  '应该',
  '预期',
  '实际',
];

const FEATURE_KEYWORDS = [
  '增加',
  '新增',
  '加一个',
  '加个',
  '添加',
  '实现',
  '做一个',
  '支持',
  'add',
  'implement',
  'support',
  '希望',
  '验收标准',
  'acceptance',
];

// Keywords that signal "this is a multi-feature initiative, not a single feature."
const LARGE_SCOPE_KEYWORDS = [
  '完整的',
  '一整套',
  '一套',
  '整个',
  'sso',
  '权限系统',
  '通知系统',
  '用户系统',
  '认证体系',
  '审计体系',
  // bare "X 系统" pattern is handled separately as a regex.
];

const MULTI_NOUN_SYSTEM_RE = /(\S+?\s*系统|\S+?\s*体系)/;

function countMatches(text: string, keywords: string[]): { count: number; hits: string[] } {
  const lower = text.toLowerCase();
  const hits = keywords.filter((kw) => lower.includes(kw.toLowerCase()));
  return { count: hits.length, hits };
}

export function classifyByRules(input: ClassifyInput): ClassifyOutput {
  const text = input.userRequest.trim();
  const rulesFired: string[] = [];

  // Rule 1: very short → can't triage
  if (text.length < 6) {
    rulesFired.push('rule.too_short');
    return {
      decision: {
        action: 'pause_for_human',
        questions: [
          '能再描述一下吗？这是哪个场景下出现的？例如"在哪儿"、"做了什么"、"看到什么"。',
          '主要是修复现有问题，还是新增能力？',
        ],
        reason: 'request too short to triage',
      },
      confidence: 0.85,
      rulesFired,
    };
  }

  const bug = countMatches(text, BUG_KEYWORDS);
  const feature = countMatches(text, FEATURE_KEYWORDS);
  const largeScope = countMatches(text, LARGE_SCOPE_KEYWORDS);
  const systemPattern = MULTI_NOUN_SYSTEM_RE.test(text);

  // Rule 2: large-scope signals → pause for decomposition
  if ((largeScope.count >= 1 || systemPattern) && text.length > 8) {
    rulesFired.push('rule.large_scope_detected');
    const trigger = largeScope.hits[0] ?? text.match(MULTI_NOUN_SYSTEM_RE)?.[0] ?? 'system';
    return {
      decision: {
        action: 'pause_for_human',
        questions: [
          `这听起来是个比较大的需求（涉及"${trigger}"）。能不能先列出 2-3 个最优先的子能力？`,
          '有没有一个最小闭环可以先做出来端到端跑通？',
        ],
        reason: `large scope detected: ${trigger}; decompose first`,
      },
      confidence: 0.75,
      rulesFired,
    };
  }

  // Rule 3: bug-vs-feature lean
  const ratio = bug.count - feature.count;
  if (ratio >= 2) {
    rulesFired.push('rule.bug_keywords_dominant');
    return {
      decision: {
        action: 'proceed',
        routeCase: 'bugfix',
        runType: 'bugfix',
        reason: `bug keywords dominate: ${bug.hits.slice(0, 3).join(', ')}`,
      },
      confidence: Math.min(0.95, 0.6 + bug.count * 0.08),
      rulesFired,
    };
  }
  if (ratio <= -2 && text.length > 20) {
    rulesFired.push('rule.feature_keywords_dominant');
    return {
      decision: {
        action: 'proceed',
        routeCase: 'feature_clear',
        runType: 'feature',
        reason: `feature keywords dominate: ${feature.hits.slice(0, 3).join(', ')}`,
      },
      confidence: Math.min(0.9, 0.55 + feature.count * 0.08),
      rulesFired,
    };
  }

  // Default: ambiguous, low confidence so LLM fallback runs.
  rulesFired.push('rule.ambiguous');
  return {
    decision: {
      action: 'proceed',
      routeCase: 'feature_clear',
      runType: 'feature',
      reason: 'no dominant keyword class; default to feature, expect LLM verification',
    },
    confidence: 0.4,
    rulesFired,
  };
}
