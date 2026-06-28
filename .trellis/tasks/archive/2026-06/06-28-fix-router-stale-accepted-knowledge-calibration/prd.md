# Fix Router Stale Accepted Knowledge Calibration

## Goal

Fix the stable failing router regression where accepted knowledge marked as stale, historical, conflicting, or upgrade/downgrade candidate is incorrectly used to recommend a `startStage` skip or appear in `relevantKnowledge`.

## What I Already Know

- The failing test is `apps/api/test/router.test.ts`, test name `calibration: stale or conflict-marked accepted knowledge is not used for skip or relevantKnowledge`.
- The observed failure is `startStage` being `design` when the expected value is `null`.
- The impacted implementation is `apps/api/src/router.ts`.
- Router skip and relevant knowledge both read from `store.knowledgeArtifacts.byProject(projectId)`.
- The intended policy comes from the shared context metadata model: accepted knowledge with negative review status or historical/stale freshness must not be used as trusted/current context.

## Requirements

- Preserve router flow selection behavior.
- Preserve valid skip behavior for usable accepted designs and requirements.
- Exclude unusable accepted knowledge from both `startStage` skip recommendations and `relevantKnowledge`.
- Treat review statuses case-insensitively and hyphen/space-insensitively where router metadata is user/API supplied.
- Keep the fix minimal and scoped to router calibration behavior.
- Do not weaken the existing regression test.

## Acceptance Criteria

- [ ] Targeted router test passes.
- [ ] `startStage` remains `null` when only stale/historical/conflict-marked matching accepted knowledge exists.
- [ ] `relevantKnowledge` remains empty for stale/historical/conflict-marked matching accepted knowledge.
- [ ] Existing accepted design/requirement skip tests still pass.
- [ ] Typecheck passes if feasible.

## Out of Scope

- Rewriting smart-router scoring.
- Adding an LLM fallback.
- Changing workflow flow registry behavior.
- Changing storage schema or knowledge artifact promotion semantics.

## Technical Notes

- Relevant code read:
  - `apps/api/src/router.ts`
  - `apps/api/test/router.test.ts`
  - `packages/shared/src/types/router.ts`
  - `packages/shared/src/types/artifact.ts`
  - `packages/shared/src/types/context.ts`
- Relevant specs:
  - `.trellis/spec/api/backend/smart-router.md`
  - `.trellis/spec/shared/backend/context-injection-protocol.md`
  - `.trellis/spec/api/backend/build-commands.md`
