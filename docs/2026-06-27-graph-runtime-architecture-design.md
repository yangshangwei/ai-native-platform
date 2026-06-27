# Graph Runtime Resume, Branch, and Join Architecture Design

> Date: 2026-06-27 (updated 2026-06-28)
> Source: `.trellis/tasks/06-27-graph-runtime-resume-branch-join-planning/prd.md`
> Companion: `2026-06-27-graph-runtime-requirements.md` (R-IDs referenced below), `2026-06-27-graph-runtime-development-tasks.md`
> Decision: **failure resume first**; branch/join and human interrupt/resume are post-MVP behavior.

## 1. Layering — where Graph Runtime sits

Graph Runtime is an internal **scheduling layer** between the Workflow Engine (authority) and the existing step dispatcher (execution). It does not replace the dispatcher; it decides *which node runs next* and *how to resume*, then dispatches through the unchanged step implementations.

```text
            Workbench UI (task queue, lifecycle board, evidence drill-down, human checkpoints)
                                   │
                                   ▼
                              Coordinator ── routes ask / feature / bugfix / refactor
                                   │
                                   ▼
                   Workflow Engine ─────────────【AUTHORITY: WorkflowRun.status + lifecycle】
                                   │
                                   ▼
        ┌──────────────────  Graph Runtime  ──────────────────┐   ← THIS PHASE
        │  GraphDefinition / snapshot (from FLOW_REGISTRY)     │     owns scheduling
        │  GraphRun / GraphNodeRun ledger (API-owned)          │     readiness only
        │  Runnable-node Scheduler  →  Checkpoint Resume        │
        └───────────────────────┬─────────────────────────────┘
                                 ▼
                    Runner — executes a node via dispatchStep()
                                 │  (reports events via API ingress; never writes DB directly)
                 ┌───────────────┼───────────────────────────┐
                 ▼               ▼                           ▼
          Gate Engine     StepCheckpoint ledger        AgentSession / ToolInvocation /
        【AUTHORITY:       (evidence read model,         Artifact / GateRun evidence
         pass/warn/fail】  per stepRunId)
```

## 2. Component Responsibilities & Authority

| Component | Owns | Must NOT |
|---|---|---|
| Workflow Engine | `WorkflowRun.status`, lifecycle transitions | — |
| Gate Engine | `GateRun` pass/warn/fail | — |
| **Graph Runtime** | `GraphRun`/`GraphNodeRun` scheduling state, dependency readiness, resume decisions | write `WorkflowRun.status`; decide gate verdicts; execute work itself |
| StepCheckpoint ledger | per-`stepRunId` evidence envelope | own workflow/gate truth |
| Runner | node execution via `dispatchStep()`, event reporting | write graph/DB state directly |

## 3. Shared Type Contracts

The foundation already exists in `packages/shared/src/types/graph-runtime.ts` (schema `GRAPH_RUNTIME_SCHEMA_VERSION = 'ainp.graph_runtime.v1'`). **This design extends those exact types — it does not redefine them.** Authoritative shapes already shipped:

- **Enums (const tuples + guards):**
  - `GraphNodeStatus` = `pending | ready | running | passed | failed | blocked | skipped | cancelled`
  - `GraphRunStatus` = `pending | running | blocked | passed | failed | cancelled`
  - `GraphEdgeMode` = `all_success | any_success | always | manual`
  - `GraphJoinPolicy` = `none | all_of | any_of | first_success | quorum | manual_adopt`
  - `GraphResumePolicy` = `none | new_attempt | reuse_evidence | manual_only`
  - `GraphFailurePolicy` = `fail_fast | continue | skip_dependents | require_human`
  - `GraphEventType` = `graph_planned | node_scheduled | node_started | node_finished | node_blocked | resume_requested | join_evaluated`
- **Interfaces:** `GraphRetryPolicy{maxAttempts,backoff}`, `GraphNodeDefinition`, `GraphEdgeDefinition`, `GraphDefinition`, `GraphRun`, `GraphNodeDependencyState`, `GraphNodeRun`, `GraphEvent`.
- **Guards:** `isGraphNodeStatus`, `isGraphRunStatus`, `isGraphEdgeMode`, `isGraphJoinPolicy`, `isGraphResumePolicy`, `isGraphFailurePolicy`, `isGraphEventType`, `isGraphRuntimeSchemaVersion`.

Key fields the runtime depends on (already present — no change needed):

- `GraphNodeDefinition`: `id`, `stage` (`WorkflowStage`), `kind` (`StageStepKind`), `skillId`, `label`, `inputSelectors[]`, `outputNames[]`, `retryPolicy`, `resumePolicy`, `failurePolicy`, `joinPolicy`, `metadata`.
- `GraphNodeRun`: `id`, `graphRunId`, `workflowRunId`, `nodeId`, `attempt`, `status`, `stepRunId`, `stepCheckpointId`, `resumeCursor`, `idempotencyKey`, `dependencyState`, `startedAt`, `completedAt`, `metadata`. **It already links to `StepRun` and `StepCheckpoint`.**

### Additive deltas this phase may need (only if a gap is proven during implementation)

- `GraphEvent.payload` typing helpers per `GraphEventType` (keep `payload: Record<string, unknown>` at rest; add typed parsers in the read layer).
- Optional `GraphNodeRun.metadata.replayOf` to mark a `reuse_evidence` resume that intentionally does not re-execute.
- `quorum` parameterization (e.g. `metadata.quorumThreshold`) on join nodes — additive, post-MVP.

> Rule: any new field is **additive and nullable/optional**; never repurpose an existing field's meaning.

## 4. Flow-to-Graph Adapter

Already implemented in `packages/shared/src/flows/graph-adapter.ts` (pure, deterministic):

- `flowToGraphDefinition(flow, options?)` — one `GraphNodeDefinition` per `flow.stages` entry; linear `all_success` edges between adjacent stages; `entryNodeIds = [firstNode]`. Stable ids: node `node:${flowId}:${index}:${stage}`, edge `edge:${flowId}:${index}:${from}->${to}`, graph `graph:${flowId}:${version}`. Defaults: `retryPolicy {maxAttempts:1, backoff:'none'}`, `resumePolicy 'new_attempt'`, `failurePolicy 'fail_fast'`, `joinPolicy 'none'`. Deterministic `createdAt` default (no `Date.now()`).
- `graphStageOrder(graph)` — Kahn topological sort → `WorkflowStage[]`; throws on cycle/disconnected.
- `assertGraphMatchesFlowOrder(graph, flow)` — asserts topo order equals `flow.stages.map(s => s.stage)` (this is the R1 equivalence guarantee).

All four registered flows adapt cleanly: `feature.standard` (8 nodes), `feature.fastforward` (4), `issue.standard` (6), `refactor.standard` (6). `stage`/`kind`/`skillId` are preserved exactly so `dispatchStep()` behavior is identical.

## 5. API Graph Run Ledger (additive persistence)

Follow the additive SQLite discipline (`.trellis/spec/api/backend/database.md`): **new tables only**, no edits to `workflow_runs`/`step_runs` migrations; legacy runs without graph rows return empty graph metadata.

| Table | Key columns (additive) |
|---|---|
| `graph_definitions` | `id` (PK), `schema_version`, `version`, `source_flow_id`, `description`, `nodes_json`, `edges_json`, `entry_node_ids_json`, `created_at`, `metadata_json` |
| `graph_runs` | `id` (PK), `workflow_run_id` (FK, indexed), `graph_definition_id` (FK), `graph_version`, `status`, `active_node_ids_json`, `interrupted_reason`, `created_at`, `updated_at`, `metadata_json` |
| `graph_node_runs` | `id` (PK), `graph_run_id` (FK, indexed), `workflow_run_id` (indexed), `node_id`, `attempt`, `status`, `step_run_id` (FK→`step_runs`), `step_checkpoint_id` (FK→`step_checkpoints`), `resume_cursor`, `idempotency_key` (unique per run/node/attempt), `dependency_state_json`, `started_at`, `completed_at`, `metadata_json` |
| `graph_events` | `id` (PK), `graph_run_id` (FK, indexed), `workflow_run_id`, `node_id`, `type`, `created_at`, `payload_json` |

- **Read model:** `buildGraphRuntimeReadModel(workflowRunId)` joins `graph_runs` → `graph_node_runs` → existing `StepCheckpoint` read model, returning latest-state node status + evidence refs. Mirrors the additive read-model pattern in `apps/api/src/step-checkpoints.ts`.
- **Endpoints (read-only first):** `GET /workflow-runs/:id/graph` (graph run + node runs + evidence refs); legacy runs → `{ graphRun: null, nodes: [] }`.
- **Linking:** `graph_node_runs.step_run_id` / `step_checkpoint_id` are populated when the node dispatches a `StepRun`; the StepCheckpoint stays the evidence source of truth.

## 6. Graph Scheduler Algorithm

```text
computeRunnableNodes(graphDef, nodeRuns):
  for each node in graphDef.nodes:
    latest = latestAttempt(nodeRuns, node.id)
    if latest.status in {running, passed, skipped, cancelled}: continue
    upstream = incomingEdges(graphDef, node.id)
    satisfied = every upstream edge satisfied by edge.mode:
        all_success → from-node latest.status == passed
        any_success → at least one from-node passed
        always      → from-node reached a terminal status
        manual      → an explicit GraphEvent released it
    if satisfied: mark node ready
  return nodes whose status == ready
```

- **MVP behavior:** even when multiple nodes are `ready`, dispatch **one at a time** (sequential), preserving today's behavior. Linear graphs always yield exactly one runnable node, identical to current dispatch order.
- The scheduler is a **pure function** of `(GraphDefinition, GraphNodeRun[])` so it is unit-testable and replay-safe. Dispatch glue lives in Runner; it calls the scheduler, then `dispatchStep()` for the chosen node, then reports `node_started`/`node_finished` events.
- Version guard: scheduler rejects a `GraphRun` whose `graphVersion` ≠ the loaded `GraphDefinition.version`.

## 7. Checkpoint Resume Algorithm

```text
resumeNode(workflowRunId, nodeId, mode):
  graphRun  = loadGraphRun(workflowRunId)            # else reject: no graph run
  graphDef  = loadGraphDefinition(graphRun.graphDefinitionId)
  validate graphRun.graphVersion == graphDef.version  # else reject: version mismatch
  node      = graphDef.nodes.find(nodeId)             # else reject: unknown node
  last      = latestAttempt(nodeId)                   # GraphNodeRun
  validate node.resumePolicy != 'none'                # else reject: not resumable
  switch last.status:
    failed | cancelled | blocked:
        require checkpoint present (last.stepCheckpointId)  # else mark blocked, do not guess
        newAttempt = last.attempt + 1
        idempotencyKey = key(workflowRunId, nodeId, newAttempt)
        create GraphNodeRun{attempt:newAttempt, status:ready, idempotencyKey}
        emit GraphEvent(resume_requested)
        → scheduler dispatches it as a fresh StepRun
    passed:
        if mode == reuse_evidence: link prior evidence, mark metadata.replayOf, DO NOT execute
        else: REJECT (no silent re-run of a side-effecting completed node)
    running | ready | pending:
        REJECT (nothing to resume)
```

Validation invariants (R2/R3): wrong graph version → reject; unknown node → reject; completed side-effecting node → reject unless `reuse_evidence`; missing checkpoint on a resumable node → mark `blocked`, never guess; a resume always produces a **new attempt** with a fresh `idempotencyKey` (never reuses the original attempt's identity).

## 8. Idempotency & Replay Rules

- `idempotencyKey` is scoped to `(workflowRunId, nodeId, attempt)`. Runner-side side effects (commands, agent backends, tool calls) are keyed by it so a retry of the *same* attempt is a no-op while a *new* attempt is a deliberate re-execution.
- **Replay** = reconstructing graph state from `graph_node_runs` (+ `graph_events`) WITHOUT dispatching. It must never call `dispatchStep()`. Only the scheduler's explicit "dispatch ready node" path executes work.
- Determinism: pure paths (adapter, scheduler) avoid `Date.now()`/random; timestamps are injected, enabling reproducible fixtures.

## 9. Branch & Join Runtime (post-MVP design)

- **Branch (R7):** the same `computeRunnableNodes` returns ≥2 `ready` nodes when a completed node has multiple outgoing edges. Each branch gets isolated `GraphNodeRun`/`StepCheckpoint`/`AgentSession`/`ToolInvocation`/`Artifact`/`GateRun` evidence. First implementation still dispatches sequentially; true parallel Runner is later.
- **Join (R8):** a join node carries `joinPolicy ∈ {all_of, any_of, first_success, quorum, manual_adopt}`. On each upstream completion the runtime evaluates the policy (emitting `join_evaluated`) and releases downstream scheduling only. **Join never sets `GateRun`/`WorkflowRun` pass/fail.** `quorum` reads a threshold from node metadata; `manual_adopt` waits for an explicit human `GraphEvent`.
- **Human interrupt/resume (R9):** a node can enter durable `blocked` with `interruptedReason` + `resumeCursor` on the `GraphRun`/`GraphNodeRun`; an API/UI action emits `resume_requested` and continues — state survives Runner restart because it is API-owned.

## 10. Sequence Flows

**Normal linear run (MVP):**
```text
WorkflowRun created → Graph Runtime builds GraphRun from flowToGraphDefinition(flow)
loop: scheduler → 1 ready node → Runner dispatchStep() → StepRun + StepCheckpoint
      → report node_finished(passed) → next node ready → … → all passed → GraphRun passed
(Workflow Engine still owns WorkflowRun.status throughout; Gate Engine still judges gates)
```

**Resume after a failed node (MVP):**
```text
node build_test → failed (StepCheckpoint.failureReason set, GraphNodeRun.status=failed)
operator/API resume → validate version+node+checkpoint → new GraphNodeRun(attempt+1, ready)
→ scheduler dispatches → new StepRun/StepCheckpoint → passed → downstream review becomes ready
(earlier passed nodes are NOT re-run; no duplicate side effects)
```

**Branch + join (post-MVP):**
```text
node A passed → edges to B and C (both ready) → dispatch B, then C (sequential first pass)
→ join node J (joinPolicy=all_of) waits for B.passed AND C.passed → join_evaluated → D ready
(Gate Engine still independently judges each node's gates)
```

## 11. Compatibility / Migration

- `POST /workflow-runs/:id/retry-step` becomes a **facade**: when a `GraphRun` exists for the run, it resolves the target stage to its node and calls `resumeNode(...)` (node-boundary new attempt); when no graph metadata exists (legacy runs), it keeps the current stage-reentry behavior. Existing retry-step tests stay green (R10).
- Scheduler is introduced **behind an internal path / flag**; default behavior stays byte-equivalent until R1/R4 tests are green, then it becomes the dispatch source.
- No skill, tool, gate, or report code changes — graph evidence is layered on top of unchanged `stepStarted`/`stepFinished`/AgentSession/ToolInvocation/GateRun writes.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Scheduler diverges from current dispatch | R1 equivalence tests; ship behind internal path until green |
| Durable snapshot vs recompute (Open Q1) | Persist `GraphDefinition` snapshot per `GraphRun` so flow edits don't retro-change history |
| Idempotency depth (mid-tool resume) | Out of scope; resume is node-boundary only — documented |
| Event-log scope creep | MVP populates only `node_started`/`node_finished`/`resume_requested`; full replay later |
| UI over-exposure | Graph metadata starts as diagnostics, not a primary operator flow |
