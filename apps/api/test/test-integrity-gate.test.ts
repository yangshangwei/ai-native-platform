import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, expect, test } from 'vitest';
import {
  TEST_SURFACE_REPORT_SCHEMA_VERSION,
  newId,
  nowIso,
  type Artifact,
  type Project,
  type TestSurfaceCounts,
  type TestSurfaceReport,
} from '@ainp/shared';

process.env.AINP_DB_PATH = join(mkdtempSync(join(tmpdir(), 'ainp-test-integrity-')), 'ainp.sqlite');

let app: Awaited<typeof import('../src/app')>['app'];
let gates: typeof import('../src/gate-engine');
let workflow: typeof import('../src/workflow-engine');
let storeMod: typeof import('../src/store/store');

beforeAll(async () => {
  ({ app } = await import('../src/app'));
  gates = await import('../src/gate-engine');
  workflow = await import('../src/workflow-engine');
  storeMod = await import('../src/store/store');
});

const reportDir = mkdtempSync(join(tmpdir(), 'ainp-test-surface-reports-'));
let reportSeq = 0;

function counts(overrides: Partial<TestSurfaceCounts> = {}): TestSurfaceCounts {
  return { testCases: 3, assertions: 6, skipMarkers: 0, commentedTests: 0, ...overrides };
}

function baseReport(overrides: Partial<TestSurfaceReport> = {}): TestSurfaceReport {
  return {
    schemaVersion: TEST_SURFACE_REPORT_SCHEMA_VERSION,
    baseRef: 'abc123',
    files: [],
    harness: { changedPaths: [], pomTestConfigChanged: false },
    baselineAvailable: true,
    notes: [],
    ...overrides,
  };
}

function reportArtifact(body: string): Artifact {
  const path = join(reportDir, `test-surface-report-${reportSeq++}.json`);
  writeFileSync(path, body, 'utf8');
  return {
    id: `art_tsr_${Math.random().toString(16).slice(2)}`,
    kind: 'test_surface_report',
    uri: `file://${path}`,
    workflowRunId: 'run_test_integrity',
    stepRunId: null,
    size: Buffer.byteLength(body, 'utf8'),
    contentType: 'application/json',
    sha256: null,
    createdAt: new Date().toISOString(),
    metadata: {},
  };
}

function runGate(report: TestSurfaceReport) {
  return gates.runTestIntegrityGate({
    workflowRunId: 'run_test_integrity',
    stepRunId: null,
    reportArtifact: reportArtifact(`${JSON.stringify(report)}\n`),
  });
}

function ruleById(gate: { ruleResults: Array<{ ruleId: string; status: string; message: string }> }) {
  return Object.fromEntries(gate.ruleResults.map((r) => [r.ruleId, r]));
}

// ---- AC-001: deleted test files --------------------------------------------

test('deleting a test file fails integrity.test_files_deleted and names the file', () => {
  const gate = runGate(baseReport({
    files: [
      { path: 'src/test/java/sample/CalculatorTest.java', status: 'deleted', before: counts() },
    ],
  }));
  expect(gate.status).toBe('fail');
  const rules = ruleById(gate);
  expect(rules['integrity.test_files_deleted'].status).toBe('fail');
  expect(rules['integrity.test_files_deleted'].message).toContain(
    'src/test/java/sample/CalculatorTest.java',
  );
});

test('renaming a test file out of src/test counts as a deletion', () => {
  const gate = runGate(baseReport({
    files: [
      {
        path: 'src/main/java/sample/CalculatorTest.java',
        oldPath: 'src/test/java/sample/CalculatorTest.java',
        status: 'renamed',
        before: counts(),
      },
    ],
  }));
  expect(ruleById(gate)['integrity.test_files_deleted'].status).toBe('fail');
});

// ---- AC-002: removed test cases ---------------------------------------------

test('removing @Test methods in a kept file fails with before/after counts', () => {
  const gate = runGate(baseReport({
    files: [
      {
        path: 'src/test/java/sample/CalculatorTest.java',
        status: 'modified',
        before: counts({ testCases: 5 }),
        after: counts({ testCases: 3 }),
      },
    ],
  }));
  expect(gate.status).toBe('fail');
  const rule = ruleById(gate)['integrity.test_cases_removed'];
  expect(rule.status).toBe('fail');
  expect(rule.message).toContain('@Test 5 -> 3');
});

// ---- AC-003: weakened assertions --------------------------------------------

test('stable case count with fewer assertions fails integrity.assertions_weakened', () => {
  const gate = runGate(baseReport({
    files: [
      {
        path: 'src/test/java/sample/CalculatorTest.java',
        status: 'modified',
        before: counts({ testCases: 3, assertions: 8 }),
        after: counts({ testCases: 3, assertions: 4 }),
      },
    ],
  }));
  const rules = ruleById(gate);
  expect(rules['integrity.assertions_weakened'].status).toBe('fail');
  expect(rules['integrity.assertions_weakened'].message).toContain('assertions 8 -> 4');
  // The case-removal rule stays green — only assertions dropped.
  expect(rules['integrity.test_cases_removed'].status).toBe('pass');
});

test('assertion drops in files already flagged for case removal are not double-reported', () => {
  const gate = runGate(baseReport({
    files: [
      {
        path: 'src/test/java/sample/CalculatorTest.java',
        status: 'modified',
        before: counts({ testCases: 5, assertions: 10 }),
        after: counts({ testCases: 3, assertions: 5 }),
      },
    ],
  }));
  const rules = ruleById(gate);
  expect(rules['integrity.test_cases_removed'].status).toBe('fail');
  expect(rules['integrity.assertions_weakened'].status).toBe('pass');
});

// ---- AC-004: added skip markers ----------------------------------------------

test('adding @Disabled/@Ignore markers fails integrity.skip_markers_added', () => {
  const gate = runGate(baseReport({
    files: [
      {
        path: 'src/test/java/sample/CalculatorTest.java',
        status: 'modified',
        before: counts({ skipMarkers: 0 }),
        after: counts({ skipMarkers: 2 }),
      },
    ],
  }));
  expect(ruleById(gate)['integrity.skip_markers_added'].status).toBe('fail');
});

test('commenting out a @Test also fails integrity.skip_markers_added', () => {
  const gate = runGate(baseReport({
    files: [
      {
        path: 'src/test/java/sample/CalculatorTest.java',
        status: 'modified',
        before: counts({ commentedTests: 0 }),
        after: counts({ commentedTests: 1 }),
      },
    ],
  }));
  const rule = ruleById(gate)['integrity.skip_markers_added'];
  expect(rule.status).toBe('fail');
  expect(rule.message).toContain('commented @Test 0 -> 1');
});

// ---- AC-005: harness config --------------------------------------------------

test('pom surefire/skip config change fails integrity.harness_config_modified', () => {
  const gate = runGate(baseReport({
    harness: { changedPaths: [], pomTestConfigChanged: true },
  }));
  const rule = ruleById(gate)['integrity.harness_config_modified'];
  expect(rule.status).toBe('fail');
  expect(rule.message).toContain('pom.xml');
});

test('mvnw / .mvn changes fail integrity.harness_config_modified', () => {
  const gate = runGate(baseReport({
    harness: { changedPaths: ['mvnw', '.mvn/wrapper/maven-wrapper.properties'], pomTestConfigChanged: false },
  }));
  const rule = ruleById(gate)['integrity.harness_config_modified'];
  expect(rule.status).toBe('fail');
  expect(rule.message).toContain('mvnw');
});

test('a pom edit that leaves the test config extract unchanged passes the harness rule', () => {
  const gate = runGate(baseReport({
    harness: { changedPaths: [], pomTestConfigChanged: false },
  }));
  expect(ruleById(gate)['integrity.harness_config_modified'].status).toBe('pass');
});

// ---- AC-006: additions never violate ------------------------------------------

test('adding test files, cases, and assertions passes every rule', () => {
  const gate = runGate(baseReport({
    files: [
      {
        path: 'src/test/java/sample/NewFeatureTest.java',
        status: 'added',
        after: counts({ testCases: 4, assertions: 9 }),
      },
      {
        path: 'src/test/java/sample/CalculatorTest.java',
        status: 'modified',
        before: counts({ testCases: 3, assertions: 6 }),
        after: counts({ testCases: 5, assertions: 10 }),
      },
    ],
  }));
  expect(gate.status).toBe('pass');
  expect(gate.ruleResults.every((r) => r.status === 'pass' || r.status === 'skipped')).toBe(true);
});

test('a renamed test file with an unchanged surface passes', () => {
  const gate = runGate(baseReport({
    files: [
      {
        path: 'src/test/java/sample/RenamedTest.java',
        oldPath: 'src/test/java/sample/OriginalTest.java',
        status: 'renamed',
        before: counts(),
        after: counts(),
      },
    ],
  }));
  expect(gate.status).toBe('pass');
});

test('a file renamed INTO src/test (no baseline counts) is an addition, not a skip', () => {
  const gate = runGate(baseReport({
    files: [
      {
        path: 'src/test/java/sample/PromotedTest.java',
        oldPath: 'src/main/java/sample/PromotedTest.java',
        status: 'renamed',
        // no `before`: the old path was not a test file
        after: counts(),
      },
    ],
  }));
  expect(gate.status).toBe('pass');
  const rules = ruleById(gate);
  expect(rules['integrity.test_files_deleted'].status).toBe('pass');
  expect(rules['integrity.test_cases_removed'].status).toBe('pass');
  expect(rules['integrity.assertions_weakened'].status).toBe('pass');
  expect(rules['integrity.skip_markers_added'].status).toBe('pass');
});

// ---- AC-007: fail-open ---------------------------------------------------------

test('baseline unavailable skips every rule with a not applicable prefix', () => {
  const gate = runGate(baseReport({
    baseRef: null,
    baselineAvailable: false,
    notes: ['git rev-parse HEAD failed'],
  }));
  expect(gate.status).toBe('pass');
  expect(gate.ruleResults).toHaveLength(5);
  for (const rule of gate.ruleResults) {
    expect(rule.status).toBe('skipped');
    expect(rule.message.startsWith('not applicable:')).toBe(true);
  }
});

test('missing report artifact fails open (all rules skipped)', () => {
  const gate = gates.runTestIntegrityGate({
    workflowRunId: 'run_test_integrity',
    stepRunId: null,
    reportArtifact: null,
  });
  expect(gate.status).toBe('pass');
  for (const rule of gate.ruleResults) {
    expect(rule.status).toBe('skipped');
    expect(rule.message.startsWith('not applicable:')).toBe(true);
  }
});

test('unparsable report JSON fails open', () => {
  const gate = gates.runTestIntegrityGate({
    workflowRunId: 'run_test_integrity',
    stepRunId: null,
    reportArtifact: reportArtifact('{not json'),
  });
  expect(gate.status).toBe('pass');
  expect(gate.ruleResults.every((r) => r.status === 'skipped')).toBe(true);
});

test('unknown schemaVersion fails open', () => {
  const gate = gates.runTestIntegrityGate({
    workflowRunId: 'run_test_integrity',
    stepRunId: null,
    reportArtifact: reportArtifact(JSON.stringify({ schemaVersion: 'test-surface-report/v2' })),
  });
  expect(gate.status).toBe('pass');
  expect(gate.ruleResults.every((r) => r.status === 'skipped')).toBe(true);
});

test('kept file missing before/after counts skips the kept-file rules without failing', () => {
  const gate = runGate(baseReport({
    files: [
      {
        path: 'src/test/java/sample/CalculatorTest.java',
        status: 'modified',
        before: counts(),
        // after missing: workspace read failed on the collector side
      },
    ],
  }));
  const rules = ruleById(gate);
  expect(gate.status).toBe('pass');
  expect(rules['integrity.test_cases_removed'].status).toBe('skipped');
  expect(rules['integrity.test_cases_removed'].message.startsWith('not applicable:')).toBe(true);
  expect(rules['integrity.assertions_weakened'].status).toBe('skipped');
  expect(rules['integrity.skip_markers_added'].status).toBe('skipped');
  // deletion + harness rules are still decidable
  expect(rules['integrity.test_files_deleted'].status).toBe('pass');
  expect(rules['integrity.harness_config_modified'].status).toBe('pass');
});

// ---- AC-009 / run-gate route case ----------------------------------------------

test('runner run-gate API resolves the latest test_surface_report artifact', async () => {
  const project: Project = {
    id: newId('proj'),
    name: `test-integrity-project-${Date.now()}`,
    localPath: '/tmp/test-integrity-project',
    language: 'java',
    buildTool: 'maven',
    defaultBranch: 'main',
    registeredAt: nowIso(),
  };
  storeMod.store.projects.set(project.id, project);
  const run = workflow.createWorkflowRun({
    projectId: project.id,
    type: 'feature',
    title: 'test integrity route test',
  });

  const body = `${JSON.stringify(baseReport({
    files: [
      { path: 'src/test/java/sample/CalculatorTest.java', status: 'deleted', before: counts() },
    ],
  }))}\n`;
  const path = join(reportDir, 'route-test-surface-report.json');
  writeFileSync(path, body, 'utf8');
  workflow.createArtifact({
    workflowRunId: run.id,
    stepRunId: null,
    kind: 'test_surface_report',
    uri: `file://${path}`,
    size: Buffer.byteLength(body, 'utf8'),
    contentType: 'application/json',
  });

  const res = await app.request('/runner/events/run-gate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowRunId: run.id,
      stepRunId: null,
      gateId: 'test_integrity_gate',
    }),
  });

  expect(res.status).toBe(200);
  const payload = (await res.json()) as {
    gate: {
      gateId: string;
      status: string;
      evidenceRefs: Array<{ artifactId: string }>;
      ruleResults: Array<{ ruleId: string; status: string; evidenceRefs: Array<{ artifactId: string }> }>;
    };
  };
  expect(payload.gate.gateId).toBe('test_integrity_gate');
  expect(payload.gate.status).toBe('fail');
  const deletedRule = payload.gate.ruleResults.find((r) => r.ruleId === 'integrity.test_files_deleted');
  expect(deletedRule?.status).toBe('fail');
  // AC-009: gate evidence resolves to the persisted report artifact (with sha256).
  const evidenceArtifactId = deletedRule?.evidenceRefs[0]?.artifactId;
  expect(evidenceArtifactId).toBeTruthy();
  const persisted = storeMod.store.artifacts.get(evidenceArtifactId!);
  expect(persisted?.kind).toBe('test_surface_report');
  expect(persisted?.sha256).toBeTruthy();
});
