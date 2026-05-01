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

export interface RunCommandInput extends CommandSpec {
  workflowRunId: string;
  stepRunId: string | null;
  /** Directory to dump per-stream logs into. */
  logDir: string;
}

/**
 * Spawn a whitelisted command, enforce timeout + log caps, and produce a
 * CommandRun. The CommandRun is returned but NOT posted — the caller is
 * responsible for emitting the runner event so the Workflow Engine can record
 * it (single-state-writer rule).
 */
export async function runWhitelistedCommand(input: RunCommandInput): Promise<CommandRun> {
  if (!isWhitelisted(input.command)) {
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
    // SIGKILL the leader; future work: kill the whole pgid.
    child.kill('SIGKILL');
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
  await Promise.all([
    writeFile(stdoutPath, Buffer.concat(stdoutBuf)),
    writeFile(stderrPath, Buffer.concat(stderrBuf)),
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
    timedOut,
    truncated,
  };
  return cr;
}
