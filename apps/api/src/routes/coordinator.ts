import { Hono } from 'hono';
import {
  CONFIG_REGISTRY,
  classifyByRulesCore,
  deriveHint,
  type ClassifyHint,
} from '@ainp/shared';

// ---------------------------------------------------------------------------
// 2026-05-06 — Coordinator preview endpoint (dry-run rule classifier).
//
// Mirrors the contract style of `apps/api/src/routes/router.ts`:
//   - pure read-only endpoint, no DB writes, no LLM calls
//   - validates input at the boundary (4xx)
//   - returns 200 + structured JSON
//
// Used by the new-task UI to render "AI 判定: <runType>" before the user
// submits, so users don't have to pre-pick a Type from a dropdown. The
// preview fires alongside the existing /router/recommend dry-run; the UI
// merges both into one panel.
//
// Coordinator boundary (per .trellis/spec/api/backend/smart-router.md):
// the Coordinator is the upstream intent classifier — it produces
// `routeCase + runType` from text. This endpoint exposes the rule-based
// fast path of that same classifier (no LLM fallback) for UI hinting.
//
// MVP limitation:
//   keyword / regex / fallback values come from CONFIG_REGISTRY.default.
//   Runtime overrides written via PUT /config/overrides/* are NOT applied
//   here — preview may diverge from the actual coordinator decision when
//   overrides are present. Resolving overrides server-side is a follow-up
//   task; the runner-side `triageRequest` always reads overrides via
//   `getConfig` so the actual run is unaffected.
// ---------------------------------------------------------------------------

export const coordinator = new Hono();

interface PreviewRequest {
  title?: unknown;
}

export interface CoordinatorPreviewResponse {
  /**
   * Surface only when classifier `proceed`s. `pause_for_human` (too_short /
   * large_scope) returns null so the UI doesn't lie about a runType the
   * classifier didn't actually pick.
   */
  predictedRunType: 'feature' | 'bugfix' | 'smoke' | 'refactor' | null;
  /** 0..1 — same scale as the runner-side coordinator. */
  confidence: number;
  rulesFired: string[];
  /** Drives a yellow callout in the UI for too_short / large_scope cases. */
  hint: ClassifyHint;
}

coordinator.post('/preview', async (c) => {
  const body = (await c.req.json()) as PreviewRequest;

  if (typeof body.title !== 'string') {
    return c.json({ error: 'title required (string)' }, 400);
  }
  if (body.title.trim().length === 0) {
    return c.json({ error: 'title must not be empty' }, 400);
  }

  const result = classifyByRulesCore({
    userRequest: body.title,
    bugKeywords: CONFIG_REGISTRY['coordinator.bug_keywords']
      .default as readonly string[],
    featureKeywords: CONFIG_REGISTRY['coordinator.feature_keywords']
      .default as readonly string[],
    refactorKeywords: CONFIG_REGISTRY['coordinator.refactor_keywords']
      .default as readonly string[],
    largeScopeKeywords: CONFIG_REGISTRY['coordinator.large_scope_keywords']
      .default as readonly string[],
    largeScopeRegex: new RegExp(
      CONFIG_REGISTRY['coordinator.large_scope_regex'].default as string,
    ),
    fallbackTooShortQuestions: CONFIG_REGISTRY[
      'coordinator.fallback.too_short_questions'
    ].default as readonly string[],
    fallbackLargeScopeTemplate: CONFIG_REGISTRY[
      'coordinator.fallback.large_scope_template'
    ].default as string,
    fallbackLargeScopeFollowup: CONFIG_REGISTRY[
      'coordinator.fallback.large_scope_followup'
    ].default as string,
  });

  const decision = result.decision;
  const predictedRunType =
    decision.action === 'proceed' ? decision.runType : null;

  const response: CoordinatorPreviewResponse = {
    predictedRunType,
    confidence: result.confidence,
    rulesFired: result.rulesFired,
    hint: deriveHint(result.rulesFired),
  };
  return c.json(response, 200);
});
