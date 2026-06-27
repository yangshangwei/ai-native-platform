# Graph Runtime Post-MVP Development Tasks

> Date: 2026-06-28
> Companion docs: `2026-06-28-graph-runtime-post-mvp-requirements.md`, `2026-06-28-graph-runtime-post-mvp-architecture-design.md`
> Goal: decompose branch fan-out, join fan-in, and human interrupt/resume into small, testable tasks.

## 0. Execution Principles

- Keep failure-resume-first MVP tests green at every step.
- Add deterministic red/green tests before wiring production behavior.
- Dispatch ready branch nodes sequentially before introducing true parallelism.
- Joins release downstream scheduling only; Gate Engine remains verdict authority.
- Human interrupt/resume state must be API-owned and durable across Runner restarts.
- Persistence changes are additive only.
- UI is diagnostic/actionable first; defer rich graph canvas.

## Epic G — Branch Fan-out

### G1 — Graph Edge Mode Scheduler

| Field | Detail |
|---|---|
| Scope | Teach scheduler to evaluate `GraphEdgeMode` instead of treating all edges as linear `all_success`. |
| Likely files | `apps/runner/src/orchestrator/graph-scheduler.ts`, `apps/runner/test/graph-scheduler.test.ts` |
| Tests | Two downstream nodes become ready after one predecessor passes; `always` releases after terminal status; `manual` stays blocked without event. |
| Acceptance | `computeRunnableGraphNodes()` returns all ready branch nodes in deterministic order. |

### G2 — Non-Linear Graph Fixture Builder

| Field | Detail |
|---|---|
| Scope | Add test/eval helpers to build graph definitions with fan-out/fan-in without touching product flows. |
| Likely files | `packages/shared/test/*`, `apps/runner/test/*`, `scripts/eval-harness.ts`, `eval/scenarios/*` |
| Tests | Valid fan-out graph passes validation; bad edge target/cycle/ambiguous edge mode fails. |
| Acceptance | Branch/join fixtures can be authored deterministically. |

### G3 — Branch Ledger Isolation

| Field | Detail |
|---|---|
| Scope | Ensure sequential dispatch of multiple ready branch nodes creates isolated node runs and evidence refs. |
| Likely files | `apps/runner/src/orchestrator.ts`, `apps/api/src/store/store.ts`, `apps/api/test/workflow-runs-route.test.ts` |
| Tests | Branch B and C get separate `GraphNodeRun`, `StepRun`, `StepCheckpoint`, and idempotency keys. |
| Acceptance | No branch shares side-effect evidence with another node unless explicitly modeled as reused evidence. |

### G4 — Branch Read Model

| Field | Detail |
|---|---|
| Scope | Extend graph read model with ready/blocked/running branch node lists. |
| Likely files | `apps/api/src/store/store.ts`, `apps/api/src/routes/workflow-runs.ts`, `apps/api/test/workflow-runs-route.test.ts` |
| Tests | `GET /workflow-runs/:id/graph` exposes multiple ready branch nodes and dependency state. |
| Acceptance | Operator can inspect fan-out state without Runner-local memory. |

## Epic H — Join Fan-in

### H1 — Join Policy Evaluator

| Field | Detail |
|---|---|
| Scope | Add a pure join evaluator for `all_of`, `any_of`, and `first_success`. |
| Likely files | `apps/runner/src/orchestrator/graph-scheduler.ts` or new graph runtime helper; tests under `apps/runner/test/` |
| Tests | `all_of` waits for all passed; `any_of` releases on one passed; `first_success` selects earliest completed success. |
| Acceptance | Join satisfaction is deterministic and does not dispatch work. |

### H2 — Quorum and Manual Adopt Validation

| Field | Detail |
|---|---|
| Scope | Validate `quorum` metadata and manual adoption event semantics. |
| Likely files | shared/API helper modules, route tests, eval red fixtures |
| Tests | Invalid quorum rejected; manual join waits until adoption event selects valid upstream node ids. |
| Acceptance | Complex join policies fail closed with auditable reasons. |

### H3 — Join Events and Read Model

| Field | Detail |
|---|---|
| Scope | Persist `join_evaluated` events and expose latest join evaluation in graph read model. |
| Likely files | `apps/api/src/store/store.ts`, `apps/api/src/graph-runtime.ts`, `apps/api/test/workflow-runs-route.test.ts` |
| Tests | Join evaluation event includes policy, upstream statuses, selected evidence refs, and blocked reason. |
| Acceptance | API can explain why a join released or is waiting. |

### H4 — Join Scheduler Wiring

| Field | Detail |
|---|---|
| Scope | Scheduler uses join evaluation to decide when downstream nodes become ready. |
| Likely files | `apps/runner/src/orchestrator/graph-scheduler.ts`, `apps/runner/src/orchestrator.ts`, eval fixtures |
| Tests | Downstream node is not ready before join policy is satisfied; becomes ready after satisfaction. |
| Acceptance | Join releases scheduling only; no gate/workflow status mutation. |

### H5 — Join Authority Guard

| Field | Detail |
|---|---|
| Scope | Add direct regression tests that join evaluation does not mutate `WorkflowRun.status` or `GateRun` verdicts. |
| Likely files | `apps/api/test/workflow-runs-route.test.ts`, `apps/api/test/gate-engine.test.ts` |
| Tests | Snapshot workflow run and gates before join evaluation; assert unchanged after. |
| Acceptance | R5 stays protected for join fan-in. |

## Epic I — Human Interrupt/Resume

### I1 — Durable Node Block Action

| Field | Detail |
|---|---|
| Scope | Add API helper/action to mark a node run blocked with reason, cursor, actor, and metadata. |
| Likely files | `apps/api/src/graph-runtime.ts`, `apps/api/src/routes/workflow-runs.ts`, `apps/api/test/workflow-runs-route.test.ts` |
| Tests | Blocked node persists; event `node_blocked` is emitted; graph run becomes blocked when no runnable nodes remain. |
| Acceptance | Blocked state survives process restart and is visible through read model. |

### I2 — Resume Blocked Node Action

| Field | Detail |
|---|---|
| Scope | Extend existing resume route to cover human-blocked nodes with cursor validation and action metadata. |
| Likely files | `apps/api/src/graph-runtime.ts`, `apps/api/src/routes/workflow-runs.ts`, route tests |
| Tests | Blocked node resumes as attempt+1; invalid cursor rejected; missing checkpoint/cursor blocks. |
| Acceptance | Resume is explicit, auditable, and idempotency-safe. |

### I3 — Manual Join Adoption Action

| Field | Detail |
|---|---|
| Scope | Add API action for `manual_adopt` joins to select upstream evidence and emit a join/adoption event. |
| Likely files | `apps/api/src/graph-runtime.ts`, `apps/api/src/routes/workflow-runs.ts`, API tests |
| Tests | Adoption rejects unknown upstreams; adoption releases join; repeated adoption is idempotent or rejected deterministically. |
| Acceptance | Human choice is durable and auditable. |

### I4 — Web Diagnostic Panel

| Field | Detail |
|---|---|
| Scope | Show graph branch/join/blocked state in task detail UI with narrow actions. |
| Likely files | `apps/web/src/page-task-detail.ts` and related UI helpers |
| Tests | Component/unit or route-level tests if available; manual screenshot/DOM check if UI test harness exists. |
| Acceptance | Operator can inspect ready/running/blocked nodes, join wait reasons, and resume/adopt actions. |

## Epic J — Post-MVP Eval Coverage

### J1 — Branch Fixtures

| Field | Detail |
|---|---|
| Scope | Add green/red branch fan-out scenarios. |
| Likely files | `scripts/eval-harness.ts`, `eval/scenarios/*`, `eval/scenarios-red/*` |
| Acceptance | Green branch fixture passes; duplicate branch evidence red fixture fails. |

### J2 — Join Fixtures

| Field | Detail |
|---|---|
| Scope | Add green/red join policy scenarios. |
| Likely files | `scripts/eval-harness.ts`, `eval/scenarios/*`, `eval/scenarios-red/*` |
| Acceptance | `all_of`, `any_of`, and `first_success` pass; premature release red fixture fails. |

### J3 — Human Interrupt Fixtures

| Field | Detail |
|---|---|
| Scope | Add blocked/resume and manual adoption scenarios. |
| Likely files | `scripts/eval-harness.ts`, `eval/scenarios/*`, `eval/scenarios-red/*` |
| Acceptance | Blocked node resume passes; resume without required cursor/checkpoint fails. |

## Recommended Trellis Task Order

1. `graph-runtime-branch-scheduler-fixtures` — G1, G2, J1.
2. `graph-runtime-branch-ledger-read-model` — G3, G4.
3. `graph-runtime-join-policy-evaluator` — H1, H2, J2.
4. `graph-runtime-join-read-model-authority-guard` — H3, H4, H5.
5. `graph-runtime-human-block-resume-api` — I1, I2, J3.
6. `graph-runtime-manual-adopt-and-web-actions` — I3, I4.

Each task should land with its own tests and should be archivable independently.

## Verification Commands

Run these for every implementation slice:

```bash
bun test packages/shared/test
bun x --bun vitest run apps/api apps/runner
bun run eval
bun run eval -- --scenario-dir eval/scenarios-red
bun run typecheck
```

For UI-facing slices, also run the web build/test command already used by the repo, and inspect the task-detail view if browser tooling is available.

## Definition of Done

- Branch, join, and human interrupt/resume are represented in docs, tests, eval fixtures, API read model, and UI diagnostics.
- Existing linear graph behavior and failure resume remain green.
- All new graph actions are auditable through `GraphEvent`.
- No graph code path mutates Workflow Engine or Gate Engine authority.
- True parallel Runner remains deferred until branch semantics are stable.
