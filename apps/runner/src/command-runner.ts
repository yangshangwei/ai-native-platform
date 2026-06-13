import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  isWhitelisted,
  newId,
  nowIso,
  type CommandRun,
  type CommandSpec,
  type CommandStatus,
} from '@ainp/shared';
import { sha256Buffer, sha256CombinedStreams } from '@ainp/shared/node';

export interface RunCommandInput extends CommandSpec {
  workflowRunId: string;
  stepRunId: string | null;
  /** Directory to dump per-stream logs into. */
  logDir: string;
  /**
   * Project-level exact-match whitelist additions (T3.2): the registered
   * project's custom build/test commands. The whitelist check here remains
   * the hard gate — API-side validation is only registration hygiene.
   */
  extraAllow?: readonly string[];
}

/**
 * Spawn a whitelisted command, enforce timeout + log caps, and produce a
 * CommandRun. The CommandRun is returned but NOT posted — the caller is
 * responsible for emitting the runner event so the Workflow Engine can record
 * it (single-state-writer rule).
 */
export async function runWhitelistedCommand(input: RunCommandInput): Promise<CommandRun> {
  if (!isWhitelisted(input.command, input.extraAllow)) {
    throw new Error(`command not on whitelist: ${input.command}`);
  }
  await mkdir(input.logDir, { recursive: true });

  const id = newId('cmd');
  const stdoutPath = join(input.logDir, `${id}.stdout.log`);
  const stderrPath = join(input.logDir, `${id}.stderr.log`);

  const startedAt = nowIso();
  const start = Date.now();

  const [program, ...args] = input.command.split(/\s+/);
  if (!program) throw new Error('empty command');

  const child = spawn(program, args, {
    cwd: input.cwd,
    env: input.env ? { ...process.env, ...input.env } : process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    // R1.3: spawn in detached mode so timeout kill can target the process group
    detached: true,
  });

  let stdoutBytes = 0;
  let stderrBytes = 0;
  let truncated = false;
  const stdoutBuf: Buffer[] = [];
  const stderrBuf: Buffer[] = [];

  child.stdout.on('data', (b: Buffer) => {
    if (stdoutBytes >= input.maxLogBytes) {
      truncated = true;
      return;
    }
    const remaining = input.maxLogBytes - stdoutBytes;
    if (b.length > remaining) {
      stdoutBuf.push(b.subarray(0, remaining));
      stdoutBytes += remaining;
      truncated = true;
    } else {
      stdoutBuf.push(b);
      stdoutBytes += b.length;
    }
  });
  child.stderr.on('data', (b: Buffer) => {
    if (stderrBytes >= input.maxLogBytes) {
      truncated = true;
      return;
    }
    const remaining = input.maxLogBytes - stderrBytes;
    if (b.length > remaining) {
      stderrBuf.push(b.subarray(0, remaining));
      stderrBytes += remaining;
      truncated = true;
    } else {
      stderrBuf.push(b);
      stderrBytes += b.length;
    }
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    // R1.3: SIGKILL the process group to terminate child processes spawned by
    // the command (e.g., mvn spawning javac). The negative PID targets the
    // entire process group. Future work: verify pgid stability across platforms.
    try {
      if (child.pid) {
        process.kill(-child.pid, 'SIGKILL');
      }
    } catch {
      // Fallback: kill the leader if pgid kill fails
      child.kill('SIGKILL');
    }
  }, input.timeoutMs);

  let exitInfo: { code: number | null; signal: NodeJS.Signals | null };
  try {
    exitInfo = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code, signal) => resolve({ code, signal }));
      },
    );
  } finally {
    clearTimeout(timer);
  }

  await mkdir(dirname(stdoutPath), { recursive: true });
  const stdoutContent = Buffer.concat(stdoutBuf);
  const stderrContent = Buffer.concat(stderrBuf);
  await Promise.all([
    writeFile(stdoutPath, stdoutContent),
    writeFile(stderrPath, stderrContent),
  ]);

  const finishedAt = nowIso();
  const durationMs = Date.now() - start;
  const status: CommandStatus = timedOut
    ? 'timeout'
    : exitInfo.code === 0
      ? 'passed'
      : 'failed';

  const cr: CommandRun = {
    id,
    workflowRunId: input.workflowRunId,
    stepRunId: input.stepRunId,
    cwd: input.cwd,
    command: input.command,
    stage: input.stage,
    status,
    exitCode: timedOut ? null : exitInfo.code,
    startedAt,
    finishedAt,
    durationMs,
    stdoutRef: `file://${stdoutPath}`,
    stderrRef: `file://${stderrPath}`,
    stdoutBytes,
    stderrBytes,
    stdoutSha256: sha256Buffer(stdoutContent),
    stderrSha256: sha256Buffer(stderrContent),
    combinedSha256: sha256CombinedStreams(stdoutContent, stderrContent),
    timedOut,
    truncated,
  };
  return cr;
}
