import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, expect, test } from 'vitest';

process.env.AINP_DB_PATH = join(mkdtempSync(join(tmpdir(), 'ainp-command-log-route-test-')), 'ainp.sqlite');

let app: Awaited<typeof import('../src/app')>['app'];
let storeMod: typeof import('../src/store/store');

beforeAll(async () => {
  ({ app } = await import('../src/app'));
  storeMod = await import('../src/store/store');
});

test('command run logs endpoint returns stdout and stderr text for UI drill-down', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ainp-command-logs-'));
  const stdout = join(dir, 'stdout.log');
  const stderr = join(dir, 'stderr.log');
  writeFileSync(stdout, 'BUILD SUCCESS\n', 'utf8');
  writeFileSync(stderr, 'warning: demo\n', 'utf8');

  storeMod.store.commandRuns.set('cmd_logs', {
    id: 'cmd_logs',
    workflowRunId: 'run_logs',
    stepRunId: null,
    cwd: dir,
    command: 'mvn -B test',
    stage: 'test',
    status: 'passed',
    exitCode: 0,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 12,
    stdoutRef: `file://${stdout}`,
    stderrRef: `file://${stderr}`,
    stdoutBytes: 14,
    stderrBytes: 14,
    stdoutSha256: sha256('BUILD SUCCESS\n'),
    stderrSha256: sha256('warning: demo\n'),
    combinedSha256: 'combined-fixture',
    timedOut: false,
    truncated: false,
  });

  const res = await app.request('/command-runs/cmd_logs/logs');
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    commandRun: { id: 'cmd_logs', command: 'mvn -B test' },
    stdout: { text: 'BUILD SUCCESS\n', digest: { verified: true } },
    stderr: { text: 'warning: demo\n', digest: { verified: true } },
  });
});

test('command run logs endpoint detects digest mismatch', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ainp-command-log-digest-'));
  const stdout = join(dir, 'stdout.log');
  const stderr = join(dir, 'stderr.log');
  writeFileSync(stdout, 'original\n', 'utf8');
  writeFileSync(stderr, '', 'utf8');

  storeMod.store.commandRuns.set('cmd_digest_mismatch', {
    id: 'cmd_digest_mismatch',
    workflowRunId: 'run_logs_digest',
    stepRunId: null,
    cwd: dir,
    command: 'mvn -B test',
    stage: 'test',
    status: 'passed',
    exitCode: 0,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 12,
    stdoutRef: `file://${stdout}`,
    stderrRef: `file://${stderr}`,
    stdoutBytes: 9,
    stderrBytes: 0,
    stdoutSha256: sha256('original\n'),
    stderrSha256: sha256(''),
    combinedSha256: 'combined-fixture',
    timedOut: false,
    truncated: false,
  });

  writeFileSync(stdout, 'tampered\n', 'utf8');

  const res = await app.request('/command-runs/cmd_digest_mismatch/logs');
  expect(res.status).toBe(200);
  const body = await res.json() as {
    stdout: { digest: { expected: string; actual: string; verified: boolean } };
    stderr: { digest: { verified: boolean } };
  };
  expect(body.stdout.digest.expected).toBe(sha256('original\n'));
  expect(body.stdout.digest.actual).toBe(sha256('tampered\n'));
  expect(body.stdout.digest.verified).toBe(false);
  expect(body.stderr.digest.verified).toBe(true);
});

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
