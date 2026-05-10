import { Hono } from 'hono';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { store } from '../store/store';

export const runnerControl = new Hono();

interface RunnerControlStatus {
  mode: 'api-managed-local-runner';
  running: boolean;
  pid: number | null;
  startedAt: string | null;
  stoppedAt: string | null;
  command: string[];
  lastExit: { code: number | null; signal: NodeJS.Signals | null; at: string } | null;
  recentLogs: string[];
  latestHeartbeat: ReturnType<typeof store.runners.list>[number] | null;
}

let child: ChildProcess | null = null;
let startedAt: string | null = null;
let stoppedAt: string | null = null;
let lastExit: RunnerControlStatus['lastExit'] = null;
const recentLogs: string[] = [];

function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
}

function runnerEntrypoint(): string {
  return resolve(repoRoot(), 'apps/runner/src/index.ts');
}

function runnerCommand(): string[] {
  return [process.execPath, runnerEntrypoint(), 'watch', '--poll-ms', '1000'];
}

function appendLog(prefix: string, chunk: Buffer): void {
  for (const line of chunk.toString('utf8').split('\n')) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;
    recentLogs.push(`${prefix} ${trimmed}`);
  }
  while (recentLogs.length > 80) recentLogs.shift();
}

function isRunning(): boolean {
  return Boolean(child && child.exitCode === null && child.signalCode === null);
}

function latestHeartbeat(): RunnerControlStatus['latestHeartbeat'] {
  return store.runners.list()[0] ?? null;
}

function status(): RunnerControlStatus {
  return {
    mode: 'api-managed-local-runner',
    running: isRunning(),
    pid: isRunning() ? (child?.pid ?? null) : null,
    startedAt,
    stoppedAt,
    command: runnerCommand(),
    lastExit,
    recentLogs: [...recentLogs],
    latestHeartbeat: latestHeartbeat(),
  };
}

function start(): RunnerControlStatus {
  if (isRunning()) return status();

  const command = runnerCommand();
  const [bin, ...args] = command;
  if (!bin) throw new Error('runner command is empty');

  stoppedAt = null;
  lastExit = null;
  startedAt = new Date().toISOString();
  recentLogs.push(`[control] starting ${command.join(' ')}`);
  const next = spawn(bin, args, {
    cwd: repoRoot(),
    env: {
      ...process.env,
      AINP_API_BASE:
        process.env.AINP_API_BASE ??
        `http://${process.env.AINP_API_HOST ?? '127.0.0.1'}:${process.env.AINP_API_PORT ?? '8787'}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child = next;
  next.stdout?.on('data', (chunk: Buffer) => appendLog('[runner]', chunk));
  next.stderr?.on('data', (chunk: Buffer) => appendLog('[runner:err]', chunk));
  next.on('error', (err) => {
    recentLogs.push(`[control:error] ${err.message}`);
  });
  next.on('exit', (code, signal) => {
    stoppedAt = new Date().toISOString();
    lastExit = { code, signal, at: stoppedAt };
    recentLogs.push(`[control] runner exited code=${code ?? 'null'} signal=${signal ?? 'null'}`);
    child = null;
  });
  return status();
}

function stop(): RunnerControlStatus {
  if (isRunning()) {
    child?.kill('SIGTERM');
    recentLogs.push('[control] sent SIGTERM to runner');
  }
  return status();
}

process.on('exit', () => {
  if (isRunning()) child?.kill('SIGTERM');
});

runnerControl.get('/status', (c) => c.json(status()));

runnerControl.post('/start', (c) => {
  try {
    return c.json(start());
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err), status: status() }, 500);
  }
});

runnerControl.post('/stop', (c) => c.json(stop()));

runnerControl.post('/retry-run', async (c) => {
  const body = (await c.req.json()) as { workflowRunId?: string; stage?: string };
  if (!body.workflowRunId || !body.stage) {
    return c.json({ error: 'workflowRunId and stage required' }, 400);
  }
  const run = store.workflowRuns.get(body.workflowRunId);
  if (!run) return c.json({ error: 'run not found' }, 404);
  const project = store.projects.get(run.projectId);
  if (!project) return c.json({ error: 'project not found' }, 404);

  // Spawn a one-shot orchestrate for the retry. The runner will pick up
  // the pending step and re-execute from that stage.
  const cmd = [
    process.execPath,
    runnerEntrypoint(),
    'orchestrate',
    '--project', project.name,
    '--title', run.title,
    '--workflow-run-id', run.id,
    '--start-stage', body.stage,
  ];
  recentLogs.push(`[control:retry] ${cmd.join(' ')}`);
  const retryChild = spawn(cmd[0]!, cmd.slice(1), {
    cwd: repoRoot(),
    env: {
      ...process.env,
      AINP_API_BASE:
        process.env.AINP_API_BASE ??
        `http://${process.env.AINP_API_HOST ?? '127.0.0.1'}:${process.env.AINP_API_PORT ?? '8787'}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  retryChild.stdout?.on('data', (chunk: Buffer) => appendLog('[retry]', chunk));
  retryChild.stderr?.on('data', (chunk: Buffer) => appendLog('[retry:err]', chunk));
  retryChild.unref();
  return c.json({ ok: true, pid: retryChild.pid ?? null });
});
