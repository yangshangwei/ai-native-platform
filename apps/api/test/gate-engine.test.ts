import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, expect, test } from 'vitest';
import {
  VERIFIER_AC_MATRIX_SCHEMA_VERSION,
  VERIFIER_MEDIA_SCHEMA_VERSION,
  type Artifact,
  type Project,
  type WorkflowRun,
} from '@ainp/shared';

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
    sha256: sha256(readFileSync(path)),
    createdAt: new Date().toISOString(),
    metadata: {},
  };
}

function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
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
      '- AC-001 is verified by a JUnit test that calls Calculator.subtract for normal integer subtraction via mvn test.',
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

test('requirement gate rejects command-only acceptance criteria without business behavior', () => {
  const path = join(tmpdir(), `requirement-command-only-${Date.now()}.md`);
  writeFileSync(
    path,
    [
      '---',
      'pitch: tighten acceptance',
      '---',
      '# Requirement',
      '',
      'REQ-001',
      '',
      '## 用户故事',
      '- 作为验收负责人，我希望验收标准能说明业务行为，而不是只有命令。',
      '- 作为维护者，我希望缺失业务场景时 Gate 能阻止继续。',
      '',
      '## 为什么需要',
      '只看命令通过会漏掉核心业务行为。',
      '',
      '## 怎么解决',
      '- AC-001: mvn test 通过。',
      '',
      '## 边界',
      '本任务只验证验收标准文本质量，不改变构建命令本身。',
      '',
      '## Context Evidence',
      '- `src/main/java/sample/Calculator.java:1`',
    ].join('\n'),
  );
  const a = artifact('requirement_draft', path);

  const gate = gates.runRequirementGate({
    workflowRunId: 'run_requirement_command_only',
    stepRunId: 'step_requirement_command_only',
    artifact: a,
  });
  const ruleById = Object.fromEntries(gate.ruleResults.map((r) => [r.ruleId, r]));

  expect(ruleById['requirement.acceptance_criteria_present'].status).toBe('pass');
  expect(ruleById['requirement.acceptance_business_meaning_present'].status).toBe('fail');
});

test('design gate rejects command-only AC verification strategy', () => {
  const path = join(tmpdir(), `design-command-only-${Date.now()}.md`);
  writeFileSync(
    path,
    [
      '---',
      'doc_type: design',
      'design_id: DSN-001',
      'related_req: REQ-001',
      'status: draft',
      '---',
      '# Design',
      '',
      '## Requirement Coverage Matrix',
      '| Requirement | Design item | Acceptance criteria | Verification |',
      '|---|---|---|---|',
      '| REQ-001 | D-001: Captcha config | AC-001 | mvn test |',
      '',
      '## 现状',
      'Existing implementation lives in `src/main/java/sample/Calculator.java`.',
      '',
      '## 变化',
      'Add a verifier matrix check.',
      '',
      '## 挂载点',
      '- Requirement gate checks AC text',
      '- Design gate checks verification text',
      '- Acceptance gate checks matrix rows',
      '',
      '## 推进策略',
      '1. update gates',
      '2. add tests',
      '3. run typecheck',
      '',
      '## Test Strategy',
      '- AC-001: mvn test',
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
    workflowRunId: 'run_design_command_only',
    stepRunId: 'step_design_command_only',
    artifact: a,
  });
  const ruleById = Object.fromEntries(gate.ruleResults.map((r) => [r.ruleId, r]));

  expect(ruleById['design.test_strategy_present'].status).toBe('pass');
  expect(ruleById['design.business_verification_strategy_present'].status).toBe('fail');
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
    stdoutSha256: sha256(''),
    stderrSha256: sha256(''),
    combinedSha256: sha256('combined'),
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
  const reqArtifact = storeMod.store.artifacts.byKind(workflowRunId, 'requirement_draft').at(-1)!;
  const designArtifact = storeMod.store.artifacts.byKind(workflowRunId, 'design_doc').at(-1)!;
  const matrixPath = join(tmpdir(), `acceptance-matrix-${Date.now()}.json`);
  writeFileSync(
    matrixPath,
    `${JSON.stringify({
      schemaVersion: VERIFIER_AC_MATRIX_SCHEMA_VERSION,
      workflowRunId,
      stepRunId,
      verifierRequired: false,
      verifierStatus: 'pass',
      acceptanceCriteria: [
        {
          id: 'AC-001',
          text: 'Calculator subtract returns the arithmetic difference for normal integer inputs.',
          scenarioType: 'core',
          verificationMethod: 'JUnit subtract test exercises normal integer subtraction through mvn test.',
          businessStatus: 'passed',
          status: 'pass',
          evidenceRefs: [
            { artifactId: reqArtifact.id, claim: 'requirement business behavior for AC-001' },
            { artifactId: designArtifact.id, claim: 'design verification strategy for AC-001' },
          ],
        },
        {
          id: 'AC-002',
          text: 'Calculator subtract handles zero as a boundary input without changing the other operand.',
          scenarioType: 'boundary',
          verificationMethod: 'JUnit subtract boundary test exercises zero subtraction through mvn test.',
          businessStatus: 'passed',
          status: 'pass',
          evidenceRefs: [
            { artifactId: reqArtifact.id, claim: 'requirement boundary behavior for AC-002' },
            { artifactId: designArtifact.id, claim: 'design verification strategy for AC-002' },
          ],
        },
        {
          id: 'AC-003',
          text: 'Calculator subtract rejects unsupported overflow handling as an explicit exception risk.',
          scenarioType: 'exception',
          verificationMethod: 'JUnit exception-path test documents overflow behavior through mvn test.',
          businessStatus: 'passed',
          status: 'pass',
          evidenceRefs: [
            { artifactId: reqArtifact.id, claim: 'requirement exception behavior for AC-003' },
            { artifactId: designArtifact.id, claim: 'design verification strategy for AC-003' },
          ],
        },
      ],
      createdAt: new Date().toISOString(),
    }, null, 2)}\n`,
  );
  storeMod.store.artifacts.insert({
    ...artifact('other', matrixPath),
    workflowRunId,
    stepRunId,
    contentType: 'application/json',
    metadata: {
      schemaVersion: VERIFIER_AC_MATRIX_SCHEMA_VERSION,
      reportKind: 'verifier_ac_matrix',
      verifierArtifactType: 'ac_matrix',
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
    'acceptance.business_matrix_present',
    'acceptance.business_matrix_criteria_proven',
    'acceptance.business_matrix_scenarios_present',
  ]);
});

test('acceptance traceability gate rejects feature ACs when only test_gate passes and no business matrix exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ainp-acceptance-matrix-missing-'));
  const reqPath = join(dir, 'req.md');
  const designPath = join(dir, 'design.md');
  const diffPath = join(dir, 'diff.diff');
  const reviewPath = join(dir, 'review.md');
  const workflowRunId = 'run_acceptance_matrix_missing';
  const stepRunId = 'step_acceptance_matrix_missing';
  writeFileSync(reqPath, '# Requirement\nREQ-001\n- AC-001: Captcha can be disabled for configured environments.\n');
  writeFileSync(designPath, '# Design\n| Requirement | Design | Acceptance criteria | Verification |\n|---|---|---|---|\n| REQ-001 | Captcha config | AC-001 | Login flow test covers captcha disabled behavior |\n');
  writeFileSync(diffPath, 'diff --git a/src/auth.ts b/src/auth.ts\n');
  writeFileSync(reviewPath, '# Review\nLooks plausible.\n');

  for (const a of [
    { ...artifact('requirement_draft', reqPath), workflowRunId, stepRunId },
    { ...artifact('design_doc', designPath), workflowRunId, stepRunId },
    { ...artifact('diff', diffPath), workflowRunId, stepRunId },
    { ...artifact('other', reviewPath), workflowRunId, stepRunId },
  ]) {
    storeMod.store.artifacts.insert(a);
  }
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
  insertPassingTestGate(workflowRunId, stepRunId);

  const gate = gates.runAcceptanceTraceabilityGate({ workflowRunId, stepRunId });
  const ruleById = Object.fromEntries(gate.ruleResults.map((r) => [r.ruleId, r]));

  expect(gate.status).toBe('fail');
  expect(ruleById['acceptance.test_gate_passed'].status).toBe('pass');
  expect(ruleById['acceptance.business_matrix_present'].status).toBe('fail');
});

test('acceptance traceability gate rejects business matrix without core boundary and exception scenario coverage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ainp-acceptance-matrix-scenarios-'));
  const reqPath = join(dir, 'req.md');
  const designPath = join(dir, 'design.md');
  const diffPath = join(dir, 'diff.diff');
  const reviewPath = join(dir, 'review.md');
  const matrixPath = join(dir, 'verifier-ac-matrix.json');
  const workflowRunId = 'run_acceptance_matrix_missing_scenario';
  const stepRunId = 'step_acceptance_matrix_missing_scenario';
  writeFileSync(
    reqPath,
    [
      '# Requirement',
      'REQ-001',
      '- AC-001: Captcha can be disabled for configured environments.',
      '- AC-002: Captcha remains enabled when the config explicitly requires it.',
    ].join('\n'),
  );
  writeFileSync(
    designPath,
    [
      '# Design',
      '| Requirement | Design | Acceptance criteria | Verification |',
      '|---|---|---|---|',
      '| REQ-001 | Captcha config | AC-001 | Login flow test covers captcha disabled behavior |',
      '| REQ-001 | Captcha config | AC-002 | Login flow test covers captcha enabled boundary behavior |',
    ].join('\n'),
  );
  writeFileSync(diffPath, 'diff --git a/src/auth.ts b/src/auth.ts\n');
  writeFileSync(reviewPath, '# Review\nLooks plausible.\n');

  for (const a of [
    { ...artifact('requirement_draft', reqPath), workflowRunId, stepRunId },
    { ...artifact('design_doc', designPath), workflowRunId, stepRunId },
    { ...artifact('diff', diffPath), workflowRunId, stepRunId },
    { ...artifact('other', reviewPath), workflowRunId, stepRunId },
  ]) {
    storeMod.store.artifacts.insert(a);
  }
  const reqArtifact = storeMod.store.artifacts.byKind(workflowRunId, 'requirement_draft').at(-1)!;
  const designArtifact = storeMod.store.artifacts.byKind(workflowRunId, 'design_doc').at(-1)!;
  writeFileSync(
    matrixPath,
    `${JSON.stringify({
      schemaVersion: VERIFIER_AC_MATRIX_SCHEMA_VERSION,
      workflowRunId,
      stepRunId,
      verifierRequired: false,
      verifierStatus: 'pass',
      acceptanceCriteria: [
        {
          id: 'AC-001',
          text: 'Captcha can be disabled for configured environments.',
          scenarioType: 'core',
          verificationMethod: 'Login flow test proves disabled captcha behavior.',
          businessStatus: 'passed',
          status: 'pass',
          evidenceRefs: [
            { artifactId: reqArtifact.id, claim: 'requirement business behavior for AC-001' },
            { artifactId: designArtifact.id, claim: 'design verification strategy for AC-001' },
          ],
        },
        {
          id: 'AC-002',
          text: 'Captcha remains enabled when the config explicitly requires it.',
          scenarioType: 'boundary',
          verificationMethod: 'Login flow test proves enabled captcha boundary behavior.',
          businessStatus: 'passed',
          status: 'pass',
          evidenceRefs: [
            { artifactId: reqArtifact.id, claim: 'requirement boundary behavior for AC-002' },
            { artifactId: designArtifact.id, claim: 'design verification strategy for AC-002' },
          ],
        },
      ],
      createdAt: new Date().toISOString(),
    }, null, 2)}\n`,
  );
  storeMod.store.artifacts.insert({
    ...artifact('other', matrixPath),
    workflowRunId,
    stepRunId,
    contentType: 'application/json',
    metadata: {
      schemaVersion: VERIFIER_AC_MATRIX_SCHEMA_VERSION,
      reportKind: 'verifier_ac_matrix',
      verifierArtifactType: 'ac_matrix',
    },
  });
  for (const stage of ['requirement', 'design'] as const) {
    insertStepRun(workflowRunId, stage);
  }
  insertPassingTestGate(workflowRunId, stepRunId);

  const gate = gates.runAcceptanceTraceabilityGate({ workflowRunId, stepRunId });
  const ruleById = Object.fromEntries(gate.ruleResults.map((r) => [r.ruleId, r]));

  expect(gate.status).toBe('fail');
  expect(ruleById['acceptance.business_matrix_present'].status).toBe('pass');
  expect(ruleById['acceptance.business_matrix_criteria_proven'].status).toBe('pass');
  expect(ruleById['acceptance.business_matrix_scenarios_present'].status).toBe('fail');
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

function insertWorkflowRun(workflowRunId: string, title: string) {
  const project: Project = {
    id: `proj_${workflowRunId}`,
    name: `project-${workflowRunId}`,
    localPath: tmpdir(),
    language: 'java',
    buildTool: 'maven',
    defaultBranch: 'main',
    registeredAt: new Date().toISOString(),
  };
  storeMod.store.projects.set(project.id, project);
  const run: WorkflowRun = {
    id: workflowRunId,
    projectId: project.id,
    type: 'feature',
    status: 'running',
    currentStage: 'review',
    flowId: 'feature.standard',
    startStage: null,
    configSnapshotId: null,
    sourceBranch: 'main',
    branch: `ai/${workflowRunId}`,
    workspacePath: tmpdir(),
    title,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  storeMod.store.workflowRuns.set(run.id, run);
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

test('acceptance traceability gate does not treat verifier artifacts as review evidence', () => {
  const workflowRunId = 'run_acceptance_trace_verifier_not_review';
  const stepRunId = 'step_acceptance_trace_verifier_not_review';
  const dir = mkdtempSync(join(tmpdir(), 'ainp-verifier-not-review-'));
  const diffPath = join(dir, 'changes.diff');
  const matrixPath = join(dir, 'verifier-ac-matrix.json');
  writeFileSync(diffPath, 'diff --git a/src/main b/src/main\n');
  writeFileSync(
    matrixPath,
    `${JSON.stringify({
      schemaVersion: VERIFIER_AC_MATRIX_SCHEMA_VERSION,
      workflowRunId,
      stepRunId,
      verifierRequired: true,
      verifierStatus: 'blocked',
      acceptanceCriteria: [],
      createdAt: new Date().toISOString(),
    }, null, 2)}\n`,
  );

  for (const a of [
    { ...artifact('diff', diffPath), workflowRunId, stepRunId },
    {
      ...artifact('other', matrixPath),
      workflowRunId,
      stepRunId,
      contentType: 'application/json',
      metadata: {
        schemaVersion: VERIFIER_AC_MATRIX_SCHEMA_VERSION,
        reportKind: 'verifier_ac_matrix',
        verifierArtifactType: 'ac_matrix',
        subStage: 'verifier',
      },
    },
  ]) {
    storeMod.store.artifacts.insert(a);
  }
  insertPassingTestGate(workflowRunId, stepRunId);

  const gate = gates.runAcceptanceTraceabilityGate({ workflowRunId, stepRunId });

  expect(gate.status).toBe('fail');
  const ruleById = Object.fromEntries(gate.ruleResults.map((r) => [r.ruleId, r]));
  expect(ruleById['acceptance.diff_present'].status).toBe('pass');
  expect(ruleById['acceptance.review_present'].status).toBe('fail');
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

test('evidence gate fails when a passing gate has no resolvable evidence', () => {
  const workflowRunId = 'run_evidence_missing_refs';

  storeMod.store.gateRuns.insert({
    id: 'gate_fake_pass',
    gateId: 'requirement_gate',
    workflowRunId,
    stepRunId: null,
    status: 'pass',
    ruleResults: [
      {
        ruleId: 'requirement.fake_pass',
        status: 'pass',
        message: 'claimed pass without evidence',
        evidenceRefs: [],
      },
    ],
    evidenceRefs: [],
    commandRunIds: [],
    decidedAt: new Date().toISOString(),
    agentNote: null,
  });

  const gate = gates.runEvidenceGate({ workflowRunId, stepRunId: null });

  expect(gate.status).toBe('fail');
  const ruleById = Object.fromEntries(gate.ruleResults.map((r) => [r.ruleId, r]));
  expect(ruleById['evidence.pass_rules_have_refs'].status).toBe('fail');
});

test('evidence gate fails when passing compile/test gates lack command evidence', () => {
  const workflowRunId = 'run_evidence_compile_artifact_only';
  const stepRunId = 'step_evidence_compile_artifact_only';
  const dir = mkdtempSync(join(tmpdir(), 'ainp-evidence-artifact-only-'));
  const path = join(dir, 'compile-note.md');
  writeFileSync(path, '# Compile\n\nClaimed success without command evidence.\n');
  const note = { ...artifact('other', path), workflowRunId, stepRunId };
  const evidenceRefs = [{ artifactId: note.id, claim: 'non-command compile note' }];
  storeMod.store.artifacts.insert(note);
  storeMod.store.gateRuns.insert({
    id: 'gate_compile_artifact_only',
    gateId: 'compile_gate',
    workflowRunId,
    stepRunId,
    status: 'pass',
    ruleResults: [
      {
        ruleId: 'compile.exit_zero',
        status: 'pass',
        message: 'compile claimed as passed',
        evidenceRefs,
      },
    ],
    evidenceRefs,
    commandRunIds: [],
    decidedAt: new Date().toISOString(),
    agentNote: null,
  });

  const gate = gates.runEvidenceGate({ workflowRunId, stepRunId });

  expect(gate.status).toBe('fail');
  const ruleById = Object.fromEntries(gate.ruleResults.map((r) => [r.ruleId, r]));
  expect(ruleById['evidence.pass_rules_have_refs'].status).toBe('pass');
  expect(ruleById['evidence.refs_resolve'].status).toBe('pass');
  expect(ruleById['evidence.command_digests_present'].status).toBe('fail');
  expect(ruleById['evidence.command_digests_present'].message).toMatch(/missing command evidence/i);
});

test('evidence gate passes complete digest-backed compile/test/acceptance evidence', () => {
  const workflowRunId = 'run_evidence_complete';
  const stepRunId = 'step_evidence_complete';
  const dir = mkdtempSync(join(tmpdir(), 'ainp-evidence-complete-'));
  const stdout = join(dir, 'stdout.log');
  const stderr = join(dir, 'stderr.log');
  writeFileSync(stdout, 'BUILD SUCCESS\n');
  writeFileSync(stderr, '');

  const diffPath = join(dir, 'changes.diff');
  const reviewPath = join(dir, 'review.md');
  const surefirePath = join(dir, 'TEST-demo.xml');
  writeFileSync(diffPath, 'diff --git a/src/main b/src/main\n');
  writeFileSync(reviewPath, '# Review\nVerified\n');
  writeFileSync(surefirePath, '<testsuite tests="1" failures="0" errors="0" skipped="0"></testsuite>\n');

  for (const a of [
    { ...artifact('diff', diffPath), workflowRunId, stepRunId },
    { ...artifact('other', reviewPath), workflowRunId, stepRunId },
    { ...artifact('surefire_report', surefirePath), workflowRunId, stepRunId, contentType: 'application/xml' },
  ]) {
    storeMod.store.artifacts.insert(a);
  }
  for (const stage of ['implementation', 'build_test', 'review'] as const) {
    insertStepRun(workflowRunId, stage);
  }
  storeMod.store.commandRuns.set('cmd_evidence_compile', {
    id: 'cmd_evidence_compile',
    workflowRunId,
    stepRunId,
    cwd: dir,
    command: 'mvn -B -DskipTests compile',
    stage: 'compile',
    status: 'passed',
    exitCode: 0,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 1,
    stdoutRef: `file://${stdout}`,
    stderrRef: `file://${stderr}`,
    stdoutBytes: 14,
    stderrBytes: 0,
    stdoutSha256: sha256(readFileSync(stdout)),
    stderrSha256: sha256(readFileSync(stderr)),
    combinedSha256: sha256('compile-combined'),
    timedOut: false,
    truncated: false,
  });
  storeMod.store.commandRuns.set('cmd_evidence_test', {
    id: 'cmd_evidence_test',
    workflowRunId,
    stepRunId,
    cwd: dir,
    command: 'mvn -B test',
    stage: 'test',
    status: 'passed',
    exitCode: 0,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 1,
    stdoutRef: `file://${stdout}`,
    stderrRef: `file://${stderr}`,
    stdoutBytes: 14,
    stderrBytes: 0,
    stdoutSha256: sha256(readFileSync(stdout)),
    stderrSha256: sha256(readFileSync(stderr)),
    combinedSha256: sha256('test-combined'),
    timedOut: false,
    truncated: false,
  });
  gates.runCompileGate({
    workflowRunId,
    stepRunId,
    buildRun: {
      id: 'build_evidence_complete',
      workflowRunId,
      stepRunId,
      language: 'java',
      buildTool: 'maven',
      jdkVersion: '1.8',
      mavenCommand: 'mvn -B -DskipTests compile && mvn -B test',
      status: 'passed',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      commandRunIds: ['cmd_evidence_compile', 'cmd_evidence_test'],
      artifactIds: [],
    },
  });
  gates.runTestGate({
    workflowRunId,
    stepRunId,
    buildRun: {
      id: 'build_evidence_complete',
      workflowRunId,
      stepRunId,
      language: 'java',
      buildTool: 'maven',
      jdkVersion: '1.8',
      mavenCommand: 'mvn -B -DskipTests compile && mvn -B test',
      status: 'passed',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      commandRunIds: ['cmd_evidence_compile', 'cmd_evidence_test'],
      artifactIds: [],
    },
    testRuns: [{
      id: 'test_evidence_complete',
      buildRunId: 'build_evidence_complete',
      framework: 'maven-surefire',
      total: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
      errors: 0,
      reportArtifactIds: storeMod.store.artifacts.byKind(workflowRunId, 'surefire_report').map((a) => a.id),
    }],
    surefireAggregate: {
      framework: 'maven-surefire',
      total: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
      errors: 0,
      suites: [],
      reportPaths: [`file://${surefirePath}`],
    },
  });
  gates.runAcceptanceTraceabilityGate({ workflowRunId, stepRunId });

  const gate = gates.runEvidenceGate({ workflowRunId, stepRunId });

  expect(gate.status).toBe('pass');
  const ruleById = Object.fromEntries(gate.ruleResults.map((r) => [r.ruleId, r]));
  expect(ruleById['evidence.pass_rules_have_refs'].status).toBe('pass');
  expect(ruleById['evidence.refs_resolve'].status).toBe('pass');
  expect(ruleById['evidence.command_digests_present'].status).toBe('pass');
  expect(ruleById['evidence.acceptance_has_execution_evidence'].status).toBe('pass');
});

test('evidence gate fails UI runs when verifier matrix and media refs are missing', () => {
  const workflowRunId = 'run_ui_verifier_missing';
  insertWorkflowRun(workflowRunId, 'Update frontend UI button state');

  const gate = gates.runEvidenceGate({ workflowRunId, stepRunId: null });

  expect(gate.status).toBe('fail');
  const ruleById = Object.fromEntries(gate.ruleResults.map((r) => [r.ruleId, r]));
  expect(ruleById['evidence.ui_verifier_matrix_present'].status).toBe('fail');
  expect(ruleById['evidence.ui_verifier_media_refs_present'].status).toBe('fail');
  expect(ruleById['evidence.ui_verifier_artifact_digests_present'].status).toBe('fail');
});

test('evidence gate accepts UI verifier AC matrix with before and after screenshot artifacts', () => {
  const workflowRunId = 'run_ui_verifier_complete';
  const stepRunId = 'step_ui_verifier_complete';
  insertWorkflowRun(workflowRunId, 'Polish web UI settings page');
  const dir = mkdtempSync(join(tmpdir(), 'ainp-ui-verifier-complete-'));
  const beforePath = join(dir, 'AC-001-before.png');
  const afterPath = join(dir, 'AC-001-after.png');
  const matrixPath = join(dir, 'verifier-ac-matrix.json');
  writeFileSync(beforePath, 'before screenshot bytes');
  writeFileSync(afterPath, 'after screenshot bytes');

  const before = {
    ...artifact('other', beforePath),
    workflowRunId,
    stepRunId,
    contentType: 'image/png',
    metadata: {
      schemaVersion: VERIFIER_MEDIA_SCHEMA_VERSION,
      reportKind: 'verifier_media',
      verifierArtifactType: 'screenshot_before',
    },
  };
  const after = {
    ...artifact('other', afterPath),
    workflowRunId,
    stepRunId,
    contentType: 'image/png',
    metadata: {
      schemaVersion: VERIFIER_MEDIA_SCHEMA_VERSION,
      reportKind: 'verifier_media',
      verifierArtifactType: 'screenshot_after',
    },
  };
  storeMod.store.artifacts.insert(before);
  storeMod.store.artifacts.insert(after);

  writeFileSync(
    matrixPath,
    `${JSON.stringify({
      schemaVersion: VERIFIER_AC_MATRIX_SCHEMA_VERSION,
      workflowRunId,
      stepRunId,
      verifierRequired: true,
      verifierStatus: 'pass',
      acceptanceCriteria: [
        {
          id: 'AC-001',
          status: 'pass',
          evidenceRefs: [
            { artifactId: before.id, role: 'screenshot_before', claim: 'before screenshot' },
            { artifactId: after.id, role: 'screenshot_after', claim: 'after screenshot' },
          ],
        },
      ],
      createdAt: new Date().toISOString(),
    }, null, 2)}\n`,
  );
  const matrix = {
    ...artifact('other', matrixPath),
    workflowRunId,
    stepRunId,
    contentType: 'application/json',
    metadata: {
      schemaVersion: VERIFIER_AC_MATRIX_SCHEMA_VERSION,
      reportKind: 'verifier_ac_matrix',
      verifierRequired: true,
      verifierArtifactType: 'ac_matrix',
    },
  };
  storeMod.store.artifacts.insert(matrix);

  const gate = gates.runEvidenceGate({ workflowRunId, stepRunId });

  expect(gate.status).toBe('pass');
  const ruleById = Object.fromEntries(gate.ruleResults.map((r) => [r.ruleId, r]));
  expect(ruleById['evidence.ui_verifier_matrix_present'].status).toBe('pass');
  expect(ruleById['evidence.ui_verifier_media_refs_present'].status).toBe('pass');
  expect(ruleById['evidence.ui_verifier_artifact_digests_present'].status).toBe('pass');
  expect(ruleById['evidence.ui_verifier_media_refs_present'].evidenceRefs.map((ref) => ref.artifactId))
    .toEqual(expect.arrayContaining([before.id, after.id, matrix.id]));
});

test('evidence gate rejects verifier matrix refs to untagged image artifacts', () => {
  const workflowRunId = 'run_ui_verifier_untagged_images';
  const stepRunId = 'step_ui_verifier_untagged_images';
  insertWorkflowRun(workflowRunId, 'Update browser UI image preview');
  const dir = mkdtempSync(join(tmpdir(), 'ainp-ui-verifier-untagged-'));
  const beforePath = join(dir, 'before.png');
  const afterPath = join(dir, 'after.png');
  const matrixPath = join(dir, 'verifier-ac-matrix.json');
  writeFileSync(beforePath, 'before screenshot bytes');
  writeFileSync(afterPath, 'after screenshot bytes');

  const before = {
    ...artifact('other', beforePath),
    workflowRunId,
    stepRunId,
    contentType: 'image/png',
    metadata: {},
  };
  const after = {
    ...artifact('other', afterPath),
    workflowRunId,
    stepRunId,
    contentType: 'image/png',
    metadata: {},
  };
  storeMod.store.artifacts.insert(before);
  storeMod.store.artifacts.insert(after);

  writeFileSync(
    matrixPath,
    `${JSON.stringify({
      schemaVersion: VERIFIER_AC_MATRIX_SCHEMA_VERSION,
      workflowRunId,
      stepRunId,
      verifierRequired: true,
      verifierStatus: 'pass',
      acceptanceCriteria: [
        {
          id: 'AC-001',
          status: 'pass',
          evidenceRefs: [
            { artifactId: before.id, role: 'screenshot_before', claim: 'before screenshot' },
            { artifactId: after.id, role: 'screenshot_after', claim: 'after screenshot' },
          ],
        },
      ],
      createdAt: new Date().toISOString(),
    }, null, 2)}\n`,
  );
  const matrix = {
    ...artifact('other', matrixPath),
    workflowRunId,
    stepRunId,
    contentType: 'application/json',
    metadata: {
      schemaVersion: VERIFIER_AC_MATRIX_SCHEMA_VERSION,
      reportKind: 'verifier_ac_matrix',
      verifierRequired: true,
      verifierArtifactType: 'ac_matrix',
    },
  };
  storeMod.store.artifacts.insert(matrix);

  const gate = gates.runEvidenceGate({ workflowRunId, stepRunId });

  expect(gate.status).toBe('fail');
  const ruleById = Object.fromEntries(gate.ruleResults.map((r) => [r.ruleId, r]));
  expect(ruleById['evidence.ui_verifier_matrix_present'].status).toBe('pass');
  expect(ruleById['evidence.ui_verifier_media_refs_present'].status).toBe('fail');
});

// ---------------------------------------------------------------------------
// T3.2: test_gate `test.surefire_present` conditional degrade. Custom test
// command projects (no surefire XML) get `warn` when the test command exited
// 0; everything else keeps the hard fail.
// ---------------------------------------------------------------------------

function insertRunWithBuildCommands(
  workflowRunId: string,
  buildTestCommand: string | null,
): void {
  const project: Project = {
    id: `proj_${workflowRunId}`,
    name: `project-${workflowRunId}`,
    localPath: tmpdir(),
    language: 'java',
    buildTool: 'maven',
    buildCompileCommand: null,
    buildTestCommand,
    defaultBranch: 'main',
    registeredAt: new Date().toISOString(),
  };
  storeMod.store.projects.set(project.id, project);
  const run: WorkflowRun = {
    id: workflowRunId,
    projectId: project.id,
    type: 'feature',
    status: 'running',
    currentStage: 'build_test',
    flowId: 'feature.standard',
    startStage: null,
    configSnapshotId: null,
    sourceBranch: 'main',
    branch: `ai/${workflowRunId}`,
    workspacePath: tmpdir(),
    title: 'custom build command run',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  storeMod.store.workflowRuns.set(run.id, run);
}

function runTestGateWithoutReports(
  workflowRunId: string,
  command: string,
  exitCode: number,
): import('@ainp/shared').GateRun {
  const cmdId = `cmd_${workflowRunId}`;
  storeMod.store.commandRuns.set(cmdId, {
    id: cmdId,
    workflowRunId,
    stepRunId: null,
    cwd: '/tmp',
    command,
    stage: 'test',
    status: exitCode === 0 ? 'passed' : 'failed',
    exitCode,
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
  return gates.runTestGate({
    workflowRunId,
    stepRunId: null,
    buildRun: {
      id: `build_${workflowRunId}`,
      workflowRunId,
      stepRunId: null,
      language: 'java',
      buildTool: 'maven',
      jdkVersion: '1.8',
      mavenCommand: command,
      status: exitCode === 0 ? 'passed' : 'failed',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      commandRunIds: [cmdId],
      artifactIds: [],
    },
    testRuns: [],
    surefireAggregate: null,
  });
}

test('test_gate degrades surefire_present to warn for custom test command with exit 0 and no reports', () => {
  const workflowRunId = 'run_custom_cmd_exit0';
  insertRunWithBuildCommands(workflowRunId, 'gradle test');

  const gate = runTestGateWithoutReports(workflowRunId, 'gradle test', 0);

  expect(gate.status).toBe('warn');
  const ruleById = Object.fromEntries(gate.ruleResults.map((r) => [r.ruleId, r]));
  expect(ruleById['test.exit_zero'].status).toBe('pass');
  expect(ruleById['test.surefire_present'].status).toBe('warn');
  expect(ruleById['test.surefire_present'].message).toBe(
    'no structured test report (custom test command)',
  );
  expect(ruleById['test.surefire_present'].evidenceRefs.length).toBeGreaterThan(0);
});

test('test_gate keeps surefire_present fail for custom test command with non-zero exit', () => {
  const workflowRunId = 'run_custom_cmd_exit1';
  insertRunWithBuildCommands(workflowRunId, 'gradle test');

  const gate = runTestGateWithoutReports(workflowRunId, 'gradle test', 1);

  expect(gate.status).toBe('fail');
  const ruleById = Object.fromEntries(gate.ruleResults.map((r) => [r.ruleId, r]));
  expect(ruleById['test.exit_zero'].status).toBe('fail');
  expect(ruleById['test.surefire_present'].status).toBe('fail');
  expect(ruleById['test.surefire_present'].message).toBe('no Surefire reports parsed');
});

test('test_gate keeps surefire_present fail on the default Maven path without reports', () => {
  const workflowRunId = 'run_default_maven_no_reports';
  insertRunWithBuildCommands(workflowRunId, null);

  const gate = runTestGateWithoutReports(workflowRunId, 'mvn -B test', 0);

  expect(gate.status).toBe('fail');
  const ruleById = Object.fromEntries(gate.ruleResults.map((r) => [r.ruleId, r]));
  expect(ruleById['test.exit_zero'].status).toBe('pass');
  expect(ruleById['test.surefire_present'].status).toBe('fail');
  expect(ruleById['test.surefire_present'].message).toBe('no Surefire reports parsed');
});
