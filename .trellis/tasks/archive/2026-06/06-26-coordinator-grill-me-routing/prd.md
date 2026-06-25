# Fix Coordinator Grill Me Routing

## Goal

Make Grill Me the unified clarification strategy for Coordinator-generated requirement questions, instead of applying only when rule confidence is low enough to reach the LLM fallback path. Runtime settings must match user-visible behavior: `coordinator.clarification_style=grill-me` should control all clarification prompts, and `coordinator.max_clarification_rounds` should cap the total number of Coordinator clarification turns consistently.

## What I Already Know

* User observed `clarification_style=grill-me` and `max_clarification_rounds=10` in settings, but behavior felt unchanged.
* Current code reads `coordinator.clarification_style` only in `apps/runner/src/agents/coordinator/llm-fallback.ts`.
* Current Coordinator flow is rule-first:
  * `apps/runner/src/agents/coordinator/index.ts` skips the LLM when `classifyByRules()` confidence is above `coordinator.confidence_threshold`.
  * `packages/shared/src/coordinator/rules-core.ts` can directly return `pause_for_human` questions for `too_short` and `large_scope_detected`.
* Because of rule-first routing, high-confidence rule branches can emit non-Grill-Me clarification questions and bypass the Grill Me prompt entirely.
* Current max-round enforcement is also inside `classifyByLlm()`, so it only runs when the LLM fallback runs.

## Assumptions

* "All questions" means all Coordinator-generated clarification questions that pause a Workflow Request for user input.
* Read-only `ask` requests should remain direct Q&A unless explicitly changed; they are not requirement clarification turns.
* Grill Me should still ask one question per round, but the configured max should cap the number of rounds before forced convergence.

## Requirements

* When `coordinator.clarification_style` is `grill-me`, every `pause_for_human` clarification emitted by Coordinator must follow Grill Me semantics, regardless of whether the initial classifier branch was rules or LLM.
* `coordinator.max_clarification_rounds` must be enforced before any clarification question is emitted, not only inside LLM fallback.
* Reaching the max clarification round count must force convergence: Coordinator must stop asking new questions and choose `proceed` or `abort` from available context.
* Rule-based early branches (`too_short`, `large_scope_detected`) must not bypass Grill Me behavior when Grill Me is enabled.
* Existing `default` clarification style should preserve current batch/question behavior unless explicitly changed.
* Existing direct ask/Q&A routing should remain unchanged unless user confirms otherwise.

## Acceptance Criteria

* [x] A vague/too-short request with `clarification_style=grill-me` produces exactly one Coordinator question, even if the rule layer detects `too_short`.
* [x] A large-scope request with `clarification_style=grill-me` produces exactly one Coordinator question, not the existing two-question fallback batch.
* [x] Requests that hit high-confidence rule branches cannot bypass Grill Me when they need clarification.
* [x] `max_clarification_rounds=N` is enforced across the full Coordinator path; once `N` coordinator messages already exist, no new clarification question is emitted.
* [x] Existing `default` style tests continue to pass or are updated only where product behavior intentionally changes.
* [x] Unit/integration tests cover both rules-originated clarification and LLM-originated clarification.

## Definition of Done

* Tests added or updated for rule-originated Grill Me behavior and max-round enforcement.
* Relevant lint/typecheck/test commands pass.
* Any changed runtime semantics are documented in code comments or user docs where appropriate.
* No new dependency is introduced.

## Out of Scope

* Changing the Web settings UI layout.
* Changing persisted config storage schema.
* Rewriting the full Coordinator decision model.
* Forcing ordinary read-only `ask` questions into requirement-clarification interviews unless confirmed.

## Technical Notes

* `apps/runner/src/agents/coordinator/index.ts` currently decides whether rules or LLM wins based on `coordinator.confidence_threshold`.
* `apps/runner/src/agents/coordinator/llm-fallback.ts` currently owns Grill Me prompt selection, max-round enforcement, and single-question truncation.
* `packages/shared/src/coordinator/rules-core.ts` currently contains pure rule decisions and returns fallback questions for high-confidence clarification branches.
* Implemented direction: rule-originated `pause_for_human` decisions are routed through `classifyByLlm()` when Grill Me is enabled, so the Grill Me prompt is the single source for those questions.
* Implemented direction: max-round enforcement is shared by `triageRequest()` and `classifyByLlm()` through `clarification-policy.ts`, and converts any post-limit `pause_for_human` into `abort`.

## Technical Approach

* Added `apps/runner/src/agents/coordinator/clarification-policy.ts` for shared clarification round counting and final max-round enforcement.
* Updated `triageRequest()` to force LLM routing for rule-originated clarification when `coordinator.clarification_style=grill-me`.
* Updated `triageRequest()` to force LLM convergence when a rule-originated clarification would ask after the configured max rounds.
* Updated `classifyByLlm()` so backend-unavailable, invocation-failed, and parsed LLM decisions all pass through the same max-round hard stop.
* Left pure read-only `ask` routing unchanged; this task only covers Coordinator clarification that would pause a Workflow Request.

## Verification

* `bun x --bun vitest run apps/runner/test/coordinator-grill-me-routing.test.ts`
* `bun x --bun vitest run apps/runner/test/coordinator-*.test.ts`
* `bun run typecheck`
* `bun run test`
