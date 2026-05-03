import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// Isolate this test's SQLite + runner home from other tests' state.
process.env.AINP_DB_PATH = join(
  mkdtempSync(join(tmpdir(), 'ainp-config-route-test-')),
  'ainp.sqlite',
);
process.env.AINP_HOME = join(
  mkdtempSync(join(tmpdir(), 'ainp-config-route-home-')),
  '.ai-native',
);

let app: Awaited<typeof import('../src/app')>['app'];

beforeAll(async () => {
  ({ app } = await import('../src/app'));
});

describe('GET /config/registry', () => {
  it('returns all 24 keys with type / default / category metadata', async () => {
    const res = await app.request('/config/registry');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      keys: string[];
      entries: Record<string, { type: string; category: string; default: unknown; min?: number; max?: number }>;
    };
    expect(body.keys).toHaveLength(24);
    expect(new Set(body.keys).size).toBe(24);
    expect(body.entries['coordinator.confidence_threshold']).toMatchObject({
      type: 'number',
      category: 'coordinator',
      default: 0.65,
      min: 0,
      max: 1,
    });
    expect(body.entries['skill.requirement_draft.instructions']).toMatchObject({
      type: 'string',
      category: 'skill_prompts',
    });
    expect(body.entries['runner.watch.poll_ms']).toMatchObject({
      type: 'number',
      category: 'runtime',
      default: 2000,
    });
  });
});

describe('PUT /config/overrides/:key', () => {
  it('upserts a valid number override and writes an audit row', async () => {
    const put = await app.request('/config/overrides/coordinator.confidence_threshold', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 0.5, updatedBy: 'route-test' }),
    });
    expect(put.status).toBe(200);
    const j = (await put.json()) as {
      ok: boolean;
      key: string;
      override: { valueJson: string; updatedBy: string; scope: string };
    };
    expect(j.ok).toBe(true);
    expect(j.key).toBe('coordinator.confidence_threshold');
    expect(JSON.parse(j.override.valueJson)).toBe(0.5);
    expect(j.override.updatedBy).toBe('route-test');
    expect(j.override.scope).toBe('global');

    const audit = await app.request('/config/audit?key=coordinator.confidence_threshold');
    expect(audit.status).toBe(200);
    const auditBody = (await audit.json()) as {
      items: Array<{ key: string; newValueJson: string | null; oldValueJson: string | null; changedBy: string | null }>;
    };
    expect(auditBody.items.length).toBeGreaterThanOrEqual(1);
    expect(auditBody.items[0]?.key).toBe('coordinator.confidence_threshold');
    expect(JSON.parse(auditBody.items[0]!.newValueJson!)).toBe(0.5);
    expect(auditBody.items[0]?.changedBy).toBe('route-test');
  });

  it('rejects unknown config keys with a 400 error', async () => {
    const res = await app.request('/config/overrides/not.a.real.key', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 1 }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('unknown config key') });
  });

  it('rejects type-mismatched values with 400 (string into number key)', async () => {
    const res = await app.request('/config/overrides/coordinator.confidence_threshold', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'not-a-number' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining('expected number'),
    });
  });

  it('enforces min / max bounds on number keys', async () => {
    const tooHigh = await app.request('/config/overrides/coordinator.confidence_threshold', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 5 }),
    });
    expect(tooHigh.status).toBe(400);
    expect(await tooHigh.json()).toMatchObject({ error: expect.stringContaining('above max') });

    const tooLow = await app.request('/config/overrides/coordinator.confidence_threshold', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: -0.1 }),
    });
    expect(tooLow.status).toBe(400);
    expect(await tooLow.json()).toMatchObject({ error: expect.stringContaining('below min') });
  });

  it('accepts string_array overrides for keyword dictionaries', async () => {
    const put = await app.request('/config/overrides/coordinator.bug_keywords', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: ['panic', 'oops'], updatedBy: 'route-test' }),
    });
    expect(put.status).toBe(200);

    const all = await app.request('/config/overrides');
    expect(all.status).toBe(200);
    const allBody = (await all.json()) as {
      overrides: Record<string, { valueJson: string }>;
    };
    expect(allBody.overrides['coordinator.bug_keywords']).toBeDefined();
    expect(JSON.parse(allBody.overrides['coordinator.bug_keywords']!.valueJson)).toEqual([
      'panic',
      'oops',
    ]);
  });

  it('rejects non-array values for string_array keys', async () => {
    const res = await app.request('/config/overrides/coordinator.bug_keywords', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'just-a-string' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('expected array') });
  });

  it('rejects arrays containing non-strings', async () => {
    const res = await app.request('/config/overrides/coordinator.bug_keywords', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: ['ok', 42] }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('expected string at index 1') });
  });
});

describe('DELETE /config/overrides/:key', () => {
  it('removes an override and writes a tombstone audit row (newValueJson = null)', async () => {
    await app.request('/config/overrides/runner.watch.poll_ms', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 5000 }),
    });

    const del = await app.request('/config/overrides/runner.watch.poll_ms?actor=route-test', {
      method: 'DELETE',
    });
    expect(del.status).toBe(200);
    expect(await del.json()).toMatchObject({ ok: true, deleted: true });

    const all = await app.request('/config/overrides');
    const allBody = (await all.json()) as { overrides: Record<string, unknown> };
    expect(allBody.overrides['runner.watch.poll_ms']).toBeUndefined();

    const audit = await app.request('/config/audit?key=runner.watch.poll_ms');
    const auditBody = (await audit.json()) as {
      items: Array<{ newValueJson: string | null; changedBy: string | null }>;
    };
    expect(auditBody.items[0]?.newValueJson).toBeNull();
    expect(auditBody.items[0]?.changedBy).toBe('route-test');
  });

  it('returns deleted=false (200) when the override does not exist (idempotent)', async () => {
    const del = await app.request('/config/overrides/runner.command.max_log_bytes', {
      method: 'DELETE',
    });
    expect(del.status).toBe(200);
    expect(await del.json()).toMatchObject({ ok: true, deleted: false });
  });
});

describe('GET /config/audit', () => {
  it('rejects unknown key parameter with 400', async () => {
    const res = await app.request('/config/audit?key=not.a.real.key');
    expect(res.status).toBe(400);
  });

  it('clamps over-large limit to a sane upper bound', async () => {
    const res = await app.request('/config/audit?limit=99999');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('lists all audit rows when no key is specified', async () => {
    const res = await app.request('/config/audit');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ key: string }> };
    expect(Array.isArray(body.items)).toBe(true);
    // All previously-modified keys should appear at least once.
    const keys = new Set(body.items.map((i) => i.key));
    expect(keys.has('coordinator.confidence_threshold')).toBe(true);
    expect(keys.has('coordinator.bug_keywords')).toBe(true);
    expect(keys.has('runner.watch.poll_ms')).toBe(true);
  });
});
