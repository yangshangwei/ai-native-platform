/**
 * App shell — sidebar, topbar, page dispatch, and the stream overlay host.
 *
 * The layer above all page modules: `renderShell()` builds the root layout
 * (sidebar nav + queue summary, topbar title/context strip, current page
 * via the `Page`-union switch in `renderCurrentPage`, plus the maximized
 * agent-stream overlay when `expandedStreamRunId` is set). The per-page
 * topbar summaries live here because the topbar is their only consumer;
 * they read page-module state (settingsConfig / knowledgeArtifactsState /
 * newTaskFormDraft / workbenchEnvironmentSummary) one-way. Owns no mutable
 * state. main.ts registers `renderShell` as the render-core shell hook.
 * Moved verbatim out of `main.ts` (T2.3 page split).
 */

import { reportStats } from './projection';
import type { Page, ProjectDto, RunnerDto, StatusKind } from './types';
import { button, el, icon, shortId, statusKind, octopusIcon } from './dom';
import {
  activeProjects,
  activeTaskRequest,
  agentBackendContextLabel,
  agentBackendStatusForProject,
  buildEnvLabel,
  data,
  latestRunner,
  myTodosCount,
  parsedKnowledge,
  preflightForProjectBackend,
  projectAvailability,
  selectedProject,
  ui,
} from './state';
import { setHash } from './router';
import { render } from './render-core';
import { toggleTheme, getResolvedTheme } from './theme';
import {
  buildAgentStreamViewForRun,
  closeExpandedStream,
  expandedStreamRunId,
  renderAgentStreamBody,
  renderStreamStatus,
  renderStreamSummary,
  renderStreamTitle,
  renderStreamVerbosityToggle,
} from './stream';
import { renderTaskDetailPage } from './page-task-detail';
import { renderProjectsPage } from './page-projects';
import { newTaskFormDraft, renderNewTaskPage } from './page-new-task';
import { renderReportsPage } from './page-reports';
import {
  currentKnowledgeArtifacts,
  knowledgeArtifactsState,
  knowledgeSuggestionItems,
  renderKnowledgePage,
} from './page-knowledge';
import { renderSettingsPage, settingsConfig } from './page-settings';
import { renderWorkbenchPage, workbenchEnvironmentSummary } from './page-workbench';
import { renderMyTodosPage } from './page-my-todos';

type ContextItemTone = 'default' | 'primary' | 'focus' | 'supporting';

interface ContextItemOptions {
  hint?: string;
  tone?: ContextItemTone;
}

export function renderShell(): HTMLElement {
  return el('div', {
    class: `app-shell${ui.sidebarCollapsed ? ' sidebar-collapsed' : ''}`,
    children: [
      renderSidebar(),
      el('main', { class: 'main-shell', children: [renderTopbar(), renderPage()] }),
      expandedStreamRunId ? renderExpandedAgentStreamOverlay(expandedStreamRunId) : null,
    ],
  });
}

function pendingCount(): number {
  const awaitingClarification = data.requests.filter((r) => r.status === 'awaiting_clarification').length;
  const awaitingHuman = data.runs.filter((r) => r.status === 'awaiting_human').length;
  const failed = data.requests.filter((r) => r.status === 'failed').length;
  // 07-26 operational pause: paused requests wait on a manual resume — keep
  // this badge consistent with myTodos(), which also counts them.
  const paused = data.requests.filter((r) => r.status === 'paused').length;
  return awaitingClarification + awaitingHuman + failed + paused;
}

function renderSidebar(): HTMLElement {
  type NavItem = { page: Page; label: string; help: string; path: string; badge?: () => number } | { divider: true };

  const navItems: NavItem[] = [
    // 核心工作区
    { page: 'workbench', label: '工作台', help: '生命周期与人工确认', path: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6', badge: pendingCount },
    { page: 'my-todos', label: '我的待办', help: '需要我处理的任务', path: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4', badge: myTodosCount },
    { page: 'new-task', label: '新建任务', help: '说明想做什么', path: 'M12 4v16m8-8H4' },
    { page: 'reports', label: '任务报告', help: '交付证据汇总', path: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
    { divider: true },
    // 知识与配置
    { page: 'knowledge', label: '知识库', help: '候选与沉淀', path: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253' },
    { page: 'projects', label: '项目接入', help: '注册本地/远端 Git', path: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z' },
    { page: 'settings', label: '运行配置', help: '本地 worktree 模式', path: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
  ];

  const nav = el('nav', { class: 'nav-list' });
  for (const item of navItems) {
    if ('divider' in item) {
      nav.appendChild(el('div', { class: 'nav-divider' }));
      continue;
    }

    const badgeCount = item.badge?.() ?? 0;
    const navButton = el('button', {
      class: `nav-item ${ui.activePage === item.page ? 'active' : ''}`,
      attrs: { type: 'button' },
      children: [
        icon(item.path),
        el('span', {
          children: [el('strong', { text: item.label }), el('small', { text: item.help })],
        }),
        badgeCount > 0 ? el('span', { class: 'nav-badge', text: String(badgeCount) }) : null,
      ],
    });
    navButton.onclick = () => setHash(item.page);
    nav.appendChild(navButton);
  }

  // 侧边栏底部工具栏（深色模式 + 收起）
  const isDark = getResolvedTheme() === 'dark';
  const themeButton = el('button', {
    class: 'sidebar-footer-btn',
    attrs: { type: 'button', title: '切换深色/浅色模式' },
    children: [
      icon(isDark
        ? 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z'
        : 'M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z'
      ),
      el('span', { text: isDark ? '浅色模式' : '深色模式' }),
    ],
  });
  themeButton.onclick = () => {
    toggleTheme();
    render();
  };

  const collapseButton = el('button', {
    class: 'sidebar-footer-btn',
    attrs: { type: 'button', title: '收起侧边栏' },
    children: [
      icon('M15 19l-7-7 7-7'),
      el('span', { text: '收起' }),
    ],
  });
  collapseButton.onclick = () => {
    ui.sidebarCollapsed = true;
    document.querySelector('.app-shell')?.classList.add('sidebar-collapsed');
  };

  return el('aside', {
    class: 'sidebar',
    children: [
      el('div', {
        class: 'brand',
        children: [
          el('div', { class: 'brand-mark', children: [octopusIcon()] }),
          el('div', {
            children: [
              el('strong', { text: 'Octopus' }),
              el('span', { text: 'AI Delivery Workbench' }),
            ],
          }),
        ],
      }),
      nav,
      renderQueueSummary(),
      // 底部工具栏
      el('div', {
        class: 'sidebar-footer',
        children: [themeButton, collapseButton],
      }),
      // 侧边栏收起时显示的图标栏
      renderSidebarCollapsedIcons(),
    ],
  });
}

function renderQueueSummary(): HTMLElement {
  const pending = data.requests.filter((r) => r.status === 'pending').length;
  const claimed = data.requests.filter((r) => r.status === 'claimed').length;
  const last = data.requests[0];
  const control = data.runnerControl;
  return el('section', {
    class: 'sidebar-card sidebar-console',
    children: [
      el('h2', { text: '执行队列' }),
      el('div', {
        class: 'queue-console-grid',
        children: [
          renderQueueConsoleStat('等待开始', String(pending), 'info'),
          renderQueueConsoleStat(control?.running ? '自动排队中' : '等待执行器', String(claimed), control?.running ? 'warn' : 'muted'),
        ],
      }),
      last
        ? el('p', { class: 'muted compact queue-latest', text: `${shortId(last.id)} · ${last.status} · ${last.title}` })
        : el('p', { class: 'muted compact queue-latest', text: '暂无任务请求。' }),
      el('p', { class: 'muted compact', text: control?.running ? `Runner pid=${control.pid ?? '—'}` : 'Runner 未运行，UI 会尝试自动启动。' }),
    ],
  });
}

function renderQueueConsoleStat(label: string, value: string, kind: StatusKind): HTMLElement {
  return el('div', {
    class: `queue-console-stat ${kind}`,
    children: [
      el('span', { text: label }),
      el('strong', { text: value }),
    ],
  });
}

function renderGlobalStatusItem(label: string, value: string, kind: StatusKind): HTMLElement {
  return el('div', {
    class: `global-status-item ${kind}`,
    children: [
      el('span', { class: 'global-status-indicator', attrs: { 'aria-hidden': 'true' } }),
      el('span', {
        class: 'global-status-copy',
        children: [
          el('span', { class: 'global-status-label', text: label }),
          el('strong', { class: 'global-status-value', text: value }),
        ],
      }),
    ],
  });
}

function renderTopbar(): HTMLElement | null {
  const project = ui.activePage === 'new-task'
    ? activeProjects().find((p) => p.id === newTaskFormDraft.projectId) ?? activeProjects()[0] ?? null
    : selectedProject();
  const run = data.activeDetail?.run ?? data.runs[0] ?? null;
  const runner = latestRunner();
  const backend = agentBackendContextLabel(project);
  const newTaskReadiness = newTaskReadinessSummary(project, runner);
  const workbenchEnvironment = workbenchEnvironmentSummary(project, runner);
  const projectOnboarding = projectOnboardingSummary();
  const reportStatus = reportStatusSummary();
  const knowledgeStatus = knowledgeStatusSummary();
  const settingsRuntime = settingsRuntimeSummary(project, runner);

  // 全局状态统计
  const pending = pendingCount();
  const runningRuns = data.runs.filter((r) => r.status === 'running').length;
  const claimedRequests = data.requests.filter((r) => r.status === 'claimed').length;
  const running = runningRuns + claimedRequests;

  const contextItems = ui.activePage === 'new-task'
    ? [contextItem('创建准备', newTaskReadiness.value, newTaskReadiness.kind)]
    : ui.activePage === 'workbench'
      ? [contextItem('执行环境', workbenchEnvironment.value, workbenchEnvironment.kind)]
    : ui.activePage === 'my-todos'
      ? [] // 我的待办页面不显示上下文信息
    : ui.activePage === 'projects'
      ? [contextItem('接入状态', projectOnboarding.value, projectOnboarding.kind)]
    : ui.activePage === 'reports'
      ? [contextItem('交付状态', reportStatus.value, reportStatus.kind)]
    : ui.activePage === 'knowledge'
      ? [contextItem('知识状态', knowledgeStatus.value, knowledgeStatus.kind)]
    : ui.activePage === 'settings'
      ? [contextItem('运行状态', settingsRuntime.value, settingsRuntime.kind)]
    : taskExecutionContextItems(project, run, runner, backend);

  // 我的待办页面不显示 topbar
  if (ui.activePage === 'my-todos') {
    return null;
  }

  return el('header', {
    class: 'topbar',
    children: [
      el('div', {
        class: 'topbar-title',
        children: [
          el('span', { class: 'eyebrow', text: 'AI 软件交付工作台' }),
          el('h1', { text: titleForPage() }),
        ],
      }),
      el('div', {
        class: 'topbar-right',
        children: [
          el('div', {
            class: 'global-status-strip',
            attrs: { 'aria-live': 'polite' },
            children: [
              renderGlobalStatusItem('待处理', String(pending), pending > 0 ? 'bad' : 'muted'),
              renderGlobalStatusItem('运行中', String(running), running > 0 ? 'info' : 'muted'),
              renderGlobalStatusItem('系统状态', workbenchEnvironment.value, workbenchEnvironment.kind),
            ],
          }),
          el('div', {
            class: 'context-strip',
            children: contextItems,
          }),
        ],
      }),
    ],
  });
}

function newTaskReadinessSummary(project: ProjectDto | null, runner: RunnerDto | null): { value: string; kind: StatusKind } {
  if (ui.projectsLoadError) return { value: '项目加载失败', kind: 'bad' };
  if (!project) return { value: '需要连接项目', kind: 'warn' };
  if (!project.agentBackend) return { value: '需要配置执行方式', kind: 'warn' };
  const preflight = preflightForProjectBackend(project);
  if (preflight && !preflight.runnable) return { value: '执行方式需处理', kind: 'bad' };
  if (!runner) return { value: '可创建 · 执行器待启动', kind: 'warn' };
  return { value: '可创建', kind: 'good' };
}

function projectOnboardingSummary(): { value: string; kind: StatusKind } {
  if (ui.projectsLoadError) return { value: '项目加载失败', kind: 'bad' };
  if (!data.projects.length) return { value: '还没有项目', kind: 'warn' };

  const active = activeProjects();
  const available = active.filter((project) => projectAvailability(project).label === '可用').length;
  const pending = active.length - available;
  const archived = data.projects.length - active.length;
  const suffix = archived > 0 ? ` · ${archived} 个已归档` : '';
  const kind: StatusKind = available > 0 && pending === 0 ? 'good' : available > 0 ? 'warn' : 'warn';
  return { value: `${available} 个项目可用 · ${pending} 个待配置${suffix}`, kind };
}

function reportStatusSummary(): { value: string; kind: StatusKind } {
  const stats = reportStats(data.runs);
  if (stats.total === 0) return { value: '暂无报告', kind: 'muted' };
  if (stats.attention > 0) return { value: `${stats.attention} 个需处理`, kind: 'warn' };
  if (stats.running > 0) return { value: `${stats.running} 个执行中`, kind: 'info' };
  if (stats.acceptable > 0) return { value: `${stats.acceptable} 个可验收`, kind: 'good' };
  return { value: `${stats.total} 个报告`, kind: 'muted' };
}

function knowledgeStatusSummary(): { value: string; kind: StatusKind } {
  const project = selectedProject();
  if (!project) return { value: '需要连接项目', kind: 'warn' };
  if (knowledgeArtifactsState.error) return { value: '知识加载失败', kind: 'bad' };
  const detail = data.activeDetail;
  const suggestions = detail ? parsedKnowledge(detail) : [];
  const pending = detail ? knowledgeSuggestionItems(detail, suggestions).filter((item) => !item.decision).length : 0;
  if (pending > 0) return { value: `${pending} 条待确认`, kind: 'warn' };
  if (knowledgeArtifactsState.loading && knowledgeArtifactsState.projectId === project.id) {
    return { value: '正在加载知识', kind: 'info' };
  }
  const accepted = currentKnowledgeArtifacts().filter((artifact) => artifact.status === 'accepted').length;
  if (accepted > 0) return { value: `${accepted} 条已收录`, kind: 'good' };
  return { value: '等待沉淀', kind: 'muted' };
}

function settingsRuntimeSummary(project: ProjectDto | null, runner: RunnerDto | null): { value: string; kind: StatusKind } {
  if (settingsConfig.error) return { value: '配置加载失败', kind: 'bad' };
  if (settingsConfig.drafts.size > 0) return { value: `${settingsConfig.drafts.size} 项未保存`, kind: 'warn' };
  if (!project) return { value: '需要连接项目', kind: 'warn' };
  if (!project.agentBackend) return { value: '执行方式待配置', kind: 'warn' };
  const backend = agentBackendStatusForProject(project);
  if (backend.kind === 'bad') return { value: '执行方式需处理', kind: 'bad' };
  if (!runner) return { value: '执行器待启动', kind: 'warn' };
  return { value: '可运行', kind: 'good' };
}

function taskExecutionContextItems(
  project: ProjectDto | null,
  run: (typeof data.runs)[number] | null,
  runner: RunnerDto | null,
  backend: { value: string; kind: StatusKind },
): HTMLElement[] {
  const branch = run?.branch ?? project?.defaultBranch ?? '—';
  const readiness = taskExecutionReadiness(project, runner);
  const runnerLabel = runner ? runner.status : 'offline';
  const runnerKind = runner ? statusKind(runner.status) : 'bad';

  return [
    contextItem('当前项目', project?.name ?? '未接入项目', project ? 'info' : 'warn', {
      hint: `执行分支 ${branch}`,
      tone: 'primary',
    }),
    contextItem('运行就绪', readiness.value, readiness.kind, {
      hint: `Runner ${runnerLabel} · ${backend.value}`,
      tone: 'focus',
    }),
    contextItem('构建环境', buildEnvLabel(), runner ? 'good' : 'warn', {
      hint: runner ? `Runner ${runnerLabel}` : '等待 Runner 心跳',
      tone: runnerKind === 'bad' ? 'focus' : 'supporting',
    }),
  ];
}

function taskExecutionReadiness(project: ProjectDto | null, runner: RunnerDto | null): { value: string; kind: StatusKind } {
  if (!project) return { value: '需要接入项目', kind: 'warn' };
  if (!project.agentBackend) return { value: '需要配置 AI 后端', kind: 'warn' };
  if (!runner) return { value: 'Runner 待启动', kind: 'warn' };

  const backend = agentBackendStatusForProject(project);
  if (backend.kind === 'bad') return { value: 'AI 后端异常', kind: 'bad' };
  if (backend.kind === 'warn') return { value: 'AI 后端待处理', kind: 'warn' };
  if (backend.kind === 'muted') return { value: 'AI 后端待检测', kind: 'warn' };
  return { value: '可运行', kind: 'good' };
}

function titleForPage(): string {
  switch (ui.activePage) {
    case 'task':
      return activeTaskRequest()?.title ?? data.activeDetail?.run.title ?? '任务工作流';
    case 'projects':
      return '项目接入';
    case 'new-task':
      return '新建任务';
    case 'reports':
      return '交付报告';
    case 'knowledge':
      return '知识库';
    case 'settings':
      return '运行配置';
    default:
      return '工作台';
  }
}

function contextItem(label: string, value: string, kind: StatusKind, options: ContextItemOptions = {}): HTMLElement {
  return el('div', {
    class: `context-item ${options.tone ?? 'default'}`,
    children: [
      el('span', { text: label }),
      el('strong', { class: kind, text: value }),
      options.hint ? el('small', { text: options.hint }) : null,
    ],
  });
}

function renderPage(): HTMLElement {
  const notifications: HTMLElement[] = [];
  if (ui.lastError && ui.activePage !== 'new-task') {
    notifications.push(renderError(ui.lastError));
  }
  // Success messages now handled by toast notifications
  if (notifications.length > 0) {
    return el('section', { class: 'page-stack', children: [...notifications, renderCurrentPage()] });
  }
  return renderCurrentPage();
}

function renderCurrentPage(): HTMLElement {
  switch (ui.activePage) {
    case 'task':
      return renderTaskDetailPage();
    case 'my-todos':
      return renderMyTodosPage();
    case 'projects':
      return renderProjectsPage();
    case 'new-task':
      return renderNewTaskPage();
    case 'reports':
      return renderReportsPage();
    case 'knowledge':
      return renderKnowledgePage();
    case 'settings':
      return renderSettingsPage();
    default:
      return renderWorkbenchPage();
  }
}

function renderError(message: string): HTMLElement {
  return el('div', {
    class: 'notice bad',
    children: [el('strong', { text: '数据刷新失败' }), el('span', { text: message })],
  });
}

function renderSuccess(message: string): HTMLElement {
  return el('div', {
    class: 'notice good',
    children: [el('strong', { text: '操作成功' }), el('span', { text: message })],
  });
}

function renderExpandedAgentStreamOverlay(runId: string): HTMLElement {
  const view = buildAgentStreamViewForRun(runId);
  const titleId = 'stream-modal-title';
  const summaryId = 'stream-modal-summary';
  const closeButton = button('关闭', 'button secondary small');
  closeButton.dataset.streamClose = 'agent-stream';
  closeButton.setAttribute('aria-label', `关闭 ${view.title} 放大查看`);
  closeButton.onclick = closeExpandedStream;
  const overlay = el('div', {
    class: 'stream-overlay',
    attrs: {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
      'aria-describedby': summaryId,
    },
    children: [
      el('section', {
        class: 'stream-modal',
        children: [
          el('div', {
            class: 'stream-head stream-modal-head',
            children: [
              el('div', {
                children: [
                  el('span', { class: 'eyebrow', text: 'Recording View' }),
                  renderStreamTitle(view, titleId),
                  renderStreamSummary(view, summaryId),
                ],
              }),
              el('div', {
                class: 'stream-actions',
                children: [renderStreamVerbosityToggle(), renderStreamStatus(view), closeButton],
              }),
            ],
          }),
          renderAgentStreamBody(view, { expanded: true, scrollKeyPrefix: 'agent-stream-expanded' }),
        ],
      }),
    ],
  });
  overlay.onclick = (event) => {
    if (event.target === overlay) closeExpandedStream();
  };
  return overlay;
}

function renderSidebarCollapsedIcons(): HTMLElement {
  const navItems = [
    { page: 'workbench' as Page, label: '工作台', path: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6', badge: pendingCount },
    { page: 'my-todos' as Page, label: '我的待办', path: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4', badge: myTodosCount },
    { page: 'new-task' as Page, label: '新建任务', path: 'M12 4v16m8-8H4' },
    { page: 'reports' as Page, label: '任务报告', path: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
    { divider: true },
    { page: 'knowledge' as Page, label: '知识库', path: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253' },
    { page: 'projects' as Page, label: '项目接入', path: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z' },
    { page: 'settings' as Page, label: '运行配置', path: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
  ];

  const icons: HTMLElement[] = [];

  for (const item of navItems) {
    if ('divider' in item) {
      icons.push(el('div', { class: 'sidebar-collapsed-divider' }));
      continue;
    }

    const badgeCount = item.badge?.() ?? 0;
    const iconButton = el('button', {
      class: `sidebar-collapsed-icon-btn ${ui.activePage === item.page ? 'active' : ''}`,
      attrs: { type: 'button', title: item.label },
      children: [
        icon(item.path),
        badgeCount > 0 ? el('span', { class: 'nav-badge', text: String(badgeCount) }) : null,
      ],
    });
    iconButton.onclick = () => setHash(item.page);
    icons.push(iconButton);
  }

  // 底部：主题切换和展开按钮
  const isDark = getResolvedTheme() === 'dark';
  const themeIconButton = el('button', {
    class: 'sidebar-collapsed-icon-btn',
    attrs: { type: 'button', title: '切换深色/浅色模式' },
    children: [
      icon(isDark
        ? 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z'
        : 'M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z'
      ),
    ],
  });
  themeIconButton.onclick = () => {
    toggleTheme();
    render();
  };

  const expandButton = el('button', {
    class: 'sidebar-collapsed-icon-btn',
    attrs: { type: 'button', title: '展开侧边栏' },
    children: [icon('M9 5l7 7-7 7')],
  });
  expandButton.onclick = () => {
    ui.sidebarCollapsed = false;
    document.querySelector('.app-shell')?.classList.remove('sidebar-collapsed');
  };

  return el('div', {
    class: 'sidebar-collapsed-icons',
    children: [
      ...icons,
      el('div', { class: 'sidebar-collapsed-expand', children: [themeIconButton, expandButton] }),
    ],
  });
}
