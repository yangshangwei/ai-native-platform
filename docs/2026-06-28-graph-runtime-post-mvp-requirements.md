# Graph Runtime Post-MVP Requirements

> Date: 2026-06-28
> Source task: `.trellis/tasks/06-28-graph-runtime-post-mvp-branch-join-planning/`
> Builds on: `2026-06-27-graph-runtime-requirements.md`, `2026-06-27-graph-runtime-architecture-design.md`, `2026-06-27-graph-runtime-development-tasks.md`
> Scope: Branch fan-out, Join fan-in, and Human interrupt/resume after the failure-resume-first Graph Runtime MVP.

## 1. Background

The failure-resume-first Graph Runtime MVP is already in place:

- Shared graph contracts and guards exist in `packages/shared/src/types/graph-runtime.ts`.
- Existing `FLOW_REGISTRY` flows can be converted into deterministic graph definitions.
- API-owned `graph_definitions`, `graph_runs`, `graph_node_runs`, and `graph_events` tables exist.
- Runner dispatch creates graph node runs and calls the existing `dispatchStep()` implementation.
- Failed graph nodes can be resumed as new attempts from checkpoint evidence.
- Deterministic eval fixtures prove linear equivalence, resume success, and idempotency negative cases.

The remaining product gap is non-linear execution. Today the graph layer is still used as a linear scheduler over existing flows. Post-MVP work should unlock three operator-visible capabilities while preserving existing Workflow Engine and Gate Engine authority:

1. **Branch fan-out** — independent downstream nodes can become ready from the same predecessor.
2. **Join fan-in** — parallel or conditional branches can recombine under explicit scheduling policies.
3. **Human interrupt/resume** — a blocked graph node can persist across Runner restarts and resume through API/UI action.

## 2. Goal

Implement Post-MVP Graph Runtime behavior in staged, verifiable slices:

1. Add branch fan-out scheduling while keeping first execution sequential.
2. Add typed join fan-in semantics that aggregate branch evidence and release downstream scheduling only.
3. Add durable human interrupt/resume state and operator actions.
4. Extend API read models, Web UI diagnostics, and deterministic eval fixtures so each capability is visible and testable.

## 3. Non-Goals

- Replacing Workflow Engine ownership of `WorkflowRun.status`.
- Replacing Gate Engine ownership of pass/warn/fail verdicts.
- Mid-agent or mid-command resume inside a single model/tool invocation.
- True parallel Runner process execution in the first Post-MVP branch slice.
- Free-form multi-agent orchestration outside graph definitions.
- Introducing an external graph runtime dependency before local branch/join semantics are proven.
- Changing existing linear flow behavior unless a graph definition explicitly opts into non-linear nodes.

## 4. Users & User Stories

- **Runtime operator** — "When implementation, tests, and docs can proceed independently, I want the runtime to run each branch as an auditable graph node instead of forcing one long stage chain."
- **Reviewer / gate owner** — "When branches rejoin, I need the join to aggregate evidence but leave quality judgment to Gate Engine."
- **Human operator** — "When a node needs manual input, I want it to stay blocked durably and resume later without Runner-local memory."
- **Platform developer** — "I need branch/join semantics covered by deterministic tests before they are enabled in real flows."
- **Product UI user** — "I need to see which branches are ready/running/blocked, why a join is waiting, and what action resumes an interrupted node."

## 5. Functional Requirements

### R7 — Branch Fan-out

Independent or conditional downstream nodes can become runnable from dependency state.

Acceptance signals:

- Given graph node A with outgoing edges to B and C, when A passes both B and C become `ready`.
- First implementation may dispatch ready nodes sequentially, but the read model must expose both as ready/runnable before dispatch.
- Each branch attempt gets distinct `GraphNodeRun`, `StepRun`, `StepCheckpoint`, `AgentSession`, `ToolInvocation`, `Artifact`, and `GateRun` references.
- Branch state is reconstructable from persisted graph rows without Runner-local memory.
- Existing linear flows still produce the same stage order and evidence.

### R8 — Join Fan-in

Join nodes aggregate upstream branch evidence under an explicit `GraphJoinPolicy` and release downstream scheduling only.

Required policies:

- `all_of` — waits for every required upstream branch to pass.
- `any_of` — releases when at least one upstream branch passes.
- `first_success` — releases on the first passed branch and marks other still-pending siblings as no longer required for that join.
- `quorum` — releases when a configured threshold of upstream branches pass.
- `manual_adopt` — waits for a human adoption event selecting one or more upstream branches.

Acceptance signals:

- Join decisions emit `GraphEvent(type='join_evaluated')` with policy, upstream statuses, selected evidence refs, and reason.
- A join never writes `WorkflowRun.status` and never creates or mutates `GateRun` verdicts.
- Failed or skipped upstream branches are represented in dependency state and join evaluation output.
- Downstream nodes become ready only after the join policy is satisfied.
- Join policy failures block scheduling with an auditable reason rather than guessing.

### R9 — Human Interrupt/Resume

Graph nodes can enter durable `blocked` state with a visible reason and resume cursor.

Acceptance signals:

- A node can be marked `blocked` with `interruptedReason`, `resumeCursor`, actor, and structured metadata.
- Blocked state survives Runner process restart because it is API-owned.
- API provides an action to resume a blocked node and create an auditable `resume_requested` event.
- Web UI can show blocked nodes, pending reason, resume cursor/evidence, and resume action affordance.
- Resume creates a new graph node attempt or explicitly reuses evidence according to `GraphResumePolicy`; it never silently reruns side effects.

### R11 — Graph Definition Authoring for Non-Linear Flows

The platform can define and validate non-linear graph definitions without replacing `FLOW_REGISTRY`.

Acceptance signals:

- Existing flow-to-graph adapter remains valid for linear flows.
- A new graph-definition builder or fixture helper can express fan-out/fan-in nodes deterministically.
- Graph validation rejects unknown nodes, cycles where unsupported, invalid join policy metadata, impossible quorum thresholds, and ambiguous manual adoption configuration.
- New graph definitions are persisted as snapshots so historical runs resume against their original shape.

### R12 — Operator Visibility

API and Web surfaces expose enough graph state to operate branch/join/interrupted runs.

Acceptance signals:

- `GET /workflow-runs/:id/graph` includes node status, attempts, dependency state, join evaluation state, and blocked reasons.
- Web detail views can render graph nodes as status groups or a compact dependency view without hiding existing workflow/gate evidence.
- UI actions are narrow: resume blocked node, adopt manual join branch, and inspect evidence. No UI action directly sets workflow/gate truth.

### R13 — Deterministic Post-MVP Eval Fixtures

Branch, join, and human interrupt/resume are covered by deterministic eval fixtures.

Acceptance signals:

- Green fixtures cover branch fan-out, `all_of` join, `any_of`/`first_success` join, manual adoption, and blocked-node resume.
- Red fixtures fail for premature join release, gate authority mutation, duplicate branch evidence, invalid quorum, and resume without a checkpoint or cursor.
- `bun run eval` remains deterministic and does not require external model CLIs for graph runtime fixtures.

## 6. Authority Boundaries

| Concern | Owner | Post-MVP Graph Runtime role |
|---|---|---|
| Workflow lifecycle and `WorkflowRun.status` | Workflow Engine | Reads lifecycle state; never writes workflow status |
| Gate verdicts | Gate Engine | Reads `GateRun` evidence refs; never decides pass/warn/fail |
| Branch readiness | Graph Runtime | Computes ready/running/blocked branch nodes |
| Join policy satisfaction | Graph Runtime | Releases downstream scheduling only |
| Human blocked/resume state | Graph Runtime + API action | Persists blocked state and resume events |
| Node execution | Runner | Executes one selected node through existing dispatch path |
| UI actions | Web + API | Requests graph actions; does not mutate workflow/gate authority |

## 7. MVP Boundary for Post-MVP Work

The next implementation should be a **Post-MVP staged rollout**, not all advanced behavior at once.

| Capability | First Post-MVP slice | Later |
|---|---|---|
| Multiple ready branch nodes | Yes, sequential dispatch first | True parallel Runner workers |
| Join policy evaluation | `all_of`, `any_of`, `first_success` first | `quorum`, `manual_adopt` after policy harness |
| Human blocked/resume | API/read model first | Full UI ergonomics and notifications |
| Graph authoring | Fixture/builder helpers first | Product-facing graph editor |
| UI | Diagnostic status view first | Rich visual graph canvas |

## 8. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Branch scheduling duplicates side effects | Duplicate tool/model/command runs | Require per-node attempts and idempotency keys; red eval for duplicate evidence |
| Join policy usurps gates | Incorrect product status | R5/R8 guard tests: joins release scheduling only |
| Scheduler complexity regresses linear flows | Existing workflows break | Keep linear equivalence tests and run full API/Runner suites after each slice |
| Manual blocked state becomes unclear to operators | Stuck runs | Persist structured blocked reason, actor, cursor, and available actions |
| True parallelism introduces race conditions too early | Flaky ledger/state | First branch implementation dispatches ready nodes sequentially |
| Quorum/manual adoption semantics are underspecified | Ambiguous joins | Ship `all_of`/`any_of`/`first_success` before quorum/manual adoption |

## 9. Definition of Done

- Branch fan-out, join fan-in, and human interrupt/resume each have isolated Trellis implementation tasks.
- Every staged slice has red/green tests and deterministic eval fixtures.
- Existing failure-resume-first MVP tests remain green.
- API read model and Web diagnostics expose enough state for operators.
- Workflow Engine and Gate Engine authority boundaries are preserved by direct tests.
- Post-MVP docs remain the source of truth for follow-up implementation sessions.
