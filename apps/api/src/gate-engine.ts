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
import { readFileUriText } from './artifact-content';

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
  const hasAcceptance = /\bAC-\d{3}\b/i.test(text) && /acceptance criteria|验收标准/i.test(text);
  const hasScope = /goals?|目标|non-goals?|非目标|scope|范围/i.test(text);
  const hasContextEvidence =
    /context pack|context evidence|relevant code|evidence refs|`src\//i.test(text);
  // cs-req checks (Phase A): pitch frontmatter, four-section structure,
  // ≥2 specific user stories, and a substantive 边界 section.
  const hasPitch = /^pitch:\s*\S+/m.test(text);
  const hasFourSections =
    /##\s*用户故事/i.test(text) &&
    /##\s*为什么需要/i.test(text) &&
    /##\s*怎么解决/i.test(text) &&
    /##\s*边界/i.test(text);
  const userStoryBullets = (text.match(/^-\s+作为/gm) ?? []).length;
  const hasUserStoriesMin2 = userStoryBullets >= 2;
  const hasBoundary = /##\s*边界[\s\S]{20,}/i.test(text);

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
  const hasCurrentStateSection = /##\s*(\d+\.\s*)?现状/i.test(text);
  const hasChangesSection = /##\s*(\d+\.\s*)?变化/i.test(text);
  const hasRolloutSection = /##\s*(\d+\.\s*)?推进策略/i.test(text);
  const mountSectionMatch = text.match(/##\s*(\d+\.\s*)?挂载点[\s\S]*?(?=\n##\s|\n*$)/i);
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

export function runAcceptanceTraceabilityGate(params: {
  workflowRunId: WorkflowRunId;
  stepRunId: StepRunId | null;
}): GateRun {
  const requirement = store.artifacts.byKind(params.workflowRunId, 'requirement_draft').at(-1) ?? null;
  const design = store.artifacts.byKind(params.workflowRunId, 'design_doc').at(-1) ?? null;
  const diff = store.artifacts.byKind(params.workflowRunId, 'diff').at(-1) ?? null;
  const review = store.artifacts.byKind(params.workflowRunId, 'other').at(-1) ?? null;
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
