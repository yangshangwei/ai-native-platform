import type { CoordinatorAction } from '@ainp/shared';
import { classifyByRulesCore } from '@ainp/shared';
import { getConfig } from '../../config-client';

/**
 * Rule-based first-pass classifier for Coordinator triage.
 *
 * (PR2) Keyword dictionaries, large-scope regex, confidence weights, and
 * fallback question strings are read from the runtime config layer via
 * `getConfig()`. When no override is present, `getConfig` falls back to
 * the byte-for-byte defaults transcribed in
 * `packages/shared/src/config/defaults.ts`.
 *
 * (2026-05-06 refactor) The decision algorithm itself moved to
 * `packages/shared/src/coordinator/rules-core.ts` so the API layer
 * (`POST /coordinator/preview`) can reuse it without a runner round-trip.
 * This file is now a thin async wrapper that resolves runtime config and
 * delegates to the shared pure core. The newly-added refactor branch
 * (rule.refactor_keywords_dominant) lives in the shared core.
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

export async function classifyByRules(input: ClassifyInput): Promise<ClassifyOutput> {
  const [
    bugKeywords,
    featureKeywords,
    refactorKeywords,
    largeScopeKeywords,
    largeScopeRegexSrc,
    fallbackTooShortQuestions,
    fallbackLargeScopeTemplate,
    fallbackLargeScopeFollowup,
  ] = await Promise.all([
    getConfig('coordinator.bug_keywords'),
    getConfig('coordinator.feature_keywords'),
    getConfig('coordinator.refactor_keywords'),
    getConfig('coordinator.large_scope_keywords'),
    getConfig('coordinator.large_scope_regex'),
    getConfig('coordinator.fallback.too_short_questions'),
    getConfig('coordinator.fallback.large_scope_template'),
    getConfig('coordinator.fallback.large_scope_followup'),
  ]);

  return classifyByRulesCore({
    userRequest: input.userRequest,
    bugKeywords,
    featureKeywords,
    refactorKeywords,
    largeScopeKeywords,
    largeScopeRegex: new RegExp(largeScopeRegexSrc),
    fallbackTooShortQuestions,
    fallbackLargeScopeTemplate,
    fallbackLargeScopeFollowup,
  });
}
