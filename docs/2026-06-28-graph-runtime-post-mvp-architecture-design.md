# Graph Runtime Post-MVP Architecture Design

> Date: 2026-06-28
> Companion docs: `2026-06-28-graph-runtime-post-mvp-requirements.md`, `2026-06-28-graph-runtime-post-mvp-development-tasks.md`
> Builds on the failure-resume-first Graph Runtime MVP already implemented in API, Runner, shared types, and eval fixtures.

## 1. Current Baseline

The current graph runtime is a durable linear scheduler:

- `GraphDefinition`, `GraphNodeDefinition`, `GraphEdgeDefinition`, `GraphRun`, `GraphNodeRun`, and `GraphEvent` are shared contracts.
- `flowToGraphDefinition()` converts current `FLOW_REGISTRY` flows into linear graph snapshots.
- API persistence stores graph definitions/runs/node runs/events.
- Runner creates a graph run, asks the scheduler for one runnable node, executes it through `dispatchStep()`, and reports node start/finish events.
- `resumeGraphNode()` creates a new ready attempt from failed/cancelled/blocked node evidence.

Post-MVP extends this runtime without changing its authority model:

```text
Workflow Engine owns WorkflowRun.status
        │
        ▼
Graph Runtime owns dependency readiness, join evaluation, blocked/resume state
        │
        ▼
Runner executes selected nodes through existing dispatchStep()
        │
        ▼
StepCheckpoint / AgentSession / ToolInvocation / Artifact / GateRun remain evidence
Gate Engine remains verdict authority
```

## 2. Design Principles

1. **Sequential first, graph-correct always.** Branch fan-out can expose multiple ready nodes before true parallel Runner execution exists. Dispatch may remain one node at a time.
2. **Evidence isolation per branch.** Every branch attempt must have its own graph node run and evidence refs.
3. **Joins schedule; gates judge.** Join policies decide whether downstream nodes can be scheduled. They never decide product quality or workflow completion.
4. **Blocked state is data, not a log line.** Human interruption must be queryable and resumable from API-owned rows.
5. **Snapshots beat recompute.** A run resumes against the graph definition it started with.
6. **Eval before behavior flip.** Every new scheduler behavior gets deterministic green/red fixtures before becoming the default path.

## 3. Shared Contract Extensions

The current shared contract already reserves most Post-MVP concepts. Implementation should prefer typed helpers over schema churn.

### 3.1 Event Payload Helpers

Keep `GraphEvent.payload: Record<string, unknown>` at rest, but add typed builders/parsers in shared or API code:

- `GraphNodeBlockedPayload`
- `GraphJoinEvaluatedPayload`
- `GraphManualAdoptionPayload`
- `GraphResumeRequestedPayload`

These helpers should validate trust-boundary strings and metadata shape before persistence.

### 3.2 Join Metadata

Use `GraphNodeDefinition.metadata` for additive join parameters:

```ts
{
  quorumThreshold?: number;
  manualAdoptionRequired?: boolean;
  optionalUpstreamNodeIds?: string[];
  selectedUpstreamNodeIds?: string[];
}
```

Validation rules:

- `quorumThreshold` is required for `joinPolicy='quorum'`.
- `quorumThreshold` must be `1 <= threshold <= upstreamCount`.
- `manual_adopt` requires an explicit adoption event before release.
- Join nodes must have at least one incoming edge.

### 3.3 Blocked Metadata

Store blocked/interrupted state in existing fields first:

- `GraphNodeRun.status = 'blocked'`
- `GraphNodeRun.resumeCursor`
- `GraphRun.status = 'blocked'` when no runnable non-blocked nodes remain
- `GraphRun.interruptedReason`
- `GraphNodeRun.metadata.blockedReason`
- `GraphNodeRun.metadata.blockedBy`
- `GraphNodeRun.metadata.availableActions`

Add columns only if read-model performance or queryability requires them later.

## 4. Branch Fan-out Scheduler

The current scheduler treats all incoming edges as `all_success`. Post-MVP should evaluate `GraphEdgeMode` explicitly:

```text
edgeSatisfied(edge, latestRuns, events):
  all_success → from node latest status == passed
  any_success → at least one sibling edge into the target has from status == passed
  always      → from node reached terminal status
  manual      → matching manual GraphEvent released the edge
```

Runnable-node computation returns a list of all ready nodes. Runner chooses dispatch order deterministically:

1. Existing node order in `GraphDefinition.nodes`.
2. Stable tie-breaker by node id.
3. Later parallel runners can consume the same ready list with lease/claim semantics.

### Branch Dispatch

First branch implementation stays sequential:

```text
A passed
→ scheduler returns [B, C]
→ Runner dispatches B, records B evidence
→ scheduler still sees C ready
→ Runner dispatches C, records C evidence
```

This proves graph correctness before introducing worker concurrency.

## 5. Join Fan-in Evaluator

Add a pure evaluator:

```ts
evaluateJoinPolicy(input: {
  graph: GraphDefinition;
  joinNode: GraphNodeDefinition;
  incomingEdges: GraphEdgeDefinition[];
  nodeRuns: GraphNodeRun[];
  events: GraphEvent[];
}): JoinEvaluation
```

`JoinEvaluation` should include:

- `policy`
- `satisfied`
- `requiredUpstreamNodeIds`
- `satisfiedUpstreamNodeIds`
- `failedUpstreamNodeIds`
- `selectedUpstreamNodeIds`
- `blockedReason`
- `evidenceRefs`

### Policy Semantics

- `all_of`: satisfied when every required upstream node is `passed`.
- `any_of`: satisfied when at least one upstream node is `passed`.
- `first_success`: satisfied by the earliest passed upstream node by completion time, then selected for downstream evidence.
- `quorum`: satisfied when passed upstream count is at least `quorumThreshold`.
- `manual_adopt`: satisfied only after a manual adoption event selects valid upstream node ids.

When a join is evaluated, API persists `GraphEvent(type='join_evaluated')`. If unsatisfied and no upstream work remains possible, the join node becomes `blocked` with a structured reason.

## 6. Human Interrupt/Resume

Human interruption is represented as graph-owned blocked state:

```text
Runner/API detects human-required condition
→ API records GraphNodeRun.status='blocked'
→ API records GraphEvent(type='node_blocked')
→ GraphRun.status='blocked' if no other runnable nodes remain
→ Web/API exposes resume/adopt actions
→ operator resumes
→ API emits resume_requested and creates a ready attempt
```

### API Actions

Add graph action endpoints under `workflow-runs` or a dedicated graph route:

- `POST /workflow-runs/:id/graph/block-node`
- `POST /workflow-runs/:id/graph/resume-node` (extend existing route as needed)
- `POST /workflow-runs/:id/graph/adopt-join`

All actions must validate:

- workflow run exists;
- graph run belongs to workflow run;
- node run belongs to graph run;
- graph version matches;
- resume cursor or adoption target is valid;
- action does not mutate workflow/gate authority.

## 7. API Read Model

Extend `store.graphRuntime.byWorkflow(workflowRunId)` to include:

- `readyNodeIds`
- `blockedNodeIds`
- `joinEvaluations`
- `availableActions`
- `latestEventByNodeId`

Legacy graph rows and linear-only runs must still return the existing shape without crashing. Add fields as optional/additive to avoid breaking callers.

## 8. Web UI Design

The first UI should be operational, not decorative:

- Show graph nodes grouped by status: ready, running, blocked, passed, failed, skipped.
- Show branch groups and join nodes with compact dependency labels.
- For joins, show policy, waiting upstreams, selected upstreams, and evidence refs.
- For blocked nodes, show reason, cursor, actor, timestamp, and resume/adopt action.
- Keep existing workflow/gate status visually separate from graph scheduling status.

Avoid a complex graph canvas until the API/read model proves useful. A dense status panel is enough for the first implementation.

## 9. Eval Strategy

Extend `graph_runtime_fixture` scenarios so they can express:

- graph definition nodes/edges;
- initial node runs/events;
- expected runnable nodes;
- expected join evaluation;
- expected blocked/resume state;
- expected forbidden mutations.

Green fixtures:

- branch fan-out returns two ready nodes;
- sequential dispatch records isolated branch evidence;
- `all_of` waits then releases;
- `any_of` releases on one success;
- `first_success` selects earliest success;
- blocked node resumes as attempt+1.

Red fixtures:

- join releases before policy is satisfied;
- graph code mutates workflow/gate authority;
- branch evidence is reused across node ids;
- invalid quorum threshold is accepted;
- blocked resume without checkpoint/cursor succeeds.

## 10. Implementation Sequence

1. Branch scheduler pure functions and tests.
2. Branch ledger/read-model visibility.
3. Branch eval fixtures.
4. Join evaluator pure functions and tests.
5. Join event persistence and read model.
6. Join eval fixtures.
7. Human blocked state API and tests.
8. Web diagnostic panel/actions.
9. Full typecheck/test/eval pass.

## 11. Migration & Compatibility

- Existing linear graph runs continue to work.
- Existing `retry-step` behavior remains a compatibility facade.
- No existing migrations should be edited or renumbered.
- Any persistence changes are additive and legacy-safe.
- True parallel Runner execution requires a later claim/lease design and is not part of the first Post-MVP slice.
