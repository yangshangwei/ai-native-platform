/**
 * Settings page (Runtime Config Layer) — rendering + page-private state.
 *
 * Owns `settingsConfig`: the registry/override/draft/audit state of the
 * runtime-config editor. The state is fully self-contained; the rest of the
 * app only reads `settingsConfig` for the sidebar summary (main.ts
 * `settingsRuntimeSummary`). Renders the overview cards, runtime
 * diagnostics, and the per-key config rows (editor / save / reset /
 * history). Moved verbatim out of `main.ts` (T2.2 page split); depends only
 * on the base layer (api/dom/state/render-core/data-loading) plus the pure
 * `settings-projection` view-model builder.
 */

import {
  buildSettingsViewModel,
  type ProjectionConfigAudit,
  type ProjectionConfigEntry,
  type ProjectionConfigOverride,
  type SettingsRowVM,
  type SettingsTabId,
  type SettingsViewModel,
} from './settings-projection';
import { errorMessage } from '@ainp/shared/browser';
import type { ProjectDto, RunnerDto, StatusKind } from './types';
import { api } from './api';
import {
  button,
  configSummaryItem,
  el,
  field,
  fmtTime,
  metric,
  panelHeader,
  pill,
  showToast,
} from './dom';
import {
  agentBackendDisplayName,
  agentBackendPreflightInFlight,
  agentBackendStatusForProject,
  data,
  latestRunner,
  selectedProject,
  ui,
} from './state';
import { render } from './render-core';
import { checkAgentBackend, ensureRunnerStarted } from './data-loading';

// Config entry / override / audit shapes are imported from
// `settings-projection.ts` (T2.4): the entry/category types derive from
// `@ainp/shared` (ConfigEntry / ConfigCategory); override/audit shadow
// api-private store shapes there. The third hand-copied triplet that used to
// live here is gone.

interface SettingsConfigState {
  activeTab: SettingsTabId;
  loading: boolean;
  error: string | null;
  registry: { keys: string[]; entries: Record<string, ProjectionConfigEntry> } | null;
  overrides: Record<string, ProjectionConfigOverride>;
  drafts: Map<string, string>;
  saving: Set<string>;
  expandedHistory: Set<string>;
  audits: Map<string, ProjectionConfigAudit[]>;
  loadedOnce: boolean;
  recentlySaved: Set<string>;
}

export const settingsConfig: SettingsConfigState = {
  activeTab: 'coordinator',
  loading: false,
  error: null,
  registry: null,
  overrides: {},
  drafts: new Map(),
  saving: new Set(),
  expandedHistory: new Set(),
  audits: new Map(),
  loadedOnce: false,
  recentlySaved: new Set(),
};

async function loadSettingsConfig(): Promise<void> {
  if (settingsConfig.loading) return;
  settingsConfig.loading = true;
  settingsConfig.error = null;
  try {
    const [reg, ov] = await Promise.all([
      api<{ keys: string[]; entries: Record<string, ProjectionConfigEntry> }>('/config/registry'),
      api<{ overrides: Record<string, ProjectionConfigOverride> }>('/config/overrides'),
    ]);
    settingsConfig.registry = reg;
    settingsConfig.overrides = ov.overrides ?? {};
    settingsConfig.loadedOnce = true;
  } catch (err) {
    settingsConfig.error = errorMessage(err);
  } finally {
    settingsConfig.loading = false;
    render();
  }
}

function setSettingsConfigTab(tab: SettingsTabId): void {
  settingsConfig.activeTab = tab;
  render();
}

function formatConfigValueForEditor(value: unknown, type: ProjectionConfigEntry['type']): string {
  if (type === 'string_array') {
    return Array.isArray(value) ? value.join('\n') : '';
  }
  if (type === 'number' || type === 'string') {
    return value === null || value === undefined ? '' : String(value);
  }
  return JSON.stringify(value);
}

function parseConfigEditorValue(raw: string, type: ProjectionConfigEntry['type']): unknown {
  if (type === 'string_array') {
    return raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }
  if (type === 'number') {
    return Number(raw);
  }
  return raw;
}

function effectiveValueAsEditorString(
  entry: ProjectionConfigEntry,
  override: ProjectionConfigOverride | undefined,
): string {
  if (override) {
    try {
      return formatConfigValueForEditor(JSON.parse(override.valueJson), entry.type);
    } catch {
      return override.valueJson;
    }
  }
  return formatConfigValueForEditor(entry.default, entry.type);
}

function copyConfigDefaultToDraft(key: string): void {
  if (!settingsConfig.registry) return;
  const entry = settingsConfig.registry.entries[key];
  if (!entry) return;
  settingsConfig.drafts.set(key, formatConfigValueForEditor(entry.default, entry.type));
  render();
}

async function saveConfigOverride(key: string): Promise<void> {
  if (!settingsConfig.registry) return;
  const entry = settingsConfig.registry.entries[key];
  if (!entry) return;
  if (settingsConfig.saving.has(key)) return;
  const raw = settingsConfig.drafts.get(key);
  if (raw === undefined) return;
  const value = parseConfigEditorValue(raw, entry.type);
  if (entry.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) {
    settingsConfig.error = `${key}: 不是合法数字`;
    render();
    return;
  }
  settingsConfig.saving.add(key);
  settingsConfig.error = null;
  render();
  try {
    await api(`/config/overrides/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value, updatedBy: 'web' }),
    });
    settingsConfig.drafts.delete(key);
    settingsConfig.audits.delete(key);
    await loadSettingsConfig();

    // Show success toast with display name from projection
    const vm = currentSettingsViewModel();
    const rowVM = vm?.perKey.get(key);
    const displayName = rowVM?.displayName ?? key;
    showToast(`${displayName} 已保存`, 'success');

    // Add to recently saved and remove after 2 seconds
    settingsConfig.recentlySaved.add(key);
    render();
    setTimeout(() => {
      settingsConfig.recentlySaved.delete(key);
      render();
    }, 2000);
  } catch (err) {
    settingsConfig.error = errorMessage(err);
    showToast(errorMessage(err), 'error');
  } finally {
    settingsConfig.saving.delete(key);
    render();
  }
}

async function resetConfigOverride(key: string): Promise<void> {
  if (settingsConfig.saving.has(key)) return;
  settingsConfig.saving.add(key);
  settingsConfig.error = null;
  render();
  try {
    await api(`/config/overrides/${encodeURIComponent(key)}?actor=web`, {
      method: 'DELETE',
    });
    settingsConfig.drafts.delete(key);
    settingsConfig.audits.delete(key);
    await loadSettingsConfig();
  } catch (err) {
    settingsConfig.error = errorMessage(err);
  } finally {
    settingsConfig.saving.delete(key);
    render();
  }
}

async function toggleConfigHistory(key: string): Promise<void> {
  if (settingsConfig.expandedHistory.has(key)) {
    settingsConfig.expandedHistory.delete(key);
    render();
    return;
  }
  settingsConfig.expandedHistory.add(key);
  if (!settingsConfig.audits.has(key)) {
    try {
      const r = await api<{ items: ProjectionConfigAudit[] }>(
        `/config/audit?key=${encodeURIComponent(key)}&limit=20`,
      );
      settingsConfig.audits.set(key, r.items ?? []);
    } catch {
      settingsConfig.audits.set(key, []);
    }
  }
  render();
}

function configTruncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function renderConfigEditor(
  key: string,
  entry: ProjectionConfigEntry,
  value: string,
): HTMLElement {
  if (entry.type === 'number') {
    const input = el('input', {
      class: 'config-input',
      attrs: { type: 'number', step: 'any' },
    }) as unknown as HTMLInputElement;
    input.value = value;
    if (entry.min !== undefined) input.min = String(entry.min);
    if (entry.max !== undefined) input.max = String(entry.max);
    input.oninput = () => {
      settingsConfig.drafts.set(key, input.value);
    };
    return input;
  }
  // Special handling for clarification_style: render as dropdown
  if (key === 'coordinator.clarification_style') {
    const select = el('select', {
      class: 'config-input',
    }) as unknown as HTMLSelectElement;
    const options = [
      { value: 'default', label: 'default - 批量中性' },
      { value: 'grill-me', label: 'grill-me - 逐题深挖' },
    ];
    select.append(
      ...options.map((opt) => {
        const option = el('option', {
          attrs: { value: opt.value },
          text: opt.label,
        }) as unknown as HTMLOptionElement;
        if (value === opt.value) option.selected = true;
        return option;
      }),
    );
    select.onchange = () => {
      settingsConfig.drafts.set(key, select.value);
      render();
    };
    return select;
  }
  if (entry.type === 'string' && !entry.multiline) {
    const input = el('input', {
      class: 'config-input',
      attrs: { type: 'text' },
    }) as unknown as HTMLInputElement;
    input.value = value;
    input.oninput = () => {
      settingsConfig.drafts.set(key, input.value);
    };
    return input;
  }
  // multiline string OR string_array → autosize textarea
  const ta = el('textarea', {
    class: 'config-textarea',
    attrs: { rows: '4' },
  }) as unknown as HTMLTextAreaElement;
  ta.value = value;
  const autosize = (): void => {
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight + 2, 600)}px`;
  };
  ta.oninput = () => {
    settingsConfig.drafts.set(key, ta.value);
    autosize();
  };
  setTimeout(autosize, 0);
  return ta;
}

function renderConfigHistoryPanel(key: string): HTMLElement {
  const audits = settingsConfig.audits.get(key) ?? [];
  if (audits.length === 0) {
    return el('div', {
      class: 'config-history',
      children: [el('p', { class: 'muted', text: '没有历史记录。' })],
    });
  }
  return el('div', {
    class: 'config-history',
    children: audits.map((a) =>
      el('div', {
        class: 'config-history-row',
        children: [
          el('span', { class: 'config-history-time', text: fmtTime(a.changedAt) }),
          el('span', { class: 'config-history-actor', text: a.changedBy ?? '—' }),
          el('span', {
            class: 'config-history-old',
            text: `old: ${configTruncate(a.oldValueJson ?? '(none)', 80)}`,
          }),
          el('span', {
            class: 'config-history-new',
            text: `new: ${a.newValueJson === null ? '(reset)' : configTruncate(a.newValueJson, 80)}`,
          }),
        ],
      }),
    ),
  });
}

function configStateLabel(row: SettingsRowVM): string {
  if (row.hasDraft) return '未保存';
  if (row.hasOverride) return '已覆盖';
  return '默认值';
}

function configStateKind(row: SettingsRowVM): StatusKind {
  if (row.hasDraft) return 'warn';
  if (row.hasOverride) return 'info';
  return 'muted';
}

function configRiskLabel(risk: SettingsRowVM['risk']): string {
  if (risk === 'high') return '高风险';
  if (risk === 'medium') return '中风险';
  return '低风险';
}

function configRiskKind(risk: SettingsRowVM['risk']): StatusKind {
  if (risk === 'high') return 'bad';
  if (risk === 'medium') return 'warn';
  return 'good';
}

function configTypeLabel(entry: ProjectionConfigEntry): string {
  const parts: string[] = [];
  if (entry.type === 'number') parts.push('数字');
  else if (entry.type === 'string_array') parts.push('列表');
  else parts.push('文本');
  if (entry.multiline) parts.push('多行');
  if (entry.min !== undefined) parts.push(`最小 ${entry.min}`);
  if (entry.max !== undefined) parts.push(`最大 ${entry.max}`);
  return parts.join(' · ');
}

function renderConfigRow(row: SettingsRowVM): HTMLElement {
  const key = row.key;
  const entry = row.entry;
  const override = row.override;
  const isOverridden = row.hasOverride;
  const draft = row.draftValue;
  const dirty = row.hasDraft;
  const saving = settingsConfig.saving.has(key);
  const recentlySaved = settingsConfig.recentlySaved.has(key);
  const editorValue = draft ?? effectiveValueAsEditorString(entry, override);
  const expandedHistory = settingsConfig.expandedHistory.has(key);

  const editor = renderConfigEditor(key, entry, editorValue);

  const saveBtn = button(saving ? '保存中…' : '保存', 'button small');
  saveBtn.disabled = !dirty || saving;
  saveBtn.onclick = () => void saveConfigOverride(key);

  const cancelBtn = button('取消', 'button small secondary');
  cancelBtn.disabled = saving;
  cancelBtn.onclick = () => {
    settingsConfig.drafts.delete(key);
    render();
  };

  const resetBtn = button('重置为默认', 'button small secondary');
  resetBtn.disabled = !isOverridden || saving;
  resetBtn.onclick = () => void resetConfigOverride(key);

  const copyBtn = button('复制默认值', 'button small secondary');
  copyBtn.onclick = () => copyConfigDefaultToDraft(key);

  const historyBtn = button(expandedHistory ? '收起历史' : '历史', 'button small secondary');
  historyBtn.onclick = () => void toggleConfigHistory(key);

  const editBtn = button('编辑', 'button small secondary');
  editBtn.onclick = () => {
    if (!settingsConfig.drafts.has(key)) {
      settingsConfig.drafts.set(key, effectiveValueAsEditorString(entry, override));
      render();
    }
  };

  const editDetails = el('details', {
    class: 'config-edit-details',
    attrs: { 'data-details-key': `settings-edit:${key}` },
    children: [
      el('summary', { text: '编辑配置' }),
      editor,
      el('div', {
        class: 'config-actions',
        children: dirty ? [saveBtn, cancelBtn, resetBtn, historyBtn] : [copyBtn, resetBtn, historyBtn],
      }),
    ],
  });
  if (dirty) editDetails.open = true;

  const technicalDetails = el('details', {
    class: 'config-technical-details',
    attrs: { 'data-details-key': `settings-tech:${key}` },
    children: [
      el('summary', { text: '技术详情' }),
      field('配置键', el('code', { text: key })),
      field('类型约束', configTypeLabel(entry)),
      field('默认来源', el('code', { text: entry.source })),
      override ? field('覆盖时间', fmtTime(override.updatedAt)) : null,
    ],
  });

  // Build state/risk badges - only show high risk badge
  const badges: HTMLElement[] = [pill(configStateLabel(row), configStateKind(row))];
  if (row.risk === 'high') {
    badges.push(pill(configRiskLabel(row.risk), configRiskKind(row.risk)));
  }

  const children: Array<Node | null | false | undefined> = [
    el('header', {
      class: 'config-row-header',
      children: [
        el('div', {
          class: 'config-title-copy',
          children: [
            el('strong', { class: 'config-title', text: row.displayName }),
            el('p', { class: 'config-description', text: row.displayDescription }),
          ],
        }),
        el('div', {
          class: 'config-row-badges',
          children: badges,
        }),
      ],
    }),
    // Value preview and action buttons
    el('div', {
      class: 'config-row-actions',
      children: [
        el('div', {
          class: 'config-value-preview',
          children: [
            el('span', { class: 'config-value-label', text: '当前值：' }),
            el('code', { class: 'config-value-text', text: row.valuePreview }),
          ],
        }),
        el('div', {
          class: 'config-quick-actions',
          children: dirty ? [] : [editBtn, historyBtn],
        }),
      ],
    }),
    editDetails,
    technicalDetails,
  ];

  if (expandedHistory) children.push(renderConfigHistoryPanel(key));

  // Build CSS classes
  let cssClass = 'config-row';
  if (isOverridden) cssClass += ' overridden';
  if (dirty) cssClass += ' dirty';
  if (recentlySaved) cssClass += ' recently-saved';

  return el('article', {
    class: cssClass,
    children,
  });
}

function currentSettingsViewModel(): SettingsViewModel | null {
  if (!settingsConfig.registry) return null;
  return buildSettingsViewModel({
    registry: settingsConfig.registry,
    overrides: settingsConfig.overrides,
    drafts: settingsConfig.drafts,
    audits: settingsConfig.audits,
  });
}

function renderConfigSection(vm: SettingsViewModel | null): HTMLElement {
  if (!settingsConfig.registry) {
    if (settingsConfig.loading) {
      return el('section', {
        class: 'panel',
        children: [
          panelHeader('运行配置', '加载中…'),
          el('p', { class: 'muted', text: '正在读取配置项和当前覆盖值。' }),
        ],
      });
    }
    if (settingsConfig.error) {
      return el('section', {
        class: 'panel',
        children: [
          panelHeader('运行配置', '加载失败'),
          el('p', { class: 'error', text: settingsConfig.error }),
        ],
      });
    }
    return el('section', {
      class: 'panel',
      children: [panelHeader('运行配置', '准备加载…')],
    });
  }
  if (!vm) return el('section', { class: 'panel', children: [panelHeader('运行配置', '准备加载…')] });

  const tabBar = el('div', {
    class: 'config-tabs',
    children: vm.tabs.map((t) => {
      const btn = button(
        t.label,
        settingsConfig.activeTab === t.id ? 'tab-button active' : 'tab-button',
      );
      btn.title = t.help;
      btn.onclick = () => setSettingsConfigTab(t.id);
      return btn;
    }),
  });

  const activeTabVm = vm.tabs.find((t) => t.id === settingsConfig.activeTab);
  const categoryRows = activeTabVm?.rows ?? [];

  const errorBanner = settingsConfig.error
    ? el('div', { class: 'error-banner', text: settingsConfig.error })
    : null;

  const summarySubtitle = activeTabVm
    ? `${activeTabVm.help} · ${categoryRows.length} 项`
    : `${vm.summary.totalKeys} 项配置`;

  const sectionChildren: Array<Node | null> = [
    panelHeader('运行配置', summarySubtitle),
    errorBanner,
    tabBar,
    el('div', {
      class: 'config-list',
      children: categoryRows.length === 0
        ? [el('p', { class: 'muted', text: '该分类下暂无配置项。' })]
        : categoryRows.map(renderConfigRow),
    }),
  ];

  return el('section', {
    class: 'panel',
    children: sectionChildren.filter((c): c is Node => Boolean(c)),
  });
}

function settingsOperationalState(project: ProjectDto | null, runner: RunnerDto | null): { label: string; kind: StatusKind; detail: string } {
  if (settingsConfig.error) return { label: '配置加载失败', kind: 'bad', detail: settingsConfig.error };
  if (!project) return { label: '需要连接项目', kind: 'warn', detail: '先接入项目后，运行配置才有默认执行上下文。' };
  if (!project.agentBackend) return { label: '执行方式待配置', kind: 'warn', detail: '项目还没有选择 Claude Code 或 Codex。' };
  const backend = agentBackendStatusForProject(project);
  if (backend.kind === 'bad') return { label: '执行方式需处理', kind: 'bad', detail: backend.label };
  if (!runner) return { label: '执行器待启动', kind: 'warn', detail: '配置可编辑；创建任务时会尝试启动 Runner。' };
  return { label: '可运行', kind: 'good', detail: `${project.name} · ${agentBackendDisplayName(project.agentBackend)} · Runner ${runner.status}` };
}

function renderSettingsOverview(vm: SettingsViewModel | null): HTMLElement {
  const project = selectedProject();
  const runner = latestRunner();
  const operational = settingsOperationalState(project, runner);
  const overrideCount = vm?.summary.overrideCount ?? Object.keys(settingsConfig.overrides).length;
  const dirtyCount = vm?.summary.dirtyCount ?? settingsConfig.drafts.size;
  const totalKeys = vm?.summary.totalKeys ?? settingsConfig.registry?.keys.length ?? 0;
  const backend = agentBackendStatusForProject(project);

  const refresh = button(settingsConfig.loading ? '刷新中…' : '刷新配置', 'btn btn-secondary');
  refresh.disabled = settingsConfig.loading;
  refresh.onclick = () => void loadSettingsConfig();

  const checkBackend = button(agentBackendPreflightInFlight.has(project?.id ?? '') ? '检测中…' : '检测执行方式', 'btn btn-secondary');
  checkBackend.disabled = !project?.agentBackend || agentBackendPreflightInFlight.has(project?.id ?? '');
  checkBackend.onclick = () => {
    if (project?.agentBackend) void checkAgentBackend(project.agentBackend, project.id);
  };

  const startRunner = button(ui.runnerStartInFlight ? '启动中…' : '启动执行器', 'btn btn-secondary');
  startRunner.disabled = Boolean(runner) || ui.runnerStartInFlight;
  startRunner.onclick = () => void ensureRunnerStarted();

  return el('section', {
    class: 'settings-overview-grid',
    children: [
      el('article', {
        class: 'panel settings-overview-card',
        children: [
          panelHeader('运行状态', '当前是否具备执行任务的基础条件。'),
          pill(operational.label, operational.kind),
          el('p', { class: 'muted compact', text: operational.detail }),
          el('div', {
            class: 'settings-summary-grid',
            children: [
              configSummaryItem('项目', project?.name ?? '未接入'),
              configSummaryItem('执行方式', project?.agentBackend ? `${agentBackendDisplayName(project.agentBackend)} · ${backend.label}` : '未配置'),
              configSummaryItem('Runner', runner ? runner.status : '未连接'),
              configSummaryItem('配置项', totalKeys ? `${totalKeys} 项` : '加载中'),
            ],
          }),
        ],
      }),
      el('article', {
        class: 'panel settings-overview-card',
        children: [
          panelHeader('配置变更', '只显示需要注意的变更状态。'),
          el('div', {
            class: 'settings-kpi-row',
            children: [
              metric('已覆盖', String(overrideCount), '覆盖默认值', overrideCount ? 'info' : 'muted'),
              metric('未保存', String(dirtyCount), dirtyCount ? '需要保存或放弃' : '没有草稿', dirtyCount ? 'warn' : 'good'),
            ],
          }),
          el('p', { class: 'muted compact', text: dirtyCount ? '保存后 Runner 会在短时间内读取新配置。' : '当前没有待保存修改。' }),
        ],
      }),
      el('article', {
        class: 'panel settings-overview-card',
        children: [
          panelHeader('常用操作', '优先处理连接、刷新和执行器状态。'),
          el('div', { class: 'settings-action-list', children: [refresh, checkBackend, startRunner] }),
          el('p', { class: 'muted compact', text: '高级配置在下方卡片中单项保存，历史记录按配置项查看。' }),
        ],
      }),
    ],
  });
}

function renderSettingsDiagnostics(): HTMLElement {
  const runner = latestRunner();
  return el('details', {
    class: 'panel settings-diagnostics',
    attrs: { 'data-details-key': 'settings-runtime-diagnostics' },
    children: [
      el('summary', { text: '运行环境详情' }),
      el('div', {
        class: 'settings-diagnostics-grid',
        children: [
          el('article', {
            class: 'inline-panel',
            children: [
              panelHeader('执行策略', 'Local Runner + Git worktree'),
              field('执行环境', '本机 JDK / Maven / Git'),
              field('隔离方式', 'Git worktree 隔离工作目录与分支'),
              field('质量边界', '真实命令 + Gate + Diff + Approval + Audit'),
              field('安全边界', '不做容器或微虚拟机级强制沙箱'),
            ],
          }),
          el('article', {
            class: 'inline-panel',
            children: [
              panelHeader('执行器诊断', runner ? `${runner.status} · ${fmtTime(runner.lastSeenAt)}` : '尚未连接'),
              runner
                ? el('div', { class: 'stack', children: data.runners.map(renderRunnerCard) })
                : el('p', { class: 'muted compact', text: '尚未收到 Runner heartbeat。需要时可启动执行器或在命令行排查。' }),
            ],
          }),
        ],
      }),
    ],
  });
}

export function renderSettingsPage(): HTMLElement {
  if (!settingsConfig.loadedOnce && !settingsConfig.loading && !settingsConfig.error) {
    void loadSettingsConfig();
  }
  const vm = currentSettingsViewModel();

  return el('section', {
    class: 'settings-page stack',
    children: [renderSettingsOverview(vm), renderSettingsDiagnostics(), renderConfigSection(vm)],
  });
}

function renderRunnerCard(runner: RunnerDto): HTMLElement {
  return el('article', {
    class: 'runner-card',
    children: [
      el('div', { children: [el('strong', { text: runner.id }), pill(runner.status)] }),
      field('Host', runner.host),
      field('JDK', runner.jdkVersion ?? '—'),
      field('Maven', runner.mavenVersion?.split('\n')[0] ?? '—'),
      field('Git', runner.gitVersion ?? '—'),
      field('Last Seen', fmtTime(runner.lastSeenAt)),
    ],
  });
}
