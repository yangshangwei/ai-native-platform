#!/usr/bin/env bun
/**
 * Local deterministic eval harness.
 *
 * M4 starts with scenarios that exercise platform decision logic without an
 * API server or external agent backend. Scenario variants are first-class so
 * the same schema can later compare knowledge sets, skill prompts, and agent
 * backends against identical expectations.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AgentResult,
  AgentTask,
  AgentSessionStatus,
  Artifact,
  CommandRun,
  ContextInclusionMode,
  ContextPack,
  ContextPackBudget,
  GateStatus,
  FlowId,
  GateRun,
  KnowledgeArtifact,
  KnowledgeArtifactKind,
  Project,
  RuleStatus,
  RouterInput,
  SkillSpec,
  WorkflowRun,
  WorkflowRunType,
  WorkflowStage,
} from '@ainp/shared';
import type { AgentBackend, AgentRunResult } from '../apps/runner/src/agents/types';
import type { InvokeSkillDeps } from '../apps/runner/src/orchestrator/invoke-skill';
import type { RunCtx } from '../apps/runner/src/orchestrator/types';
import type { ProjectProfile } from '../apps/runner/src/profile';

type ScenarioKind =
  | 'router_recommendation'
  | 'agent_backend_fixture'
  | 'context_pack_fixture'
  | 'workflow_fixture';

type EvalScenario =
  | RouterEvalScenario
  | AgentBackendEvalScenario
  | ContextPackEvalScenario
  | WorkflowEvalScenario;

interface BaseEvalScenario {
  schemaVersion: 'ainp.eval.scenario.v1';
  id: string;
  title: string;
  description?: string;
  kind: ScenarioKind;
}

interface RouterEvalScenario extends BaseEvalScenario {
  kind: 'router_recommendation';
  input: RouterEvalInput;
  expectations?: RouterExpectations;
  variants?: RouterEvalVariant[];
}

interface AgentBackendEvalScenario extends BaseEvalScenario {
  kind: 'agent_backend_fixture';
  input: AgentBackendEvalInput;
  expectations?: AgentBackendExpectations;
  variants?: AgentBackendEvalVariant[];
}

interface ContextPackEvalScenario extends BaseEvalScenario {
  kind: 'context_pack_fixture';
  input: ContextPackEvalInput;
  expectations?: ContextPackExpectations;
  variants?: ContextPackEvalVariant[];
}

interface WorkflowEvalScenario extends BaseEvalScenario {
  kind: 'workflow_fixture';
  input: WorkflowEvalInput;
  expectations?: WorkflowExpectations;
  variants?: WorkflowEvalVariant[];
}

interface EvalVariant<Input, Expectations> {
  id: string;
  label?: string;
  backend?: 'codex' | 'claude_code' | 'rules_only' | 'fake';
  skillVariant?: string;
  knowledgeVariant?: string;
  inputOverrides?: Partial<Input>;
  expectations?: Expectations;
}

type RouterEvalVariant = EvalVariant<RouterEvalInput, RouterExpectations>;
type AgentBackendEvalVariant = EvalVariant<AgentBackendEvalInput, AgentBackendExpectations>;
type ContextPackEvalVariant = EvalVariant<ContextPackEvalInput, ContextPackExpectations>;
type WorkflowEvalVariant = EvalVariant<WorkflowEvalInput, WorkflowExpectations>;

interface RouterEvalInput {
  projectId: string;
  title: string;
  runType: WorkflowRunType;
  messageHistory?: RouterInput['messageHistory'];
  knowledgeArtifacts?: KnowledgeArtifactFixture[];
}

interface KnowledgeArtifactFixture {
  id?: string;
  kind: KnowledgeArtifactKind;
  entityId: string;
  status?: KnowledgeArtifact['status'];
  metadata?: Record<string, unknown>;
  subtype?: string | null;
}

interface RouterExpectations {
  flowId?: FlowId;
  startStage?: WorkflowStage | null;
  relevantKnowledgeMin?: number;
  relevantKnowledgeMax?: number;
  rulesFiredIncludes?: string[];
}

type AgentBackendBehavior = 'success' | 'failure' | 'context_request';

interface AgentBackendEvalInput {
  projectId?: string;
  workflowRunId?: string;
  title: string;
  stage?: WorkflowStage;
  behavior: AgentBackendBehavior;
  outputName?: string;
  outputContent?: string;
  errorMessage?: string;
  contextRequest?: {
    reason?: string;
    requestedRefs?: string[];
    questions?: string[];
    priority?: 1 | 2 | 3;
  };
}

interface AgentBackendExpectations {
  sessionStarted?: boolean;
  sessionFinished?: boolean;
  finalStatus?: Exclude<AgentSessionStatus, 'running'>;
  resultLinked?: boolean;
  errorObserved?: boolean;
  contextRequestCaptured?: boolean;
  outputCount?: number;
  backendCalls?: number;
  externalCliUsed?: boolean;
}

interface ContextPackEvalInput {
  projectId?: string;
  workflowRunId?: string;
  title: string;
  stage?: WorkflowStage;
  taskBrief?: string;
  projectProfileMarkdown?: string;
  acceptedKnowledgeMarkdown?: string;
  knowledgeArtifacts?: KnowledgeArtifactFixture[];
  inputArtifacts?: Array<{
    name: string;
    content: string;
    artifactId?: string | null;
    required?: boolean;
  }>;
  budget?: Partial<ContextPackBudget>;
  sensitivePathPatterns?: string[];
}

interface ContextPackExpectations {
  mode?: ContextPack['mode'];
  manifestRefsInclude?: string[];
  manifestRefsExclude?: string[];
  sourceRefsInclude?: string[];
  sourceRefsExclude?: string[];
  authoritativeSourceRefsExclude?: string[];
  sectionModes?: Record<string, ContextInclusionMode>;
  retrievalHintsMin?: number;
  calibrationSignalsMin?: number;
  selectedCountMin?: number;
  selectedCountMax?: number;
}

type WorkflowFixtureProfile = 'complete' | 'missing_command_digest' | 'artifact_only_compile';

interface WorkflowEvalInput {
  projectId?: string;
  workflowRunId?: string;
  title: string;
  profile: WorkflowFixtureProfile;
}

interface WorkflowExpectations {
  evidenceGateStatus?: GateStatus;
  ruleStatuses?: Record<string, RuleStatus>;
  commandDigestBacked?: boolean;
  completionReportGenerated?: boolean;
  completionReportHasStatusAtGeneration?: boolean;
  retroReportGenerated?: boolean;
  retroFindingsMin?: number;
  reportArtifactCountMin?: number;
}

interface EvalReport {
  schemaVersion: 'ainp.eval.result.v1';
  generatedAt: string;
  scenarioDir: string;
  summary: {
    scenarios: number;
    variantRuns: number;
    passed: number;
    failed: number;
  };
  results: EvalScenarioResult[];
}

interface EvalScenarioResult {
  scenarioId: string;
  title: string;
  kind: ScenarioKind;
  variants: EvalVariantResult[];
}

interface EvalVariantResult {
  variantId: string;
  label: string;
  backend: string;
  skillVariant: string | null;
  knowledgeVariant: string | null;
  status: 'pass' | 'fail';
  checks: EvalCheck[];
  output: unknown;
}

interface EvalCheck {
  name: string;
  status: 'pass' | 'fail';
  expected: unknown;
  actual: unknown;
}

const repoRoot = resolve(import.meta.dir, '..');

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const scenarioDir = resolve(repoRoot, args.scenarioDir ?? 'eval/scenarios');
  const outDir = resolve(repoRoot, args.outDir ?? '.ainp/evals');

  process.env.AINP_DB_PATH =
    process.env.AINP_EVAL_DB_PATH ??
    join(mkdtempSync(join(tmpdir(), 'ainp-eval-')), 'ainp.sqlite');

  const scenarios = await readScenarios(scenarioDir);
  const results: EvalScenarioResult[] = [];
  for (const scenario of scenarios) {
    results.push(await runScenario(scenario));
  }

  const variantResults = results.flatMap((result) => result.variants);
  const passed = variantResults.filter((result) => result.status === 'pass').length;
  const report: EvalReport = {
    schemaVersion: 'ainp.eval.result.v1',
    generatedAt: new Date().toISOString(),
    scenarioDir,
    summary: {
      scenarios: scenarios.length,
      variantRuns: variantResults.length,
      passed,
      failed: variantResults.length - passed,
    },
    results,
  };

  await mkdir(outDir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const jsonPath = join(outDir, `eval-${stamp}.json`);
  const htmlPath = join(outDir, `eval-${stamp}.html`);
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(htmlPath, renderHtml(report), 'utf8');

  console.log(`[eval] scenarios=${report.summary.scenarios} variants=${report.summary.variantRuns} passed=${report.summary.passed} failed=${report.summary.failed}`);
  console.log(`[eval] json=${jsonPath}`);
  console.log(`[eval] html=${htmlPath}`);
  if (report.summary.failed > 0) process.exit(1);
}

async function readScenarios(dir: string): Promise<EvalScenario[]> {
  const files = (await readdir(dir))
    .filter((file) => file.endsWith('.json'))
    .sort();
  const scenarios: EvalScenario[] = [];
  for (const file of files) {
    const path = join(dir, file);
    const parsed = JSON.parse(await readFile(path, 'utf8')) as EvalScenario;
    validateScenario(parsed, basename(path));
    scenarios.push(parsed);
  }
  return scenarios;
}

async function runScenario(scenario: EvalScenario): Promise<EvalScenarioResult> {
  if (scenario.kind === 'agent_backend_fixture') {
    return runAgentBackendScenario(scenario);
  }
  if (scenario.kind === 'context_pack_fixture') {
    return runContextPackScenario(scenario);
  }
  if (scenario.kind === 'workflow_fixture') {
    return runWorkflowScenario(scenario);
  }
  return runRouterScenario(scenario);
}

async function runRouterScenario(scenario: RouterEvalScenario): Promise<EvalScenarioResult> {
  const variants = scenario.variants?.length
    ? scenario.variants
    : [{ id: 'default', label: 'Default' } satisfies RouterEvalVariant];
  const variantResults: EvalVariantResult[] = [];
  for (const variant of variants) {
    const input = mergeInput(scenario.input, variant.inputOverrides);
    const expectations = { ...(scenario.expectations ?? {}), ...(variant.expectations ?? {}) };
    variantResults.push(await runRouterVariant(scenario, variant, input, expectations));
  }
  return {
    scenarioId: scenario.id,
    title: scenario.title,
    kind: scenario.kind,
    variants: variantResults,
  };
}

async function runAgentBackendScenario(scenario: AgentBackendEvalScenario): Promise<EvalScenarioResult> {
  const variants = scenario.variants?.length
    ? scenario.variants
    : [{ id: 'default', label: 'Default' } satisfies AgentBackendEvalVariant];
  const variantResults: EvalVariantResult[] = [];
  for (const variant of variants) {
    const input = mergeInput(scenario.input, variant.inputOverrides);
    const expectations = { ...(scenario.expectations ?? {}), ...(variant.expectations ?? {}) };
    variantResults.push(await runAgentBackendVariant(scenario, variant, input, expectations));
  }
  return {
    scenarioId: scenario.id,
    title: scenario.title,
    kind: scenario.kind,
    variants: variantResults,
  };
}

async function runContextPackScenario(scenario: ContextPackEvalScenario): Promise<EvalScenarioResult> {
  const variants = scenario.variants?.length
    ? scenario.variants
    : [{ id: 'default', label: 'Default' } satisfies ContextPackEvalVariant];
  const variantResults: EvalVariantResult[] = [];
  for (const variant of variants) {
    const input = mergeInput(scenario.input, variant.inputOverrides);
    const expectations = { ...(scenario.expectations ?? {}), ...(variant.expectations ?? {}) };
    variantResults.push(await runContextPackVariant(scenario, variant, input, expectations));
  }
  return {
    scenarioId: scenario.id,
    title: scenario.title,
    kind: scenario.kind,
    variants: variantResults,
  };
}

async function runWorkflowScenario(scenario: WorkflowEvalScenario): Promise<EvalScenarioResult> {
  const variants = scenario.variants?.length
    ? scenario.variants
    : [{ id: 'default', label: 'Default' } satisfies WorkflowEvalVariant];
  const variantResults: EvalVariantResult[] = [];
  for (const variant of variants) {
    const input = mergeInput(scenario.input, variant.inputOverrides);
    const expectations = { ...(scenario.expectations ?? {}), ...(variant.expectations ?? {}) };
    variantResults.push(await runWorkflowVariant(scenario, variant, input, expectations));
  }
  return {
    scenarioId: scenario.id,
    title: scenario.title,
    kind: scenario.kind,
    variants: variantResults,
  };
}

async function runRouterVariant(
  scenario: RouterEvalScenario,
  variant: RouterEvalVariant,
  input: RouterEvalInput,
  expectations: RouterExpectations,
): Promise<EvalVariantResult> {
  const { recommend } = await import('../apps/api/src/router');
  const { store } = await import('../apps/api/src/store/store');
  const projectId = `${input.projectId}_${safeId(scenario.id)}_${safeId(variant.id)}`;
  for (const [index, artifact] of (input.knowledgeArtifacts ?? []).entries()) {
    store.knowledgeArtifacts.insert(knowledgeArtifactFixture({
      ...artifact,
      id: artifact.id ?? `kart_${safeId(scenario.id)}_${safeId(variant.id)}_${index}`,
      projectId,
    }));
  }
  const output = recommend({
    projectId,
    title: input.title,
    runType: input.runType,
    messageHistory: input.messageHistory,
  });
  const checks = checkRouterOutput(output, expectations);
  return {
    variantId: variant.id,
    label: variant.label ?? variant.id,
    backend: variant.backend ?? 'rules_only',
    skillVariant: variant.skillVariant ?? null,
    knowledgeVariant: variant.knowledgeVariant ?? null,
    status: checks.every((check) => check.status === 'pass') ? 'pass' : 'fail',
    checks,
    output,
  };
}

interface AgentBackendFixtureTrace {
  tasks: AgentTask[];
  results: AgentResult[];
  sessionsStarted: Array<Parameters<InvokeSkillDeps['agentSessionStarted']>[0] & { id: string }>;
  sessionsFinished: Array<Parameters<InvokeSkillDeps['agentSessionFinished']>[0]>;
  artifacts: Artifact[];
  contextRequests: Array<Parameters<InvokeSkillDeps['recordContextRequest']>[0]>;
  backendCalls: number;
  errorObserved: boolean;
}

interface AgentBackendFixtureOutput {
  behavior: AgentBackendBehavior;
  taskIds: string[];
  resultIds: string[];
  sessionIds: string[];
  sessionFinishes: AgentBackendFixtureTrace['sessionsFinished'];
  contextRequestIds: string[];
  outputCount: number;
  backendCalls: number;
  errorObserved: boolean;
  externalCliUsed: false;
}

async function runAgentBackendVariant(
  scenario: AgentBackendEvalScenario,
  variant: AgentBackendEvalVariant,
  input: AgentBackendEvalInput,
  expectations: AgentBackendExpectations,
): Promise<EvalVariantResult> {
  const { finishAgentSuccess, invokeSkill } = await import('../apps/runner/src/orchestrator/invoke-skill');
  const workDir = mkdtempSync(join(tmpdir(), `ainp-eval-agent-${safeId(scenario.id)}-${safeId(variant.id)}-`));
  const artifactsDir = join(workDir, 'artifacts');
  await mkdir(artifactsDir, { recursive: true });
  const trace = createAgentFixtureTrace();
  const deps = agentFixtureDeps(trace);
  const skill = skillFixture(input.stage ?? 'implementation');
  const ctx = runCtxFixture({
    projectId: input.projectId ?? `proj_${safeId(scenario.id)}`,
    workflowRunId: input.workflowRunId ?? `run_${safeId(scenario.id)}_${safeId(variant.id)}`,
    title: input.title,
    workspacePath: workDir,
    artifactsDir,
    backend: fakeAgentBackend(input, trace, artifactsDir),
  });
  const skillCtx = {
    workflowRunId: ctx.run.id,
    stepRunId: 'step_eval_agent',
    workspacePath: workDir,
    branch: ctx.workspace.branch,
    title: input.title,
    artifactsDir,
    inputs: ctx.inputs,
  };

  let invoked: Awaited<ReturnType<typeof invokeSkill>> | null = null;
  try {
    invoked = await invokeSkill(ctx, skill, skillCtx, deps);
    await finishAgentSuccess(
      invoked,
      invoked.outputs.map((output, index) => `art_eval_output_${index + 1}_${safeId(output.name)}`),
      'eval fixture completed',
      deps.agentTaskFinished,
      deps.agentSessionFinished,
    );
  } catch (_err) {
    trace.errorObserved = true;
  }

  const output: AgentBackendFixtureOutput = {
    behavior: input.behavior,
    taskIds: trace.tasks.map((task) => task.id),
    resultIds: trace.results.map((result) => result.id),
    sessionIds: trace.sessionsStarted.map((session) => session.id),
    sessionFinishes: trace.sessionsFinished,
    contextRequestIds: trace.contextRequests.map((entry) => entry.request.id),
    outputCount: invoked?.outputs.length ?? 0,
    backendCalls: trace.backendCalls,
    errorObserved: trace.errorObserved,
    externalCliUsed: false,
  };
  const checks = checkAgentBackendOutput(output, expectations);
  return {
    variantId: variant.id,
    label: variant.label ?? variant.id,
    backend: variant.backend ?? 'fake',
    skillVariant: variant.skillVariant ?? `${skill.id}@${skill.version}`,
    knowledgeVariant: variant.knowledgeVariant ?? null,
    status: checks.every((check) => check.status === 'pass') ? 'pass' : 'fail',
    checks,
    output,
  };
}

interface ContextPackFixtureOutput {
  contextPackId: string;
  mode: ContextPack['mode'];
  manifestRefs: string[];
  sourceRefs: string[];
  selected: Array<{
    ref: string;
    mode: ContextInclusionMode;
    trustLevel: string;
    freshness: string;
    knowledgeClass: string;
    sourceRefs: string[];
    degradationReason: string | null;
  }>;
  authoritativeSourceRefs: string[];
  retrievalHints: string[];
  calibrationSignalCount: number;
}

async function runContextPackVariant(
  scenario: ContextPackEvalScenario,
  variant: ContextPackEvalVariant,
  input: ContextPackEvalInput,
  expectations: ContextPackExpectations,
): Promise<EvalVariantResult> {
  const { buildContextPack } = await import('../apps/runner/src/context/builder');
  const projectId = input.projectId ?? `proj_${safeId(scenario.id)}`;
  const workflowRunId = input.workflowRunId ?? `run_${safeId(scenario.id)}_${safeId(variant.id)}`;
  const workspacePath = mkdtempSync(join(tmpdir(), `ainp-eval-context-${safeId(scenario.id)}-${safeId(variant.id)}-`));
  const now = new Date().toISOString();
  const project = projectFixture(projectId, workspacePath, now);
  const run = workflowRunFixture({
    id: workflowRunId,
    projectId,
    title: input.title,
    workspacePath,
    now,
  });
  const knowledgeArtifacts = (input.knowledgeArtifacts ?? []).map((artifact, index) =>
    knowledgeArtifactFixture({
      ...artifact,
      id: artifact.id ?? `kart_${safeId(scenario.id)}_${safeId(variant.id)}_${index}`,
      projectId,
    }),
  );
  const pack = buildContextPack({
    project,
    run,
    stage: input.stage ?? 'implementation',
    stepRunId: `step_${safeId(variant.id)}`,
    workspacePath,
    branch: run.branch,
    taskBrief: input.taskBrief ?? input.title,
    projectProfile: projectProfileFixture(project, now),
    projectProfileMarkdown: input.projectProfileMarkdown ?? '# Project Profile\n\n- Language: unknown\n- Build tool: unknown',
    acceptedKnowledgeMarkdown: input.acceptedKnowledgeMarkdown ?? null,
    knowledgeArtifacts,
    inputArtifacts: input.inputArtifacts ?? [],
    budget: input.budget,
    sensitivePathPatterns: input.sensitivePathPatterns,
    createdAt: now,
  });
  const output = contextPackFixtureOutput(pack);
  const checks = checkContextPackOutput(output, expectations);
  return {
    variantId: variant.id,
    label: variant.label ?? variant.id,
    backend: variant.backend ?? 'fixture',
    skillVariant: variant.skillVariant ?? null,
    knowledgeVariant: variant.knowledgeVariant ?? null,
    status: checks.every((check) => check.status === 'pass') ? 'pass' : 'fail',
    checks,
    output,
  };
}

interface WorkflowFixtureOutput {
  profile: WorkflowFixtureProfile;
  evidenceGateStatus: GateStatus;
  ruleStatuses: Record<string, RuleStatus>;
  commandDigestBacked: boolean;
  completionReportGenerated: boolean;
  completionReportHasStatusAtGeneration: boolean;
  retroReportGenerated: boolean;
  retroFindings: number;
  reportArtifactCount: number;
}

async function runWorkflowVariant(
  scenario: WorkflowEvalScenario,
  variant: WorkflowEvalVariant,
  input: WorkflowEvalInput,
  expectations: WorkflowExpectations,
): Promise<EvalVariantResult> {
  const workDir = mkdtempSync(join(tmpdir(), `ainp-eval-workflow-${safeId(scenario.id)}-${safeId(variant.id)}-`));
  process.env.AINP_REPORTS_DIR ??= join(workDir, 'reports');
  const { store } = await import('../apps/api/src/store/store');
  const { runEvidenceGate } = await import('../apps/api/src/gate-engine');
  const { generateCompletionReport, generateRetroReport } = await import('../apps/api/src/reports');
  const now = new Date().toISOString();
  const projectId = input.projectId ?? `proj_${safeId(scenario.id)}`;
  const workflowRunId = input.workflowRunId ?? `run_${safeId(scenario.id)}_${safeId(variant.id)}`;
  const stepRunId = `step_${safeId(variant.id)}`;
  store.projects.set(projectId, projectFixture(projectId, workDir, now));
  store.workflowRuns.set(workflowRunId, workflowRunFixture({
    id: workflowRunId,
    projectId,
    title: input.title,
    workspacePath: workDir,
    now,
    status: 'passed',
  }));
  seedWorkflowEvidenceFixture({ store, workDir, workflowRunId, stepRunId, profile: input.profile, now });
  const evidenceGate = runEvidenceGate({ workflowRunId, stepRunId });
  let completionReportGenerated = false;
  let completionReportHasStatusAtGeneration = false;
  if (evidenceGate.status === 'pass') {
    const completion = await generateCompletionReport(workflowRunId);
    completionReportGenerated = true;
    const sidecar = JSON.parse(await readFile(fileURLToPath(completion.sidecar.uri), 'utf8')) as {
      summary?: unknown[];
    };
    completionReportHasStatusAtGeneration = Array.isArray(sidecar.summary)
      && sidecar.summary.some((entry) => typeof entry === 'string' && entry.startsWith('Status at report generation:'));
  }
  const retro = await generateRetroReport(workflowRunId);
  const retroSidecar = JSON.parse(await readFile(fileURLToPath(retro.sidecar.uri), 'utf8')) as {
    findings?: unknown[];
  };
  const output: WorkflowFixtureOutput = {
    profile: input.profile,
    evidenceGateStatus: evidenceGate.status,
    ruleStatuses: Object.fromEntries(evidenceGate.ruleResults.map((rule) => [rule.ruleId, rule.status])),
    commandDigestBacked: store.commandRuns.byWorkflow(workflowRunId).every((command) =>
      Boolean(command.stdoutSha256 && command.stderrSha256 && command.combinedSha256),
    ),
    completionReportGenerated,
    completionReportHasStatusAtGeneration,
    retroReportGenerated: true,
    retroFindings: Array.isArray(retroSidecar.findings) ? retroSidecar.findings.length : 0,
    reportArtifactCount: store.artifacts.byKind(workflowRunId, 'completion_report').length
      + store.artifacts.byKind(workflowRunId, 'other')
        .filter((artifact) => artifact.metadata.output === 'retro_report.md' || artifact.metadata.output === 'retro_report.json')
        .length,
  };
  const checks = checkWorkflowOutput(output, expectations);
  return {
    variantId: variant.id,
    label: variant.label ?? variant.id,
    backend: variant.backend ?? 'fixture',
    skillVariant: variant.skillVariant ?? null,
    knowledgeVariant: variant.knowledgeVariant ?? null,
    status: checks.every((check) => check.status === 'pass') ? 'pass' : 'fail',
    checks,
    output,
  };
}

function createAgentFixtureTrace(): AgentBackendFixtureTrace {
  return {
    tasks: [],
    results: [],
    sessionsStarted: [],
    sessionsFinished: [],
    artifacts: [],
    contextRequests: [],
    backendCalls: 0,
    errorObserved: false,
  };
}

function agentFixtureDeps(trace: AgentBackendFixtureTrace): InvokeSkillDeps {
  return {
    agentTaskStarted: async (params) => {
      const task: AgentTask = {
        id: `agt_eval_${trace.tasks.length + 1}`,
        workflowRunId: params.workflowRunId,
        stepRunId: params.stepRunId,
        kind: params.kind,
        backend: params.backend,
        prompt: params.prompt,
        inputArtifactIds: params.inputArtifactIds,
        createdAt: new Date().toISOString(),
      };
      trace.tasks.push(task);
      return { ok: true, task };
    },
    agentTaskFinished: async (params) => {
      const result: AgentResult = {
        id: `agr_eval_${trace.results.length + 1}`,
        taskId: params.taskId,
        status: params.status,
        summary: params.summary,
        outputArtifactIds: params.outputArtifactIds,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
      trace.results.push(result);
      return { ok: true, result };
    },
    agentSessionStarted: async (params) => {
      const session = { ...params, id: `ags_eval_${trace.sessionsStarted.length + 1}` };
      trace.sessionsStarted.push(session);
      return {
        ok: true,
        session: {
          ...params,
          id: session.id,
          stepRunId: trace.tasks.at(-1)?.stepRunId ?? null,
          agentResultId: null,
          backend: trace.tasks.at(-1)?.backend ?? 'native',
          status: 'running',
          startedAt: new Date().toISOString(),
          completedAt: null,
          metadata: params.metadata ?? {},
        },
      };
    },
    agentSessionFinished: async (params) => {
      trace.sessionsFinished.push(params);
      return {
        ok: true,
        session: {
          id: params.sessionId,
          workflowRunId: trace.tasks.at(-1)?.workflowRunId ?? 'run_eval_agent',
          stepRunId: trace.tasks.at(-1)?.stepRunId ?? null,
          agentTaskId: trace.tasks.at(-1)?.id ?? 'agt_eval_missing',
          agentResultId: params.agentResultId ?? null,
          backend: trace.tasks.at(-1)?.backend ?? 'native',
          stage: trace.sessionsStarted.at(-1)?.stage ?? 'implementation',
          skillId: trace.sessionsStarted.at(-1)?.skillId ?? 'skill.eval_agent',
          skillVersion: trace.sessionsStarted.at(-1)?.skillVersion ?? '1.0.0',
          contextPackId: trace.sessionsStarted.at(-1)?.contextPackId ?? 'ctx_eval',
          parentSessionId: null,
          retryIndex: 0,
          status: params.status,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          metadata: params.metadata ?? {},
        },
      };
    },
    postArtifact: async (params) => {
      const artifact: Artifact = {
        id: `art_eval_${trace.artifacts.length + 1}`,
        workflowRunId: params.workflowRunId,
        stepRunId: params.stepRunId,
        kind: params.kind,
        uri: params.uri,
        size: params.size,
        contentType: params.contentType,
        sha256: null,
        createdAt: new Date().toISOString(),
        metadata: params.metadata ?? {},
      };
      trace.artifacts.push(artifact);
      return artifact;
    },
    recordContextRequest: async (params) => {
      trace.contextRequests.push(params);
      return { ok: true };
    },
    recordKnowledgeUsage: async () => ({ ok: true }),
    recordKnowledgeAction: async () => ({ ok: true }),
  };
}

function fakeAgentBackend(
  input: AgentBackendEvalInput,
  trace: AgentBackendFixtureTrace,
  artifactsDir: string,
): AgentBackend {
  return {
    kind: 'native',
    run: async (_skill, ctx): Promise<AgentRunResult> => {
      trace.backendCalls += 1;
      if (input.behavior === 'failure') {
        throw new Error(input.errorMessage ?? 'eval fixture backend failure');
      }
      const outputName = input.outputName ?? 'eval-output.md';
      const outputPath = join(artifactsDir, outputName);
      const outputContent = input.outputContent ?? 'eval fixture output';
      await writeFile(outputPath, `${outputContent}\n`, 'utf8');
      return {
        outputs: [{
          name: outputName,
          path: outputPath,
          contentType: 'text/markdown',
          size: Buffer.byteLength(`${outputContent}\n`, 'utf8'),
        }],
        lastMessage: input.behavior === 'context_request' && trace.backendCalls === 1
          ? contextRequestMessage(input)
          : `completed ${ctx.title}`,
      };
    },
  };
}

function contextRequestMessage(input: AgentBackendEvalInput): string {
  const request = input.contextRequest ?? {};
  return [
    'Need more platform context.',
    '```json',
    JSON.stringify({
      context_request: {
        reason: request.reason ?? 'Need implementation context for the eval fixture.',
        requestedRefs: request.requestedRefs ?? ['code:apps/runner/src/orchestrator/invoke-skill.ts'],
        questions: request.questions ?? [],
        priority: request.priority ?? 1,
      },
    }),
    '```',
  ].join('\n');
}

function skillFixture(stage: WorkflowStage): SkillSpec {
  return {
    id: `skill.${stage}`,
    version: '1.0.0',
    stage,
    instructions: `Run the ${stage} eval fixture stage.`,
    inputs: [],
    outputs: [{ name: 'eval-output.md', kind: 'artifact', required: false, description: 'Eval output' }],
    toolPolicy: { allowedCommands: [], writableGlobs: [], networkAllowed: false },
    requiredGates: [],
    compatibleBackends: ['native'],
  };
}

function runCtxFixture(input: {
  projectId: string;
  workflowRunId: string;
  title: string;
  workspacePath: string;
  artifactsDir: string;
  backend: AgentBackend;
}): RunCtx {
  const now = new Date().toISOString();
  const project: Project = {
    id: input.projectId,
    name: 'Eval Fixture Project',
    localPath: input.workspacePath,
    language: 'unknown',
    buildTool: 'unknown',
    defaultBranch: 'main',
    registeredAt: now,
    agentBackend: 'codex',
  };
  const run: WorkflowRun = {
    id: input.workflowRunId,
    projectId: project.id,
    type: 'feature',
    status: 'running',
    currentStage: 'implementation',
    flowId: 'feature.standard',
    startStage: null,
    configSnapshotId: null,
    sourceBranch: 'main',
    branch: 'ai/eval-agent-fixture',
    workspacePath: input.workspacePath,
    title: input.title,
    createdAt: now,
    updatedAt: now,
  };
  return {
    project,
    run,
    workspace: {
      workflowRunId: run.id,
      path: input.workspacePath,
      branch: run.branch,
      environmentKind: 'trusted_local_worktree',
    },
    backend: input.backend,
    tools: { jdk: null, maven: null },
    opts: { project: project.name, title: input.title },
    runArtifactsDir: input.artifactsDir,
    inputs: { user_request: input.title },
    inputArtifactIds: {},
    contextFoundation: {
      projectProfileResult: {
        profile: {
          projectId: project.id,
          name: project.name,
          localPath: project.localPath,
          generatedAt: now,
          buildTool: 'unknown',
          language: 'unknown',
          pom: null,
          topLevelPackages: [],
          testFiles: [],
          readmePreview: null,
          treeOutline: [],
        },
        markdown: '# Project Profile\n\n- Build tool: unknown',
        profileDir: input.artifactsDir,
        profileMdPath: join(input.artifactsDir, 'profile.md'),
        profileJsonPath: join(input.artifactsDir, 'profile.json'),
      },
      acceptedKnowledge: '',
      knowledgeArtifacts: [],
      runHistory: [],
    },
    contextPolicy: {
      budget: { maxTokens: 100_000, reservedForReasoning: 20_000, reservedForOutput: 8_000 },
      sensitivePathPatterns: [],
    },
    contextRequestChain: [],
    draftsToPromote: [],
    ok: { value: true },
  };
}

function projectFixture(projectId: string, workspacePath: string, now: string): Project {
  return {
    id: projectId,
    name: 'Eval Fixture Project',
    localPath: workspacePath,
    language: 'unknown',
    buildTool: 'unknown',
    defaultBranch: 'main',
    registeredAt: now,
    agentBackend: 'codex',
  };
}

function workflowRunFixture(input: {
  id: string;
  projectId: string;
  title: string;
  workspacePath: string;
  now: string;
  status?: WorkflowRun['status'];
}): WorkflowRun {
  return {
    id: input.id,
    projectId: input.projectId,
    type: 'feature',
    status: input.status ?? 'running',
    currentStage: 'implementation',
    flowId: 'feature.standard',
    startStage: null,
    configSnapshotId: null,
    sourceBranch: 'main',
    branch: 'ai/eval-fixture',
    workspacePath: input.workspacePath,
    title: input.title,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

function projectProfileFixture(project: Project, now: string): ProjectProfile {
  return {
    projectId: project.id,
    name: project.name,
    localPath: project.localPath,
    generatedAt: now,
    buildTool: project.buildTool,
    language: project.language,
    pom: null,
    topLevelPackages: [],
    testFiles: [],
    readmePreview: null,
    treeOutline: [],
  };
}

function contextPackFixtureOutput(pack: ContextPack): ContextPackFixtureOutput {
  const sourceRefs = uniqueStrings(pack.manifest.flatMap((item) => item.sourceRefs));
  const authoritativeSourceRefs = uniqueStrings(pack.manifest
    .filter((item) => item.mode === 'full' && item.trustLevel === 'accepted_knowledge')
    .flatMap((item) => item.sourceRefs));
  return {
    contextPackId: pack.id,
    mode: pack.mode,
    manifestRefs: pack.manifest.map((item) => item.ref),
    sourceRefs,
    selected: pack.manifest.map((item) => ({
      ref: item.ref,
      mode: item.mode,
      trustLevel: item.trustLevel,
      freshness: item.freshness,
      knowledgeClass: item.knowledgeClass,
      sourceRefs: item.sourceRefs,
      degradationReason: item.degradationReason ?? null,
    })),
    authoritativeSourceRefs,
    retrievalHints: pack.retrievalHints.map((hint) => hint.id),
    calibrationSignalCount: pack.calibrationSignals?.length ?? 0,
  };
}

function seedWorkflowEvidenceFixture(input: {
  store: typeof import('../apps/api/src/store/store')['store'];
  workDir: string;
  workflowRunId: string;
  stepRunId: string;
  profile: WorkflowFixtureProfile;
  now: string;
}): void {
  const stdoutPath = join(input.workDir, `${input.profile}-stdout.log`);
  const stderrPath = join(input.workDir, `${input.profile}-stderr.log`);
  const diffPath = join(input.workDir, `${input.profile}-changes.diff`);
  const reviewPath = join(input.workDir, `${input.profile}-review.md`);
  const surefirePath = join(input.workDir, `${input.profile}-TEST.xml`);
  const stdout = 'BUILD SUCCESS\n';
  const stderr = '';
  const diff = 'diff --git a/src/main.ts b/src/main.ts\n';
  const review = '# Review\n\nVerified with fixture evidence.\n';
  const surefire = '<testsuite tests="1" failures="0" errors="0" skipped="0"></testsuite>\n';
  for (const [path, content] of [
    [stdoutPath, stdout],
    [stderrPath, stderr],
    [diffPath, diff],
    [reviewPath, review],
    [surefirePath, surefire],
  ] as const) {
    writeFileSync(path, content);
  }

  const artifacts = [
    artifactFixture('art_eval_diff', 'diff', diffPath, input.workflowRunId, input.stepRunId, 'text/x-diff', input.now),
    artifactFixture('art_eval_review', 'other', reviewPath, input.workflowRunId, input.stepRunId, 'text/markdown', input.now),
    artifactFixture('art_eval_surefire', 'surefire_report', surefirePath, input.workflowRunId, input.stepRunId, 'application/xml', input.now),
  ];
  for (const artifact of artifacts) input.store.artifacts.insert(artifact);

  const commandDigest = input.profile === 'missing_command_digest'
    ? { stdoutSha256: null, stderrSha256: null, combinedSha256: null }
    : {
      stdoutSha256: sha256Text(stdout),
      stderrSha256: sha256Text(stderr),
      combinedSha256: sha256Text(`${stdout}\0${stderr}`),
    };
  const compileCommand: CommandRun = {
    id: `cmd_${safeId(input.profile)}_compile`,
    workflowRunId: input.workflowRunId,
    stepRunId: input.stepRunId,
    cwd: input.workDir,
    command: 'bun run typecheck',
    stage: 'compile',
    status: 'passed',
    exitCode: 0,
    startedAt: input.now,
    finishedAt: input.now,
    durationMs: 1,
    stdoutRef: `file://${stdoutPath}`,
    stderrRef: `file://${stderrPath}`,
    stdoutBytes: Buffer.byteLength(stdout),
    stderrBytes: Buffer.byteLength(stderr),
    ...commandDigest,
    timedOut: false,
    truncated: false,
  };
  const testCommand: CommandRun = {
    ...compileCommand,
    id: `cmd_${safeId(input.profile)}_test`,
    command: 'bun test',
    stage: 'test',
  };
  if (input.profile !== 'artifact_only_compile') {
    input.store.commandRuns.set(compileCommand.id, compileCommand);
    input.store.commandRuns.set(testCommand.id, testCommand);
  }

  const commandRunIds = input.profile === 'artifact_only_compile'
    ? []
    : [compileCommand.id, testCommand.id];
  const commandEvidence = commandRunIds.map((id) => ({
    artifactId: id,
    claim: `command ${id} passed`,
  }));
  const diffReviewEvidence = [
    { artifactId: 'art_eval_diff', claim: 'implementation diff' },
    { artifactId: 'art_eval_review', claim: 'review artifact' },
    { artifactId: 'art_eval_surefire', claim: 'test report artifact' },
  ];
  input.store.gateRuns.insert(gateFixture({
    id: `gate_${safeId(input.profile)}_compile`,
    gateId: 'compile_gate',
    workflowRunId: input.workflowRunId,
    stepRunId: input.stepRunId,
    ruleId: 'compile.exit_zero',
    evidenceRefs: input.profile === 'artifact_only_compile'
      ? [{ artifactId: 'art_eval_review', claim: 'compile note without command evidence' }]
      : commandEvidence.slice(0, 1),
    commandRunIds: commandRunIds.slice(0, 1),
    now: input.now,
  }));
  input.store.gateRuns.insert(gateFixture({
    id: `gate_${safeId(input.profile)}_test`,
    gateId: 'test_gate',
    workflowRunId: input.workflowRunId,
    stepRunId: input.stepRunId,
    ruleId: 'test.exit_zero',
    evidenceRefs: input.profile === 'artifact_only_compile'
      ? [{ artifactId: 'art_eval_surefire', claim: 'test report artifact' }]
      : commandEvidence.slice(1, 2),
    commandRunIds: commandRunIds.slice(1, 2),
    now: input.now,
  }));
  input.store.gateRuns.insert(gateFixture({
    id: `gate_${safeId(input.profile)}_acceptance`,
    gateId: 'acceptance_gate',
    workflowRunId: input.workflowRunId,
    stepRunId: input.stepRunId,
    ruleId: 'acceptance.diff_present',
    evidenceRefs: diffReviewEvidence,
    commandRunIds,
    now: input.now,
    ruleResults: [
      { ruleId: 'acceptance.diff_present', status: 'pass', message: 'diff artifact present', evidenceRefs: [diffReviewEvidence[0]!] },
      { ruleId: 'acceptance.review_present', status: 'pass', message: 'review artifact present', evidenceRefs: [diffReviewEvidence[1]!] },
      { ruleId: 'acceptance.test_gate_passed', status: 'pass', message: 'test evidence present', evidenceRefs: [diffReviewEvidence[2]!] },
    ],
  }));
}

function artifactFixture(
  id: string,
  kind: Artifact['kind'],
  path: string,
  workflowRunId: string,
  stepRunId: string,
  contentType: string,
  now: string,
): Artifact {
  const content = readFileSync(path);
  return {
    id,
    kind,
    uri: `file://${path}`,
    workflowRunId,
    stepRunId,
    size: content.byteLength,
    contentType,
    sha256: sha256Text(content),
    createdAt: now,
    metadata: {},
  };
}

function gateFixture(input: {
  id: string;
  gateId: GateRun['gateId'];
  workflowRunId: string;
  stepRunId: string;
  ruleId: string;
  evidenceRefs: GateRun['evidenceRefs'];
  commandRunIds: string[];
  now: string;
  ruleResults?: GateRun['ruleResults'];
}): GateRun {
  const ruleResults = input.ruleResults ?? [{
    ruleId: input.ruleId,
    status: 'pass' as const,
    message: `${input.gateId} passed in fixture`,
    evidenceRefs: input.evidenceRefs,
  }];
  return {
    id: input.id,
    gateId: input.gateId,
    workflowRunId: input.workflowRunId,
    stepRunId: input.stepRunId,
    status: 'pass',
    ruleResults,
    evidenceRefs: input.evidenceRefs,
    commandRunIds: input.commandRunIds,
    decidedAt: input.now,
    agentNote: null,
  };
}

function checkRouterOutput(
  output: ReturnType<(typeof import('../apps/api/src/router'))['recommend']>,
  expectations: RouterExpectations,
): EvalCheck[] {
  const checks: EvalCheck[] = [];
  if (expectations.flowId !== undefined) {
    checks.push(check('flowId', expectations.flowId, output.flowId));
  }
  if ('startStage' in expectations) {
    checks.push(check('startStage', expectations.startStage ?? null, output.startStage));
  }
  if (expectations.relevantKnowledgeMin !== undefined) {
    checks.push({
      name: 'relevantKnowledgeMin',
      expected: expectations.relevantKnowledgeMin,
      actual: output.relevantKnowledge.length,
      status: output.relevantKnowledge.length >= expectations.relevantKnowledgeMin ? 'pass' : 'fail',
    });
  }
  if (expectations.relevantKnowledgeMax !== undefined) {
    checks.push({
      name: 'relevantKnowledgeMax',
      expected: expectations.relevantKnowledgeMax,
      actual: output.relevantKnowledge.length,
      status: output.relevantKnowledge.length <= expectations.relevantKnowledgeMax ? 'pass' : 'fail',
    });
  }
  for (const rule of expectations.rulesFiredIncludes ?? []) {
    checks.push({
      name: `rulesFiredIncludes:${rule}`,
      expected: rule,
      actual: output.rulesFired,
      status: output.rulesFired.includes(rule) ? 'pass' : 'fail',
    });
  }
  return checks;
}

function checkAgentBackendOutput(
  output: AgentBackendFixtureOutput,
  expectations: AgentBackendExpectations,
): EvalCheck[] {
  const checks: EvalCheck[] = [];
  if (expectations.sessionStarted !== undefined) {
    checks.push(check('sessionStarted', expectations.sessionStarted, output.sessionIds.length > 0));
  }
  if (expectations.sessionFinished !== undefined) {
    checks.push(check('sessionFinished', expectations.sessionFinished, output.sessionFinishes.length > 0));
  }
  if (expectations.finalStatus !== undefined) {
    checks.push(check('finalStatus', expectations.finalStatus, output.sessionFinishes.at(-1)?.status ?? null));
  }
  if (expectations.resultLinked !== undefined) {
    checks.push(check(
      'resultLinked',
      expectations.resultLinked,
      Boolean(output.sessionFinishes.at(-1)?.agentResultId),
    ));
  }
  if (expectations.errorObserved !== undefined) {
    checks.push(check('errorObserved', expectations.errorObserved, output.errorObserved));
  }
  if (expectations.contextRequestCaptured !== undefined) {
    checks.push(check(
      'contextRequestCaptured',
      expectations.contextRequestCaptured,
      output.contextRequestIds.length > 0,
    ));
  }
  if (expectations.outputCount !== undefined) {
    checks.push(check('outputCount', expectations.outputCount, output.outputCount));
  }
  if (expectations.backendCalls !== undefined) {
    checks.push(check('backendCalls', expectations.backendCalls, output.backendCalls));
  }
  if (expectations.externalCliUsed !== undefined) {
    checks.push(check('externalCliUsed', expectations.externalCliUsed, output.externalCliUsed));
  }
  return checks;
}

function checkContextPackOutput(
  output: ContextPackFixtureOutput,
  expectations: ContextPackExpectations,
): EvalCheck[] {
  const checks: EvalCheck[] = [];
  if (expectations.mode !== undefined) {
    checks.push(check('mode', expectations.mode, output.mode));
  }
  for (const ref of expectations.manifestRefsInclude ?? []) {
    checks.push(includesCheck(`manifestRefsInclude:${ref}`, output.manifestRefs, ref, true));
  }
  for (const ref of expectations.manifestRefsExclude ?? []) {
    checks.push(includesCheck(`manifestRefsExclude:${ref}`, output.manifestRefs, ref, false));
  }
  for (const ref of expectations.sourceRefsInclude ?? []) {
    checks.push(includesCheck(`sourceRefsInclude:${ref}`, output.sourceRefs, ref, true));
  }
  for (const ref of expectations.sourceRefsExclude ?? []) {
    checks.push(includesCheck(`sourceRefsExclude:${ref}`, output.sourceRefs, ref, false));
  }
  for (const ref of expectations.authoritativeSourceRefsExclude ?? []) {
    checks.push(includesCheck(`authoritativeSourceRefsExclude:${ref}`, output.authoritativeSourceRefs, ref, false));
  }
  for (const [sectionRef, mode] of Object.entries(expectations.sectionModes ?? {})) {
    checks.push(check(`sectionMode:${sectionRef}`, mode, output.selected.find((item) => item.ref === sectionRef)?.mode ?? null));
  }
  if (expectations.retrievalHintsMin !== undefined) {
    checks.push({
      name: 'retrievalHintsMin',
      expected: expectations.retrievalHintsMin,
      actual: output.retrievalHints.length,
      status: output.retrievalHints.length >= expectations.retrievalHintsMin ? 'pass' : 'fail',
    });
  }
  if (expectations.calibrationSignalsMin !== undefined) {
    checks.push({
      name: 'calibrationSignalsMin',
      expected: expectations.calibrationSignalsMin,
      actual: output.calibrationSignalCount,
      status: output.calibrationSignalCount >= expectations.calibrationSignalsMin ? 'pass' : 'fail',
    });
  }
  if (expectations.selectedCountMin !== undefined) {
    checks.push({
      name: 'selectedCountMin',
      expected: expectations.selectedCountMin,
      actual: output.selected.length,
      status: output.selected.length >= expectations.selectedCountMin ? 'pass' : 'fail',
    });
  }
  if (expectations.selectedCountMax !== undefined) {
    checks.push({
      name: 'selectedCountMax',
      expected: expectations.selectedCountMax,
      actual: output.selected.length,
      status: output.selected.length <= expectations.selectedCountMax ? 'pass' : 'fail',
    });
  }
  return checks;
}

function checkWorkflowOutput(
  output: WorkflowFixtureOutput,
  expectations: WorkflowExpectations,
): EvalCheck[] {
  const checks: EvalCheck[] = [];
  if (expectations.evidenceGateStatus !== undefined) {
    checks.push(check('evidenceGateStatus', expectations.evidenceGateStatus, output.evidenceGateStatus));
  }
  for (const [ruleId, status] of Object.entries(expectations.ruleStatuses ?? {})) {
    checks.push(check(`ruleStatus:${ruleId}`, status, output.ruleStatuses[ruleId] ?? null));
  }
  if (expectations.commandDigestBacked !== undefined) {
    checks.push(check('commandDigestBacked', expectations.commandDigestBacked, output.commandDigestBacked));
  }
  if (expectations.completionReportGenerated !== undefined) {
    checks.push(check('completionReportGenerated', expectations.completionReportGenerated, output.completionReportGenerated));
  }
  if (expectations.completionReportHasStatusAtGeneration !== undefined) {
    checks.push(check(
      'completionReportHasStatusAtGeneration',
      expectations.completionReportHasStatusAtGeneration,
      output.completionReportHasStatusAtGeneration,
    ));
  }
  if (expectations.retroReportGenerated !== undefined) {
    checks.push(check('retroReportGenerated', expectations.retroReportGenerated, output.retroReportGenerated));
  }
  if (expectations.retroFindingsMin !== undefined) {
    checks.push({
      name: 'retroFindingsMin',
      expected: expectations.retroFindingsMin,
      actual: output.retroFindings,
      status: output.retroFindings >= expectations.retroFindingsMin ? 'pass' : 'fail',
    });
  }
  if (expectations.reportArtifactCountMin !== undefined) {
    checks.push({
      name: 'reportArtifactCountMin',
      expected: expectations.reportArtifactCountMin,
      actual: output.reportArtifactCount,
      status: output.reportArtifactCount >= expectations.reportArtifactCountMin ? 'pass' : 'fail',
    });
  }
  return checks;
}

function check(name: string, expected: unknown, actual: unknown): EvalCheck {
  return {
    name,
    expected,
    actual,
    status: Object.is(expected, actual) ? 'pass' : 'fail',
  };
}

function includesCheck(name: string, actual: readonly string[], value: string, expected: boolean): EvalCheck {
  const includes = actual.includes(value);
  return {
    name,
    expected,
    actual,
    status: includes === expected ? 'pass' : 'fail',
  };
}

function knowledgeArtifactFixture(
  args: KnowledgeArtifactFixture & { id: string; projectId: string },
): KnowledgeArtifact {
  const ts = new Date().toISOString();
  return {
    id: args.id,
    kind: args.kind,
    uri: `mem://${args.entityId}.md`,
    projectId: args.projectId,
    size: 1,
    contentType: 'text/markdown',
    status: args.status ?? 'accepted',
    version: 1,
    entityId: args.entityId,
    derivedFromArtifactId: null,
    subtype: args.subtype ?? null,
    createdAt: ts,
    updatedAt: ts,
    metadata: args.metadata ?? {},
  };
}

function mergeInput<Input extends RouterEvalInput | AgentBackendEvalInput | ContextPackEvalInput | WorkflowEvalInput>(
  base: Input,
  overrides: Partial<Input> = {},
): Input {
  return {
    ...base,
    ...overrides,
    ...('messageHistory' in base || 'messageHistory' in overrides
      ? { messageHistory: (overrides as Partial<RouterEvalInput>).messageHistory ?? (base as RouterEvalInput).messageHistory }
      : {}),
    ...('knowledgeArtifacts' in base || 'knowledgeArtifacts' in overrides
      ? { knowledgeArtifacts: (overrides as Partial<RouterEvalInput>).knowledgeArtifacts ?? (base as RouterEvalInput).knowledgeArtifacts }
      : {}),
  } as Input;
}

function validateScenario(scenario: EvalScenario, source: string): void {
  if (scenario.schemaVersion !== 'ainp.eval.scenario.v1') {
    throw new Error(`${source}: unsupported schemaVersion ${String(scenario.schemaVersion)}`);
  }
  if (!scenario.id || !scenario.title) throw new Error(`${source}: id and title are required`);
  if (
    scenario.kind !== 'router_recommendation'
    && scenario.kind !== 'agent_backend_fixture'
    && scenario.kind !== 'context_pack_fixture'
    && scenario.kind !== 'workflow_fixture'
  ) {
    throw new Error(`${source}: unsupported kind ${String(scenario.kind)}`);
  }
  if (scenario.kind === 'router_recommendation' && (!scenario.input?.projectId || !scenario.input.title || !scenario.input.runType)) {
    throw new Error(`${source}: input.projectId, input.title, and input.runType are required`);
  }
  if (scenario.kind === 'agent_backend_fixture' && (!scenario.input?.title || !scenario.input.behavior)) {
    throw new Error(`${source}: input.title and input.behavior are required`);
  }
  if (scenario.kind === 'context_pack_fixture' && !scenario.input?.title) {
    throw new Error(`${source}: input.title is required`);
  }
  if (scenario.kind === 'workflow_fixture' && (!scenario.input?.title || !scenario.input.profile)) {
    throw new Error(`${source}: input.title and input.profile are required`);
  }
}

function parseArgs(args: string[]): { scenarioDir?: string; outDir?: string } {
  const parsed: { scenarioDir?: string; outDir?: string } = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--scenario-dir') parsed.scenarioDir = args[++i];
    else if (arg === '--out-dir') parsed.outDir = args[++i];
    else if (arg === '-h' || arg === '--help') {
      console.log('Usage: bun run eval -- [--scenario-dir eval/scenarios] [--out-dir .ainp/evals]');
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function safeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'x';
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function sha256Text(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function renderHtml(report: EvalReport): string {
  const rows = report.results.flatMap((scenario) =>
    scenario.variants.map((variant) => `
      <tr class="${variant.status}">
        <td>${escapeHtml(scenario.scenarioId)}</td>
        <td>${escapeHtml(scenario.kind)}</td>
        <td>${escapeHtml(variant.variantId)}</td>
        <td>${escapeHtml(variant.backend)}</td>
        <td>${escapeHtml(variant.knowledgeVariant ?? '-')}</td>
        <td>${escapeHtml(variant.skillVariant ?? '-')}</td>
        <td>${variant.status}</td>
        <td><pre>${escapeHtml(JSON.stringify(variant.output, null, 2))}</pre></td>
        <td><pre>${escapeHtml(JSON.stringify(variant.checks, null, 2))}</pre></td>
      </tr>`),
  ).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>AINP Eval Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; color: #172026; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #d7dde2; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #f3f6f8; }
    tr.pass td:nth-child(7) { color: #147a3d; font-weight: 700; }
    tr.fail td:nth-child(7) { color: #b42318; font-weight: 700; }
    pre { margin: 0; max-width: 420px; white-space: pre-wrap; font-size: 12px; }
  </style>
</head>
<body>
  <h1>AINP Eval Report</h1>
  <p>Generated at ${escapeHtml(report.generatedAt)}. Scenarios: ${report.summary.scenarios}; variants: ${report.summary.variantRuns}; passed: ${report.summary.passed}; failed: ${report.summary.failed}.</p>
  <table>
    <thead>
      <tr><th>Scenario</th><th>Kind</th><th>Variant</th><th>Backend</th><th>Knowledge</th><th>Skill</th><th>Status</th><th>Output</th><th>Checks</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char] ?? char);
}

await main();
