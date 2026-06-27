# Graph Runtime Resume, Branch, and Join Requirements

> Date: 2026-06-27 (updated 2026-06-28)
> Source: `.trellis/tasks/06-27-graph-runtime-resume-branch-join-planning/prd.md`
> Status: requirements baseline for the next Agent Runtime graph-runtime phase.
> Companion docs: `2026-06-27-graph-runtime-architecture-design.md`, `2026-06-27-graph-runtime-development-tasks.md`

## 1. Background

The Agent Runtime now has the core checkpoint ledger pieces needed for a resumable execution model:

- `AgentSession` records agent invocation lineage, retry attempts, context packs, and handoff links.
- `ToolInvocation` records Runner-owned tool usage as audit evidence.
- `HandoffRecord` bounds multi-agent collaboration without granting child agents workflow authority.
- `StepCheckpoint` (`packages/shared/src/types/step-checkpoint.ts`) creates a queryable envelope per `stepRunId`, linking `inputArtifactIds`, `outputArtifactIds`, `contextPackId`, `agentSessionIds`, `toolInvocationIds`, `gateRunIds`, `retryIndex`, `resumeCursor`, and `failureReason`.
- Eval fixtures cover agent backend, context pack, workflow evidence, and red/green failure cases.

The remaining gap is **execution semantics**. The current runtime still dispatches an ordered `FLOW_REGISTRY` stage list (`packages/shared/src/flows/registry.ts`): `cmdOrchestrate()` walks `flow.stages` and dispatches each through `dispatchStep()`. `POST /workflow-runs/:id/retry-step` can re-enter a workflow at a stage, but it is **not** full checkpoint resume, branch execution, join evaluation, or graph replay.

### 1.1 Pain Points Being Solved

The platform runs each user task through a multi-stage agent pipeline (e.g. `feature.standard`: context_pack → requirement → design → implementation → build_test → review → completion → knowledge). Every stage is a real agent run: it spends tokens and wall-clock time and produces real side effects (branches, file edits, test runs, commits). The current linear, non-resumable dispatcher creates four concrete pains:

1. **A late-stage failure wastes all prior work.** A run that fails at (e.g.) `build_test` cannot resume precisely from that checkpoint; `retry-step` only re-enters orchestration at a stage. Operators must redo earlier stages — losing their tokens/time/artifacts — or risk re-running side-effecting steps. *(MVP target: failure resume first.)*
2. **Independent work is forced into a single line.** Naturally parallel or conditional sub-work (implementation vs. docs vs. tests) cannot fan out under a strict stage N → N+1 chain. *(Branch — post-MVP.)*
3. **There is no rule for recombining parallel work.** Branches must rejoin under an explicit, typed join policy (`all_of` / `any_of` / `first_success` / `quorum` / `manual_adopt`), without usurping Gate Engine's pass/fail authority. *(Join — post-MVP.)*
4. **Human intervention is not durable.** Mid-flow human steps have no persistent "blocked at node X, reason Y, resume here" state; resume depends on Runner-local memory and is lost on process restart. *(Human interrupt/resume — post-MVP.)*

**Why now:** the `StepCheckpoint` ledger already records per-step evidence, but it is only *queryable* (audit/UI), not *actionable* for resume. This phase turns that evidence ledger from viewable history into a resumable execution engine — reusing existing checkpoints, never silently re-executing side effects, and preserving Workflow Engine and Gate Engine authority.

## 2. Goal & Non-Goals

### Goal

Design and implement an internal **Graph Runtime** that can represent current linear flows and future non-linear flows while preserving the existing platform authority boundaries. The first implementation slice is **failure resume first**:

1. Convert existing linear flows into graph definitions/snapshots (behavior-equivalent).
2. Add graph run + graph node run ledger/read models.
3. Keep scheduling linear and behavior-equivalent to current `FLOW_REGISTRY` dispatch.
4. Implement checkpoint-backed node-boundary resume for failed/cancelled/interrupted attempts.
5. Add deterministic eval fixtures (linear equivalence, resume success, idempotency negative).

### Non-Goals (this phase)

- Replacing Workflow Engine or Gate Engine authority.
- Free-form multi-agent orchestration or making Claude Code/Codex native subagents the control plane.
- Introducing an external graph-runtime dependency before local contracts are proven.
- Mid-agent / mid-command resume inside a single model or tool invocation.
- True parallel Runner execution in the first slice.
- Changing existing flow stage order or skill behavior.

## 3. Users & User Stories

- **Platform developer** — "I need graph execution semantics that evolve (branch/join later) without breaking existing workflow runs."
- **Runtime operator** — "When a run fails at stage 5 of 8, I want to resume from that node using durable evidence, not re-run stages 1–4 or risk duplicate side effects."
- **Reviewer / auditor** — "I need to see which node ran, which evidence it produced, and whether a resume created a new attempt or reused prior evidence."
- **CI owner** — "I need deterministic fixtures that prove graph behavior without invoking external model CLIs."

## 4. Functional Requirements

Each requirement carries a **testable acceptance signal**. IDs are referenced by the architecture design (§) and the task breakdown (Epic/Task IDs) for traceability.

### MVP requirements

- **R1 — Linear-flow equivalence.** Every `FLOW_REGISTRY` flow must be representable as a `GraphDefinition` whose topological stage order equals `flow.stages.map(s => s.stage)`.
  *Acceptance:* `assertGraphMatchesFlowOrder(flowToGraphDefinition(flow), flow)` passes for all four flows (`feature.standard`, `feature.fastforward`, `issue.standard`, `refactor.standard`); running through the graph scheduler produces the same `StepRun`/`StepCheckpoint` evidence as today.

- **R2 — Node-boundary failure resume.** A failed/cancelled/interrupted `GraphNodeRun` can be resumed by scheduling a **new attempt** (`attempt + 1`) bound to the graph snapshot and the node's prior `StepCheckpoint`.
  *Acceptance:* given a node in `failed` status with a `stepCheckpointId`, a resume creates a new `GraphNodeRun` (incremented `attempt`) linked to a new `StepRun`/`StepCheckpoint`; downstream nodes only become `ready` after the resumed node reaches `passed`.

- **R3 — Idempotency & no silent re-execution.** Replaying graph history must not re-execute tools, commands, or agent backends unless a new attempt is explicitly scheduled. Each attempt carries a run/node/attempt-scoped `idempotencyKey`.
  *Acceptance:* a completed (`passed`) side-effecting node cannot be silently re-run (resume of a `passed` node requires explicit `resumePolicy = reuse_evidence` or is rejected); replaying stored graph events reconstructs state without dispatching steps.

- **R4 — Durable, queryable graph ledger.** Graph runs and node runs are owned by the API, persisted additively, and queryable by `workflowRunId`. Node runs link to `StepRun` and `StepCheckpoint`.
  *Acceptance:* a new graph run is readable by `workflowRunId`; a `GraphNodeRun` exposes its `stepRunId` and `stepCheckpointId`; legacy runs with no graph rows return empty graph metadata (no crash).

- **R5 — Authority preservation (cross-cutting).** Graph Runtime owns scheduling readiness/dependency state only. It must never write `WorkflowRun.status` or decide gate pass/warn/fail.
  *Acceptance:* no graph code path mutates `WorkflowRun.status` or `GateRun` verdicts; Workflow Engine and Gate Engine tests are unchanged and green.

- **R6 — Deterministic eval fixtures.** A `graph_runtime_fixture` scenario kind proves graph behavior without external model CLIs.
  *Acceptance:* default `bun run eval` includes a passing linear-equivalence + resume-success fixture; `eval/scenarios-red` includes idempotency/order-violation fixtures that fail when invariants break.

- **R10 — retry-step compatibility facade.** The existing `POST /workflow-runs/:id/retry-step` route must keep working; where graph metadata exists it maps a stage retry onto a node-boundary resume.
  *Acceptance:* existing retry-step tests stay green; when a graph run exists, retry-step produces a node resume (new attempt) rather than an unscoped stage re-entry.

### Post-MVP requirements (designed now, shipped later)

- **R7 — Branch fan-out.** Independent/conditional nodes can become `ready` simultaneously from dependency state; each branch keeps isolated `GraphNodeRun`/`StepCheckpoint`/`AgentSession`/`ToolInvocation`/`Artifact`/`GateRun` evidence. First implementation may still dispatch ready nodes sequentially.
  *Acceptance:* two independent ready nodes each get isolated node runs and evidence refs.

- **R8 — Typed join semantics.** Join nodes aggregate upstream branch evidence under an explicit `GraphJoinPolicy` (`all_of` / `any_of` / `first_success` / `quorum` / `manual_adopt`). Joins release downstream scheduling only — never decide `GateRun`/`WorkflowRun` pass/fail.
  *Acceptance:* `all_of` waits for every upstream branch; `any_of` releases on first acceptable branch; a failed join does not override Gate status.

- **R9 — Human interrupt/resume.** Durable `blocked`/interrupted node state with a visible `resumeCursor` and `interruptedReason`; an API/UI action can resume without Runner-local memory.
  *Acceptance:* an interrupted node remains `blocked` across process restart; resume emits an auditable `GraphEvent` (`resume_requested`) and continues at the intended node.

## 5. Authority Boundaries

| Concern | Owner | Graph Runtime role |
|---|---|---|
| `WorkflowRun.status` & lifecycle | Workflow Engine (`apps/api/src/workflow-engine.ts`) | Reads only; never writes |
| Gate pass / warn / fail | Gate Engine | Reads `gateRunIds` as evidence; never decides |
| Node scheduling readiness & dependency state | **Graph Runtime** | Owns `GraphNodeStatus` (`pending`/`ready`/`running`/`passed`/`failed`/`blocked`/`skipped`/`cancelled`) |
| Per-step evidence | `StepCheckpoint` read model | Links node runs to checkpoints; checkpoint stays evidence-only |
| Node work execution & event reporting | Runner | Executes via `dispatchStep()`; reports through API ingress; never writes DB directly |

## 6. Data & Contract Requirements

- Graph state must be reconstructable from stored rows: `GraphDefinition` snapshot + `GraphRun` + `GraphNodeRun[]` (+ optional `GraphEvent[]` for replay/audit).
- `GraphNodeRun` must persist `stepRunId`, `stepCheckpointId`, `attempt`, `status`, `resumeCursor`, `idempotencyKey`, and `dependencyState` (already modeled in `packages/shared/src/types/graph-runtime.ts`).
- Persistence is **additive only** (new tables; no edit to existing `workflow_runs`/`step_runs` migrations). Legacy runs without graph rows must degrade to empty graph metadata.
- All graph identity strings (graph id, node id, statuses, policies) cross trust boundaries and must pass guards (`isGraphNodeStatus`, `isGraphJoinPolicy`, `isGraphResumePolicy`, `isGraphRuntimeSchemaVersion`, …).
- Determinism: graph construction must avoid `Date.now()`/random in pure paths (the adapter already injects a default `createdAt`), so fixtures and replay are reproducible.

## 7. MVP vs Post-MVP Boundary

| Capability | MVP | Post-MVP |
|---|---|---|
| Linear graph equivalence (R1) | ✅ | |
| Graph run/node ledger (R4) | ✅ | |
| Node-boundary failure resume (R2) | ✅ | |
| Idempotency / no silent re-run (R3) | ✅ | |
| retry-step facade (R10) | ✅ | |
| Deterministic eval (R6) | ✅ (linear/resume/idempotency) | branch/join fixtures |
| Branch fan-out (R7) | | ✅ |
| Join fan-in (R8) | | ✅ |
| Human interrupt/resume (R9) | | ✅ |
| True parallel Runner | | ✅ |

## 8. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Graph scheduling diverges from current dispatch | Behavior regression | R1 equivalence tests + scheduler runs behind existing `dispatchStep()`; ship behind internal path until green |
| Snapshot storage strategy unclear | Resume can't reload graph | Persist `GraphDefinition` snapshot per `GraphRun`; in-memory adapter only for pure tests |
| Idempotency depth | Resume can't enter mid-tool | Explicitly out of scope: resume is node-boundary only; document the boundary |
| Event-log scope creep | Over-engineering | Latest-state read models for MVP; reserve `GraphEvent` for replay, populate lazily |
| Operator confusion from new metadata | UX noise | Start graph metadata as diagnostics, not a primary operator flow |

## 9. Open Questions / Decisions Needed

- **Q1 — Snapshot vs. recompute:** persist a frozen `GraphDefinition` per `GraphRun`, or recompute from `FLOW_REGISTRY` + stored `graphVersion`? (Recommendation: persist a snapshot so flow edits don't retro-change historical runs.)
- **Q2 — Scheduler home:** does the runnable-node computation live in Runner (`apps/runner/src/orchestrator/graph-scheduler.ts`) or shared? (Recommendation: pure computation in shared, dispatch glue in Runner.)
- **Q3 — retry-step semantics:** should retry-step become a pure facade immediately, or only when graph rows exist? (Recommendation: facade-when-graph-exists to avoid regressing legacy runs.)
- **Q4 — GraphEvent in MVP:** ship event log now (replay-ready) or defer? (Recommendation: define the table additively, populate only `node_started`/`node_finished`/`resume_requested` in MVP.)
