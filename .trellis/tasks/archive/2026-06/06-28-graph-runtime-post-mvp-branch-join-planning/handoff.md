# Graph Runtime Post-MVP Handoff

## Purpose

Use this handoff to start a new session for Post-MVP Graph Runtime work: branch fan-out, join fan-in, and human interrupt/resume.

## Current Task

- Trellis task: `.trellis/tasks/06-28-graph-runtime-post-mvp-branch-join-planning`
- Title: Graph Runtime Post-MVP Branch Join Human Interrupt Planning
- Branch: `feat/context-injection-layer-mvp`

## Read First

1. `docs/2026-06-28-graph-runtime-post-mvp-requirements.md`
2. `docs/2026-06-28-graph-runtime-post-mvp-architecture-design.md`
3. `docs/2026-06-28-graph-runtime-post-mvp-development-tasks.md`
4. `.trellis/tasks/06-28-graph-runtime-post-mvp-branch-join-planning/prd.md`

Useful baseline docs:

- `docs/2026-06-27-graph-runtime-requirements.md`
- `docs/2026-06-27-graph-runtime-architecture-design.md`
- `docs/2026-06-27-graph-runtime-development-tasks.md`
- `.trellis/tasks/archive/2026-06/06-28-graph-runtime-api-ledger/report.md`

## Current Baseline

Failure-resume-first Graph Runtime MVP is complete:

- shared graph contracts;
- flow-to-graph adapter;
- API graph ledger/read model;
- Runner linear graph scheduler;
- checkpoint-backed node resume;
- retry-step facade;
- deterministic graph eval fixtures;
- R5 Workflow/Gate authority guard.

## Recommended Next Session Scope

Start with `graph-runtime-branch-scheduler-fixtures`:

1. Add scheduler support/tests for multiple ready branch nodes.
2. Add fixture helpers for non-linear graph definitions.
3. Add deterministic branch fan-out eval fixtures.
4. Keep dispatch sequential; do not implement true parallel Runner execution yet.

## Guardrails

- Do not mutate `WorkflowRun.status` from graph code.
- Do not decide `GateRun` verdicts from join policy.
- Do not silently reuse branch evidence across node ids.
- Do not introduce external graph-runtime dependencies.
- Do not edit or renumber existing migrations.
- Keep every change covered by deterministic tests/eval before behavior flips.

## New Session Prompt

Please continue Graph Runtime Post-MVP work from `.trellis/tasks/06-28-graph-runtime-post-mvp-branch-join-planning`.

Read these first:

- `docs/2026-06-28-graph-runtime-post-mvp-requirements.md`
- `docs/2026-06-28-graph-runtime-post-mvp-architecture-design.md`
- `docs/2026-06-28-graph-runtime-post-mvp-development-tasks.md`
- `.trellis/tasks/06-28-graph-runtime-post-mvp-branch-join-planning/prd.md`

Start with the first recommended slice: branch fan-out scheduler + deterministic fixtures. Keep dispatch sequential, preserve Workflow/Gate authority, add red/green tests before production wiring, and verify with shared tests, API/Runner tests, eval, red eval, and typecheck.
