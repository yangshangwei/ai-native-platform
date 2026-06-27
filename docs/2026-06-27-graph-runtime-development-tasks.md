# Graph Runtime Resume, Branch, and Join Development Tasks

> Date: 2026-06-27
> Source: `.trellis/tasks/06-27-graph-runtime-resume-branch-join-planning/prd.md`
> MVP priority: failure resume first.

## 0. Execution Principles

- Preserve current `FLOW_REGISTRY` behavior before adding non-linear behavior.
- Keep Workflow Engine and Gate Engine authority unchanged.
- Add ledgers/read models before changing scheduling behavior.
- Deterministic tests and eval fixtures must precede production wiring.
- Resume must create explicit attempts and idempotency evidence.
- Branch/join and human interrupt/resume are post-MVP behavior, but type contracts should reserve their concepts.

## 1. Epic A - Shared Graph Runtime Contract

| ID | Task | Main files | Acceptance |
|---|---|---|---|
| A1 | Define shared graph runtime types and status/policy guards. | `packages/shared/src/types/graph-runtime.ts`, shared exports, shared tests | Types express graph definitions, nodes, edges, graph runs, node runs, join policy, retry policy, resume policy, failure policy, and graph events. Unknown guard values are rejected. |
| A2 | Add graph id aliases. | `packages/shared/src/types/ids.ts` | Shared ids include graph definition/run/node/event aliases without breaking existing ids. |
| A3 | Add shared tests for type shape and guards. | `packages/shared/test/graph-runtime.test.ts` | Tests instantiate representative graph definition/run/node run and assert guard behavior. |

Red tests:

- Unknown graph node status is rejected.
- Unknown join policy is rejected.
- Unknown resume policy is rejected.

Green tests:

- Linear graph definition with node/edge list type-checks.
- Graph node run links to workflow run, step run, checkpoint, resume cursor, and idempotency key.

## 2. Epic B - Flow-to-Graph Adapter

| ID | Task | Main files | Acceptance |
|---|---|---|---|
| B1 | Convert `FlowDef` into a linear `GraphDefinition`. | `packages/shared/src/flows/graph-adapter.ts` | One node per stage, one edge per adjacent pair, entry node is first stage. |
| B2 | Export adapter from shared package and browser entry. | `packages/shared/src/index.ts`, `packages/shared/src/browser.ts` | API/Runner/Web can import the pure adapter without Node-only dependencies. |
| B3 | Add tests for all registered flows. | `packages/shared/test/flow-graph-adapter.test.ts` | Topological order equals `FLOW_REGISTRY[flowId].stages.map(stage)`. |

Red tests:

- Unknown/malformed edge target fails topological validation.
- Empty executable graph is rejected if adapter validation is invoked in executable mode.

Green tests:

- `feature.standard`, `feature.fastforward`, `issue.standard`, and `refactor.standard` all adapt to linear graphs with stable node ids.

## 3. Epic C - API Graph Run Ledger

| ID | Task | Main files | Acceptance |
|---|---|---|---|
| C1 | Add additive SQLite migrations for graph definitions, graph runs, graph node runs, and optional graph events. | `apps/api/src/store/db.ts` | Legacy DB takeover remains safe; no existing migration is edited. |
| C2 | Add store/read model helpers. | `apps/api/src/store/store.ts` | Graph metadata can be queried by workflowRunId and node id. |
| C3 | Add API read routes. | `apps/api/src/routes/workflow-runs.ts` or graph route module | Legacy runs return empty graph metadata. |
| C4 | Link graph node runs to StepRun/StepCheckpoint. | `apps/api/src/workflow-engine.ts`, `apps/api/src/step-checkpoints.ts` | Node runs can expose checkpoint ids and evidence refs. |

Red tests:

- Node run referencing a different workflow's step is rejected.
- Legacy run without graph rows does not crash.

Green tests:

- New graph run can be persisted and read by workflowRunId.
- Graph node run can link a StepCheckpoint.

## 4. Epic D - Linear Graph Scheduler Behind Existing Dispatch

| ID | Task | Main files | Acceptance |
|---|---|---|---|
| D1 | Add scheduler that computes runnable nodes from graph dependencies. | `apps/runner/src/orchestrator/graph-scheduler.ts` | Linear graph returns one runnable node at a time. |
| D2 | Wire scheduler behind a feature flag or internal path without changing default behavior until tests are green. | `apps/runner/src/orchestrator.ts` | Current flows remain behavior-equivalent. |
| D3 | Record graph/node run state through API events. | `apps/runner/src/api-client.ts`, API runner events | Node start/finish is visible in read model. |

Red tests:

- Scheduler does not run a node whose predecessor has not completed.
- Scheduler rejects graph version mismatch.

Green tests:

- Feature/issue/refactor flows run in the same stage order as today.
- StepRun and StepCheckpoint evidence remains linked.

## 5. Epic E - Checkpoint-backed Node Resume

| ID | Task | Main files | Acceptance |
|---|---|---|---|
| E1 | Define resume validation helper. | API graph runtime module | Validates graph version, node id, prior status, checkpoint presence, and idempotency. |
| E2 | Add resume route/action. | API workflow route or graph route | Failed/cancelled/interrupted nodes can be scheduled as new attempts. |
| E3 | Keep stage retry compatibility facade if needed. | `apps/api/src/routes/workflow-runs.ts` | Existing UI route can map stage retry to graph node resume when graph metadata exists. |
| E4 | Runner resumes node from API-owned graph state. | `apps/runner/src/orchestrator.ts` | Runner does not rely on local memory to resume. |

Red tests:

- Completed side-effecting node cannot be silently rerun.
- Invalid resume cursor is rejected.
- Missing checkpoint blocks resume instead of guessing.

Green tests:

- Failed node resumes as a new attempt.
- New attempt gets a new node run and checkpoint linkage.

## 6. Epic F - Graph Runtime Eval Fixtures

| ID | Task | Main files | Acceptance |
|---|---|---|---|
| F1 | Add `graph_runtime_fixture` scenario kind. | `scripts/eval-harness.ts`, `eval/scenarios/*` | Deterministic fixtures run without external model CLIs. |
| F2 | Add green linear equivalence fixture. | `eval/scenarios/graph-runtime*.json` | Default eval proves graph order equals flow registry order. |
| F3 | Add resume green/red fixtures. | `eval/scenarios/*`, `eval/scenarios-red/*` | Good resume passes; idempotency violation fails. |
| F4 | Reserve branch/join fixture schema for post-MVP. | eval harness schema/types | Fixture schema can express branch/join expectations later. |

Red tests:

- Resume expectation passes despite no new attempt: fixture fails.
- Graph order differs from flow order: fixture fails.

Green tests:

- Default eval includes a passing graph runtime variant.

## 7. Epic G - Branch Fan-out (Post-MVP)

| ID | Task | Main files | Acceptance |
|---|---|---|---|
| G1 | Enable multiple ready nodes in scheduler. | Runner graph scheduler | Multiple downstream nodes can become ready from one completed node. |
| G2 | Record separate node attempts and evidence refs. | API/Runner graph runtime | Each branch has isolated StepCheckpoint, AgentSession, ToolInvocation, and Artifact refs. |
| G3 | Add branch eval fixtures. | eval scenarios | Branch fan-out is deterministic and auditable. |

## 8. Epic H - Join Fan-in (Post-MVP)

| ID | Task | Main files | Acceptance |
|---|---|---|---|
| H1 | Implement join policy evaluation. | API/Runner graph runtime | all-of, any-of, first-success, quorum, and manual-adopt can be evaluated. |
| H2 | Keep Gate Engine authority intact. | gate/report paths | Join output never sets GateRun/WorkflowRun pass/fail directly. |
| H3 | Add join eval fixtures. | eval scenarios | Join scheduling behavior is deterministic. |

## 9. Epic I - Human Interrupt/Resume (Post-MVP)

| ID | Task | Main files | Acceptance |
|---|---|---|---|
| I1 | Add durable interrupted/blocked graph state. | API graph ledger | Interrupted node state survives process restart. |
| I2 | Add resume action from UI/API. | API/Web | Operator can resume a blocked graph node. |
| I3 | Add eval/route tests. | API tests, eval scenarios | Resume creates auditable graph event and new node attempt where appropriate. |

## 10. Recommended MVP Order

1. A1-A3: shared graph runtime contract.
2. B1-B3: flow-to-graph adapter.
3. C1-C4: API graph run ledger.
4. D1-D3: linear graph scheduler behind existing dispatch.
5. E1-E4: checkpoint-backed node resume.
6. F1-F3: graph runtime eval fixtures.

## 11. Verification Commands

Shared/type foundation:

```bash
bun test packages/shared/test
bun run typecheck
```

Full graph runtime implementation:

```bash
bun test packages/shared/test apps/api/test apps/runner/test
bun run eval
bun run eval -- --scenario-dir eval/scenarios-red
bun run typecheck
```
