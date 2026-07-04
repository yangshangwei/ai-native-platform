import { Window } from 'happy-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { renderShell } from '../src/shell';
import { data, ui, agentBackendPreflight } from '../src/state';
import type { WorkflowRunDto } from '../src/projection';
import type { ProjectDto, WorkflowRequestDto } from '../src/types';

const testWindow = new Window();
globalThis.window = testWindow as unknown as Window & typeof globalThis;
globalThis.document = testWindow.document as unknown as Document;
globalThis.HTMLElement = testWindow.HTMLElement;
globalThis.HTMLDetailsElement = testWindow.HTMLDetailsElement;
globalThis.localStorage = testWindow.localStorage as unknown as Storage;
globalThis.requestAnimationFrame = (_callback: FrameRequestCallback): number => 1;
globalThis.cancelAnimationFrame = () => {};
globalThis.EventSource = class {
  static CLOSED = 2;
  readyState = 0;
  addEventListener(): void {}
  close(): void {
    this.readyState = 2;
  }
} as unknown as typeof EventSource;

const project: ProjectDto = {
  id: 'proj_shell',
  name: 'epc-bus',
  localPath: '/tmp/epc-bus',
  sourceKind: 'local',
  status: 'active',
  agentBackend: 'claude_code',
  language: 'java',
  buildTool: 'maven',
  defaultBranch: 'main',
  sourceBranches: ['main'],
  registeredAt: '2026-07-01T00:00:00.000Z',
};

const run: WorkflowRunDto = {
  id: 'run_shell',
  projectId: project.id,
  type: 'feature',
  status: 'running',
  currentStage: 'implementation',
  flowId: 'feature.standard',
  startStage: null,
  configSnapshotId: null,
  sourceBranch: 'main',
  branch: 'ai/run_9382f5a0f0d9-generate-legacy-profile',
  workspacePath: '/tmp/epc-bus-worktree',
  title: 'Generate legacy profile',
  createdAt: '2026-07-01T00:01:00.000Z',
  updatedAt: '2026-07-01T00:02:00.000Z',
};

const request: WorkflowRequestDto = {
  id: 'wreq_shell',
  projectId: project.id,
  type: 'feature',
  title: 'Generate legacy profile',
  branch: 'main',
  status: 'claimed',
  claimedBy: 'runner-local',
  workflowRunId: run.id,
  error: null,
  agentBackend: null,
  flowId: 'feature.standard',
  startStage: null,
  kind: null,
  createdAt: '2026-07-01T00:00:30.000Z',
  updatedAt: '2026-07-01T00:02:00.000Z',
};

function resetState(): void {
  document.body.replaceChildren();
  window.location.hash = '';
  data.health = null;
  data.projects = [project];
  data.runners = [{
    id: 'runner_shell',
    host: 'local',
    version: '0.0.0-test',
    status: 'online',
    lastSeenAt: '2026-07-01T00:03:00.000Z',
    jdkVersion: '1.8.0_452',
    mavenVersion: '3.9.11',
    gitVersion: '2.45.0',
  }];
  data.requests = [request];
  data.runs = [run];
  data.activeDetail = null;
  data.runnerControl = null;
  agentBackendPreflight.clear();
  ui.activePage = 'task';
  ui.activeTaskRequestId = request.id;
  ui.activeRunId = run.id;
  ui.lastError = null;
  ui.projectsLoadError = null;
  ui.sidebarCollapsed = false;
}

describe('shell topbar rendering', () => {
  afterEach(resetState);

  it('renders the global status summary as a compact three-item group', () => {
    resetState();
    data.requests = [
      { ...request, id: 'wreq_question', status: 'awaiting_clarification', workflowRunId: null },
      { ...request, id: 'wreq_failed', status: 'failed', workflowRunId: null, error: 'needs attention' },
      { ...request, id: 'wreq_claimed', status: 'claimed' },
    ];
    data.runs = [
      run,
      { ...run, id: 'run_human', status: 'awaiting_human' },
    ];

    const shell = renderShell();
    const strip = shell.querySelector<HTMLElement>('.global-status-strip');
    const items = [...shell.querySelectorAll<HTMLElement>('.global-status-strip .global-status-item')];

    expect(strip?.getAttribute('aria-live')).toBe('polite');
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain('待处理');
    expect(items[0].textContent).toContain('3');
    expect(items[0].classList.contains('bad')).toBe(true);
    expect(items[1].textContent).toContain('运行中');
    expect(items[1].textContent).toContain('2');
    expect(items[1].classList.contains('info')).toBe(true);
    expect(items[2].textContent).toContain('系统状态');
    expect(items[2].textContent).toContain('正常');
  });

  it('groups task execution context around project focus and readiness', () => {
    resetState();

    const shell = renderShell();
    const items = [...shell.querySelectorAll<HTMLElement>('.context-strip .context-item')];

    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain('当前项目');
    expect(items[0].textContent).toContain('epc-bus');
    expect(items[0].textContent).toContain('执行分支 ai/run_9382f5a0f0d9-generate-legacy-profile');
    expect(items[1].textContent).toContain('运行就绪');
    expect(items[1].textContent).toContain('AI 后端待检测');
    expect(items[1].textContent).toContain('Runner online · Claude Code · 未检测');
    expect(items[2].textContent).toContain('构建环境');
    expect(items[2].textContent).toContain('JDK 1.8.0_452 · Maven 3.9.11');
    expect(items.map((item) => item.querySelector('span')?.textContent)).not.toContain('Branch');
    expect(items.map((item) => item.querySelector('span')?.textContent)).not.toContain('Agent Backend');
    expect(items.map((item) => item.querySelector('span')?.textContent)).not.toContain('Build Env');
  });

  it('keeps the collapsed sidebar collapsed when a collapsed nav icon is clicked', () => {
    resetState();
    ui.sidebarCollapsed = true;

    const shell = renderShell();
    document.body.appendChild(shell);

    expect(shell.classList.contains('sidebar-collapsed')).toBe(true);

    const newTaskIcon = shell.querySelector<HTMLButtonElement>('.sidebar-collapsed-icon-btn[title="新建任务"]');
    expect(newTaskIcon).not.toBeNull();

    newTaskIcon!.click();

    expect(window.location.hash).toBe('#new-task');
    expect(ui.sidebarCollapsed).toBe(true);
    expect(renderShell().classList.contains('sidebar-collapsed')).toBe(true);
  });

  it('keeps the expanded sidebar expanded when an expanded nav item is clicked', () => {
    resetState();
    ui.sidebarCollapsed = false;

    const shell = renderShell();
    document.body.appendChild(shell);

    const reportsNav = [...shell.querySelectorAll<HTMLButtonElement>('.nav-item')]
      .find((button) => button.textContent?.includes('任务报告'));
    expect(reportsNav).not.toBeNull();

    reportsNav!.click();

    expect(window.location.hash).toBe('#reports');
    expect(ui.sidebarCollapsed).toBe(false);
    expect(renderShell().classList.contains('sidebar-collapsed')).toBe(false);
  });

  it('changes sidebar collapsed state only through the explicit sidebar controls', () => {
    resetState();

    const shell = renderShell();
    document.body.appendChild(shell);

    const collapseButton = shell.querySelector<HTMLButtonElement>('button[title="收起侧边栏"]');
    expect(collapseButton).not.toBeNull();

    collapseButton!.click();

    expect(ui.sidebarCollapsed).toBe(true);
    expect(shell.classList.contains('sidebar-collapsed')).toBe(true);

    const expandButton = shell.querySelector<HTMLButtonElement>('button[title="展开侧边栏"]');
    expect(expandButton).not.toBeNull();

    expandButton!.click();

    expect(ui.sidebarCollapsed).toBe(false);
    expect(shell.classList.contains('sidebar-collapsed')).toBe(false);
  });
});
