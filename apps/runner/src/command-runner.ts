import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  isWhitelisted,
  newId,
  nowIso,
  pathToFileUri,
  type CommandRun,
  type CommandSpec,
  type CommandStatus,
} from '@ainp/shared';
import { sha256CombinedStreams, writeRedactedFile } from '@ainp/shared/node';

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
  // 08-09 P1-3: redact before the bytes land AND before they are hashed.
  // `writeRedactedFile` returns the digest of what it actually wrote, so the
  // two cannot drift — a raw-vs-redacted mismatch would make P1-1's
  // `evidence.artifact_digests_match` flag every credential-bearing command
  // as tampered evidence.
  const stdoutWrite = await writeRedactedFile(stdoutPath, Buffer.concat(stdoutBuf));
  const stderrWrite = await writeRedactedFile(stderrPath, Buffer.concat(stderrBuf));
  const stdoutContent = stdoutWrite.content;
  const stderrContent = stderrWrite.content;

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
    stdoutRef: pathToFileUri(stdoutPath),
    stderrRef: pathToFileUri(stderrPath),
    // Post-redaction lengths and digests: these describe the bytes on disk,
    // which is what a reader re-hashes. `stdoutBytes` above is the streaming
    // accumulator used for `maxLogBytes` truncation, not the written size.
    stdoutBytes: stdoutWrite.bytes,
    stderrBytes: stderrWrite.bytes,
    stdoutSha256: stdoutWrite.sha256,
    stderrSha256: stderrWrite.sha256,
    combinedSha256: sha256CombinedStreams(stdoutContent, stderrContent),
    timedOut,
    truncated,
  };
  return cr;
}
