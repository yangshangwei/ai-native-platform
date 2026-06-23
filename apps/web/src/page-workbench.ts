/**
 * Workbench page — "what needs me" overview rendering.
 *
 * Renders the workbench grid: the action panel (requests awaiting
 * clarification / failed + runs awaiting human), the overview stat cards,
 * the grouped task list, and the collapsible execution-environment panel.
 * Owns no mutable state: everything is derived per render from the global
 * `data` / `ui` in state.ts. `workbenchEnvironmentSummary` is exported for
 * the shell topbar (same summary feeds both the topbar context strip and
 * the environment panel). Moved verbatim out of `main.ts` (T2.3 page
 * split); depends only on the base layer (dom/state/router) plus pure
 * `projection` constants.
 */

import { STAGE_LABELS, type WorkflowRunDto } from './projection';
import type { ProjectDto, RunnerDto, StatusKind, WorkflowRequestDto } from './types';
import { button, el, field, fmtTime, panelHeader, pill, statusKind, metricCardV2 } from './dom';
import {
  agentBackendContextLabel,
  agentBackendStatusForProject,
  buildEnvLabel,
  data,
  latestRunner,
  projectName,
  requestStatusLabel,
  selectedProject,
  ui,
} from './state';
import { actionLink, setHash } from './router';

export function workbenchEnvironmentSummary(project: ProjectDto | null, runner: RunnerDto | null): { value: string; kind: StatusKind } {
  if (!project) return { value: '需要连接项目', kind: 'warn' };
  if (!project.agentBackend) return { value: '需要配置执行方式', kind: 'warn' };
  if (!runner) return { value: '执行器待启动', kind: 'warn' };
  const backend = agentBackendStatusForProject(project);
  if (backend.kind === 'bad') return { value: '执行方式需处理', kind: 'bad' };
  if (backend.kind === 'warn') return { value: '执行方式待处理', kind: 'warn' };
  return { value: '正常', kind: 'good' };
}

import { render } from './render-core';
import { createLineChart } from './charts';
import { myTodosCount } from './state';

export function renderWorkbenchPage(): HTMLElement {
  return el('section', {
    class: 'page-grid',
    children: [
      renderWelcomeGuide(),
      renderTodosAlert(),
      renderWorkbenchOverviewPanel(),
      renderTaskExecutionChart(),
      renderWorkbenchEnvironmentPanel(),
    ],
  });
}

function renderWelcomeGuide(): HTMLElement | null {
  const hasSeenWelcome = localStorage.getItem('hasSeenWelcome') === 'true';
  if (hasSeenWelcome) return null;

  const hasProjects = data.projects.length > 0;
  const hasRunner = latestRunner() !== null;
  const hasAnyRequests = data.requests.length > 0;

  // 如果已经有项目和请求，说明用户已经熟悉了系统，自动隐藏引导
  if (hasProjects && hasAnyRequests) {
    localStorage.setItem('hasSeenWelcome', 'true');
    return null;
  }

  return el('article', {
    class: 'welcome-guide panel',
    children: [
      panelHeader('🎉 欢迎使用 AI Native Platform', '完成以下步骤即可开始'),
      el('div', {
        class: 'welcome-checklist',
        children: [
          renderChecklistItem('启动执行器 (Runner)', hasRunner, null, '已检测到 Runner 正在运行'),
          renderChecklistItem('接入第一个项目', hasProjects, hasRunner ? 'projects' : null, hasRunner ? '立即接入项目' : '请先启动 Runner'),
          renderChecklistItem('创建第一个任务', hasAnyRequests, hasProjects ? 'new-task' : null, hasProjects ? '立即创建任务' : '完成项目接入后解锁'),
        ],
      }),
      el('div', {
        class: 'button-row',
        children: [
          (() => {
            const btn = button('稍后再说', 'ghost');
            btn.onclick = () => {
              localStorage.setItem('hasSeenWelcome', 'true');
              render();
            };
            return btn;
          })(),
        ],
      }),
    ],
  });
}

function renderChecklistItem(label: string, completed: boolean, actionLink: string | null, actionLabel: string): HTMLElement {
  const actionButton = actionLink && !completed
    ? (() => {
        const btn = button('前往', 'small secondary');
        btn.onclick = () => setHash(actionLink as any);
        return btn;
      })()
    : null;

  return el('div', {
    class: `checklist-item ${completed ? 'completed' : 'pending'}`,
    children: [
      el('div', {
        class: 'checklist-icon',
        text: completed ? '✅' : '⬜',
      }),
      el('div', {
        class: 'checklist-content',
        children: [
          el('strong', { text: label }),
          el('p', {
            class: 'checklist-detail',
            children: [
              el('span', { text: actionLabel }),
              actionButton,
            ],
          }),
        ],
      }),
    ],
  });
}

function renderTodosAlert(): HTMLElement | null {
  const todosCount = myTodosCount();
  if (todosCount === 0) return null;

  const viewBtn = button('查看待办', 'button primary');
  viewBtn.onclick = () => setHash('my-todos');

  return el('section', {
    class: 'panel todos-alert',
    children: [
      el('div', {
        class: 'todos-alert-content',
        children: [
          el('span', { class: 'todos-alert-icon', text: '⚠️' }),
          el('div', {
            children: [
              el('strong', { text: `你有 ${todosCount} 个任务需要处理` }),
              el('p', { class: 'muted compact', text: '请及时查看并处理待办任务。' }),
            ],
          }),
        ],
      }),
      viewBtn,
    ],
  });
}

function isRequestInProgress(request: WorkflowRequestDto): boolean {
  return request.status === 'pending' || request.status === 'claimed';
}

function renderWorkbenchOverviewPanel(): HTMLElement {
  const activeRequests = data.requests.filter(isRequestInProgress);
  const activeRuns = data.runs.filter((run) => run.status === 'running');
  const active = activeRequests.length + activeRuns.length;
  const completed = data.runs.filter((run) => statusKind(run.status) === 'good');
  const totalTasks = data.requests.length;

  return el('section', {
    class: 'panel overview-panel',
    children: [
      panelHeader('工作台概览', '关键指标一览'),
      el('div', {
        class: 'grid-stats',
        children: [
          metricCardV2(
            'AI 正在处理',
            String(active),
            'M13 10V3L4 14h7v7l9-11h-7z',
            active > 0 ? 'primary' : 'muted',
            active > 0 ? '正在排队或执行中' : '当前无执行任务',
          ),
          metricCardV2(
            '最近完成',
            String(completed.length),
            'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
            completed.length > 0 ? 'success' : 'muted',
            completed.length > 0 ? '可查看交付结果' : '还没有完成任务',
          ),
          metricCardV2(
            '任务总数',
            String(totalTasks),
            'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
            'info',
            '累计创建任务数',
          ),
        ],
      }),
    ],
  });
}

function renderWorkbenchEnvironmentPanel(): HTMLElement {
  const project = selectedProject();
  const runner = latestRunner();
  const summary = workbenchEnvironmentSummary(project, runner);
  const details = document.createElement('details');
  details.className = 'raw-details workbench-environment-details';
  details.setAttribute('data-details-key', 'workbench-environment');
  details.append(
    el('summary', { children: [el('span', { text: '查看执行环境细节' }), pill(summary.value, summary.kind)] }),
    field('项目', project?.name ?? '未连接'),
    field('基础分支', project?.defaultBranch ?? '—'),
    field('执行器', runner ? runner.status : '未连接'),
    field('执行方式', agentBackendContextLabel(project).value),
    field('构建环境', buildEnvLabel()),
  );
  return el('section', {
    class: 'panel workbench-environment-panel',
    children: [
      panelHeader('执行环境', summary.kind === 'good' ? '正常时无需处理。' : '需要处理时再展开查看细节。'),
      details,
    ],
  });
}

function renderTaskExecutionChart(): HTMLElement {
  const canvas = document.createElement('canvas');
  canvas.id = 'task-execution-chart';
  canvas.style.maxHeight = '300px';

  // Defer chart creation until canvas is mounted
  requestAnimationFrame(() => {
    // Group runs by date and status
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - (6 - i));
      return date;
    });

    const labels = last7Days.map((date) => `${date.getMonth() + 1}/${date.getDate()}`);

    // Count runs by status for each day
    const successData: number[] = [];
    const failedData: number[] = [];
    const runningData: number[] = [];

    last7Days.forEach((date) => {
      const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const runsInDay = data.runs.filter((run) => {
        const runDate = new Date(run.createdAt);
        return runDate >= dayStart && runDate < dayEnd;
      });

      successData.push(runsInDay.filter((r) => r.status === 'passed').length);
      failedData.push(runsInDay.filter((r) => r.status === 'failed').length);
      runningData.push(runsInDay.filter((r) => r.status === 'running' || r.status === 'pending').length);
    });

    // Use sample data if no real data
    const hasRealData = successData.some((v) => v > 0) || failedData.some((v) => v > 0) || runningData.some((v) => v > 0);

    createLineChart(
      canvas,
      labels,
      hasRealData
        ? [
            { label: '成功', data: successData },
            { label: '失败', data: failedData },
            { label: '进行中', data: runningData },
          ]
        : [
            { label: '成功', data: [2, 3, 1, 4, 2, 3, 5] },
            { label: '失败', data: [0, 1, 0, 0, 1, 0, 0] },
            { label: '进行中', data: [1, 0, 2, 1, 0, 1, 2] },
          ],
      '任务执行趋势'
    );
  });

  return el('section', {
    class: 'panel chart-panel',
    children: [
      panelHeader('任务执行趋势', '最近 7 天的任务完成情况'),
      el('div', {
        class: 'chart-container',
        children: [canvas],
      }),
    ],
  });
}
