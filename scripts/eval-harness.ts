#!/usr/bin/env bun
/**
 * Local deterministic eval harness.
 *
 * M4 starts with scenarios that exercise platform decision logic without an
 * API server or external agent backend. Scenario variants are first-class so
 * the same schema can later compare knowledge sets, skill prompts, and agent
 * backends against identical expectations.
 */
import { mkdtempSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import type {
  AgentResult,
  AgentTask,
  AgentSessionStatus,
  Artifact,
  FlowId,
  KnowledgeArtifact,
  KnowledgeArtifactKind,
  Project,
  RouterInput,
  SkillSpec,
  WorkflowRun,
  WorkflowRunType,
  WorkflowStage,
} from '@ainp/shared';
import type { AgentBackend, AgentRunResult } from '../apps/runner/src/agents/types';
import type { InvokeSkillDeps } from '../apps/runner/src/orchestrator/invoke-skill';
import type { RunCtx } from '../apps/runner/src/orchestrator/types';

type ScenarioKind = 'router_recommendation' | 'agent_backend_fixture';

type EvalScenario = RouterEvalScenario | AgentBackendEvalScenario;

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
  externalCliUsed?: boolean;
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
        lastMessage: input.behavior === 'context_request'
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
  if (expectations.externalCliUsed !== undefined) {
    checks.push(check('externalCliUsed', expectations.externalCliUsed, output.externalCliUsed));
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

function mergeInput<Input extends RouterEvalInput | AgentBackendEvalInput>(
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
  if (scenario.kind !== 'router_recommendation' && scenario.kind !== 'agent_backend_fixture') {
    throw new Error(`${source}: unsupported kind ${String(scenario.kind)}`);
  }
  if (scenario.kind === 'router_recommendation' && (!scenario.input?.projectId || !scenario.input.title || !scenario.input.runType)) {
    throw new Error(`${source}: input.projectId, input.title, and input.runType are required`);
  }
  if (scenario.kind === 'agent_backend_fixture' && (!scenario.input?.title || !scenario.input.behavior)) {
    throw new Error(`${source}: input.title and input.behavior are required`);
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
