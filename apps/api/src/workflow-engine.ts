import {
  newId,
  nowIso,
  slugify,
  isKnowledgeArtifactKind,
  isValidKnowledgeSubtype,
  type Artifact,
  type ArtifactKind,
  type AgentBackendKind,
  type AgentResult,
  type AgentStreamEvent,
  type AgentStreamEventInput,
  type AgentTask,
  type AgentTaskKind,
  type ArtifactId,
  type BuildRun,
  type CommandRun,
  type CommandRunId,
  type FlowId,
  type GateRun,
  type KnowledgeArtifact,
  type KnowledgeArtifactKind,
  type KnowledgeArtifactStatus,
  type MessageRole,
  type ProjectId,
  type RequestMessage,
  type StepRun,
  type StepRunId,
  type TestRun,
  type WorkflowRun,
  type WorkflowRequest,
  type WorkflowRunId,
  type WorkflowStage,
  type WorkflowRunType,
  type WorkflowRunStatus,
} from '@ainp/shared';
import {
  store,
  type Approval,
  type AuditEntry,
  type RunnerRecord,
  type WorkflowAction,
} from './store/store';
import { db } from './store/db';
import {
  runCompileGate,
  runTestGate,
  runManualGate,
} from './gate-engine';
import { publish as publishAgentEvent } from './agent-stream-bus';

/**
 * Workflow Engine — sole state writer.
 *
 * Anything that mutates a WorkflowRun / StepRun / Build / Test / Gate must go
 * through this module. SQLite returns fresh objects on read, so every
 * mutation must call `store.X.set(...)` to persist.
 */

export function createWorkflowRun(params: {
  projectId: ProjectId;
  type: WorkflowRunType;
  title: string;
  sourceBranch?: string;
  /**
   * V2 W2-1 / PR3: optional flow id. Defaults to `'feature.standard'` so
   * existing callers (API routes, runner triggers) need no changes for
   * V1-equivalent runs. Future flows (`feature.fastforward`, etc.) pass
   * an explicit flowId from the route layer.
   */
  flowId?: FlowId;
  /**
   * V2 W2-4 / PR2: optional starting stage. `null` (or omitted) means
   * "start from the flow's first stage" — V1-equivalent default. Set
   * via the smart-router auto-pick path (PR3) or explicit UI override
   * (PR4); orchestrator slices `FLOW_REGISTRY[flowId].stages` from the
   * matching index. Validation that the stage is present in the chosen
   * flow lives in the orchestrator dispatcher (R-Risk-1).
   */
  startStage?: WorkflowStage | null;
}): WorkflowRun {
  const id = newId('run');
  const branch = `ai/${id}-${slugify(params.title)}`;
  const now = nowIso();
  const run: WorkflowRun = {
    id,
    projectId: params.projectId,
    type: params.type,
    title: params.title,
    status: 'pending',
    currentStage: 'init',
    flowId: params.flowId ?? 'feature.standard',
    startStage: params.startStage ?? null,
    configSnapshotId: null,
    sourceBranch: params.sourceBranch?.trim() || 'main',
    branch,
    workspacePath: null,
    createdAt: now,
    updatedAt: now,
  };
  store.workflowRuns.set(id, run);
  audit(id, 'workflow_run.created', {
    type: run.type,
    title: run.title,
    sourceBranch: run.sourceBranch,
    flowId: run.flowId,
    startStage: run.startStage,
  });
  return run;
}

// ---- Workflow request queue --------------------------------------------------

export function createWorkflowRequest(params: {
  projectId: ProjectId;
  type: WorkflowRunType;
  title: string;
  branch: string;
  /**
   * Optional first user message that should be persisted alongside the
   * request in the same transaction. When supplied the request and message
   * appear together (or neither) so the runner watch loop never races
   * between request creation and the initial chat turn (PRD P0-2 / P0-3).
   */
  firstMessage?: { role: MessageRole; content: string };
}): WorkflowRequest {
  const now = nowIso();
  const request: WorkflowRequest = {
    id: newId('wreq'),
    projectId: params.projectId,
    type: params.type,
    title: params.title,
    branch: params.branch,
    status: 'pending',
    claimedBy: null,
    workflowRunId: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  if (params.firstMessage) {
    const message: RequestMessage = {
      id: newId('msg'),
      workflowRequestId: request.id,
      role: params.firstMessage.role,
      content: params.firstMessage.content,
      coordinatorDecisionId: null,
      createdAt: now,
    };
    const txn = db.transaction(() => {
      store.workflowRequests.set(request.id, request);
      store.requestMessages.insert(message);
    });
    txn();
  } else {
    store.workflowRequests.set(request.id, request);
  }
  audit(null, 'workflow_request.created', {
    requestId: request.id,
    projectId: request.projectId,
    type: request.type,
    title: request.title,
    firstMessage: params.firstMessage ? params.firstMessage.role : null,
  });
  return request;
}

export function claimWorkflowRequest(params: {
  requestId: string;
  runnerId: string;
}): WorkflowRequest | null {
  const request = store.workflowRequests.get(params.requestId);
  if (!request || request.status !== 'pending') return null;
  request.status = 'claimed';
  request.claimedBy = params.runnerId;
  request.updatedAt = nowIso();
  store.workflowRequests.set(request.id, request);
  audit(null, 'workflow_request.claimed', {
    requestId: request.id,
    runnerId: params.runnerId,
  });
  return request;
}

export function markWorkflowRequestRunStarted(params: {
  requestId: string;
  workflowRunId: WorkflowRunId;
}): WorkflowRequest {
  const request = store.workflowRequests.get(params.requestId);
  if (!request) throw new Error(`workflow request not found: ${params.requestId}`);
  if (request.status !== 'claimed') throw new Error(`workflow request is not claimed: ${params.requestId}`);
  request.workflowRunId = params.workflowRunId;
  request.updatedAt = nowIso();
  store.workflowRequests.set(request.id, request);
  audit(params.workflowRunId, 'workflow_request.run_started', {
    requestId: request.id,
  });
  return request;
}

export function completeWorkflowRequest(params: {
  requestId: string;
  workflowRunId: WorkflowRunId | null;
  ok: boolean;
  error: string | null;
}): WorkflowRequest {
  const request = store.workflowRequests.get(params.requestId);
  if (!request) throw new Error(`workflow request not found: ${params.requestId}`);
  request.status = params.ok ? 'completed' : 'failed';
  request.workflowRunId = params.workflowRunId ?? request.workflowRunId;
  request.error = params.error;
  request.updatedAt = nowIso();
  store.workflowRequests.set(request.id, request);
  audit(params.workflowRunId, 'workflow_request.completed', {
    requestId: request.id,
    ok: params.ok,
    error: params.error,
  });
  return request;
}

export function transitionStage(
  workflowRunId: string,
  toStage: WorkflowStage,
  toStatus: WorkflowRunStatus = 'running',
): WorkflowRun {
  const run = store.workflowRuns.get(workflowRunId);
  if (!run) throw new Error(`workflow run not found: ${workflowRunId}`);
  run.currentStage = toStage;
  run.status = toStatus;
  run.updatedAt = nowIso();
  store.workflowRuns.set(run.id, run);
  audit(workflowRunId, 'workflow_run.stage_transition', { stage: toStage, status: toStatus });
  return run;
}

export function setWorkspace(workflowRunId: string, workspacePath: string): WorkflowRun {
  const run = store.workflowRuns.get(workflowRunId);
  if (!run) throw new Error(`workflow run not found: ${workflowRunId}`);
  run.workspacePath = workspacePath;
  run.updatedAt = nowIso();
  store.workflowRuns.set(run.id, run);
  audit(workflowRunId, 'workspace.prepared', { workspacePath });
  return run;
}

export function startStep(params: {
  workflowRunId: string;
  stage: WorkflowStage;
  name: string;
}): StepRun {
  const id = newId('step');
  const step: StepRun = {
    id,
    workflowRunId: params.workflowRunId,
    stage: params.stage,
    name: params.name,
    status: 'running',
    startedAt: nowIso(),
    completedAt: null,
  };
  store.stepRuns.set(id, step);
  transitionStage(params.workflowRunId, params.stage, 'running');
  audit(params.workflowRunId, 'step.started', {
    stepId: id,
    stage: params.stage,
    name: params.name,
  });
  return step;
}

export function finishStep(stepRunId: string, status: StepRun['status']): StepRun {
  const step = store.stepRuns.get(stepRunId);
  if (!step) throw new Error(`step run not found: ${stepRunId}`);
  step.status = status;
  step.completedAt = nowIso();
  store.stepRuns.set(step.id, step);
  audit(step.workflowRunId, 'step.finished', { stepId: step.id, status });
  return step;
}

export function recordCommandRun(commandRun: CommandRun): CommandRun {
  store.commandRuns.set(commandRun.id, commandRun);
  audit(commandRun.workflowRunId, 'command.recorded', {
    commandRunId: commandRun.id,
    command: commandRun.command,
    status: commandRun.status,
    exitCode: commandRun.exitCode,
  });
  return commandRun;
}

export function completeWorkflowRun(workflowRunId: string, ok: boolean): WorkflowRun {
  const run = store.workflowRuns.get(workflowRunId);
  if (!run) throw new Error(`workflow run not found: ${workflowRunId}`);
  run.status = ok ? 'passed' : 'failed';
  if (ok) {
    run.currentStage = 'completion';
  }
  run.updatedAt = nowIso();
  store.workflowRuns.set(run.id, run);
  audit(workflowRunId, 'workflow_run.completed', { ok, stage: run.currentStage });
  return run;
}

export function awaitHuman(workflowRunId: string, stage: WorkflowStage): WorkflowRun {
  return transitionStage(workflowRunId, stage, 'awaiting_human');
}

// ---- Workflow actions -----------------------------------------------------

export function recordWorkflowAction(input: {
  workflowRunId: WorkflowRunId;
  kind: string;
  targetId?: string | null;
  action: string;
  actor: string;
  payload?: Record<string, unknown>;
}): WorkflowAction {
  if (!store.workflowRuns.has(input.workflowRunId)) {
    throw new Error(`workflow run not found: ${input.workflowRunId}`);
  }
  const action: WorkflowAction = {
    id: newId('wact'),
    workflowRunId: input.workflowRunId,
    kind: input.kind,
    targetId: input.targetId ?? null,
    action: input.action,
    actor: input.actor,
    payload: input.payload ?? {},
    createdAt: nowIso(),
  };
  store.workflowActions.insert(action);
  audit(input.workflowRunId, 'workflow_action.recorded', {
    actionId: action.id,
    kind: action.kind,
    targetId: action.targetId,
    action: action.action,
    actor: action.actor,
  });
  return action;
}

export function recordRequirementAction(input: {
  workflowRunId: WorkflowRunId;
  targetId: string;
  action: string;
  actor: string;
  payload?: Record<string, unknown>;
}): WorkflowAction {
  return recordWorkflowAction({
    workflowRunId: input.workflowRunId,
    kind: 'requirement_item_action',
    targetId: input.targetId,
    action: input.action,
    actor: input.actor,
    payload: input.payload,
  });
}

export function recordKnowledgeAction(input: {
  workflowRunId: WorkflowRunId;
  targetId: string;
  action: 'accepted' | 'edited' | 'ignored' | string;
  actor: string;
  payload?: Record<string, unknown>;
}): WorkflowAction {
  return recordWorkflowAction({
    workflowRunId: input.workflowRunId,
    kind: 'knowledge_suggestion_action',
    targetId: input.targetId,
    action: input.action,
    actor: input.actor,
    payload: input.payload,
  });
}

export function recordAcceptanceDecision(input: {
  workflowRunId: WorkflowRunId;
  decision: string;
  actor: string;
  comment?: string | null;
  payload?: Record<string, unknown>;
}): { action: WorkflowAction; approval: Approval } {
  const action = recordWorkflowAction({
    workflowRunId: input.workflowRunId,
    kind: 'acceptance_decision',
    targetId: 'acceptance_gate',
    action: input.decision,
    actor: input.actor,
    payload: { ...(input.payload ?? {}), comment: input.comment ?? null },
  });
  const approved = input.decision === 'accept_risk' || input.decision === 'approve';
  const { approval } = recordApproval({
    workflowRunId: input.workflowRunId,
    gateId: 'acceptance_gate',
    approved,
    actor: input.actor,
    comment: input.comment ?? `acceptance decision: ${input.decision}`,
  });
  return { action, approval };
}

// ---- Artifacts -------------------------------------------------------------

export interface CreateArtifactInput {
  workflowRunId: WorkflowRunId;
  stepRunId: StepRunId | null;
  kind: ArtifactKind;
  uri: string;
  size: number;
  contentType: string;
  metadata?: Record<string, unknown>;
}

export function createArtifact(input: CreateArtifactInput): Artifact {
  const a: Artifact = {
    id: newId('art'),
    workflowRunId: input.workflowRunId,
    stepRunId: input.stepRunId,
    kind: input.kind,
    uri: input.uri,
    size: input.size,
    contentType: input.contentType,
    createdAt: nowIso(),
    metadata: input.metadata ?? {},
  };
  store.artifacts.insert(a);
  audit(input.workflowRunId, 'artifact.created', { artifactId: a.id, kind: a.kind });
  return a;
}

// ---- Knowledge artifact (V2 P0-1) ----------------------------------------
// Project-scoped, long-lived counterpart to per-run `Artifact`. See PRD ADRs
// at .trellis/tasks/05-04-v2-artifact-kind-expansion/prd.md.

export interface CreateKnowledgeArtifactInput {
  projectId: ProjectId;
  kind: KnowledgeArtifactKind;
  uri: string;
  size: number;
  contentType: string;
  /** Defaults to 'draft' if omitted. */
  status?: KnowledgeArtifactStatus;
  /** Defaults to 1 if omitted. */
  version?: number;
  /** REQ-### / DSN-### / ADR-### etc. Soft uniqueness in P0-1 (P0-2 hardens). */
  entityId?: string | null;
  /** Back-pointer to the per-run draft this entity was promoted from. */
  derivedFromArtifactId?: ArtifactId | null;
  /** Per-kind enum (see KNOWLEDGE_SUBTYPES). */
  subtype?: string | null;
  /** Freeform extension metadata; typed core fields are NOT duplicated here. */
  metadata?: Record<string, unknown>;
}

export class KnowledgeArtifactValidationError extends Error {
  constructor(message: string, readonly field: string) {
    super(message);
    this.name = 'KnowledgeArtifactValidationError';
  }
}

export function createKnowledgeArtifact(
  input: CreateKnowledgeArtifactInput,
): KnowledgeArtifact {
  if (!isKnowledgeArtifactKind(input.kind)) {
    throw new KnowledgeArtifactValidationError(
      `kind '${String(input.kind)}' is not a KnowledgeArtifactKind`,
      'kind',
    );
  }
  if (!isValidKnowledgeSubtype(input.kind, input.subtype ?? undefined)) {
    throw new KnowledgeArtifactValidationError(
      `subtype '${String(input.subtype)}' is not allowed for kind '${input.kind}'`,
      'subtype',
    );
  }
  const ts = nowIso();
  const a: KnowledgeArtifact = {
    id: newId('kart'),
    kind: input.kind,
    uri: input.uri,
    projectId: input.projectId,
    size: input.size,
    contentType: input.contentType,
    status: input.status ?? 'draft',
    version: input.version ?? 1,
    entityId: input.entityId ?? null,
    derivedFromArtifactId: input.derivedFromArtifactId ?? null,
    subtype: input.subtype ?? null,
    createdAt: ts,
    updatedAt: ts,
    metadata: input.metadata ?? {},
  };
  store.knowledgeArtifacts.insert(a);
  return a;
}

export function setKnowledgeArtifactStatus(
  id: string,
  status: KnowledgeArtifactStatus,
): KnowledgeArtifact {
  const existing = store.knowledgeArtifacts.get(id);
  if (!existing) throw new Error(`knowledge artifact not found: ${id}`);
  store.knowledgeArtifacts.updateStatus(id, status, nowIso());
  const updated = store.knowledgeArtifacts.get(id);
  if (!updated) throw new Error(`knowledge artifact disappeared after update: ${id}`);
  return updated;
}

// ---- Maven build ingest ---------------------------------------------------

export interface MavenBuildEvent {
  workflowRunId: WorkflowRunId;
  stepRunId: StepRunId | null;
  jdkVersion: string | null;
  mavenCommand: string;
  compileCommandRunId: CommandRunId | null;
  testCommandRunId: CommandRunId;
  reports: Array<{
    framework: 'maven-surefire' | 'maven-failsafe';
    /** file:// URI to the XML on the runner host. */
    reportFiles: string[];
    aggregate: {
      total: number;
      passed: number;
      failed: number;
      skipped: number;
      errors: number;
    };
  }>;
}

export interface MavenBuildResult {
  buildRun: BuildRun;
  testRuns: TestRun[];
  artifacts: Artifact[];
  compileGate: GateRun | null;
  testGate: GateRun | null;
}

export function recordMavenBuild(ev: MavenBuildEvent): MavenBuildResult {
  const commandRunIds: CommandRunId[] = [];
  if (ev.compileCommandRunId) commandRunIds.push(ev.compileCommandRunId);
  commandRunIds.push(ev.testCommandRunId);

  // 1. one Artifact per report XML
  const artifacts: Artifact[] = [];
  const testRuns: TestRun[] = [];
  for (const r of ev.reports) {
    const reportArtifactIds: string[] = [];
    for (const f of r.reportFiles) {
      const a = createArtifact({
        workflowRunId: ev.workflowRunId,
        stepRunId: ev.stepRunId,
        kind: r.framework === 'maven-surefire' ? 'surefire_report' : 'failsafe_report',
        uri: f,
        size: 0,
        contentType: 'application/xml',
        metadata: { framework: r.framework },
      });
      artifacts.push(a);
      reportArtifactIds.push(a.id);
    }
    const tr: TestRun = {
      id: newId('test'),
      buildRunId: '__pending__', // patched after build_run is inserted
      framework: r.framework,
      total: r.aggregate.total,
      passed: r.aggregate.passed,
      failed: r.aggregate.failed,
      skipped: r.aggregate.skipped,
      errors: r.aggregate.errors,
      reportArtifactIds,
    };
    testRuns.push(tr);
  }

  // 2. BuildRun
  const status: BuildRun['status'] = (() => {
    const testCmd = store.commandRuns.get(ev.testCommandRunId);
    if (!testCmd) return 'failed';
    if (testCmd.timedOut) return 'timeout';
    return testCmd.status === 'passed' ? 'passed' : 'failed';
  })();
  const startedAt =
    store.commandRuns.get(commandRunIds[0] ?? ev.testCommandRunId)?.startedAt ?? nowIso();
  const completedAt = store.commandRuns.get(ev.testCommandRunId)?.finishedAt ?? nowIso();

  const build: BuildRun = {
    id: newId('build'),
    workflowRunId: ev.workflowRunId,
    stepRunId: ev.stepRunId,
    language: 'java',
    buildTool: 'maven',
    jdkVersion: ev.jdkVersion ?? 'unknown',
    mavenCommand: ev.mavenCommand,
    status,
    startedAt,
    completedAt,
    commandRunIds,
    artifactIds: artifacts.map((a) => a.id),
  };
  store.buildRuns.insert(build);

  // 3. patch TestRuns with the real buildRunId, persist
  for (const tr of testRuns) {
    tr.buildRunId = build.id;
    store.testRuns.insert(tr);
  }

  // 4. Run Compile + Test gates
  const compileGate = ev.compileCommandRunId
    ? runCompileGate({
        workflowRunId: ev.workflowRunId,
        stepRunId: ev.stepRunId,
        buildRun: build,
      })
    : null;

  const surefireAgg = ev.reports.find((r) => r.framework === 'maven-surefire');
  const surefireAggregate = surefireAgg
    ? {
        framework: 'maven-surefire' as const,
        total: surefireAgg.aggregate.total,
        passed: surefireAgg.aggregate.passed,
        failed: surefireAgg.aggregate.failed,
        skipped: surefireAgg.aggregate.skipped,
        errors: surefireAgg.aggregate.errors,
        suites: [],
        reportPaths: surefireAgg.reportFiles,
      }
    : null;

  const testGate = runTestGate({
    workflowRunId: ev.workflowRunId,
    stepRunId: ev.stepRunId,
    buildRun: build,
    testRuns,
    surefireAggregate,
  });

  audit(ev.workflowRunId, 'maven_build.recorded', {
    buildRunId: build.id,
    status,
    compileGate: compileGate?.status ?? null,
    testGate: testGate.status,
  });

  return { buildRun: build, testRuns, artifacts, compileGate, testGate };
}

// ---- Runner heartbeat ------------------------------------------------------

export function recordHeartbeat(params: {
  id: string;
  host: string;
  version: string;
  jdkVersion: string | null;
  mavenVersion: string | null;
  gitVersion: string | null;
}): RunnerRecord {
  const r: RunnerRecord = {
    ...params,
    lastSeenAt: nowIso(),
    status: 'online',
  };
  store.runners.upsert(r);
  return r;
}

// ---- Approvals -------------------------------------------------------------

export interface ApprovalInput {
  workflowRunId: WorkflowRunId;
  gateId: GateRun['gateId'];
  approved: boolean;
  actor: string;
  comment: string | null;
  stepRunId?: StepRunId | null;
}

export function recordApproval(input: ApprovalInput): {
  approval: Approval;
  gate: GateRun;
} {
  const existing = store.approvals.latestForGate(input.workflowRunId, input.gateId);
  if (existing?.decision === (input.approved ? 'approved' : 'rejected')) {
    const existingGate = existing.gateRunId ? store.gateRuns.get(existing.gateRunId) : undefined;
    if (existingGate) {
      audit(input.workflowRunId, 'approval.idempotent_replay', {
        gateId: input.gateId,
        decision: existing.decision,
        actor: input.actor,
        existingApprovalId: existing.id,
      });
      return { approval: existing, gate: existingGate };
    }
  }

  const gate = runManualGate({
    workflowRunId: input.workflowRunId,
    stepRunId: input.stepRunId ?? null,
    gateId: input.gateId,
    approved: input.approved,
    actor: input.actor,
    comment: input.comment,
  });

  const approval: Approval = {
    id: newId('appr'),
    workflowRunId: input.workflowRunId,
    gateRunId: gate.id,
    gateId: input.gateId,
    decision: input.approved ? 'approved' : 'rejected',
    actor: input.actor,
    comment: input.comment,
    decidedAt: nowIso(),
  };
  store.approvals.insert(approval);
  audit(input.workflowRunId, 'approval.recorded', {
    gateId: input.gateId,
    decision: approval.decision,
    actor: input.actor,
  });
  return { approval, gate };
}

// ---- Agent task/result audit -------------------------------------------------

export function recordAgentTask(input: {
  workflowRunId: WorkflowRunId;
  stepRunId: StepRunId | null;
  kind: AgentTaskKind;
  backend: AgentBackendKind;
  prompt: string;
  inputArtifactIds: ArtifactId[];
}): AgentTask {
  const task: AgentTask = {
    id: newId('agt'),
    workflowRunId: input.workflowRunId,
    stepRunId: input.stepRunId,
    kind: input.kind,
    backend: input.backend,
    prompt: input.prompt,
    inputArtifactIds: input.inputArtifactIds,
    createdAt: nowIso(),
  };
  store.agentTasks.insert(task);
  audit(input.workflowRunId, 'agent_task.recorded', {
    taskId: task.id,
    kind: task.kind,
    backend: task.backend,
    stepRunId: task.stepRunId,
  });
  return task;
}

export function recordAgentResult(input: {
  taskId: string;
  status: AgentResult['status'];
  summary: string;
  outputArtifactIds: ArtifactId[];
}): AgentResult {
  const task = store.agentTasks.get(input.taskId);
  if (!task) throw new Error(`agent task not found: ${input.taskId}`);
  const result: AgentResult = {
    id: newId('agr'),
    taskId: input.taskId,
    status: input.status,
    summary: input.summary,
    outputArtifactIds: input.outputArtifactIds,
    startedAt: task.createdAt,
    completedAt: nowIso(),
  };
  store.agentResults.insert(result);
  audit(task.workflowRunId, 'agent_result.recorded', {
    taskId: task.id,
    resultId: result.id,
    status: result.status,
    outputArtifactIds: result.outputArtifactIds,
  });
  return result;
}

// ---- Audit -----------------------------------------------------------------

export function audit(
  workflowRunId: string | null,
  kind: string,
  payload: Record<string, unknown>,
): AuditEntry {
  const e: AuditEntry = {
    id: newId('audit'),
    workflowRunId,
    kind,
    payload,
    at: nowIso(),
  };
  store.auditLog.insert(e);
  return e;
}

// ---- Agent stream events ---------------------------------------------------

/**
 * Append-only ingest for streaming events (Claude Code stream-json, partial
 * messages, tool use blocks, results). Persisted to SQLite + published to
 * in-process bus for SSE subscribers.
 *
 * Sole writer for `agent_events`: keeps sequence assignment monotonic per
 * workflow run.
 */
export function recordAgentEvent(input: AgentStreamEventInput): AgentStreamEvent {
  const event: AgentStreamEvent = {
    id: newId('aev'),
    workflowRunId: input.workflowRunId,
    stepRunId: input.stepRunId,
    agentKind: input.agentKind,
    sequence: store.agentEvents.nextSequence(input.workflowRunId),
    type: input.type,
    payload: input.payload,
    text: input.text,
    ts: nowIso(),
  };
  store.agentEvents.insert(event);
  publishAgentEvent(event);
  return event;
}
