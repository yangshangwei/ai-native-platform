/**
 * 08-09 P1-2b bounded auto-rework — the trigger, end to end through
 * `POST /runner/events/workflow-completed`.
 *
 * The pure judgement is covered in `packages/shared/test/auto-rework.test.ts`.
 * What this file proves is different and is the reason the task exists: that
 * the snapshot the api assembles out of the store actually carries each
 * condition, and that a refusal really is a refusal — no `retryStage`, no
 * budget spent, run left `failed`.
 *
 * Every refusal test asserts the run is still `failed` rather than just reading
 * the decision object. A trigger that returns "no" and retries anyway would
 * pass the weaker assertion.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, expect, test } from 'vitest';
import {
  AUTO_REWORK_ACTOR,
  REVIEW_VERDICT_SCHEMA_VERSION,
  newId,
  nowIso,
  type AutoReworkDecision,
  type GateId,
  type GateRun,
  type Project,
  type RuleResult,
  type WorkflowRun,
  type WorkflowStage,
} from '@ainp/shared';

process.env.AINP_DB_PATH = join(mkdtempSync(join(tmpdir(), 'ainp-auto-rework-')), 'ainp.sqlite');

let app: Awaited<typeof import('../src/app')>['app'];
let workflow: typeof import('../src/workflow-engine');
let storeMod: typeof import('../src/store/store');

beforeAll(async () => {
  ({ app } = await import('../src/app'));
  workflow = await import('../src/workflow-engine');
  storeMod = await import('../src/store/store');
});

// ---- fixture ---------------------------------------------------------------

let seq = 0;

interface Scenario {
  run: WorkflowRun;
  stage: WorkflowStage;
}

/**
 * A run parked at `build_test` with everything auto-rework needs: a failing
 * compile gate owned by that stage, a non-zero command exit, and a reviewer
 * verdict carrying remediation. Each test removes exactly one ingredient.
 */
function scenario(
  options: {
    stage?: WorkflowStage;
    gateId?: GateId;
    ruleId?: string;
    withFeedback?: boolean;
    exitCode?: number;
  } = {},
): Scenario {
  const stage = options.stage ?? 'build_test';
  const project: Project = {
    id: newId('proj'),
    name: `auto-rework-${(seq += 1)}-${Date.now()}`,
    localPath: tmpdir(),
    language: 'java',
    buildTool: 'maven',
    defaultBranch: 'main',
    registeredAt: nowIso(),
  };
  storeMod.store.projects.set(project.id, project);
  const run = workflow.createWorkflowRun({
    projectId: project.id,
    type: 'feature',
    title: 'bounded auto-rework fixture',
  });

  const step = workflow.startStep({ workflowRunId: run.id, stage, name: stage });
  insertFailingGate({
    workflowRunId: run.id,
    stepRunId: step.id,
    gateId: options.gateId ?? 'compile_gate',
    ruleId: options.ruleId ?? 'compile.exit_code',
  });
  recordFailedCommand(run.id, step.id, options.exitCode ?? 1);
  if (options.withFeedback !== false) attachVerdictWithRemediation(run.id, step.id);

  return { run: storeMod.store.workflowRuns.get(run.id)!, stage };
}

function insertFailingGate(params: {
  workflowRunId: string;
  stepRunId: string | null;
  gateId: GateId;
  ruleId: string;
  status?: GateRun['status'];
  decidedAt?: string;
}): GateRun {
  const status = params.status ?? 'fail';
  const ruleResults: RuleResult[] = [
    {
      ruleId: params.ruleId,
      status: status === 'pass' ? 'pass' : 'fail',
      message: status === 'pass' ? 'ok' : 'failed',
      evidenceRefs: [],
    },
  ];
  const gate: GateRun = {
    id: newId('gate'),
    gateId: params.gateId,
    workflowRunId: params.workflowRunId,
    stepRunId: params.stepRunId,
    status,
    ruleResults,
    evidenceRefs: [],
    commandRunIds: [],
    decidedAt: params.decidedAt ?? nowIso(),
    agentNote: null,
  };
  storeMod.store.gateRuns.insert(gate);
  return gate;
}

function recordFailedCommand(workflowRunId: string, stepRunId: string, exitCode: number): void {
  workflow.recordCommandRun({
    id: newId('cmd'),
    workflowRunId,
    stepRunId,
    cwd: tmpdir(),
    command: 'mvn -q compile',
    stage: 'compile',
    status: 'failed',
    exitCode,
    startedAt: nowIso(),
    finishedAt: nowIso(),
    durationMs: 10,
    stdoutRef: 'mem://stdout',
    stderrRef: 'mem://stderr',
    stdoutBytes: 0,
    stderrBytes: 0,
    timedOut: false,
    truncated: false,
  });
}

/** A failing reviewer verdict with remediation — R3 condition 5's material. */
function attachVerdictWithRemediation(workflowRunId: string, stepRunId: string): void {
  const dir = mkdtempSync(join(tmpdir(), 'ainp-auto-rework-verdict-'));
  const path = join(dir, 'review-verdict.json');
  const verdict = {
    schemaVersion: REVIEW_VERDICT_SCHEMA_VERSION,
    role: 'reviewer',
    status: 'fail',
    summary: 'compile is broken',
    blocking: [
      {
        id: 'B1',
        severity: 'blocker',
        summary: 'missing import',
        location: 'src/Main.java:3',
        evidenceRefs: [],
      },
    ],
    remediation: [{ blockerId: 'B1', action: 'add the missing import', rationale: null }],
    advisory: [],
    evidenceRefs: [],
    provenance: {
      agentSessionId: null,
      backend: 'claude_code',
      skillId: 'skill.review',
      producedAt: nowIso(),
    },
    unavailableReason: null,
  };
  writeFileSync(path, JSON.stringify(verdict));
  workflow.createArtifact({
    workflowRunId,
    stepRunId,
    kind: 'other',
    uri: `file://${path}`,
    size: 1,
    contentType: 'application/json',
    // Key copied from the writer (`metadataForStageOutput` copies schemaVersion
    // out of the JSON body), not from this reader's expectation.
    metadata: { schemaVersion: REVIEW_VERDICT_SCHEMA_VERSION, output: 'review-verdict.json' },
  });
}

async function postWorkflowCompleted(
  workflowRunId: string,
  ok = false,
): Promise<{ run: WorkflowRun; autoRework: AutoReworkDecision | null }> {
  const res = await app.request('/runner/events/workflow-completed', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workflowRunId, ok }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { run: WorkflowRun; autoRework: AutoReworkDecision | null };
}

function autoRetryAudits(workflowRunId: string): number {
  return storeMod.store.auditLog
    .byWorkflow(workflowRunId)
    .filter((entry) => entry.kind === 'stage.retry' && entry.payload.actor === AUTO_REWORK_ACTOR)
    .length;
}

function attemptsFor(workflowRunId: string, stage: WorkflowStage): number {
  return storeMod.store.workflowRuns.get(workflowRunId)?.autoRework?.[stage]?.attempts ?? 0;
}

/** Every refusal must leave the run failed, unretried, and unbilled. */
function expectRefused(
  body: { run: WorkflowRun; autoRework: AutoReworkDecision | null },
  scenarioRun: Scenario,
  reason: string,
): void {
  expect(body.autoRework).toMatchObject({ retry: false, reason });
  expect(body.run.status).toBe('failed');
  expect(storeMod.store.workflowRuns.get(scenarioRun.run.id)?.status).toBe('failed');
  expect(autoRetryAudits(scenarioRun.run.id)).toBe(0);
  expect(attemptsFor(scenarioRun.run.id, scenarioRun.stage)).toBe(0);
}

// ---- the grant -------------------------------------------------------------

test('a deterministic failure with remediation is retried exactly once', async () => {
  const s = scenario();

  const first = await postWorkflowCompleted(s.run.id);
  expect(first.autoRework).toMatchObject({ retry: true, stage: s.stage, attempt: 1 });
  // The run was reset, not left failed — this is what the runner re-enters.
  expect(first.run.status).toBe('running');
  expect(first.run.currentStage).toBe(s.stage);
  expect(autoRetryAudits(s.run.id)).toBe(1);
  expect(attemptsFor(s.run.id, s.stage)).toBe(1);

  // Second failure, same run: the budget is spent. Note the fingerprint would
  // also stop it — `budget_exhausted` wins because it is checked first.
  const second = await postWorkflowCompleted(s.run.id);
  expect(second.autoRework).toMatchObject({ retry: false, reason: 'budget_exhausted' });
  expect(second.run.status).toBe('failed');
  expect(autoRetryAudits(s.run.id)).toBe(1);
  expect(attemptsFor(s.run.id, s.stage)).toBe(1);
});

test('the audit distinguishes an automatic retry from a human one', async () => {
  const s = scenario();
  await postWorkflowCompleted(s.run.id);
  workflow.retryStage({ workflowRunId: s.run.id, stage: s.stage, actor: 'web' });

  const actors = storeMod.store.auditLog
    .byWorkflow(s.run.id)
    .filter((entry) => entry.kind === 'stage.retry')
    .map((entry) => entry.payload.actor);
  expect(actors).toEqual([AUTO_REWORK_ACTOR, 'web']);
});

// ---- R3.1: only /workflow-completed failures -------------------------------

test('a successful run is never auto-reworked', async () => {
  const s = scenario();
  const body = await postWorkflowCompleted(s.run.id, true);
  expect(body.autoRework).toBeNull();
  expect(body.run.status).toBe('passed');
  expect(autoRetryAudits(s.run.id)).toBe(0);
});

test('an operational pause never reaches the trigger', async () => {
  const s = scenario();
  const paused = await app.request('/runner/events/workflow-paused', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowRunId: s.run.id,
      stage: s.stage,
      reason: 'reviewer_unavailable',
      detail: 'reviewer backend unavailable',
    }),
  });
  expect(paused.status).toBe(200);
  expect(storeMod.store.workflowRuns.get(s.run.id)?.status).toBe('paused');
  expect(autoRetryAudits(s.run.id)).toBe(0);
  expect(attemptsFor(s.run.id, s.stage)).toBe(0);

  // And a late duplicate `ok: false` for the paused run must not resurrect it:
  // completeWorkflowRun keeps it paused, so the trigger never sees `failed`.
  const late = await postWorkflowCompleted(s.run.id);
  expect(late.run.status).toBe('paused');
  expect(late.autoRework).toBeNull();
  expect(autoRetryAudits(s.run.id)).toBe(0);
  expect(attemptsFor(s.run.id, s.stage)).toBe(0);
});

// ---- R3.2: forbidden and human-decided gates -------------------------------

test.each(['sensitive_change_gate', 'knowledge_gate'] as const)(
  'a failing %s is never auto-reworked',
  async (gateId) => {
    const s = scenario({ gateId });
    expectRefused(await postWorkflowCompleted(s.run.id), s, 'forbidden_gate');
  },
);

test('a gate a human already decided is never auto-reworked', async () => {
  const s = scenario({ gateId: 'acceptance_gate' });
  workflow.recordApproval({
    workflowRunId: s.run.id,
    gateId: 'acceptance_gate',
    approved: false,
    actor: 'human@example.com',
    comment: 'not acceptable yet',
  });
  // The rejection comment satisfies condition 5, so this run fails ONLY on the
  // human-decision rule — otherwise the test could pass for the wrong reason.
  expectRefused(await postWorkflowCompleted(s.run.id), s, 'human_decided_gate');
});

test('a failure with no failing gate is not retried blind', async () => {
  const project: Project = {
    id: newId('proj'),
    name: `auto-rework-unattributed-${(seq += 1)}-${Date.now()}`,
    localPath: tmpdir(),
    language: 'java',
    buildTool: 'maven',
    defaultBranch: 'main',
    registeredAt: nowIso(),
  };
  storeMod.store.projects.set(project.id, project);
  const run = workflow.createWorkflowRun({
    projectId: project.id,
    type: 'feature',
    title: 'thrown error, no gate',
  });
  const step = workflow.startStep({
    workflowRunId: run.id,
    stage: 'implementation',
    name: 'implementation',
  });
  attachVerdictWithRemediation(run.id, step.id);

  expectRefused(
    await postWorkflowCompleted(run.id),
    { run, stage: 'implementation' },
    'unattributed_failure',
  );
});

test('a gate belonging to a different stage does not license this stage', async () => {
  // The failing gate is owned by `review`; the run failed at `implementation`.
  const s = scenario({ stage: 'review' });
  workflow.transitionStage(s.run.id, 'implementation', 'running');
  expectRefused(
    await postWorkflowCompleted(s.run.id),
    { run: s.run, stage: 'implementation' },
    'unattributed_failure',
  );
});

// ---- R3.4: no progress -----------------------------------------------------

test('an identical failure is refused even when the budget allows it', async () => {
  const s = scenario();
  const first = await postWorkflowCompleted(s.run.id);
  expect(first.autoRework).toMatchObject({ retry: true });
  const fingerprint = (first.autoRework as { fingerprint: string }).fingerprint;

  // Hand back one attempt while keeping the recorded fingerprint: budget is
  // available, so only the no-progress rule can stop the second retry.
  const run = storeMod.store.workflowRuns.get(s.run.id)!;
  storeMod.store.workflowRuns.set(run.id, {
    ...run,
    autoRework: { [s.stage]: { attempts: 0, fingerprint } },
  });

  const second = await postWorkflowCompleted(s.run.id);
  expect(second.autoRework).toMatchObject({ retry: false, reason: 'no_progress' });
  expect(second.run.status).toBe('failed');
  expect(autoRetryAudits(s.run.id)).toBe(1);
});

test('a changed failure with budget left is retried again', async () => {
  const s = scenario();
  const first = await postWorkflowCompleted(s.run.id);
  expect(first.autoRework).toMatchObject({ retry: true });

  const run = storeMod.store.workflowRuns.get(s.run.id)!;
  storeMod.store.workflowRuns.set(run.id, {
    ...run,
    autoRework: { [s.stage]: { attempts: 0, fingerprint: 'stage=build_test|rules=|exits=' } },
  });

  const second = await postWorkflowCompleted(s.run.id);
  expect(second.autoRework).toMatchObject({ retry: true, attempt: 1 });
  expect(autoRetryAudits(s.run.id)).toBe(2);
});

// ---- R3.5: something to act on ---------------------------------------------

test('a failure with no remediation and no rejection comment is not retried', async () => {
  const s = scenario({ withFeedback: false });
  expectRefused(await postWorkflowCompleted(s.run.id), s, 'no_actionable_feedback');
});

test('a resolved rejection still counts as feedback for a later failure', async () => {
  // The reachable shape of "rejection comment is the clue": a human rejected
  // the design gate, the agent revised, that gate now passes, and the run later
  // fails at build_test. The comment is still what the retry should read.
  //
  // Its unresolved twin cannot grant, and should not: `recordApproval` records
  // a FAILING manual gate with no stepRunId, which counts as a run-level
  // failure with a human decision on it — refused above by `human_decided_gate`.
  const s = scenario({ withFeedback: false });
  workflow.recordApproval({
    workflowRunId: s.run.id,
    gateId: 'design_gate',
    approved: false,
    actor: 'human@example.com',
    comment: 'the design misses the error path',
  });
  insertFailingGate({
    workflowRunId: s.run.id,
    stepRunId: null,
    gateId: 'design_gate',
    ruleId: 'design.sections',
    status: 'pass',
    // Later than the rejection so it is the latest run of that gate.
    decidedAt: new Date(Date.now() + 60_000).toISOString(),
  });

  const body = await postWorkflowCompleted(s.run.id);
  expect(body.autoRework).toMatchObject({ retry: true, stage: s.stage });
});

test('a passing verdict is not remediation', async () => {
  const s = scenario({ withFeedback: false });
  const dir = mkdtempSync(join(tmpdir(), 'ainp-auto-rework-pass-verdict-'));
  const path = join(dir, 'review-verdict.json');
  writeFileSync(
    path,
    JSON.stringify({
      schemaVersion: REVIEW_VERDICT_SCHEMA_VERSION,
      role: 'reviewer',
      status: 'pass',
      summary: 'looks fine',
      blocking: [],
      remediation: [],
      advisory: ['consider renaming'],
      evidenceRefs: [],
      provenance: {
        agentSessionId: null,
        backend: 'claude_code',
        skillId: 'skill.review',
        producedAt: nowIso(),
      },
      unavailableReason: null,
    }),
  );
  workflow.createArtifact({
    workflowRunId: s.run.id,
    stepRunId: null,
    kind: 'other',
    uri: `file://${path}`,
    size: 1,
    contentType: 'application/json',
    metadata: { schemaVersion: REVIEW_VERDICT_SCHEMA_VERSION },
  });

  expectRefused(await postWorkflowCompleted(s.run.id), s, 'no_actionable_feedback');
});

// ---- R1: the two budgets are independent -----------------------------------

test('a manual retry does not spend the automatic budget', async () => {
  const s = scenario();
  workflow.retryStage({ workflowRunId: s.run.id, stage: s.stage, actor: 'web' });
  workflow.retryStage({ workflowRunId: s.run.id, stage: s.stage, actor: 'web' });
  expect(attemptsFor(s.run.id, s.stage)).toBe(0);

  const body = await postWorkflowCompleted(s.run.id);
  expect(body.autoRework).toMatchObject({ retry: true, attempt: 1 });
});

test('a spent automatic budget does not block a manual retry', async () => {
  const s = scenario();
  await postWorkflowCompleted(s.run.id);
  const exhausted = await postWorkflowCompleted(s.run.id);
  expect(exhausted.autoRework).toMatchObject({ retry: false, reason: 'budget_exhausted' });

  const manual = workflow.retryStage({ workflowRunId: s.run.id, stage: s.stage, actor: 'web' });
  expect(manual.run.status).toBe('running');
  expect(manual.run.currentStage).toBe(s.stage);
});

test('the budget is per (run, stage), not per run', async () => {
  const s = scenario();
  await postWorkflowCompleted(s.run.id);
  expect(attemptsFor(s.run.id, s.stage)).toBe(1);

  // A different stage of the SAME run fails: its own budget is untouched.
  const step = workflow.startStep({ workflowRunId: s.run.id, stage: 'review', name: 'review' });
  insertFailingGate({
    workflowRunId: s.run.id,
    stepRunId: step.id,
    gateId: 'acceptance_gate',
    ruleId: 'acceptance.ac_coverage',
  });
  const body = await postWorkflowCompleted(s.run.id);
  expect(body.autoRework).toMatchObject({ retry: true, stage: 'review', attempt: 1 });
  expect(attemptsFor(s.run.id, 'build_test')).toBe(1);
  expect(attemptsFor(s.run.id, 'review')).toBe(1);
});

// ---- persistence -----------------------------------------------------------

test('the ledger survives a round trip through the database', async () => {
  const s = scenario();
  await postWorkflowCompleted(s.run.id);
  const reread = storeMod.store.workflowRuns.get(s.run.id)!;
  expect(reread.autoRework[s.stage]).toEqual({
    attempts: 1,
    fingerprint: expect.any(String),
  });
});

test('a run that never auto-reworked carries an empty ledger', () => {
  const s = scenario();
  expect(storeMod.store.workflowRuns.get(s.run.id)?.autoRework).toEqual({});
});
