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

describe('buildSettingsViewModel — registry → 5 tabs grouping', () => {
  it('groups every registry key into its category tab and reports a 32-key total when given a 32-key registry', () => {
    const keys = [
      // 6 intelligent_analysis
      'ia.k1', 'ia.k2', 'ia.k3', 'ia.k4', 'ia.k5', 'ia.k6',
      // 4 conversation_ux
      'cu.k1', 'cu.k2', 'cu.k3', 'cu.k4',
      // 5 workflow_custom
      'wc.k1', 'wc.k2', 'wc.k3', 'wc.k4', 'wc.k5',
      // 8 performance_resource
      'pr.k1', 'pr.k2', 'pr.k3', 'pr.k4', 'pr.k5', 'pr.k6', 'pr.k7', 'pr.k8',
      // 9 troubleshooting
      'ts.k1', 'ts.k2', 'ts.k3', 'ts.k4', 'ts.k5', 'ts.k6', 'ts.k7', 'ts.k8', 'ts.k9',
    ];
    const entries: Record<string, ProjectionConfigEntry> = {};
    for (const k of keys) {
      const cat: SettingsTabId = k.startsWith('ia.') ? 'intelligent_analysis'
        : k.startsWith('cu.') ? 'conversation_ux'
          : k.startsWith('wc.') ? 'workflow_custom'
            : k.startsWith('pr.') ? 'performance_resource'
        : 'troubleshooting';
      entries[k] = entry(cat, 'string', 'default');
    }

    const vm = buildSettingsViewModel({
      registry: { keys, entries },
      overrides: {},
      drafts: new Map(),
      audits: new Map(),
    });

    expect(vm.tabs.map((t) => t.id)).toEqual(['intelligent_analysis', 'conversation_ux', 'workflow_custom', 'performance_resource', 'troubleshooting']);
    expect(vm.tabs.map((t) => t.label)).toEqual(['智能分析', '对话体验', '工作流定制', '性能与资源', '故障处理']);
    expect(vm.tabs.find((t) => t.id === 'intelligent_analysis')!.rows).toHaveLength(6);
    expect(vm.tabs.find((t) => t.id === 'conversation_ux')!.rows).toHaveLength(4);
    expect(vm.tabs.find((t) => t.id === 'workflow_custom')!.rows).toHaveLength(5);
    expect(vm.tabs.find((t) => t.id === 'performance_resource')!.rows).toHaveLength(8);
    expect(vm.tabs.find((t) => t.id === 'troubleshooting')!.rows).toHaveLength(9);
    expect(vm.summary).toEqual({ totalKeys: 32, overrideCount: 0, dirtyCount: 0 });
    expect(vm.perKey.size).toBe(32);
  });

  it('skips keys missing from registry.entries without crashing', () => {
    const vm = buildSettingsViewModel({
      registry: {
        keys: ['present', 'missing'],
        entries: { present: entry('performance_resource', 'number', 1) },
      },
      overrides: {},
      drafts: new Map(),
      audits: new Map(),
    });
    expect(vm.perKey.size).toBe(1);
    expect(vm.perKey.has('missing')).toBe(false);
  });

  it('adds user-facing row names, value previews, and risk levels for settings cards', () => {
    const vm = buildSettingsViewModel({
      registry: {
        keys: ['coordinator.confidence_threshold', 'skill.implementation.instructions'],
        entries: {
          'coordinator.confidence_threshold': entry('intelligent_analysis', 'number', 0.65, '规则置信度 ≥ 此值则跳过 LLM 兜底'),
          'skill.implementation.instructions': entry('workflow_custom', 'string', '第一行\n第二行', 'Stage 3 implementation 的 prompt'),
        },
      },
      overrides: {},
      drafts: new Map(),
      audits: new Map(),
    });

    const confidence = vm.perKey.get('coordinator.confidence_threshold')!;
    expect(confidence.displayName).toBe('自动判定置信度');
    expect(confidence.valuePreview).toBe('0.65');
    expect(confidence.risk).toBe('low');

    const prompt = vm.perKey.get('skill.implementation.instructions')!;
    expect(prompt.displayName).toBe('实现阶段提示词');
    expect(prompt.valuePreview).toBe('第一行');
    expect(prompt.risk).toBe('high');
  });
});

describe('buildSettingsViewModel — override application', () => {
  const baseRegistry = {
    keys: ['scalar.string', 'scalar.number', 'list.array'],
    entries: {
      'scalar.string': entry('intelligent_analysis', 'string', 'foo'),
      'scalar.number': entry('intelligent_analysis', 'number', 1),
      'list.array': entry('intelligent_analysis', 'string_array', ['a', 'b']),
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
      entries: { 'scalar.string': entry('intelligent_analysis', 'string', 'default-v') },
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
        'list.array': entry('intelligent_analysis', 'string_array', ['x']),
        'scalar.number': entry('intelligent_analysis', 'number', 0),
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
      entries: { 'scalar.string': entry('intelligent_analysis', 'string', 'd') },
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
      'k.with.audit': entry('performance_resource', 'string', 'd'),
      'k.without.audit': entry('performance_resource', 'string', 'd'),
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
