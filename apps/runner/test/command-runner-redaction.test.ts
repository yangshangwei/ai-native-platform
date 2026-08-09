import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { runWhitelistedCommand } from '../src/command-runner';
import { fileUriToPath } from '@ainp/shared';

/**
 * 08-09 P1-3. Command stdout/stderr is where credentials most often reach
 * disk — a build invoked with a token, a failure trace carrying a connection
 * string. `maskSecrets` existed but this path never called it.
 *
 * These run the real spawn path rather than unit-testing the helper, because
 * the bug being guarded against is a wiring bug: redacting somewhere other
 * than where the digest is taken.
 */

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Runs `body` as a shell script through the real spawn path.
 *
 * `runWhitelistedCommand` splits `command` on whitespace and spawns without a
 * shell, so an inline `sh -c "…"` would have its quoting torn apart. Writing
 * the script to a file keeps the command a single whitespace-free token, which
 * `extraAllow` can then whitelist by exact match.
 */
async function runScript(body: string) {
  const dir = mkdtempSync(join(tmpdir(), 'ainp-cmdsh-'));
  const command = join(dir, 'emit.sh');
  writeFileSync(command, `#!/bin/sh\n${body}\n`, { mode: 0o755 });

  return runWhitelistedCommand({
    command,
    args: [],
    cwd: dir,
    timeoutMs: 30_000,
    maxLogBytes: 1_000_000,
    stage: 'test',
    workflowRunId: 'run_p13_redaction',
    stepRunId: 'step_p13_redaction',
    logDir: join(dir, 'logs'),
    extraAllow: [command],
  });
}

test('a credential printed by a command does not reach the log file', async () => {
  const cr = await runScript('echo "connecting with api_key=super-secret-value"');
  const onDisk = readFileSync(fileUriToPath(cr.stdoutRef)).toString('utf8');

  expect(onDisk).not.toContain('super-secret-value');
  expect(onDisk).toContain('[redacted]');
});

test('the recorded digest matches the redacted bytes on disk', async () => {
  const cr = await runScript('echo "token=another-secret-value"');
  const stdoutBytes = readFileSync(fileUriToPath(cr.stdoutRef));

  // This is the regression that would break P1-1: if the digest were taken
  // from the raw output while the redacted form was written, every
  // credential-bearing command would read as tampered evidence and
  // `evidence.artifact_digests_match` would fail the gate.
  expect(cr.stdoutSha256).toBe(sha256(stdoutBytes));
  expect(cr.stdoutBytes).toBe(stdoutBytes.byteLength);
});

test('a credential on stderr is redacted too', async () => {
  const cr = await runScript('echo "Bearer eyJhbGciOiJIUzI1NiJ9.leaked" >&2');
  const onDisk = readFileSync(fileUriToPath(cr.stderrRef)).toString('utf8');

  expect(onDisk).not.toContain('eyJhbGciOiJIUzI1NiJ9.leaked');
  expect(cr.stderrSha256).toBe(sha256(readFileSync(fileUriToPath(cr.stderrRef))));
});

test('output with nothing to redact is stored unchanged', async () => {
  const cr = await runScript('echo "BUILD SUCCESS"');
  const onDisk = readFileSync(fileUriToPath(cr.stdoutRef)).toString('utf8');

  expect(onDisk).toBe('BUILD SUCCESS\n');
  expect(cr.stdoutSha256).toBe(sha256(Buffer.from('BUILD SUCCESS\n', 'utf8')));
});
