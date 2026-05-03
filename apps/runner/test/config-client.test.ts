import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COORDINATOR_BUG_KEYWORDS_DEFAULT,
  COORDINATOR_CONFIDENCE_THRESHOLD_DEFAULT,
} from '@ainp/shared';
import {
  __setCacheTtlForTest,
  getConfig,
  invalidateConfigCache,
} from '../src/config-client';

const realFetch = globalThis.fetch;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  invalidateConfigCache();
  __setCacheTtlForTest(null);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('getConfig — cache hit', () => {
  it('serves successive calls within TTL from a single fetch', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return jsonResponse({ overrides: {} });
    }) as typeof fetch;

    await getConfig('coordinator.bug_keywords');
    await getConfig('coordinator.bug_keywords');
    await getConfig('coordinator.confidence_threshold');

    expect(calls).toBe(1);
  });
});

describe('getConfig — cache miss with override', () => {
  it('returns the override value when the API has one', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        overrides: {
          'coordinator.confidence_threshold': {
            key: 'coordinator.confidence_threshold',
            scope: 'global',
            valueJson: '0.42',
            updatedAt: '2026-01-01T00:00:00Z',
            updatedBy: 'test',
          },
        },
      })) as typeof fetch;

    const v = await getConfig('coordinator.confidence_threshold');
    expect(v).toBe(0.42);
  });

  it('parses string_array overrides correctly', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        overrides: {
          'coordinator.bug_keywords': {
            key: 'coordinator.bug_keywords',
            scope: 'global',
            valueJson: JSON.stringify(['panic', 'oops']),
            updatedAt: '2026-01-01T00:00:00Z',
            updatedBy: 'test',
          },
        },
      })) as typeof fetch;

    const v = await getConfig('coordinator.bug_keywords');
    expect(v).toEqual(['panic', 'oops']);
  });
});

describe('getConfig — cache miss without override', () => {
  it('returns the registry default when the override is absent', async () => {
    globalThis.fetch = (async () => jsonResponse({ overrides: {} })) as typeof fetch;

    const v = await getConfig('coordinator.confidence_threshold');
    expect(v).toBe(COORDINATOR_CONFIDENCE_THRESHOLD_DEFAULT);

    const arr = await getConfig('coordinator.bug_keywords');
    expect(arr).toEqual(COORDINATOR_BUG_KEYWORDS_DEFAULT);
  });
});

describe('getConfig — API down with stale cache (stale-while-revalidate)', () => {
  it('keeps the last-known good value when the next fetch fails', async () => {
    let phase = 0;
    globalThis.fetch = (async () => {
      phase++;
      if (phase === 1) {
        return jsonResponse({
          overrides: {
            'coordinator.confidence_threshold': {
              key: 'coordinator.confidence_threshold',
              scope: 'global',
              valueJson: '0.99',
              updatedAt: '2026-01-01T00:00:00Z',
              updatedBy: 'test',
            },
          },
        });
      }
      throw new Error('econnrefused');
    }) as typeof fetch;

    // Force the cache to expire between calls so the second call refetches.
    __setCacheTtlForTest(0);

    const first = await getConfig('coordinator.confidence_threshold');
    expect(first).toBe(0.99);

    const second = await getConfig('coordinator.confidence_threshold');
    expect(second).toBe(0.99); // stays at last-known good even though fetch threw
  });
});

describe('getConfig — API down with no cache (warn once + default)', () => {
  it('returns the registry default and warns exactly once across multiple calls', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    globalThis.fetch = (async () => {
      throw new Error('econnrefused');
    }) as typeof fetch;

    const a = await getConfig('coordinator.confidence_threshold');
    expect(a).toBe(COORDINATOR_CONFIDENCE_THRESHOLD_DEFAULT);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // Second call: cache still null, but we should NOT warn again.
    // (Force cache expiry to be sure the second call attempts refresh.)
    __setCacheTtlForTest(0);
    const b = await getConfig('coordinator.bug_keywords');
    expect(b).toEqual(COORDINATOR_BUG_KEYWORDS_DEFAULT);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

describe('getConfig — malformed override defense-in-depth', () => {
  it('falls back to default when an override fails type validation', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    globalThis.fetch = (async () =>
      jsonResponse({
        overrides: {
          // override that violates min/max (too high)
          'coordinator.confidence_threshold': {
            key: 'coordinator.confidence_threshold',
            scope: 'global',
            valueJson: '999',
            updatedAt: '2026-01-01T00:00:00Z',
            updatedBy: 'corrupt-source',
          },
        },
      })) as typeof fetch;

    const v = await getConfig('coordinator.confidence_threshold');
    expect(v).toBe(COORDINATOR_CONFIDENCE_THRESHOLD_DEFAULT);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
