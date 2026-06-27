# Graph Runtime Resume, Branch, and Join Architecture Design

> Date: 2026-06-27
> Source: `.trellis/tasks/06-27-graph-runtime-resume-branch-join-planning/prd.md`
> Decision: failure resume first; branch/join and human interrupt/resume are post-MVP behavior.

## 1. Design Summary

The Graph Runtime should be an internal execution layer between Workflow Engine and the existing step dispatcher:

```text
Workflow Engine
  -> Graph Runtime
      -> Graph Definition / Snapshot
      -> Graph Run / Node Run Ledger
      -> Runnable Node Scheduler
      -> Step Runtime / StepCheckpoint
  -> Agent Session / Tool Invocation / Artifact / Gate
```

The first slice must adapt current linear flows into graph definitions while preserving runtime behavior. It should not replace the current dispatcher yet; it should create the shared contract, read model, and tests that make node-boundary resume possible.

## 2. Existing Anchors

- Flow definitions: `packages/shared/src/flows/registry.ts`
- Flow/stage types: `packages/shared/src/types/workflow.ts`
- Step checkpoints: `packages/shared/src/types/step-checkpoint.ts`
- Orchestrator loop: `apps/runner/src/orchestrator.ts`
- Step implementations: `apps/runner/src/orchestrator/steps.ts`
- Agent invocation/retry: `apps/runner/src/orchestrator/invoke-skill.ts`
- API checkpoint merge: `apps/api/src/step-checkpoints.ts`
- Existing retry route: `apps/api/src/routes/workflow-runs.ts`

## 3. Authority Boundaries

- Workflow Engine remains the only owner of `WorkflowRun.status` and lifecycle transitions.
- Gate Engine remains the only pass/warn/fail authority.
- Graph Runtime owns graph scheduling state: which node is pending, ready, running, completed, failed, blocked, skipped, or cancelled.
- StepCheckpoint remains an evidence/read envelope and does not own workflow or gate truth.
- Runner executes node work and reports events through API ingress. It does not write graph state directly to the database.

## 4. Shared Type Model

### GraphDefinition

Immutable graph shape:

- `id`
- `schemaVersion`
- `version`
- `sourceFlowId`
- `description`
- `nodes`
- `edges`
- `entryNodeIds`
- `createdAt`
- `metadata`

The graph definition can initially be produced in-memory from `FLOW_REGISTRY`. API persistence can snapshot it later for graph runs.

### GraphNodeDefinition

Stable executable node identity:

- `id`
- `stage`
- `kind`
- `skillId`
- `label`
- `inputSelectors`
- `outputNames`
- `retryPolicy`
- `resumePolicy`
- `failurePolicy`
- `metadata`

For current flows, one stage becomes one node. A node id should be stable and include enough context to avoid ambiguity inside a flow, for example `<flowId>:<index>:<stage>`.

### GraphEdgeDefinition

Dependency edge:

- `id`
- `fromNodeId`
- `toNodeId`
- `mode`
- `condition`
- `metadata`

For current flows, each adjacent stage gets one all-success edge.

### GraphRun

Runtime instance:

- `id`
- `workflowRunId`
- `graphDefinitionId`
- `graphVersion`
- `status`
- `activeNodeIds`
- `interruptedReason`
- `createdAt`
- `updatedAt`
- `metadata`

### GraphNodeRun

Attempt-level node execution:

- `id`
- `graphRunId`
- `workflowRunId`
- `nodeId`
- `attempt`
- `status`
- `stepRunId`
- `stepCheckpointId`
- `resumeCursor`
- `idempotencyKey`
- `dependencyState`
- `startedAt`
- `completedAt`
- `metadata`

Node attempts should be append-only from a behavior standpoint: a resume creates a new attempt unless the system explicitly records evidence reuse.

### GraphEvent

Optional event log for replay and audit:

- graph planned
- node scheduled
- node started
- node completed
- node failed
- node blocked/interrupted
- resume requested
- join evaluated

Graph events are not required for the first shared type/adapter task, but the data model should leave room for them.

## 5. Linear Flow Adapter

The first adapter converts a `FlowDef` into a linear graph:

1. Create one node per `flow.stages` entry.
2. Mark the first node as the only entry node.
3. Create one edge from stage N to stage N+1.
4. Preserve `stage`, `kind`, and `skillId` exactly.
5. Attach `sourceFlowId` and graph version metadata.

Validation:

- Topological order must match `flow.stages.map(step => step.stage)`.
- The adapter must reject or guard empty graphs if future callers need executable graphs.
- Existing `FlowId` trust boundary remains the source of registered flow ids.

## 6. Resume Semantics

Node-boundary resume flow:

```text
load GraphRun + GraphDefinition snapshot
  -> load target GraphNodeRun + StepCheckpoint
  -> validate node belongs to graph
  -> validate node status allows resume
  -> validate idempotency/retry policy
  -> create a new node attempt
  -> dispatch existing step implementation
  -> link new StepRun/StepCheckpoint evidence
```

Validation rules:

- Wrong graph version: reject.
- Unknown node id: reject.
- Completed node with side effects: reject unless explicit replay/reuse mode is requested.
- Failed/cancelled/interrupted node: may schedule a new attempt if retry/resume policy permits.
- Missing checkpoint for a resumable node: reject or mark blocked; do not guess.

## 7. Branch and Join Design

Branch and join execution is post-MVP, but the contracts should support it:

- Multiple outgoing edges can make multiple downstream nodes ready.
- Ready nodes can initially be executed sequentially; parallel Runner workers are a later optimization.
- Join nodes evaluate typed join policies:
  - all-of
  - any-of
  - first-success
  - quorum
  - manual-adopt
- Join decisions aggregate evidence and release downstream scheduling only.
- Gate Engine remains responsible for quality and pass/fail judgments.

## 8. API Persistence Strategy

Follow the existing additive SQLite migration discipline:

1. Add new tables rather than rewriting `workflow_runs` or `step_runs` semantics.
2. Keep legacy runs safe: missing graph rows return empty graph metadata.
3. Link graph node runs to `step_runs` and `step_checkpoints`.
4. Prefer nullable forward-compatible fields for post-MVP branch/join/human interrupt metadata.
5. Expose read routes only after the store/read model is stable.

Suggested future tables:

- `graph_definitions`
- `graph_runs`
- `graph_node_runs`
- `graph_events`

## 9. Runner Integration Strategy

First implementation should not fork step behavior:

1. Build graph definitions from `FLOW_REGISTRY`.
2. Use graph scheduler to produce one runnable node at a time.
3. Dispatch the existing `StageStep` through `dispatchStep()`.
4. Record graph/node run state through API events.
5. Keep existing `stepStarted`, `stepFinished`, AgentSession, ToolInvocation, and GateRun writes intact.

This gives graph evidence without changing the skills, tools, gates, or report generation.

## 10. Eval Strategy

Add deterministic graph runtime fixtures before behavior changes:

- Linear equivalence: graph topological stage order equals registry stage order.
- Resume success: failed node resumes as a new attempt and links to a new checkpoint.
- Idempotency red case: completed side-effecting node cannot be silently re-run.
- Branch future fixture: two ready branch nodes produce separate evidence.
- Join future fixture: all-of waits for all upstream nodes; any-of releases on first acceptable upstream node.

## 11. Migration Order

1. Shared graph types and guards.
2. Flow-to-graph adapter and tests.
3. API graph run/node run ledger.
4. Linear graph scheduler behind existing dispatch.
5. Checkpoint-backed node-boundary resume.
6. Graph eval fixtures.
7. Branch fan-out.
8. Join fan-in.
9. Human interrupt/resume.

## 12. Open Risks

- Snapshot storage strategy: in-memory adapter is enough for shared tests, but API resume needs durable graph snapshots.
- Idempotency depth: first node-boundary resume cannot resume inside model/tool invocations.
- Event log scope: latest-state read models are easier, but full replay eventually needs graph events.
- UI exposure: graph metadata should start as diagnostics, not a primary operator flow.
