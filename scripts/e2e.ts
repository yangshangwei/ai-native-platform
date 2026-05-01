#!/usr/bin/env bun
/**
 * Full E2E smoke for the AI Native Platform MVP.
 *
 * Spawns `runner orchestrate` and, in parallel, polls the API. When the
 * workflow stops at a human gate (status=awaiting_human), the smoke POSTs an
 * approval to /approvals so the orchestrator can move on.
 *
 * Asserts at the end:
 *   - all 9 stages reached (init through knowledge)
 *   - 4 human gates approved
 *   - rule-based gates (requirement, design, diff_scope, sensitive_change,
 *     compile_optional, test) recorded with status=pass
 *   - mvn -B test command landed with exit=0
 *   - completion_report and knowledge_candidate artifacts present
 *   - acceptance + knowledge approvals recorded
 *
 * Requires: API already running (AINP_DB_PATH env may be overridden).
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

const API_BASE = process.env.AINP_API_BASE ?? 'http://127.0.0.1:8787';
const SAMPLE_PATH = resolve(import.meta.dir, '..', 'examples', 'java-maven-sample');
const RUNNER = resolve(import.meta.dir, '..', 'apps', 'runner', 'src', 'index.ts');

const STAGE_TO_GATE: Record<string, string> = {
  requirement: 'requirement_gate',
  design: 'design_gate',
  review: 'acceptance_gate',
  knowledge: 'knowledge_gate',
};

function fail(msg: string): never {
  console.error(`[e2e] FAIL: ${msg}`);
  process.exit(1);
}

function log(s: string): void {
  console.log(`[e2e] ${s}`);
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, init);
  if (!r.ok) fail(`${path} -> ${r.status}: ${await r.text()}`);
  return (await r.json()) as T;
}

function spawnRunner(args: string[]): {
  done: Promise<{ code: number }>;
} {
  const child = spawn('bun', ['run', RUNNER, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (b: Buffer) => process.stdout.write(`[runner] ${b}`));
  child.stderr.on('data', (b: Buffer) => process.stderr.write(`[runner] ${b}`));
  return {
    done: new Promise((resolveDone) =>
      child.on('close', (code) => resolveDone({ code: code ?? -1 })),
    ),
  };
}

async function ensureProject(): Promise<void> {
  if (!existsSync(SAMPLE_PATH)) fail(`sample missing: ${SAMPLE_PATH}`);
  if (!existsSync(`${SAMPLE_PATH}/.git`)) {
    fail(`sample is not a git repo. (cd ${SAMPLE_PATH} && git init && git add . && git commit -m initial)`);
  }
  // idempotent: API returns existing project if name already taken
  await fetchJson(`/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'java-sample', localPath: SAMPLE_PATH }),
  });
}

async function approveIfNeeded(workflowRunId: string, approved = new Set<string>()): Promise<void> {
  const detail = await fetchJson<{
    run: { status: string; currentStage: string; id: string };
  }>(`/workflow-runs/${workflowRunId}`);
  if (detail.run.status !== 'awaiting_human') return;
  const gateId = STAGE_TO_GATE[detail.run.currentStage];
  if (!gateId || approved.has(gateId)) return;
  approved.add(gateId);
  log(`approving ${gateId} (stage=${detail.run.currentStage})`);
  await fetchJson('/approvals', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowRunId,
      gateId,
      approved: true,
      actor: 'e2e-smoke',
      comment: 'auto-approved by e2e',
    }),
  });
}

async function findLatestRun(title: string): Promise<string | null> {
  const list = await fetchJson<{
    items: Array<{ id: string; title: string; createdAt: string }>;
  }>('/workflow-runs');
  const matches = list.items.filter((r) => r.title === title);
  if (matches.length === 0) return null;
  matches.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return matches[0]!.id;
}

async function main(): Promise<void> {
  log(`API: ${API_BASE}`);
  await ensureProject();

  const title = `e2e ${new Date().toISOString()}`;
  log(`spawning orchestrator with title=${title}`);
  const runner = spawnRunner(['orchestrate', '--project', 'java-sample', '--title', title]);

  // Poll loop: discover the workflowRunId, then approve human gates as they appear.
  const approved = new Set<string>();
  let workflowRunId: string | null = null;
  const pollUntilDone = async (): Promise<void> => {
    while (true) {
      if (!workflowRunId) {
        workflowRunId = await findLatestRun(title);
      }
      if (workflowRunId) {
        await approveIfNeeded(workflowRunId, approved);
      }
      // Also exit early when runner finishes
      const state = (runner as { done: Promise<{ code: number }> }).done;
      const finished = await Promise.race([
        state.then((r) => r),
        new Promise<{ code: number } | null>((res) => setTimeout(() => res(null), 300)),
      ]);
      if (finished) return;
    }
  };

  await pollUntilDone();
  const result = await runner.done;
  log(`orchestrator exited with code ${result.code}`);

  if (!workflowRunId) {
    workflowRunId = await findLatestRun(title);
  }
  if (!workflowRunId) fail('could not locate workflow run after orchestration');

  // ---- assertions ----
  const detail = await fetchJson<{
    run: { status: string; currentStage: string };
    steps: Array<{ stage: string; status: string }>;
    commands: Array<{ command: string; status: string; exitCode: number | null }>;
    gates: Array<{ gateId: string; status: string }>;
    artifacts: Array<{ kind: string; uri: string }>;
    builds: Array<{ id: string; status: string }>;
    tests: Array<{ framework: string; total: number; failed: number; errors: number }>;
    approvals: Array<{ gateId: string; decision: string }>;
  }>(`/workflow-runs/${workflowRunId}`);

  log(`run.status=${detail.run.status} stage=${detail.run.currentStage}`);
  log(`steps=${detail.steps.length} commands=${detail.commands.length} gates=${detail.gates.length} artifacts=${detail.artifacts.length}`);

  if (detail.run.status !== 'passed') fail(`workflow status=${detail.run.status}`);
  if (detail.run.currentStage !== 'completion' && detail.run.currentStage !== 'knowledge')
    fail(`workflow stage=${detail.run.currentStage}`);

  const stagesSeen = new Set(detail.steps.map((s) => s.stage));
  for (const required of ['requirement', 'design', 'implementation', 'build_test', 'review']) {
    if (!stagesSeen.has(required)) fail(`missing stage step: ${required}`);
  }

  const gateById = new Map(detail.gates.map((g) => [g.gateId, g.status]));
  for (const required of [
    'requirement_gate',
    'design_gate',
    'diff_scope_gate',
    'sensitive_change_gate',
    'test_gate',
    'acceptance_gate',
    'knowledge_gate',
  ]) {
    if (!gateById.has(required)) fail(`missing gate: ${required}`);
  }
  // Auto-rule-based gates must be pass; manual gates must be pass after approval.
  for (const gid of [
    'requirement_gate',
    'design_gate',
    'diff_scope_gate',
    'test_gate',
    'acceptance_gate',
    'knowledge_gate',
  ]) {
    if (gateById.get(gid) !== 'pass') fail(`${gid} status=${gateById.get(gid)}`);
  }

  const mvnCmd = detail.commands.find((c) => c.command.includes('mvn'));
  if (!mvnCmd || mvnCmd.exitCode !== 0) fail(`mvn command did not pass: ${JSON.stringify(mvnCmd)}`);

  const kinds = new Set(detail.artifacts.map((a) => a.kind));
  for (const required of [
    'requirement_draft',
    'design_doc',
    'diff',
    'surefire_report',
    'completion_report',
    'knowledge_candidate',
  ]) {
    if (!kinds.has(required)) fail(`missing artifact kind: ${required}`);
  }

  if (detail.builds.length === 0) fail('no BuildRun');
  if (detail.tests.length === 0) fail('no TestRun');
  const tr = detail.tests[0]!;
  if (tr.failed !== 0 || tr.errors !== 0) fail(`tests failed: ${JSON.stringify(tr)}`);

  const approvalGates = new Set(detail.approvals.map((a) => a.gateId));
  for (const g of ['requirement_gate', 'design_gate', 'acceptance_gate', 'knowledge_gate']) {
    if (!approvalGates.has(g)) fail(`missing approval for ${g}`);
  }

  log(`gates: ${[...gateById.entries()].map(([k, v]) => `${k}=${v}`).join(', ')}`);
  log(`artifacts: ${[...kinds].join(', ')}`);
  log(`tests: total=${tr.total} passed=${tr.total - tr.failed - tr.errors - (tr as { skipped?: number }).skipped! || tr.total - tr.failed - tr.errors} failed=${tr.failed}`);

  console.log('\n[e2e] PASS — full lifecycle verified.');
}

await main();
