# Extend Grill Me to Ask Routing

## Goal

When `coordinator.clarification_style=grill-me`, read-only `ask` requests should also pass through a lightweight Grill Me gate when the question is ambiguous, high-risk, or likely to be a disguised implementation/bugfix request. Simple answerable `ask` requests should remain direct Q&A.

## What I Already Know

* User accepted the recommended policy: do not make every ask mechanically multi-round, but do let Grill Me deepen ask requests when configured.
* Current `rules-core` classifies ask-like text as `proceed/runType=ask` with high confidence before refactor detection.
* Current `triageRequest()` only forces Grill Me LLM routing when the rule result is `pause_for_human`.
* Current `kind='ask'` requests use `status='awaiting_clarification'` and do not enter runner watch; this task targets Coordinator routing/preview behavior, not a new executable ask flow.
* Previous task added `.trellis/spec/runner/backend/coordinator-clarification.md`; it currently says read-only ask is out of scope and must be updated.

## Requirements

* If `coordinator.clarification_style !== 'grill-me'`, preserve current ask behavior.
* If `coordinator.clarification_style === 'grill-me'`, rule-detected ask requests should be eligible for LLM Grill Me review instead of always short-circuiting on rules.
* The LLM may still return `proceed/runType=ask` immediately for simple, answerable questions.
* The LLM may return `pause_for_human` with exactly one Grill Me question for ambiguous/high-risk ask requests.
* The existing max clarification round cap must still apply; after the cap is reached, ask-related Grill Me should stop asking and produce a non-question terminal decision.
* Default-style ask behavior must remain unchanged.

## Acceptance Criteria

* [x] With `clarification_style=grill-me`, a rule-detected ask request calls `classifyByLlm()` instead of returning the rules result directly.
* [x] With `clarification_style=grill-me`, if the LLM returns `proceed/runType=ask`, the final decision remains ask.
* [x] With `clarification_style=grill-me`, if the LLM returns multiple clarification questions for ask, only the first question is retained.
* [x] With `clarification_style=default`, a rule-detected ask request remains rule-classified without LLM.
* [x] Existing Grill Me clarification and Coordinator tests continue to pass.

## Definition of Done

* Focused tests added for ask + Grill Me routing.
* Typecheck and full test suite pass.
* Coordinator clarification code-spec updated.
* No new dependencies.

## Out of Scope

* Building an `ask.standard` workflow.
* Changing Web settings UI.
* Changing workflow request persistence or `kind='ask'` schema.
* Forcing every simple ask to ask a follow-up question.

## Technical Approach

* Extend `triageRequest()` policy so `clarification_style=grill-me` routes rule-detected ask decisions through `classifyByLlm()`.
* Keep default-style rule short-circuit unchanged.
* Reuse existing Grill Me prompt and single-question enforcement in `classifyByLlm()`.
* Update the Coordinator clarification code-spec to include ask gate behavior.
* Update the LLM decision parser to preserve `routeCase='ask'` and `runType='ask'` instead of normalizing them to feature.

## Decision

Context: ask requests are not workflow clarification, but user expects the same configured Grill Me style to deepen ambiguous questions.

Decision: use a lightweight LLM gate only when Grill Me is enabled. Rules still detect ask as cheap evidence, but they do not final-short-circuit ask under Grill Me.

Consequences: simple ask can still proceed immediately if the LLM says it is answerable; ambiguous ask can pause for one Grill Me question. This costs an LLM call for ask requests under Grill Me but makes the configuration semantically consistent.

## Verification

* `bun x --bun vitest run apps/runner/test/coordinator-grill-me-routing.test.ts`
* `bun x --bun vitest run apps/runner/test/coordinator-*.test.ts`
* `bun run typecheck`
* `bun run test`
