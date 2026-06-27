# Graph Runtime MVP — Verification & R5 Authority Guard

> Created 2026-06-28 as "API Graph Run Ledger (Epic C)". Scope corrected after
> investigation: **Epics C–F were already implemented and committed** in earlier
> commits (`42d8a89 Make failed graph nodes resumable from checkpoint evidence`
> and siblings), which predate the "deepen tasks to implementation-ready" docs
> (`8019a1c`). The original goal assumed only Epics A/B existed; that premise was
> outdated. This task therefore becomes **verification + one genuine coverage
> gap** rather than greenfield development.

## Background

Three planning docs (`docs/2026-06-27-graph-runtime-*.md`) specify a failure-resume-first
Graph Runtime MVP (R1–R6, R10). On inspection the implementation already exists and is wired:

| Epic | Requirement | Where it lives | Verified by |
|---|---|---|---|
| C1 ledger tables | R4 | `apps/api/src/store/db.ts` migration v29 (`graph_definitions`/`graph_runs`/`graph_node_runs`/`graph_events` + unique idx on `(graph_run_id,node_id,attempt)`) | `db-migrations.test.ts` legacy↔fresh equivalence |
| C2 read model | R4 | `apps/api/src/graph-runtime.ts` + `store.graphRuntime.byWorkflow` | `workflow-runs-route.test.ts` (ledger persists + checkpoint link) |
| C3 read route | R4 | `GET /workflow-runs/:id/graph` | route test legacy→`{graphRun:null,nodes:[]}` |
| C4 node↔step/checkpoint link | R4 | `validateGraphNodeRunLinks` | route test "rejects a step run from another workflow" |
| D1 scheduler (pure) | R1 | `apps/runner/src/orchestrator/graph-scheduler.ts` `computeRunnableGraphNodes` | `graph-scheduler.test.ts` (5 cases) |
| D2/D3 wired dispatch + events | R1 | `cmdOrchestrate` loop + `runner-events` `/graph-run-started`,`/graph-node-started`,`/graph-node-finished` | route test "runner graph events persist…" + full suite |
| E1/E2/E3 resume + facade | R2/R3/R10 | `resumeGraphNode`, `POST /…/graph/resume-node`, `resumeGraphStage` | route tests (resume create / reject completed+cursor / retry-step facade) |
| F1–F3 eval fixtures | R6 | `eval/scenarios/graph-runtime-fixture.json` (+ red) + `eval-harness.ts` | `bun run eval` green / scenarios-red fail-as-designed |

Baseline self-test before any change: shared 117 pass · api+runner 649 pass · eval 16/16 · eval-red 4/4 fail (expected) · typecheck exit 0.

## Goal

1. Verify the MVP against R1–R6/R10 acceptance signals (done — see table).
2. Close the one genuine coverage gap: **R5** (authority preservation) has no
   *positive* assertion that a graph node resume leaves `WorkflowRun.status` and
   `GateRun` verdicts untouched — the constraint the original goal emphasized most
   ("绝不写 WorkflowRun.status / 绝不判 gate pass/fail").
3. Re-run the full self-test + deterministic e2e (eval) and produce a change
   report + self-test report.

## Non-Goals

- Re-implementing or refactoring the existing, green Graph Runtime code.
- A monolithic `cmdOrchestrate` integration test: the loop calls module-level
  singletons (`api`/`env`/`selectAgentBackend`) and real step implementations;
  the repo deliberately tests the loop's *pieces* (scheduler, slicer, dispatch
  routing) + the deterministic eval path instead. Adding a heavy mock-everything
  test would cut against that architecture.
- Post-MVP Epics G/H/I (branch / join / human interrupt) — explicitly out of scope.

## Scope of change

- Add one guard test to `apps/api/test/workflow-runs-route.test.ts`:
  *"graph resume preserves Workflow Engine and Gate Engine authority (R5)"* —
  snapshot `run.status` + gates before resume, perform a failed-node resume, assert
  both are unchanged.

## Acceptance

- New R5 guard test passes.
- Full suite stays green: `bun test packages/shared/test`, `bun x --bun vitest run apps/api apps/runner`, `bun run eval`, `bun run typecheck`.
- `eval -- --scenario-dir eval/scenarios-red` still fails-as-designed (negative fixtures).
- Change report + self-test report produced.
