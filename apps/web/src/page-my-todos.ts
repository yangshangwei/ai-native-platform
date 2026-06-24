/**
 * My Todos page — personal task inbox for action items.
 *
 * Displays tasks that need user attention: awaiting_clarification or failed
 * status. Supports filtering by status/project and sorting by time.
 * Complements the workbench overview page by focusing on execution rather
 * than trends.
 */

import type { WorkflowRequestDto } from './types';
import { button, el, fmtTime, panelHeader, pill, statusKind } from './dom';
import { data, myTodos, projectName, requestStatusLabel } from './state';
import { setHash } from './router';
import { render } from './render-core';

type TodoFilter = 'all' | 'awaiting_clarification' | 'failed';
type TodoSort = 'newest' | 'oldest';

// Page-private state
let currentFilter: TodoFilter = 'all';
let currentProjectFilter: string | null = null;
let currentSort: TodoSort = 'newest';

export function renderMyTodosPage(): HTMLElement {
  const todos = getFilteredTodos();
  const allProjects = [...new Set(data.requests.map((r) => r.projectId))];

  return el('section', {
    class: 'page-grid',
    children: [
      renderPageHeader(todos.length),
      renderFilters(allProjects),
      todos.length > 0 ? renderTodoList(todos) : renderEmptyState(),
    ],
  });
}

function renderPageHeader(count: number): HTMLElement {
  return el('section', {
    class: 'panel my-todos-header',
    children: [
      el('div', {
        class: 'my-todos-header-content',
        children: [
          el('div', {
            children: [
              el('h1', { class: 'page-title', text: '我的待办' }),
              el('p', {
                class: 'muted compact',
                text: '这里显示所有需要你补充信息或处理失败的任务。',
              }),
            ],
          }),
          el('div', {
            class: 'my-todos-count-badge',
            children: [
              el('span', { class: 'count-number', text: String(count) }),
              el('span', { class: 'count-label', text: '个待办' }),
            ],
          }),
        ],
      }),
    ],
  });
}

function renderFilters(allProjects: string[]): HTMLElement {
  return el('section', {
    class: 'panel todos-filters',
    children: [
      el('div', {
        class: 'filter-group',
        children: [
          el('label', { text: '状态：' }),
          renderFilterButton('全部', 'all', currentFilter),
          renderFilterButton('等待补充信息', 'awaiting_clarification', currentFilter),
          renderFilterButton('失败', 'failed', currentFilter),
        ],
      }),
      allProjects.length > 1
        ? el('div', {
            class: 'filter-group',
            children: [
              el('label', { text: '项目：' }),
              renderProjectFilterButton('全部项目', null),
              ...allProjects.map((projectId) => renderProjectFilterButton(projectName(projectId), projectId)),
            ],
          })
        : null,
      el('div', {
        class: 'filter-group',
        children: [
          el('label', { text: '排序：' }),
          renderSortButton('最新更新', 'newest'),
          renderSortButton('最早更新', 'oldest'),
        ],
      }),
    ],
  });
}

function renderFilterButton(label: string, filter: TodoFilter, current: TodoFilter): HTMLButtonElement {
  const btn = button(label, filter === current ? 'small primary' : 'small secondary');
  btn.onclick = () => {
    currentFilter = filter;
    rerenderTodosPage();
  };
  return btn;
}

function renderProjectFilterButton(label: string, projectId: string | null): HTMLButtonElement {
  const btn = button(label, projectId === currentProjectFilter ? 'small primary' : 'small secondary');
  btn.onclick = () => {
    currentProjectFilter = projectId;
    rerenderTodosPage();
  };
  return btn;
}

function renderSortButton(label: string, sort: TodoSort): HTMLButtonElement {
  const btn = button(label, sort === currentSort ? 'small primary' : 'small secondary');
  btn.onclick = () => {
    currentSort = sort;
    rerenderTodosPage();
  };
  return btn;
}

function renderTodoList(todos: WorkflowRequestDto[]): HTMLElement {
  return el('section', {
    class: 'panel',
    children: [
      el('div', {
        class: 'my-todos-list',
        children: todos.map(renderTodoItem),
      }),
    ],
  });
}

function renderTodoItem(request: WorkflowRequestDto): HTMLElement {
  const openBtn = button('查看详情', 'button primary small');
  openBtn.onclick = () => setHash('task', request.id);

  return el('article', {
    class: 'my-todos-item',
    children: [
      pill(requestStatusLabel(request.status), statusKind(request.status)),
      el('div', {
        class: 'my-todos-item-main',
        children: [
          el('strong', { class: 'my-todos-item-title', text: request.title }),
          el('div', {
            class: 'my-todos-item-meta',
            children: [
              el('span', { class: 'meta-item', text: projectName(request.projectId) }),
              el('span', { class: 'meta-separator', text: '·' }),
              el('span', { class: 'meta-item', text: fmtTime(request.updatedAt) }),
            ],
          }),
        ],
      }),
      openBtn,
    ],
  });
}

function renderEmptyState(): HTMLElement {
  return el('section', {
    class: 'panel empty-state',
    children: [
      el('div', {
        class: 'empty-state-icon',
        text: '🎉',
      }),
      el('h3', { class: 'empty-state-title', text: '暂无待办任务' }),
      el('p', { class: 'empty-state-description', text: 'AI 会继续推进运行中的任务；你也可以创建一个新任务。' }),
      el('div', {
        class: 'button-row',
        children: [
          (() => {
            const btn = button('新建任务', 'button primary');
            btn.onclick = () => setHash('new-task');
            return btn;
          })(),
          (() => {
            const btn = button('查看工作台', 'button secondary');
            btn.onclick = () => setHash('workbench');
            return btn;
          })(),
        ],
      }),
    ],
  });
}

function getFilteredTodos(): WorkflowRequestDto[] {
  let todos = myTodos();

  // Filter by status
  if (currentFilter !== 'all') {
    todos = todos.filter((r) => r.status === currentFilter);
  }

  // Filter by project
  if (currentProjectFilter) {
    todos = todos.filter((r) => r.projectId === currentProjectFilter);
  }

  // Sort by time
  todos.sort((a, b) => {
    const aTime = new Date(a.updatedAt).getTime();
    const bTime = new Date(b.updatedAt).getTime();
    return currentSort === 'newest' ? bTime - aTime : aTime - bTime;
  });

  return todos;
}

function rerenderTodosPage(): void {
  // Trigger a full re-render
  render();
}
