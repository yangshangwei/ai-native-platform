# Research: Core Architecture

- **Query**: Core architecture and business logic of the AI-native platform codebase
- **Scope**: internal
- **Date**: 2026-08-09

## Findings

### Architecture Overview

This is an AI-native development platform that orchestrates AI agents to complete software development workflows. The system follows a three-tier architecture:

1. **API Layer** (`apps/api/src/`) - REST API server, state writer, gate engine
2. **Runner Layer** (`apps/runner/src/`) - Workflow orchestrator, agent backend integration, worktree manager
3. **Web Layer** (`apps/web/`) - Frontend UI
4. **Shared Layer** (`packages/shared/src/`) - Cross-layer type definitions and utilities

**Key Principle**: Single-writer pattern — the API is the **sole state writer** for workflow runs. The Runner is an event emitter that drives agent execution and reports outcomes back to the API.

---

### Core Components

#### 1. Workflow Engine (`apps/api/src/workflow-engine.ts`)

**Responsibility**: Sole state writer for all workflow lifecycle mutations.

**Key Functions**:
- `createWorkflowRun()` - Creates a new workflow run with flowId and optional startStage
- `createWorkflowRequest()` - Queues a workflow request for runner pickup
- `claimWorkflowRequest()` - Atomic claim (TOCTOU-safe) for runner watch loop
- `transitionStage()` - Moves run to next workflow stage
- `startStep()` / `finishStep()` - Manages StepRun lifecycle
- `recordCommandRun()` / `recordToolInvocation()` - Captures execution evidence
- `recordMavenBuild()` - Ingests build/test results and triggers compile/test gates
- `recordArtifact()` / `createArtifact()` - Persists stage outputs (requirement drafts, design docs, diffs, reports)
- `createKnowledgeArtifact()` - Creates project-scoped, long-lived knowledge entities (REQ-###, DSN-###)
- `recordHandoff()` / `updateHandoff()` - Tracks agent-to-agent handoff records
- `pauseWorkflowRun()` - Marks run as `paused` on operational failures (backend unavailable, timeout)
- `completeWorkflowRun()` - Terminal state transition (passed/failed)
- `recordAgentEvent()` - Append-only ingest for streaming events (Claude Code stream-json, tool use)

**Design Invariant (R1.6)**: All state transition functions are **fully synchronous** between reading and persisting state. No `await` calls allowed in that window to prevent TOCTOU races.

**State Machine**:
```
WorkflowRunStatus: pending → running ⇄ awaiting_human → passed/failed/cancelled
                                      ↘ paused (operational failure, resume via retry)
```

**Files Referenced**:
- `apps/api/src/workflow-engine.ts` (1702 lines) - Main state writer
- `apps/api/src/audit.ts` - Immutable audit log of all state transitions

---

#### 2. Gate Engine (`apps/api/src/gate-engine.ts`)

**Responsibility**: Declarative rule-based quality gates. Agents provide artifacts; gates decide pass/warn/fail.

**Key Gates**:
- `runCompileGate()` - Checks compile command exit code, timeout
- `runTestGate()` - Validates test exit code, surefire reports, failure/error counts
- `runRequirementGate()` - Validates REQ-### IDs, acceptance criteria (AC-###), scope, context evidence, cs-req structure (用户故事/为什么需要/怎么解决/边界)
- `runDesignGate()` - Validates DSN-### ID, requirement coverage matrix, test strategy, business verification (not just command-only), 现状/变化/挂载点/推进策略 sections
- `runAcceptanceTraceabilityGate()` - Cross-artifact validation: requirement → design → diff → review verdict → test gate → business acceptance matrix
- `runDiffScopeGate()` - Checks changed files against allowed prefixes
- `runSensitiveChangeGate()` - Warns on changes to pom.xml, .gitignore, security paths
- `runTestIntegrityGate()` - Prevents test weakening (deleted test files, removed @Test cases, fewer assertions, skip markers added)
- `runEvidenceGate()` - Meta-gate: validates all passing rules have evidence, command/artifact digests present, artifact digests match recorded SHA-256
- `runManualGate()` - Human approval/rejection

**Rule Model**:
```typescript
interface RuleResult {
  ruleId: string;
  status: 'pass' | 'warn' | 'fail' | 'skipped';
  message: string;
  evidenceRefs: EvidenceRef[];
}

interface GateRun {
  gateId: string;
  status: 'pass' | 'warn' | 'fail'; // worst(ruleResults)
  ruleResults: RuleResult[];
  evidenceRefs: EvidenceRef[];
  agentNote: string | null; // advisory only, never overrides status
}
```

**Design Principle**: Agents attach notes but **never set status**. Only the gate engine decides pass/warn/fail by running deterministic rules over platform-trusted artifacts (CommandRuns, TestRuns, Artifacts).

**Evidence Chain** (08-09 P1-1):
- Every artifact carries a SHA-256 digest
- Evidence gate verifies digests match on disk (tamper detection)
- CommandRuns carry stdout/stderr/combined SHA-256
- Missing digests degrade to `warn` (coverage gap), mismatched digests `fail`

**Files Referenced**:
- `apps/api/src/gate-engine.ts` (1758 lines) - All gate implementations

---

#### 3. Graph Runtime (`apps/api/src/graph-runtime.ts`)

**Responsibility**: DAG-based workflow orchestration with resumability and dependency tracking.

**Key Concepts**:
- **GraphDefinition**: DAG of nodes (stages) and edges (dependencies), compiled from FlowDef
- **GraphRun**: Execution instance of a graph tied to a WorkflowRun
- **GraphNodeRun**: Execution attempt of a single node (stage), tracks attempt count, status, checkpoint
- **GraphNodeStatus**: `pending` → `ready` → `running` → `passed`/`failed`/`blocked`/`skipped`/`cancelled`

**Key Functions**:
- `resumeGraphNode()` - Creates new attempt for a failed/blocked/cancelled node, validates checkpoint existence
- `resumeGraphStage()` - Convenience wrapper to resume latest node run for a given stage

**Node Lifecycle**:
```
GraphNodeStatus:
  pending (waiting for dependencies)
    → ready (dependencies satisfied, runnable)
    → running (dispatched to runner)
    → passed/failed/blocked (terminal)
       ↓ (manual resume)
    ready (new attempt)
```

**Status Aggregation** (`deriveGraphRunStatus`):
1. Any `cancelled` → GraphRun `cancelled`
2. Any `failed` → GraphRun `failed`
3. Any `blocked` → GraphRun `blocked`
4. Any active or never-run → GraphRun `running`
5. All terminal non-blocking (`passed`/`skipped`) → GraphRun `passed`

**Files Referenced**:
- `apps/api/src/graph-runtime.ts` (161 lines)
- `packages/shared/src/types/graph-runtime.ts` (327 lines) - Type definitions
- `apps/runner/src/orchestrator/graph-scheduler.ts` - Runner-side scheduler

---

#### 4. Agent Stream Bus (`apps/api/src/agent-stream-bus.ts`)

**Responsibility**: In-process pub/sub for live agent event streaming (SSE).

**Channels**:
- `run:<workflowRunId>` - Events from a workflow run
- `request:<workflowRequestId>` - Events from pre-run phase (Coordinator triage)

**Design**:
- History is in SQLite `agent_events` table (sequence + payload)
- Bus is **only** for live tail (SSE subscribers)
- SSE endpoints fetch history first, then attach subscriber (no race)

**Key Functions**:
- `subscribe(channel, fn)` - Attach listener, returns unsubscribe
- `publish(event)` - Broadcast to all subscribers on matching channel
- `subscriberCount(channel)` - Active SSE connections

**Files Referenced**:
- `apps/api/src/agent-stream-bus.ts` (59 lines)

---

#### 5. Runner Orchestrator (`apps/runner/src/orchestrator.ts`)

**Responsibility**: Workflow lifecycle driver, agent backend integration, worktree management.

**Key Function**: `cmdOrchestrate(opts)` - End-to-end workflow execution

**Execution Flow**:
1. **Heartbeat** - Report runner online status, tool versions (JDK, Maven, Git)
2. **Run Creation/Resume** - Create WorkflowRun or load existing, claim WorkflowRequest
3. **Worktree Preparation** - Git worktree at `~/.ai-native/projects/{projectId}/runs/{runId}`
4. **Backend Selection** - Preflight check (Claude Code CLI installed/authenticated, or Codex)
5. **Flow Slicing** - Load `FLOW_REGISTRY[run.flowId]`, slice stages from `startStage`
6. **Graph Runtime** - Convert flow to GraphDefinition, schedule nodes via DAG dependencies
7. **Stage Dispatch Loop**:
   - Fetch next runnable node from graph scheduler
   - Dispatch to `dispatchStep(step, ctx)` by `StageStepKind`:
     - `agent` → invoke skill (cs-feat-design, cs-issue-fix, etc.)
     - `gate` → run gate engine
     - `human` → await approval
     - `engine` → native logic (mvn build, completion report)
   - Report outcome to API (`graphNodeFinished`)
   - Stop on failure or continue based on node's `failurePolicy`
8. **Error Handling**:
   - Operational errors (backend unavailable, timeout) → `pauseWorkflowRun()`, keep worktree
   - Business failures → `completeWorkflowRun(ok=false)`, cleanup worktree
9. **Completion** - Call `api.workflowCompleted()`, promote knowledge drafts, cleanup

**Context Injection** (P0-1):
- `ContextPack` carries project profile, accepted knowledge, run history, prior feedback
- Built by `apps/runner/src/context/builder.ts`, rendered by `context/renderer.ts`
- Governance: token budget (200k max), reserved for reasoning (40k), reserved for output (20k)
- Sensitive paths redacted (passwords, tokens, .env)

**Agent Backend Abstraction**:
- `AgentBackend` interface: `invoke(prompt, artifacts) → result`
- Implementations: `ClaudeCodeBackend` (subprocess), `CodexBackend` (future)
- Streaming: `recordAgentEvent()` → Agent Stream Bus → SSE

**Files Referenced**:
- `apps/runner/src/orchestrator.ts` (primary loop)
- `apps/runner/src/orchestrator/steps.ts` - Stage implementations
- `apps/runner/src/orchestrator/invoke-skill.ts` - Agent invocation + context injection
- `apps/runner/src/context/builder.ts` - ContextPack construction
- `apps/runner/src/flows/registry.ts` - FLOW_REGISTRY

---

### Core Business Flows

#### Flow 1: feature.standard (Full 8-Stage Pipeline)

**Stages**: `context_pack` → `requirement` → `design` → `implementation` → `build_test` → `review` → `completion` → `knowledge`

**Per-Stage Breakdown**:

1. **context_pack** (agent, skill: `cs-explore`)
   - Reads codebase context, generates `context_pack` artifact
   - Stores as `ContextPack` JSON with file listings, hotspots, test coverage

2. **requirement** (agent, skill: `cs-req`)
   - Drafts `requirement_draft` markdown
   - Must include: REQ-### IDs, AC-### acceptance criteria, scope/goals, cs-req four sections (用户故事/为什么需要/怎么解决/边界)
   - Gate: `requirement_gate` validates structure

3. **design** (agent, skill: `cs-feat-design`)
   - Drafts `design_doc` markdown from approved requirement
   - Must include: DSN-### ID, requirement coverage matrix, test strategy (business behavior, not just commands), 现状/变化/挂载点/推进策略 sections
   - Gate: `design_gate` validates + reconciles with requirement AC IDs

4. **implementation** (agent, skill: `cs-feat-impl`)
   - Writes code, produces `diff` artifact
   - Gates: `diff_scope_gate` (files within allowed prefixes), `sensitive_change_gate` (warns on high-risk paths), `test_integrity_gate` (no test weakening)

5. **build_test** (engine)
   - Runs `mvn clean test` (or project-configured command)
   - Parses surefire XML reports, records `BuildRun` + `TestRun[]`
   - Gates: `compile_gate` (exit 0, no timeout), `test_gate` (failures=0, errors=0, structured reports present)

6. **review** (agent, skill: `code-reviewer`)
   - Produces `review_verdict.v1.json` + `review.md`
   - Verdict schema: `{ status, blocking[], remediation[], advisory[], evidenceRefs[] }`
   - Gate: `acceptance_gate` validates verdict schema, checks blockers have remediation, requires `test_gate` passed

7. **completion** (engine)
   - Generates `completion_report.md` (summary, gates, artifacts, recommendations)
   - Gate: `evidence_gate` (meta-gate: all passing rules have evidence, digests verified)

8. **knowledge** (engine)
   - Promotes accepted drafts (`requirement_draft`, `design_doc`) to `KnowledgeArtifact` entities (REQ-###, DSN-###)
   - State: `draft` → `accepted` (terminal)

**Human Checkpoints**:
- After `requirement_gate` fails: awaiting requirement approval
- After `design_gate` fails: awaiting design approval
- After `acceptance_gate` fails: awaiting acceptance approval (can accept risk or approve)

---

#### Flow 2: feature.fastforward (4-Stage Subset)

**Stages**: `implementation` → `build_test` → `review` → `completion`

**Use Case**: Small changes (typo fixes, comments, obvious tweaks) that don't need formal requirement/design

**Differences**:
- Skips `context_pack`, `requirement`, `design`, `knowledge`
- Acceptance gate downgrades missing requirement/design from `fail` to `pass` (not applicable)
- Still enforces: diff scope, test integrity, compile/test gates, review verdict

---

#### Flow 3: issue.standard (Bug/Issue Pipeline)

**Stages**: `report` → `analyze` → `implementation` → `build_test` → `review` → `completion`

**Use Case**: Bug fixes and issue resolution

**Key Stages**:
- `report` (agent, skill: `cs-issue-report`) - Captures reproducible bug report
- `analyze` (agent, skill: `cs-issue-analyze`) - Root cause analysis, proposes fix strategies
- `implementation` (reused) - Applies chosen fix
- Rest identical to feature flow

---

#### Flow 4: refactor.standard (Refactor Pipeline)

**Stages**: `scan` → `plan` → `implementation` → `build_test` → `review` → `completion`

**Use Case**: Code restructuring without behavior change

**Key Stages**:
- `scan` (agent, skill: `cs-refactor-scan`) - Identifies optimization opportunities
- `plan` (agent, skill: `cs-refactor-design`) - Refactor strategy (note: distinct from feature `design`, no REQ-### tracing)
- `implementation` (reused) - Applies refactor
- Rest identical to feature flow

---

#### Flow 5: profile.bootstrap (Project Onboarding)

**Stages**: `inventory` → `profile` → `completion` → `knowledge`

**Use Case**: Initial project profiling for new codebases

**Key Stages**:
- `inventory` (agent) - Read-only scan, generates `source_inventory` artifact
- `profile` (agent) - Synthesizes project profile (tech stack, conventions, hotspots)
- `knowledge` (engine) - Promotes profile to `KnowledgeArtifact`

**Special**: No backend required for this flow (read-only), no build/test

---

### Data Models

#### Core Entities (`packages/shared/src/types/`)

**WorkflowRun** (`workflow.ts`):
```typescript
{
  id: WorkflowRunId;
  projectId: ProjectId;
  type: 'feature' | 'bugfix' | 'refactor' | 'ask' | 'profile';
  status: 'pending' | 'running' | 'awaiting_human' | 'paused' | 'passed' | 'failed' | 'cancelled';
  currentStage: WorkflowStage;
  flowId: FlowId; // 'feature.standard' | 'feature.fastforward' | 'issue.standard' | 'refactor.standard' | 'profile.bootstrap'
  startStage: WorkflowStage | null; // where to start (skip prefix)
  branch: string; // ai/{runId}-{slug}
  workspacePath: string | null;
  autoRework: AutoReworkLedger; // bounded auto-retry bookkeeping
}
```

**StepRun** (`workflow.ts`):
```typescript
{
  id: StepRunId;
  workflowRunId: WorkflowRunId;
  stage: WorkflowStage;
  name: string;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'cancelled';
  startedAt: Iso8601;
  completedAt: Iso8601 | null;
}
```

**Artifact** (`artifact.ts`):
```typescript
{
  id: ArtifactId;
  workflowRunId: WorkflowRunId;
  stepRunId: StepRunId | null;
  kind: 'context_pack' | 'requirement_draft' | 'design_doc' | 'diff' | 'review' | 'other';
  uri: string; // file:// path
  sha256: string | null; // evidence digest
  contentType: string;
  metadata: Record<string, unknown>;
}
```

**KnowledgeArtifact** (`knowledge-artifact.ts`):
```typescript
{
  id: string; // kart_xxx
  projectId: ProjectId;
  kind: 'requirement' | 'design' | 'adr' | 'guide' | 'profile' | 'learning';
  status: 'draft' | 'accepted' | 'superseded';
  entityId: string | null; // REQ-### | DSN-### | ADR-###
  derivedFromArtifactId: ArtifactId | null; // back-pointer to run draft
  subtype: string | null; // per-kind enum
  uri: string;
  sha256: string | null;
  metadata: Record<string, unknown>; // knowledgeClass, trustLevel, freshness, confidence, sourceRefs
}
```

**GateRun** (`gate.ts`):
```typescript
{
  id: GateRunId;
  gateId: 'requirement_gate' | 'design_gate' | 'test_gate' | 'acceptance_gate' | ...;
  workflowRunId: WorkflowRunId;
  status: 'pass' | 'warn' | 'fail';
  ruleResults: RuleResult[];
  evidenceRefs: EvidenceRef[]; // flat evidence chain
  commandRunIds: CommandRunId[];
  agentNote: string | null; // advisory only
}
```

**GraphNodeRun** (`graph-runtime.ts`):
```typescript
{
  id: GraphNodeRunId;
  graphRunId: GraphRunId;
  workflowRunId: WorkflowRunId;
  nodeId: string; // maps to GraphNodeDefinition.id
  attempt: number; // 1-based retry counter
  status: 'pending' | 'ready' | 'running' | 'passed' | 'failed' | 'blocked' | 'skipped' | 'cancelled';
  stepRunId: StepRunId | null;
  stepCheckpointId: StepCheckpointId | null; // resumability
  resumeCursor: string | null; // agent-specific checkpoint
  dependencyState: { upstreamNodeIds, satisfiedNodeIds, blockedNodeIds };
}
```

---

### Integration Points

#### API ↔ Runner

**Request Queue Pattern** (watch loop):
1. Runner polls `GET /workflow-requests?status=pending` (default 5s interval)
2. Runner calls `POST /workflow-requests/{id}/claim` (atomic TOCTOU-safe)
3. Runner creates WorkflowRun via `POST /workflow-runs`
4. Runner calls `POST /workflow-requests/{id}/run-started`
5. Runner drives lifecycle, reports events:
   - `POST /steps` (step started)
   - `POST /steps/{id}/finish` (step completed)
   - `POST /command-runs` (build/test evidence)
   - `POST /artifacts` (stage outputs)
   - `POST /agent-events` (streaming events)
   - `POST /runner/events/graph-node-started` (DAG node dispatch)
   - `POST /runner/events/graph-node-finished` (DAG node outcome)
6. Runner calls `POST /workflow-runs/{id}/completed` (final state)
7. Runner calls `POST /workflow-requests/{id}/completed`

**Resumability**:
- Operational failures → `POST /runner/control/pause-run` → run.status = `paused`, request.status = `paused`
- Manual resume → `POST /runner/control/retry-run` → re-dispatches from `pauseStage`

---

#### API ↔ Web

**SSE Streaming**:
- `GET /stream/workflow-runs/{id}` - Live agent events for a run
- `GET /stream/workflow-requests/{id}` - Live events for pre-run chat (Coordinator)
- Events: `agent_message`, `tool_use_start`, `tool_use_result`, `partial_text`

**REST API**:
- `GET /workflow-runs/{id}` - Run detail + artifacts + gates + graph
- `GET /workflow-requests` - Queue listing
- `POST /workflow-requests` - Create request (Web UI "New Task" form)
- `POST /approvals` - Human gate decisions (approve/reject)
- `GET /projects/{id}` - Project config (backend, branches, build commands)

---

#### Runner ↔ Agent Backends

**Agent Backend Abstraction** (`apps/runner/src/agents/`):
```typescript
interface AgentBackend {
  kind: 'claude_code' | 'codex';
  invoke(params: {
    prompt: string;
    artifacts: Artifact[];
    onEvent: (event) => void;
  }): Promise<AgentResult>;
}
```

**Claude Code Backend** (`agents/claude-code.ts`):
- Spawns `claude --output-format stream-json` subprocess
- Streams NDJSON lines → `onEvent()` → `recordAgentEvent()` → SSE
- Artifacts passed via `--file` flags
- Exit code → result.status

**Codex Backend** (`agents/codex-parser.ts`):
- (Implementation details minimal in scanned files)

**Preflight Check** (`agent-backend-preflight.ts`):
- Validates CLI installed, authenticated, runnable
- Status: `connected` | `missing_cli` | `needs_login` | `not_runnable`
- Operational failure throws `OperationalError('backend_unavailable')`

---

### Current Implementation Highlights

#### 1. Evidence-Backed Quality Gates (08-09 P1-1)

**Problem**: Previous gates relied on artifact presence; files could be tampered/corrupted after recording.

**Solution**:
- Every file artifact gets SHA-256 digest on creation
- CommandRuns carry stdout/stderr/combined SHA-256
- Evidence gate (`runEvidenceGate`) recomputes digests and checks:
  - `evidence.artifact_digests_present` (warn on missing)
  - `evidence.artifact_digests_match` (fail on mismatch)
  - `evidence.command_digests_present` (fail on missing for compile/test)
- Three-state check: `match` | `mismatch` | `unverifiable` (graceful for legacy artifacts)

**Impact**: Tampered evidence stops acceptance instead of showing a UI pill.

---

#### 2. Graph Runtime Resumability (07-26 P1-1)

**Problem**: V1 had flat stage iteration; failures lost all progress.

**Solution**:
- DAG-based graph runtime with node dependencies
- `StepCheckpoint` + `resumeCursor` per GraphNodeRun
- `resumeGraphNode()` creates new attempt, preserves checkpoint
- Failed/blocked nodes resumable via `POST /runner/control/retry-run`

**Resume Flow**:
1. User clicks "Resume" in UI
2. UI calls `POST /workflow-runs/{id}/resume-stage`
3. API calls `resumeGraphNode()` → new GraphNodeRun (attempt+1)
4. Runner watch loop picks up run (status back to `running`)
5. Graph scheduler dispatches resumed node

---

#### 3. Operational Pause (07-26 P1-2)

**Problem**: Backend CLI unavailable/timeout killed run entirely; worktree lost.

**Solution**:
- `OperationalError` exception class (backend_unavailable, timeout, protocol_error)
- Caught in orchestrator, calls `pauseWorkflowRun(reason, worktreeHead)`
- Run status → `paused`, request status → `paused`, worktree kept on disk
- Manual resume via retry-run (same as business failure resume)

**Distinction**:
- **Operational failure**: paused (infrastrastructure), auto-rework disabled
- **Business failure**: failed (gates), bounded auto-rework enabled

---

#### 4. Bounded Auto-Rework (08-09 P1-2b)

**Problem**: Deterministic failures (missing REQ-### IDs, no acceptance criteria) wasted human time.

**Solution**:
- `AutoReworkLedger` on WorkflowRun: `{ [stage]: { attempts, lastAttemptAt } }`
- Max 2 attempts per stage (budget: 2)
- Triggers on: gate `fail` with remediation hint, deterministic failure reasons
- Only for business failures (not operational pause)
- Manual retries don't spend budget

**Conditions** (all required):
1. Run failed at a stage
2. Budget not exhausted for that stage (< 2 attempts)
3. Failure is deterministic (gate failure, missing required fields)
4. No operational error

---

#### 5. Flow Polymorphism (V2 W2-1)

**Problem**: V1 hard-coded single 8-stage pipeline in `runWorkflow()`. Needed fastforward, issue, refactor flows.

**Solution**:
- `FLOW_REGISTRY` keyed by `FlowId` (feature.standard, feature.fastforward, issue.standard, refactor.standard, profile.bootstrap)
- `FlowDef` carries `{ stages: StageStep[], kind: WorkflowRunType }`
- `WorkflowRun.flowId` (NOT NULL, defaults to type-appropriate flow)
- `WorkflowRun.startStage` (nullable, skip-prefix support)
- Orchestrator slices stages from startStage, dispatches via graph runtime

**Extension Path**: Add new flow → FLOW_REGISTRY entry → router rule → UI option

---

## Related Specs

- `.trellis/spec/api/backend/index.md` - API backend guidelines index
- `.trellis/spec/api/backend/gate-engine.md` - Gate engine rules and evidence protocol
- `.trellis/spec/api/backend/database-guidelines.md` - SQLite migration discipline
- `.trellis/spec/runner/backend/index.md` - Runner backend guidelines index
- `.trellis/spec/runner/backend/flow-registry.md` - FLOW_REGISTRY semantics
- `.trellis/spec/shared/backend/context-injection-protocol.md` - ContextPack build/render contract
- `.trellis/spec/shared/backend/evidence-verifier-protocol.md` - Evidence digest protocol

---

## Caveats / Not Found

- Web layer (`apps/web/`) not deeply explored (frontend out of scope for this research)
- Agent skill implementations (cs-feat-design, cs-issue-fix, etc.) not examined (runner invokes them as black boxes)
- Database schema not extracted (SQLite migrations in `apps/api/src/store/migrations/`)
- Router logic (`apps/api/src/router.ts`) mentioned but not detailed
- Coordinator clarification flow (`apps/api/src/routes/workflow-request-chat.ts`) exists but not explored
