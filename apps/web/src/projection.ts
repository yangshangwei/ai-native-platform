export const STAGES = [
  'init',
  'context_pack',
  'requirement',
  'design',
  'implementation',
  'build_test',
  'review',
  'completion',
  'knowledge',
] as const;

export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  init: 'Intake',
  context_pack: 'Context Pack',
  requirement: 'Requirement',
  design: 'Design',
  implementation: 'Implementation',
  build_test: 'Build & Test',
  review: 'Acceptance',
  completion: 'Report',
  knowledge: 'Knowledge',
};

export const STAGE_TO_GATE: Partial<Record<Stage, string>> = {
  requirement: 'requirement_gate',
  design: 'design_gate',
  implementation: 'sensitive_change_gate',
  review: 'acceptance_gate',
  knowledge: 'knowledge_gate',
};

export interface WorkflowRunDto {
  id: string;
  projectId: string;
  title: string;
  status: string;
  currentStage: Stage;
  sourceBranch?: string;
  branch: string;
  workspacePath: string | null;
  createdAt: string;
}

export interface CommandRunDto {
  id: string;
  command: string;
  status: string;
  exitCode: number | null;
  durationMs: number | null;
  stdoutRef: string;
  stderrRef: string;
  startedAt: string;
}

export interface GateRunDto {
  id: string;
  gateId: string;
  status: 'pass' | 'warn' | 'fail';
  decidedAt: string;
  ruleResults: Array<{ ruleId: string; status: string; message: string }>;
}

export interface ArtifactDto {
  id: string;
  kind: string;
  uri: string;
  contentType: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface ApprovalDto {
  id: string;
  gateId: string;
  decision: 'approved' | 'rejected';
  actor: string;
  decidedAt: string;
}

export interface WorkflowActionDto {
  id: string;
  workflowRunId: string;
  kind: string;
  targetId: string | null;
  action: string;
  actor: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface BuildRunDto {
  id: string;
  status: string;
  jdkVersion: string;
  mavenCommand: string;
}

export interface TestRunDto {
  id?: string;
  buildRunId?: string;
  framework: string;
  total: number;
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
  reportArtifactIds?: string[];
}

export interface RunDetail {
  run: WorkflowRunDto;
  steps: Array<{ id: string; stage: Stage; name: string; status: string }>;
  commands: CommandRunDto[];
  gates: GateRunDto[];
  artifacts: ArtifactDto[];
  builds: BuildRunDto[];
  tests: TestRunDto[];
  approvals: ApprovalDto[];
  actions: WorkflowActionDto[];
  agentTasks: Array<{ id: string; kind: string; backend: string }>;
  agentResults: Array<{ id: string; taskId: string; status: string; summary?: string }>;
  audit: Array<{ id: string; kind: string; at: string }>;
}

export interface StageProjection {
  id: Stage;
  label: string;
  state: 'waiting' | 'active' | 'blocked' | 'done' | 'failed';
  gateId: string | null;
}

export interface RunProjection {
  pendingGate: string | null;
  stages: StageProjection[];
  summary: {
    commands: number;
    gatesPassed: number;
    gatesWarned: number;
    gatesFailed: number;
    testsTotal: number;
    testsPassed: number;
    buildStatus: string;
  };
}

export function latestArtifactOfKind<T extends Pick<ArtifactDto, 'kind' | 'createdAt'>>(
  artifacts: T[],
  kind: string,
): T | null {
  return (
    artifacts
      .filter((artifact) => artifact.kind === kind)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .at(-1) ?? null
  );
}

export function buildRunProjection(detail: RunDetail): RunProjection {
  const currentIndex = STAGES.indexOf(detail.run.currentStage);
  const pendingGate =
    detail.run.status === 'awaiting_human'
      ? (STAGE_TO_GATE[detail.run.currentStage] ?? null)
      : null;

  const stages = STAGES.map<StageProjection>((stage, index) => {
    const step = detail.steps.find((s) => s.stage === stage);
    const gateId = STAGE_TO_GATE[stage] ?? null;
    const gate = gateId ? [...detail.gates].reverse().find((g) => g.gateId === gateId) : null;
    const isCurrent = stage === detail.run.currentStage;
    let state: StageProjection['state'] = 'waiting';

    if (step?.status === 'failed' || gate?.status === 'fail') {
      state = 'failed';
    } else if (pendingGate && isCurrent) {
      state = 'blocked';
    } else if (isCurrent && detail.run.status === 'running') {
      state = 'active';
    } else if (step?.status === 'passed' || gate?.status === 'pass' || index < currentIndex) {
      state = 'done';
    } else if (isCurrent && detail.run.status === 'failed') {
      state = 'failed';
    }

    return {
      id: stage,
      label: STAGE_LABELS[stage],
      state,
      gateId,
    };
  });

  return {
    pendingGate,
    stages,
    summary: {
      commands: detail.commands.length,
      gatesPassed: detail.gates.filter((g) => g.status === 'pass').length,
      gatesWarned: detail.gates.filter((g) => g.status === 'warn').length,
      gatesFailed: detail.gates.filter((g) => g.status === 'fail').length,
      testsTotal: detail.tests.reduce((sum, test) => sum + test.total, 0),
      testsPassed: detail.tests.reduce((sum, test) => sum + test.passed, 0),
      buildStatus: detail.builds.at(-1)?.status ?? 'not_started',
    },
  };
}

// ---- Structured document parsing -----------------------------------------

export interface RequirementDoc {
  title: string;
  goals: string[];
  userScenarios: string[];
  acceptanceCriteria: Array<{ id: string; text: string }>;
  nonGoals: string[];
  openQuestions: string[];
}

export interface DesignCoverageRow {
  requirement: string;
  design: string;
  acceptanceCriteria: string[];
  verification: string;
  status: 'covered' | 'pending' | 'risk';
}

export interface DesignDoc {
  title: string;
  summary: string[];
  affectedModules: string[];
  filesTouched: string[];
  testStrategy: string[];
  risks: string[];
  coverage: DesignCoverageRow[];
}

export interface AcceptanceChecklistItem {
  id: string;
  text: string;
  status: 'passed' | 'at_risk' | 'missing';
  evidence: string[];
  risk: string | null;
}

export interface KnowledgeSuggestion {
  kind: 'Decision' | 'Pitfall' | 'Pattern' | 'Lesson';
  text: string;
  evidence: string;
}

export interface CompletionReportSection {
  title: string;
  body: string;
}

export interface CompletionReportDoc {
  title: string;
  summary: string[];
  sections: CompletionReportSection[];
}

export interface WorkflowRequestSummary {
  id: string;
  projectId: string;
  type: string;
  title: string;
  branch: string;
  status: string;
  claimedBy: string | null;
  workflowRunId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkbenchOverview {
  toConfirm: WorkflowRunDto[];
  failedGates: Array<{ runId: string; gateId: string }>;
  running: WorkflowRunDto[];
  pendingRequests: WorkflowRequestSummary[];
  recentReports: WorkflowRunDto[];
}

export function parseRequirementDocument(markdown: string): RequirementDoc {
  const title = firstHeading(markdown) ?? 'Requirement Draft';
  const sections = splitSections(markdown);
  const acceptanceSource =
    sectionText(sections, ['acceptance criteria', '验收标准']) || markdown;
  const acceptanceCriteria = extractAcceptanceCriteria(acceptanceSource);
  return {
    title,
    goals: listItems(sectionText(sections, ['goals', '目标'])),
    userScenarios: listItems(sectionText(sections, ['user scenarios', '用户场景', 'user request'])),
    acceptanceCriteria,
    nonGoals: listItems(sectionText(sections, ['non-goals', 'non goals', '非目标'])),
    openQuestions: listItems(sectionText(sections, ['open questions', '待确认', 'questions'])),
  };
}

export function parseRequirementArtifact(markdown: string, jsonText?: string | null): RequirementDoc {
  const parsed = parseJsonObject(jsonText);
  if (parsed?.schemaVersion === 'ainp.requirement.v1') {
    const acceptanceCriteria = Array.isArray(parsed.acceptanceCriteria)
      ? parsed.acceptanceCriteria
          .map((item) => {
            if (!isObject(item) || typeof item.id !== 'string' || typeof item.text !== 'string') {
              return null;
            }
            return { id: item.id, text: item.text };
          })
          .filter((item): item is { id: string; text: string } => Boolean(item))
      : [];
    return {
      title: typeof parsed.title === 'string' ? parsed.title : 'Requirement Draft',
      goals: stringArray(parsed.goals),
      userScenarios: stringArray(parsed.userScenarios),
      acceptanceCriteria,
      nonGoals: stringArray(parsed.nonGoals),
      openQuestions: stringArray(parsed.openQuestions),
    };
  }
  return parseRequirementDocument(markdown);
}

export function parseDesignDocument(markdown: string): DesignDoc {
  const title = firstHeading(markdown) ?? 'Design';
  const sections = splitSections(markdown);
  const coverageSection = sectionText(sections, [
    'requirement coverage matrix',
    'coverage matrix',
    '需求覆盖',
  ]) || markdown;
  return {
    title,
    summary: listItems(sectionText(sections, ['approach', 'design summary', '设计摘要'])),
    affectedModules: listItems(sectionText(sections, ['affected modules', '影响模块'])),
    filesTouched: listItems(sectionText(sections, ['files touched', '修改文件'])),
    testStrategy: listItems(sectionText(sections, ['test strategy', '测试策略'])),
    risks: listItems(sectionText(sections, ['risks', '风险'])),
    coverage: parseCoverageTable(coverageSection),
  };
}

export function parseDesignArtifact(markdown: string, jsonText?: string | null): DesignDoc {
  const parsed = parseJsonObject(jsonText);
  if (parsed?.schemaVersion === 'ainp.design.v1') {
    return {
      title: typeof parsed.title === 'string' ? parsed.title : 'Design',
      summary: stringArray(parsed.summary),
      affectedModules: stringArray(parsed.affectedModules),
      filesTouched: stringArray(parsed.filesTouched),
      testStrategy: stringArray(parsed.testStrategy),
      risks: stringArray(parsed.risks),
      coverage: parseCoverageRows(parsed.coverage),
    };
  }
  return parseDesignDocument(markdown);
}

export function parseCompletionReport(markdown: string): CompletionReportDoc {
  const sectionsMap = splitSections(markdown);
  const sections = [...sectionsMap.entries()].map(([title, body]) => ({
    title,
    body: body.trim(),
  }));
  const summary = markdown
    .split('\n')
    .filter((line) => /^-\s+\*\*/.test(line))
    .map((line) => line.replace(/^-\s+/, '').replace(/\*\*/g, '').trim());
  return {
    title: firstHeading(markdown) ?? 'Completion Report',
    summary,
    sections,
  };
}

export function parseCompletionReportArtifact(
  markdown: string,
  jsonText?: string | null,
): CompletionReportDoc {
  const parsed = parseJsonObject(jsonText);
  if (parsed?.schemaVersion === 'ainp.completion_report.v1') {
    const sections = Array.isArray(parsed.sections)
      ? parsed.sections
          .map((item) => {
            if (!isObject(item) || typeof item.title !== 'string' || typeof item.body !== 'string') {
              return null;
            }
            return { title: item.title, body: item.body };
          })
          .filter((item): item is CompletionReportSection => Boolean(item))
      : [];
    return {
      title: typeof parsed.title === 'string' ? parsed.title : 'Completion Report',
      summary: stringArray(parsed.summary),
      sections,
    };
  }
  return parseCompletionReport(markdown);
}

export function parseKnowledgeCandidate(markdown: string): KnowledgeSuggestion[] {
  const lessons = sectionText(splitSections(markdown), ['reusable lessons', 'knowledge suggestions']);
  return listItems(lessons).map((item) => {
    const match = /^(Decision|Pitfall|Pattern|Lesson)\s*:\s*(.*?)(?:\s+Evidence\s*:\s*(.*))?$/i.exec(
      item,
    );
    if (match) {
      return {
        kind: normalizeKnowledgeKind(match[1]!),
        text: (match[2] ?? '').trim(),
        evidence: match[3]?.trim() ?? '',
      };
    }
    return {
      kind: 'Lesson' as const,
      text: item,
      evidence: '',
    };
  });
}

export function parseKnowledgeArtifact(
  markdown: string,
  jsonText?: string | null,
): KnowledgeSuggestion[] {
  const parsed = parseJsonObject(jsonText);
  if (parsed?.schemaVersion === 'ainp.knowledge_candidate.v1' && Array.isArray(parsed.suggestions)) {
    return parsed.suggestions
      .map((item) => {
        if (
          !isObject(item) ||
          typeof item.text !== 'string' ||
          !['Decision', 'Pitfall', 'Pattern', 'Lesson'].includes(String(item.kind))
        ) {
          return null;
        }
        return {
          kind: item.kind as KnowledgeSuggestion['kind'],
          text: item.text,
          evidence: typeof item.evidence === 'string' ? item.evidence : '',
        };
      })
      .filter((item): item is KnowledgeSuggestion => Boolean(item));
  }
  return parseKnowledgeCandidate(markdown);
}

export function buildAcceptanceChecklist(
  requirement: RequirementDoc,
  design: DesignDoc,
  detail: RunDetail,
): AcceptanceChecklistItem[] {
  const compileGate = latestGate(detail, 'compile_gate');
  const testGate = latestGate(detail, 'test_gate');
  const acceptanceGate = latestGate(detail, 'acceptance_gate');
  const hasPassingTests = detail.tests.some((t) => t.total > 0 && t.failed === 0 && t.errors === 0);
  const approvedAcceptance = detail.approvals.some(
    (a) => a.gateId === 'acceptance_gate' && a.decision === 'approved',
  );

  return requirement.acceptanceCriteria.map((ac) => {
    const covered = design.coverage.some((row) => row.acceptanceCriteria.includes(ac.id));
    const evidence: string[] = [];
    if (covered) evidence.push('Design coverage matrix');
    if (compileGate?.status === 'pass') evidence.push('compile_gate=pass');
    if (testGate?.status === 'pass' && hasPassingTests) evidence.push('test_gate=pass');
    if (acceptanceGate?.status === 'pass' || approvedAcceptance) evidence.push('acceptance approved');

    let status: AcceptanceChecklistItem['status'] = 'missing';
    let risk: string | null = null;
    if (covered && compileGate?.status === 'pass' && testGate?.status === 'pass' && hasPassingTests) {
      status = 'passed';
    } else if (covered || compileGate?.status === 'pass' || testGate?.status === 'pass') {
      status = 'at_risk';
      risk = 'Evidence is partial; confirm risk before completion.';
    } else {
      risk = 'No implementation/test evidence found yet.';
    }
    return { id: ac.id, text: ac.text, status, evidence, risk };
  });
}

export function buildWorkbenchOverview(params: {
  runs: WorkflowRunDto[];
  requests: WorkflowRequestSummary[];
  detailsByRunId?: Record<string, RunDetail | undefined>;
}): WorkbenchOverview {
  const detailsByRunId = params.detailsByRunId ?? {};
  return {
    toConfirm: params.runs.filter((run) => run.status === 'awaiting_human'),
    failedGates: params.runs.flatMap((run) =>
      (detailsByRunId[run.id]?.gates ?? [])
        .filter((gate) => gate.status === 'fail')
        .map((gate) => ({ runId: run.id, gateId: gate.gateId })),
    ),
    running: params.runs.filter((run) => run.status === 'running'),
    pendingRequests: params.requests.filter((request) => request.status === 'pending'),
    recentReports: params.runs.filter((run) => run.status === 'passed').slice(0, 5),
  };
}

export function changedFilesFromDiff(diffText: string): string[] {
  const files = new Set<string>();
  for (const line of diffText.split('\n')) {
    const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (match) files.add(match[2]!);
  }
  return [...files];
}

function latestGate(detail: RunDetail, gateId: string): GateRunDto | null {
  return [...detail.gates].reverse().find((gate) => gate.gateId === gateId) ?? null;
}

function firstHeading(markdown: string): string | null {
  return markdown
    .split('\n')
    .map((line) => /^#\s+(.+)$/.exec(line.trim())?.[1]?.trim())
    .find((heading): heading is string => Boolean(heading)) ?? null;
}

function splitSections(markdown: string): Map<string, string> {
  const sections = new Map<string, string>();
  let current = '';
  let body: string[] = [];
  for (const line of markdown.split('\n')) {
    const match = /^#{2,3}\s+(.+?)\s*$/.exec(line);
    if (match) {
      if (current) sections.set(normalizeHeading(current), body.join('\n'));
      current = match[1]!;
      body = [];
    } else if (current) {
      body.push(line);
    }
  }
  if (current) sections.set(normalizeHeading(current), body.join('\n'));
  return sections;
}

function sectionText(sections: Map<string, string>, names: string[]): string {
  const wanted = names.map(normalizeHeading);
  for (const [name, body] of sections.entries()) {
    if (wanted.some((candidate) => name === candidate)) return body;
  }
  for (const [name, body] of sections.entries()) {
    if (wanted.some((candidate) => name.startsWith(candidate) || candidate.startsWith(name))) {
      return body;
    }
  }
  return '';
}

function normalizeHeading(text: string): string {
  return text.trim().toLowerCase().replace(/[:：]/g, '').replace(/\s+/g, ' ');
}

function listItems(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean);
}

function extractAcceptanceCriteria(text: string): Array<{ id: string; text: string }> {
  const out: Array<{ id: string; text: string }> = [];
  for (const line of text.split('\n')) {
    const match = /\b(AC-\d{3})\b\s*[:：-]?\s*(.+)$/i.exec(line);
    if (match) out.push({ id: match[1]!.toUpperCase(), text: match[2]!.trim() });
  }
  return out;
}

function parseCoverageTable(markdown: string): DesignCoverageRow[] {
  const rows = markdown
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') && line.endsWith('|'))
    .map((line) => line.slice(1, -1).split('|').map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 3 && !cells.every((cell) => /^-+$/.test(cell.replace(/\s/g, ''))));

  const body = rows.filter((cells) => !/requirement|需求/i.test(cells[0] ?? ''));
  return body.map((cells) => {
    const acceptanceCell = cells.find((cell) => /\bAC-\d{3}\b/i.test(cell)) ?? '';
    return {
      requirement: cells[0] ?? '',
      design: cells[1] ?? '',
      acceptanceCriteria: (acceptanceCell.match(/\bAC-\d{3}\b/gi) ?? []).map((id) =>
        id.toUpperCase(),
      ),
      verification: cells[3] ?? cells[2] ?? '',
      status: /待确认|pending|risk|风险/i.test(cells.join(' ')) ? 'pending' : 'covered',
    };
  });
}

function parseCoverageRows(value: unknown): DesignCoverageRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!isObject(item)) return null;
      const status =
        item.status === 'pending' || item.status === 'risk' ? item.status : 'covered';
      return {
        requirement: typeof item.requirement === 'string' ? item.requirement : '',
        design: typeof item.design === 'string' ? item.design : '',
        acceptanceCriteria: stringArray(item.acceptanceCriteria),
        verification: typeof item.verification === 'string' ? item.verification : '',
        status,
      };
    })
    .filter((item): item is DesignCoverageRow => Boolean(item));
}

function normalizeKnowledgeKind(kind: string): KnowledgeSuggestion['kind'] {
  const lower = kind.toLowerCase();
  if (lower === 'decision') return 'Decision';
  if (lower === 'pitfall') return 'Pitfall';
  if (lower === 'pattern') return 'Pattern';
  return 'Lesson';
}

function parseJsonObject(text?: string | null): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
