import {
  newId,
  nowIso,
  slugify,
  type Artifact,
  type ArtifactKind,
  type BuildRun,
  type CommandRun,
  type CommandRunId,
  type GateRun,
  type ProjectId,
  type StepRun,
  type StepRunId,
  type TestRun,
  type WorkflowRun,
  type WorkflowRunId,
  type WorkflowStage,
  type WorkflowRunType,
  type WorkflowRunStatus,
} from '@ainp/shared';
import { store, type Approval, type AuditEntry, type RunnerRecord } from './store/store';
import {
  runCompileGate,
  runTestGate,
  runManualGate,
} from './gate-engine';

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
    configSnapshotId: null,
    branch,
    workspacePath: null,
    createdAt: now,
    updatedAt: now,
  };
  store.workflowRuns.set(id, run);
  audit(id, 'workflow_run.created', { type: run.type, title: run.title });
  return run;
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
  run.currentStage = 'completion';
  run.updatedAt = nowIso();
  store.workflowRuns.set(run.id, run);
  audit(workflowRunId, 'workflow_run.completed', { ok });
  return run;
}

export function awaitHuman(workflowRunId: string, stage: WorkflowStage): WorkflowRun {
  return transitionStage(workflowRunId, stage, 'awaiting_human');
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
