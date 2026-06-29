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
  myTodos,
  projectName,
  requestStatusLabel,
  selectedProject,
} from './state';
import { setHash } from './router';

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

interface WorkbenchActionItem {
  title: string;
  meta: string;
  statusLabel: string;
  statusKind: StatusKind;
  actionLabel: string;
  onClick: () => void;
}

export interface TaskTrendSeries {
  labels: string[];
  datasets: Array<{ label: string; data: number[] }>;
  hasRealData: boolean;
}

export function renderWorkbenchPage(): HTMLElement {
  return el('section', {
    class: 'page-grid',
    children: [
      renderWelcomeGuide(),
      renderWorkbenchActionQueue(),
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

function renderWorkbenchActionQueue(): HTMLElement {
  const items = buildWorkbenchActionItems();
  if (items.length === 0) return renderEmptyActionQueue();

  return el('section', {
    class: 'panel action-queue-panel',
    children: [
      el('div', {
        class: 'action-queue-head',
        children: [
          el('div', {
            children: [
              el('span', { class: 'eyebrow', text: 'Action Queue' }),
              el('h2', { text: `${items.length} 个需要处理` }),
              el('p', { class: 'muted compact', text: '优先处理人工确认、补充信息和失败任务。' }),
            ],
          }),
          (() => {
            const btn = button('查看全部', 'button secondary small');
            btn.onclick = () => setHash('my-todos');
            return btn;
          })(),
        ],
      }),
      el('div', {
        class: 'action-queue-list',
        children: items.slice(0, 4).map(renderWorkbenchActionItem),
      }),
    ],
  });
}

function buildWorkbenchActionItems(): WorkbenchActionItem[] {
  const requestItems = myTodos()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map<WorkbenchActionItem>((request) => ({
      title: request.title,
      meta: `${projectName(request.projectId)} · ${fmtTime(request.updatedAt)}`,
      statusLabel: requestStatusLabel(request.status),
      statusKind: statusKind(request.status),
      actionLabel: request.status === 'awaiting_clarification' ? '补充信息' : '查看失败',
      onClick: () => setHash('task', request.id),
    }));

  const runItems = data.runs
    .filter((run) => run.status === 'awaiting_human' || run.status === 'failed')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map<WorkbenchActionItem>((run) => ({
      title: run.title,
      meta: `${projectName(run.projectId)} · ${STAGE_LABELS[run.currentStage] ?? run.currentStage} · ${fmtTime(run.createdAt)}`,
      statusLabel: run.status === 'awaiting_human' ? '等待你确认' : '执行失败',
      statusKind: statusKind(run.status),
      actionLabel: run.status === 'awaiting_human' ? '处理确认' : '查看证据',
      onClick: () => setHash('workbench', run.id),
    }));

  return [...runItems, ...requestItems].slice(0, 5);
}

function renderWorkbenchActionItem(item: WorkbenchActionItem): HTMLElement {
  const action = button(item.actionLabel, 'button primary small');
  action.onclick = item.onClick;

  return el('article', {
    class: `action-queue-item ${item.statusKind}`,
    children: [
      pill(item.statusLabel, item.statusKind),
      el('div', {
        class: 'action-queue-copy',
        children: [
          el('strong', { text: item.title }),
          el('small', { text: item.meta }),
        ],
      }),
      action,
    ],
  });
}

function renderEmptyActionQueue(): HTMLElement {
  const createBtn = button('新建任务', 'button primary small');
  createBtn.onclick = () => setHash('new-task');

  return el('section', {
    class: 'panel action-queue-panel empty-action-panel',
    children: [
      el('div', {
        class: 'action-queue-head',
        children: [
          el('div', {
            children: [
              el('span', { class: 'eyebrow', text: 'Action Queue' }),
              el('h2', { text: '没有待处理事项' }),
              el('p', { class: 'muted compact', text: '运行正常时保持安静；有确认、失败或澄清时会置顶。' }),
            ],
          }),
          createBtn,
        ],
      }),
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
            () => setHash('my-todos'),
          ),
          metricCardV2(
            '最近完成',
            String(completed.length),
            'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
            completed.length > 0 ? 'success' : 'muted',
            completed.length > 0 ? '可查看交付结果' : '还没有完成任务',
            () => setHash('reports'),
          ),
          metricCardV2(
            '任务总数',
            String(totalTasks),
            'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
            'info',
            '累计创建任务数',
            () => setHash('reports'),
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
  const trend = buildTaskTrendSeries(data.runs);
  if (!trend.hasRealData) {
    return el('section', {
      class: 'panel chart-panel trend-empty-panel',
      children: [
        panelHeader('任务执行趋势', '最近 7 天暂无真实任务数据'),
        el('div', {
          class: 'trend-empty-state',
          children: [
            el('strong', { text: '等待真实执行数据' }),
            el('p', { class: 'muted compact', text: '不会用示例数据伪装趋势；任务完成、失败或运行后这里会自动生成图表。' }),
          ],
        }),
      ],
    });
  }

  const canvas = document.createElement('canvas');
  canvas.id = 'task-execution-chart';
  canvas.style.maxHeight = '300px';

  requestAnimationFrame(() => {
    createLineChart(canvas, trend.labels, trend.datasets, '任务执行趋势');
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

export function buildTaskTrendSeries(runs: WorkflowRunDto[], now = new Date()): TaskTrendSeries {
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(now);
    date.setDate(date.getDate() - (6 - i));
    return date;
  });

  const labels = last7Days.map((date) => `${date.getMonth() + 1}/${date.getDate()}`);
  const successData: number[] = [];
  const failedData: number[] = [];
  const runningData: number[] = [];

  last7Days.forEach((date) => {
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const runsInDay = runs.filter((run) => {
      const runDate = new Date(run.createdAt);
      return runDate >= dayStart && runDate < dayEnd;
    });

    successData.push(runsInDay.filter((run) => run.status === 'passed').length);
    failedData.push(runsInDay.filter((run) => run.status === 'failed').length);
    runningData.push(runsInDay.filter((run) => run.status === 'running' || run.status === 'pending').length);
  });

  const datasets = [
    { label: '成功', data: successData },
    { label: '失败', data: failedData },
    { label: '进行中', data: runningData },
  ];

  return {
    labels,
    datasets,
    hasRealData: datasets.some((dataset) => dataset.data.some((value) => value > 0)),
  };
}
