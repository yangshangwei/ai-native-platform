# Graph Runtime Patterns for Resume, Branch, and Join

## Purpose

This note compares durable graph-runtime patterns against this repo's existing Agent Runtime evidence ledger. It is a planning artifact only; it does not select an implementation dependency or change runtime behavior.

## Local Constraints

- `FLOW_REGISTRY` is an ordered stage list. `cmdOrchestrate()` slices by `startStage` and dispatches each `StageStep` sequentially through `dispatchStep()`.
- `StepCheckpoint` now gives one queryable envelope per `stepRunId`, linking input/output artifacts, ContextPack, AgentSession, ToolInvocation, GateRun, retry index, resume cursor, and failure reason.
- The current `POST /workflow-runs/:id/retry-step` path re-enters a workflow at a stage. It is not a checkpoint replay/resume model and does not model graph dependencies.
- `invokeSkill()` already supports same-step context retry with parent/child `AgentSession` links and a bounded retry index.
- Workflow Engine and Gate Engine must remain authoritative. Graph runtime must schedule work and preserve evidence; it must not decide pass/fail by itself.
- Runner remains an execution client that reports events through API ingress. Runner should not write DB state directly.

## Comparable Patterns

### Checkpointed State Graph

Systems like state-machine graph runtimes treat a run as nodes plus edges over a shared state object. Each node reads selected state, writes deltas, and a reducer merges deltas into the next state. Durable checkpoints are captured before/after node execution so a run can resume from the last committed node boundary.

Useful conventions:

- Node identity is stable and separate from display stage names.
- State updates are append/merge operations, not hidden mutation.
- Resume is explicit: load checkpoint, validate graph version, restart from runnable nodes.
- Interrupts are first-class pending states, not exceptions hidden in logs.

Fit here:

- Good fit for `StepCheckpoint` as a node-attempt envelope.
- Requires a new graph-definition layer above `FLOW_REGISTRY`, because ordered stages cannot express fan-out/fan-in.
- Reducer design must be conservative: artifact ids and evidence refs are append-only, while workflow/gate status remains owned by existing engines.

### Workflow Replay and Idempotent Activities

Durable workflow systems separate deterministic orchestration from side-effecting activities. The coordinator can replay the deterministic decision history to rebuild state, while activities use idempotency keys to avoid duplicate side effects.

Useful conventions:

- Persist the decision/event history, not only latest state.
- Give every side effect an idempotency key tied to run/node/attempt.
- Replaying orchestration must not re-run tools, commands, or model calls unless explicitly scheduled as a new attempt.
- Version graph definitions so old runs can resume against their original shape.

Fit here:

- Strong fit for API-side event history plus Runner-owned tool/agent ledgers.
- `ToolInvocation`, `AgentSession`, `CommandRun`, `Artifact`, and `GateRun` can become replay evidence without being re-executed.
- Requires a small `GraphEvent` or execution-plan ledger if we need full replay, because `StepCheckpoint` alone is a latest-state read model.

### DAG Scheduler Fan-out/Fan-in

DAG schedulers compute runnable nodes from dependencies. Branches fan out when multiple nodes become runnable; joins run when their dependencies are complete and their join policy passes.

Useful conventions:

- Node states are independent: `pending`, `ready`, `running`, `succeeded`, `failed`, `blocked`, `skipped`, `cancelled`.
- Edges express dependency semantics, not just visual order.
- Join policies are named and typed: all-of, any-of, quorum, first-success, manual-adopt.
- Failure policy is explicit: fail-fast, continue-on-warning, skip-dependents, or require human decision.

Fit here:

- Fits future branch/join semantics well, especially independent review/debug branches.
- Needs a scheduler-owned read model for runnable nodes and dependency resolution.
- Must avoid using join policy as a replacement for Gate Engine. Joins can aggregate evidence and decide scheduling readiness; Gate Engine still evaluates quality/status.

## Feasible Approaches

### Approach A: Internal Graph Adapter over Existing Stage Runtime

Represent current ordered flows as a graph internally: each stage becomes a node, each adjacent stage becomes an edge. Add graph metadata, node attempts, and resume cursors while dispatch still calls existing step functions.

Pros:

- Lowest blast radius.
- Lets current flows migrate without changing step behavior.
- Creates the type/API surface needed for later branch/join.

Cons:

- Early resume may still operate at node boundaries, not mid-tool or mid-agent.
- Branch/join execution arrives incrementally, after the linear adapter is stable.

### Approach B: Event-sourced Graph Runtime

Introduce an API-owned graph execution log: plan created, node scheduled, node started, node completed, branch opened, join evaluated, interrupt raised, resume requested. Derive `GraphNodeRun` and `StepCheckpoint` read models from events.

Pros:

- Best foundation for true replay, audit, and branch/join correctness.
- Makes idempotency and recovery rules explicit.
- Scales to human interrupts and future graph versions cleanly.

Cons:

- Larger migration surface.
- Requires careful event schema and deterministic scheduler tests before replacing current orchestration.

### Approach C: External Graph Runtime Behind Current Contracts

Adopt a graph runtime library later behind a project-owned adapter while keeping AgentSession, ToolInvocation, StepCheckpoint, GateRun, and Artifact as the durable contract.

Pros:

- Could accelerate advanced graph features once local invariants are settled.
- Avoids binding product semantics to a library during planning.

Cons:

- Premature dependency would fight existing Workflow/Gate authority.
- Most hard parts here are platform evidence, idempotency, and gates, not graph traversal syntax.

## Recommended Direction

Use Approach A as the first implementation lane, with Approach B's event vocabulary designed up front. In practice:

1. Define graph types and graph-version snapshots.
2. Adapt existing `FLOW_REGISTRY` flows into linear graphs.
3. Add node-run/read-model state derived from existing step events.
4. Implement resume at node boundary using checkpoint validation and idempotency rules.
5. Add branch/join scheduling only after linear graph resume is green.

This keeps behavior stable while making the next execution model explicit.

## Open Design Risks

- Graph versioning: old runs need to resume against the graph shape they started with, not the newest registry definition.
- Idempotency: re-running an agent/tool step must create a new attempt unless the previous evidence is explicitly reused.
- Join semantics: joins should aggregate evidence and release downstream scheduling, but should not override Gate Engine status.
- Parallel Runner execution: fan-out can be represented before true parallel workers exist; first implementation can execute ready nodes sequentially.
- Human interrupt/resume: interrupts need durable pending state and clear ownership between UI, API, and Runner.
