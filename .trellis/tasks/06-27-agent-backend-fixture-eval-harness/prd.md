# Agent Backend Fixture Eval Harness

## Goal

Implement Epic F2 from the Agent Runtime and Harness docs: extend the deterministic eval harness with an `agent_backend_fixture` scenario kind that can exercise Runner agent invocation behavior with a fake backend and no external Claude Code/Codex CLI dependency.

## Source Documents

- `docs/2026-06-27-agent-orchestration-and-harness-improvement-plan.md`
- `docs/2026-06-27-agent-runtime-requirements.md`
- `docs/2026-06-27-agent-runtime-architecture-design.md`
- `docs/2026-06-27-agent-runtime-development-tasks.md`
- `docs/2026-06-27-agent-runtime-red-green-test-plan.md`

## Requirements

1. Add an eval scenario kind for `agent_backend_fixture`.
2. The scenario must run deterministically in-process without real Claude Code/Codex binaries.
3. The fixture must exercise `invokeSkill()` with a fake backend and fake API deps.
4. The fixture must verify AgentSession behavior introduced by Epic A:
   - one session is started for an invocation,
   - success can be finished and linked to an AgentResult,
   - backend failure finishes the session as failed before surfacing the error.
5. Scenario expectations must support red/green checks for session started, session finished, final status, result linkage, and whether an error was observed.
6. `bun run eval` must include the new scenario kind in JSON/HTML output and fail with exit 1 when an agent fixture expectation fails.
7. Existing router eval scenarios must continue to pass.

## Acceptance Criteria

- [x] A passing `agent_backend_fixture` scenario exists under `eval/scenarios/`.
- [x] A failing/red fixture variant proves bad expectations make `bun run eval` fail when run against an isolated scenario dir.
- [x] The default `bun run eval` suite passes.
- [x] `bun test apps/runner/test` passes for the touched runner/eval surface.
- [x] `bun run typecheck` passes.

## Out of Scope

- Implementing same-step context retry behavior.
- Adding ToolInvocation or Handoff records.
- Calling real Claude Code/Codex binaries.
- Adding a Web UI for eval reports beyond the existing HTML report.

## Technical Notes

- Prefer reusing `apps/runner/test/helpers/orchestrator-fixtures.ts` patterns where practical, but keep `scripts/eval-harness.ts` executable without importing test-only globals such as `vi`.
- Use fake API dependency functions to collect AgentTask, AgentResult, and AgentSession envelopes.
- Keep the scenario schema small and explicit; do not turn the eval harness into a general workflow runner in this slice.
- Preserve the existing router scenario behavior and report schema compatibility as much as possible.

## Definition of Done

- The deterministic eval harness can validate an agent backend invocation fixture without external model CLIs.
- The fixture protects the AgentSession ledger success/failure guarantees from Epic A.
- Trellis context is configured, task is archived after commit, and unrelated dirty Trellis files are not staged.
