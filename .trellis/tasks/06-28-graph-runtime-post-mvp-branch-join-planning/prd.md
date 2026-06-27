# Graph Runtime Post-MVP Branch/Join/Human Interrupt Planning

## Goal

Prepare the next Graph Runtime phase after the failure-resume-first MVP by turning the existing Post-MVP sketch into implementation-ready planning documents. The output is a new requirements document, architecture design, and development task breakdown for branch fan-out, join fan-in, and durable human interrupt/resume.

## What I Already Know

- The failure-resume-first Graph Runtime MVP is already implemented and verified.
- Existing formal docs are:
  - `docs/2026-06-27-graph-runtime-requirements.md`
  - `docs/2026-06-27-graph-runtime-architecture-design.md`
  - `docs/2026-06-27-graph-runtime-development-tasks.md`
- The 06-28 MVP verification report confirms Epics A-F are complete and green.
- Current shared contracts already include `GraphEdgeMode`, `GraphJoinPolicy`, `GraphResumePolicy`, `GraphFailurePolicy`, `GraphEventType`, `GraphRun`, and `GraphNodeRun`.
- Current scheduler is graph-backed but still effectively linear/sequential.
- Post-MVP behavior should preserve Workflow Engine and Gate Engine authority.

## Requirements

- Create formal Post-MVP requirements covering:
  - branch fan-out;
  - typed join fan-in;
  - durable human interrupt/resume;
  - graph authoring/validation for non-linear flows;
  - operator visibility;
  - deterministic eval fixtures.
- Create formal architecture design covering:
  - scheduler changes;
  - join evaluator;
  - blocked/resume state;
  - API actions;
  - read model;
  - Web UI diagnostics;
  - eval strategy;
  - migration/compatibility.
- Create formal task breakdown covering small implementation slices.
- Curate Trellis context files for future implement/check agents.
- Provide a new-session handoff prompt for the user.

## Acceptance Criteria

- [x] `docs/2026-06-28-graph-runtime-post-mvp-requirements.md` exists and defines Post-MVP requirements.
- [x] `docs/2026-06-28-graph-runtime-post-mvp-architecture-design.md` exists and defines the technical design.
- [x] `docs/2026-06-28-graph-runtime-post-mvp-development-tasks.md` exists and decomposes work into small tasks.
- [x] This Trellis task has a PRD describing scope and decisions.
- [x] `implement.jsonl` and `check.jsonl` are curated with relevant specs and docs.
- [x] Trellis task validation passes.
- [ ] Final answer includes a concise new-session prompt.

## Technical Approach

Use the completed MVP as the baseline and keep Post-MVP work staged:

1. Branch fan-out first, still dispatching ready nodes sequentially.
2. Join fan-in second, starting with `all_of`, `any_of`, and `first_success`.
3. Human interrupt/resume third, using API-owned blocked state and existing resume semantics.
4. UI diagnostics after the API/read model can explain ready/blocked/join state.

## Decision (ADR-lite)

**Context**: The original graph runtime docs already marked branch, join, and human interrupt/resume as post-MVP, but only as a coarse G/H/I sketch. A new implementation session needs sharper requirements and task boundaries.

**Decision**: Treat Post-MVP as a staged rollout rather than one large feature. Branch scheduler and fixtures come first; join evaluator/read model comes second; human blocked/resume API and UI actions come third.

**Consequences**: This avoids introducing true parallel Runner execution before branch semantics are proven. It keeps Workflow/Gate authority protected and lets each slice land with deterministic tests.

## Out of Scope

- Implementing branch/join/human interrupt code in this planning task.
- True parallel Runner execution.
- External graph runtime dependencies.
- Replacing existing workflow/gate ownership.
- Building a rich graph canvas UI in the first Post-MVP slice.

## Technical Notes

- Existing MVP verification: `.trellis/tasks/archive/2026-06/06-28-graph-runtime-api-ledger/report.md`
- Current scheduler: `apps/runner/src/orchestrator/graph-scheduler.ts`
- Current resume helper: `apps/api/src/graph-runtime.ts`
- Current graph route: `apps/api/src/routes/workflow-runs.ts`
- Current graph types: `packages/shared/src/types/graph-runtime.ts`
- New formal docs:
  - `docs/2026-06-28-graph-runtime-post-mvp-requirements.md`
  - `docs/2026-06-28-graph-runtime-post-mvp-architecture-design.md`
  - `docs/2026-06-28-graph-runtime-post-mvp-development-tasks.md`
