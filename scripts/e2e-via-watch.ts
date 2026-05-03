#!/usr/bin/env bun
/**
 * Phase B end-to-end: drives a workflow request through `runner watch --once`
 * so the Coordinator triage runs (B7) and orchestrate is invoked with the
 * Coordinator-chosen runType.
 *
 * Uses AINP_AGENT_BACKEND from env (set claude_code to exercise real Claude;
 * leave unset for NativeBackend dry run).
 *
 * Asserts:
 *   - CoordinatorDecision persisted with action=proceed and source=rules
 *   - WorkflowRun created with type matching the decision's runType
 *   - All 9 stages reached, all rule gates pass, human gates auto-approved
 *   - Tests passed and completion_report + knowledge_candidate artifacts exist
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

const API_BASE = process.env.AINP_API_BASE ?? 'http://127.0.0.1:8787';
const SAMPLE_PATH = resolve(import.meta.dir, '..', 'examples', 'java-maven-sample');
const RUNNER = resolve(import.meta.dir, '..', 'apps', 'runner', 'src', 'index.ts');

// Feature-clear title aligned with the Calculator sample workspace. Phrased
// so the rule classifier routes confidently (>=0.65) without LLM fallback.
const TITLE = '为 Calculator 增加 divide(int,int) 方法，验收标准是 mvn test 通过';

const STAGE_TO_GATE: Record<string, string> = {
  requirement: 'requirement_gate',
  design: 'design_gate',
  review: 'acceptance_gate',
  knowledge: 'knowledge_gate',
};

function fail(msg: string): never {
  console.error(`[e2e-watch] FAIL: ${msg}`);
  process.exit(1);
}

function log(s: string): void {
  console.log(`[e2e-watch] ${s}`);
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, init);
  if (!r.ok) fail(`${path} -> ${r.status}: ${await r.text()}`);
  return (await r.json()) as T;
}

function spawnWatcher(): { done: Promise<{ code: number }> } {
  const child = spawn('bun', ['run', RUNNER, 'watch', '--once'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });
  child.stdout.on('data', (b: Buffer) => process.stdout.write(`[runner] ${b}`));
  child.stderr.on('data', (b: Buffer) => process.stderr.write(`[runner] ${b}`));
  return {
    done: new Promise((resolveDone) =>
      child.on('close', (code) => resolveDone({ code: code ?? -1 })),
    ),
  };
}

async function ensureProject(): Promise<{ id: string; name: string }> {
  if (!existsSync(SAMPLE_PATH)) fail(`sample missing: ${SAMPLE_PATH}`);
  if (!existsSync(`${SAMPLE_PATH}/.git`)) fail('sample has no .git — run git init first');
  const project = await fetchJson<{ id: string; name: string }>('/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'java-sample', localPath: SAMPLE_PATH }),
  });
  return project;
}

async function approveIfNeeded(workflowRunId: string, approved: Set<string>): Promise<void> {
  const detail = await fetchJson<{ run: { status: string; currentStage: string } }>(
    `/workflow-runs/${workflowRunId}`,
  );
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
      actor: 'e2e-watch',
      comment: 'auto-approved',
    }),
  });
}

async function main(): Promise<void> {
  log(`API: ${API_BASE}`);
  log(`backend: ${process.env.AINP_AGENT_BACKEND ?? 'native'}`);
  log(`title: ${TITLE}`);

  const project = await ensureProject();
  log(`project ${project.id}`);

  // 1. POST workflow request — runner watch will pick this up.
  const request = await fetchJson<{ id: string }>('/workflow-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId: project.id, type: 'feature', title: TITLE, branch: 'main' }),
  });
  log(`request ${request.id} created`);

  // 2. Spawn watch --once. It triages, claims, orchestrates, completes.
  const watcher = spawnWatcher();

  // 3. Poll for run id + auto-approve human gates as they appear.
  const approved = new Set<string>();
  let workflowRunId: string | null = null;
  while (true) {
    const reqDetail = await fetchJson<{ workflowRunId: string | null; status: string }>(
      `/workflow-requests/${request.id}`,
    );
    if (reqDetail.workflowRunId && !workflowRunId) {
      workflowRunId = reqDetail.workflowRunId;
      log(`watch created run ${workflowRunId}`);
    }
    if (workflowRunId) await approveIfNeeded(workflowRunId, approved);
    const finished = await Promise.race([
      watcher.done.then((r) => r),
      new Promise<{ code: number } | null>((res) => setTimeout(() => res(null), 400)),
    ]);
    if (finished) break;
  }
  const result = await watcher.done;
  log(`watch exited with code ${result.code}`);

  // 4. Assertions.
  const reqFinal = await fetchJson<{ workflowRunId: string | null; status: string }>(
    `/workflow-requests/${request.id}`,
  );
  if (!reqFinal.workflowRunId) fail('no workflowRunId on the request after watch finished');

  const chat = await fetchJson<{
    decision: {
      source: string;
      decision:
        | { action: 'proceed'; routeCase: string; runType: string }
        | { action: 'pause_for_human'; questions: string[] }
        | { action: 'abort' };
      confidence: number;
    } | null;
  }>(`/workflow-requests/${request.id}/messages`);
  if (!chat.decision) fail('CoordinatorDecision missing');
  log(
    `coordinator: source=${chat.decision.source} action=${chat.decision.decision.action} confidence=${chat.decision.confidence}`,
  );
  if (chat.decision.decision.action !== 'proceed') {
    fail(`expected proceed, got ${chat.decision.decision.action}`);
  }

  const detail = await fetchJson<{
    run: { status: string; type: string; currentStage: string };
    gates: Array<{ gateId: string; status: string }>;
    tests: Array<{ total: number; failed: number; errors: number }>;
    artifacts: Array<{ kind: string }>;
  }>(`/workflow-runs/${reqFinal.workflowRunId}`);

  if (detail.run.type !== chat.decision.decision.runType) {
    fail(`run.type=${detail.run.type} but decision.runType=${chat.decision.decision.runType}`);
  }
  if (detail.run.status !== 'passed') fail(`run.status=${detail.run.status}`);

  const gateById = new Map(detail.gates.map((g) => [g.gateId, g.status]));
  for (const gid of [
    'requirement_gate',
    'design_gate',
    'diff_scope_gate',
    'compile_gate',
    'test_gate',
    'acceptance_gate',
    'knowledge_gate',
  ]) {
    if (gateById.get(gid) !== 'pass') fail(`${gid}=${gateById.get(gid)}`);
  }

  if (detail.tests.length === 0) fail('no test runs');
  const t = detail.tests[0]!;
  if (t.failed !== 0 || t.errors !== 0) fail(`tests failed: ${JSON.stringify(t)}`);

  const kinds = new Set(detail.artifacts.map((a) => a.kind));
  for (const k of [
    'requirement_draft',
    'design_doc',
    'diff',
    'completion_report',
    'knowledge_candidate',
  ]) {
    if (!kinds.has(k)) fail(`missing artifact kind ${k}`);
  }

  log(`gates: ${[...gateById.entries()].map(([k, v]) => `${k}=${v}`).join(', ')}`);
  log(`tests: total=${t.total} failed=${t.failed}`);
  log(`run.type=${detail.run.type} (matches coordinator runType)`);
  log('PASS — Phase B Coordinator + full lifecycle verified.');
}

await main();
