# Eval harness context and workflow fixtures

## Goal

Implement the next Agent Runtime eval expansion slice from the architecture docs: add deterministic `context_pack_fixture` and `workflow_fixture` scenarios, and strengthen eval report expectations where needed so failures remain easy to diagnose without real Claude/Codex CLIs.

## Source Documents

- `docs/2026-06-27-agent-orchestration-and-harness-improvement-plan.md`
- `docs/2026-06-27-agent-runtime-requirements.md`
- `docs/2026-06-27-agent-runtime-development-tasks.md`
- `docs/2026-06-27-agent-runtime-architecture-design.md`
- `docs/2026-06-27-agent-runtime-red-green-test-plan.md`

## Requirements

1. Add a `context_pack_fixture` eval scenario kind that builds a deterministic ContextPack from fixture project profile, accepted knowledge, input artifacts, budget, and stage inputs.
2. `context_pack_fixture` expectations must be able to assert manifest/sourceRefs/degradation behavior without snapshotting the whole ContextPack.
3. Include green context eval coverage for selected accepted/current knowledge and budget degradation.
4. Include red context eval coverage proving stale/conflict/sensitive context does not appear as authoritative selected context.
5. Add a `workflow_fixture` eval scenario kind that replays deterministic workflow evidence fixtures without a live API server and checks Evidence Gate / Completion Report / Retro-oriented evidence.
6. `workflow_fixture` expectations must be able to assert pass/fail gate outcomes, digest evidence presence, report evidence references, and tampered digest red-light behavior.
7. Keep `agent_backend_fixture` and router scenarios working unchanged.
8. Keep eval reports JSON/HTML readable with scenario kind, variant, checks, output/evidence, and exit 1 when any check fails.

## Acceptance Criteria

- [x] `scripts/eval-harness.ts` supports `context_pack_fixture`.
- [x] Default eval scenarios include at least one passing `context_pack_fixture` scenario.
- [x] Red eval scenarios include at least one failing or rejected context fixture expectation for stale/conflict/sensitive authoritative context.
- [x] `scripts/eval-harness.ts` supports `workflow_fixture`.
- [x] Default eval scenarios include at least one passing `workflow_fixture` scenario with digest-backed evidence.
- [x] Red eval scenarios include a tampered/missing digest workflow fixture that fails checks.
- [x] `bun run eval` passes.
- [x] `bun run eval -- --scenario-dir eval/scenarios-red` exits 1.
- [x] `bun run typecheck` passes.
- [x] Existing runner/shared/api tests relevant to eval, context, gate, and reports pass.

## Out of Scope

- Real Claude/Codex backend comparisons.
- Web UI changes for eval reports.
- Tool Registry persistence beyond fixture-level evidence checks.
- Changing Workflow Engine or Gate Engine authority boundaries.
- Implementing Memory Lifecycle beyond deterministic context selection checks already supported by current metadata.

## Technical Notes

- Prefer direct structured checks over full JSON snapshots.
- Reuse existing `buildContextPack()`, `contextSelectionAudit()`, Gate Engine, and report helpers instead of duplicating domain logic.
- Fixture output should expose enough evidence in the eval report to understand failures.
- Scenario validation must reject unsupported kinds or missing required fields early.
- Keep red scenarios deterministic and fast.

## Definition of Done

- F1 and F3 behavior are implemented with green/red eval coverage.
- F4 report/readability expectations remain satisfied for all scenario kinds.
- Relevant Trellis specs are updated if the scenario contract changes.
- Task is validated, committed, archived, and session-recorded without staging unrelated dirty Trellis files.
