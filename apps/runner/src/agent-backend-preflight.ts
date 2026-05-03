import { spawn } from 'node:child_process';
import {
  agentBackendAuthCliArgs,
  agentBackendCliArgs,
  buildAgentBackendCliSpawn,
  classifyAgentBackendAuthPreflight,
  firstNonEmptyLine,
  missingCliAgentBackendPreflight,
  resolveAgentBackendCliCandidates,
  type AgentBackendCliResult,
  type AgentBackendPreflight,
  type ProjectAgentBackendKind,
} from '@ainp/shared';

const DEFAULT_PREFLIGHT_TIMEOUT_MS = 12_000;
const CLAUDE_AUTH_STATUS_TIMEOUT_MS = 4_000;
const VERSION_TIMEOUT_MS = 4_000;

export async function preflightAgentBackend(backend: ProjectAgentBackendKind): Promise<AgentBackendPreflight> {
  const version = await runFirstSuccessfulCli(backend, agentBackendCliArgs(backend, 'version'), {
    timeoutMs: VERSION_TIMEOUT_MS,
  });

  if (!version.ok) {
    return missingCliAgentBackendPreflight(backend, version.bin, version.result);
  }

  const auth = await runCli(version.bin, agentBackendAuthCliArgs(backend), {
    timeoutMs: backend === 'claude_code' ? CLAUDE_AUTH_STATUS_TIMEOUT_MS : preflightTimeoutMs(),
  });

  return classifyAgentBackendAuthPreflight(
    backend,
    version.bin,
    firstNonEmptyLine(`${version.result.stdout}\n${version.result.stderr}`),
    auth,
  );
}

interface SuccessfulCliRun {
  ok: true;
  bin: string;
  result: AgentBackendCliResult;
}

interface FailedCliRun {
  ok: false;
  bin: string;
  result: AgentBackendCliResult;
}

async function runFirstSuccessfulCli(
  backend: ProjectAgentBackendKind,
  args: string[],
  opts: { timeoutMs: number },
): Promise<SuccessfulCliRun | FailedCliRun> {
  const candidates = resolveAgentBackendCliCandidates(backend, {
    env: process.env,
    platform: process.platform,
  });
  let firstFailure: FailedCliRun | null = null;

  for (const bin of candidates) {
    const result = await runCli(bin, args, opts);
    if (result.exitCode === 0) return { ok: true, bin, result };
    firstFailure ??= { ok: false, bin, result };
  }

  return firstFailure ?? {
    ok: false,
    bin: candidates[0] ?? backend,
    result: { exitCode: null, stdout: '', stderr: '', timedOut: false, error: 'No CLI candidates resolved.' },
  };
}

function runCli(
  bin: string,
  args: string[],
  opts: { cwd?: string; stdin?: string; timeoutMs?: number } = {},
): Promise<AgentBackendCliResult> {
  return new Promise((resolve) => {
    const invocation = buildAgentBackendCliSpawn(bin, args, {
      env: process.env,
      platform: process.platform,
    });
    const child = spawn(invocation.command, invocation.args, {
      cwd: opts.cwd,
      stdio: [opts.stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      env: { ...process.env },
      shell: invocation.shell,
      windowsHide: invocation.windowsHide,
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;
    let timedOut = false;
    const finish = (result: AgentBackendCliResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, opts.timeoutMs ?? DEFAULT_PREFLIGHT_TIMEOUT_MS);

    child.stdout?.on('data', (b: Buffer) => stdoutChunks.push(b));
    child.stderr?.on('data', (b: Buffer) => stderrChunks.push(b));
    child.once('error', (err) => {
      finish({ exitCode: null, stdout: '', stderr: '', timedOut, error: err.message });
    });
    child.once('close', (code) => {
      finish({
        exitCode: code,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        timedOut,
        error: null,
      });
    });
    if (opts.stdin && child.stdin) child.stdin.end(opts.stdin);
  });
}

function preflightTimeoutMs(): number {
  const value = Number(process.env.AINP_AGENT_PREFLIGHT_TIMEOUT_MS ?? DEFAULT_PREFLIGHT_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_PREFLIGHT_TIMEOUT_MS;
}
