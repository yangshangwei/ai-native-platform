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
  FlowId,
  KnowledgeArtifact,
  KnowledgeArtifactKind,
  RouterInput,
  WorkflowRunType,
  WorkflowStage,
} from '@ainp/shared';

type ScenarioKind = 'router_recommendation';

interface EvalScenario {
  schemaVersion: 'ainp.eval.scenario.v1';
  id: string;
  title: string;
  description?: string;
  kind: ScenarioKind;
  input: RouterEvalInput;
  expectations?: RouterExpectations;
  variants?: EvalVariant[];
}

interface EvalVariant {
  id: string;
  label?: string;
  backend?: 'codex' | 'claude_code' | 'rules_only';
  skillVariant?: string;
  knowledgeVariant?: string;
  inputOverrides?: Partial<RouterEvalInput>;
  expectations?: RouterExpectations;
}

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
  const variants = scenario.variants?.length
    ? scenario.variants
    : [{ id: 'default', label: 'Default' } satisfies EvalVariant];
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

async function runRouterVariant(
  scenario: EvalScenario,
  variant: EvalVariant,
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

function mergeInput(base: RouterEvalInput, overrides: Partial<RouterEvalInput> = {}): RouterEvalInput {
  return {
    ...base,
    ...overrides,
    messageHistory: overrides.messageHistory ?? base.messageHistory,
    knowledgeArtifacts: overrides.knowledgeArtifacts ?? base.knowledgeArtifacts,
  };
}

function validateScenario(scenario: EvalScenario, source: string): void {
  if (scenario.schemaVersion !== 'ainp.eval.scenario.v1') {
    throw new Error(`${source}: unsupported schemaVersion ${String(scenario.schemaVersion)}`);
  }
  if (!scenario.id || !scenario.title) throw new Error(`${source}: id and title are required`);
  if (scenario.kind !== 'router_recommendation') {
    throw new Error(`${source}: unsupported kind ${String(scenario.kind)}`);
  }
  if (!scenario.input?.projectId || !scenario.input.title || !scenario.input.runType) {
    throw new Error(`${source}: input.projectId, input.title, and input.runType are required`);
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
    tr.pass td:nth-child(6) { color: #147a3d; font-weight: 700; }
    tr.fail td:nth-child(6) { color: #b42318; font-weight: 700; }
    pre { margin: 0; max-width: 420px; white-space: pre-wrap; font-size: 12px; }
  </style>
</head>
<body>
  <h1>AINP Eval Report</h1>
  <p>Generated at ${escapeHtml(report.generatedAt)}. Scenarios: ${report.summary.scenarios}; variants: ${report.summary.variantRuns}; passed: ${report.summary.passed}; failed: ${report.summary.failed}.</p>
  <table>
    <thead>
      <tr><th>Scenario</th><th>Variant</th><th>Backend</th><th>Knowledge</th><th>Skill</th><th>Status</th><th>Output</th><th>Checks</th></tr>
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
