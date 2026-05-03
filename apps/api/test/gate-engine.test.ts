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
