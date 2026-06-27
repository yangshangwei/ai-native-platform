# Graph Runtime Resume, Branch, and Join Planning

## Goal

Design the next Agent Runtime architecture for full graph resume, branch, and join capability on top of the existing checkpoint ledger. The design must preserve the current Workflow Engine and Gate Engine authority while turning the current sequential stage dispatcher into a durable, resumable graph execution model over time.

## What I Already Know

- The existing `FLOW_REGISTRY` is an ordered list of `StageStep` entries. It can express alternate linear flows and start-stage slicing, but not graph dependencies, fan-out, or joins.
- `cmdOrchestrate()` iterates the selected flow sequentially and dispatches each stage through `dispatchStep()`.
- `POST /workflow-runs/:id/retry-step` currently re-enters orchestration at a stage. It is a stage retry path, not full checkpoint resume or replay.
- `StepCheckpoint` is implemented as a durable read model linking a `stepRunId` to input/output artifacts, ContextPack, AgentSession ids, ToolInvocation ids, GateRun ids, retry index, resume cursor, and failure reason.
- `invokeSkill()` already supports bounded same-step context retry and links retry attempts through parent/child `AgentSession`.
- Tool, handoff, context retry, memory lifecycle, eval fixtures, and completion report evidence are already part of the Agent Runtime ledger.
- Existing Agent Runtime docs explicitly kept full graph runtime, branch/join execution, and checkpoint resume out of the StepCheckpoint MVP.

## Research References

- [`research/graph-runtime-patterns.md`](research/graph-runtime-patterns.md) — compares checkpointed state graphs, durable workflow replay/idempotency, and DAG scheduler fan-out/fan-in against this repo's constraints.

## Requirements

1. Define a graph execution model that can represent current linear flows and future non-linear flows without replacing Workflow/Gate authority.
2. Preserve current flow behavior as the baseline: every existing flow must be representable as a graph with equivalent execution order and evidence output.
3. Support checkpoint-based resume at stable node boundaries:
   - resume after failed, cancelled, interrupted, or manually retried node attempts;
   - validate graph version, node identity, previous checkpoint status, and idempotency policy before resuming;
   - never silently re-run side-effecting tools or model calls as if they were the original attempt.
4. Support branch execution:
   - independent or conditional graph nodes can become runnable from dependency state;
   - first implementation may execute ready nodes sequentially even if the model supports parallelism;
   - branch attempts must keep distinct StepCheckpoint, AgentSession, ToolInvocation, Artifact, and GateRun evidence.
5. Support join semantics:
   - joins aggregate upstream branch evidence;
   - join policies are explicit and typed, such as all-of, any-of, first-success, quorum, or manual-adopt;
   - joins release downstream scheduling but do not decide GateRun or WorkflowRun pass/fail status.
6. Support human interrupt/resume:
   - durable interrupted/blocked state;
   - visible resume cursor and pending reason;
   - API/UI action can resume the graph without requiring Runner-local memory.
7. Define idempotency and replay rules:
   - deterministic graph scheduling can be reconstructed from stored graph/run events;
   - side effects use run/node/attempt scoped idempotency keys;
   - replay of history must not re-execute tools, commands, or agent backends unless a new attempt is explicitly scheduled.
8. Extend eval coverage with deterministic graph fixtures before enabling behavior:
   - linear graph equivalence;
   - resume after failed node;
   - branch fan-out and join fan-in;
   - idempotency negative cases;
   - human interrupt/resume path.

## Architecture Approach

### Recommended Direction

Adopt a staged internal graph runtime:

1. **Graph Definition Layer**: introduce shared graph types that can represent nodes, edges, graph versions, node kinds, dependencies, join policies, retry/resume policy, and failure policy.
2. **Flow-to-Graph Adapter**: convert each existing `FLOW_REGISTRY` linear flow into a graph snapshot where stage N depends on stage N-1. This proves compatibility before adding non-linear execution.
3. **Graph Run Ledger**: add API-owned graph run and node run/read models, derived from existing `StepRun`, `StepCheckpoint`, `AgentSession`, `ToolInvocation`, and `GateRun` evidence where possible.
4. **Graph Scheduler**: compute runnable nodes from dependency state. Initially dispatch one runnable node at a time through existing step implementations.
5. **Checkpoint Resume**: resume from a node boundary by loading graph snapshot + node checkpoint, validating idempotency/retry policy, and scheduling a new node attempt or reusing prior evidence explicitly.
6. **Branch/Join Runtime**: add branch and join node semantics once the linear graph path is stable and tested.

### Key Type Concepts

- `GraphDefinition`: immutable graph shape with `id`, `version`, `sourceFlowId`, node list, edge list, and compatibility metadata.
- `GraphNodeDefinition`: stable node id, stage/kind/skill, input selectors, output declarations, retry policy, resume policy, and failure policy.
- `GraphEdgeDefinition`: from node, to node, condition, dependency mode.
- `JoinPolicy`: all-of, any-of, first-success, quorum, or manual-adopt.
- `GraphRun`: workflowRunId, graphDefinitionId/version snapshot, status, active node ids, interrupted reason, created/updated timestamps.
- `GraphNodeRun`: node id, stepRunId, attempt number, status, checkpoint id, dependency state, resume cursor, idempotency key, started/completed timestamps.
- `GraphEvent`: optional event log for plan/schedule/start/finish/interrupt/resume/join decisions, used for replay and audit.

### Authority Boundaries

- Workflow Engine remains the only owner of `WorkflowRun.status` and lifecycle transitions.
- Gate Engine remains the only pass/warn/fail authority for gates.
- Graph Runtime owns scheduling readiness and dependency state, not quality judgment.
- StepCheckpoint remains evidence/read model, not the source of workflow truth.
- Runner continues to execute node work and report events through API ingress; it does not write DB state directly.

## Feasible Alternatives

### A. Internal Graph Adapter First (Recommended)

Wrap existing linear flows in graph definitions and gradually move scheduling behind a graph adapter.

Pros: smallest blast radius, preserves current dispatch, enables type/eval hardening first.

Cons: initial resume is node-boundary only; branch/join comes in later tasks.

### B. Event-sourced Graph Runtime First

Introduce graph events and scheduler as the primary runtime before adapting all flows.

Pros: strongest replay/idempotency foundation.

Cons: higher risk and larger migration before proving linear equivalence.

### C. External Graph Runtime Later

Keep local contracts stable and evaluate an external graph runtime behind an adapter after internal semantics are proven.

Pros: leaves room for mature graph tooling.

Cons: premature adoption would not solve local evidence, gate, and idempotency contracts.

## Acceptance Criteria

- [x] PRD captures requirements, boundaries, risks, and non-goals for graph resume/branch/join.
- [x] Architecture design identifies graph types, API/Runner/shared boundaries, checkpoint integration, resume rules, branch/join semantics, and eval strategy.
- [x] Task breakdown decomposes implementation into small, testable follow-up tasks.
- [x] Context files are curated in `implement.jsonl` and `check.jsonl` for future implementation/check agents.
- [x] First MVP priority is confirmed with the user.
- [x] No implementation code is changed in this planning task unless the user explicitly asks to proceed.

## Decision (ADR-lite)

**Context**: The future graph runtime can start with failure resume, branch/join, or human interrupt/resume. All three need shared graph/node state, but branch/join and human interrupt introduce more scheduling and UI/API coordination before the current linear flow has been proven equivalent under a graph adapter.

**Decision**: Prioritize **Failure resume first** for the MVP. The first implementation should convert existing linear flows to graph nodes, add graph/node run ledger support, and implement checkpoint-backed node-boundary resume before enabling branch fan-out, join fan-in, or human interrupt/resume as behavior.

**Consequences**: This keeps the blast radius narrow and validates graph compatibility against existing flows first. Branch/join and human interrupt/resume remain explicitly designed, but they should ship after linear graph equivalence, idempotency, and node-boundary resume have deterministic tests.

## Implementation Task Breakdown

### Task 1: Shared Graph Type Contract

- Add shared types for `GraphDefinition`, `GraphNodeDefinition`, `GraphEdgeDefinition`, `GraphRun`, `GraphNodeRun`, `GraphEvent`, `JoinPolicy`, `RetryPolicy`, and `ResumePolicy`.
- Add guards for trust-boundary strings and schema versions.
- Tests: type/guard tests reject unknown node statuses, join policies, and graph schema versions.

### Task 2: Flow-to-Graph Adapter

- Convert existing `FLOW_REGISTRY` flows to graph snapshots with identical linear order.
- Preserve current `FlowId` and `WorkflowStage` contracts.
- Tests: every existing flow's graph topological order equals the current pinned stage order.

### Task 3: API Graph Run Ledger

- Add additive SQLite tables/read models for graph definitions/snapshots, graph runs, node runs, and optional graph events.
- Link node runs to `StepRun` and `StepCheckpoint`.
- Tests: legacy runs return empty graph runtime metadata; new graph runs can be queried by workflowRunId.

### Task 4: Linear Graph Scheduler Behind Existing Dispatch

- Compute runnable nodes from a graph snapshot, but dispatch existing steps through current `dispatchStep()` and step implementations.
- Execute ready nodes sequentially for the first pass.
- Tests: current feature/issue/refactor flows produce equivalent StepRun and checkpoint evidence.

### Task 5: Checkpoint Resume Semantics

- Replace stage-only retry with node-boundary resume primitives while keeping the old route as a compatibility facade if needed.
- Validate graph version, node state, checkpoint completeness, and idempotency key before scheduling a new attempt.
- Tests: failed node can resume as a new attempt; completed side-effecting node is not silently re-run; invalid resume cursor is rejected.

### Task 6: Branch Fan-out (post-MVP)

- Add dependency resolver support for multiple ready nodes.
- Keep first implementation sequential; later Runner parallelism can use the same ready-node API.
- Tests: independent branch nodes each get isolated node runs/checkpoints and evidence refs.

### Task 7: Join Fan-in (post-MVP)

- Add join node definitions and join policy evaluation.
- Join output should be scheduling/evidence aggregation only, with Gate Engine still judging pass/warn/fail.
- Tests: all-of waits for every branch; any-of releases downstream on first acceptable branch; failed joins do not override GateRun status.

### Task 8: Human Interrupt/Resume (post-MVP)

- Model durable interrupted/blocked state, pending reason, and resume command.
- UI/API can show interrupted graph node state and resume without Runner-local memory.
- Tests: interrupted node remains pending across process restart; resume creates an auditable event and continues at the intended node.

### Task 9: Eval Harness Graph Fixtures

- Add deterministic `graph_runtime_fixture` scenarios.
- Cover linear equivalence, resume failure path, branch/join, human interrupt, and idempotency negative cases.
- Tests: default eval passes green fixtures; red fixtures fail when graph invariants are violated.

## Out of Scope

- Replacing Workflow Engine or Gate Engine authority.
- Free-form multi-agent orchestration.
- Making Claude Code/Codex native subagents the platform control plane.
- Introducing external graph-runtime dependencies before local contracts are proven.
- Mid-agent or mid-command resume inside a single model/tool invocation.
- True parallel Runner execution in the first graph-runtime implementation.
- Changing existing flow behavior during this planning task.

## MVP Scope

First implementation slice:

1. Convert existing linear flows into graph definitions/snapshots.
2. Add graph run and graph node run ledger/read models.
3. Keep scheduling linear and behavior-equivalent to current `FLOW_REGISTRY` dispatch.
4. Implement checkpoint-backed node-boundary resume for failed/cancelled/interrupted attempts.
5. Add deterministic eval fixtures for linear graph equivalence, resume success, and idempotency negative cases.

Post-MVP:

- Branch fan-out execution.
- Join fan-in execution.
- Human interrupt/resume behavior.
- True parallel Runner execution.

## Technical Notes

- Key existing files inspected:
  - `docs/2026-06-27-agent-runtime-requirements.md`
  - `docs/2026-06-27-agent-runtime-architecture-design.md`
  - `docs/2026-06-27-agent-runtime-development-tasks.md`
  - `docs/2026-06-27-agent-runtime-red-green-test-plan.md`
  - `.trellis/tasks/archive/2026-06/06-27-agent-step-checkpoint-metadata/prd.md`
  - `.trellis/tasks/archive/2026-06/06-27-agent-step-checkpoint-metadata/research/checkpoint-gap-audit.md`
  - `packages/shared/src/flows/registry.ts`
  - `packages/shared/src/types/workflow.ts`
  - `packages/shared/src/types/step-checkpoint.ts`
  - `apps/runner/src/orchestrator.ts`
  - `apps/runner/src/orchestrator/steps.ts`
  - `apps/runner/src/orchestrator/invoke-skill.ts`
  - `apps/api/src/step-checkpoints.ts`
  - `apps/api/src/workflow-engine.ts`
  - `apps/api/src/routes/workflow-runs.ts`
- Relevant specs for future implementation:
  - `.trellis/spec/runner/backend/flow-registry.md`
  - `.trellis/spec/api/backend/database.md`
  - `.trellis/spec/shared/backend/evidence-verifier-protocol.md`
  - `.trellis/spec/runner/backend/eval-harness.md`
  - `.trellis/spec/shared/backend/context-injection-protocol.md`

## Definition of Done

- Planning PRD and research artifact are committed to this Trellis task.
- Future implementation/check context files reference the relevant specs and research.
- User chooses or confirms the MVP priority before implementation begins.
