import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, expect, test } from 'vitest';
import type { Artifact } from '@ainp/shared';

process.env.AINP_DB_PATH = join(mkdtempSync(join(tmpdir(), 'ainp-gate-test-')), 'ainp.sqlite');

let gates: typeof import('../src/gate-engine');
let storeMod: typeof import('../src/store/store');

beforeAll(async () => {
  gates = await import('../src/gate-engine');
  storeMod = await import('../src/store/store');
});

function artifact(kind: Artifact['kind'], path: string): Artifact {
  return {
    id: `art_${kind}_${Math.random().toString(16).slice(2)}`,
    kind,
    uri: `file://${path}`,
    workflowRunId: 'run_gate_structured',
    stepRunId: 'step_gate_structured',
    size: 1,
    contentType: 'text/markdown',
    createdAt: new Date().toISOString(),
    metadata: {},
  };
}

test('requirement gate fails when the draft lacks IDs, acceptance criteria, and context evidence', () => {
  const path = join(tmpdir(), `requirement-${Date.now()}.md`);
  writeFileSync(path, '# Requirement\n\nJust a paragraph.\n');
  const a = artifact('requirement_draft', path);

  const gate = gates.runRequirementGate({
    workflowRunId: 'run_gate_structured',
    stepRunId: 'step_gate_structured',
    artifact: a,
  });

  expect(gate.status).toBe('fail');
  expect(gate.ruleResults.map((r) => [r.ruleId, r.status])).toContainEqual([
    'requirement.acceptance_criteria_present',
    'fail',
  ]);
});

test('design gate requires coverage, test strategy, risks, and existing context grounding', () => {
  const path = join(tmpdir(), `design-${Date.now()}.md`);
  writeFileSync(
    path,
    [
      '---',
      'doc_type: design',
      'design_id: DSN-001',
      'related_req: REQ-001',
      'status: draft',
      '---',
      '',
      '# Design',
      '',
      '## Requirement Coverage Matrix',
      '| Requirement | Design |',
      '|---|---|',
      '| REQ-001 | D-001 |',
      '',
      '## 现状',
      'Existing implementation lives in `src/main/java/sample/Calculator.java`.',
      '',
      '## 变化',
      'Add a new method following the existing static-int signature shape.',
      '',
      '## 挂载点',
      '- `src/main/java/sample/Calculator.java` adds the new method',
      '- New JUnit cases mirror existing add/multiply tests',
      '- mvn test must pass to satisfy AC-002',
      '',
      '## 推进策略',
      '1. write the new method',
      '2. add JUnit cases',
      '3. run mvn test',
      '',
      '## Test Strategy',
      '- AC-001 is verified by mvn test.',
      '',
      '## Risks',
      '- Low risk.',
      '',
      '## Context Evidence',
      '- `src/main/java/sample/Calculator.java:1`',
    ].join('\n'),
  );
  const a = artifact('design_doc', path);

  const gate = gates.runDesignGate({
    workflowRunId: 'run_gate_structured_design',
    stepRunId: 'step_gate_structured_design',
    artifact: a,
  });

  expect(gate.status).toBe('pass');
  expect(gate.ruleResults.every((r) => r.status === 'pass')).toBe(true);
});

test('acceptance traceability gate requires requirement, design, diff, review, and passing test gate', () => {
  const reqPath = join(tmpdir(), `req-${Date.now()}.md`);
  const designPath = join(tmpdir(), `design-${Date.now()}.md`);
  const diffPath = join(tmpdir(), `diff-${Date.now()}.diff`);
  const reviewPath = join(tmpdir(), `review-${Date.now()}.md`);
  writeFileSync(reqPath, '# Requirement\nREQ-001\nAC-001\nContext Pack');
  writeFileSync(designPath, '# Design\nREQ-001\nAC-001\nTest Strategy');
  writeFileSync(diffPath, 'diff --git a/src/main/java/sample/Calculator.java b/src/main/java/sample/Calculator.java\n');
  writeFileSync(reviewPath, '# Review\nLGTM');

  const workflowRunId = 'run_acceptance_trace';
  const stepRunId = 'step_acceptance_trace';
  for (const a of [
    { ...artifact('requirement_draft', reqPath), workflowRunId, stepRunId },
    { ...artifact('design_doc', designPath), workflowRunId, stepRunId },
    { ...artifact('diff', diffPath), workflowRunId, stepRunId },
    { ...artifact('other', reviewPath), workflowRunId, stepRunId },
  ]) {
    storeMod.store.artifacts.insert(a);
  }
  // V2 W2-2a: stage-history-aware acceptance gate requires StepRuns for
  // 'requirement' / 'design' to be present (i.e. the run "committed to
  // producing" those artifacts). Without these, the new logic treats them
  // as N/A — which would still pass here but exercise the wrong path. We
  // explicitly insert the StepRuns to exercise the feature.standard "stage
  // scheduled + artifact present → pass" path (PRD AC-13).
  for (const stage of ['requirement', 'design'] as const) {
    storeMod.store.stepRuns.set(`step_${stage}_${workflowRunId}`, {
      id: `step_${stage}_${workflowRunId}`,
      workflowRunId,
      stage,
      name: `${stage}-fixture`,
      status: 'passed',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
  }
  storeMod.store.commandRuns.set('cmd_acceptance_trace', {
    id: 'cmd_acceptance_trace',
    workflowRunId,
    stepRunId,
    cwd: '/tmp',
    command: 'mvn -B test',
    stage: 'test',
    status: 'passed',
    exitCode: 0,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 1,
    stdoutRef: 'file:///tmp/stdout.log',
    stderrRef: 'file:///tmp/stderr.log',
    stdoutBytes: 0,
    stderrBytes: 0,
    timedOut: false,
    truncated: false,
  });
  gates.runTestGate({
    workflowRunId,
    stepRunId,
    buildRun: {
      id: 'build_acceptance_trace',
      workflowRunId,
      stepRunId,
      language: 'java',
      buildTool: 'maven',
      jdkVersion: '1.8',
      mavenCommand: 'mvn -B test',
      status: 'passed',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      commandRunIds: ['cmd_acceptance_trace'],
      artifactIds: [],
    },
    testRuns: [],
    surefireAggregate: {
      framework: 'maven-surefire',
      total: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
      errors: 0,
      suites: [],
      reportPaths: [],
    },
  });

  const gate = gates.runAcceptanceTraceabilityGate({ workflowRunId, stepRunId });

  expect(gate.status).toBe('pass');
  expect(gate.ruleResults.map((r) => r.ruleId)).toEqual([
    'acceptance.requirement_present',
    'acceptance.design_present',
    'acceptance.diff_present',
    'acceptance.review_present',
    'acceptance.test_gate_passed',
  ]);
});

// ---------------------------------------------------------------------------
// V2 W2-2a: stage-history-aware traceability rules (PRD ADR Q3 = C).
// AC-14: feature.standard regression — `requirement` step scheduled but its
//        artifact is missing → gate fails (regression protection).
// AC-15: issue.standard shape — no `requirement` / `design` step scheduled →
//        rules pass with N/A note; gate passes if other rules pass.
// AC-16: feature.fastforward shape — same as AC-15 (W2-3 R-Risk-2 fix).
// ---------------------------------------------------------------------------

function insertPassingTestGate(workflowRunId: string, stepRunId: string | null) {
  const cmdId = `cmd_${workflowRunId}`;
  storeMod.store.commandRuns.set(cmdId, {
    id: cmdId,
    workflowRunId,
    stepRunId,
    cwd: '/tmp',
    command: 'mvn -B test',
    stage: 'test',
    status: 'passed',
    exitCode: 0,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 1,
    stdoutRef: 'file:///tmp/stdout.log',
    stderrRef: 'file:///tmp/stderr.log',
    stdoutBytes: 0,
    stderrBytes: 0,
    timedOut: false,
    truncated: false,
  });
  gates.runTestGate({
    workflowRunId,
    stepRunId,
    buildRun: {
      id: `build_${workflowRunId}`,
      workflowRunId,
      stepRunId,
      language: 'java',
      buildTool: 'maven',
      jdkVersion: '1.8',
      mavenCommand: 'mvn -B test',
      status: 'passed',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      commandRunIds: [cmdId],
      artifactIds: [],
    },
    testRuns: [],
    surefireAggregate: {
      framework: 'maven-surefire',
      total: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
      errors: 0,
      suites: [],
      reportPaths: [],
    },
  });
}

function insertStepRun(workflowRunId: string, stage: import('@ainp/shared').WorkflowStage) {
  const id = `step_${stage}_${workflowRunId}`;
  storeMod.store.stepRuns.set(id, {
    id,
    workflowRunId,
    stage,
    name: `${stage}-fixture`,
    status: 'passed',
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  });
}

test('AC-14: feature.standard regression — requirement step scheduled but artifact missing → fail', () => {
  const workflowRunId = 'run_acceptance_trace_missing_req';
  const stepRunId = 'step_acceptance_trace_missing_req';
  const designPath = join(tmpdir(), `design-missing-req-${Date.now()}.md`);
  const diffPath = join(tmpdir(), `diff-missing-req-${Date.now()}.diff`);
  const reviewPath = join(tmpdir(), `review-missing-req-${Date.now()}.md`);
  writeFileSync(designPath, '# Design\nREQ-001');
  writeFileSync(diffPath, 'diff --git a/src/main b/src/main\n');
  writeFileSync(reviewPath, '# Review\nLGTM');

  // Insert design + diff + review artifacts but NO requirement_draft.
  for (const a of [
    { ...artifact('design_doc', designPath), workflowRunId, stepRunId },
    { ...artifact('diff', diffPath), workflowRunId, stepRunId },
    { ...artifact('other', reviewPath), workflowRunId, stepRunId },
  ]) {
    storeMod.store.artifacts.insert(a);
  }
  // Schedule both requirement + design step. Missing requirement_draft
  // artifact must surface as a hard fail (it was committed to but didn't
  // produce). Without this regression test the stage-history-aware refactor
  // could accidentally relax feature.standard semantics.
  insertStepRun(workflowRunId, 'requirement');
  insertStepRun(workflowRunId, 'design');
  insertPassingTestGate(workflowRunId, stepRunId);

  const gate = gates.runAcceptanceTraceabilityGate({ workflowRunId, stepRunId });

  expect(gate.status).toBe('fail');
  const ruleByid = Object.fromEntries(gate.ruleResults.map((r) => [r.ruleId, r]));
  expect(ruleByid['acceptance.requirement_present'].status).toBe('fail');
  expect(ruleByid['acceptance.design_present'].status).toBe('pass');
  expect(ruleByid['acceptance.diff_present'].status).toBe('pass');
});

test('AC-15: issue.standard shape — no requirement/design step scheduled → presence rules pass with N/A', () => {
  const workflowRunId = 'run_acceptance_trace_issue';
  const stepRunId = 'step_acceptance_trace_issue';
  const reportPath = join(tmpdir(), `issue-report-${Date.now()}.md`);
  const analysisPath = join(tmpdir(), `issue-analysis-${Date.now()}.md`);
  const diffPath = join(tmpdir(), `issue-diff-${Date.now()}.diff`);
  const reviewPath = join(tmpdir(), `issue-review-${Date.now()}.md`);
  writeFileSync(reportPath, '# Report\nbug X');
  writeFileSync(analysisPath, '# Analysis\nroot cause Y');
  writeFileSync(diffPath, 'diff --git a/src/main b/src/main\n');
  writeFileSync(reviewPath, '# Review\nFix verified');

  // Issue.standard produces report + analysis as kind='other' (PRD ADR Q5).
  // Insert one as the "review" artifact slot (latest 'other' artifact wins
  // the byKind lookup). Plus a diff from implementation step.
  for (const a of [
    { ...artifact('other', reportPath), workflowRunId, stepRunId },
    { ...artifact('other', analysisPath), workflowRunId, stepRunId },
    { ...artifact('diff', diffPath), workflowRunId, stepRunId },
    { ...artifact('other', reviewPath), workflowRunId, stepRunId },
  ]) {
    storeMod.store.artifacts.insert(a);
  }
  // issue.standard: schedules report / analyze / implementation / build_test
  // / review / completion — NO requirement / design step.
  for (const stage of [
    'report',
    'analyze',
    'implementation',
    'build_test',
    'review',
  ] as const) {
    insertStepRun(workflowRunId, stage);
  }
  insertPassingTestGate(workflowRunId, stepRunId);

  const gate = gates.runAcceptanceTraceabilityGate({ workflowRunId, stepRunId });

  expect(gate.status).toBe('pass');
  const ruleById = Object.fromEntries(gate.ruleResults.map((r) => [r.ruleId, r]));
  expect(ruleById['acceptance.requirement_present'].status).toBe('pass');
  expect(ruleById['acceptance.requirement_present'].message).toMatch(/not applicable/i);
  expect(ruleById['acceptance.design_present'].status).toBe('pass');
  expect(ruleById['acceptance.design_present'].message).toMatch(/not applicable/i);
  expect(ruleById['acceptance.diff_present'].status).toBe('pass');
  expect(ruleById['acceptance.review_present'].status).toBe('pass');
  expect(ruleById['acceptance.test_gate_passed'].status).toBe('pass');
});

test('AC-15 / W2-2b AC-15: refactor.standard shape — no requirement/design step → presence rules pass with N/A', () => {
  const workflowRunId = 'run_acceptance_trace_refactor';
  const stepRunId = 'step_acceptance_trace_refactor';
  const scanPath = join(tmpdir(), `refactor-scan-${Date.now()}.md`);
  const planPath = join(tmpdir(), `refactor-plan-${Date.now()}.md`);
  const diffPath = join(tmpdir(), `refactor-diff-${Date.now()}.diff`);
  const reviewPath = join(tmpdir(), `refactor-review-${Date.now()}.md`);
  writeFileSync(scanPath, '# Scan\nfound dead code in module X');
  writeFileSync(planPath, '# Refactor Plan\nextract helper Y');
  writeFileSync(diffPath, 'diff --git a/src/main b/src/main\n');
  writeFileSync(reviewPath, '# Review\nrefactor LGTM, behaviour preserved');

  // refactor.standard produces scan_doc + refactor_plan as kind='other'
  // (PRD ADR Q5 inherited). Plus a diff from implementation step. Latest
  // 'other' artifact wins the byKind lookup → review.
  for (const a of [
    { ...artifact('other', scanPath), workflowRunId, stepRunId },
    { ...artifact('other', planPath), workflowRunId, stepRunId },
    { ...artifact('diff', diffPath), workflowRunId, stepRunId },
    { ...artifact('other', reviewPath), workflowRunId, stepRunId },
  ]) {
    storeMod.store.artifacts.insert(a);
  }
  // refactor.standard schedules scan / plan / implementation / build_test /
  // review / completion — NO requirement / design step.
  for (const stage of [
    'scan',
    'plan',
    'implementation',
    'build_test',
    'review',
  ] as const) {
    insertStepRun(workflowRunId, stage);
  }
  insertPassingTestGate(workflowRunId, stepRunId);

  const gate = gates.runAcceptanceTraceabilityGate({ workflowRunId, stepRunId });

  expect(gate.status).toBe('pass');
  const ruleById = Object.fromEntries(gate.ruleResults.map((r) => [r.ruleId, r]));
  expect(ruleById['acceptance.requirement_present'].status).toBe('pass');
  expect(ruleById['acceptance.requirement_present'].message).toMatch(/not applicable/i);
  expect(ruleById['acceptance.design_present'].status).toBe('pass');
  expect(ruleById['acceptance.design_present'].message).toMatch(/not applicable/i);
  expect(ruleById['acceptance.diff_present'].status).toBe('pass');
  expect(ruleById['acceptance.review_present'].status).toBe('pass');
  expect(ruleById['acceptance.test_gate_passed'].status).toBe('pass');
});

test('AC-16: feature.fastforward shape — no requirement/design step → pass (W2-3 R-Risk-2 fix)', () => {
  const workflowRunId = 'run_acceptance_trace_fastforward';
  const stepRunId = 'step_acceptance_trace_fastforward';
  const diffPath = join(tmpdir(), `ff-diff-${Date.now()}.diff`);
  const reviewPath = join(tmpdir(), `ff-review-${Date.now()}.md`);
  writeFileSync(diffPath, 'diff --git a/src/main b/src/main\n');
  writeFileSync(reviewPath, '# Review\nFastforward LGTM');

  for (const a of [
    { ...artifact('diff', diffPath), workflowRunId, stepRunId },
    { ...artifact('other', reviewPath), workflowRunId, stepRunId },
  ]) {
    storeMod.store.artifacts.insert(a);
  }
  // feature.fastforward: only implementation / build_test / review /
  // completion scheduled. NO context_pack / requirement / design / knowledge.
  for (const stage of [
    'implementation',
    'build_test',
    'review',
  ] as const) {
    insertStepRun(workflowRunId, stage);
  }
  insertPassingTestGate(workflowRunId, stepRunId);

  const gate = gates.runAcceptanceTraceabilityGate({ workflowRunId, stepRunId });

  expect(gate.status).toBe('pass');
  const ruleById = Object.fromEntries(gate.ruleResults.map((r) => [r.ruleId, r]));
  expect(ruleById['acceptance.requirement_present'].status).toBe('pass');
  expect(ruleById['acceptance.design_present'].status).toBe('pass');
  expect(ruleById['acceptance.diff_present'].status).toBe('pass');
  expect(ruleById['acceptance.review_present'].status).toBe('pass');
});
