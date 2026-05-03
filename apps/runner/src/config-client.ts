/**
 * Runtime config client for the runner.
 *
 * Contract:
 *  - getConfig<K>(key) returns the override if present (and well-formed) or
 *    the compile-time registry default.
 *  - In-memory cache with TTL (default 1500ms, slightly shorter than the watch
 *    poll cycle so a stage-by-stage run picks up fresh values within ≤2s).
 *  - On API failure: stale-while-revalidate. Last-known good cache wins; we
 *    never fall back from a fresh override to default just because the API is
 *    momentarily unreachable. If we have NEVER succeeded, we return the
 *    registry default and warn once.
 *  - On malformed override (type / range mismatch): we log once and fall back
 *    to the registry default. Defense-in-depth — the API also validates at
 *    write time, but a corrupt DB row should not crash the runner.
 *
 * NOT covered in PR1 (intentionally):
 *  - Per-project / per-run scope (only `global`)
 *  - Real getConfig call sites in coordinator/skills (PR2 will migrate)
 */

import {
  CONFIG_REGISTRY,
  RUNNER_CONFIG_CACHE_TTL_MS_DEFAULT,
  validateConfigValue,
  type ConfigKey,
  type RegistryDefault,
} from '@ainp/shared';
import { API_BASE } from './config';

interface OverrideRow {
  key: string;
  scope: string;
  valueJson: string;
  updatedAt: string;
  updatedBy: string | null;
}

interface OverridesResponse {
  overrides: Record<string, OverrideRow>;
}

let cache: Map<string, unknown> | null = null;
let cacheAt = 0;
let warnedNoFetch = false;
let warnedMalformed = new Set<string>();
let inflight: Promise<void> | null = null;
let cacheTtlOverrideForTest: number | null = null;

function nowMs(): number {
  return Date.now();
}

function effectiveCacheTtlMs(): number {
  return cacheTtlOverrideForTest ?? RUNNER_CONFIG_CACHE_TTL_MS_DEFAULT;
}

function isFresh(): boolean {
  return cache !== null && nowMs() - cacheAt < effectiveCacheTtlMs();
}

async function fetchOverridesOrNull(): Promise<Map<string, unknown> | null> {
  try {
    const res = await fetch(`${API_BASE}/config/overrides`);
    if (!res.ok) return null;
    const body = (await res.json()) as OverridesResponse;
    const next = new Map<string, unknown>();
    for (const [k, row] of Object.entries(body.overrides ?? {})) {
      try {
        next.set(k, JSON.parse(row.valueJson));
      } catch {
        // Corrupt JSON in override row — silently skip; runtime falls back
        // to registry default for this key.
      }
    }
    return next;
  } catch {
    return null;
  }
}

async function refreshCache(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    const next = await fetchOverridesOrNull();
    if (next !== null) {
      cache = next;
      cacheAt = nowMs();
      warnedNoFetch = false;
      return;
    }
    if (cache === null && !warnedNoFetch) {
      console.warn(
        '[config-client] failed to fetch overrides from API; falling back to compiled defaults',
      );
      warnedNoFetch = true;
    }
    // else: cache stays as last-known good (stale-while-revalidate)
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Returns the live override value for `key`, or the compiled-in registry default. */
export async function getConfig<K extends ConfigKey>(key: K): Promise<RegistryDefault<K>> {
  if (!isFresh()) {
    await refreshCache();
  }
  if (cache !== null && cache.has(key)) {
    const candidate = cache.get(key);
    const validationError = validateConfigValue(key, candidate);
    if (validationError === null) {
      return candidate as RegistryDefault<K>;
    }
    if (!warnedMalformed.has(key)) {
      warnedMalformed.add(key);
      console.warn(
        `[config-client] override for ${key} is malformed: ${validationError}; using compile-time default`,
      );
    }
  }
  return CONFIG_REGISTRY[key].default as RegistryDefault<K>;
}

/** Test-only: drop the cache so the next getConfig() refetches. */
export function invalidateConfigCache(): void {
  cache = null;
  cacheAt = 0;
  warnedNoFetch = false;
  warnedMalformed = new Set<string>();
  inflight = null;
}

/** Test-only: shorten / extend the cache TTL. Pass null to restore default. */
export function __setCacheTtlForTest(ms: number | null): void {
  cacheTtlOverrideForTest = ms;
}

/** Test-only: read internals for assertions. */
export function __cacheStateForTest(): { hasCache: boolean; cacheAt: number; warnedNoFetch: boolean } {
  return {
    hasCache: cache !== null,
    cacheAt,
    warnedNoFetch,
  };
}
