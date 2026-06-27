# Graph Runtime Resume, Branch, and Join Development Tasks

> Date: 2026-06-27 (updated 2026-06-28)
> Source: `.trellis/tasks/06-27-graph-runtime-resume-branch-join-planning/prd.md`
> Companion: `2026-06-27-graph-runtime-requirements.md` (R-IDs), `2026-06-27-graph-runtime-architecture-design.md` (§)
> MVP priority: **failure resume first** (Epics A–F). Branch/join/human-interrupt (Epics G–I) are post-MVP.

## 0. Execution Principles

- Preserve current `FLOW_REGISTRY` behavior before adding non-linear behavior (R1).
- Keep Workflow Engine and Gate Engine authority unchanged (R5).
- Add ledgers/read models **before** changing scheduling behavior (R4).
- Deterministic tests and eval fixtures precede production wiring (R6).
- Resume always creates an explicit new attempt with idempotency evidence (R2, R3).
- Branch/join/human-interrupt are post-MVP, but the shared contracts already reserve their concepts.

## MVP batch (Epics A–F)

### Epic A — Shared Graph Runtime Contract  *(R1, R4 foundation; size: S — largely shipped)*

Status: `packages/shared/src/types/graph-runtime.ts` already defines the full type set; this epic hardens exports and tests.

| ID | Task | Files | Contracts | Acceptance |
|---|---|---|---|---|
| A1 | Confirm/extend graph types & guards | `packages/shared/src/types/graph-runtime.ts` | `GraphDefinition/NodeDefinition/EdgeDefinition/Run/NodeRun/Event`, `GraphRetryPolicy`, all enums + guards | Types express nodes/edges/runs/node-runs/join/retry/resume/failure policies + events; guards reject unknown values |
| A2 | Graph id aliases | `packages/shared/src/types/ids.ts` | `GraphDefinitionId`, `GraphRunId`, `GraphNodeRunId`, `GraphEventId` | Already imported by graph-runtime.ts; verify aliases exist and don't break existing ids |
| A3 | Shared type/guard tests | `packages/shared/test/graph-runtime.test.ts` | — | Instantiate a representative graph definition/run/node-run; assert guard behavior |

- **Red:** unknown `GraphNodeStatus` rejected; unknown `GraphJoinPolicy` rejected; unknown `GraphResumePolicy` rejected; wrong `schemaVersion` rejected by `isGraphRuntimeSchemaVersion`.
- **Green:** linear `GraphDefinition` with node/edge list type-checks; `GraphNodeRun` links `workflowRunId`+`stepRunId`+`stepCheckpointId`+`resumeCursor`+`idempotencyKey`.
- **Deps:** none. **DoD:** `bun test packages/shared/test` + `bun run typecheck` green.

### Epic B — Flow-to-Graph Adapter  *(R1; size: S — largely shipped)*

Status: `packages/shared/src/flows/graph-adapter.ts` already implements all three functions; this epic adds exports + full-flow tests.

| ID | Task | Files | Contracts | Acceptance |
|---|---|---|---|---|
| B1 | `FlowDef` → linear `GraphDefinition` | `packages/shared/src/flows/graph-adapter.ts` | `flowToGraphDefinition`, `graphStageOrder`, `assertGraphMatchesFlowOrder` | One node per stage, one `all_success` edge per adjacent pair, entry = first stage |
| B2 | Export adapter (incl. browser entry) | `packages/shared/src/index.ts`, `packages/shared/src/browser.ts` | — | API/Runner/Web import the pure adapter with no Node-only deps |
| B3 | Tests for all registered flows | `packages/shared/test/flow-graph-adapter.test.ts` | — | Topo order equals `FLOW_REGISTRY[flowId].stages.map(s=>s.stage)` for all 4 flows |

- **Red:** malformed edge target fails `graphStageOrder` (cycle/disconnected throws); empty executable graph rejected if validated in executable mode.
- **Green:** `feature.standard` (8), `feature.fastforward` (4), `issue.standard` (6), `refactor.standard` (6) adapt to linear graphs with stable ids (`node:${flowId}:${index}:${stage}`).
- **Deps:** A. **DoD:** adapter tests green; `assertGraphMatchesFlowOrder` passes for all flows (proves R1).

### Epic C — API Graph Run Ledger  *(R4; size: M)*

| ID | Task | Files | Contracts | Acceptance |
|---|---|---|---|---|
| C1 | Additive SQLite tables | `apps/api/src/store/db.ts` | `graph_definitions`, `graph_runs`, `graph_node_runs`, `graph_events` (§5 columns) | No existing migration edited; legacy takeover safe |
| C2 | Store/read-model helpers | `apps/api/src/store/store.ts`, new `apps/api/src/graph-runtime.ts` | `buildGraphRuntimeReadModel(workflowRunId)` | Graph metadata queryable by `workflowRunId` and `nodeId` |
| C3 | Read route | `apps/api/src/routes/workflow-runs.ts` (or `graph` route module) | `GET /workflow-runs/:id/graph` | Legacy runs → `{graphRun:null, nodes:[]}` |
| C4 | Link node runs to StepRun/StepCheckpoint | `apps/api/src/workflow-engine.ts`, `apps/api/src/step-checkpoints.ts` | `graph_node_runs.step_run_id` / `step_checkpoint_id` | Node runs expose checkpoint id + evidence refs |

- **Red:** node run referencing a different workflow's step rejected; legacy run without graph rows does not crash.
- **Green:** new graph run persisted + read by `workflowRunId`; node run links a `StepCheckpoint`.
- **Deps:** A, B. **DoD:** `bun test apps/api/test` green; additive-migration check passes.

### Epic D — Linear Graph Scheduler Behind Existing Dispatch  *(R1; size: M)*

| ID | Task | Files | Contracts | Acceptance |
|---|---|---|---|---|
| D1 | Runnable-node scheduler (pure) | `apps/runner/src/orchestrator/graph-scheduler.ts` | `computeRunnableNodes(graphDef, nodeRuns)` (§6) | Linear graph returns exactly one runnable node at a time |
| D2 | Wire behind internal path/flag | `apps/runner/src/orchestrator.ts` | calls scheduler → `dispatchStep()` | Current flows behavior-equivalent until tests green |
| D3 | Report node state via API events | `apps/runner/src/api-client.ts`, API runner-events | `node_started` / `node_finished` events | Node start/finish visible in read model |

- **Red:** scheduler does not run a node whose predecessor isn't `passed`; scheduler rejects `graphVersion` mismatch.
- **Green:** feature/issue/refactor flows run in the same stage order as today; `StepRun`/`StepCheckpoint` evidence stays linked.
- **Deps:** A, B, C. **DoD:** equivalence tests green; default dispatch unchanged until flag flip.

### Epic E — Checkpoint-backed Node Resume  *(R2, R3, R10; size: L)*

| ID | Task | Files | Contracts | Acceptance |
|---|---|---|---|---|
| E1 | Resume validation helper | `apps/api/src/graph-runtime.ts` | `resumeNode(workflowRunId, nodeId, mode)` (§7) | Validates graph version, node id, prior status, checkpoint presence, idempotency |
| E2 | Resume route/action | API workflow/graph route | `POST .../graph/resume` (or extend retry-step) | Failed/cancelled/interrupted nodes scheduled as new attempts |
| E3 | retry-step compatibility facade | `apps/api/src/routes/workflow-runs.ts` | maps stage retry → node resume when graph rows exist | Existing retry-step tests green; graph runs get node resume |
| E4 | Runner resumes from API-owned state | `apps/runner/src/orchestrator.ts` | — | Runner does not use local memory to resume |

- **Red:** completed (`passed`) side-effecting node cannot be silently re-run (rejected unless `reuse_evidence`); invalid resume cursor rejected; missing checkpoint blocks resume instead of guessing.
- **Green:** failed node resumes as a new attempt (`attempt+1`); new attempt gets a new node run + checkpoint linkage; downstream becomes `ready` only after resumed node `passed`.
- **Deps:** A–D. **DoD:** resume red/green tests green; retry-step facade preserves legacy behavior (R10).

### Epic F — Graph Runtime Eval Fixtures  *(R6; size: M)*

| ID | Task | Files | Acceptance |
|---|---|---|---|
| F1 | `graph_runtime_fixture` scenario kind | `scripts/eval-harness.ts`, `eval/scenarios/*` | Deterministic fixtures run without external model CLIs |
| F2 | Green linear-equivalence fixture | `eval/scenarios/graph-runtime*.json` | Proves graph topo order == registry order |
| F3 | Resume green/red + idempotency red | `eval/scenarios/*`, `eval/scenarios-red/*` | Good resume passes; idempotency violation fails |
| F4 | Reserve branch/join fixture schema | eval harness schema/types | Schema can express branch/join expectations later (post-MVP) |

- **Red:** resume expectation passes despite no new attempt → fixture fails; graph order ≠ flow order → fixture fails.
- **Green:** default `bun run eval` includes a passing graph-runtime variant.
- **Deps:** A–E. **DoD:** `bun run eval` + `bun run eval -- --scenario-dir eval/scenarios-red` behave as specified.

## Post-MVP batch (Epics G–I)

### Epic G — Branch Fan-out  *(R7; size: M)*
| ID | Task | Files | Acceptance |
|---|---|---|---|
| G1 | Multiple ready nodes in scheduler | `apps/runner/src/orchestrator/graph-scheduler.ts` | One completed node can make several downstream nodes `ready` |
| G2 | Isolated per-branch evidence | API/Runner graph runtime | Each branch has isolated StepCheckpoint/AgentSession/ToolInvocation/Artifact refs |
| G3 | Branch eval fixtures | `eval/scenarios/*` | Branch fan-out deterministic + auditable |

### Epic H — Join Fan-in  *(R8; size: M)*
| ID | Task | Files | Acceptance |
|---|---|---|---|
| H1 | Join policy evaluation | API/Runner graph runtime | `all_of/any_of/first_success/quorum/manual_adopt` evaluate correctly |
| H2 | Gate authority intact | gate/report paths | Join output never sets `GateRun`/`WorkflowRun` pass/fail |
| H3 | Join eval fixtures | `eval/scenarios/*` | Join scheduling deterministic |

### Epic I — Human Interrupt/Resume  *(R9; size: M)*
| ID | Task | Files | Acceptance |
|---|---|---|---|
| I1 | Durable interrupted/blocked state | API graph ledger | Interrupted node survives process restart |
| I2 | Resume action from UI/API | API/Web | Operator resumes a blocked node |
| I3 | Eval/route tests | API tests, eval scenarios | Resume emits auditable `resume_requested` event + new attempt |

## Requirement → Epic Traceability

| Req | Epics |
|---|---|
| R1 linear equivalence | A, B, D |
| R2 node-boundary resume | E |
| R3 idempotency / no silent re-run | E, F |
| R4 durable graph ledger | C |
| R5 authority preservation | cross-cutting (D, E, H) |
| R6 deterministic eval | F |
| R7 branch | G |
| R8 join | H |
| R9 human interrupt/resume | I |
| R10 retry-step facade | E3 |

## Cross-cutting Test / Eval Strategy

- **Unit:** pure functions (`flowToGraphDefinition`, `graphStageOrder`, `computeRunnableNodes`, `resumeNode` validation) are deterministic and fully unit-tested.
- **Integration:** API ledger round-trips (persist → read by `workflowRunId`); Runner dispatch equivalence vs current flows.
- **Eval fixtures:** linear equivalence, resume success, idempotency negative (red) — gate the behavior flip.
- **Regression:** existing `apps/runner/test`, `apps/api/test`, `flow-registry.test.ts`, and retry-step tests must stay green throughout.

## Recommended Implementation Sequence

1. **A1–A3** shared contract (mostly done — harden tests/exports).
2. **B1–B3** flow-to-graph adapter (mostly done — add full-flow tests).
3. **C1–C4** API graph run ledger.
4. **D1–D3** linear scheduler behind existing dispatch.
5. **E1–E4** checkpoint-backed node resume + retry-step facade.
6. **F1–F3** eval fixtures (flip behavior on green).
7. *(post-MVP)* **G → H → I** branch, join, human interrupt/resume.

## Verification Commands

```bash
# Shared/type foundation
bun test packages/shared/test
bun run typecheck

# Full graph runtime implementation
bun test packages/shared/test apps/api/test apps/runner/test
bun run eval
bun run eval -- --scenario-dir eval/scenarios-red
bun run typecheck
```

## Definition of Done (phase MVP)

- Epics A–F complete; R1–R6 + R10 acceptance signals demonstrated by tests/fixtures.
- Existing flows behavior-equivalent (no stage-order or evidence regression).
- Graph ledger queryable by `workflowRunId`; failed nodes resume as new attempts with no silent side-effect re-execution.
- Workflow Engine / Gate Engine tests unchanged and green.
- Each Epic A–F lands as its own Trellis task with its own red/green tests.
