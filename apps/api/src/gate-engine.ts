import {
  newId,
  nowIso,
  type Artifact,
  type BuildRun,
  type CommandRun,
  type CommandRunId,
  type GateRun,
  type RuleResult,
  type SurefireAggregate,
  type TestRun,
  type WorkflowRunId,
  type StepRunId,
  type EvidenceRef,
  VERIFIER_AC_MATRIX_SCHEMA_VERSION,
  VERIFIER_MEDIA_SCHEMA_VERSION,
  type VerifierAcMatrix,
  type VerifierMediaRole,
  type VerifierStatus,
} from '@ainp/shared';
import { store } from './store/store';
import { readFileUriText } from './artifact-content';
import { audit } from './audit';
import { checkpointGateRun } from './step-checkpoints';

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
  checkpointGateRun(gate);
  audit(workflowRunId, 'gate.recorded', { gateId, status: gate.status });
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
    // T3.2 conditional degrade: a project that configured a custom test
    // command usually produces no surefire XML. When (a) the run's project
    // has a custom buildTestCommand AND (b) the test CommandRun exited 0,
    // missing reports degrade to `warn` instead of `fail`. The default Maven
    // path keeps the hard fail. Project lookup goes straight through the
    // store (gate-engine must not depend on workflow-engine).
    const run = store.workflowRuns.get(params.workflowRunId);
    const project = run ? store.projects.get(run.projectId) : undefined;
    const customTestCommand = project?.buildTestCommand?.trim();
    const degrade = Boolean(customTestCommand) && testCmd?.exitCode === 0;
    results.push({
      ruleId: 'test.surefire_present',
      status: degrade ? 'warn' : 'fail',
      message: degrade
        ? 'no structured test report (custom test command)'
        : 'no Surefire reports parsed',
      evidenceRefs:
        degrade && testCmd
          ? [{ artifactId: testCmd.id, claim: `${testCmd.command} -> exit=${testCmd.exitCode}` }]
          : [],
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

function readArtifactText(a: Artifact | null): string {
  if (!a?.uri.startsWith('file://')) return '';
  try {
    return readFileUriText(a.uri);
  } catch {
    return '';
  }
}

function artifactEvidence(a: Artifact | null, claim: string): EvidenceRef[] {
  return a ? [{ artifactId: a.id, claim }] : [];
}

function textRule(params: {
  ruleId: string;
  ok: boolean;
  pass: string;
  fail: string;
  evidenceRefs: EvidenceRef[];
}): RuleResult {
  return {
    ruleId: params.ruleId,
    status: params.ok ? 'pass' : 'fail',
    message: params.ok ? params.pass : params.fail,
    evidenceRefs: params.evidenceRefs,
  };
}

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

export function runRequirementGate(params: {
  workflowRunId: WorkflowRunId;
  stepRunId: StepRunId | null;
  artifact: Artifact | null;
}): GateRun {
  const text = readArtifactText(params.artifact);
  const evidence = artifactEvidence(params.artifact, 'requirement draft markdown');
  const hasArtifact = Boolean(params.artifact);
  const hasReqId = /\bREQ-\d{3}\b/i.test(text);
  const hasAcceptance = hasAcceptanceCriteria(text);
  const hasScope = /goals?|目标|non-goals?|非目标|scope|范围/i.test(text);
  const hasContextEvidence =
    /context pack|context evidence|relevant code|evidence refs|`src\//i.test(text);
  // cs-req checks (Phase A): pitch frontmatter, four-section structure,
  // ≥2 specific user stories, and a substantive 边界 section.
  const hasPitch = /^pitch:\s*\S+/m.test(text);
  const hasFourSections =
    hasRequirementSection(text, '用户故事') &&
    hasRequirementSection(text, '为什么需要') &&
    hasRequirementSection(text, '怎么解决') &&
    hasRequirementSection(text, '边界');
  const userStoryBullets = (text.match(/^-\s+作为/gm) ?? []).length;
  const hasUserStoriesMin2 = userStoryBullets >= 2;
  const boundaryBody = matchGateSection(text, '边界')?.[0].replace(/^##[^\n]*\n?/i, '').trim() ?? '';
  const hasBoundary = boundaryBody.length >= 20;

  const results: RuleResult[] = [
    {
      ruleId: 'requirement.draft_present',
      status: hasArtifact ? 'pass' : 'fail',
      message: hasArtifact
        ? `requirement_draft artifact present (${params.artifact!.id})`
        : 'requirement_draft artifact missing',
      evidenceRefs: evidence,
    },
    textRule({
      ruleId: 'requirement.ids_present',
      ok: hasReqId,
      pass: 'requirement IDs present',
      fail: 'missing REQ-### requirement IDs',
      evidenceRefs: evidence,
    }),
    textRule({
      ruleId: 'requirement.acceptance_criteria_present',
      ok: hasAcceptance,
      pass: 'acceptance criteria IDs present',
      fail: 'missing AC-### acceptance criteria section',
      evidenceRefs: evidence,
    }),
    textRule({
      ruleId: 'requirement.scope_present',
      ok: hasScope,
      pass: 'scope/goals/non-goals present',
      fail: 'missing scope, goals, or non-goals',
      evidenceRefs: evidence,
    }),
    textRule({
      ruleId: 'requirement.context_evidence_present',
      ok: hasContextEvidence,
      pass: 'context evidence referenced',
      fail: 'missing Context Pack / evidence references',
      evidenceRefs: evidence,
    }),
    textRule({
      ruleId: 'requirement.pitch_present',
      ok: hasPitch,
      pass: 'pitch frontmatter present',
      fail: 'missing `pitch: ...` line in frontmatter',
      evidenceRefs: evidence,
    }),
    textRule({
      ruleId: 'requirement.four_sections_present',
      ok: hasFourSections,
      pass: 'four cs-req sections (用户故事/为什么需要/怎么解决/边界) present',
      fail: 'missing one or more cs-req sections',
      evidenceRefs: evidence,
    }),
    textRule({
      ruleId: 'requirement.user_stories_min_2',
      ok: hasUserStoriesMin2,
      pass: `${userStoryBullets} user-story bullets`,
      fail: `need ≥2 "作为 ..." bullets, got ${userStoryBullets}`,
      evidenceRefs: evidence,
    }),
    textRule({
      ruleId: 'requirement.boundary_present',
      ok: hasBoundary,
      pass: '边界 section has substantive content',
      fail: '边界 section missing or empty',
      evidenceRefs: evidence,
    }),
  ];

  return record(params.workflowRunId, params.stepRunId, 'requirement_gate', results);
}

function hasAcceptanceCriteria(text: string): boolean {
  if (/\bAC-\d{3}\b/i.test(text) && /acceptance criteria|验收标准/i.test(text)) return true;
  return /(?:^|\n)\s*(?:[-*]\s*)?(?:\*\*)?AC-\d{3}(?:\*\*)?\s*[:：-]/i.test(text);
}

function hasRequirementSection(text: string, title: string): boolean {
  return Boolean(matchGateSection(text, title));
}

/** Match a `## <title>` markdown section (shared by requirement & design gates). */
function matchGateSection(text: string, title: string): RegExpMatchArray | null {
  const escaped = escapeRegExp(title);
  return text.match(new RegExp(
    String.raw`^##\s*(?:\d+\.\s*)?(?:\*\*)?\s*${escaped}(?:\s|\*\*|[（(:：]|$)[\s\S]*?(?=^##\s|(?![\s\S]))`,
    'im',
  ));
}

export function runDesignGate(params: {
  workflowRunId: WorkflowRunId;
  stepRunId: StepRunId | null;
  artifact: Artifact | null;
}): GateRun {
  const text = readArtifactText(params.artifact);
  const evidence = artifactEvidence(params.artifact, 'design markdown');
  const hasArtifact = Boolean(params.artifact);
  const hasCoverage =
    /requirement coverage|coverage matrix|需求覆盖|对应需求/i.test(text) ||
    /\bREQ-\d{3}\b[\s\S]{0,200}\b(?:D-\d{3}|DSN-\d{3}|AC-\d{3})\b/i.test(text);
  const hasTestStrategy = /test strategy|测试策略|\bAC-\d{3}\b[\s\S]{0,200}(test|mvn|测试)/i.test(text);
  const hasRisk = /risks?|风险/i.test(text);
  const hasContextGrounding =
    /context evidence|context pack|existing implementation|现有工程|`[a-z][\w\-]*\/[^\s`]+`/i.test(text);
  // cs-feat-design (Phase A.5): explicit DSN id, 现状/变化 two-段式,
  // 挂载点 count in 3-5, 推进策略 section.
  const hasDsnId = /^design_id:\s*DSN-\d{3}/m.test(text);
  const hasCurrentStateSection = hasDesignSection(text, '现状');
  const hasChangesSection = hasDesignSection(text, '变化');
  const hasRolloutSection = hasDesignSection(text, '推进策略');
  const mountSectionMatch = matchGateSection(text, '挂载点');
  const mountBulletCount = mountSectionMatch
    ? (mountSectionMatch[0].match(/^\s*\d+\.\s+\S|\n\s*-\s+\S/gm) ?? []).length
    : 0;
  const mountInRange = mountBulletCount >= 3 && mountBulletCount <= 5;

  const results: RuleResult[] = [
    {
      ruleId: 'design.doc_present',
      status: hasArtifact ? 'pass' : 'fail',
      message: hasArtifact
        ? `design_doc artifact present (${params.artifact!.id})`
        : 'design_doc artifact missing',
      evidenceRefs: evidence,
    },
    textRule({
      ruleId: 'design.requirement_coverage_present',
      ok: hasCoverage,
      pass: 'requirement coverage matrix present',
      fail: 'missing requirement coverage matrix',
      evidenceRefs: evidence,
    }),
    textRule({
      ruleId: 'design.test_strategy_present',
      ok: hasTestStrategy,
      pass: 'test strategy present',
      fail: 'missing test strategy tied to acceptance criteria',
      evidenceRefs: evidence,
    }),
    textRule({
      ruleId: 'design.risks_present',
      ok: hasRisk,
      pass: 'risks recorded',
      fail: 'missing risks section',
      evidenceRefs: evidence,
    }),
    textRule({
      ruleId: 'design.context_grounding_present',
      ok: hasContextGrounding,
      pass: 'design cites existing context evidence',
      fail: 'missing existing-context grounding',
      evidenceRefs: evidence,
    }),
    textRule({
      ruleId: 'design.dsn_id_present',
      ok: hasDsnId,
      pass: 'DSN-### design id present in frontmatter',
      fail: 'missing `design_id: DSN-###` line in frontmatter',
      evidenceRefs: evidence,
    }),
    textRule({
      ruleId: 'design.current_state_section_present',
      ok: hasCurrentStateSection,
      pass: '现状 section present',
      fail: 'missing 现状 (Current State) section',
      evidenceRefs: evidence,
    }),
    textRule({
      ruleId: 'design.changes_section_present',
      ok: hasChangesSection,
      pass: '变化 section present',
      fail: 'missing 变化 (Changes) section',
      evidenceRefs: evidence,
    }),
    textRule({
      ruleId: 'design.mount_points_count_in_range',
      ok: mountInRange,
      pass: `${mountBulletCount} mount-point bullets`,
      fail: `挂载点 should have 3-5 bullets, got ${mountBulletCount}`,
      evidenceRefs: evidence,
    }),
    textRule({
      ruleId: 'design.rollout_section_present',
      ok: hasRolloutSection,
      pass: '推进策略 section present',
      fail: 'missing 推进策略 (Roll-out) section',
      evidenceRefs: evidence,
    }),
  ];

  return record(params.workflowRunId, params.stepRunId, 'design_gate', results);
}

function hasDesignSection(text: string, title: string): boolean {
  return Boolean(matchGateSection(text, title));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function runAcceptanceTraceabilityGate(params: {
  workflowRunId: WorkflowRunId;
  stepRunId: StepRunId | null;
}): GateRun {
  const requirement = store.artifacts.byKind(params.workflowRunId, 'requirement_draft').at(-1) ?? null;
  const design = store.artifacts.byKind(params.workflowRunId, 'design_doc').at(-1) ?? null;
  const diff = store.artifacts.byKind(params.workflowRunId, 'diff').at(-1) ?? null;
  const review = store.artifacts
    .byKind(params.workflowRunId, 'other')
    .filter(isAcceptanceReviewArtifact)
    .at(-1) ?? null;
  const testGate = store.gateRuns.latestForGate(params.workflowRunId, 'test_gate');

  // V2 W2-2a (PRD ADR Q3): stage-history-aware traceability rules. If the
  // run never scheduled a `requirement` / `design` step (e.g. issue.standard
  // or feature.fastforward flows), the corresponding presence rule is "not
  // applicable" rather than fail. Detection: existence of any StepRun for
  // the stage on this workflow run. Rationale: traceability rules assert
  // "the run committed to producing X and did"; runs that never committed
  // to producing X shouldn't fail. Side effect: also fixes W2-3 R-Risk-2
  // (fastforward acceptance gate) since fastforward also has no
  // requirement/design step.
  const stagesRun = new Set(
    store.stepRuns.byWorkflow(params.workflowRunId).map((s) => s.stage),
  );

  const results: RuleResult[] = [
    stagesRun.has('requirement')
      ? textRule({
          ruleId: 'acceptance.requirement_present',
          ok: Boolean(requirement),
          pass: 'requirement evidence present',
          fail: 'missing requirement artifact',
          evidenceRefs: artifactEvidence(requirement, 'approved requirement candidate'),
        })
      : {
          ruleId: 'acceptance.requirement_present',
          status: 'pass' as const,
          message: 'not applicable: requirement stage not in this flow',
          evidenceRefs: [],
        },
    stagesRun.has('design')
      ? textRule({
          ruleId: 'acceptance.design_present',
          ok: Boolean(design),
          pass: 'design evidence present',
          fail: 'missing design artifact',
          evidenceRefs: artifactEvidence(design, 'approved design candidate'),
        })
      : {
          ruleId: 'acceptance.design_present',
          status: 'pass' as const,
          message: 'not applicable: design stage not in this flow',
          evidenceRefs: [],
        },
    textRule({
      ruleId: 'acceptance.diff_present',
      ok: Boolean(diff),
      pass: 'diff evidence present',
      fail: 'missing implementation diff',
      evidenceRefs: artifactEvidence(diff, 'implementation diff'),
    }),
    textRule({
      ruleId: 'acceptance.review_present',
      ok: Boolean(review),
      pass: 'review evidence present',
      fail: 'missing review artifact',
      evidenceRefs: artifactEvidence(review, 'review artifact'),
    }),
    {
      ruleId: 'acceptance.test_gate_passed',
      status: testGate?.status === 'pass' ? 'pass' : 'fail',
      message: testGate
        ? `latest test_gate=${testGate.status}`
        : 'missing test_gate before acceptance',
      evidenceRefs: testGate?.evidenceRefs ?? [],
    },
  ];

  return record(params.workflowRunId, params.stepRunId, 'acceptance_gate', results);
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

// ---- Unified Evidence Gate ------------------------------------------------

export function runEvidenceGate(params: {
  workflowRunId: WorkflowRunId;
  stepRunId: StepRunId | null;
}): GateRun {
  const gates = store.gateRuns
    .byWorkflow(params.workflowRunId)
    .filter((gate) => gate.gateId !== 'evidence_gate');

  const passRules = gates.flatMap((gate) =>
    gate.ruleResults
      .filter((rule) => rule.status === 'pass')
      .map((rule) => ({ gate, rule })),
  );

  const missingEvidence = passRules.filter(({ rule }) => (
    !isEvidenceOptionalPassRule(rule) && rule.evidenceRefs.length === 0
  ));
  const unresolvedEvidence = passRules.flatMap(({ gate, rule }) =>
    rule.evidenceRefs
      .filter((ref) => !resolveEvidenceRef(ref))
      .map((ref) => `${gate.gateId}/${rule.ruleId}:${ref.artifactId}`),
  );

  const passingCompileTestGates = gates.filter((gate) =>
    gate.status === 'pass'
    && (gate.gateId === 'compile_gate' || gate.gateId === 'test_gate')
  );
  const commandEvidenceByGate = passingCompileTestGates.map((gate) => ({
    gate,
    commands: commandEvidenceForGate(gate),
  }));
  const compileTestGatesMissingCommandEvidence = commandEvidenceByGate.filter(
    ({ commands }) => commands.length === 0,
  );
  const commandEvidence = uniqueById(commandEvidenceByGate.flatMap(({ commands }) => commands));
  const commandsMissingDigest = commandEvidence.filter((cmd) => (
    !cmd.stdoutSha256 || !cmd.stderrSha256 || !cmd.combinedSha256
  ));

  const artifactEvidence = passRules.flatMap(({ rule }) =>
    rule.evidenceRefs
      .map((ref) => store.artifacts.get(ref.artifactId))
      .filter((artifact): artifact is Artifact => Boolean(artifact)),
  );
  const fileArtifactsMissingDigest = artifactEvidence.filter((artifact) => (
    artifact.uri.startsWith('file://') && !artifact.sha256
  ));

  const latestAcceptanceGate = gates
    .filter((gate) => gate.gateId === 'acceptance_gate')
    .at(-1);
  const hasAcceptanceTraceEvidence = gates
    .filter((gate) => gate.gateId === 'acceptance_gate')
    .some((gate) => {
      const passRuleIds = new Set(
        gate.ruleResults.filter((rule) => rule.status === 'pass').map((rule) => rule.ruleId),
      );
      return (
        passRuleIds.has('acceptance.diff_present')
        && passRuleIds.has('acceptance.review_present')
        && passRuleIds.has('acceptance.test_gate_passed')
        && gate.evidenceRefs.some((ref) => Boolean(resolveEvidenceRef(ref)))
      );
    });
  const uiVerifier = evaluateUiVerifierEvidence(params.workflowRunId);

  const results: RuleResult[] = [
    {
      ruleId: 'evidence.pass_rules_have_refs',
      status: missingEvidence.length === 0 ? 'pass' : 'fail',
      message: missingEvidence.length === 0
        ? `${passRules.length} passing rule(s) have evidence or are explicitly non-evidentiary`
        : `passing rule(s) missing evidence: ${missingEvidence
          .slice(0, 6)
          .map(({ gate, rule }) => `${gate.gateId}/${rule.ruleId}`)
          .join(', ')}${missingEvidence.length > 6 ? '...' : ''}`,
      evidenceRefs: [],
    },
    {
      ruleId: 'evidence.refs_resolve',
      status: unresolvedEvidence.length === 0 ? 'pass' : 'fail',
      message: unresolvedEvidence.length === 0
        ? 'all evidence refs resolve to an Artifact or CommandRun'
        : `unresolved evidence refs: ${unresolvedEvidence.slice(0, 6).join(', ')}${unresolvedEvidence.length > 6 ? '...' : ''}`,
      evidenceRefs: [],
    },
    {
      ruleId: 'evidence.command_digests_present',
      status: compileTestGatesMissingCommandEvidence.length === 0 && commandsMissingDigest.length === 0
        ? 'pass'
        : 'fail',
      message: compileTestGatesMissingCommandEvidence.length === 0 && commandsMissingDigest.length === 0
        ? `${commandEvidence.length} compile/test command evidence item(s) carry SHA-256 digests`
        : compileTestGatesMissingCommandEvidence.length > 0
          ? `passing compile/test gate(s) missing command evidence: ${compileTestGatesMissingCommandEvidence
            .map(({ gate }) => `${gate.gateId}:${gate.id}`)
            .join(', ')}`
        : `command evidence missing digest: ${commandsMissingDigest.map((cmd) => cmd.id).join(', ')}`,
      evidenceRefs: commandEvidence.map((cmd) => ({
        artifactId: cmd.id,
        claim: `${cmd.command} digest=${cmd.combinedSha256 ?? '(missing)'}`,
      })),
    },
    {
      ruleId: 'evidence.artifact_digests_present',
      status: fileArtifactsMissingDigest.length === 0 ? 'pass' : 'warn',
      message: fileArtifactsMissingDigest.length === 0
        ? `${artifactEvidence.length} artifact evidence item(s) carry digest or do not require one`
        : `file artifact evidence missing digest: ${fileArtifactsMissingDigest.map((artifact) => artifact.id).join(', ')}`,
      evidenceRefs: artifactEvidence.map((artifact) => ({
        artifactId: artifact.id,
        claim: `artifact digest=${artifact.sha256 ?? '(missing)'}`,
      })),
    },
    {
      ruleId: 'evidence.acceptance_has_execution_evidence',
      status: !latestAcceptanceGate || hasAcceptanceTraceEvidence ? 'pass' : 'fail',
      message: !latestAcceptanceGate
        ? 'no acceptance gate recorded yet'
        : hasAcceptanceTraceEvidence
          ? 'acceptance is backed by diff/review/test evidence'
          : 'acceptance has no implementation/test/log evidence beyond human decision',
      evidenceRefs: gates
        .filter((gate) => gate.gateId === 'acceptance_gate')
        .flatMap((gate) => gate.evidenceRefs),
    },
    {
      ruleId: 'evidence.ui_verifier_matrix_present',
      status: !uiVerifier.required || uiVerifier.matrixArtifact ? 'pass' : 'fail',
      message: !uiVerifier.required
        ? `not applicable: ${uiVerifier.reason}`
        : uiVerifier.matrixArtifact
          ? `UI verifier AC matrix present (${uiVerifier.matrixArtifact.id})`
          : `UI verifier required but no ${VERIFIER_AC_MATRIX_SCHEMA_VERSION} artifact was found`,
      evidenceRefs: uiVerifier.matrixArtifact
        ? [{ artifactId: uiVerifier.matrixArtifact.id, claim: 'UI verifier AC-to-evidence matrix' }]
        : [],
    },
    {
      ruleId: 'evidence.ui_verifier_media_refs_present',
      status: !uiVerifier.required || uiVerifier.criteriaCovered ? 'pass' : 'fail',
      message: !uiVerifier.required
        ? `not applicable: ${uiVerifier.reason}`
        : uiVerifier.criteriaCovered
          ? `${uiVerifier.criteria.length} UI acceptance criterion/criteria cite before+after screenshots or video evidence`
          : uiVerifier.coverageFailures.length > 0
            ? `UI verifier evidence missing for: ${uiVerifier.coverageFailures.slice(0, 6).join(', ')}${uiVerifier.coverageFailures.length > 6 ? '...' : ''}`
            : 'UI verifier matrix has no acceptance criteria with media evidence refs',
      evidenceRefs: [
        ...(uiVerifier.matrixArtifact
          ? [{ artifactId: uiVerifier.matrixArtifact.id, claim: 'UI verifier AC-to-evidence matrix' }]
          : []),
        ...uiVerifier.mediaArtifacts.map((artifact) => ({
          artifactId: artifact.id,
          claim: `UI verifier media evidence (${verifierMediaRole(artifact) ?? artifact.contentType})`,
        })),
      ],
    },
    {
      ruleId: 'evidence.ui_verifier_artifact_digests_present',
      status: !uiVerifier.required
        || (uiVerifier.verifierArtifacts.length > 0 && uiVerifier.digestFailures.length === 0)
        ? 'pass'
        : 'fail',
      message: !uiVerifier.required
        ? `not applicable: ${uiVerifier.reason}`
        : uiVerifier.verifierArtifacts.length === 0
          ? 'UI verifier required but no verifier artifacts were found'
          : uiVerifier.digestFailures.length === 0
          ? `${uiVerifier.verifierArtifacts.length} verifier artifact(s) carry SHA-256 digests`
          : `verifier artifact evidence missing digest: ${uiVerifier.digestFailures.map((artifact) => artifact.id).join(', ')}`,
      evidenceRefs: uiVerifier.verifierArtifacts.map((artifact) => ({
        artifactId: artifact.id,
        claim: `verifier artifact digest=${artifact.sha256 ?? '(missing)'}`,
      })),
    },
  ];

  return record(params.workflowRunId, params.stepRunId, 'evidence_gate', results);
}

function isEvidenceOptionalPassRule(rule: RuleResult): boolean {
  return rule.ruleId === 'manual.human_decision'
    || rule.message.startsWith('not applicable:');
}

function resolveEvidenceRef(ref: EvidenceRef): Artifact | CommandRun | null {
  return store.artifacts.get(ref.artifactId)
    ?? store.commandRuns.get(ref.artifactId)
    ?? null;
}

function commandEvidenceForGate(gate: GateRun): CommandRun[] {
  const ids = new Set<string>();
  for (const id of gate.commandRunIds) {
    if (store.commandRuns.get(id)) ids.add(id);
  }
  for (const ref of gate.evidenceRefs) {
    if (store.commandRuns.get(ref.artifactId)) ids.add(ref.artifactId);
  }
  return [...ids]
    .map((id) => store.commandRuns.get(id))
    .filter((cmd): cmd is NonNullable<typeof cmd> => Boolean(cmd));
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    unique.push(item);
  }
  return unique;
}

function isAcceptanceReviewArtifact(artifact: Artifact): boolean {
  return artifact.metadata.subStage !== 'verifier'
    && !isVerifierAcMatrixArtifact(artifact)
    && !isVerifierMediaArtifact(artifact);
}

interface ParsedVerifierCriterion {
  id: string;
  status: VerifierStatus;
  evidenceRefs: Array<EvidenceRef & { role?: VerifierMediaRole | 'ac_matrix' }>;
}

interface UiVerifierEvidenceEvaluation {
  required: boolean;
  reason: string;
  matrixArtifact: Artifact | null;
  criteria: ParsedVerifierCriterion[];
  mediaArtifacts: Artifact[];
  verifierArtifacts: Artifact[];
  coverageFailures: string[];
  digestFailures: Artifact[];
  criteriaCovered: boolean;
}

function evaluateUiVerifierEvidence(workflowRunId: WorkflowRunId): UiVerifierEvidenceEvaluation {
  const artifacts = store.artifacts.byWorkflow(workflowRunId);
  const matrixArtifact = artifacts.filter(isVerifierAcMatrixArtifact).at(-1) ?? null;
  const matrix = matrixArtifact ? parseVerifierAcMatrix(matrixArtifact) : null;
  const requirement = uiVerifierRequirement(workflowRunId, artifacts, matrix);
  const criteria = matrix?.acceptanceCriteria ?? [];
  const mediaArtifacts = uniqueById(criteria.flatMap((criterion) =>
    criterion.evidenceRefs
      .map((ref) => store.artifacts.get(ref.artifactId))
      .filter((artifact): artifact is Artifact => Boolean(artifact))
      .filter(isVerifierMediaArtifact),
  ));
  const verifierArtifacts = uniqueById([
    ...(matrixArtifact ? [matrixArtifact] : []),
    ...mediaArtifacts,
  ]);
  const coverageFailures = requirement.required
    ? criteria
      .filter((criterion) => !criterionCoveredByVerifierMedia(criterion))
      .map((criterion) => criterion.id)
    : [];
  const digestFailures = requirement.required
    ? verifierArtifacts.filter((artifact) => !artifact.sha256)
    : [];

  return {
    required: requirement.required,
    reason: requirement.reason,
    matrixArtifact,
    criteria,
    mediaArtifacts,
    verifierArtifacts,
    coverageFailures,
    digestFailures,
    criteriaCovered: criteria.length > 0 && coverageFailures.length === 0,
  };
}

function uiVerifierRequirement(
  workflowRunId: WorkflowRunId,
  artifacts: Artifact[],
  matrix: Pick<VerifierAcMatrix, 'verifierRequired'> | null,
): { required: boolean; reason: string } {
  if (matrix?.verifierRequired === true) {
    return { required: true, reason: 'verifier AC matrix marks verifierRequired=true' };
  }
  if (artifacts.some((artifact) => artifact.metadata.verifierRequired === true)) {
    return { required: true, reason: 'artifact metadata marks verifierRequired=true' };
  }
  const run = store.workflowRuns.get(workflowRunId);
  if (run && isUiTaskTitle(run.title)) {
    return { required: true, reason: 'workflow title matches UI verifier keywords' };
  }
  return { required: false, reason: 'UI verifier not required for this run' };
}

function isUiTaskTitle(title: string): boolean {
  return /\b(ui|ux|frontend|front-end|web|browser|dom|css|html|page|screen|modal|button|form|visual|responsive)\b|前端|界面|页面|按钮|表单|截图|浏览器|样式/i
    .test(title);
}

function isVerifierAcMatrixArtifact(artifact: Artifact): boolean {
  return artifact.metadata.schemaVersion === VERIFIER_AC_MATRIX_SCHEMA_VERSION
    || artifact.metadata.reportKind === 'verifier_ac_matrix'
    || artifact.metadata.verifierArtifactType === 'ac_matrix';
}

function isVerifierMediaArtifact(artifact: Artifact): boolean {
  return artifact.metadata.schemaVersion === VERIFIER_MEDIA_SCHEMA_VERSION
    || artifact.metadata.reportKind === 'verifier_media'
    || parseVerifierMediaRole(artifact.metadata.verifierArtifactType) !== null
    || parseVerifierMediaRole(artifact.metadata.verifierRole) !== null
    || (
      artifact.metadata.subStage === 'verifier'
      && (
        parseVerifierMediaRole(artifact.metadata.artifactRole) !== null
        || captureToVerifierRole(artifact.metadata.capture) !== null
      )
    );
}

function parseVerifierAcMatrix(artifact: Artifact): { verifierRequired: boolean; acceptanceCriteria: ParsedVerifierCriterion[] } | null {
  try {
    const parsed = JSON.parse(readArtifactText(artifact)) as Record<string, unknown>;
    if (parsed.schemaVersion !== VERIFIER_AC_MATRIX_SCHEMA_VERSION) return null;
    const rawCriteria = Array.isArray(parsed.acceptanceCriteria)
      ? parsed.acceptanceCriteria
      : [];
    return {
      verifierRequired: parsed.verifierRequired === true,
      acceptanceCriteria: rawCriteria
        .map(parseVerifierCriterion)
        .filter((criterion): criterion is ParsedVerifierCriterion => Boolean(criterion)),
    };
  } catch {
    return null;
  }
}

function parseVerifierCriterion(value: unknown): ParsedVerifierCriterion | null {
  if (!value || typeof value !== 'object') return null;
  const recordValue = value as Record<string, unknown>;
  const id = typeof recordValue.id === 'string' && recordValue.id.trim()
    ? recordValue.id.trim()
    : null;
  if (!id) return null;
  const status = parseVerifierStatus(recordValue.status);
  const refs = Array.isArray(recordValue.evidenceRefs)
    ? recordValue.evidenceRefs.map(parseVerifierEvidenceRef).filter((ref): ref is ParsedVerifierCriterion['evidenceRefs'][number] => Boolean(ref))
    : [];
  return { id, status, evidenceRefs: refs };
}

function parseVerifierStatus(value: unknown): VerifierStatus {
  return value === 'pass' || value === 'fail' || value === 'blocked'
    ? value
    : 'blocked';
}

function parseVerifierEvidenceRef(value: unknown): ParsedVerifierCriterion['evidenceRefs'][number] | null {
  if (typeof value === 'string') {
    const artifactId = value.startsWith('artifact:') ? value.slice('artifact:'.length) : value;
    return artifactId ? { artifactId, claim: 'verifier media evidence' } : null;
  }
  if (!value || typeof value !== 'object') return null;
  const recordValue = value as Record<string, unknown>;
  if (typeof recordValue.artifactId !== 'string' || recordValue.artifactId.trim().length === 0) {
    return null;
  }
  const role = parseVerifierMediaRole(recordValue.role);
  return {
    artifactId: recordValue.artifactId,
    claim: typeof recordValue.claim === 'string' ? recordValue.claim : 'verifier media evidence',
    ...(role ? { role } : {}),
  };
}

function criterionCoveredByVerifierMedia(criterion: ParsedVerifierCriterion): boolean {
  if (criterion.status !== 'pass') return false;
  const roles = new Set<VerifierMediaRole>();
  for (const ref of criterion.evidenceRefs) {
    const artifact = store.artifacts.get(ref.artifactId);
    if (!artifact || !isVerifierMediaArtifact(artifact)) return false;
    const role = parseVerifierMediaRole(ref.role) ?? verifierMediaRole(artifact);
    if (role) roles.add(role);
  }
  return roles.has('video')
    || (roles.has('screenshot_before') && roles.has('screenshot_after'));
}

function verifierMediaRole(artifact: Artifact): VerifierMediaRole | null {
  return parseVerifierMediaRole(artifact.metadata.verifierArtifactType)
    ?? parseVerifierMediaRole(artifact.metadata.verifierRole)
    ?? parseVerifierMediaRole(artifact.metadata.artifactRole)
    ?? captureToVerifierRole(artifact.metadata.capture)
    ?? contentTypeToVerifierRole(artifact.contentType);
}

function parseVerifierMediaRole(value: unknown): VerifierMediaRole | null {
  if (
    value === 'screenshot_before'
    || value === 'before_screenshot'
    || value === 'before'
  ) {
    return 'screenshot_before';
  }
  if (
    value === 'screenshot_after'
    || value === 'after_screenshot'
    || value === 'after'
  ) {
    return 'screenshot_after';
  }
  if (value === 'video' || value === 'screen_video') return 'video';
  return null;
}

function captureToVerifierRole(value: unknown): VerifierMediaRole | null {
  if (value === 'before') return 'screenshot_before';
  if (value === 'after') return 'screenshot_after';
  return null;
}

function contentTypeToVerifierRole(contentType: string): VerifierMediaRole | null {
  if (contentType.startsWith('video/')) return 'video';
  return null;
}
