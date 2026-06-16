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

import type { ConfigCategory, ConfigEntry } from '@ainp/shared/browser';

/**
 * Settings tabs mirror the shared config registry's categories 1:1 — derived
 * (T2.4) instead of hand-copied so a new ConfigCategory becomes a compile
 * error in TABS_CONFIG below rather than a silently missing tab.
 */
export type SettingsTabId = ConfigCategory;

/**
 * Registry entry as served by `GET /config/registry` — exactly the shared
 * {@link ConfigEntry} (the API serializes CONFIG_REGISTRY verbatim).
 */
export type ProjectionConfigEntry = ConfigEntry;

/**
 * Shadow of the api-private `ConfigOverride` (apps/api/src/store/store.ts) —
 * no shared source exists, so this stays hand-aligned. Registered in task
 * notes.md (R4) as a "wire contract → shared" follow-up candidate.
 */
export interface ProjectionConfigOverride {
  key: string;
  scope: string;
  valueJson: string;
  updatedAt: string;
  updatedBy: string | null;
}

/**
 * Shadow of the api-private `ConfigAuditEntry` (apps/api/src/store/store.ts)
 * — no shared source exists, so this stays hand-aligned. Registered in task
 * notes.md (R4) as a "wire contract → shared" follow-up candidate.
 */
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
  displayName: string;
  displayDescription: string;
  valuePreview: string;
  risk: 'low' | 'medium' | 'high';
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
    id: 'intelligent_analysis',
    label: '智能分析',
    help: '调整AI如何理解和分类用户请求',
  },
  {
    id: 'conversation_ux',
    label: '对话体验',
    help: '控制AI如何与用户交互和追问',
  },
  {
    id: 'workflow_custom',
    label: '工作流定制',
    help: '定制各阶段（需求/设计/实现/审查）的AI行为',
  },
  {
    id: 'performance_resource',
    label: '性能与资源',
    help: '优化执行性能和控制资源消耗',
  },
  {
    id: 'troubleshooting',
    label: '故障处理',
    help: '排查问题和自定义错误提示',
  },
];

const CONFIG_DISPLAY_NAMES: Record<string, string> = {
  'coordinator.confidence_threshold': '自动判定置信度',
  'coordinator.bug_keywords': 'Bug 关键词',
  'coordinator.feature_keywords': '功能关键词',
  'coordinator.large_scope_keywords': '大范围需求关键词',
  'coordinator.large_scope_regex': '大范围需求规则',
  'coordinator.refactor_keywords': '重构关键词',
  'coordinator.system_prompt': 'Coordinator 系统提示词',
  'coordinator.fallback.too_short_questions': '目标过短时的追问',
  'coordinator.fallback.large_scope_template': '大范围需求首问模板',
  'coordinator.fallback.large_scope_followup': '大范围需求追问补充',
  'coordinator.fallback.llm_unavailable': 'AI 不可用时的提示',
  'coordinator.fallback.llm_invocation_failed': 'AI 调用失败时的提示',
  'coordinator.fallback.llm_empty': 'AI 空响应时的提示',
  'coordinator.fallback.llm_invalid_json': 'AI 返回格式错误时的提示',
  'coordinator.fallback.llm_unknown_action': 'AI 判断动作未知时的提示',
  'skill.context_pack.instructions': '上下文收集提示词',
  'skill.requirement_draft.instructions': '需求草稿提示词',
  'skill.design.instructions': '设计阶段提示词',
  'skill.implementation.instructions': '实现阶段提示词',
  'skill.review.instructions': '评审阶段提示词',
  'runner.coordinator.oneshot_timeout_ms': '任务理解超时时间',
  'runner.watch.poll_ms': 'Runner 轮询间隔',
  'runner.command.default_timeout_ms': '命令默认超时',
  'runner.command.max_log_bytes': '命令日志上限',
  'runner.config.cache_ttl_ms': '配置缓存时间',
  'context.policy.max_tokens': '上下文总预算',
  'context.policy.reserved_for_reasoning': '推理预留预算',
  'context.policy.reserved_for_output': '输出预留预算',
  'context.policy.sensitive_path_patterns': '敏感路径过滤规则',
};

const CONFIG_DISPLAY_DESCRIPTIONS: Record<string, string> = {
  'coordinator.confidence_threshold': '分数达到该阈值时直接进入推荐流程；低于阈值时会先澄清或调用 AI 兜底。',
  'coordinator.system_prompt': '影响 Coordinator 如何理解用户目标和输出判断结果。',
  'context.policy.sensitive_path_patterns': '命中的文件不会进入 AI 上下文，避免把敏感信息带入任务。',
};

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
    intelligent_analysis: [],
    conversation_ux: [],
    workflow_custom: [],
    performance_resource: [],
    troubleshooting: [],
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
      displayName: displayNameForKey(key),
      displayDescription: displayDescriptionForKey(key, entry),
      valuePreview: valuePreview(effectiveValue, entry),
      risk: riskForKey(key, entry),
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

function displayNameForKey(key: string): string {
  return CONFIG_DISPLAY_NAMES[key] ?? key
    .split('.')
    .at(-1)!
    .replace(/_/g, ' ');
}

function displayDescriptionForKey(key: string, entry: ProjectionConfigEntry): string {
  return CONFIG_DISPLAY_DESCRIPTIONS[key] ?? entry.description;
}

function valuePreview(value: unknown, entry: ProjectionConfigEntry): string {
  if (entry.type === 'string_array') {
    const items = Array.isArray(value) ? value.map(String) : [];
    if (!items.length) return '空列表';
    const joined = items.slice(0, 4).join('、');
    return items.length > 4 ? `${items.length} 项：${joined}…` : `${items.length} 项：${joined}`;
  }
  if (entry.type === 'number') return String(value ?? '—');
  const text = String(value ?? '').trim();
  if (!text) return '空';
  const firstLine = text.split('\n').find((line) => line.trim().length > 0)?.trim() ?? text;
  return firstLine.length > 120 ? `${firstLine.slice(0, 119)}…` : firstLine;
}

function riskForKey(key: string, entry: ProjectionConfigEntry): SettingsRowVM['risk'] {
  if (entry.multiline || key.includes('system_prompt') || key.includes('instructions')) return 'high';
  if (key.includes('sensitive_path') || key.includes('max_tokens') || key.includes('max_log_bytes')) return 'high';
  if (key.includes('timeout') || key.includes('poll') || key.includes('cache_ttl')) return 'medium';
  if (key.includes('keywords') || key.includes('regex') || key.includes('fallback')) return 'medium';
  return 'low';
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
