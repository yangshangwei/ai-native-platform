# Graph Runtime Resume, Branch, and Join Requirements

> Date: 2026-06-27
> Source: `.trellis/tasks/06-27-graph-runtime-resume-branch-join-planning/prd.md`
> Status: requirements baseline for the next Agent Runtime graph-runtime phase.

## 1. Background

The Agent Runtime now has the core checkpoint ledger pieces needed for a resumable execution model:

- `AgentSession` records agent invocation lineage, retry attempts, context packs, and handoff links.
- `ToolInvocation` records Runner-owned tool usage as audit evidence.
- `HandoffRecord` bounds multi-agent collaboration without granting child agents workflow authority.
- `StepCheckpoint` creates a queryable envelope per `stepRunId`, linking inputs, outputs, ContextPack, AgentSession, ToolInvocation, GateRun, retry index, resume cursor, and failure reason.
- Eval fixtures cover agent backend, context pack, workflow evidence, and red/green failure cases.

The remaining gap is execution semantics. The current runtime still dispatches an ordered `FLOW_REGISTRY` stage list. `POST /workflow-runs/:id/retry-step` can re-enter a workflow at a stage, but it is not full checkpoint resume, branch execution, join evaluation, or graph replay.

### 1.1 Pain Points Being Solved

The platform runs each user task through a multi-stage agent pipeline (requirement → design → implement → build/test → review → report → knowledge). Every stage is a real agent run: it spends tokens and wall-clock time and produces real side effects (branches, file edits, test runs, commits). The current linear, non-resumable dispatcher creates four concrete pains:

1. **A late-stage failure wastes all prior work.** A run that fails at (e.g.) build/test cannot resume precisely from that checkpoint; `retry-step` only re-enters orchestration at a stage. Operators must redo earlier stages — losing their tokens/time/artifacts — or risk re-running side-effecting steps. *(MVP target: failure resume first.)*
2. **Independent work is forced into a single line.** Naturally parallel or conditional sub-work (implementation vs. docs vs. tests) cannot fan out under a strict stage N → N+1 chain. *(Branch — post-MVP.)*
3. **There is no rule for recombining parallel work.** Branches must rejoin under an explicit, typed join policy (all-of / any-of / first-success / quorum / manual-adopt), without usurping Gate Engine's pass/fail authority. *(Join — post-MVP.)*
4. **Human intervention is not durable.** Mid-flow human steps have no persistent "paused at node X, reason Y, resume here" state; resume depends on Runner-local memory and is lost on process restart. *(Human interrupt/resume — post-MVP.)*

**Why now:** the `StepCheckpoint` ledger already records per-step evidence, but it is only *queryable* (audit/UI), not *actionable* for resume. This phase turns that evidence ledger from viewable history into a resumable execution engine — reusing existing checkpoints, never silently re-executing side effects, and preserving Workflow Engine and Gate Engine authority.

## 2. Goal

Design and implement an internal Graph Runtime that can represent current linear flows and future non-linear flows while preserving the existing platform authority boundaries.

The first implementation slice is **Failure resume first**:

1. Convert existing linear flows into graph definitions/snapshots.
2. Add graph run and graph node run ledger/read models.
3. Keep scheduling linear and behavior-equivalent to current `FLOW_REGISTRY` dispatch.
4. Implement checkpoint-backed node-boundary resume for failed, cancelled, or interrupted attempts.
5. Add deterministic eval fixtures for linear graph equivalence, resume success, and idempotency negative cases.

## 3. Users

- Platform developers need graph execution semantics that can evolve without breaking existing workflow runs.
- Runtime operators need a reliable way to resume failed work from durable evidence rather than Runner-local memory.
- Reviewers and auditors need to understand which node ran, which evidence it produced, and whether a resume created a new attempt or reused prior evidence.
- CI owners need deterministic fixtures that prove graph behavior without invoking external model CLIs.

## 4. Product Requirements

### R1 Current Flows Must Remain Equivalent

Every existing `FLOW_REGISTRY` flow must be representable as a graph whose topological execution order matches the current ordered stage list.

Acceptance:

- `feature.standard`, `feature.fastforward`, `issue.standard`, and `refactor.standard` produce graph definitions with the same stage order as the current registry.
- Existing dispatch behavior does not change in the first graph-runtime slice.

### R2 Graph Definitions Must Be Versioned

Graph shape must be stored or snapshotted with a stable version so old runs can resume against the graph they started with.

Acceptance:

- A graph definition includes an id, schema version, graph version, source flow id, nodes, and edges.
- A graph run records the graph definition id/version it started with.
- Resume validates that the target node belongs to the run's graph snapshot.

### R3 Node Runs Must Link to Existing Evidence

Graph node attempts must link to existing evidence ledgers instead of duplicating evidence semantics.

Acceptance:

- A node run can reference `StepRun`, `StepCheckpoint`, `AgentSession`, `ToolInvocation`, `Artifact`, and `GateRun` evidence.
- `StepCheckpoint` remains a read/evidence model, not workflow status authority.

### R4 Resume Must Be Explicit and Idempotent

Resuming a node must be an explicit scheduling action. It must not silently re-run side-effecting work as the same attempt.

Acceptance:

- Resume validates graph version, node id, prior node status, checkpoint completeness, and idempotency key.
- Resuming a failed node creates a new attempt unless prior evidence is explicitly reused.
- A completed side-effecting node cannot be silently re-executed as if it were the original attempt.
- Invalid resume cursor or wrong graph version is rejected.

### R5 Branch and Join Semantics Must Be Designed Now

Branch and join behavior is post-MVP, but the type model must reserve the right concepts now to avoid another migration.

Acceptance:

- Node/edge types can represent multiple ready nodes.
- Join policy types are explicit: all-of, any-of, first-success, quorum, manual-adopt.
- Join policy can release scheduling but cannot set GateRun or WorkflowRun pass/fail status.

### R6 Human Interrupt/Resume Must Be Designed Now

Human interrupt/resume is post-MVP behavior, but graph/node state must be able to express durable interruption.

Acceptance:

- Graph run and node run status sets can express blocked/interrupted states.
- Resume cursor and pending reason are modelled in graph/node state.
- Runner-local process memory is not required to resume.

### R7 Deterministic Eval Must Lead Behavior Changes

Graph Runtime must be protected by deterministic fixtures before behavior changes are wired into production paths.

Acceptance:

- Eval fixtures prove linear graph equivalence.
- Eval fixtures prove failed-node resume creates a new attempt.
- Red fixtures prove invalid resume/idempotency violations fail.
- Future fixtures cover branch fan-out, join fan-in, and human interrupt/resume.

## 5. Non-Goals

- Replacing Workflow Engine authority.
- Replacing Gate Engine pass/warn/fail authority.
- Introducing an external graph-runtime dependency before local contracts are proven.
- Free-form multi-agent orchestration.
- Making Claude Code/Codex native subagents the platform control plane.
- Mid-agent or mid-command resume inside a single invocation.
- True parallel Runner execution in the first graph-runtime implementation.

## 6. Success Metrics

- All current flows have graph-definition coverage with matching stage order.
- Graph shared types and guards reject unknown statuses, join policies, resume policies, and schema versions at trust boundaries.
- Node-boundary resume behavior is testable without external model CLIs.
- Existing Agent Runtime tests and eval fixtures continue to pass.
- No workflow/gate status is derived from graph node state alone.

## 7. Risks

- **Graph version drift**: old runs could resume against a newer graph shape. Mitigation: snapshot or persist graph definition version per run.
- **Duplicate side effects**: resume could rerun tools or agents without clear attempt identity. Mitigation: node attempt ids and idempotency keys.
- **Authority leakage**: join policies could be mistaken for quality gates. Mitigation: joins schedule downstream work only; Gate Engine remains authoritative.
- **Over-large first slice**: branch/join plus resume would touch too much at once. Mitigation: failure-resume-first MVP.

## 8. Definition of Done

- Requirements, architecture, and task breakdown documents exist under `docs/`.
- Shared graph type and linear flow adapter contracts exist.
- Focused shared tests pass.
- Future API/Runner tasks have enough decomposition to proceed without re-litigating scope.
