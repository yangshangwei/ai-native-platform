import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * config_audit jsonl mirror tests (PR4 §D-PR4.1).
 *
 * SQLite remains the source of truth; the jsonl file under `.omc/audit/` is a
 * fail-open append-only mirror for grep-friendly post-hoc forensics.
 */

const dbDir = mkdtempSync(join(tmpdir(), 'ainp-audit-mirror-db-'));
const homeDir = mkdtempSync(join(tmpdir(), 'ainp-audit-mirror-home-'));
const cwdDir = mkdtempSync(join(tmpdir(), 'ainp-audit-mirror-cwd-'));

process.env.AINP_DB_PATH = join(dbDir, 'ainp.sqlite');
process.env.AINP_HOME = join(homeDir, '.ai-native');

let store: typeof import('../src/store/store')['store'];
let originalCwd: string;

beforeAll(async () => {
  ({ store } = await import('../src/store/store'));
  originalCwd = process.cwd();
  process.chdir(cwdDir);
});

afterAll(() => {
  process.chdir(originalCwd);
  for (const d of [dbDir, homeDir, cwdDir]) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe('configAudit.insert mirror', () => {
  it('appends a JSON line to .omc/audit/config-YYYY-MM-DD.jsonl matching the inserted entry', () => {
    const entry = {
      id: 'cfgaud_mirror_happy',
      key: 'coordinator.confidence_threshold',
      oldValueJson: null,
      newValueJson: JSON.stringify(0.42),
      changedAt: '2026-05-04T10:11:12.345Z',
      changedBy: 'mirror-test',
    };
    store.configAudit.insert(entry);

    const file = join(cwdDir, '.omc', 'audit', 'config-2026-05-04.jsonl');
    expect(existsSync(file)).toBe(true);
    const lines = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
    const last = JSON.parse(lines[lines.length - 1]!);
    expect(last).toEqual(entry);

    // SQLite remains the truth
    const fromDb = store.configAudit.listByKey(entry.key, 50)
      .find((row) => row.id === entry.id);
    expect(fromDb).toEqual(entry);
  });

  it('partitions different days into different files and appends multiple entries to the same day', () => {
    const day1a = {
      id: 'cfgaud_day1a',
      key: 'runner.watch.poll_ms',
      oldValueJson: null,
      newValueJson: JSON.stringify(2000),
      changedAt: '2026-06-01T01:00:00.000Z',
      changedBy: 'mirror-test',
    };
    const day1b = { ...day1a, id: 'cfgaud_day1b', changedAt: '2026-06-01T23:59:59.000Z', newValueJson: JSON.stringify(2500) };
    const day2 = { ...day1a, id: 'cfgaud_day2', changedAt: '2026-06-02T00:00:01.000Z', newValueJson: JSON.stringify(3000) };

    store.configAudit.insert(day1a);
    store.configAudit.insert(day1b);
    store.configAudit.insert(day2);

    const f1 = join(cwdDir, '.omc', 'audit', 'config-2026-06-01.jsonl');
    const f2 = join(cwdDir, '.omc', 'audit', 'config-2026-06-02.jsonl');
    expect(existsSync(f1)).toBe(true);
    expect(existsSync(f2)).toBe(true);

    const f1Lines = readFileSync(f1, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const f2Lines = readFileSync(f2, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    expect(f1Lines.map((e) => e.id)).toEqual(expect.arrayContaining([day1a.id, day1b.id]));
    expect(f2Lines.map((e) => e.id)).toEqual([day2.id]);
  });

  it('does not throw when the mirror write fails — SQLite row is still committed (fail-open)', () => {
    // Pre-create `.omc/audit` as a FILE so mkdirSync(recursive: true) throws
    // ENOTDIR / EEXIST. We use a sub-cwd to keep this test isolated from
    // earlier tests that already created the dir successfully.
    const failCwd = mkdtempSync(join(tmpdir(), 'ainp-audit-mirror-fail-'));
    process.chdir(failCwd);
    const omcDir = join(failCwd, '.omc');
    // Block .omc/audit by making .omc a regular file at the level above.
    writeFileSync(omcDir, 'sentinel');

    const entry = {
      id: 'cfgaud_failopen',
      key: 'coordinator.system_prompt',
      oldValueJson: null,
      newValueJson: '"prompt-text"',
      changedAt: '2026-07-15T08:00:00.000Z',
      changedBy: 'fail-test',
    };

    expect(() => store.configAudit.insert(entry)).not.toThrow();

    // SQLite write must still have happened.
    const fromDb = store.configAudit.listByKey(entry.key, 50)
      .find((row) => row.id === entry.id);
    expect(fromDb).toEqual(entry);

    // No mirror file should have been created under failCwd.
    expect(existsSync(join(failCwd, '.omc', 'audit'))).toBe(false);

    // Restore for any subsequent tests.
    process.chdir(cwdDir);
    try { rmSync(failCwd, { recursive: true, force: true }); } catch { /* ignore */ }
  });
});
