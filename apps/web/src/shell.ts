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
import { button, el, icon, metric, shortId, statusKind } from './dom';
import {
  activeProjects,
  activeTaskRequest,
  agentBackendContextLabel,
  agentBackendStatusForProject,
  buildEnvLabel,
  data,
  latestRunner,
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

export function renderShell(): HTMLElement {
  return el('div', {
    class: 'app-shell',
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
  return awaitingClarification + awaitingHuman + failed;
}

function renderSidebar(): HTMLElement {
  type NavItem = { page: Page; label: string; help: string; path: string; badge?: () => number } | { divider: true };

  const navItems: NavItem[] = [
    // 核心工作区
    { page: 'workbench', label: '工作台', help: '生命周期与人工确认', path: 'M4 6h16M4 12h10M4 18h16', badge: pendingCount },
    { page: 'new-task', label: '新建任务', help: '说明想做什么', path: 'M12 5v14M5 12h14' },
    { page: 'reports', label: '任务报告', help: '交付证据汇总', path: 'M7 3h7l5 5v13H7zM14 3v6h6' },
    { divider: true },
    // 知识与配置
    { page: 'knowledge', label: '知识库', help: '候选与沉淀', path: 'M4 19V5a2 2 0 012-2h12v16H6a2 2 0 01-2-2zM8 7h8M8 11h8M8 15h5' },
    { page: 'projects', label: '项目接入', help: '注册本地/远端 Git', path: 'M3 7h18M6 7v12h12V7M9 7V5h6v2' },
    { page: 'settings', label: '运行配置', help: '本地 worktree 模式', path: 'M12 8a4 4 0 100 8 4 4 0 000-8zM4 12h2m12 0h2M12 4v2m0 12v2' },
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

  // Theme toggle button
  const isDark = getResolvedTheme() === 'dark';
  const themeButton = el('button', {
    class: 'nav-item',
    attrs: { type: 'button', title: '切换深色/浅色模式' },
    children: [
      icon(isDark
        ? 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z'
        : 'M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z'
      ),
      el('span', {
        children: [
          el('strong', { text: isDark ? '浅色模式' : '深色模式' }),
          el('small', { text: '切换主题' }),
        ],
      }),
    ],
  });
  themeButton.onclick = () => {
    toggleTheme();
    render(); // Re-render to update icon
  };
  nav.appendChild(themeButton);

  return el('aside', {
    class: 'sidebar',
    children: [
      el('div', {
        class: 'brand',
        children: [
          el('div', { class: 'brand-mark', text: 'AI' }),
          el('div', {
            children: [
              el('strong', { text: 'AI Native Platform' }),
              el('span', { text: 'Delivery Workbench' }),
            ],
          }),
        ],
      }),
      nav,
      renderQueueSummary(),
    ],
  });
}

function renderQueueSummary(): HTMLElement {
  const pending = data.requests.filter((r) => r.status === 'pending').length;
  const claimed = data.requests.filter((r) => r.status === 'claimed').length;
  const last = data.requests[0];
  const control = data.runnerControl;
  return el('section', {
    class: 'sidebar-card',
    children: [
      el('h2', { text: '自动执行' }),
      el('div', {
        class: 'queue-stats',
        children: [
          metric('等待开始', String(pending), control?.running ? '自动排队中' : '等待执行器', 'info'),
          metric('执行中', String(claimed), 'AI 正在处理', 'warn'),
        ],
      }),
      last
        ? el('p', { class: 'muted compact', text: `${shortId(last.id)} · ${last.status} · ${last.title}` })
        : el('p', { class: 'muted compact', text: '暂无任务请求。' }),
      el('p', { class: 'muted compact', text: control?.running ? `Runner pid=${control.pid ?? '—'}` : 'UI 会尝试自动启动 Runner；命令行仅作兜底。' }),
    ],
  });
}

function renderGlobalStatusBadge(label: string, count: number, kind: StatusKind): HTMLElement {
  return el('div', {
    class: `global-status-badge ${kind}`,
    children: [
      el('span', { class: 'status-badge-count', text: String(count) }),
      el('span', { class: 'status-badge-label', text: label }),
    ],
  });
}

function renderTopbar(): HTMLElement {
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
    : ui.activePage === 'projects'
      ? [contextItem('接入状态', projectOnboarding.value, projectOnboarding.kind)]
    : ui.activePage === 'reports'
      ? [contextItem('交付状态', reportStatus.value, reportStatus.kind)]
    : ui.activePage === 'knowledge'
      ? [contextItem('知识状态', knowledgeStatus.value, knowledgeStatus.kind)]
    : ui.activePage === 'settings'
      ? [contextItem('运行状态', settingsRuntime.value, settingsRuntime.kind)]
    : [
        contextItem('Project', project?.name ?? '未接入', 'info'),
        contextItem('Branch', run?.branch ?? project?.defaultBranch ?? '—', 'muted'),
        contextItem('Runner', runner ? runner.status : 'offline', runner ? statusKind(runner.status) : 'bad'),
        contextItem('Agent Backend', backend.value, backend.kind),
        contextItem('Build Env', buildEnvLabel(), runner ? 'good' : 'warn'),
      ];

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
            children: [
              pending > 0 ? renderGlobalStatusBadge('待处理', pending, 'bad') : null,
              running > 0 ? renderGlobalStatusBadge('运行中', running, 'info') : null,
              renderGlobalStatusBadge(workbenchEnvironment.value, 0, workbenchEnvironment.kind),
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

function contextItem(label: string, value: string, kind: StatusKind): HTMLElement {
  return el('div', {
    class: 'context-item',
    children: [el('span', { text: label }), el('strong', { class: kind, text: value })],
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
                children: [renderStreamStatus(view), closeButton],
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
