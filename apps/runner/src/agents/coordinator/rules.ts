import type { CoordinatorAction } from '@ainp/shared';
import { applyTemplate } from '@ainp/shared';
import { getConfig } from '../../config-client';

/**
 * Rule-based first-pass classifier for Coordinator triage.
 *
 * (PR2) Keyword dictionaries, the large-scope regex, the confidence
 * weights, and the fallback question strings are now read from the
 * runtime config layer via `getConfig()`. When no override is present,
 * `getConfig` falls back to the byte-for-byte defaults transcribed in
 * `packages/shared/src/config/defaults.ts`. Behaviour is unchanged in
 * the absence of overrides.
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
  /** 0..1; ≥ threshold means rules are confident enough that the LLM fallback is skipped. */
  confidence: number;
  rulesFired: string[];
  /**
   * Set by `classifyByLlm` when its `pause_for_human` was caused by a
   * transient/availability failure (CLI throw, empty output, no backend
   * available) rather than the LLM judging the input ambiguous. The
   * coordinator entry uses this to fall back to the rule classifier's
   * earlier `proceed` instead of asking the user to clarify a request the
   * rule layer already considered routable.
   *
   * `invalid_json` / `unknown_action` are NOT transient — they mean the LLM
   * answered but the answer was malformed, which is real ambiguity.
   */
  failureKind?: 'invocation_failed' | 'empty' | 'unavailable' | null;
}

function countMatches(
  text: string,
  keywords: readonly string[],
): { count: number; hits: string[] } {
  const lower = text.toLowerCase();
  const hits = keywords.filter((kw) => lower.includes(kw.toLowerCase()));
  return { count: hits.length, hits };
}

export async function classifyByRules(input: ClassifyInput): Promise<ClassifyOutput> {
  const text = input.userRequest.trim();
  const rulesFired: string[] = [];

  // Rule 1: very short → can't triage
  if (text.length < 6) {
    rulesFired.push('rule.too_short');
    const questions = await getConfig('coordinator.fallback.too_short_questions');
    return {
      decision: {
        action: 'pause_for_human',
        questions: [...questions],
        reason: 'request too short to triage',
      },
      confidence: 0.85,
      rulesFired,
    };
  }

  const bugKeywords = await getConfig('coordinator.bug_keywords');
  const featureKeywords = await getConfig('coordinator.feature_keywords');
  const largeScopeKeywords = await getConfig('coordinator.large_scope_keywords');
  const largeScopeRegexSrc = await getConfig('coordinator.large_scope_regex');
  const largeScopeRegex = new RegExp(largeScopeRegexSrc);

  const bug = countMatches(text, bugKeywords);
  const feature = countMatches(text, featureKeywords);
  const largeScope = countMatches(text, largeScopeKeywords);
  const systemPattern = largeScopeRegex.test(text);

  // Rule 2: large-scope signals → pause for decomposition
  if ((largeScope.count >= 1 || systemPattern) && text.length > 8) {
    rulesFired.push('rule.large_scope_detected');
    const trigger = largeScope.hits[0] ?? text.match(largeScopeRegex)?.[0] ?? 'system';
    const template = await getConfig('coordinator.fallback.large_scope_template');
    const followup = await getConfig('coordinator.fallback.large_scope_followup');
    return {
      decision: {
        action: 'pause_for_human',
        questions: [applyTemplate(template, { trigger }), followup],
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
