#!/usr/bin/env bun
/**
 * Comprehensive E2E test for the AI Native Platform.
 *
 * Enhanced version of scripts/e2e.ts with:
 * - API preflight checks (health + Agent Backend CLI)
 * - SSE endpoint verification
 * - More detailed assertions (per-gate validation)
 * - Structured test report output (JSON)
 * - Better error messages
 *
 * Validates the full 8-stage feature.standard workflow:
 *   context_pack → requirement → design → implementation →
 *   build_test → review → completion → knowledge
 *
 * All 4 human gates are auto-approved via polling.
 *
 * Usage:
 *   # Start API first
 *   bun run dev:api
 *
 *   # Run comprehensive E2E test
 *   bun run scripts/e2e-comprehensive.ts
 *
 *   # With specific Agent Backend
 *   AINP_E2E_AGENT_BACKEND=claude_code bun run scripts/e2e-comprehensive.ts
 *
 * Requires: API running on :8787, claude/codex CLI available.
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

const API_BASE = process.env.AINP_API_BASE ?? 'http://127.0.0.1:8787';
const SAMPLE_PATH = resolve(import.meta.dir, '..', 'examples', 'java-maven-sample');
const RUNNER = resolve(import.meta.dir, '..', 'apps', 'runner', 'src', 'index.ts');
const AGENT_BACKEND = parseAgentBackend(process.env.AINP_E2E_AGENT_BACKEND ?? 'codex');
const TITLE = '为 Calculator 增加 subtract(int,int) 方法，验收标准是 mvn test 通过';

const STAGE_TO_GATE: Record<string, string> = {
  requirement: 'requirement_gate',
  design: 'design_gate',
  review: 'acceptance_gate',
  knowledge: 'knowledge_gate',
};

const REQUIRED_STAGES = [
  'context_pack',
  'requirement',
  'design',
  'implementation',
  'build_test',
  'review',
  'completion',
  'knowledge',
];

const REQUIRED_GATES = [
  'requirement_gate',
  'design_gate',
  'diff_scope_gate',
  'sensitive_change_gate',
  'test_integrity_gate',
  'compile_gate',
  'test_gate',
  'acceptance_gate',
  'knowledge_gate',
];

const REQUIRED_ARTIFACTS = [
  'project_profile',
  'context_pack',
  'requirement_draft',
  'design_doc',
  'diff',
  'surefire_report',
  'completion_report',
  'knowledge_candidate',
];

interface TestResult {
  success: boolean;
  workflowRunId: string | null;
  duration: number;
  timestamp: string;
  agentBackend: string;
  assertions: {
    passed: string[];
    failed: string[];
  };
  summary: {
    stages: number;
    gates: number;
    artifacts: number;
    commands: number;
    builds: number;
    tests: number;
    approvals: number;
  };
}

function fail(msg: string): never {
  console.error(`[e2e-comprehensive] ❌ FAIL: ${msg}`);
  process.exit(1);
}

function log(s: string): void {
  console.log(`[e2e-comprehensive] ${s}`);
}

function parseAgentBackend(value: string): 'claude_code' | 'codex' {
  if (value === 'claude_code' || value === 'codex') return value;
  fail(`AINP_E2E_AGENT_BACKEND must be claude_code or codex (got: ${value})`);
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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

/**
 * Preflight: verify API reachable + Agent Backend CLI available
 */
async function preflight(): Promise<void> {
  log('🔍 Running preflight checks...');

  // 1. API health check (5 retries * 500ms = 2.5s max)
  log(`checking API at ${API_BASE}/health`);
  let apiOk = false;
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) {
        log('✅ API reachable');
        apiOk = true;
        break;
      }
    } catch (err) {
      if (i === 4) {
        fail(`API not reachable at ${API_BASE}. Is the server running? (bun run dev:api)`);
      }
      await sleep(500);
    }
  }
  if (!apiOk) fail('API health check failed');

  // 2. Agent Backend CLI check
  log(`checking ${AGENT_BACKEND} CLI`);
  const cliCmd = AGENT_BACKEND === 'claude_code' ? 'claude' : 'codex';
  try {
    const cliCheck = spawn(cliCmd, ['--version'], { stdio: 'ignore' });
    const cliOk = await new Promise<boolean>((res) => {
      cliCheck.on('close', (code) => res(code === 0));
    });
    if (!cliOk) {
      fail(`${cliCmd} CLI not working. Install or set AINP_${AGENT_BACKEND.toUpperCase()}_BIN`);
    }
    log(`✅ ${cliCmd} CLI available`);
  } catch (err) {
    fail(`${cliCmd} CLI not found on PATH: ${(err as Error).message}`);
  }

  // 3. Test project check
  log('checking test project');
  if (!existsSync(SAMPLE_PATH)) {
    fail(`sample missing: ${SAMPLE_PATH}`);
  }
  if (!existsSync(`${SAMPLE_PATH}/.git`)) {
    fail(`sample is not a git repo. Run: cd ${SAMPLE_PATH} && git init && git add . && git commit -m initial`);
  }
  log(`✅ test project ready: ${SAMPLE_PATH}`);
}

async function ensureProject(): Promise<void> {
  // idempotent: API returns existing project if name already taken
  const project = await fetchJson<{ id: string; agentBackend: 'claude_code' | 'codex' | null }>(`/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'java-sample', localPath: SAMPLE_PATH, agentBackend: AGENT_BACKEND }),
  });
  if (project.agentBackend !== AGENT_BACKEND) {
    await fetchJson(`/projects/${project.id}/agent-backend`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentBackend: AGENT_BACKEND }),
    });
  }
  log(`✅ project registered: ${project.id} (backend=${AGENT_BACKEND})`);
}

async function verifySseEndpoint(workflowRunId: string): Promise<void> {
  try {
    const r = await fetch(`${API_BASE}/workflow-runs/${workflowRunId}/agent-stream`, {
      signal: AbortSignal.timeout(2000),
    });
    if (r.ok && r.headers.get('content-type')?.includes('text/event-stream')) {
      log('✅ SSE endpoint available');
    } else {
      log(`⚠️  SSE endpoint returned ${r.status} (non-blocking)`);
    }
    r.body?.cancel();
  } catch (err) {
    log(`⚠️  SSE endpoint check failed: ${(err as Error).message} (non-blocking)`);
  }
}

async function approveIfNeeded(workflowRunId: string, approved = new Set<string>()): Promise<void> {
  const detail = await fetchJson<{
    run: { status: string; currentStage: string; id: string };
  }>(`/workflow-runs/${workflowRunId}`);
  if (detail.run.status !== 'awaiting_human') return;
  const gateId = STAGE_TO_GATE[detail.run.currentStage];
  if (!gateId || approved.has(gateId)) return;
  approved.add(gateId);
  log(`🔓 auto-approving ${gateId} (stage=${detail.run.currentStage})`);
  await fetchJson('/approvals', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowRunId,
      gateId,
      approved: true,
      actor: 'e2e-comprehensive',
      comment: 'auto-approved by e2e-comprehensive',
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

async function runAssertions(workflowRunId: string): Promise<{ passed: string[]; failed: string[] }> {
  const passed: string[] = [];
  const failed: string[] = [];

  const detail = await fetchJson<{
    run: { status: string; currentStage: string };
    steps: Array<{ stage: string; status: string }>;
    commands: Array<{ command: string; status: string; exitCode: number | null }>;
    gates: Array<{ gateId: string; status: string }>;
    artifacts: Array<{ kind: string; uri: string }>;
    builds: Array<{ id: string; status: string }>;
    tests: Array<{ framework: string; total: number; failed: number; errors: number }>;
    approvals: Array<{ gateId: string; decision: string }>;
    agentTasks: Array<{ id: string; kind: string; backend: string }>;
    agentResults: Array<{ id: string; taskId: string; status: string }>;
  }>(`/workflow-runs/${workflowRunId}`);

  log(`\n📊 Workflow Summary:`);
  log(`   status: ${detail.run.status}, stage: ${detail.run.currentStage}`);
  log(`   steps: ${detail.steps.length}, gates: ${detail.gates.length}, artifacts: ${detail.artifacts.length}`);
  log(`   commands: ${detail.commands.length}, builds: ${detail.builds.length}, tests: ${detail.tests.length}`);
  log(`   approvals: ${detail.approvals.length}, agentTasks: ${detail.agentTasks.length}`);

  // 1. Workflow final status
  if (detail.run.status === 'passed') {
    passed.push('workflow status=passed');
  } else {
    failed.push(`workflow status=${detail.run.status} (expected: passed)`);
  }

  // 2. Required stages present
  const stagesSeen = new Set(detail.steps.map((s) => s.stage));
  for (const stage of REQUIRED_STAGES) {
    if (stagesSeen.has(stage)) {
      passed.push(`stage present: ${stage}`);
    } else {
      failed.push(`missing stage: ${stage}`);
    }
  }

  // 3. All gates recorded
  const gateById = new Map(detail.gates.map((g) => [g.gateId, g.status]));
  for (const gateId of REQUIRED_GATES) {
    if (gateById.has(gateId)) {
      const status = gateById.get(gateId)!;
      if (status === 'pass') {
        passed.push(`gate ${gateId}: pass`);
      } else {
        failed.push(`gate ${gateId}: ${status} (expected: pass)`);
      }
    } else {
      failed.push(`gate ${gateId}: missing`);
    }
  }

  // 4. Compile command
  const compileCmd = detail.commands.find((c) => c.command.includes('-DskipTests compile'));
  if (compileCmd && compileCmd.exitCode === 0) {
    passed.push('compile command: exitCode=0');
  } else {
    failed.push(`compile command: ${compileCmd ? `exitCode=${compileCmd.exitCode}` : 'not found'}`);
  }

  // 5. Test command
  const testCmd = detail.commands.find((c) => c.command.includes('mvn') && c.command.includes(' test'));
  if (testCmd && testCmd.exitCode === 0) {
    passed.push('test command: exitCode=0');
  } else {
    failed.push(`test command: ${testCmd ? `exitCode=${testCmd.exitCode}` : 'not found'}`);
  }

  // 6. Agent tasks/results
  if (detail.agentTasks.length >= 5) {
    passed.push(`agent tasks: ${detail.agentTasks.length} (≥5)`);
  } else {
    failed.push(`agent tasks: ${detail.agentTasks.length} (expected ≥5)`);
  }

  if (detail.agentResults.length === detail.agentTasks.length) {
    passed.push(`agent results: ${detail.agentResults.length} (matches tasks)`);
  } else {
    failed.push(`agent results: ${detail.agentResults.length} (tasks: ${detail.agentTasks.length})`);
  }

  const nonSuccessResults = detail.agentResults.filter((r) => r.status !== 'success');
  if (nonSuccessResults.length === 0) {
    passed.push('agent results: all success');
  } else {
    failed.push(`agent results: ${nonSuccessResults.length} non-success`);
  }

  // 7. Required artifacts
  const artifactKinds = new Set(detail.artifacts.map((a) => a.kind));
  for (const kind of REQUIRED_ARTIFACTS) {
    if (artifactKinds.has(kind)) {
      passed.push(`artifact present: ${kind}`);
    } else {
      failed.push(`artifact missing: ${kind}`);
    }
  }

  // 8. BuildRun / TestRun
  if (detail.builds.length > 0) {
    passed.push(`builds: ${detail.builds.length}`);
  } else {
    failed.push('builds: none (expected ≥1)');
  }

  if (detail.tests.length > 0) {
    const tr = detail.tests[0]!;
    if (tr.failed === 0 && tr.errors === 0) {
      passed.push(`tests: ${tr.total} total, 0 failed`);
    } else {
      failed.push(`tests: ${tr.failed} failed, ${tr.errors} errors`);
    }
  } else {
    failed.push('tests: none (expected ≥1)');
  }

  // 9. Approvals
  const approvalGates = new Set(detail.approvals.map((a) => a.gateId));
  for (const gateId of ['requirement_gate', 'design_gate', 'acceptance_gate', 'knowledge_gate']) {
    if (approvalGates.has(gateId)) {
      passed.push(`approval recorded: ${gateId}`);
    } else {
      failed.push(`approval missing: ${gateId}`);
    }
  }

  return { passed, failed };
}

async function main(): Promise<void> {
  const startTime = Date.now();
  const result: TestResult = {
    success: false,
    workflowRunId: null,
    duration: 0,
    timestamp: new Date().toISOString(),
    agentBackend: AGENT_BACKEND,
    assertions: { passed: [], failed: [] },
    summary: { stages: 0, gates: 0, artifacts: 0, commands: 0, builds: 0, tests: 0, approvals: 0 },
  };

  try {
    log('🚀 Starting comprehensive E2E test');
    log(`   API: ${API_BASE}`);
    log(`   Agent Backend: ${AGENT_BACKEND}`);
    log(`   Sample: ${SAMPLE_PATH}\n`);

    await preflight();
    await ensureProject();

    const title = `${TITLE} — e2e-comprehensive ${new Date().toISOString()}`;
    log(`\n🏃 Spawning orchestrator: ${title}`);
    const runner = spawnRunner([
      'orchestrate',
      '--project', 'java-sample',
      '--title', title,
      '--flow-id', 'feature.standard',
    ]);

    // Poll loop: discover workflowRunId, approve gates, wait for completion
    const approved = new Set<string>();
    let workflowRunId: string | null = null;
    const pollUntilDone = async (): Promise<void> => {
      while (true) {
        if (!workflowRunId) {
          workflowRunId = await findLatestRun(title);
          if (workflowRunId) {
            log(`📋 workflow run: ${workflowRunId}`);
            // SSE endpoint check (non-blocking)
            await verifySseEndpoint(workflowRunId);
          }
        }
        if (workflowRunId) {
          await approveIfNeeded(workflowRunId, approved);
        }
        // Exit when runner finishes
        const finished = await Promise.race([
          runner.done.then((r) => r),
          new Promise<{ code: number } | null>((res) => setTimeout(() => res(null), 300)),
        ]);
        if (finished) return;
      }
    };

    await pollUntilDone();
    const runnerResult = await runner.done;
    log(`\n✅ orchestrator exited with code ${runnerResult.code}`);

    if (!workflowRunId) {
      workflowRunId = await findLatestRun(title);
    }
    if (!workflowRunId) fail('could not locate workflow run after orchestration');

    result.workflowRunId = workflowRunId;

    // Run assertions
    log('\n🔍 Running assertions...');
    const assertions = await runAssertions(workflowRunId);
    result.assertions = assertions;

    // Print results
    log('\n📊 Assertion Results:');
    log(`   ✅ Passed: ${assertions.passed.length}`);
    log(`   ❌ Failed: ${assertions.failed.length}`);

    if (assertions.failed.length > 0) {
      log('\n❌ Failed assertions:');
      assertions.failed.forEach((msg) => log(`   - ${msg}`));
      result.success = false;
    } else {
      log('\n✅ All assertions passed!');
      result.success = true;
    }

    result.duration = Date.now() - startTime;
    log(`\n⏱️  Total duration: ${(result.duration / 1000).toFixed(1)}s`);

    // Output structured result for CI
    const resultJson = JSON.stringify(result, null, 2);
    log('\n📄 Structured test result:');
    console.log(resultJson);

    if (!result.success) {
      process.exit(1);
    }
  } catch (err) {
    log(`\n❌ Test failed with exception: ${(err as Error).message}`);
    result.success = false;
    result.duration = Date.now() - startTime;
    console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }
}

await main();
