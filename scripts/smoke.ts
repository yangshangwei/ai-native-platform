#!/usr/bin/env bun
/**
 * End-to-end smoke for the Phase 1 MVP loop:
 *   register project → create workflow run → prepare worktree → mvn -B test
 *   → CommandRun emitted → API stores it → query confirms status=passed.
 *
 * Assumes the API is already running on AINP_API_BASE (default 127.0.0.1:8787).
 * The smoke does NOT start the API — that's the user's responsibility, so the
 * test fails loudly if the contract is broken.
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

const API_BASE = process.env.AINP_API_BASE ?? 'http://127.0.0.1:8787';
const SAMPLE_PATH = resolve(import.meta.dir, '..', 'examples', 'java-maven-sample');
const RUNNER = resolve(import.meta.dir, '..', 'apps', 'runner', 'src', 'index.ts');

function fail(msg: string): never {
  console.error(`[smoke] FAIL: ${msg}`);
  process.exit(1);
}

function header(s: string): void {
  console.log(`\n=== ${s} ===`);
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, init);
  if (!r.ok) fail(`${path} -> ${r.status}: ${await r.text()}`);
  return (await r.json()) as T;
}

function runner(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((res) => {
    const child = spawn('bun', ['run', RUNNER, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (b: Buffer) => {
      out.push(b);
      process.stdout.write(b);
    });
    child.stderr.on('data', (b: Buffer) => {
      err.push(b);
      process.stderr.write(b);
    });
    child.on('close', (code) =>
      res({
        code: code ?? -1,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
      }),
    );
  });
}

async function main(): Promise<void> {
  if (!existsSync(SAMPLE_PATH)) fail(`sample missing: ${SAMPLE_PATH}`);
  if (!existsSync(`${SAMPLE_PATH}/.git`)) {
    fail(
      `sample is not a git repo. Run:\n  (cd ${SAMPLE_PATH} && git init && git add . && git -c user.email=ai@ainp -c user.name=ainp commit -q -m initial)`,
    );
  }

  header('1. health');
  const h = await fetchJson<{ ok: boolean }>('/health');
  console.log('  ', h);

  header('2. register project');
  const reg = await runner(['register', '--path', SAMPLE_PATH, '--name', 'java-sample']);
  if (reg.code !== 0) fail('register failed');

  header('3. run mvn -B test in a fresh worktree');
  const run = await runner([
    'run',
    '--project',
    'java-sample',
    '--command',
    'mvn -B test',
    '--title',
    'smoke mvn test',
  ]);
  if (run.code !== 0) fail(`runner exited with code ${run.code}`);

  header('4. inspect workflow runs');
  const list = await fetchJson<{ items: Array<{ id: string; status: string; title: string }> }>(
    '/workflow-runs',
  );
  if (list.items.length === 0) fail('no workflow runs in store');
  const last = list.items[list.items.length - 1]!;
  console.log('  last run:', last);
  if (last.status !== 'passed') fail(`expected status=passed, got ${last.status}`);

  const detail = await fetchJson<{
    run: { status: string; currentStage: string; workspacePath: string | null };
    commands: Array<{ status: string; exitCode: number | null; command: string }>;
  }>(`/workflow-runs/${last.id}`);
  console.log('  detail.run:', detail.run);
  console.log('  commands:', detail.commands.map((c) => `${c.command} -> ${c.status}/exit=${c.exitCode}`));

  if (detail.commands.length === 0) fail('no command runs recorded');
  const cr = detail.commands[0]!;
  if (cr.status !== 'passed') fail(`command status=${cr.status}`);
  if (cr.exitCode !== 0) fail(`command exitCode=${cr.exitCode}`);
  if (detail.run.currentStage !== 'completion') fail(`stage=${detail.run.currentStage}`);

  console.log('\n[smoke] PASS — full Phase 1 loop verified.');
}

await main();
