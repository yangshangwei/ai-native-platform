# Graph Runtime Architecture

**Date**: 2026-08-09  
**Status**: Current Implementation  
**Audience**: Developers, Architects

## Overview

The Graph Runtime provides **DAG-based workflow orchestration** with dependency tracking, resumability, and automatic status aggregation. It sits on top of the Workflow Engine, translating flow definitions into executable dependency graphs.

**Core Capability**: Enables complex workflows with parallel stages, conditional paths, and graceful recovery from failures.

**Location**: `apps/api/src/graph-runtime.ts` (161 lines), `packages/shared/src/types/graph-runtime.ts` (327 lines)

---

## Architecture Principles

### 1. DAG-First Orchestration

Workflows are modeled as Directed Acyclic Graphs (DAGs):
- **Nodes** = Workflow stages (requirement, design, implementation, etc.)
- **Edges** = Dependencies ("design depends on requirement")

**Why DAG**: Enables parallel execution, clear dependency chains, and deterministic scheduling.

### 2. Resumable Execution

Every node execution creates a `GraphNodeRun` with checkpoint support:
- Failed nodes can be retried without re-running successful dependencies
- Operational pauses preserve graph state
- Manual resume picks up exactly where it stopped

### 3. Status Aggregation

Graph status is **derived** from node statuses, never stored:
- Any `cancelled` → Graph `cancelled`
- Any `failed` → Graph `failed`
- Any `blocked` → Graph `blocked`
- Any active → Graph `running`
- All terminal non-blocking → Graph `passed`

**Why derived**: Single source of truth (node statuses), prevents inconsistency.

---

## Core Data Models

### GraphDefinition

**Purpose**: Static DAG structure compiled from FlowDef.

```typescript
interface GraphDefinition {
  flowId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  entryNodes: WorkflowStage[];  // Nodes with no dependencies
}

interface GraphNode {
  stage: WorkflowStage;
  label: string;
  dependsOn: WorkflowStage[];  // Inbound dependencies
  blocking: boolean;            // If true, failure blocks downstream
}

interface GraphEdge {
  from: WorkflowStage;
  to: WorkflowStage;
}
```

**Example** (`feature.standard`):
```
context_pack (entry)
  ↓
requirement
  ↓
design
  ↓
implementation → build_test
  ↓              ↓
review ←────────┘
  ↓
completion
  ↓
knowledge
```

**Location**: Compiled by `flowToGraphDefinition()` in `apps/runner/src/orchestrator/graph-scheduler.ts`

---

### GraphRun

**Purpose**: Execution instance tied to a WorkflowRun.

```typescript
interface GraphRun {
  id: GraphRunId;
  workflowRunId: WorkflowRunId;
  graphDefinitionId: string;
  status: GraphRunStatus;  // Derived, not stored
  nodeRuns: GraphNodeRun[];
  createdAt: Iso8601;
  updatedAt: Iso8601;
}

type GraphRunStatus = 
  | 'running'
  | 'passed'
  | 'failed'
  | 'blocked'
  | 'cancelled';
```

**Storage**: `graph_runs` table (metadata only, nodeRuns stored separately)

---

### GraphNodeRun

**Purpose**: Execution attempt for a single node (stage).

```typescript
interface GraphNodeRun {
  id: GraphNodeRunId;
  graphRunId: GraphRunId;
  stage: WorkflowStage;
  attemptNumber: number;       // Increments on retry
  status: GraphNodeStatus;
  stepRunId: StepRunId | null; // Links to workflow StepRun
  checkpointId: string | null; // For resume
  startedAt: Iso8601 | null;
  completedAt: Iso8601 | null;
  error: string | null;
}

type GraphNodeStatus =
  | 'pending'     // Waiting for dependencies
  | 'ready'       // Dependencies satisfied, runnable
  | 'running'     // Dispatched to runner
  | 'passed'      // Successfully completed
  | 'failed'      // Failed, may be retried
  | 'blocked'     // Dependency failed, cannot run
  | 'skipped'     // Intentionally skipped (conditional path)
  | 'cancelled';  // User-initiated cancellation
```

**Storage**: `graph_node_runs` table

---

## Node Lifecycle

```
pending (waiting for dependencies)
  ↓ (dependencies satisfied)
ready (runnable, waiting for scheduler)
  ↓ (dispatcher picks node)
running (active execution)
  ↓ (execution completes)
passed / failed / blocked
  ↓ (manual resume)
ready (new attempt)
  ↓
running → passed / failed / blocked
```

**State Transitions**:
1. **pending → ready**: All `dependsOn` nodes are `passed` or `skipped`
2. **ready → running**: Scheduler dispatches to runner
3. **running → passed**: StepRun completes with `status='passed'`
4. **running → failed**: StepRun completes with `status='failed'`
5. **running → blocked**: Operational failure (backend unavailable, timeout)
6. **failed/blocked → ready**: `resumeGraphNode()` creates new attempt

---

## Key Functions

### resumeGraphNode()

```typescript
function resumeGraphNode(
  graphRunId: GraphRunId,
  nodeRunId: GraphNodeRunId
): GraphNodeRun
```

**Purpose**: Retry a failed or blocked node.

**Logic**:
1. Validate current node status is `failed`, `blocked`, or `cancelled`
2. Increment `attemptNumber`
3. Create new `GraphNodeRun` with `status='ready'`
4. If checkpoint exists, restore from checkpoint (future: not yet implemented)

**Usage**: Manual retry after fixing operational issue (e.g., backend came back online).

**Location**: `apps/api/src/graph-runtime.ts:50-90`

---

### resumeGraphStage()

```typescript
function resumeGraphStage(
  graphRunId: GraphRunId,
  stage: WorkflowStage
): GraphNodeRun
```

**Convenience wrapper**: Finds latest node run for stage and calls `resumeGraphNode()`.

**Location**: `apps/api/src/graph-runtime.ts:90-110`

---

### deriveGraphRunStatus()

```typescript
function deriveGraphRunStatus(nodeRuns: GraphNodeRun[]): GraphRunStatus
```

**Purpose**: Compute graph status from node statuses.

**Algorithm**:
1. If any node is `cancelled` → `cancelled`
2. If any node is `failed` → `failed`
3. If any node is `blocked` → `blocked`
4. If any node is `pending`, `ready`, or `running` → `running`
5. If all nodes are terminal non-blocking (`passed`, `skipped`) → `passed`

**Why this order**: Failures and cancellations are "sticky" — once they occur, graph cannot pass even if other nodes complete.

**Location**: `packages/shared/src/types/graph-runtime.ts:180-210`

---

## Scheduler Integration

### nextRunnableGraphNode()

**Purpose**: Pick next node to execute (runner-side scheduling).

```typescript
function nextRunnableGraphNode(
  graphDef: GraphDefinition,
  nodeRuns: GraphNodeRun[]
): WorkflowStage | null
```

**Algorithm**:
1. Filter nodes with `status='ready'`
2. Among ready nodes, pick one with highest priority (entry nodes first)
3. If none ready, check if dependencies are satisfiable:
   - If all dependencies are terminal, but node is still `pending` → blocked
   - If some dependencies are still active → wait
4. Return stage or `null` (graph complete or blocked)

**Location**: `apps/runner/src/orchestrator/graph-scheduler.ts:120-200`

### Dependency Resolution

**Rule**: A node becomes `ready` when **all** its `dependsOn` nodes are `passed` or `skipped`.

**Example**:
```
requirement (passed)
  ↓
design (ready, can run)
  ↓
implementation (pending, waiting for design)
```

If `design` fails:
```
requirement (passed)
  ↓
design (failed)
  ↓
implementation (blocked, cannot run)
```

---

## Checkpoint Mechanism

### Purpose

Enable **partial resume**: Skip already-completed work, restart from failure point.

### StepCheckpoint

```typescript
interface StepCheckpoint {
  id: string;
  stepRunId: StepRunId;
  graphNodeRunId: GraphNodeRunId;
  stage: WorkflowStage;
  workspacePath: string;
  branch: string;
  commitSha: string | null;
  artifacts: ArtifactId[];
  metadata: Record<string, unknown>;
  createdAt: Iso8601;
}
```

**Stored**: On step completion (both success and failure).

**Used**: On `resumeGraphNode()` to restore worktree state, context, and artifacts.

**Location**: `apps/api/src/step-checkpoints.ts`

---

### Resume Flow

```
User triggers resume:
  ↓
API: resumeGraphNode(nodeRunId)
  ├─ Load latest checkpoint for node
  ├─ Create new GraphNodeRun (attemptNumber++)
  ├─ Set status='ready'
  └─ Return new nodeRun
  ↓
Runner: nextRunnableGraphNode()
  ├─ Finds new nodeRun with status='ready'
  ├─ Loads checkpoint
  ├─ Restores worktree (git reset to commitSha)
  ├─ Injects restored artifacts into context
  └─ Dispatches stage execution
```

**Current Limitation**: Checkpoint restore logic is partial. Full worktree + artifact restoration planned but not fully implemented.

---

## Flow Registry Integration

### FLOW_REGISTRY

**Purpose**: Maps flowId to stage list with dependencies.

```typescript
// Example: feature.standard
{
  flowId: 'feature.standard',
  stages: [
    { stage: 'context_pack', dependsOn: [] },
    { stage: 'requirement', dependsOn: ['context_pack'] },
    { stage: 'design', dependsOn: ['requirement'] },
    { stage: 'implementation', dependsOn: ['design'] },
    { stage: 'build_test', dependsOn: ['implementation'] },
    { stage: 'review', dependsOn: ['implementation', 'build_test'] },
    { stage: 'completion', dependsOn: ['review'] },
    { stage: 'knowledge', dependsOn: ['completion'] },
  ]
}
```

**Location**: `packages/shared/src/flow-registry.ts`

### flowToGraphDefinition()

**Purpose**: Convert FlowDef to GraphDefinition.

**Logic**:
1. Create nodes from stages
2. Create edges from `dependsOn`
3. Identify entry nodes (nodes with no inbound edges)
4. Validate no cycles (DAG constraint)

**Location**: `apps/runner/src/orchestrator/graph-scheduler.ts:40-90`

---

## Parallel Execution Example

### Flow with Parallel Stages

```typescript
{
  flowId: 'feature.fastforward',
  stages: [
    { stage: 'context_pack', dependsOn: [] },
    { stage: 'implementation', dependsOn: ['context_pack'] },
    { stage: 'build_test', dependsOn: ['context_pack'] },  // Parallel with implementation
    { stage: 'review', dependsOn: ['implementation', 'build_test'] },
  ]
}
```

**Graph**:
```
context_pack
  ├─→ implementation ─┐
  └─→ build_test ────→ review
```

**Execution**:
1. `context_pack` runs first
2. Once `context_pack` passes, **both** `implementation` and `build_test` become `ready`
3. Runner can dispatch both in parallel (if multiple runners, or sequential if single runner)
4. `review` waits until **both** complete

---

## Error Handling

### Blocking vs. Non-Blocking Failures

**Blocking** (`node.blocking = true`):
- If node fails, all downstream nodes become `blocked`
- Graph status → `failed`
- Requires manual intervention or resume

**Non-Blocking** (`node.blocking = false`):
- If node fails, downstream nodes continue if they have alternate paths
- Graph status → depends on other nodes

**Default**: All nodes are blocking in current flows.

### Operational Pause

**Trigger**: `OperationalError` thrown during stage execution (backend unavailable, timeout).

**Action**:
1. Workflow Engine calls `pauseWorkflowRun()`
2. Graph Runtime marks current node as `blocked`
3. Worktree is kept (not cleaned up)
4. Graph status → `blocked`

**Resume**:
1. User or cron triggers resume
2. API calls `resumeGraphNode(nodeRunId)`
3. Runner picks up with worktree intact
4. Stage re-executes from checkpoint

**Location**: `apps/runner/src/orchestrator.ts:362-376` (error handler)

---

## Integration Points

### Workflow Engine ↔ Graph Runtime

**GraphRun Creation**:
- When `createWorkflowRun()` is called, a corresponding `GraphRun` is created
- Nodes are pre-populated based on flow definition

**Node → StepRun Mapping**:
- Each `GraphNodeRun` links to a `StepRun` via `stepRunId`
- StepRun carries execution details (artifacts, logs, duration)
- GraphNodeRun carries dependency and retry metadata

**Status Synchronization**:
- When `finishStep()` is called, corresponding `GraphNodeRun` status is updated
- Graph status is re-derived and checked for completion

### Runner Orchestrator ↔ Graph Runtime

**Dispatch Loop**:
```typescript
while (true) {
  const nextStage = nextRunnableGraphNode(graphDef, nodeRuns);
  if (!nextStage) break;  // No more work or blocked
  
  await dispatchStep(nextStage);
  
  // Update node status based on step outcome
  const nodeRun = findNodeRunByStage(nextStage);
  nodeRun.status = deriveStatusFromStepRun(stepRun);
  
  // Check graph completion
  const graphStatus = deriveGraphRunStatus(nodeRuns);
  if (graphStatus === 'passed' || graphStatus === 'failed') break;
}
```

**Location**: `apps/runner/src/orchestrator.ts:180-260`

---

## Design Decisions

### Why DAG Instead of Linear Stages?

**Problem**: Some workflows have parallel stages or conditional paths (e.g., `build` and `lint` can run in parallel).

**Solution**: Model as DAG, enable parallel dispatch.

**Trade-off**: More complex than linear stage list, but necessary for flexibility.

### Why Derived Graph Status?

**Problem**: Storing graph status separately risks inconsistency (node status changed but graph status stale).

**Solution**: Always derive graph status from nodes.

**Trade-off**: Requires scanning all nodes on every status check, but node count is small (<20 per graph).

### Why Checkpoint on Both Success and Failure?

**Problem**: If checkpoint only on success, cannot resume from exact failure point.

**Solution**: Checkpoint on every step completion.

**Trade-off**: Extra storage, but enables fine-grained resume.

---

## Current Limitations

1. **No conditional nodes**: Cannot express "run node X only if Y condition". All nodes are unconditional (run if dependencies pass).

2. **No dynamic graph modification**: Graph structure is fixed at creation. Cannot add/remove nodes mid-execution.

3. **No loop support**: DAG constraint prevents cycles. Cannot express "repeat stage until condition".

4. **Single entry point per runner**: Runner processes one graph at a time. No inter-graph parallelism within a runner.

5. **Checkpoint restore partial**: Worktree restore works, but artifact injection into context is manual (runner re-fetches from API).

---

## Future Enhancements

### Planned

1. **Conditional nodes**: Express "run node X if artifact Y exists" or "skip node if dependency warned".

2. **Dynamic graph extension**: Allow workflows to spawn sub-workflows or add stages dynamically.

3. **Graph-level checkpoints**: Snapshot entire graph state, enable "rewind to stage N".

4. **Parallel runner support**: Multiple runners coordinate on same graph via distributed lock.

### Considered but Deferred

1. **Loop support via non-DAG graphs**: Allow cycles with max iteration limit.  
   **Risk**: Infinite loops, debugging complexity.

2. **Speculative execution**: Start downstream nodes before dependencies finish (rollback on failure).  
   **Risk**: Wasted work, resource contention.

---

## Related Documentation

- `apps/api/src/workflow-engine.ts` — Workflow lifecycle that graph runtime orchestrates
- `2026-08-09-workflow-engine-architecture.md` — Workflow state management
- `packages/shared/src/flow-registry.ts` — Flow definitions that compile to graphs
- `.trellis/spec/runner/orchestration-lifecycle.md` — Full orchestration flow spec

---

## Code References

- `apps/api/src/graph-runtime.ts` — Core graph runtime (161 lines)
- `packages/shared/src/types/graph-runtime.ts` — Type definitions (327 lines)
- `apps/runner/src/orchestrator/graph-scheduler.ts` — Runner-side scheduling (280 lines)
- `apps/api/src/step-checkpoints.ts` — Checkpoint management (145 lines)
- `packages/shared/src/flow-registry.ts` — Flow definitions (420 lines)
