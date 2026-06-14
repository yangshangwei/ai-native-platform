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

export function renderWorkbenchPage(): HTMLElement {
  return el('section', {
    class: 'page-grid',
    children: [
      renderWelcomeGuide(),
      renderWorkbenchActionPanel(),
      renderWorkbenchOverviewPanel(),
      renderTaskListPanel(),
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

type WorkbenchActionItem =
  | { kind: 'request'; request: WorkflowRequestDto; reason: string; actionLabel: string; statusLabel: string; statusKind: StatusKind }
  | { kind: 'run'; run: WorkflowRunDto; request: WorkflowRequestDto | null; reason: string; actionLabel: string; statusLabel: string; statusKind: StatusKind };

function requestActionLabel(status: WorkflowRequestDto['status']): string {
  if (status === 'awaiting_clarification') return '回答问题';
  if (status === 'completed') return '查看结果';
  if (status === 'failed') return '查看问题';
  if (status === 'cancelled') return '查看记录';
  return '查看进度';
}

function isRequestUserAction(request: WorkflowRequestDto): boolean {
  return request.status === 'awaiting_clarification' || request.status === 'failed';
}

function isRequestInProgress(request: WorkflowRequestDto): boolean {
  return request.status === 'pending' || request.status === 'claimed';
}

function workbenchActionItems(): WorkbenchActionItem[] {
  const requestActions: WorkbenchActionItem[] = data.requests
    .filter(isRequestUserAction)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((request) => ({
      kind: 'request' as const,
      request,
      reason: request.status === 'awaiting_clarification' ? 'AI 需要你补充信息后才能继续。' : '任务处理失败，需要查看原因。',
      actionLabel: requestActionLabel(request.status),
      statusLabel: requestStatusLabel(request.status),
      statusKind: statusKind(request.status),
    }));

  const runActions: WorkbenchActionItem[] = data.runs
    .filter((run) => run.status === 'awaiting_human')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((run) => ({
      kind: 'run' as const,
      run,
      request: data.requests.find((candidate) => candidate.workflowRunId === run.id) ?? null,
      reason: `${STAGE_LABELS[run.currentStage]} 等待你确认。`,
      actionLabel: '查看证据',
      statusLabel: '等待确认',
      statusKind: 'warn' as const,
    }));

  return [...requestActions, ...runActions];
}

function openWorkbenchAction(item: WorkbenchActionItem): void {
  if (item.kind === 'request') {
    setHash('task', item.request.id);
    return;
  }
  if (item.request) setHash('task', item.request.id);
  else setHash('workbench', item.run.id);
}

function renderWorkbenchActionPanel(): HTMLElement {
  const actions = workbenchActionItems();
  if (!actions.length) {
    return el('section', {
      class: 'panel workbench-action-panel empty-action-panel',
      children: [
        panelHeader('需要我处理', '暂无需要你处理的任务。'),
        el('p', { class: 'muted compact', text: 'AI 会继续推进运行中的任务；你也可以创建一个新任务。' }),
        el('div', { class: 'button-row', children: [actionLink('新建任务', 'new-task')] }),
      ],
    });
  }

  const primary = actions[0]!;
  const open = button(primary.actionLabel, 'button primary');
  open.onclick = () => openWorkbenchAction(primary);
  const title = primary.kind === 'request' ? primary.request.title : primary.run.title;
  const meta = primary.kind === 'request'
    ? `${projectName(primary.request.projectId)} · ${fmtTime(primary.request.updatedAt)}`
    : `${projectName(primary.run.projectId)} · ${fmtTime(primary.run.createdAt)}`;
  return el('section', {
    class: 'panel workbench-action-panel',
    children: [
      panelHeader('需要我处理', `${actions.length} 个任务等待你的输入或确认。`),
      el('article', {
        class: 'workbench-primary-action',
        children: [
          el('div', {
            class: 'workbench-primary-copy',
            children: [
              pill(primary.statusLabel, primary.statusKind),
              el('strong', { text: title }),
              el('p', { class: 'muted compact', text: primary.reason }),
              el('small', { text: meta }),
            ],
          }),
          open,
        ],
      }),
      actions.length > 1
        ? el('div', {
            class: 'workbench-secondary-actions',
            children: actions.slice(1, 4).map((item) => {
              const secondaryOpen = button(item.actionLabel, 'button secondary small');
              secondaryOpen.onclick = () => openWorkbenchAction(item);
              return el('div', {
                class: 'mini-row',
                children: [
                  el('span', { text: item.kind === 'request' ? item.request.title : item.run.title }),
                  secondaryOpen,
                ],
              });
            }),
          })
        : null,
    ],
  });
}

function renderWorkbenchOverviewPanel(): HTMLElement {
  const actions = workbenchActionItems();
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
            '需要处理',
            String(actions.length),
            'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
            actions.length > 0 ? 'warning' : 'success',
            actions.length > 0 ? '等待你的输入或确认' : '暂无待处理任务',
          ),
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

function renderWorkbenchStatCard(title: string, count: number, emptyText: string, items: string[], kind: StatusKind): HTMLElement {
  return el('article', {
    class: 'overview-card workbench-stat-card',
    children: [
      el('div', { class: 'overview-card-head', children: [el('strong', { text: title }), pill(String(count), kind)] }),
      items.length
        ? el('div', {
            class: 'stack',
            children: items.slice(0, 3).map((item) => el('div', { class: 'mini-row', children: [el('span', { text: item })] })),
          })
        : el('p', { class: 'muted compact', text: emptyText }),
    ],
  });
}

function renderTaskListPanel(): HTMLElement {
  const latestRequests = [...data.requests].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const needsAction = latestRequests.filter(isRequestUserAction);
  const inProgress = latestRequests.filter(isRequestInProgress);
  const completed = latestRequests.filter((request) => request.status === 'completed');
  return el('section', {
    class: 'panel',
    children: [
      panelHeader('任务列表', '按你最常处理的工作状态分组。'),
      renderTaskListSection('需要处理', needsAction, '暂无需要你处理的任务。'),
      renderTaskListSection('进行中', inProgress, '暂无进行中的任务。'),
      renderTaskListSection('已完成', completed, '暂无已完成的任务。', 5),
      latestRequests.length
        ? el('details', {
            class: 'raw-details workbench-all-tasks',
            attrs: { 'data-details-key': 'workbench-all-tasks' },
            children: [
              el('summary', { text: `全部任务 (${latestRequests.length})` }),
              renderTaskListSection('', latestRequests.slice(0, 12), '暂无任务。'),
            ],
          })
        : null,
    ],
  });
}

function renderTaskListSection(title: string, requests: WorkflowRequestDto[], emptyText: string, limit = 8): HTMLElement {
  return el('section', {
    class: 'workbench-task-section',
    children: [
      title ? el('div', { class: 'workbench-section-head', children: [el('h3', { text: title }), pill(String(requests.length), requests.length ? 'info' : 'muted')] }) : null,
      requests.length
        ? el('div', { class: 'task-list', children: requests.slice(0, limit).map(renderTaskListItem) })
        : el('p', { class: 'muted compact', text: emptyText }),
    ],
  });
}

function renderTaskListItem(request: WorkflowRequestDto): HTMLElement {
  const open = button(requestActionLabel(request.status), 'button secondary small');
  open.onclick = () => setHash('task', request.id);
  return el('article', {
    class: 'task-list-item',
    children: [
      el('div', {
        class: 'task-list-main',
        children: [
          el('strong', { text: request.title }),
          el('small', { text: `${projectName(request.projectId)} · ${fmtTime(request.updatedAt)}` }),
        ],
      }),
      pill(requestStatusLabel(request.status), statusKind(request.status)),
      open,
    ],
  });
}

function renderRunListItem(run: WorkflowRunDto): HTMLElement {
  const request = data.requests.find((candidate) => candidate.workflowRunId === run.id);
  const item = el('button', {
    class: `run-item ${run.id === ui.activeRunId ? 'active' : ''}`,
    attrs: { type: 'button' },
    children: [
      el('strong', { text: run.title }),
      el('span', { text: `${projectName(run.projectId)} · ${STAGE_LABELS[run.currentStage]}` }),
      pill(run.status),
    ],
  });
  item.onclick = () => (request ? setHash('task', request.id) : setHash('workbench', run.id));
  return item;
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

function renderRunsPanel(): HTMLElement {
  return el('section', {
    class: 'panel side-panel',
    children: [
      panelHeader('Runs', '最新工作流'),
      el('div', {
        class: 'run-list',
        children: data.runs.slice(0, 12).map(renderRunListItem),
      }),
    ],
  });
}
