import { applyTemplate } from '../config/template';
import type { CoordinatorAction } from '../types/coordinator';

/**
 * Pure rule-based classifier — moved out of `apps/runner/src/agents/coordinator/rules.ts`
 * so the API layer (`POST /coordinator/preview`) can reuse the same logic
 * for dry-run UI hints without a runner round-trip.
 *
 * Pure: no IO, no `getConfig`, no `process.env`. All keyword dictionaries,
 * regex source, and fallback question strings come in as parameters; the
 * runner-side wrapper resolves them via `getConfig`, the API-side wrapper
 * resolves them from `CONFIG_REGISTRY` defaults.
 *
 * Decision rules (order matters):
 *   1. Very short (< 6 chars) → `pause_for_human` (rule.too_short).
 *   2. Large-scope keyword OR `X系统/Y体系` regex hit (length > 8) → `pause_for_human`
 *      (rule.large_scope_detected). Asks user to decompose.
 *   3. Refactor keywords dominate (count ≥ 1, length > 8) → proceed/refactor
 *      (rule.refactor_keywords_dominant). Refactor verbs (优化 / 重构) are
 *      neither bug nor feature, so this MUST precede the bug-vs-feature ratio
 *      check below — otherwise "重构 user 模块" would fall through to the
 *      ambiguous default.
 *   4. Bug count − feature count ≥ 2 → proceed/bugfix
 *      (rule.bug_keywords_dominant).
 *   5. Feature count − bug count ≥ 2 (length > 20) → proceed/feature
 *      (rule.feature_keywords_dominant).
 *   6. Otherwise → proceed/feature with low confidence (rule.ambiguous);
 *      runner-side wrapper's threshold check will trigger LLM fallback.
 *
 * Confidence is conservative on purpose: it controls whether the runner-side
 * `triageRequest` skips LLM fallback. The API preview endpoint uses the
 * confidence + rulesFired purely for display; it never gates anything.
 */

export interface ClassifyCoreInput {
  userRequest: string;
  bugKeywords: readonly string[];
  featureKeywords: readonly string[];
  refactorKeywords: readonly string[];
  largeScopeKeywords: readonly string[];
  /** Compiled regex matching the "X系统 / Y体系" pattern. Caller is responsible for compilation. */
  largeScopeRegex: RegExp;
  fallbackTooShortQuestions: readonly string[];
  /** Template string with `${trigger}` placeholder; substituted via `applyTemplate`. */
  fallbackLargeScopeTemplate: string;
  fallbackLargeScopeFollowup: string;
}

export interface ClassifyCoreOutput {
  decision: CoordinatorAction;
  /** 0..1; runner threshold ≥ 0.65 skips LLM fallback. */
  confidence: number;
  rulesFired: string[];
}

/** UI-facing hint surfaced by the preview endpoint and rendered as a yellow callout. */
export type ClassifyHint = 'too_short' | 'large_scope' | null;

function countMatches(
  text: string,
  keywords: readonly string[],
): { count: number; hits: string[] } {
  const lower = text.toLowerCase();
  const hits = keywords.filter((kw) => lower.includes(kw.toLowerCase()));
  return { count: hits.length, hits };
}

export function classifyByRulesCore(input: ClassifyCoreInput): ClassifyCoreOutput {
  const text = input.userRequest.trim();
  const rulesFired: string[] = [];

  if (text.length < 6) {
    rulesFired.push('rule.too_short');
    return {
      decision: {
        action: 'pause_for_human',
        questions: [...input.fallbackTooShortQuestions],
        reason: 'request too short to triage',
      },
      confidence: 0.85,
      rulesFired,
    };
  }

  const bug = countMatches(text, input.bugKeywords);
  const feature = countMatches(text, input.featureKeywords);
  const refactor = countMatches(text, input.refactorKeywords);
  const largeScope = countMatches(text, input.largeScopeKeywords);
  const systemPattern = input.largeScopeRegex.test(text);

  if ((largeScope.count >= 1 || systemPattern) && text.length > 8) {
    rulesFired.push('rule.large_scope_detected');
    const trigger =
      largeScope.hits[0] ?? text.match(input.largeScopeRegex)?.[0] ?? 'system';
    return {
      decision: {
        action: 'pause_for_human',
        questions: [
          applyTemplate(input.fallbackLargeScopeTemplate, { trigger }),
          input.fallbackLargeScopeFollowup,
        ],
        reason: `large scope detected: ${trigger}; decompose first`,
      },
      confidence: 0.75,
      rulesFired,
    };
  }

  // Refactor MUST come before bug/feature ratio — refactor verbs are neither.
  if (refactor.count >= 1 && text.length > 8) {
    rulesFired.push('rule.refactor_keywords_dominant');
    return {
      decision: {
        action: 'proceed',
        routeCase: 'refactor_clear',
        runType: 'refactor',
        reason: `refactor keywords dominate: ${refactor.hits.slice(0, 3).join(', ')}`,
      },
      confidence: Math.min(0.9, 0.6 + refactor.count * 0.08),
      rulesFired,
    };
  }

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

/**
 * Surface a UI-friendly hint based on which rules fired. Returns null when
 * the classifier produced a normal `proceed` decision the UI doesn't need
 * to flag. Used by `POST /coordinator/preview` to drive yellow callouts.
 */
export function deriveHint(rulesFired: string[]): ClassifyHint {
  if (rulesFired.includes('rule.too_short')) return 'too_short';
  if (rulesFired.includes('rule.large_scope_detected')) return 'large_scope';
  return null;
}
