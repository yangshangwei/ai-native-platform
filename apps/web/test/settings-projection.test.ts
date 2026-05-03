import { describe, expect, it } from 'vitest';
import {
  buildSettingsViewModel,
  type ProjectionConfigAudit,
  type ProjectionConfigEntry,
  type ProjectionConfigOverride,
  type SettingsTabId,
} from '../src/settings-projection';

/**
 * Pure-function tests for `buildSettingsViewModel`. Mirrors the existing
 * `apps/web/test/projection.test.ts` pattern — no DOM, no network, no global
 * state. See PR4 §D-PR4.2 for the design intent.
 */

function entry(
  category: SettingsTabId,
  type: ProjectionConfigEntry['type'],
  defaultValue: ProjectionConfigEntry['default'],
  description = '',
  source = 'apps/runner/src/test.ts:1',
): ProjectionConfigEntry {
  return { type, default: defaultValue, description, category, source };
}

function override(key: string, valueJson: string): ProjectionConfigOverride {
  return {
    key,
    scope: 'global',
    valueJson,
    updatedAt: '2026-05-04T00:00:00.000Z',
    updatedBy: 'web',
  };
}

function audit(
  key: string,
  changedAt: string,
  newValueJson: string | null = '"v"',
): ProjectionConfigAudit {
  return {
    id: `aud_${key}_${changedAt}`,
    key,
    oldValueJson: null,
    newValueJson,
    changedAt,
    changedBy: 'web',
  };
}

describe('buildSettingsViewModel — registry → 3 tabs grouping', () => {
  it('groups every registry key into its category tab and reports a 24-key total when given a 24-key registry', () => {
    const keys = [
      // 14 coordinator
      'c.k1', 'c.k2', 'c.k3', 'c.k4', 'c.k5', 'c.k6', 'c.k7',
      'c.k8', 'c.k9', 'c.k10', 'c.k11', 'c.k12', 'c.k13', 'c.k14',
      // 5 skill_prompts
      's.k1', 's.k2', 's.k3', 's.k4', 's.k5',
      // 5 runtime
      'r.k1', 'r.k2', 'r.k3', 'r.k4', 'r.k5',
    ];
    const entries: Record<string, ProjectionConfigEntry> = {};
    for (const k of keys) {
      const cat: SettingsTabId = k.startsWith('c.') ? 'coordinator'
        : k.startsWith('s.') ? 'skill_prompts'
        : 'runtime';
      entries[k] = entry(cat, 'string', 'default');
    }

    const vm = buildSettingsViewModel({
      registry: { keys, entries },
      overrides: {},
      drafts: new Map(),
      audits: new Map(),
    });

    expect(vm.tabs.map((t) => t.id)).toEqual(['coordinator', 'skill_prompts', 'runtime']);
    expect(vm.tabs.find((t) => t.id === 'coordinator')!.rows).toHaveLength(14);
    expect(vm.tabs.find((t) => t.id === 'skill_prompts')!.rows).toHaveLength(5);
    expect(vm.tabs.find((t) => t.id === 'runtime')!.rows).toHaveLength(5);
    expect(vm.summary).toEqual({ totalKeys: 24, overrideCount: 0, dirtyCount: 0 });
    expect(vm.perKey.size).toBe(24);
  });

  it('skips keys missing from registry.entries without crashing', () => {
    const vm = buildSettingsViewModel({
      registry: {
        keys: ['present', 'missing'],
        entries: { present: entry('runtime', 'number', 1) },
      },
      overrides: {},
      drafts: new Map(),
      audits: new Map(),
    });
    expect(vm.perKey.size).toBe(1);
    expect(vm.perKey.has('missing')).toBe(false);
  });
});

describe('buildSettingsViewModel — override application', () => {
  const baseRegistry = {
    keys: ['scalar.string', 'scalar.number', 'list.array'],
    entries: {
      'scalar.string': entry('coordinator', 'string', 'foo'),
      'scalar.number': entry('coordinator', 'number', 1),
      'list.array': entry('coordinator', 'string_array', ['a', 'b']),
    },
  };

  it('applies a scalar string override and tags source=override', () => {
    const vm = buildSettingsViewModel({
      registry: baseRegistry,
      overrides: { 'scalar.string': override('scalar.string', '"bar"') },
      drafts: new Map(),
      audits: new Map(),
    });
    const row = vm.perKey.get('scalar.string')!;
    expect(row.effectiveValue).toBe('bar');
    expect(row.source).toBe('override');
    expect(row.hasOverride).toBe(true);
    expect(vm.summary.overrideCount).toBe(1);
  });

  it('replaces the whole array (not merge) per PRD D4 array semantics', () => {
    const vm = buildSettingsViewModel({
      registry: baseRegistry,
      overrides: { 'list.array': override('list.array', JSON.stringify(['c'])) },
      drafts: new Map(),
      audits: new Map(),
    });
    const row = vm.perKey.get('list.array')!;
    expect(row.effectiveValue).toEqual(['c']);
    expect(row.source).toBe('override');
  });

  it('falls through to the registry default when no override and no draft', () => {
    const vm = buildSettingsViewModel({
      registry: baseRegistry,
      overrides: {},
      drafts: new Map(),
      audits: new Map(),
    });
    const stringRow = vm.perKey.get('scalar.string')!;
    expect(stringRow.effectiveValue).toBe('foo');
    expect(stringRow.source).toBe('default');
    expect(stringRow.hasOverride).toBe(false);

    const arrayRow = vm.perKey.get('list.array')!;
    expect(arrayRow.effectiveValue).toEqual(['a', 'b']);
    expect(arrayRow.source).toBe('default');
  });

  it('falls back to raw valueJson when override JSON is malformed', () => {
    const vm = buildSettingsViewModel({
      registry: baseRegistry,
      overrides: { 'scalar.string': override('scalar.string', 'not-json') },
      drafts: new Map(),
      audits: new Map(),
    });
    expect(vm.perKey.get('scalar.string')!.effectiveValue).toBe('not-json');
  });
});

describe('buildSettingsViewModel — dirty state', () => {
  it('tags a draft as dirty even when an override exists', () => {
    const registry = {
      keys: ['scalar.string'],
      entries: { 'scalar.string': entry('coordinator', 'string', 'default-v') },
    };
    const vm = buildSettingsViewModel({
      registry,
      overrides: { 'scalar.string': override('scalar.string', '"override-v"') },
      drafts: new Map([['scalar.string', 'unsaved-v']]),
      audits: new Map(),
    });
    const row = vm.perKey.get('scalar.string')!;
    expect(row.source).toBe('dirty');
    expect(row.effectiveValue).toBe('unsaved-v');
    expect(row.hasOverride).toBe(true);
    expect(row.hasDraft).toBe(true);
    expect(row.draftValue).toBe('unsaved-v');
    expect(vm.summary.dirtyCount).toBe(1);
    expect(vm.summary.overrideCount).toBe(1);
  });

  it('parses dirty drafts according to the registry type (string_array splits on newlines)', () => {
    const registry = {
      keys: ['list.array', 'scalar.number'],
      entries: {
        'list.array': entry('coordinator', 'string_array', ['x']),
        'scalar.number': entry('coordinator', 'number', 0),
      },
    };
    const vm = buildSettingsViewModel({
      registry,
      overrides: {},
      drafts: new Map([
        ['list.array', 'one\ntwo\n  three  \n'],
        ['scalar.number', '42'],
      ]),
      audits: new Map(),
    });
    expect(vm.perKey.get('list.array')!.effectiveValue).toEqual(['one', 'two', 'three']);
    expect(vm.perKey.get('scalar.number')!.effectiveValue).toBe(42);
    expect(vm.summary.dirtyCount).toBe(2);
  });

  it('accepts a plain-object drafts map (interop with non-Map callers)', () => {
    const registry = {
      keys: ['scalar.string'],
      entries: { 'scalar.string': entry('coordinator', 'string', 'd') },
    };
    const vm = buildSettingsViewModel({
      registry,
      overrides: {},
      drafts: { 'scalar.string': 'object-draft' },
      audits: {},
    });
    expect(vm.perKey.get('scalar.string')!.source).toBe('dirty');
    expect(vm.perKey.get('scalar.string')!.effectiveValue).toBe('object-draft');
  });
});

describe('buildSettingsViewModel — audit linkage', () => {
  const registry = {
    keys: ['k.with.audit', 'k.without.audit'],
    entries: {
      'k.with.audit': entry('runtime', 'string', 'd'),
      'k.without.audit': entry('runtime', 'string', 'd'),
    },
  };

  it('picks the most-recent changedAt regardless of input order', () => {
    const audits = new Map<string, ProjectionConfigAudit[]>([
      [
        'k.with.audit',
        [
          // intentionally not sorted desc
          audit('k.with.audit', '2026-05-01T10:00:00.000Z'),
          audit('k.with.audit', '2026-05-04T15:00:00.000Z'), // latest
          audit('k.with.audit', '2026-05-02T12:00:00.000Z'),
        ],
      ],
    ]);
    const vm = buildSettingsViewModel({
      registry,
      overrides: {},
      drafts: new Map(),
      audits,
    });
    expect(vm.perKey.get('k.with.audit')!.latestAuditAt).toBe('2026-05-04T15:00:00.000Z');
    expect(vm.perKey.get('k.without.audit')!.latestAuditAt).toBe(null);
  });

  it('returns null latestAuditAt for keys whose audit list is missing or empty', () => {
    const vm = buildSettingsViewModel({
      registry,
      overrides: {},
      drafts: new Map(),
      audits: new Map([['k.with.audit', []]]),
    });
    expect(vm.perKey.get('k.with.audit')!.latestAuditAt).toBe(null);
  });
});
