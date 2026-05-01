import {
  newId,
  nowIso,
  type Artifact,
  type BuildRun,
  type CommandRunId,
  type GateRun,
  type RuleResult,
  type SurefireAggregate,
  type TestRun,
  type WorkflowRunId,
  type StepRunId,
  type EvidenceRef,
} from '@ainp/shared';
import { store } from './store/store';

/**
 * Gate Engine — the only thing that decides Gate pass/warn/fail.
 *
 * Rules consume CommandRuns / TestRuns / Artifacts that the platform already
 * trusts; Agents may attach a note but never set the status. Each rule emits
 * a `RuleResult` carrying its evidence; the gate's overall status is the
 * worst of (fail > warn > pass).
 */

function worst(results: RuleResult[]): GateRun['status'] {
  if (results.some((r) => r.status === 'fail')) return 'fail';
  if (results.some((r) => r.status === 'warn')) return 'warn';
  return 'pass';
}

function record(
  workflowRunId: WorkflowRunId,
  stepRunId: StepRunId | null,
  gateId: GateRun['gateId'],
  results: RuleResult[],
  commandRunIds: CommandRunId[] = [],
  agentNote: string | null = null,
): GateRun {
  const evidenceRefs: EvidenceRef[] = results.flatMap((r) => r.evidenceRefs);
  const gate: GateRun = {
    id: newId('gate'),
    gateId,
    workflowRunId,
    stepRunId,
    status: worst(results),
    ruleResults: results,
    evidenceRefs,
    commandRunIds,
    decidedAt: nowIso(),
    agentNote,
  };
  store.gateRuns.insert(gate);
  store.auditLog.insert({
    id: newId('audit'),
    workflowRunId,
    kind: 'gate.recorded',
    payload: { gateId, status: gate.status },
    at: nowIso(),
  });
  return gate;
}

// ---- Compile Gate ----------------------------------------------------------

export function runCompileGate(params: {
  workflowRunId: WorkflowRunId;
  stepRunId: StepRunId | null;
  buildRun: BuildRun;
}): GateRun {
  const cmds = params.buildRun.commandRunIds
    .map((id) => store.commandRuns.get(id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));

  const compileCmd = cmds.find((c) => c.stage === 'compile') ?? cmds[0];
  const results: RuleResult[] = [];

  if (!compileCmd) {
    results.push({
      ruleId: 'compile.command_present',
      status: 'fail',
      message: 'no compile CommandRun on this build',
      evidenceRefs: [],
    });
  } else {
    const evidence: EvidenceRef[] = [
      { artifactId: compileCmd.id, claim: `${compileCmd.command} -> exit=${compileCmd.exitCode}` },
    ];
    results.push({
      ruleId: 'compile.exit_zero',
      status: compileCmd.exitCode === 0 ? 'pass' : 'fail',
      message: `exit code ${compileCmd.exitCode}`,
      evidenceRefs: evidence,
    });
    results.push({
      ruleId: 'compile.no_timeout',
      status: compileCmd.timedOut ? 'fail' : 'pass',
      message: compileCmd.timedOut ? 'command timed out' : 'within timeout',
      evidenceRefs: evidence,
    });
  }

  return record(
    params.workflowRunId,
    params.stepRunId,
    'compile_gate',
    results,
    params.buildRun.commandRunIds,
  );
}

// ---- Test Gate -------------------------------------------------------------

export function runTestGate(params: {
  workflowRunId: WorkflowRunId;
  stepRunId: StepRunId | null;
  buildRun: BuildRun;
  testRuns: TestRun[];
  surefireAggregate: SurefireAggregate | null;
}): GateRun {
  const cmds = params.buildRun.commandRunIds
    .map((id) => store.commandRuns.get(id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));
  const testCmd = cmds.find((c) => c.stage === 'test') ?? cmds[cmds.length - 1];
  const results: RuleResult[] = [];

  if (!testCmd) {
    results.push({
      ruleId: 'test.command_present',
      status: 'fail',
      message: 'no test CommandRun on this build',
      evidenceRefs: [],
    });
  } else {
    const cmdEvidence: EvidenceRef[] = [
      { artifactId: testCmd.id, claim: `${testCmd.command} -> exit=${testCmd.exitCode}` },
    ];
    results.push({
      ruleId: 'test.exit_zero',
      status: testCmd.exitCode === 0 ? 'pass' : 'fail',
      message: `exit code ${testCmd.exitCode}`,
      evidenceRefs: cmdEvidence,
    });
    results.push({
      ruleId: 'test.no_timeout',
      status: testCmd.timedOut ? 'fail' : 'pass',
      message: testCmd.timedOut ? 'command timed out' : 'within timeout',
      evidenceRefs: cmdEvidence,
    });
  }

  if (!params.surefireAggregate) {
    results.push({
      ruleId: 'test.surefire_present',
      status: 'fail',
      message: 'no Surefire reports parsed',
      evidenceRefs: [],
    });
  } else {
    const reportEvidence: EvidenceRef[] = params.testRuns.flatMap((tr) =>
      tr.reportArtifactIds.map((aid) => ({
        artifactId: aid,
        claim: `surefire suite (passed=${tr.passed}, failed=${tr.failed}, errors=${tr.errors})`,
      })),
    );
    results.push({
      ruleId: 'test.failures_zero',
      status: params.surefireAggregate.failed === 0 ? 'pass' : 'fail',
      message: `${params.surefireAggregate.failed} failures`,
      evidenceRefs: reportEvidence,
    });
    results.push({
      ruleId: 'test.errors_zero',
      status: params.surefireAggregate.errors === 0 ? 'pass' : 'fail',
      message: `${params.surefireAggregate.errors} errors`,
      evidenceRefs: reportEvidence,
    });
    results.push({
      ruleId: 'test.required_not_all_skipped',
      status:
        params.surefireAggregate.total > 0 && params.surefireAggregate.skipped === params.surefireAggregate.total
          ? 'warn'
          : 'pass',
      message:
        params.surefireAggregate.total === 0
          ? 'no tests'
          : `${params.surefireAggregate.passed} passed / ${params.surefireAggregate.total}`,
      evidenceRefs: reportEvidence,
    });
  }

  return record(
    params.workflowRunId,
    params.stepRunId,
    'test_gate',
    results,
    params.buildRun.commandRunIds,
  );
}

// ---- Light-weight rule-based gates ----------------------------------------

export function runArtifactPresenceGate(params: {
  workflowRunId: WorkflowRunId;
  stepRunId: StepRunId | null;
  gateId: GateRun['gateId'];
  artifact: Artifact | null;
  ruleId: string;
  description: string;
}): GateRun {
  const results: RuleResult[] = [
    {
      ruleId: params.ruleId,
      status: params.artifact ? 'pass' : 'fail',
      message: params.artifact
        ? `${params.description} present (${params.artifact.id})`
        : `${params.description} missing`,
      evidenceRefs: params.artifact
        ? [{ artifactId: params.artifact.id, claim: params.description }]
        : [],
    },
  ];
  return record(params.workflowRunId, params.stepRunId, params.gateId, results);
}

export function runDiffScopeGate(params: {
  workflowRunId: WorkflowRunId;
  stepRunId: StepRunId | null;
  changedFiles: string[];
  /** Globs (simple prefix match) the agent is allowed to write to. */
  allowedPrefixes: string[];
  diffArtifact: Artifact | null;
}): GateRun {
  const evidence: EvidenceRef[] = params.diffArtifact
    ? [{ artifactId: params.diffArtifact.id, claim: 'changed files list' }]
    : [];
  const offenders = params.changedFiles.filter(
    (p) => !params.allowedPrefixes.some((pfx) => p.startsWith(pfx)),
  );
  const results: RuleResult[] = [
    {
      ruleId: 'diff_scope.within_allowed',
      status: offenders.length === 0 ? 'pass' : 'fail',
      message:
        offenders.length === 0
          ? `${params.changedFiles.length} files, all within allowed prefixes`
          : `outside scope: ${offenders.slice(0, 5).join(', ')}${offenders.length > 5 ? '…' : ''}`,
      evidenceRefs: evidence,
    },
  ];
  return record(params.workflowRunId, params.stepRunId, 'diff_scope_gate', results);
}

export function runSensitiveChangeGate(params: {
  workflowRunId: WorkflowRunId;
  stepRunId: StepRunId | null;
  changedFiles: string[];
  diffArtifact: Artifact | null;
}): GateRun {
  const sensitivePatterns = [/pom\.xml$/, /\.gitignore$/, /security/i, /secrets?/i, /\.env/i];
  const hits = params.changedFiles.filter((p) => sensitivePatterns.some((re) => re.test(p)));
  const evidence: EvidenceRef[] = params.diffArtifact
    ? [{ artifactId: params.diffArtifact.id, claim: 'changed files list' }]
    : [];
  const results: RuleResult[] = [
    {
      ruleId: 'sensitive.no_high_risk_path',
      status: hits.length === 0 ? 'pass' : 'warn',
      message:
        hits.length === 0 ? 'no sensitive paths touched' : `sensitive: ${hits.join(', ')}`,
      evidenceRefs: evidence,
    },
  ];
  return record(params.workflowRunId, params.stepRunId, 'sensitive_change_gate', results);
}

export function runManualGate(params: {
  workflowRunId: WorkflowRunId;
  stepRunId: StepRunId | null;
  gateId: GateRun['gateId'];
  approved: boolean;
  actor: string;
  comment: string | null;
}): GateRun {
  const results: RuleResult[] = [
    {
      ruleId: 'manual.human_decision',
      status: params.approved ? 'pass' : 'fail',
      message: `${params.actor} ${params.approved ? 'approved' : 'rejected'}${params.comment ? `: ${params.comment}` : ''}`,
      evidenceRefs: [],
    },
  ];
  return record(params.workflowRunId, params.stepRunId, params.gateId, results);
}
