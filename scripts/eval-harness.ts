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
import { lstat, mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
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
  GraphDefinition,
  GraphNodeRun,
  GraphNodeStatus,
  KnowledgeArtifact,
  KnowledgeArtifactKind,
  Project,
  RuleStatus,
  RouterInput,
  SkillSpec,
  StepCheckpoint,
  StepRun,
  ToolInvocation,
  WorkflowRun,
  WorkflowRunType,
  WorkflowStage,
} from '@ainp/shared';
import { FLOW_REGISTRY } from '../packages/shared/src/flows/registry';
import {
  flowToGraphDefinition,
  graphStageOrder,
} from '../packages/shared/src/flows/graph-adapter';
import { branchFanOutGraphDefinition } from '../packages/shared/src/flows/graph-fixtures';
import { VERIFIER_AC_MATRIX_SCHEMA_VERSION } from '../packages/shared/src/types/artifact';
import type { AgentBackend, AgentRunResult } from '../apps/runner/src/agents/types';
import type { InventoryLimits, ProjectInventoryEnvelope } from '../apps/runner/src/project-inventory';
import type { InvokeSkillDeps } from '../apps/runner/src/orchestrator/invoke-skill';
import type { StepDeps } from '../apps/runner/src/orchestrator/steps';
import type { RunCtx } from '../apps/runner/src/orchestrator/types';
import type { ProjectProfile } from '../apps/runner/src/profile';

type ScenarioKind =
  | 'router_recommendation'
  | 'agent_backend_fixture'
  | 'context_pack_fixture'
  | 'workflow_fixture'
  | 'graph_runtime_fixture'
  | 'legacy_project_understanding_fixture';

type EvalScenario =
  | RouterEvalScenario
  | AgentBackendEvalScenario
  | ContextPackEvalScenario
  | WorkflowEvalScenario
  | GraphRuntimeEvalScenario
  | LegacyProjectUnderstandingEvalScenario;

interface BaseEvalScenario {
  schemaVersion: 'ainp.eval.scenario.v1';
  id: string;
  title: string;
  description?: string;
  kind: ScenarioKind;
  sourcePath?: string;
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

interface GraphRuntimeEvalScenario extends BaseEvalScenario {
  kind: 'graph_runtime_fixture';
  input: GraphRuntimeEvalInput;
  expectations?: GraphRuntimeExpectations;
  variants?: GraphRuntimeEvalVariant[];
}

interface LegacyProjectUnderstandingEvalScenario extends BaseEvalScenario {
  kind: 'legacy_project_understanding_fixture';
  input: LegacyProjectUnderstandingEvalInput;
  expectations?: LegacyProjectUnderstandingExpectations;
  variants?: LegacyProjectUnderstandingEvalVariant[];
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
type GraphRuntimeEvalVariant = EvalVariant<GraphRuntimeEvalInput, GraphRuntimeExpectations>;
type LegacyProjectUnderstandingEvalVariant = EvalVariant<
  LegacyProjectUnderstandingEvalInput,
  LegacyProjectUnderstandingExpectations
>;

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

type AgentBackendBehavior = 'success' | 'failure' | 'context_request' | 'profile_bootstrap_success';

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
  profileBootstrapFlow?: boolean;
  profileFlowStages?: WorkflowStage[];
  inventoryArtifactPersisted?: boolean;
  sourceChunkIndexArtifactPersisted?: boolean;
  sourceChunkIndexNotInjectedAsInput?: boolean;
  profileArtifactCount?: number;
  profileJsonContractValid?: boolean;
  profileJsonProvenanceValid?: boolean;
  rawInventoryExcludedFromProfileMarkdown?: boolean;
  knowledgeCandidateReviewableOnly?: boolean;
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
  selectedSectionsInclude?: SelectedSectionExpectation[];
  relevantManifestRefPrefixes?: string[];
  irrelevantContextRatioMax?: number;
  contextQualityGates?: ContextQualityScenarioGates;
  sourceRefsInclude?: string[];
  sourceRefsExclude?: string[];
  authoritativeSourceRefsExclude?: string[];
  sectionModes?: Record<string, ContextInclusionMode>;
  retrievalHintsMin?: number;
  calibrationSignalsMin?: number;
  calibrationSignalsInclude?: CalibrationSignalExpectation[];
  selectedCountMin?: number;
  selectedCountMax?: number;
}

interface CalibrationSignalExpectation {
  id?: string;
  kind?: string;
  severity?: string;
  recommendedAction?: string;
  messageIncludes?: string[];
  messageExcludes?: string[];
  subjectRefsInclude?: string[];
  subjectRefsExclude?: string[];
  evidenceRefsInclude?: string[];
  evidenceRefsExclude?: string[];
}

interface SelectedSectionExpectation {
  ref: string;
  mode?: ContextInclusionMode;
  contentIncludes?: string[];
  contentExcludes?: string[];
  reasonIncludes?: string[];
  reasonExcludes?: string[];
  sourceRefsInclude?: string[];
  sourceRefsExclude?: string[];
}

interface ContextQualityScenarioGates {
  measuredVariantsMin?: number;
  irrelevantContextRatioAverageMax?: number;
  irrelevantContextRatioMax?: number;
}

interface LegacyInventoryQualityScenarioGates {
  measuredVariantsMin?: number;
  graphEdgeConfidenceMin?: number;
  routeHandlerEdgeConfidenceMin?: number;
  sourceChunkContentSha256CoverageMin?: number;
  sourceChunkIndexCoverageMin?: number;
  sourceChunkLinkedRecordCoverageMin?: number;
  sourceFileExtensionCountMin?: number;
  sourcePathPatternCountMin?: number;
  sourceRecordKindCountMin?: number;
}

interface LegacyProjectUnderstandingEvalInput {
  projectId?: string;
  workflowRunId?: string;
  title: string;
  stage?: WorkflowStage;
  taskBrief?: string;
  files?: Array<{
    path: string;
    content: string;
  }>;
  fixtureDir?: LegacyProjectUnderstandingFixtureDirInput;
  inventoryLimits?: Partial<InventoryLimits>;
  budget?: Partial<ContextPackBudget>;
  sensitivePathPatterns?: string[];
}

interface LegacyProjectUnderstandingFixtureDirInput {
  path: string;
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  excludePaths?: string[];
}

interface LegacyProjectUnderstandingExpectations extends ContextPackExpectations {
  inventoryQualityGates?: LegacyInventoryQualityScenarioGates;
  inventoryCapabilityLabelsInclude?: string[];
  inventoryCapabilityLabelsExclude?: string[];
  inventoryCapabilityCountMin?: number;
  inventoryCapabilityCountMax?: number;
  inventoryEntrypointRoutesInclude?: string[];
  inventoryEntrypointRouteCountMin?: number;
  inventoryEntrypointRouteCountMax?: number;
  inventorySymbolNamesInclude?: string[];
  inventorySymbolCountMin?: number;
  inventoryGraphEdgeKindsInclude?: string[];
  inventoryGraphEdgeCountMin?: number;
  inventoryGraphEdgeConfidenceMin?: number;
  inventoryRouteHandlerEdgeCountMin?: number;
  inventoryRouteHandlerEdgeConfidenceMin?: number;
  inventorySourceChunkGraphEdgeRefsInclude?: string[];
  inventorySourceChunkCountMin?: number;
  inventoryExclusionsInclude?: string[];
  inventoryExclusionCountMin?: number;
}

type WorkflowFixtureProfile =
  | 'complete'
  | 'missing_command_digest'
  | 'artifact_only_compile'
  | 'captcha_business_acceptance'
  | 'captcha_test_only';

interface WorkflowEvalInput {
  projectId?: string;
  workflowRunId?: string;
  title: string;
  profile: WorkflowFixtureProfile;
}

type GraphRuntimeFixtureProfile =
  | 'linear_equivalence'
  | 'failed_resume'
  | 'completed_resume'
  | 'branch_fanout'
  | 'branch_duplicate_evidence';

interface GraphRuntimeEvalInput {
  projectId?: string;
  workflowRunId?: string;
  title: string;
  flowId: FlowId;
  profile: GraphRuntimeFixtureProfile;
  stage?: WorkflowStage;
  graphVersion?: string;
  resumeCursor?: string | null;
}

interface WorkflowExpectations {
  acceptanceGateStatus?: GateStatus;
  acceptanceRuleStatuses?: Record<string, RuleStatus>;
  evidenceGateStatus?: GateStatus;
  ruleStatuses?: Record<string, RuleStatus>;
  businessMatrixRows?: number;
  businessMatrixScenarioTypes?: string[];
  commandDigestBacked?: boolean;
  completionReportGenerated?: boolean;
  completionReportHasStatusAtGeneration?: boolean;
  completionReportHasBusinessMatrix?: boolean;
  retroReportGenerated?: boolean;
  retroFindingsMin?: number;
  reportArtifactCountMin?: number;
}

interface GraphRuntimeExpectations {
  stageOrderMatchesFlow?: boolean;
  stageOrder?: WorkflowStage[];
  runnableStages?: WorkflowStage[];
  branchEvidenceIsolated?: boolean;
  branchNodeRunCount?: number;
  resumeCreated?: boolean;
  resumeRejected?: boolean;
  resumeAttempt?: number;
  resumeStatus?: GraphNodeStatus;
  resumeErrorIncludes?: string;
  sourceCheckpointLinked?: boolean;
  graphEventTypesInclude?: string[];
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
    scenarioChecks: {
      passed: number;
      failed: number;
    };
  };
  legacyInventorySummary: LegacyInventoryEvalSummary | null;
  results: EvalScenarioResult[];
}

interface EvalScenarioResult {
  scenarioId: string;
  title: string;
  kind: ScenarioKind;
  variants: EvalVariantResult[];
  scenarioChecks?: EvalCheck[];
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

interface ContextQualityMetrics {
  relevantManifestRefPrefixes: string[];
  selectedCount: number;
  relevantCount: number;
  irrelevantCount: number;
  irrelevantRatio: number;
  irrelevantRefs: string[];
}

interface LegacyInventoryStats {
  capabilityCount: number;
  entrypointRouteCount: number;
  symbolCount: number;
  graphEdgeCount: number;
  routeHandlerEdgeCount: number;
  sourceChunkCount: number;
  sourceChunkContentSha256Count: number;
  sourceChunkIndexEntryCount: number;
  sourceChunkIndexedCount: number;
  sourceChunkLinkedRecordCount: number;
  sourceFileExtensionCount: number;
  sourcePathPatternCount: number;
  sourceRecordKindCount: number;
  exclusionCount: number;
}

interface LegacyInventoryEvalSummaryVariant {
  scenarioId: string;
  variantId: string;
  status: 'pass' | 'fail';
  selectedContextSections: number;
  irrelevantContextRatio: number | null;
  stats: LegacyInventoryStats;
}

interface LegacyInventoryEvalSummary {
  scenarioCount: number;
  variantRuns: number;
  totals: LegacyInventoryStats;
  averages: LegacyInventoryStats;
  min: LegacyInventoryStats;
  max: LegacyInventoryStats;
  selectedContextSections: {
    total: number;
    average: number;
    min: number;
    max: number;
  };
  contextQuality: {
    measuredVariants: number;
    irrelevantContextRatioAverage: number | null;
    irrelevantContextRatioMax: number | null;
  };
  variants: LegacyInventoryEvalSummaryVariant[];
}

const repoRoot = resolve(import.meta.dir, '..');
const DEFAULT_LEGACY_GRAPH_EDGE_CONFIDENCE_MIN = 0.65;
const DEFAULT_LEGACY_ROUTE_HANDLER_EDGE_CONFIDENCE_MIN = 0.78;
const DEFAULT_LEGACY_FIXTURE_DIR_MAX_FILES = 256;
const DEFAULT_LEGACY_FIXTURE_DIR_MAX_FILE_BYTES = 128 * 1024;
const DEFAULT_LEGACY_FIXTURE_DIR_MAX_TOTAL_BYTES = 2 * 1024 * 1024;

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
  const scenarioChecks = results.flatMap((result) => result.scenarioChecks ?? []);
  const passed = variantResults.filter((result) => result.status === 'pass').length;
  const failed = variantResults.length - passed;
  const passedScenarioChecks = scenarioChecks.filter((check) => check.status === 'pass').length;
  const failedScenarioChecks = scenarioChecks.length - passedScenarioChecks;
  const report: EvalReport = {
    schemaVersion: 'ainp.eval.result.v1',
    generatedAt: new Date().toISOString(),
    scenarioDir,
    summary: {
      scenarios: scenarios.length,
      variantRuns: variantResults.length,
      passed,
      failed: failed + failedScenarioChecks,
      scenarioChecks: {
        passed: passedScenarioChecks,
        failed: failedScenarioChecks,
      },
    },
    legacyInventorySummary: buildLegacyInventorySummary(results),
    results,
  };

  await mkdir(outDir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const jsonPath = join(outDir, `eval-${stamp}.json`);
  const htmlPath = join(outDir, `eval-${stamp}.html`);
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(htmlPath, renderHtml(report), 'utf8');

  console.log(`[eval] scenarios=${report.summary.scenarios} variants=${report.summary.variantRuns} passed=${report.summary.passed} failed=${report.summary.failed} scenarioChecks=${report.summary.scenarioChecks.passed}/${report.summary.scenarioChecks.failed}`);
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
    scenarios.push({ ...parsed, sourcePath: path });
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
  if (scenario.kind === 'graph_runtime_fixture') {
    return runGraphRuntimeScenario(scenario);
  }
  if (scenario.kind === 'legacy_project_understanding_fixture') {
    return runLegacyProjectUnderstandingScenario(scenario);
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
  const scenarioChecks = [
    ...checkScenarioContextQuality(variantResults, scenario.expectations?.contextQualityGates),
    ...checkInventorySectionGateCoverage(scenario),
  ];
  return {
    scenarioId: scenario.id,
    title: scenario.title,
    kind: scenario.kind,
    variants: variantResults,
    scenarioChecks,
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

async function runGraphRuntimeScenario(scenario: GraphRuntimeEvalScenario): Promise<EvalScenarioResult> {
  const variants = scenario.variants?.length
    ? scenario.variants
    : [{ id: 'default', label: 'Default' } satisfies GraphRuntimeEvalVariant];
  const variantResults: EvalVariantResult[] = [];
  for (const variant of variants) {
    const input = mergeInput(scenario.input, variant.inputOverrides);
    const expectations = { ...(scenario.expectations ?? {}), ...(variant.expectations ?? {}) };
    variantResults.push(await runGraphRuntimeVariant(scenario, variant, input, expectations));
  }
  return {
    scenarioId: scenario.id,
    title: scenario.title,
    kind: scenario.kind,
    variants: variantResults,
  };
}

async function runLegacyProjectUnderstandingScenario(
  scenario: LegacyProjectUnderstandingEvalScenario,
): Promise<EvalScenarioResult> {
  const variants = scenario.variants?.length
    ? scenario.variants
    : [{ id: 'default', label: 'Default' } satisfies LegacyProjectUnderstandingEvalVariant];
  const variantResults: EvalVariantResult[] = [];
  for (const variant of variants) {
    const input = mergeInput(scenario.input, variant.inputOverrides);
    const expectations = { ...(scenario.expectations ?? {}), ...(variant.expectations ?? {}) };
    variantResults.push(await runLegacyProjectUnderstandingVariant(scenario, variant, input, expectations));
  }
  const scenarioChecks = [
    ...checkScenarioContextQuality(variantResults, scenario.expectations?.contextQualityGates),
    ...checkScenarioLegacyInventoryQuality(variantResults, scenario.expectations?.inventoryQualityGates),
    ...checkInventorySectionGateCoverage(scenario),
  ];
  return {
    scenarioId: scenario.id,
    title: scenario.title,
    kind: scenario.kind,
    variants: variantResults,
    scenarioChecks,
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
  profileBootstrap: ProfileBootstrapFixtureOutput | null;
}

interface ProfileBootstrapFixtureOutput {
  flowId: FlowId;
  stages: WorkflowStage[];
  artifactKinds: string[];
  artifactOutputs: string[];
  inventoryArtifactId: string | null;
  sourceChunkIndexArtifactId: string | null;
  profileArtifactCount: number;
  profileJsonContractValid: boolean;
  profileJsonProvenanceValid: boolean;
  sourceChunkIndexInjectedAsInput: boolean;
  rawInventoryInProfileMarkdown: boolean;
  knowledgeCandidateGenerated: boolean;
  knowledgeCandidateReviewable: boolean;
  knowledgePersisted: boolean;
  ok: boolean;
}

async function runAgentBackendVariant(
  scenario: AgentBackendEvalScenario,
  variant: AgentBackendEvalVariant,
  input: AgentBackendEvalInput,
  expectations: AgentBackendExpectations,
): Promise<EvalVariantResult> {
  if (input.behavior === 'profile_bootstrap_success') {
    return runProfileBootstrapAgentBackendVariant(scenario, variant, input, expectations);
  }

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
    profileBootstrap: null,
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

async function runProfileBootstrapAgentBackendVariant(
  scenario: AgentBackendEvalScenario,
  variant: AgentBackendEvalVariant,
  input: AgentBackendEvalInput,
  expectations: AgentBackendExpectations,
): Promise<EvalVariantResult> {
  const { dispatchStep } = await import('../apps/runner/src/orchestrator');
  const { finishAgentSuccess, invokeSkill } = await import('../apps/runner/src/orchestrator/invoke-skill');
  const {
    executeCompletion,
    executeInventory,
    executeKnowledgePromotion,
    executeProfileBootstrap,
  } = await import('../apps/runner/src/orchestrator/steps');
  const { buildProjectInventory } = await import('../apps/runner/src/project-inventory');
  const { validateProjectProfileJson } = await import('../apps/runner/src/project-profile-contract');
  const { SKILLS } = await import('../apps/runner/src/skills');

  const workDir = mkdtempSync(join(tmpdir(), `ainp-eval-profile-${safeId(scenario.id)}-${safeId(variant.id)}-`));
  const artifactsDir = join(workDir, 'artifacts');
  await mkdir(join(workDir, 'src'), { recursive: true });
  await mkdir(artifactsDir, { recursive: true });
  await writeFile(join(workDir, 'README.md'), '# Legacy Billing App\n\nSource-ref backed onboarding fixture.\n', 'utf8');
  await writeFile(
    join(workDir, 'src', 'billing.ts'),
    [
      'export function approveRefund() {',
      '  return "billing refund approved";',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(join(workDir, '.env'), 'SECRET_TOKEN=do-not-capture\n', 'utf8');

  const trace = createAgentFixtureTrace();
  const invokeDeps = agentFixtureDeps(trace);
  const stageTrace = createProfileBootstrapStageTrace();
  const profileSkill = SKILLS.find((skill) => skill.id === 'project-profile-bootstrap');
  if (!profileSkill) throw new Error('missing project-profile-bootstrap skill');
  const ctx = runCtxFixture({
    projectId: input.projectId ?? `proj_${safeId(scenario.id)}`,
    workflowRunId: input.workflowRunId ?? `run_${safeId(scenario.id)}_${safeId(variant.id)}`,
    title: input.title,
    workspacePath: workDir,
    artifactsDir,
    backend: fakeAgentBackend(input, trace, artifactsDir),
    runType: 'profile',
    flowId: 'profile.bootstrap',
    currentStage: 'inventory',
  });

  const stepDeps: StepDeps = {
    ...emptyStepDeps(),
    api: profileBootstrapStepApi(stageTrace),
    mustSkill: async () => profileSkill,
    buildProjectInventory,
    selectAgentBackend: async () => ctx.backend,
    invokeSkill: (c, skill, skillCtx) => invokeSkill(c, skill, skillCtx, invokeDeps),
    finishAgentSuccess: (agent, outputArtifactIds, summary) =>
      finishAgentSuccess(
        agent,
        outputArtifactIds,
        summary,
        invokeDeps.agentTaskFinished,
        invokeDeps.agentSessionFinished,
      ),
    awaitApproval: async () => ({ approved: false }),
    persistKnowledgeCandidate: async () => {
      stageTrace.knowledgePersisted += 1;
      return 'knowledge_should_not_persist';
    },
  };

  const blocked = async () => {
    throw new Error('profile.bootstrap eval fixture must not dispatch mutable feature stages');
  };
  const dispatchDeps = {
    runContextPack: blocked,
    runStage: blocked,
    executeImplementation: blocked,
    executeBuildTest: blocked,
    executeVerifier: blocked,
    executeAcceptance: blocked,
    executeCompletion: (c: RunCtx) => executeCompletion(c, stepDeps),
    executeKnowledgePromotion: (c: RunCtx) => executeKnowledgePromotion(c, stepDeps),
    executeInventory: (c: RunCtx) => executeInventory(c, stepDeps),
    executeProfileBootstrap: (c: RunCtx) => executeProfileBootstrap(c, stepDeps),
    executeAgentMarkdownStage: blocked,
  };

  try {
    for (const step of FLOW_REGISTRY['profile.bootstrap'].stages) {
      await dispatchStep(step, ctx, dispatchDeps);
    }
  } catch (err) {
    trace.errorObserved = true;
    if (!String(err).includes('knowledge_gate')) throw err;
  }

  const profileJsonText = ctx.inputs['project-profile.json'] ?? '';
  let profileJsonContractValid = false;
  try {
    validateProjectProfileJson(profileJsonText, {
      projectId: ctx.project.id,
      workflowRunId: ctx.run.id,
      inventoryArtifactId: ctx.inputArtifactIds['project-inventory.json'] ?? null,
    });
    profileJsonContractValid = true;
  } catch {
    profileJsonContractValid = false;
  }
  const parsedProfileJson = safeJsonObject(profileJsonText);
  const inventoryArtifactId = ctx.inputArtifactIds['project-inventory.json'] ?? null;
  const profileJsonProvenanceValid = parsedProfileJson?.schemaVersion === 'ainp.project_profile.v1'
    && parsedProfileJson.projectId === ctx.project.id
    && parsedProfileJson.workflowRunId === ctx.run.id
    && parsedProfileJson.inventoryArtifactId === inventoryArtifactId;
  const profileMarkdown = ctx.inputs['project-profile.md'] ?? '';
  const profileOutput: ProfileBootstrapFixtureOutput = {
    flowId: ctx.run.flowId,
    stages: stageTrace.stages,
    artifactKinds: stageTrace.artifacts.map((artifact) => artifact.kind),
    artifactOutputs: stageTrace.artifacts.map((artifact) =>
      typeof artifact.metadata.output === 'string' ? artifact.metadata.output : '',
    ),
    inventoryArtifactId,
    sourceChunkIndexArtifactId: stageTrace.artifacts.find((artifact) =>
      artifact.metadata.output === 'source-chunk-index.json'
    )?.id ?? null,
    profileArtifactCount: stageTrace.artifacts.filter((artifact) => artifact.kind === 'project_profile').length,
    profileJsonContractValid,
    profileJsonProvenanceValid,
    sourceChunkIndexInjectedAsInput: Boolean(ctx.inputs['source-chunk-index.json'])
      || Boolean(ctx.inputArtifactIds['source-chunk-index.json']),
    rawInventoryInProfileMarkdown: profileMarkdown.includes('"schemaVersion"')
      || profileMarkdown.includes('sourceChunkIndex')
      || profileMarkdown.includes('SECRET_TOKEN'),
    knowledgeCandidateGenerated: stageTrace.knowledgeCandidateGenerated,
    knowledgeCandidateReviewable: stageTrace.knowledgeCandidateArtifact?.kind === 'knowledge_candidate'
      && stageTrace.knowledgeCandidateArtifact.metadata.reviewStatus === 'needs_review',
    knowledgePersisted: stageTrace.knowledgePersisted > 0,
    ok: ctx.ok.value,
  };
  const output: AgentBackendFixtureOutput = {
    behavior: input.behavior,
    taskIds: trace.tasks.map((task) => task.id),
    resultIds: trace.results.map((result) => result.id),
    sessionIds: trace.sessionsStarted.map((session) => session.id),
    sessionFinishes: trace.sessionsFinished,
    contextRequestIds: trace.contextRequests.map((entry) => entry.request.id),
    outputCount: profileOutput.profileArtifactCount,
    backendCalls: trace.backendCalls,
    errorObserved: trace.errorObserved,
    externalCliUsed: false,
    profileBootstrap: profileOutput,
  };
  const checks = checkAgentBackendOutput(output, expectations);
  return {
    variantId: variant.id,
    label: variant.label ?? variant.id,
    backend: variant.backend ?? 'fake',
    skillVariant: variant.skillVariant ?? 'project-profile-bootstrap@1.0.0',
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
    reason: string;
    content: string;
    sourceRefs: string[];
    degradationReason: string | null;
  }>;
  authoritativeSourceRefs: string[];
  retrievalHints: string[];
  calibrationSignalCount: number;
  calibrationSignals: Array<{
    id: string;
    kind: string;
    severity: string;
    message: string;
    subjectRefs: string[];
    evidenceRefs: string[];
    recommendedAction: string;
  }>;
  contextQuality: ContextQualityMetrics | null;
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
  const output = contextPackFixtureOutput(pack, expectations.relevantManifestRefPrefixes);
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
  acceptanceGateStatus: GateStatus | null;
  acceptanceRuleStatuses: Record<string, RuleStatus>;
  evidenceGateStatus: GateStatus;
  ruleStatuses: Record<string, RuleStatus>;
  businessMatrixRows: number;
  businessMatrixScenarioTypes: string[];
  commandDigestBacked: boolean;
  completionReportGenerated: boolean;
  completionReportHasStatusAtGeneration: boolean;
  completionReportHasBusinessMatrix: boolean;
  retroReportGenerated: boolean;
  retroFindings: number;
  reportArtifactCount: number;
}

interface GraphRuntimeFixtureOutput {
  profile: GraphRuntimeFixtureProfile;
  flowId: FlowId;
  graphDefinitionId: string;
  graphVersion: string;
  stageOrder: WorkflowStage[];
  flowStageOrder: WorkflowStage[];
  runnableStages: WorkflowStage[];
  resumeCreated: boolean;
  resumeRejected: boolean;
  resumeError: string | null;
  previousAttempt: number | null;
  resumeAttempt: number | null;
  resumeStatus: GraphNodeStatus | null;
  sourceCheckpointId: string | null;
  branchEvidenceIsolated: boolean | null;
  branchNodeRunCount: number | null;
  graphEventTypes: string[];
}

async function runWorkflowVariant(
  scenario: WorkflowEvalScenario,
  variant: WorkflowEvalVariant,
  input: WorkflowEvalInput,
  expectations: WorkflowExpectations,
): Promise<EvalVariantResult> {
  const workDir = mkdtempSync(join(tmpdir(), `ainp-eval-workflow-${safeId(scenario.id)}-${safeId(variant.id)}-`));
  process.env.AINP_ARTIFACTS_DIR ??= tmpdir();
  process.env.AINP_REPORTS_DIR ??= join(workDir, 'reports');
  const { store } = await import('../apps/api/src/store/store');
  const { runAcceptanceTraceabilityGate, runEvidenceGate } = await import('../apps/api/src/gate-engine');
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
  const acceptanceGate = isBusinessAcceptanceWorkflowProfile(input.profile)
    ? runAcceptanceTraceabilityGate({ workflowRunId, stepRunId })
    : store.gateRuns.latestForGate(workflowRunId, 'acceptance_gate');
  const evidenceGate = runEvidenceGate({ workflowRunId, stepRunId });
  let completionReportGenerated = false;
  let completionReportHasStatusAtGeneration = false;
  let completionReportHasBusinessMatrix = false;
  if (evidenceGate.status === 'pass') {
    const completion = await generateCompletionReport(workflowRunId);
    completionReportGenerated = true;
    const sidecar = JSON.parse(await readFile(fileURLToPath(completion.sidecar.uri), 'utf8')) as {
      summary?: unknown[];
      businessAcceptanceMatrix?: unknown[];
    };
    completionReportHasStatusAtGeneration = Array.isArray(sidecar.summary)
      && sidecar.summary.some((entry) => typeof entry === 'string' && entry.startsWith('Status at report generation:'));
    completionReportHasBusinessMatrix = Array.isArray(sidecar.businessAcceptanceMatrix)
      && sidecar.businessAcceptanceMatrix.length > 0;
  }
  const retro = await generateRetroReport(workflowRunId);
  const retroSidecar = JSON.parse(await readFile(fileURLToPath(retro.sidecar.uri), 'utf8')) as {
    findings?: unknown[];
  };
  const output: WorkflowFixtureOutput = {
    profile: input.profile,
    acceptanceGateStatus: acceptanceGate?.status ?? null,
    acceptanceRuleStatuses: acceptanceGate
      ? Object.fromEntries(acceptanceGate.ruleResults.map((rule) => [rule.ruleId, rule.status]))
      : {},
    evidenceGateStatus: evidenceGate.status,
    ruleStatuses: Object.fromEntries(evidenceGate.ruleResults.map((rule) => [rule.ruleId, rule.status])),
    businessMatrixRows: businessAcceptanceMatrixRows(store.artifacts.byWorkflow(workflowRunId)),
    businessMatrixScenarioTypes: businessAcceptanceMatrixScenarioTypes(store.artifacts.byWorkflow(workflowRunId)),
    commandDigestBacked: store.commandRuns.byWorkflow(workflowRunId).every((command) =>
      Boolean(command.stdoutSha256 && command.stderrSha256 && command.combinedSha256),
    ),
    completionReportGenerated,
    completionReportHasStatusAtGeneration,
    completionReportHasBusinessMatrix,
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

async function runGraphRuntimeVariant(
  scenario: GraphRuntimeEvalScenario,
  variant: GraphRuntimeEvalVariant,
  input: GraphRuntimeEvalInput,
  expectations: GraphRuntimeExpectations,
): Promise<EvalVariantResult> {
  const flow = FLOW_REGISTRY[input.flowId];
  if (!flow) throw new Error(`unknown flowId in graph runtime fixture: ${input.flowId}`);
  const graph = flowToGraphDefinition(flow, {
    version: input.graphVersion ?? '1',
    createdAt: '2026-06-27T00:00:00.000Z',
  });
  const fixtureGraph = input.profile === 'branch_fanout' || input.profile === 'branch_duplicate_evidence'
    ? branchFanOutGraphDefinition({
        version: input.graphVersion ?? '1',
        createdAt: '2026-06-28T00:00:00.000Z',
      })
    : graph;
  const flowStageOrder = flow.stages.map((step) => step.stage);
  const stageOrder = graphStageOrder(fixtureGraph);

  let output: GraphRuntimeFixtureOutput;
  if (input.profile === 'linear_equivalence') {
    const { computeRunnableGraphNodes } = await import('../apps/runner/src/orchestrator/graph-scheduler');
    output = {
      profile: input.profile,
      flowId: input.flowId,
      graphDefinitionId: fixtureGraph.id,
      graphVersion: fixtureGraph.version,
      stageOrder,
      flowStageOrder,
      runnableStages: computeRunnableGraphNodes({ graph: fixtureGraph, nodeRuns: [] }).map((node) => node.stage),
      resumeCreated: false,
      resumeRejected: false,
      resumeError: null,
      previousAttempt: null,
      resumeAttempt: null,
      resumeStatus: null,
      sourceCheckpointId: null,
      branchEvidenceIsolated: null,
      branchNodeRunCount: null,
      graphEventTypes: [],
    };
  } else if (input.profile === 'branch_fanout' || input.profile === 'branch_duplicate_evidence') {
    output = await runGraphRuntimeBranchFixture(scenario, variant, input, fixtureGraph, stageOrder, flowStageOrder);
  } else {
    output = await runGraphRuntimeResumeFixture(scenario, variant, input, fixtureGraph, stageOrder, flowStageOrder);
  }

  const checks = checkGraphRuntimeOutput(output, expectations);
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

interface LegacyProjectUnderstandingFixtureOutput {
  inventory: {
    stats: LegacyInventoryStats;
    capabilityLabels: string[];
    entrypointRoutes: string[];
    symbolNames: string[];
    graphEdgeKinds: string[];
    graphEdgeConfidenceMin: number | null;
    routeHandlerEdgeConfidenceMin: number | null;
    sourceChunkContentSha256Coverage: number | null;
    sourceChunkIndexCoverage: number | null;
    sourceChunkLinkedRecordCoverage: number | null;
    sourceChunkGraphEdgeRefs: string[];
    sourceFileExtensions: string[];
    sourcePathPatterns: string[];
    sourceRecordKinds: string[];
    exclusions: string[];
  };
  context: ContextPackFixtureOutput;
}

async function runLegacyProjectUnderstandingVariant(
  scenario: LegacyProjectUnderstandingEvalScenario,
  variant: LegacyProjectUnderstandingEvalVariant,
  input: LegacyProjectUnderstandingEvalInput,
  expectations: LegacyProjectUnderstandingExpectations,
): Promise<EvalVariantResult> {
  const { buildContextPack } = await import('../apps/runner/src/context/builder');
  const { buildProjectInventory } = await import('../apps/runner/src/project-inventory');
  const projectId = input.projectId ?? `proj_${safeId(scenario.id)}`;
  const workflowRunId = input.workflowRunId ?? `run_${safeId(scenario.id)}_${safeId(variant.id)}`;
  const workspacePath = mkdtempSync(join(tmpdir(), `ainp-eval-legacy-${safeId(scenario.id)}-${safeId(variant.id)}-`));
  const now = new Date().toISOString();
  const files = await resolveLegacyProjectUnderstandingFiles(input, scenario.sourcePath ?? repoRoot);

  for (const file of files) {
    const normalizedPath = normalizeFixtureRelativePath(file.path, 'legacy fixture file path');
    const absolute = resolve(workspacePath, normalizedPath);
    if (!isPathInside(workspacePath, absolute)) {
      throw new Error(`legacy fixture file path escapes temp workspace: ${file.path}`);
    }
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, file.content, 'utf8');
  }

  const inventory = await buildProjectInventory({
    projectId,
    workflowRunId,
    repoRoot: workspacePath,
    generatedAt: now,
    git: false,
    limits: input.inventoryLimits,
  });
  const project = projectFixture(projectId, workspacePath, now);
  const run = workflowRunFixture({
    id: workflowRunId,
    projectId,
    title: input.title,
    workspacePath,
    now,
  });
  const inventoryBody = `${JSON.stringify(inventory, null, 2)}\n`;
  const pack = buildContextPack({
    project,
    run,
    stage: input.stage ?? 'implementation',
    stepRunId: `step_${safeId(variant.id)}`,
    workspacePath,
    branch: run.branch,
    taskBrief: input.taskBrief ?? input.title,
    projectProfile: projectProfileFixture(project, now),
    projectProfileMarkdown: '# Project Profile\n\n- Source: legacy project understanding eval fixture',
    acceptedKnowledgeMarkdown: null,
    inputArtifacts: [{
      name: 'project-inventory.json',
      artifactId: `art_eval_legacy_inventory_${safeId(variant.id)}`,
      content: inventoryBody,
    }],
    budget: input.budget,
    sensitivePathPatterns: input.sensitivePathPatterns,
    createdAt: now,
  });
  const sourceRagReadiness = legacySourceRagReadinessStats(inventory);
  const corpusCoverage = legacyCorpusCoverageStats(inventory);

  const output: LegacyProjectUnderstandingFixtureOutput = {
    inventory: {
      stats: {
        capabilityCount: inventory.capabilities.length,
        entrypointRouteCount: inventory.entrypoints.filter((entrypoint) => entrypoint.route).length,
        symbolCount: inventory.symbols.length,
        graphEdgeCount: inventory.symbolGraph.edges.length,
        routeHandlerEdgeCount: inventory.symbolGraph.edges.filter((edge) => edge.kind === 'route_handler').length,
        sourceChunkCount: inventory.sourceChunks.length,
        sourceChunkContentSha256Count: sourceRagReadiness.contentSha256Count,
        sourceChunkIndexEntryCount: sourceRagReadiness.indexEntryCount,
        sourceChunkIndexedCount: sourceRagReadiness.indexedChunkCount,
        sourceChunkLinkedRecordCount: sourceRagReadiness.linkedRecordChunkCount,
        sourceFileExtensionCount: corpusCoverage.sourceFileExtensions.length,
        sourcePathPatternCount: corpusCoverage.sourcePathPatterns.length,
        sourceRecordKindCount: corpusCoverage.sourceRecordKinds.length,
        exclusionCount: inventory.exclusions.length,
      },
      capabilityLabels: inventory.capabilities.map((capability) => capability.label),
      entrypointRoutes: inventory.entrypoints
        .filter((entrypoint) => entrypoint.route)
        .map((entrypoint) => `${entrypoint.method ?? 'ANY'} ${entrypoint.route}`),
      symbolNames: inventory.symbols.map((symbol) => symbol.name),
      graphEdgeKinds: inventory.symbolGraph.edges.map((edge) => edge.kind),
      graphEdgeConfidenceMin: minConfidence(inventory.symbolGraph.edges),
      routeHandlerEdgeConfidenceMin: minConfidence(
        inventory.symbolGraph.edges.filter((edge) => edge.kind === 'route_handler'),
      ),
      sourceChunkContentSha256Coverage: sourceRagReadiness.contentSha256Coverage,
      sourceChunkIndexCoverage: sourceRagReadiness.indexCoverage,
      sourceChunkLinkedRecordCoverage: sourceRagReadiness.linkedRecordCoverage,
      sourceChunkGraphEdgeRefs: inventory.sourceChunks.flatMap((chunk) => chunk.graphEdgeRefs),
      sourceFileExtensions: corpusCoverage.sourceFileExtensions,
      sourcePathPatterns: corpusCoverage.sourcePathPatterns,
      sourceRecordKinds: corpusCoverage.sourceRecordKinds,
      exclusions: inventory.exclusions.map((exclusion) => `${exclusion.path}:${exclusion.reason}`),
    },
    context: contextPackFixtureOutput(pack, expectations.relevantManifestRefPrefixes),
  };
  const checks = checkLegacyProjectUnderstandingOutput(output, expectations);
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

async function resolveLegacyProjectUnderstandingFiles(
  input: LegacyProjectUnderstandingEvalInput,
  scenarioSourcePath: string,
): Promise<Array<{ path: string; content: string }>> {
  const fixtureFiles = input.fixtureDir
    ? await readLegacyProjectUnderstandingFixtureDir(input.fixtureDir, scenarioSourcePath)
    : [];
  return [
    ...fixtureFiles,
    ...(input.files ?? []),
  ];
}

async function readLegacyProjectUnderstandingFixtureDir(
  fixtureDir: LegacyProjectUnderstandingFixtureDirInput,
  scenarioSourcePath: string,
): Promise<Array<{ path: string; content: string }>> {
  if (!fixtureDir.path || typeof fixtureDir.path !== 'string') {
    throw new Error('legacy fixtureDir.path is required');
  }

  const scenarioDir = dirname(scenarioSourcePath);
  const requestedPath = resolve(scenarioDir, fixtureDir.path);
  const [realRepoRoot, realFixtureRoot] = await Promise.all([
    realpath(repoRoot),
    realpath(requestedPath).catch((error: unknown) => {
      throw new Error(`legacy fixtureDir.path does not exist: ${fixtureDir.path}`, { cause: error });
    }),
  ]);
  if (!isPathInside(realRepoRoot, realFixtureRoot)) {
    throw new Error(`legacy fixtureDir.path escapes repository root: ${fixtureDir.path}`);
  }
  const rootStat = await lstat(realFixtureRoot);
  if (!rootStat.isDirectory()) {
    throw new Error(`legacy fixtureDir.path must be a directory: ${fixtureDir.path}`);
  }

  const maxFiles = positiveIntegerOrDefault(
    fixtureDir.maxFiles,
    DEFAULT_LEGACY_FIXTURE_DIR_MAX_FILES,
    'fixtureDir.maxFiles',
  );
  const maxFileBytes = positiveIntegerOrDefault(
    fixtureDir.maxFileBytes,
    DEFAULT_LEGACY_FIXTURE_DIR_MAX_FILE_BYTES,
    'fixtureDir.maxFileBytes',
  );
  const maxTotalBytes = positiveIntegerOrDefault(
    fixtureDir.maxTotalBytes,
    DEFAULT_LEGACY_FIXTURE_DIR_MAX_TOTAL_BYTES,
    'fixtureDir.maxTotalBytes',
  );
  const excludedPaths = (fixtureDir.excludePaths ?? [])
    .map((path) => normalizeFixtureRelativePath(path, 'fixtureDir.excludePaths[]'));
  const discovered: Array<{ absolutePath: string; relativePath: string }> = [];
  let totalBytes = 0;

  const visit = async (directory: string): Promise<void> => {
    const entries = (await readdir(directory)).sort();
    for (const entry of entries) {
      const absolutePath = join(directory, entry);
      const relativePath = normalizeFixtureRelativePath(
        relative(realFixtureRoot, absolutePath),
        'fixtureDir file path',
      );
      if (isExcludedFixturePath(relativePath, excludedPaths)) continue;
      const entryStat = await lstat(absolutePath);
      if (entryStat.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!entryStat.isFile()) continue;
      if (entryStat.size > maxFileBytes) {
        throw new Error(
          `legacy fixtureDir file exceeds maxFileBytes (${entryStat.size} > ${maxFileBytes}): ${relativePath}`,
        );
      }
      if (discovered.length + 1 > maxFiles) {
        throw new Error(`legacy fixtureDir exceeds maxFiles (${maxFiles}): ${fixtureDir.path}`);
      }
      totalBytes += entryStat.size;
      if (totalBytes > maxTotalBytes) {
        throw new Error(`legacy fixtureDir exceeds maxTotalBytes (${maxTotalBytes}): ${fixtureDir.path}`);
      }
      discovered.push({ absolutePath, relativePath });
    }
  };

  await visit(realFixtureRoot);
  discovered.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const files: Array<{ path: string; content: string }> = [];
  for (const file of discovered) {
    files.push({
      path: file.relativePath,
      content: await readFile(file.absolutePath, 'utf8'),
    });
  }
  return files;
}

function positiveIntegerOrDefault(value: unknown, fallback: number, field: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || typeof value !== 'number' || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return value;
}

function normalizeFixtureRelativePath(value: string, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} must be a non-empty relative path`);
  }
  const normalized = value.replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (
    normalized.startsWith('/')
    || normalized === '..'
    || normalized.startsWith('../')
    || normalized.endsWith('/..')
    || normalized.includes('/../')
  ) {
    throw new Error(`${field} must stay inside the fixture workspace: ${value}`);
  }
  return normalized;
}

function isExcludedFixturePath(path: string, excludedPaths: readonly string[]): boolean {
  return excludedPaths.some((excludedPath) => path === excludedPath || path.startsWith(`${excludedPath}/`));
}

function isPathInside(parent: string, child: string): boolean {
  const relation = relative(parent, child);
  return relation === '' || (relation !== '..' && !relation.startsWith(`..${sep}`) && !isAbsolute(relation));
}

function legacySourceRagReadinessStats(inventory: {
  sourceChunks: Array<Record<string, unknown>>;
  sourceChunkIndex?: { entries?: Array<Record<string, unknown>> };
}): {
  contentSha256Count: number;
  indexEntryCount: number;
  indexedChunkCount: number;
  linkedRecordChunkCount: number;
  contentSha256Coverage: number | null;
  indexCoverage: number | null;
  linkedRecordCoverage: number | null;
} {
  const chunks = inventory.sourceChunks;
  const chunkCount = chunks.length;
  const validContentSha256 = /^[a-f0-9]{64}$/;
  const indexEntries = Array.isArray(inventory.sourceChunkIndex?.entries)
    ? inventory.sourceChunkIndex.entries
    : [];
  const indexedSourceChunkRefs = new Set(
    indexEntries
      .map((entry) => stringValue(entry.sourceChunkRef))
      .filter((ref): ref is string => Boolean(ref)),
  );
  const contentSha256Count = chunks.filter((chunk) => (
    validContentSha256.test(stringValue(chunk.contentSha256) ?? '')
  )).length;
  const indexedChunkCount = chunks.filter((chunk) => {
    const id = stringValue(chunk.id);
    return id ? indexedSourceChunkRefs.has(id) : false;
  }).length;
  const linkedRecordChunkCount = chunks.filter(sourceChunkHasLinkedInventoryRecord).length;
  return {
    contentSha256Count,
    indexEntryCount: indexEntries.length,
    indexedChunkCount,
    linkedRecordChunkCount,
    contentSha256Coverage: ratioOrNull(contentSha256Count, chunkCount),
    indexCoverage: ratioOrNull(indexedChunkCount, chunkCount),
    linkedRecordCoverage: ratioOrNull(linkedRecordChunkCount, chunkCount),
  };
}

function sourceChunkHasLinkedInventoryRecord(chunk: Record<string, unknown>): boolean {
  return [
    'entrypointRefs',
    'symbolRefs',
    'graphEdgeRefs',
    'testRefs',
    'hotspotRefs',
    'capabilityRefs',
  ].some((key) => Array.isArray(chunk[key]) && chunk[key].length > 0);
}

function legacyCorpusCoverageStats(inventory: ProjectInventoryEnvelope): {
  sourceFileExtensions: string[];
  sourcePathPatterns: string[];
  sourceRecordKinds: string[];
} {
  const sourcePaths = new Set<string>();
  const recordKinds = new Set<string>();
  const addPath = (path: string | undefined): void => {
    if (path) sourcePaths.add(path.replace(/\\/g, '/'));
  };
  const addRefs = (refs: readonly string[] | undefined): void => {
    for (const ref of refs ?? []) {
      const path = sourceRefPath(ref);
      if (path) addPath(path);
    }
  };

  for (const source of inventory.sources) {
    recordKinds.add(`source:${source.kind}`);
    addPath(source.path);
    addRefs([source.ref]);
  }
  for (const command of inventory.commands) {
    recordKinds.add('command');
    addRefs(command.sourceRefs);
  }
  for (const entrypoint of inventory.entrypoints) {
    recordKinds.add(`entrypoint:${entrypoint.kind}`);
    addPath(entrypoint.path);
    addRefs(entrypoint.sourceRefs);
  }
  for (const symbol of inventory.symbols) {
    recordKinds.add(`symbol:${symbol.kind}`);
    addPath(symbol.path);
    addRefs(symbol.sourceRefs);
  }
  for (const item of inventory.imports) {
    recordKinds.add('import');
    addPath(item.path);
    addPath(item.targetPath);
    for (const targetPath of item.targetPaths ?? []) addPath(targetPath);
    addRefs(item.sourceRefs);
  }
  for (const item of inventory.exports) {
    recordKinds.add(`export:${item.kind}`);
    addPath(item.path);
    addRefs(item.sourceRefs);
  }
  for (const node of inventory.symbolGraph.nodes) {
    recordKinds.add(`graph_node:${node.kind}`);
    addPath(node.path);
    addRefs(node.sourceRefs);
  }
  for (const edge of inventory.symbolGraph.edges) {
    recordKinds.add(`graph_edge:${edge.kind}`);
    addRefs(edge.sourceRefs);
  }
  for (const chunk of inventory.sourceChunks) {
    recordKinds.add(`source_chunk:${chunk.language ?? 'unknown'}`);
    addPath(chunk.path);
    addRefs(chunk.sourceRefs);
  }
  for (const entity of inventory.domainEntities) {
    recordKinds.add(`domain_entity:${entity.kind}`);
    addPath(entity.path);
    addRefs(entity.sourceRefs);
  }
  for (const test of inventory.testSurfaces) {
    recordKinds.add('test_surface');
    addPath(test.path);
    addRefs(test.sourceRefs);
  }
  for (const hotspot of inventory.hotspots) {
    recordKinds.add(`hotspot:${hotspot.reason}`);
    addPath(hotspot.path);
    addRefs(hotspot.sourceRefs);
  }

  const paths = [...sourcePaths].sort();
  return {
    sourceFileExtensions: uniqueStrings(paths.map(sourceFileExtension)).sort(),
    sourcePathPatterns: uniqueStrings(paths.map(sourcePathPattern)).sort(),
    sourceRecordKinds: [...recordKinds].sort(),
  };
}

function sourceRefPath(ref: string): string | null {
  const match = /^file:([^#]+)(?:#L\d+)?$/.exec(ref);
  return match?.[1] ?? null;
}

function sourceFileExtension(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const name = basename(normalized).toLowerCase();
  if (name.startsWith('.') && !name.slice(1).includes('.')) return name;
  return extname(name) || '<none>';
}

function sourcePathPattern(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\/+/, '');
  const parts = normalized.split('/').filter(Boolean);
  const extension = sourceFileExtension(normalized);
  if (parts.length <= 1) return `<root>/*${extension}`;
  const first = parts[0]!;
  if (first === 'test' || first === 'tests' || first === 'spec' || first === '__tests__') {
    return `tests/**/*${extension}`;
  }
  if (first.startsWith('legacy_')) return `legacy_*/**/*${extension}`;
  return `${first}/**/*${extension}`;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function ratioOrNull(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Number((numerator / denominator).toFixed(4));
}

async function runGraphRuntimeResumeFixture(
  scenario: GraphRuntimeEvalScenario,
  variant: GraphRuntimeEvalVariant,
  input: GraphRuntimeEvalInput,
  graph: GraphDefinition,
  stageOrder: WorkflowStage[],
  flowStageOrder: WorkflowStage[],
): Promise<GraphRuntimeFixtureOutput> {
  const { store } = await import('../apps/api/src/store/store');
  const { resumeGraphNode } = await import('../apps/api/src/graph-runtime');
  const { computeRunnableGraphNodes } = await import('../apps/runner/src/orchestrator/graph-scheduler');
  const now = new Date().toISOString();
  const workspacePath = mkdtempSync(join(tmpdir(), `ainp-eval-graph-${safeId(scenario.id)}-${safeId(variant.id)}-`));
  const projectId = input.projectId ?? `proj_${safeId(scenario.id)}`;
  const workflowRunId = input.workflowRunId ?? `run_${safeId(scenario.id)}_${safeId(variant.id)}`;
  const targetStage = input.stage ?? graph.nodes[0]?.stage;
  if (!targetStage) throw new Error(`${scenario.id}/${variant.id}: graph has no nodes`);
  const targetNode = graph.nodes.find((node) => node.stage === targetStage);
  if (!targetNode) throw new Error(`${scenario.id}/${variant.id}: stage ${targetStage} not found in ${input.flowId}`);

  const graphRunId = `grun_${safeId(scenario.id)}_${safeId(variant.id)}`;
  const stepRunId = `step_${safeId(scenario.id)}_${safeId(variant.id)}`;
  const checkpointId = `scp_${safeId(scenario.id)}_${safeId(variant.id)}`;
  const previousNodeRunId = `gnr_${safeId(scenario.id)}_${safeId(variant.id)}_1`;
  const nodeStatus: GraphNodeStatus = input.profile === 'completed_resume' ? 'passed' : 'failed';
  const resumeCursor = input.resumeCursor === undefined ? `graph://resume/${targetStage}` : input.resumeCursor;

  store.projects.set(projectId, projectFixture(projectId, workspacePath, now));
  store.workflowRuns.set(workflowRunId, workflowRunFixture({
    id: workflowRunId,
    projectId,
    title: input.title,
    workspacePath,
    now,
    status: nodeStatus === 'passed' ? 'passed' : 'failed',
  }));
  const step: StepRun = {
    id: stepRunId,
    workflowRunId,
    stage: targetStage,
    name: targetStage,
    status: nodeStatus,
    startedAt: now,
    completedAt: now,
  };
  store.stepRuns.set(step.id, step);
  const checkpoint: StepCheckpoint = {
    id: checkpointId,
    workflowRunId,
    stepRunId: step.id,
    stage: targetStage,
    status: nodeStatus === 'passed' ? 'passed' : 'failed',
    inputArtifactIds: [],
    outputArtifactIds: [],
    contextPackId: null,
    agentSessionIds: [],
    toolInvocationIds: [],
    gateRunIds: [],
    retryIndex: 0,
    resumeCursor,
    failureReason: nodeStatus === 'passed' ? null : 'eval fixture failed node',
    createdAt: now,
    updatedAt: now,
    metadata: {},
  };
  store.stepCheckpoints.upsert(checkpoint);
  store.graphDefinitions.upsert(graph);
  store.graphRuns.upsert({
    id: graphRunId,
    workflowRunId,
    graphDefinitionId: graph.id,
    graphVersion: graph.version,
    status: nodeStatus === 'passed' ? 'passed' : 'failed',
    activeNodeIds: [],
    interruptedReason: null,
    createdAt: now,
    updatedAt: now,
    metadata: {},
  });
  const previousNodeRun: GraphNodeRun = {
    id: previousNodeRunId,
    graphRunId,
    workflowRunId,
    nodeId: targetNode.id,
    attempt: 1,
    status: nodeStatus,
    stepRunId: step.id,
    stepCheckpointId: checkpoint.id,
    resumeCursor,
    idempotencyKey: `${graphRunId}:${targetNode.id}:1`,
    dependencyState: {
      upstreamNodeIds: [],
      satisfiedNodeIds: [],
      blockedNodeIds: [],
    },
    startedAt: now,
    completedAt: now,
    metadata: {},
  };
  store.graphNodeRuns.upsert(previousNodeRun);

  let resumedNodeRun: GraphNodeRun | null = null;
  let resumeError: string | null = null;
  try {
    const resumed = resumeGraphNode({
      workflowRunId,
      nodeRunId: previousNodeRun.id,
      graphVersion: graph.version,
      resumeCursor,
      actor: 'eval',
    });
    resumedNodeRun = resumed.nodeRun;
  } catch (err) {
    resumeError = err instanceof Error ? err.message : String(err);
  }

  const nodeRuns = store.graphNodeRuns.byGraphRun(graphRunId);
  const graphRun = store.graphRuns.get(graphRunId);
  const runnableStages = computeRunnableGraphNodes({
    graph,
    graphRun,
    nodeRuns,
  }).map((node) => node.stage);
  const graphEventTypes = store.graphEvents.byGraphRun(graphRunId).map((event) => event.type);

  return {
    profile: input.profile,
    flowId: input.flowId,
    graphDefinitionId: graph.id,
    graphVersion: graph.version,
    stageOrder,
    flowStageOrder,
    runnableStages,
    resumeCreated: resumedNodeRun !== null,
    resumeRejected: resumedNodeRun === null,
    resumeError,
    previousAttempt: previousNodeRun.attempt,
    resumeAttempt: resumedNodeRun?.attempt ?? null,
    resumeStatus: resumedNodeRun?.status ?? null,
    sourceCheckpointId: typeof resumedNodeRun?.metadata.sourceCheckpointId === 'string'
      ? resumedNodeRun.metadata.sourceCheckpointId
      : null,
    branchEvidenceIsolated: null,
    branchNodeRunCount: null,
    graphEventTypes,
  };
}

async function runGraphRuntimeBranchFixture(
  scenario: GraphRuntimeEvalScenario,
  variant: GraphRuntimeEvalVariant,
  input: GraphRuntimeEvalInput,
  graph: GraphDefinition,
  stageOrder: WorkflowStage[],
  flowStageOrder: WorkflowStage[],
): Promise<GraphRuntimeFixtureOutput> {
  const { store } = await import('../apps/api/src/store/store');
  const { computeRunnableGraphNodes } = await import('../apps/runner/src/orchestrator/graph-scheduler');
  const now = new Date().toISOString();
  const workspacePath = mkdtempSync(join(tmpdir(), `ainp-eval-branch-${safeId(scenario.id)}-${safeId(variant.id)}-`));
  const projectId = input.projectId ?? `proj_${safeId(scenario.id)}`;
  const workflowRunId = input.workflowRunId ?? `run_${safeId(scenario.id)}_${safeId(variant.id)}`;
  const graphRunId = `grun_${safeId(scenario.id)}_${safeId(variant.id)}`;
  const [sourceNode, ...branchNodes] = graph.nodes;
  if (!sourceNode || branchNodes.length === 0) {
    throw new Error(`${scenario.id}/${variant.id}: branch graph fixture has no branch nodes`);
  }

  store.projects.set(projectId, projectFixture(projectId, workspacePath, now));
  store.workflowRuns.set(workflowRunId, workflowRunFixture({
    id: workflowRunId,
    projectId,
    title: input.title,
    workspacePath,
    now,
    status: 'running',
  }));
  store.graphDefinitions.upsert(graph);
  store.graphRuns.upsert({
    id: graphRunId,
    workflowRunId,
    graphDefinitionId: graph.id,
    graphVersion: graph.version,
    status: 'running',
    activeNodeIds: [],
    interruptedReason: null,
    createdAt: now,
    updatedAt: now,
    metadata: {},
  });

  const sourceRun: GraphNodeRun = graphNodeRunFixture({
    graphRunId,
    workflowRunId,
    nodeId: sourceNode.id,
    attempt: 1,
    status: 'passed',
    now,
  });
  store.graphNodeRuns.upsert(sourceRun);
  const graphRun = store.graphRuns.get(graphRunId);
  const runnableStages = computeRunnableGraphNodes({
    graph,
    graphRun,
    nodeRuns: store.graphNodeRuns.byGraphRun(graphRunId),
  }).map((node) => node.stage);

  const duplicateEvidence = input.profile === 'branch_duplicate_evidence';
  const branchRuns: GraphNodeRun[] = [];
  for (const [index, node] of branchNodes.entries()) {
    const evidenceSuffix = duplicateEvidence ? 'duplicate' : String(index + 1);
    const stepRunId = `step_${safeId(scenario.id)}_${safeId(variant.id)}_${evidenceSuffix}`;
    const checkpointId = `scp_${safeId(scenario.id)}_${safeId(variant.id)}_${evidenceSuffix}`;
    store.stepRuns.set(stepRunId, {
      id: stepRunId,
      workflowRunId,
      stage: node.stage,
      name: node.stage,
      status: 'passed',
      startedAt: now,
      completedAt: now,
    });
    store.stepCheckpoints.upsert({
      id: checkpointId,
      workflowRunId,
      stepRunId,
      stage: node.stage,
      status: 'passed',
      inputArtifactIds: [],
      outputArtifactIds: [],
      contextPackId: null,
      agentSessionIds: [],
      toolInvocationIds: [],
      gateRunIds: [],
      retryIndex: 0,
      resumeCursor: null,
      failureReason: null,
      createdAt: now,
      updatedAt: now,
      metadata: {},
    });
    const branchRun = graphNodeRunFixture({
      graphRunId,
      workflowRunId,
      nodeId: node.id,
      attempt: 1,
      status: 'passed',
      stepRunId,
      stepCheckpointId: checkpointId,
      idempotencyKey: duplicateEvidence
        ? `${graphRunId}:branch:duplicate`
        : `${graphRunId}:${node.id}:1`,
      now,
      upstreamNodeIds: [sourceNode.id],
      satisfiedNodeIds: [sourceNode.id],
    });
    store.graphNodeRuns.upsert(branchRun);
    branchRuns.push(branchRun);
  }

  const branchEvidenceIsolated = evidenceRefsAreIsolated(branchRuns);
  return {
    profile: input.profile,
    flowId: input.flowId,
    graphDefinitionId: graph.id,
    graphVersion: graph.version,
    stageOrder,
    flowStageOrder,
    runnableStages,
    resumeCreated: false,
    resumeRejected: false,
    resumeError: null,
    previousAttempt: null,
    resumeAttempt: null,
    resumeStatus: null,
    sourceCheckpointId: null,
    branchEvidenceIsolated,
    branchNodeRunCount: branchRuns.length,
    graphEventTypes: store.graphEvents.byGraphRun(graphRunId).map((event) => event.type),
  };
}

function graphNodeRunFixture(input: {
  graphRunId: string;
  workflowRunId: string;
  nodeId: string;
  attempt: number;
  status: GraphNodeStatus;
  now: string;
  stepRunId?: string | null;
  stepCheckpointId?: string | null;
  idempotencyKey?: string;
  upstreamNodeIds?: string[];
  satisfiedNodeIds?: string[];
}): GraphNodeRun {
  return {
    id: `gnr_${safeId(input.graphRunId)}_${safeId(input.nodeId)}_${input.attempt}`,
    graphRunId: input.graphRunId,
    workflowRunId: input.workflowRunId,
    nodeId: input.nodeId,
    attempt: input.attempt,
    status: input.status,
    stepRunId: input.stepRunId ?? null,
    stepCheckpointId: input.stepCheckpointId ?? null,
    resumeCursor: null,
    idempotencyKey: input.idempotencyKey ?? `${input.graphRunId}:${input.nodeId}:${input.attempt}`,
    dependencyState: {
      upstreamNodeIds: input.upstreamNodeIds ?? [],
      satisfiedNodeIds: input.satisfiedNodeIds ?? [],
      blockedNodeIds: [],
    },
    startedAt: input.now,
    completedAt: input.now,
    metadata: {},
  };
}

function evidenceRefsAreIsolated(nodeRuns: readonly GraphNodeRun[]): boolean {
  const stepRunIds = nodeRuns.map((run) => run.stepRunId).filter((id): id is string => id !== null);
  const checkpointIds = nodeRuns.map((run) => run.stepCheckpointId).filter((id): id is string => id !== null);
  const idempotencyKeys = nodeRuns.map((run) => run.idempotencyKey);
  return stepRunIds.length === nodeRuns.length
    && checkpointIds.length === nodeRuns.length
    && new Set(stepRunIds).size === nodeRuns.length
    && new Set(checkpointIds).size === nodeRuns.length
    && new Set(idempotencyKeys).size === nodeRuns.length;
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

interface ProfileBootstrapStageTrace {
  artifacts: Artifact[];
  stages: WorkflowStage[];
  knowledgeCandidateGenerated: boolean;
  knowledgeCandidateArtifact: Artifact | null;
  knowledgePersisted: number;
}

function createProfileBootstrapStageTrace(): ProfileBootstrapStageTrace {
  return {
    artifacts: [],
    stages: [],
    knowledgeCandidateGenerated: false,
    knowledgeCandidateArtifact: null,
    knowledgePersisted: 0,
  };
}

function recordProfileBootstrapStage(trace: ProfileBootstrapStageTrace, stage: WorkflowStage): void {
  if (trace.stages.at(-1) !== stage) trace.stages.push(stage);
}

function profileBootstrapStepApi(trace: ProfileBootstrapStageTrace): StepDeps['api'] {
  return {
    stepStarted: async (params) => {
      recordProfileBootstrapStage(trace, params.stage);
      return {
        step: {
          id: `step_${params.stage}`,
          workflowRunId: params.workflowRunId,
          stage: params.stage,
          name: params.name,
          status: 'running',
          startedAt: new Date().toISOString(),
          completedAt: null,
          failureReason: null,
        } as StepRun,
      };
    },
    stepFinished: async () => ({}),
    postArtifact: async (params) => {
      const output = typeof params.metadata?.output === 'string'
        ? params.metadata.output
        : typeof params.metadata?.role === 'string'
          ? params.metadata.role
          : `artifact_${trace.artifacts.length + 1}`;
      const artifact: Artifact = {
        id: `art_profile_${safeId(output)}`,
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
    stepCheckpoint: async () => ({ checkpoint: { id: `scp_profile_${Date.now()}` } as StepCheckpoint }),
    runGate: async () => ({ gate: { status: 'pass' } as GateRun }),
    awaitHuman: async () => ({}),
    commandRun: async () => ({ command: {} as CommandRun }),
    toolInvocation: async () => ({ toolInvocation: {} as ToolInvocation }),
    recordHandoff: async () => ({ handoff: { id: 'handoff_profile_eval' } }),
    mavenBuild: async () => ({ command: {} as CommandRun }),
    stageTransition: async (params) => {
      recordProfileBootstrapStage(trace, params.stage);
      return {};
    },
    generateCompletionReport: async (workflowRunId) => ({
      artifact: {
        id: 'art_profile_completion_report',
        workflowRunId,
        stepRunId: null,
        kind: 'completion_report',
        uri: 'file:///tmp/profile-completion-report.md',
        size: 0,
        contentType: 'text/markdown',
        sha256: null,
        createdAt: new Date().toISOString(),
        metadata: { output: 'completion_report.md' },
      } as Artifact,
    }),
    generateKnowledgeCandidate: async (workflowRunId) => {
      trace.knowledgeCandidateGenerated = true;
      const artifact = {
        id: 'art_profile_knowledge_candidate',
        workflowRunId,
        stepRunId: null,
        kind: 'knowledge_candidate',
        uri: 'file:///tmp/profile-knowledge-candidate.md',
        size: 0,
        contentType: 'text/markdown',
        sha256: null,
        createdAt: new Date().toISOString(),
        metadata: { output: 'knowledge-candidate.md', reviewStatus: 'needs_review' },
      } as Artifact;
      trace.knowledgeCandidateArtifact = artifact;
      trace.artifacts.push(artifact);
      return {
        artifact,
      };
    },
    getWorkflowRun: async () => ({ actions: [] }),
  };
}

function emptyStepDeps(): StepDeps {
  const unused = async (): Promise<never> => {
    throw new Error('unexpected profile bootstrap eval dependency');
  };
  return {
    api: profileBootstrapStepApi(createProfileBootstrapStageTrace()),
    mustSkill: unused as StepDeps['mustSkill'],
    findSkillForStage: unused as StepDeps['findSkillForStage'],
    invokeSkill: unused as StepDeps['invokeSkill'],
    finishAgentSuccess: unused as StepDeps['finishAgentSuccess'],
    awaitApproval: unused as StepDeps['awaitApproval'],
    postRejectionFeedback: unused as StepDeps['postRejectionFeedback'],
    enforceSensitiveChangeCheckpoint: unused as StepDeps['enforceSensitiveChangeCheckpoint'],
    promoteAcceptedDraftToKnowledge: unused as StepDeps['promoteAcceptedDraftToKnowledge'],
    runWhitelistedCommand: unused as StepDeps['runWhitelistedCommand'],
    collectReports: async () => [],
    persistVerifierMediaArtifacts: async () => [],
    generateProjectProfile: unused as StepDeps['generateProjectProfile'],
    collectAcceptedKnowledge: unused as StepDeps['collectAcceptedKnowledge'],
    persistKnowledgeCandidate: unused as StepDeps['persistKnowledgeCandidate'],
    buildProjectInventory: unused as StepDeps['buildProjectInventory'],
    selectAgentBackend: unused as StepDeps['selectAgentBackend'],
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
    getWorkflowRun: async () => ({ actions: [] }),
    getArtifactContent: async () => ({ content: '' }),
    listSourceChunkIndexEntries: async () => [],
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
      if (input.behavior === 'profile_bootstrap_success') {
        const markdown = [
          '# Project Profile',
          '',
          '## What this project is',
          'Legacy Billing App profile synthesized from scanner evidence.',
          '',
          '## Architecture map',
          '- Billing source evidence: `file:src/billing.ts#L1`.',
          '',
          '## Suggested knowledge candidates',
          '- Reviewable candidate only; not accepted memory.',
          '',
        ].join('\n');
        const markdownPath = join(ctx.artifactsDir, 'project-profile.md');
        await writeFile(markdownPath, markdown, 'utf8');
        const profileJson = {
          schemaVersion: 'ainp.project_profile.v1',
          projectId: ctx.workflowRunId.startsWith('run_') ? input.projectId ?? 'proj_eval_profile_bootstrap' : input.projectId,
          workflowRunId: ctx.workflowRunId,
          generatedAt: '2026-07-04T00:00:00.000Z',
          inventoryArtifactId: ctx.inputArtifactIds?.['project-inventory.json'] ?? null,
          repo: { root: ctx.workspacePath },
          summary: 'Legacy Billing App profile synthesized from scanner evidence.',
          architecture: {
            body: 'Billing has source-backed code evidence.',
            sourceRefs: ['file:src/billing.ts#L1'],
            confidence: 0.9,
            freshness: 'current',
            scope: 'repo',
          },
          commands: [],
          modules: [],
          businessFlows: [],
          riskAreas: [],
          conventions: [],
          domainVocabulary: [],
          openQuestions: [],
          knowledgeCandidates: [
            {
              kind: 'explore',
              reviewStatus: 'needs_review',
              body: 'Billing source evidence should be reviewed before promotion.',
              sourceRefs: [
                `artifact:${ctx.inputArtifactIds?.['project-inventory.json'] ?? 'unknown'}`,
                'file:src/billing.ts#L1',
              ],
            },
          ],
        };
        const jsonText = `${JSON.stringify(profileJson, null, 2)}\n`;
        const jsonPath = join(ctx.artifactsDir, 'project-profile.json');
        await writeFile(jsonPath, jsonText, 'utf8');
        return {
          outputs: [
            {
              name: 'project-profile.md',
              path: markdownPath,
              contentType: 'text/markdown',
              size: Buffer.byteLength(markdown, 'utf8'),
            },
            {
              name: 'project-profile.json',
              path: jsonPath,
              contentType: 'application/json',
              size: Buffer.byteLength(jsonText, 'utf8'),
            },
          ],
          lastMessage: 'profile bootstrap fixture completed',
        };
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

function safeJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
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
  runType?: WorkflowRunType;
  flowId?: FlowId;
  currentStage?: WorkflowStage;
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
    type: input.runType ?? 'feature',
    status: 'running',
    currentStage: input.currentStage ?? 'implementation',
    flowId: input.flowId ?? 'feature.standard',
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

function contextPackFixtureOutput(
  pack: ContextPack,
  relevantManifestRefPrefixes: readonly string[] | undefined,
): ContextPackFixtureOutput {
  const sourceRefs = uniqueStrings(pack.manifest.flatMap((item) => item.sourceRefs));
  const authoritativeSourceRefs = uniqueStrings(pack.manifest
    .filter((item) => item.mode === 'full' && item.trustLevel === 'accepted_knowledge')
    .flatMap((item) => item.sourceRefs));
  const manifestRefs = pack.manifest.map((item) => item.ref);
  const sectionsById = new Map(pack.sections.map((section) => [section.id, section]));
  return {
    contextPackId: pack.id,
    mode: pack.mode,
    manifestRefs,
    sourceRefs,
    selected: pack.manifest.map((item) => ({
      ref: item.ref,
      mode: item.mode,
      trustLevel: item.trustLevel,
      freshness: item.freshness,
      knowledgeClass: item.knowledgeClass,
      reason: sectionsById.get(item.ref)?.reason ?? item.reason,
      content: sectionsById.get(item.ref)?.content ?? '',
      sourceRefs: item.sourceRefs,
      degradationReason: item.degradationReason ?? null,
    })),
    authoritativeSourceRefs,
    retrievalHints: pack.retrievalHints.map((hint) => hint.id),
    calibrationSignalCount: pack.calibrationSignals?.length ?? 0,
    calibrationSignals: (pack.calibrationSignals ?? []).map((signal) => ({
      id: signal.id,
      kind: signal.kind,
      severity: signal.severity,
      message: signal.message,
      subjectRefs: signal.subjectRefs,
      evidenceRefs: signal.evidenceRefs,
      recommendedAction: signal.recommendedAction,
    })),
    contextQuality: contextQualityMetrics(manifestRefs, relevantManifestRefPrefixes),
  };
}

function contextQualityMetrics(
  manifestRefs: readonly string[],
  relevantManifestRefPrefixes: readonly string[] | undefined,
): ContextQualityMetrics | null {
  const prefixes = uniqueStrings((relevantManifestRefPrefixes ?? []).map((prefix) => prefix.trim()));
  if (prefixes.length === 0) return null;
  const irrelevantRefs = manifestRefs.filter((ref) => !prefixes.some((prefix) => ref === prefix || ref.startsWith(prefix)));
  const selectedCount = manifestRefs.length;
  const irrelevantCount = irrelevantRefs.length;
  return {
    relevantManifestRefPrefixes: prefixes,
    selectedCount,
    relevantCount: selectedCount - irrelevantCount,
    irrelevantCount,
    irrelevantRatio: selectedCount === 0 ? 0 : Number((irrelevantCount / selectedCount).toFixed(4)),
    irrelevantRefs,
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
  const reqPath = join(input.workDir, `${input.profile}-requirement.md`);
  const designPath = join(input.workDir, `${input.profile}-design.md`);
  const diffPath = join(input.workDir, `${input.profile}-changes.diff`);
  const reviewPath = join(input.workDir, `${input.profile}-review.md`);
  const surefirePath = join(input.workDir, `${input.profile}-TEST.xml`);
  const matrixPath = join(input.workDir, `${input.profile}-verifier-ac-matrix.json`);
  const stdout = 'BUILD SUCCESS\n';
  const stderr = '';
  const businessProfile = isBusinessAcceptanceWorkflowProfile(input.profile);
  const req = businessProfile
    ? [
        '# Login Captcha Toggle Requirement',
        '',
        'REQ-001',
        '',
        '## Acceptance Criteria',
        '- AC-001: Disabling captcha lets a valid login submit without a captcha challenge.',
        '- AC-002: Enabling captcha still requires a captcha challenge before login succeeds.',
        '- AC-003: Invalid captcha configuration falls back to the safe default that requires captcha.',
        '',
      ].join('\n')
    : '# Requirement\n\nREQ-001\n- AC-001: Fixture acceptance criterion has business behavior.\n';
  const design = businessProfile
    ? [
        '# Login Captcha Toggle Design',
        '',
        '## Requirement Coverage Matrix',
        '| Requirement | Design item | Acceptance criteria | Verification |',
        '|---|---|---|---|',
        '| REQ-001 | AuthConfig disables captcha branch | AC-001 | Login integration fixture asserts no captcha challenge when config disables captcha |',
        '| REQ-001 | AuthConfig enables captcha branch | AC-002 | Login integration fixture asserts captcha challenge is required when config enables captcha |',
        '| REQ-001 | AuthConfig validation fallback | AC-003 | Login integration fixture asserts invalid config falls back to captcha required |',
        '',
      ].join('\n')
    : '# Design\n\n| Requirement | Design | Acceptance criteria | Verification |\n|---|---|---|---|\n| REQ-001 | Fixture | AC-001 | fixture verifies business behavior |\n';
  const diff = businessProfile
    ? 'diff --git a/src/auth/captcha.ts b/src/auth/captcha.ts\n'
    : 'diff --git a/src/main.ts b/src/main.ts\n';
  const review = businessProfile
    ? '# Review\n\nVerified captcha toggle core, boundary, and exception fixture evidence.\n'
    : '# Review\n\nVerified with fixture evidence.\n';
  const surefire = businessProfile
    ? '<testsuite tests="3" failures="0" errors="0" skipped="0"></testsuite>\n'
    : '<testsuite tests="1" failures="0" errors="0" skipped="0"></testsuite>\n';
  for (const [path, content] of [
    [stdoutPath, stdout],
    [stderrPath, stderr],
    [reqPath, req],
    [designPath, design],
    [diffPath, diff],
    [reviewPath, review],
    [surefirePath, surefire],
  ] as const) {
    writeFileSync(path, content);
  }

  const artifactPrefix = `art_eval_${safeId(input.profile)}`;
  const reqArtifactId = `${artifactPrefix}_requirement`;
  const designArtifactId = `${artifactPrefix}_design`;
  const diffArtifactId = `${artifactPrefix}_diff`;
  const reviewArtifactId = `${artifactPrefix}_review`;
  const surefireArtifactId = `${artifactPrefix}_surefire`;
  const matrixArtifactId = `${artifactPrefix}_matrix`;
  const artifacts = [
    artifactFixture(reqArtifactId, 'requirement_draft', reqPath, input.workflowRunId, input.stepRunId, 'text/markdown', input.now),
    artifactFixture(designArtifactId, 'design_doc', designPath, input.workflowRunId, input.stepRunId, 'text/markdown', input.now),
    artifactFixture(diffArtifactId, 'diff', diffPath, input.workflowRunId, input.stepRunId, 'text/x-diff', input.now),
    artifactFixture(reviewArtifactId, 'other', reviewPath, input.workflowRunId, input.stepRunId, 'text/markdown', input.now),
    artifactFixture(surefireArtifactId, 'surefire_report', surefirePath, input.workflowRunId, input.stepRunId, 'application/xml', input.now),
  ];
  for (const artifact of artifacts) input.store.artifacts.insert(artifact);
  if (businessProfile && input.profile !== 'captcha_test_only') {
    const matrix = {
      schemaVersion: VERIFIER_AC_MATRIX_SCHEMA_VERSION,
      workflowRunId: input.workflowRunId,
      stepRunId: input.stepRunId,
      verifierRequired: false,
      verifierStatus: 'pass',
      acceptanceCriteria: [
        {
          id: 'AC-001',
          text: 'Disabling captcha lets a valid login submit without a captcha challenge.',
          scenarioType: 'core',
          verificationMethod: 'Login integration fixture asserts no captcha challenge when config disables captcha.',
          businessStatus: 'passed',
          status: 'pass',
          evidenceRefs: [
            { artifactId: reqArtifactId, claim: 'captcha disabled business requirement' },
            { artifactId: designArtifactId, claim: 'captcha disabled verification strategy' },
            { artifactId: surefireArtifactId, claim: 'captcha disabled integration test report' },
          ],
        },
        {
          id: 'AC-002',
          text: 'Enabling captcha still requires a captcha challenge before login succeeds.',
          scenarioType: 'boundary',
          verificationMethod: 'Login integration fixture asserts captcha challenge is required when config enables captcha.',
          businessStatus: 'passed',
          status: 'pass',
          evidenceRefs: [
            { artifactId: reqArtifactId, claim: 'captcha enabled boundary requirement' },
            { artifactId: designArtifactId, claim: 'captcha enabled verification strategy' },
            { artifactId: surefireArtifactId, claim: 'captcha enabled integration test report' },
          ],
        },
        {
          id: 'AC-003',
          text: 'Invalid captcha configuration falls back to the safe default that requires captcha.',
          scenarioType: 'exception',
          verificationMethod: 'Login integration fixture asserts invalid config falls back to captcha required.',
          businessStatus: 'passed',
          status: 'pass',
          evidenceRefs: [
            { artifactId: reqArtifactId, claim: 'invalid config exception requirement' },
            { artifactId: designArtifactId, claim: 'invalid config fallback verification strategy' },
            { artifactId: surefireArtifactId, claim: 'invalid config fallback integration test report' },
          ],
        },
      ],
      createdAt: input.now,
    };
    writeFileSync(matrixPath, `${JSON.stringify(matrix, null, 2)}\n`);
    input.store.artifacts.insert({
      ...artifactFixture(matrixArtifactId, 'other', matrixPath, input.workflowRunId, input.stepRunId, 'application/json', input.now),
      metadata: {
        schemaVersion: VERIFIER_AC_MATRIX_SCHEMA_VERSION,
        reportKind: 'verifier_ac_matrix',
        verifierArtifactType: 'ac_matrix',
        verifierStatus: 'pass',
        stage: 'review',
        subStage: 'verifier',
        output: 'verifier-ac-matrix.json',
      },
    });
  }
  if (businessProfile) {
    for (const stage of ['requirement', 'design'] as const) {
      input.store.stepRuns.set(`step_${safeId(input.profile)}_${stage}`, {
        id: `step_${safeId(input.profile)}_${stage}`,
        workflowRunId: input.workflowRunId,
        stage,
        name: `${stage}-fixture`,
        status: 'passed',
        startedAt: input.now,
        completedAt: input.now,
      });
    }
  }

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
    { artifactId: diffArtifactId, claim: 'implementation diff' },
    { artifactId: reviewArtifactId, claim: 'review artifact' },
    { artifactId: surefireArtifactId, claim: 'test report artifact' },
  ];
  input.store.gateRuns.insert(gateFixture({
    id: `gate_${safeId(input.profile)}_compile`,
    gateId: 'compile_gate',
    workflowRunId: input.workflowRunId,
    stepRunId: input.stepRunId,
    ruleId: 'compile.exit_zero',
    evidenceRefs: input.profile === 'artifact_only_compile'
      ? [{ artifactId: reviewArtifactId, claim: 'compile note without command evidence' }]
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
      ? [{ artifactId: surefireArtifactId, claim: 'test report artifact' }]
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

function isBusinessAcceptanceWorkflowProfile(profile: WorkflowFixtureProfile): boolean {
  return profile === 'captcha_business_acceptance' || profile === 'captcha_test_only';
}

function latestBusinessAcceptanceMatrixArtifact(artifacts: Artifact[]): Artifact | null {
  return artifacts
    .filter((artifact) =>
      artifact.metadata.schemaVersion === VERIFIER_AC_MATRIX_SCHEMA_VERSION
      || artifact.metadata.reportKind === 'verifier_ac_matrix'
      || artifact.metadata.verifierArtifactType === 'ac_matrix')
    .at(-1) ?? null;
}

function businessAcceptanceMatrixRows(artifacts: Artifact[]): number {
  const matrix = readBusinessAcceptanceMatrix(artifacts);
  return matrix.length;
}

function businessAcceptanceMatrixScenarioTypes(artifacts: Artifact[]): string[] {
  return uniqueStrings(readBusinessAcceptanceMatrix(artifacts)
    .map((row) => row.scenarioType)
    .filter((value): value is string => typeof value === 'string' && value.length > 0));
}

function readBusinessAcceptanceMatrix(artifacts: Artifact[]): Array<Record<string, unknown>> {
  const artifact = latestBusinessAcceptanceMatrixArtifact(artifacts);
  if (!artifact) return [];
  try {
    const parsed = JSON.parse(readFileSync(fileURLToPath(artifact.uri), 'utf8')) as { acceptanceCriteria?: unknown };
    return Array.isArray(parsed.acceptanceCriteria)
      ? parsed.acceptanceCriteria.filter((row): row is Record<string, unknown> =>
          typeof row === 'object' && row !== null && !Array.isArray(row))
      : [];
  } catch {
    return [];
  }
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
  if (expectations.profileBootstrapFlow !== undefined) {
    checks.push(check('profileBootstrapFlow', expectations.profileBootstrapFlow, Boolean(output.profileBootstrap)));
  }
  if (expectations.profileFlowStages !== undefined) {
    checks.push({
      name: 'profileFlowStages',
      expected: expectations.profileFlowStages,
      actual: output.profileBootstrap?.stages ?? null,
      status: output.profileBootstrap && arraysEqual(expectations.profileFlowStages, output.profileBootstrap.stages)
        ? 'pass'
        : 'fail',
    });
  }
  if (expectations.inventoryArtifactPersisted !== undefined) {
    checks.push(check(
      'inventoryArtifactPersisted',
      expectations.inventoryArtifactPersisted,
      Boolean(output.profileBootstrap?.inventoryArtifactId)
        && (output.profileBootstrap?.artifactOutputs.includes('project-inventory.json') ?? false),
    ));
  }
  if (expectations.sourceChunkIndexArtifactPersisted !== undefined) {
    checks.push(check(
      'sourceChunkIndexArtifactPersisted',
      expectations.sourceChunkIndexArtifactPersisted,
      Boolean(output.profileBootstrap?.sourceChunkIndexArtifactId)
        && (output.profileBootstrap?.artifactOutputs.includes('source-chunk-index.json') ?? false),
    ));
  }
  if (expectations.sourceChunkIndexNotInjectedAsInput !== undefined) {
    checks.push(check(
      'sourceChunkIndexNotInjectedAsInput',
      expectations.sourceChunkIndexNotInjectedAsInput,
      output.profileBootstrap ? !output.profileBootstrap.sourceChunkIndexInjectedAsInput : null,
    ));
  }
  if (expectations.profileArtifactCount !== undefined) {
    checks.push(check(
      'profileArtifactCount',
      expectations.profileArtifactCount,
      output.profileBootstrap?.profileArtifactCount ?? null,
    ));
  }
  if (expectations.profileJsonContractValid !== undefined) {
    checks.push(check(
      'profileJsonContractValid',
      expectations.profileJsonContractValid,
      output.profileBootstrap?.profileJsonContractValid ?? null,
    ));
  }
  if (expectations.profileJsonProvenanceValid !== undefined) {
    checks.push(check(
      'profileJsonProvenanceValid',
      expectations.profileJsonProvenanceValid,
      output.profileBootstrap?.profileJsonProvenanceValid ?? null,
    ));
  }
  if (expectations.rawInventoryExcludedFromProfileMarkdown !== undefined) {
    checks.push(check(
      'rawInventoryExcludedFromProfileMarkdown',
      expectations.rawInventoryExcludedFromProfileMarkdown,
      output.profileBootstrap ? !output.profileBootstrap.rawInventoryInProfileMarkdown : null,
    ));
  }
  if (expectations.knowledgeCandidateReviewableOnly !== undefined) {
    checks.push(check(
      'knowledgeCandidateReviewableOnly',
      expectations.knowledgeCandidateReviewableOnly,
      output.profileBootstrap
        ? output.profileBootstrap.knowledgeCandidateGenerated
          && output.profileBootstrap.knowledgeCandidateReviewable
          && !output.profileBootstrap.knowledgePersisted
        : null,
    ));
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
  for (const sectionExpectation of expectations.selectedSectionsInclude ?? []) {
    const section = output.selected.find((item) => item.ref === sectionExpectation.ref) ?? null;
    checks.push({
      name: `selectedSectionsInclude:${sectionExpectation.ref}`,
      expected: true,
      actual: Boolean(section),
      status: section ? 'pass' : 'fail',
    });
    if (sectionExpectation.mode !== undefined) {
      checks.push(check(`selectedSectionMode:${sectionExpectation.ref}`, sectionExpectation.mode, section?.mode ?? null));
    }
    for (const text of sectionExpectation.contentIncludes ?? []) {
      checks.push(textIncludesCheck(
        `selectedSectionContentIncludes:${sectionExpectation.ref}:${text}`,
        section?.content ?? '',
        text,
        true,
      ));
    }
    for (const text of sectionExpectation.contentExcludes ?? []) {
      checks.push(textIncludesCheck(
        `selectedSectionContentExcludes:${sectionExpectation.ref}:${text}`,
        section?.content ?? '',
        text,
        false,
      ));
    }
    for (const text of sectionExpectation.reasonIncludes ?? []) {
      checks.push(textIncludesCheck(
        `selectedSectionReasonIncludes:${sectionExpectation.ref}:${text}`,
        section?.reason ?? '',
        text,
        true,
      ));
    }
    for (const text of sectionExpectation.reasonExcludes ?? []) {
      checks.push(textIncludesCheck(
        `selectedSectionReasonExcludes:${sectionExpectation.ref}:${text}`,
        section?.reason ?? '',
        text,
        false,
      ));
    }
    for (const sourceRef of sectionExpectation.sourceRefsInclude ?? []) {
      checks.push(includesCheck(
        `selectedSectionSourceRefsInclude:${sectionExpectation.ref}:${sourceRef}`,
        section?.sourceRefs ?? [],
        sourceRef,
        true,
      ));
    }
    for (const sourceRef of sectionExpectation.sourceRefsExclude ?? []) {
      checks.push(includesCheck(
        `selectedSectionSourceRefsExclude:${sectionExpectation.ref}:${sourceRef}`,
        section?.sourceRefs ?? [],
        sourceRef,
        false,
      ));
    }
  }
  if (expectations.irrelevantContextRatioMax !== undefined) {
    const metrics = output.contextQuality;
    checks.push({
      name: 'irrelevantContextRatioMax',
      expected: expectations.irrelevantContextRatioMax,
      actual: metrics?.irrelevantRatio ?? null,
      status: metrics && metrics.irrelevantRatio <= expectations.irrelevantContextRatioMax ? 'pass' : 'fail',
    });
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
  for (const signalExpectation of expectations.calibrationSignalsInclude ?? []) {
    const signal = output.calibrationSignals.find((item) => calibrationSignalMatches(item, signalExpectation)) ?? null;
    const expectedSummary = calibrationSignalExpectationSummary(signalExpectation);
    checks.push({
      name: `calibrationSignalsInclude:${expectedSummary}`,
      expected: true,
      actual: signal ?? output.calibrationSignals,
      status: signal ? 'pass' : 'fail',
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

function calibrationSignalMatches(
  signal: ContextPackFixtureOutput['calibrationSignals'][number],
  expectation: CalibrationSignalExpectation,
): boolean {
  if (expectation.id !== undefined && signal.id !== expectation.id) return false;
  if (expectation.kind !== undefined && signal.kind !== expectation.kind) return false;
  if (expectation.severity !== undefined && signal.severity !== expectation.severity) return false;
  if (expectation.recommendedAction !== undefined && signal.recommendedAction !== expectation.recommendedAction) return false;
  for (const text of expectation.messageIncludes ?? []) {
    if (!signal.message.includes(text)) return false;
  }
  for (const text of expectation.messageExcludes ?? []) {
    if (signal.message.includes(text)) return false;
  }
  for (const ref of expectation.subjectRefsInclude ?? []) {
    if (!signal.subjectRefs.includes(ref)) return false;
  }
  for (const ref of expectation.subjectRefsExclude ?? []) {
    if (signal.subjectRefs.includes(ref)) return false;
  }
  for (const ref of expectation.evidenceRefsInclude ?? []) {
    if (!signal.evidenceRefs.includes(ref)) return false;
  }
  for (const ref of expectation.evidenceRefsExclude ?? []) {
    if (signal.evidenceRefs.includes(ref)) return false;
  }
  return true;
}

function calibrationSignalExpectationSummary(expectation: CalibrationSignalExpectation): string {
  return [
    expectation.id,
    expectation.kind ? `kind=${expectation.kind}` : null,
    expectation.severity ? `severity=${expectation.severity}` : null,
    expectation.recommendedAction ? `action=${expectation.recommendedAction}` : null,
    ...(expectation.messageIncludes ?? []).map((text) => `message~${text}`),
    ...(expectation.subjectRefsInclude ?? []).map((ref) => `subject=${ref}`),
    ...(expectation.evidenceRefsInclude ?? []).map((ref) => `evidence=${ref}`),
  ].filter((item): item is string => Boolean(item)).join('|') || 'signal';
}

function checkLegacyProjectUnderstandingOutput(
  output: LegacyProjectUnderstandingFixtureOutput,
  expectations: LegacyProjectUnderstandingExpectations,
): EvalCheck[] {
  const checks = checkContextPackOutput(output.context, expectations);
  addMinCheck(checks, 'inventoryCapabilityCountMin', expectations.inventoryCapabilityCountMin, output.inventory.stats.capabilityCount);
  addMaxCheck(checks, 'inventoryCapabilityCountMax', expectations.inventoryCapabilityCountMax, output.inventory.stats.capabilityCount);
  addMinCheck(checks, 'inventoryEntrypointRouteCountMin', expectations.inventoryEntrypointRouteCountMin, output.inventory.stats.entrypointRouteCount);
  addMaxCheck(checks, 'inventoryEntrypointRouteCountMax', expectations.inventoryEntrypointRouteCountMax, output.inventory.stats.entrypointRouteCount);
  addMinCheck(checks, 'inventorySymbolCountMin', expectations.inventorySymbolCountMin, output.inventory.stats.symbolCount);
  addMinCheck(checks, 'inventoryGraphEdgeCountMin', expectations.inventoryGraphEdgeCountMin, output.inventory.stats.graphEdgeCount);
  addNullableMinCheck(
    checks,
    'inventoryGraphEdgeConfidenceMin',
    expectations.inventoryGraphEdgeConfidenceMin,
    output.inventory.graphEdgeConfidenceMin,
  );
  addMinCheck(checks, 'inventoryRouteHandlerEdgeCountMin', expectations.inventoryRouteHandlerEdgeCountMin, output.inventory.stats.routeHandlerEdgeCount);
  addNullableMinCheck(
    checks,
    'inventoryRouteHandlerEdgeConfidenceMin',
    expectations.inventoryRouteHandlerEdgeConfidenceMin,
    output.inventory.routeHandlerEdgeConfidenceMin,
  );
  addMinCheck(checks, 'inventorySourceChunkCountMin', expectations.inventorySourceChunkCountMin, output.inventory.stats.sourceChunkCount);
  addMinCheck(checks, 'inventoryExclusionCountMin', expectations.inventoryExclusionCountMin, output.inventory.stats.exclusionCount);
  for (const label of expectations.inventoryCapabilityLabelsInclude ?? []) {
    checks.push(includesCheck(`inventoryCapabilityLabelsInclude:${label}`, output.inventory.capabilityLabels, label, true));
  }
  for (const label of expectations.inventoryCapabilityLabelsExclude ?? []) {
    checks.push(includesCheck(`inventoryCapabilityLabelsExclude:${label}`, output.inventory.capabilityLabels, label, false));
  }
  for (const route of expectations.inventoryEntrypointRoutesInclude ?? []) {
    checks.push(includesCheck(`inventoryEntrypointRoutesInclude:${route}`, output.inventory.entrypointRoutes, route, true));
  }
  for (const symbol of expectations.inventorySymbolNamesInclude ?? []) {
    checks.push(includesCheck(`inventorySymbolNamesInclude:${symbol}`, output.inventory.symbolNames, symbol, true));
  }
  for (const kind of expectations.inventoryGraphEdgeKindsInclude ?? []) {
    checks.push(includesCheck(`inventoryGraphEdgeKindsInclude:${kind}`, output.inventory.graphEdgeKinds, kind, true));
  }
  for (const ref of expectations.inventorySourceChunkGraphEdgeRefsInclude ?? []) {
    checks.push(includesCheck(
      `inventorySourceChunkGraphEdgeRefsInclude:${ref}`,
      output.inventory.sourceChunkGraphEdgeRefs,
      ref,
      true,
    ));
  }
  for (const exclusion of expectations.inventoryExclusionsInclude ?? []) {
    checks.push(includesCheck(`inventoryExclusionsInclude:${exclusion}`, output.inventory.exclusions, exclusion, true));
  }
  return checks;
}

function checkScenarioContextQuality(
  variants: readonly EvalVariantResult[],
  gates: ContextQualityScenarioGates | undefined,
): EvalCheck[] {
  if (!gates) return [];
  const metrics = variants
    .map((variant) => contextQualityFromVariantOutput(variant.output))
    .filter((metric): metric is ContextQualityMetrics => metric !== null);
  const ratios = metrics.map((metric) => metric.irrelevantRatio);
  const measuredVariants = ratios.length;
  const irrelevantContextRatioAverage = measuredVariants === 0
    ? null
    : Number((ratios.reduce((sum, ratio) => sum + ratio, 0) / measuredVariants).toFixed(4));
  const irrelevantContextRatioMax = measuredVariants === 0
    ? null
    : Number(Math.max(...ratios).toFixed(4));
  const checks: EvalCheck[] = [];
  addMinCheck(checks, 'contextQualityGates.measuredVariantsMin', gates.measuredVariantsMin, measuredVariants);
  if (gates.irrelevantContextRatioAverageMax !== undefined) {
    checks.push({
      name: 'contextQualityGates.irrelevantContextRatioAverageMax',
      expected: gates.irrelevantContextRatioAverageMax,
      actual: irrelevantContextRatioAverage,
      status: irrelevantContextRatioAverage !== null
        && irrelevantContextRatioAverage <= gates.irrelevantContextRatioAverageMax
        ? 'pass'
        : 'fail',
    });
  }
  if (gates.irrelevantContextRatioMax !== undefined) {
    checks.push({
      name: 'contextQualityGates.irrelevantContextRatioMax',
      expected: gates.irrelevantContextRatioMax,
      actual: irrelevantContextRatioMax,
      status: irrelevantContextRatioMax !== null
        && irrelevantContextRatioMax <= gates.irrelevantContextRatioMax
        ? 'pass'
        : 'fail',
    });
  }
  return checks;
}

function checkScenarioLegacyInventoryQuality(
  variants: readonly EvalVariantResult[],
  gates: LegacyInventoryQualityScenarioGates | undefined,
): EvalCheck[] {
  const outputs = variants
    .map((variant) => legacyProjectUnderstandingOutput(variant.output))
    .filter((output): output is LegacyProjectUnderstandingFixtureOutput => output !== null);
  const graphEdgeConfidenceValues = outputs
    .map((output) => output.inventory.graphEdgeConfidenceMin)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const routeHandlerEdgeConfidenceValues = outputs
    .map((output) => output.inventory.routeHandlerEdgeConfidenceMin)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const sourceChunkContentSha256CoverageValues = outputs
    .map((output) => output.inventory.sourceChunkContentSha256Coverage)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const sourceChunkIndexCoverageValues = outputs
    .map((output) => output.inventory.sourceChunkIndexCoverage)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const sourceChunkLinkedRecordCoverageValues = outputs
    .map((output) => output.inventory.sourceChunkLinkedRecordCoverage)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const sourceFileExtensions = uniqueStrings(outputs.flatMap((output) => output.inventory.sourceFileExtensions)).sort();
  const sourcePathPatterns = uniqueStrings(outputs.flatMap((output) => output.inventory.sourcePathPatterns)).sort();
  const sourceRecordKinds = uniqueStrings(outputs.flatMap((output) => output.inventory.sourceRecordKinds)).sort();
  const graphEdgeConfidenceMin = minFiniteNumber(graphEdgeConfidenceValues);
  const routeHandlerEdgeConfidenceMin = minFiniteNumber(routeHandlerEdgeConfidenceValues);
  const sourceChunkContentSha256CoverageMin = minFiniteNumber(sourceChunkContentSha256CoverageValues);
  const sourceChunkIndexCoverageMin = minFiniteNumber(sourceChunkIndexCoverageValues);
  const sourceChunkLinkedRecordCoverageMin = minFiniteNumber(sourceChunkLinkedRecordCoverageValues);
  const graphEdgeFloor = gates?.graphEdgeConfidenceMin
    ?? (graphEdgeConfidenceValues.length > 0 ? DEFAULT_LEGACY_GRAPH_EDGE_CONFIDENCE_MIN : undefined);
  const routeHandlerEdgeFloor = gates?.routeHandlerEdgeConfidenceMin
    ?? (routeHandlerEdgeConfidenceValues.length > 0 ? DEFAULT_LEGACY_ROUTE_HANDLER_EDGE_CONFIDENCE_MIN : undefined);
  const checks: EvalCheck[] = [];
  addMinCheck(
    checks,
    'inventoryQualityGates.measuredVariantsMin',
    gates?.measuredVariantsMin,
    outputs.length,
  );
  addNullableMinCheck(
    checks,
    gates?.graphEdgeConfidenceMin === undefined
      ? 'inventoryQualityDefaults.graphEdgeConfidenceMin'
      : 'inventoryQualityGates.graphEdgeConfidenceMin',
    graphEdgeFloor,
    graphEdgeConfidenceMin,
  );
  addNullableMinCheck(
    checks,
    gates?.routeHandlerEdgeConfidenceMin === undefined
      ? 'inventoryQualityDefaults.routeHandlerEdgeConfidenceMin'
      : 'inventoryQualityGates.routeHandlerEdgeConfidenceMin',
    routeHandlerEdgeFloor,
    routeHandlerEdgeConfidenceMin,
  );
  addNullableMinCheck(
    checks,
    'inventoryQualityGates.sourceChunkContentSha256CoverageMin',
    gates?.sourceChunkContentSha256CoverageMin,
    sourceChunkContentSha256CoverageMin,
  );
  addNullableMinCheck(
    checks,
    'inventoryQualityGates.sourceChunkIndexCoverageMin',
    gates?.sourceChunkIndexCoverageMin,
    sourceChunkIndexCoverageMin,
  );
  addNullableMinCheck(
    checks,
    'inventoryQualityGates.sourceChunkLinkedRecordCoverageMin',
    gates?.sourceChunkLinkedRecordCoverageMin,
    sourceChunkLinkedRecordCoverageMin,
  );
  addCountMinCheck(
    checks,
    'inventoryQualityGates.sourceFileExtensionCountMin',
    gates?.sourceFileExtensionCountMin,
    sourceFileExtensions,
  );
  addCountMinCheck(
    checks,
    'inventoryQualityGates.sourcePathPatternCountMin',
    gates?.sourcePathPatternCountMin,
    sourcePathPatterns,
  );
  addCountMinCheck(
    checks,
    'inventoryQualityGates.sourceRecordKindCountMin',
    gates?.sourceRecordKindCountMin,
    sourceRecordKinds,
  );
  return checks;
}

function checkInventorySectionGateCoverage(
  scenario: ContextPackEvalScenario | LegacyProjectUnderstandingEvalScenario,
): EvalCheck[] {
  const variants = (scenario.variants?.length
    ? scenario.variants
    : [{ id: 'default', label: 'Default' }]) as readonly Array<{
      id: string;
      expectations?: ContextPackExpectations;
    }>;
  const baseExpectations = scenario.expectations as ContextPackExpectations | undefined;
  const checks: EvalCheck[] = [];
  for (const variant of variants) {
    const expectations = { ...(baseExpectations ?? {}), ...(variant.expectations ?? {}) };
    const inventoryManifestRefs = (expectations.manifestRefsInclude ?? [])
      .filter((ref) => ref.startsWith('inventory_'));
    if (inventoryManifestRefs.length === 0) continue;
    const selectedSectionGateCount = expectations.selectedSectionsInclude?.length ?? 0;
    if (selectedSectionGateCount > 0) continue;
    checks.push({
      name: `inventorySelectedSectionsIncludeRequired:${variant.id}`,
      expected: 'selectedSectionsInclude when manifestRefsInclude contains inventory_* refs',
      actual: {
        manifestRefsInclude: inventoryManifestRefs,
        selectedSectionsInclude: selectedSectionGateCount,
      },
      status: 'fail',
    });
  }
  return checks;
}

function contextQualityFromVariantOutput(output: unknown): ContextQualityMetrics | null {
  if (isRecord(output) && isContextQualityMetrics(output.contextQuality)) {
    return output.contextQuality;
  }
  return legacyProjectUnderstandingOutput(output)?.context.contextQuality ?? null;
}

function isContextQualityMetrics(value: unknown): value is ContextQualityMetrics {
  return isRecord(value)
    && Array.isArray(value.relevantManifestRefPrefixes)
    && typeof value.selectedCount === 'number'
    && typeof value.relevantCount === 'number'
    && typeof value.irrelevantCount === 'number'
    && typeof value.irrelevantRatio === 'number'
    && Array.isArray(value.irrelevantRefs);
}

function addMinCheck(
  checks: EvalCheck[],
  name: string,
  expected: number | undefined,
  actual: number,
): void {
  if (expected === undefined) return;
  checks.push({
    name,
    expected,
    actual,
    status: actual >= expected ? 'pass' : 'fail',
  });
}

function addCountMinCheck(
  checks: EvalCheck[],
  name: string,
  expected: number | undefined,
  values: readonly string[],
): void {
  if (expected === undefined) return;
  checks.push({
    name,
    expected,
    actual: {
      count: values.length,
      values,
    },
    status: values.length >= expected ? 'pass' : 'fail',
  });
}

function addNullableMinCheck(
  checks: EvalCheck[],
  name: string,
  expected: number | undefined,
  actual: number | null,
): void {
  if (expected === undefined) return;
  checks.push({
    name,
    expected,
    actual,
    status: actual !== null && actual >= expected ? 'pass' : 'fail',
  });
}

function addMaxCheck(
  checks: EvalCheck[],
  name: string,
  expected: number | undefined,
  actual: number,
): void {
  if (expected === undefined) return;
  checks.push({
    name,
    expected,
    actual,
    status: actual <= expected ? 'pass' : 'fail',
  });
}

const LEGACY_INVENTORY_STAT_KEYS = [
  'capabilityCount',
  'entrypointRouteCount',
  'symbolCount',
  'graphEdgeCount',
  'routeHandlerEdgeCount',
  'sourceChunkCount',
  'sourceChunkContentSha256Count',
  'sourceChunkIndexEntryCount',
  'sourceChunkIndexedCount',
  'sourceChunkLinkedRecordCount',
  'sourceFileExtensionCount',
  'sourcePathPatternCount',
  'sourceRecordKindCount',
  'exclusionCount',
] as const satisfies readonly (keyof LegacyInventoryStats)[];

function buildLegacyInventorySummary(
  results: readonly EvalScenarioResult[],
): LegacyInventoryEvalSummary | null {
  const variants: LegacyInventoryEvalSummaryVariant[] = [];
  const scenarioIds = new Set<string>();
  for (const scenario of results) {
    if (scenario.kind !== 'legacy_project_understanding_fixture') continue;
    scenarioIds.add(scenario.scenarioId);
    for (const variant of scenario.variants) {
      const output = legacyProjectUnderstandingOutput(variant.output);
      if (!output) continue;
      variants.push({
        scenarioId: scenario.scenarioId,
        variantId: variant.variantId,
        status: variant.status,
        selectedContextSections: output.context.selected.length,
        irrelevantContextRatio: output.context.contextQuality?.irrelevantRatio ?? null,
        stats: output.inventory.stats,
      });
    }
  }

  if (variants.length === 0) return null;

  const totals = zeroLegacyInventoryStats();
  const min = { ...variants[0]!.stats };
  const max = { ...variants[0]!.stats };
  let selectedTotal = 0;
  let selectedMin = variants[0]!.selectedContextSections;
  let selectedMax = variants[0]!.selectedContextSections;
  let measuredContextQualityCount = 0;
  let irrelevantRatioTotal = 0;
  let irrelevantRatioMax = 0;
  for (const variant of variants) {
    selectedTotal += variant.selectedContextSections;
    selectedMin = Math.min(selectedMin, variant.selectedContextSections);
    selectedMax = Math.max(selectedMax, variant.selectedContextSections);
    if (variant.irrelevantContextRatio !== null) {
      measuredContextQualityCount += 1;
      irrelevantRatioTotal += variant.irrelevantContextRatio;
      irrelevantRatioMax = Math.max(irrelevantRatioMax, variant.irrelevantContextRatio);
    }
    for (const key of LEGACY_INVENTORY_STAT_KEYS) {
      totals[key] += variant.stats[key];
      min[key] = Math.min(min[key], variant.stats[key]);
      max[key] = Math.max(max[key], variant.stats[key]);
    }
  }

  const averages = zeroLegacyInventoryStats();
  for (const key of LEGACY_INVENTORY_STAT_KEYS) {
    averages[key] = Number((totals[key] / variants.length).toFixed(2));
  }

  return {
    scenarioCount: scenarioIds.size,
    variantRuns: variants.length,
    totals,
    averages,
    min,
    max,
    selectedContextSections: {
      total: selectedTotal,
      average: Number((selectedTotal / variants.length).toFixed(2)),
      min: selectedMin,
      max: selectedMax,
    },
    contextQuality: {
      measuredVariants: measuredContextQualityCount,
      irrelevantContextRatioAverage: measuredContextQualityCount === 0
        ? null
        : Number((irrelevantRatioTotal / measuredContextQualityCount).toFixed(4)),
      irrelevantContextRatioMax: measuredContextQualityCount === 0
        ? null
        : Number(irrelevantRatioMax.toFixed(4)),
    },
    variants,
  };
}

function legacyProjectUnderstandingOutput(output: unknown): LegacyProjectUnderstandingFixtureOutput | null {
  if (!isRecord(output) || !isRecord(output.inventory) || !isRecord(output.context)) return null;
  if (!isLegacyInventoryStats(output.inventory.stats)) return null;
  const selected = Array.isArray(output.context.selected) ? output.context.selected : null;
  if (!selected) return null;
  return output as unknown as LegacyProjectUnderstandingFixtureOutput;
}

function isLegacyInventoryStats(value: unknown): value is LegacyInventoryStats {
  if (!isRecord(value)) return false;
  return LEGACY_INVENTORY_STAT_KEYS.every((key) => typeof value[key] === 'number');
}

function zeroLegacyInventoryStats(): LegacyInventoryStats {
  return {
    capabilityCount: 0,
    entrypointRouteCount: 0,
    symbolCount: 0,
    graphEdgeCount: 0,
    routeHandlerEdgeCount: 0,
    sourceChunkCount: 0,
    sourceChunkContentSha256Count: 0,
    sourceChunkIndexEntryCount: 0,
    sourceChunkIndexedCount: 0,
    sourceChunkLinkedRecordCount: 0,
    sourceFileExtensionCount: 0,
    sourcePathPatternCount: 0,
    sourceRecordKindCount: 0,
    exclusionCount: 0,
  };
}

function minConfidence(records: readonly { confidence?: number }[]): number | null {
  const values = records
    .map((record) => record.confidence)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return minFiniteNumber(values);
}

function minFiniteNumber(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return Number(Math.min(...values).toFixed(4));
}

function checkWorkflowOutput(
  output: WorkflowFixtureOutput,
  expectations: WorkflowExpectations,
): EvalCheck[] {
  const checks: EvalCheck[] = [];
  if (expectations.acceptanceGateStatus !== undefined) {
    checks.push(check('acceptanceGateStatus', expectations.acceptanceGateStatus, output.acceptanceGateStatus));
  }
  for (const [ruleId, status] of Object.entries(expectations.acceptanceRuleStatuses ?? {})) {
    checks.push(check(`acceptanceRuleStatus:${ruleId}`, status, output.acceptanceRuleStatuses[ruleId] ?? null));
  }
  if (expectations.evidenceGateStatus !== undefined) {
    checks.push(check('evidenceGateStatus', expectations.evidenceGateStatus, output.evidenceGateStatus));
  }
  for (const [ruleId, status] of Object.entries(expectations.ruleStatuses ?? {})) {
    checks.push(check(`ruleStatus:${ruleId}`, status, output.ruleStatuses[ruleId] ?? null));
  }
  if (expectations.commandDigestBacked !== undefined) {
    checks.push(check('commandDigestBacked', expectations.commandDigestBacked, output.commandDigestBacked));
  }
  if (expectations.businessMatrixRows !== undefined) {
    checks.push(check('businessMatrixRows', expectations.businessMatrixRows, output.businessMatrixRows));
  }
  for (const scenarioType of expectations.businessMatrixScenarioTypes ?? []) {
    checks.push(includesCheck(
      `businessMatrixScenarioTypes:${scenarioType}`,
      output.businessMatrixScenarioTypes,
      scenarioType,
      true,
    ));
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
  if (expectations.completionReportHasBusinessMatrix !== undefined) {
    checks.push(check(
      'completionReportHasBusinessMatrix',
      expectations.completionReportHasBusinessMatrix,
      output.completionReportHasBusinessMatrix,
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

function checkGraphRuntimeOutput(
  output: GraphRuntimeFixtureOutput,
  expectations: GraphRuntimeExpectations,
): EvalCheck[] {
  const checks: EvalCheck[] = [];
  if (expectations.stageOrderMatchesFlow !== undefined) {
    checks.push(check(
      'stageOrderMatchesFlow',
      expectations.stageOrderMatchesFlow,
      arraysEqual(output.stageOrder, output.flowStageOrder),
    ));
  }
  if (expectations.stageOrder !== undefined) {
    checks.push({
      name: 'stageOrder',
      expected: expectations.stageOrder,
      actual: output.stageOrder,
      status: arraysEqual(expectations.stageOrder, output.stageOrder) ? 'pass' : 'fail',
    });
  }
  if (expectations.runnableStages !== undefined) {
    checks.push({
      name: 'runnableStages',
      expected: expectations.runnableStages,
      actual: output.runnableStages,
      status: arraysEqual(expectations.runnableStages, output.runnableStages) ? 'pass' : 'fail',
    });
  }
  if (expectations.branchEvidenceIsolated !== undefined) {
    checks.push(check('branchEvidenceIsolated', expectations.branchEvidenceIsolated, output.branchEvidenceIsolated));
  }
  if (expectations.branchNodeRunCount !== undefined) {
    checks.push(check('branchNodeRunCount', expectations.branchNodeRunCount, output.branchNodeRunCount));
  }
  if (expectations.resumeCreated !== undefined) {
    checks.push(check('resumeCreated', expectations.resumeCreated, output.resumeCreated));
  }
  if (expectations.resumeRejected !== undefined) {
    checks.push(check('resumeRejected', expectations.resumeRejected, output.resumeRejected));
  }
  if (expectations.resumeAttempt !== undefined) {
    checks.push(check('resumeAttempt', expectations.resumeAttempt, output.resumeAttempt));
  }
  if (expectations.resumeStatus !== undefined) {
    checks.push(check('resumeStatus', expectations.resumeStatus, output.resumeStatus));
  }
  if (expectations.resumeErrorIncludes !== undefined) {
    checks.push({
      name: 'resumeErrorIncludes',
      expected: expectations.resumeErrorIncludes,
      actual: output.resumeError,
      status: output.resumeError?.includes(expectations.resumeErrorIncludes) ? 'pass' : 'fail',
    });
  }
  if (expectations.sourceCheckpointLinked !== undefined) {
    checks.push(check(
      'sourceCheckpointLinked',
      expectations.sourceCheckpointLinked,
      output.sourceCheckpointId !== null,
    ));
  }
  for (const eventType of expectations.graphEventTypesInclude ?? []) {
    checks.push(includesCheck(`graphEventTypesInclude:${eventType}`, output.graphEventTypes, eventType, true));
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

function textIncludesCheck(name: string, actual: string, value: string, expected: boolean): EvalCheck {
  const includes = actual.includes(value);
  return {
    name,
    expected,
    actual,
    status: includes === expected ? 'pass' : 'fail',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function mergeInput<Input extends object>(
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
    && scenario.kind !== 'graph_runtime_fixture'
    && scenario.kind !== 'legacy_project_understanding_fixture'
  ) {
    throw new Error(`${source}: unsupported kind ${String((scenario as { kind?: unknown }).kind)}`);
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
  if (scenario.kind === 'graph_runtime_fixture' && (!scenario.input?.title || !scenario.input.flowId || !scenario.input.profile)) {
    throw new Error(`${source}: input.title, input.flowId, and input.profile are required`);
  }
  if (scenario.kind === 'legacy_project_understanding_fixture') {
    const hasInlineFiles = Array.isArray(scenario.input?.files) && scenario.input.files.length > 0;
    const hasFixtureDir = typeof scenario.input?.fixtureDir?.path === 'string' && scenario.input.fixtureDir.path.length > 0;
    if (!scenario.input?.title || (!hasInlineFiles && !hasFixtureDir)) {
      throw new Error(`${source}: input.title and either input.files or input.fixtureDir are required`);
    }
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

function arraysEqual(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
}

function sha256Text(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function renderHtml(report: EvalReport): string {
  const legacyInventorySummary = renderLegacyInventorySummaryHtml(report.legacyInventorySummary);
  const scenarioChecks = renderScenarioChecksHtml(report.results);
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
    .summary-table { margin: 16px 0 24px; max-width: 920px; }
    pre { margin: 0; max-width: 420px; white-space: pre-wrap; font-size: 12px; }
  </style>
</head>
<body>
  <h1>AINP Eval Report</h1>
  <p>Generated at ${escapeHtml(report.generatedAt)}. Scenarios: ${report.summary.scenarios}; variants: ${report.summary.variantRuns}; passed: ${report.summary.passed}; failed: ${report.summary.failed}; scenario checks passed/failed: ${report.summary.scenarioChecks.passed}/${report.summary.scenarioChecks.failed}.</p>
  ${legacyInventorySummary}
  ${scenarioChecks}
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

function renderScenarioChecksHtml(results: readonly EvalScenarioResult[]): string {
  const rows = results.flatMap((scenario) =>
    (scenario.scenarioChecks ?? []).map((check) => `
      <tr class="${check.status}">
        <td>${escapeHtml(scenario.scenarioId)}</td>
        <td>${escapeHtml(check.name)}</td>
        <td>${check.status}</td>
        <td><pre>${escapeHtml(JSON.stringify(check.expected, null, 2))}</pre></td>
        <td><pre>${escapeHtml(JSON.stringify(check.actual, null, 2))}</pre></td>
      </tr>`),
  ).join('\n');
  if (!rows) return '';
  return `
  <h2>Scenario Checks</h2>
  <table class="summary-table">
    <thead>
      <tr><th>Scenario</th><th>Check</th><th>Status</th><th>Expected</th><th>Actual</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderLegacyInventorySummaryHtml(summary: LegacyInventoryEvalSummary | null): string {
  if (!summary) return '';
  const rows = LEGACY_INVENTORY_STAT_KEYS.map((key) => `
      <tr>
        <td>${escapeHtml(key)}</td>
        <td>${summary.totals[key]}</td>
        <td>${summary.averages[key]}</td>
        <td>${summary.min[key]}</td>
        <td>${summary.max[key]}</td>
      </tr>`).join('\n');
  return `
  <h2>Legacy Inventory Summary</h2>
  <p>Legacy scenarios: ${summary.scenarioCount}; variants: ${summary.variantRuns}; selected context sections avg/min/max: ${summary.selectedContextSections.average}/${summary.selectedContextSections.min}/${summary.selectedContextSections.max}; irrelevant-context ratio measured variants: ${summary.contextQuality.measuredVariants}; avg/max: ${formatNullableRatio(summary.contextQuality.irrelevantContextRatioAverage)}/${formatNullableRatio(summary.contextQuality.irrelevantContextRatioMax)}.</p>
  <table class="summary-table">
    <thead>
      <tr><th>Metric</th><th>Total</th><th>Average</th><th>Min</th><th>Max</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function formatNullableRatio(value: number | null): string {
  return value === null ? '-' : `${Math.round(value * 100)}%`;
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
