# Workflow Engine Architecture

**Date**: 2026-08-09  
**Status**: Current Implementation  
**Audience**: Developers, Architects

## Overview

The Workflow Engine is the **sole state writer** for all workflow lifecycle mutations in the AI-native platform. It implements the single-writer pattern to prevent TOCTOU races and ensure state consistency across concurrent runner processes.

**Core Principle**: All workflow state transitions go through this engine. Runners are event emitters that drive execution and report outcomes, but they never directly mutate workflow state.

**Location**: `apps/api/src/workflow-engine.ts` (1702 lines)

---

## Architecture Principles

### 1. Single-Writer Pattern

Only the Workflow Engine can mutate `workflow_runs`, `step_runs`, `artifacts`, `command_runs`, `gate_runs` tables.

**Why**: Prevents concurrent modification conflicts when multiple runners or UI actions happen simultaneously.

**Enforcement**:
- All state-mutating functions are in `workflow-engine.ts`
- Runner API client only calls these functions via REST endpoints
- Direct database writes outside this module are prohibited

### 2. Synchronous Critical Sections

**Design Invariant (R1.6)**: All state transition functions are fully synchronous between reading and persisting state.

```typescript
// ✅ Correct: No await between read and write
function transitionStage(runId: WorkflowRunId, nextStage: WorkflowStage) {
  const run = store.workflowRuns.get(runId);  // READ
  if (run.status !== 'running') throw new Error('Cannot transition');
  run.currentStage = nextStage;               // MUTATE
  store.workflowRuns.update(run);             // WRITE
}

// ❌ Wrong: Await creates TOCTOU window
async function transitionStage(runId: WorkflowRunId, nextStage: WorkflowStage) {
  const run = store.workflowRuns.get(runId);
  await someAsyncCheck();  // ⚠️ State could change here!
  run.currentStage = nextStage;
  store.workflowRuns.update(run);
}
```

**Why**: Prevents Time-Of-Check-Time-Of-Use (TOCTOU) races where state changes between validation and mutation.

---

## State Machines

### WorkflowRun Status

```
pending → running ⇄ awaiting_human → passed / failed / cancelled
                 ↘ paused (operational failure, resume via retry)
```

**States**:
- `pending` — Created, waiting for runner to claim
- `running` — Active execution
- `awaiting_human` — Blocked on manual gate (approval/rejection)
- `paused` — Operational failure (backend unavailable, timeout); worktree kept for resume
- `passed` — Completed successfully
- `failed` — Completed with failure
- `cancelled` — User-initiated cancellation

**Transitions**:
- `pending → running`: `claimWorkflowRequest()` (atomic, TOCTOU-safe)
- `running → awaiting_human`: Manual gate triggered
- `awaiting_human → running`: Human approval/rejection processed
- `running → paused`: `pauseWorkflowRun()` on operational error
- `paused → running`: Resume via runner retry
- `running → passed/failed`: `completeWorkflowRun()`

### StepRun Status

```
started → running → passed / failed / skipped
```

**Lifecycle**:
1. `startStep()` — Create StepRun with `started` status
2. Runner executes stage logic
3. `finishStep()` — Record outcome (`passed`, `failed`, `skipped`)

---

## Core Functions

### Workflow Lifecycle

#### `createWorkflowRun()`
```typescript
function createWorkflowRun(input: {
  projectId: ProjectId;
  flowId: string;
  sourceBranch: string;
  branch: string;
  title: string;
  userRequest: string;
  startStage?: WorkflowStage;
}): WorkflowRun
```

Creates a new workflow run with initial stage from flow definition.

**Usage**: Called when runner claims a WorkflowRequest.

#### `claimWorkflowRequest()`
```typescript
function claimWorkflowRequest(
  requestId: WorkflowRequestId,
  runnerId: RunnerId
): { claimed: boolean; run: WorkflowRun | null }
```

**Atomic claim**: Sets `claimedBy` and `claimedAt` in a single transaction.

**TOCTOU-safe**: Returns `{ claimed: false }` if already claimed by another runner.

#### `transitionStage()`
```typescript
function transitionStage(
  runId: WorkflowRunId,
  nextStage: WorkflowStage
): WorkflowRun
```

Moves run to next stage in the flow.

**Validates**: Current status is `running`.

#### `pauseWorkflowRun()`
```typescript
function pauseWorkflowRun(
  runId: WorkflowRunId,
  reason: string,
  pauseStage: WorkflowStage
): WorkflowRun
```

Marks run as `paused` on operational failures (backend unavailable, timeout).

**Worktree kept**: Runner does NOT clean up worktree, enabling resume.

#### `completeWorkflowRun()`
```typescript
function completeWorkflowRun(
  runId: WorkflowRunId,
  status: 'passed' | 'failed',
  summary: string
): WorkflowRun
```

Terminal state transition.

**Side effects**: Triggers completion report generation, knowledge capture.

---

### Step Lifecycle

#### `startStep()`
```typescript
function startStep(input: {
  workflowRunId: WorkflowRunId;
  stage: WorkflowStage;
  skillId?: string;
  attemptNumber: number;
}): StepRun
```

Creates a new step run. Each retry increments `attemptNumber`.

#### `finishStep()`
```typescript
function finishStep(
  stepRunId: StepRunId,
  outcome: { status: 'passed' | 'failed' | 'skipped'; summary: string }
): StepRun
```

Records step completion. Runner uses this after stage execution finishes.

---

### Evidence Collection

#### `recordCommandRun()`
```typescript
function recordCommandRun(input: {
  workflowRunId: WorkflowRunId;
  stepRunId: StepRunId | null;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  combined: string;
  stdoutSha256: string;
  stderrSha256: string;
  combinedSha256: string;
  timedOut: boolean;
  durationMs: number;
}): CommandRun
```

Records real command execution with digest-verified output.

**Evidence**: SHA-256 digests enable tamper detection in Evidence Gate.

#### `recordMavenBuild()`
```typescript
function recordMavenBuild(input: {
  workflowRunId: WorkflowRunId;
  stepRunId: StepRunId;
  commandRunId: CommandRunId;
  phase: 'compile' | 'test';
  exitCode: number;
  surefireReports?: SurefireTestReport[];
}): { buildRun: BuildRun; testRuns: TestRun[] }
```

Ingests Maven Surefire/Failsafe reports and triggers compile/test gates.

**Auto-gates**: Automatically runs `runCompileGate()` or `runTestGate()` after persistence.

---

### Artifact Management

#### `createArtifact()`
```typescript
function createArtifact(input: {
  workflowRunId: WorkflowRunId;
  stepRunId: StepRunId | null;
  kind: ArtifactKind;
  uri: string;
  size: number;
  contentType: string;
  sha256: string;
  metadata?: Record<string, unknown>;
}): Artifact
```

Persists stage outputs (requirement drafts, design docs, diffs, reports).

**Tamper detection**: `sha256` field enables Evidence Gate validation.

#### `createKnowledgeArtifact()`
```typescript
function createKnowledgeArtifact(input: {
  projectId: ProjectId;
  kind: KnowledgeArtifactKind;
  uri: string;
  size: number;
  contentType: string;
  status: KnowledgeArtifactStatus;
  subtype?: string;
  metadata?: Record<string, unknown>;
}): KnowledgeArtifact
```

Creates project-scoped, long-lived knowledge entities.

**Lifecycle**: `candidate → accepted / superseded / rejected`

**Promotion**: `requirement_draft → REQ-###`, `design_doc → DSN-###` via `/knowledge-artifacts/promote` endpoint.

---

### Agent Event Streaming

#### `recordAgentEvent()`
```typescript
function recordAgentEvent(input: {
  workflowRunId: WorkflowRunId;
  stepRunId: StepRunId | null;
  backend: string;
  backendVersion: string;
  eventType: 'text' | 'tool_use' | 'tool_result' | 'result' | 'meta' | 'stderr';
  payload: unknown;
  seqWithinStep: number;
}): AgentEvent
```

Append-only ingest for real-time streaming from agent backends (Claude Code stream-json, tool invocations).

**Side effect**: Publishes to Agent Stream Bus for SSE broadcast to Web UI.

---

### Handoff Tracking

#### `recordHandoff()`
```typescript
function recordHandoff(input: {
  workflowRunId: WorkflowRunId;
  fromStepRunId: StepRunId;
  toStage: WorkflowStage;
  reason: string;
  context: Record<string, unknown>;
}): Handoff
```

Tracks agent-to-agent handoffs (e.g., requirement agent → design agent).

**Usage**: Context carries forward (requirement draft → design input).

---

## Integration Points

### API Routes → Workflow Engine

All workflow mutations go through REST endpoints that call Workflow Engine functions:

| Endpoint | Function | Purpose |
|----------|----------|---------|
| `POST /workflow-requests` | `createWorkflowRequest()` | Queue new workflow |
| `POST /workflow-requests/:id/claim` | `claimWorkflowRequest()` | Runner claims request |
| `POST /workflow-runs/:id/steps/start` | `startStep()` | Begin stage execution |
| `POST /workflow-runs/:id/steps/:stepId/finish` | `finishStep()` | End stage execution |
| `POST /workflow-runs/:id/pause` | `pauseWorkflowRun()` | Pause on operational failure |
| `POST /workflow-runs/:id/complete` | `completeWorkflowRun()` | Mark run complete |
| `POST /command-runs` | `recordCommandRun()` | Log command execution |
| `POST /artifacts` | `createArtifact()` | Store stage output |

**Location**: `apps/api/src/routes/*.ts`

### Runner → API Client

Runner orchestrator calls API via `api-client.ts`:

```typescript
// Example: Start step
const stepRun = await api.stepStarted({
  workflowRunId: run.id,
  stage: 'requirement',
  skillId: 'requirement-analysis',
  attemptNumber: 1,
});
```

**Location**: `apps/runner/src/api-client.ts`

---

## Design Decisions

### Why Single-Writer?

**Problem**: Multiple runners could claim the same workflow request or mutate the same run concurrently.

**Solution**: Centralize all writes in the Workflow Engine, expose via REST API.

**Trade-off**: API becomes a bottleneck, but correctness > throughput at this scale.

### Why Synchronous Critical Sections?

**Problem**: Async calls between read and write create TOCTOU race windows.

**Solution**: Ban `await` in state transition functions.

**Trade-off**: Cannot validate against external services during mutation (must pre-validate or post-validate).

### Why Append-Only Agent Events?

**Problem**: Real-time streaming requires low-latency writes.

**Solution**: `recordAgentEvent()` is append-only, no validation or aggregation during write.

**Trade-off**: Analysis happens in queries, not at write time.

---

## Current Limitations

1. **No distributed locking**: Single API process assumed. Multi-process deployment needs external lock (Redis, DB advisory locks).

2. **No automatic retry**: Runner must explicitly call `pauseWorkflowRun()` and retry. No built-in exponential backoff.

3. **No version control**: WorkflowRun schema changes require manual migration. No schema versioning.

4. **Audit log separate**: State changes recorded in `audit_logs` table, but not transactionally linked to mutations (eventual consistency only).

---

## Related Documentation

- `apps/api/src/gate-engine.ts` — Quality gates that validate workflow evidence
- `apps/api/src/graph-runtime.ts` — DAG orchestration on top of workflow engine
- `apps/runner/src/orchestrator.ts` — Runner-side workflow execution logic
- `.trellis/spec/api/backend/workflow-requests.md` — Workflow request lifecycle spec

---

## Code References

- `apps/api/src/workflow-engine.ts` — Main implementation (1702 lines)
- `apps/api/src/audit.ts` — Immutable audit log
- `apps/api/src/routes/workflow-runs.ts` — REST endpoints (lines 1-350)
- `apps/runner/src/api-client.ts` — Runner API client (lines 1-520)
- `packages/shared/src/types/workflow.ts` — Type definitions (lines 1-280)
