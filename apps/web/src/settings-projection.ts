/**
 * Settings → Runtime Config — pure view-model projection.
 *
 * Inputs come from the API (`/config/registry`, `/config/overrides`,
 * `/config/audit`) plus the user's in-flight unsaved drafts. Output is a
 * tab-grouped view model the UI renders directly. No DOM access, no global
 * state — purely a data transformation so it can be unit-tested without a
 * browser or network.
 *
 * See `docs/superpowers/specs/2026-05-04-pr4-settings-polish-design.md`
 * §D-PR4.2 for the design intent.
 */

export type SettingsTabId = 'coordinator' | 'skill_prompts' | 'runtime';

export interface ProjectionConfigEntry {
  type: 'number' | 'string' | 'string_array';
  default: number | string | readonly string[];
  description: string;
  category: SettingsTabId;
  min?: number;
  max?: number;
  multiline?: boolean;
  source: string;
}

export interface ProjectionConfigOverride {
  key: string;
  scope: string;
  valueJson: string;
  updatedAt: string;
  updatedBy: string | null;
}

export interface ProjectionConfigAudit {
  id: string;
  key: string;
  oldValueJson: string | null;
  newValueJson: string | null;
  changedAt: string;
  changedBy: string | null;
}

export interface SettingsRowVM {
  key: string;
  entry: ProjectionConfigEntry;
  override: ProjectionConfigOverride | undefined;
  effectiveValue: unknown;
  source: 'default' | 'override' | 'dirty';
  hasOverride: boolean;
  hasDraft: boolean;
  draftValue: string | undefined;
  latestAuditAt: string | null;
}

export interface SettingsTabVM {
  id: SettingsTabId;
  label: string;
  help: string;
  rows: SettingsRowVM[];
}

export interface SettingsViewModel {
  tabs: SettingsTabVM[];
  summary: { totalKeys: number; overrideCount: number; dirtyCount: number };
  perKey: Map<string, SettingsRowVM>;
}

export interface BuildSettingsViewModelInput {
  registry: {
    keys: string[];
    entries: Record<string, ProjectionConfigEntry>;
  };
  overrides: Record<string, ProjectionConfigOverride>;
  /** User's in-flight unsaved drafts keyed by config key (raw editor strings). */
  drafts: Map<string, string> | Record<string, string>;
  /** Per-key audit history (keyed by config key, value is the entries list — typically already sorted desc by changedAt). */
  audits: Map<string, ProjectionConfigAudit[]> | Record<string, ProjectionConfigAudit[]>;
}

const TABS_CONFIG: ReadonlyArray<{ id: SettingsTabId; label: string; help: string }> = [
  {
    id: 'coordinator',
    label: 'Coordinator',
    help: '关键词字典 / 阈值 / 系统 prompt / 兜底 questions',
  },
  {
    id: 'skill_prompts',
    label: 'Skill Prompts',
    help: '5 个阶段的方法论 prompt',
  },
  {
    id: 'runtime',
    label: 'Runtime',
    help: 'timeout / poll / 缓存 TTL',
  },
];

/**
 * Build a tab-grouped view model from current registry / overrides / drafts /
 * audits state. The result is consumed by `renderConfigSection()` in
 * `apps/web/src/main.ts` and exercised in `settings-projection.test.ts`.
 */
export function buildSettingsViewModel(
  input: BuildSettingsViewModelInput,
): SettingsViewModel {
  const drafts = toMap(input.drafts);
  const audits = toMap(input.audits);

  const perKey = new Map<string, SettingsRowVM>();
  const rowsByTab: Record<SettingsTabId, SettingsRowVM[]> = {
    coordinator: [],
    skill_prompts: [],
    runtime: [],
  };

  let overrideCount = 0;
  let dirtyCount = 0;

  for (const key of input.registry.keys) {
    const entry = input.registry.entries[key];
    if (!entry) continue;

    const override = input.overrides[key];
    const hasOverride = !!override;
    const draftValue = drafts.get(key);
    const hasDraft = draftValue !== undefined;

    let effectiveValue: unknown;
    let source: 'default' | 'override' | 'dirty';
    if (hasDraft) {
      effectiveValue = parseDraftValue(draftValue!, entry.type);
      source = 'dirty';
      dirtyCount++;
    } else if (hasOverride) {
      effectiveValue = parseOverrideValue(override!.valueJson);
      source = 'override';
    } else {
      effectiveValue = entry.default;
      source = 'default';
    }
    // overrideCount counts keys with an override stored in DB, independent of
    // whether the user currently has a dirty draft for the same key.
    if (hasOverride) overrideCount++;

    const latestAuditAt = pickLatestChangedAt(audits.get(key));

    const row: SettingsRowVM = {
      key,
      entry,
      override,
      effectiveValue,
      source,
      hasOverride,
      hasDraft,
      draftValue,
      latestAuditAt,
    };
    perKey.set(key, row);
    rowsByTab[entry.category].push(row);
  }

  const tabs: SettingsTabVM[] = TABS_CONFIG.map((t) => ({
    id: t.id,
    label: t.label,
    help: t.help,
    rows: rowsByTab[t.id],
  }));

  return {
    tabs,
    summary: {
      totalKeys: input.registry.keys.length,
      overrideCount,
      dirtyCount,
    },
    perKey,
  };
}

/** Parse the user's raw editor string into the type the registry declares. */
function parseDraftValue(
  raw: string,
  type: ProjectionConfigEntry['type'],
): unknown {
  if (type === 'string_array') {
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }
  if (type === 'number') {
    return Number(raw);
  }
  return raw;
}

/** Parse a stored override's JSON-encoded value, falling back to the raw string on error. */
function parseOverrideValue(valueJson: string): unknown {
  try {
    return JSON.parse(valueJson);
  } catch {
    return valueJson;
  }
}

/** Defensively pick the latest `changedAt` regardless of input ordering. */
function pickLatestChangedAt(entries: ProjectionConfigAudit[] | undefined): string | null {
  if (!entries || entries.length === 0) return null;
  let latest: string | null = null;
  for (const e of entries) {
    if (latest === null || e.changedAt > latest) {
      latest = e.changedAt;
    }
  }
  return latest;
}

/** Accept either Map or plain-object drafts/audits; normalize to Map for lookup. */
function toMap<V>(input: Map<string, V> | Record<string, V>): Map<string, V> {
  if (input instanceof Map) return input;
  return new Map(Object.entries(input));
}
