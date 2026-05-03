import { Hono } from 'hono';
import {
  CONFIG_REGISTRY,
  configKeys,
  newId,
  nowIso,
  validateConfigValue,
  type ConfigKey,
} from '@ainp/shared';
import { store } from '../store/store';

/**
 * PR1 — runtime config layer:
 *   GET    /config/registry          → static schema (keys + types + defaults)
 *   GET    /config/overrides         → all current overrides keyed by config key
 *   PUT    /config/overrides/:key    → upsert override; writes audit
 *   DELETE /config/overrides/:key    → reset to default; writes audit
 *   GET    /config/audit             → audit log (?key=&limit=20)
 *
 * Type validation runs at write time (validateConfigValue) so a structurally
 * bad PUT is rejected with 400 before it can reach the runner.
 */

export const config = new Hono();

config.get('/registry', (c) =>
  c.json({
    keys: configKeys(),
    entries: CONFIG_REGISTRY,
  }),
);

config.get('/overrides', (c) =>
  c.json({ overrides: store.configOverrides.getAll() }),
);

config.put('/overrides/:key', async (c) => {
  const rawKey = c.req.param('key');
  if (!(rawKey in CONFIG_REGISTRY)) {
    return c.json({ error: `unknown config key: ${rawKey}` }, 400);
  }
  const key = rawKey as ConfigKey;
  const body = (await c.req.json()) as { value?: unknown; updatedBy?: string };
  if (!('value' in body)) {
    return c.json({ error: 'value required in body' }, 400);
  }
  const validationError = validateConfigValue(key, body.value);
  if (validationError) {
    return c.json({ error: validationError, key }, 400);
  }
  const previous = store.configOverrides.get(key);
  const now = nowIso();
  const actor = (body.updatedBy ?? 'system').slice(0, 64);
  const valueJson = JSON.stringify(body.value);
  store.configOverrides.set({
    key,
    scope: 'global',
    valueJson,
    updatedAt: now,
    updatedBy: actor,
  });
  store.configAudit.insert({
    id: newId('cfgaud'),
    key,
    oldValueJson: previous ? previous.valueJson : null,
    newValueJson: valueJson,
    changedAt: now,
    changedBy: actor,
  });
  return c.json({
    ok: true,
    key,
    override: store.configOverrides.get(key),
  });
});

config.delete('/overrides/:key', (c) => {
  const rawKey = c.req.param('key');
  if (!(rawKey in CONFIG_REGISTRY)) {
    return c.json({ error: `unknown config key: ${rawKey}` }, 400);
  }
  const key = rawKey as ConfigKey;
  const previous = store.configOverrides.get(key);
  if (!previous) {
    return c.json({ ok: true, key, deleted: false });
  }
  const actor = (c.req.query('actor') ?? 'system').slice(0, 64);
  const now = nowIso();
  store.configOverrides.delete(key);
  store.configAudit.insert({
    id: newId('cfgaud'),
    key,
    oldValueJson: previous.valueJson,
    newValueJson: null,
    changedAt: now,
    changedBy: actor,
  });
  return c.json({ ok: true, key, deleted: true });
});

config.get('/audit', (c) => {
  const key = c.req.query('key');
  const rawLimit = Number(c.req.query('limit') ?? '20');
  const limit = Math.min(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 20, 200);
  if (key && !(key in CONFIG_REGISTRY)) {
    return c.json({ error: `unknown config key: ${key}` }, 400);
  }
  const items = key
    ? store.configAudit.listByKey(key, limit)
    : store.configAudit.listAll(limit);
  return c.json({ items });
});
