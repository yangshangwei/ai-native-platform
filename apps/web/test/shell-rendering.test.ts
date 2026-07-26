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

  it('keeps zero pending and running counts visible without alert styling', () => {
    resetState();
    data.requests = [{ ...request, status: 'completed' }];
    data.runs = [{ ...run, status: 'passed' }];

    const shell = renderShell();
    const items = [...shell.querySelectorAll<HTMLElement>('.global-status-item')];

    expect(items[0].textContent).toContain('待处理0');
    expect(items[0].classList.contains('muted')).toBe(true);
    expect(items[1].textContent).toContain('运行中0');
    expect(items[1].classList.contains('muted')).toBe(true);
  });

  it('counts an operationally paused task as pending attention, not active execution', () => {
    resetState();
    data.requests = [{ ...request, status: 'paused' }];
    data.runs = [{ ...run, status: 'paused' }];

    const shell = renderShell();
    const items = [...shell.querySelectorAll<HTMLElement>('.global-status-item')];

    expect(items[0].textContent).toContain('待处理1');
    expect(items[0].classList.contains('bad')).toBe(true);
    expect(items[1].textContent).toContain('运行中0');
    expect(items[1].classList.contains('muted')).toBe(true);
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

  it('promotes an offline Runner to a warning in task and system readiness', () => {
    resetState();
    data.runners = [];

    const shell = renderShell();
    const readiness = [...shell.querySelectorAll<HTMLElement>('.context-item')]
      .find((item) => item.textContent?.includes('运行就绪'));
    const buildEnvironment = [...shell.querySelectorAll<HTMLElement>('.context-item')]
      .find((item) => item.textContent?.includes('构建环境'));
    const systemStatus = [...shell.querySelectorAll<HTMLElement>('.global-status-item')]
      .find((item) => item.textContent?.includes('系统状态'));

    expect(readiness?.textContent).toContain('Runner 待启动');
    expect(readiness?.querySelector('strong')?.classList.contains('warn')).toBe(true);
    expect(buildEnvironment?.textContent).toContain('等待 runner heartbeat');
    expect(systemStatus?.textContent).toContain('执行器待启动');
    expect(systemStatus?.classList.contains('warn')).toBe(true);
  });

  it('does not treat a recorded offline Runner heartbeat as runnable', () => {
    resetState();
    data.runners = [{ ...data.runners[0]!, status: 'offline' }];

    const shell = renderShell();
    const readiness = [...shell.querySelectorAll<HTMLElement>('.context-item')]
      .find((item) => item.textContent?.includes('运行就绪'));
    const systemStatus = [...shell.querySelectorAll<HTMLElement>('.global-status-item')]
      .find((item) => item.textContent?.includes('系统状态'));

    expect(readiness?.textContent).toContain('Runner 待启动');
    expect(readiness?.querySelector('strong')?.classList.contains('warn')).toBe(true);
    expect(systemStatus?.textContent).toContain('执行器待启动');
    expect(systemStatus?.classList.contains('warn')).toBe(true);
  });

  it('promotes a missing project backend above healthy secondary details', () => {
    resetState();
    data.projects = [{ ...project, agentBackend: null }];
    data.requests = [{ ...request, agentBackend: null }];

    const shell = renderShell();
    const readiness = [...shell.querySelectorAll<HTMLElement>('.context-item')]
      .find((item) => item.textContent?.includes('运行就绪'));
    const systemStatus = [...shell.querySelectorAll<HTMLElement>('.global-status-item')]
      .find((item) => item.textContent?.includes('系统状态'));

    expect(readiness?.textContent).toContain('需要配置 AI 后端');
    expect(readiness?.textContent).toContain('Runner online · 待配置');
    expect(readiness?.querySelector('strong')?.classList.contains('warn')).toBe(true);
    expect(systemStatus?.textContent).toContain('需要配置执行方式');
    expect(systemStatus?.classList.contains('warn')).toBe(true);
  });

  it('uses a pending request backend override for task and system readiness', () => {
    resetState();
    data.projects = [{ ...project, agentBackend: null }];
    data.requests = [{
      ...request,
      status: 'pending',
      workflowRunId: null,
      agentBackend: 'claude_code',
    }];
    data.runs = [];
    ui.activeRunId = null;

    const shell = renderShell();
    const readiness = [...shell.querySelectorAll<HTMLElement>('.context-item')]
      .find((item) => item.textContent?.includes('运行就绪'));
    const systemStatus = [...shell.querySelectorAll<HTMLElement>('.global-status-item')]
      .find((item) => item.textContent?.includes('系统状态'));

    expect(readiness?.textContent).toContain('AI 后端待检测');
    expect(readiness?.textContent).toContain('Runner online · Claude Code · 未检测');
    expect(readiness?.textContent).not.toContain('需要配置 AI 后端');
    expect(systemStatus?.textContent).toContain('正常');
    expect(systemStatus?.textContent).not.toContain('需要配置执行方式');
  });

  it('shows a warning when the configured backend preflight needs login', () => {
    resetState();
    agentBackendPreflight.set(project.id, {
      backend: 'claude_code',
      label: 'Claude Code',
      bin: 'claude',
      installed: true,
      runnable: false,
      authenticated: false,
      version: '1.0.0',
      status: 'needs_login',
      error: 'authentication required',
      remediationHint: 'Log in to Claude Code',
      checkedAt: '2026-07-01T00:03:00.000Z',
    });

    const shell = renderShell();
    const readiness = [...shell.querySelectorAll<HTMLElement>('.context-item')]
      .find((item) => item.textContent?.includes('运行就绪'));
    const systemStatus = [...shell.querySelectorAll<HTMLElement>('.global-status-item')]
      .find((item) => item.textContent?.includes('系统状态'));

    expect(readiness?.textContent).toContain('AI 后端待处理');
    expect(readiness?.textContent).toContain('Claude Code · 需要登录');
    expect(readiness?.querySelector('strong')?.classList.contains('warn')).toBe(true);
    expect(systemStatus?.textContent).toContain('执行方式待处理');
    expect(systemStatus?.classList.contains('warn')).toBe(true);
  });

  it('shows a failure when the configured backend preflight cannot run', () => {
    resetState();
    agentBackendPreflight.set(project.id, {
      backend: 'claude_code',
      label: 'Claude Code',
      bin: null,
      installed: false,
      runnable: false,
      authenticated: null,
      version: null,
      status: 'missing_cli',
      error: 'claude missing',
      remediationHint: 'Install Claude Code',
      checkedAt: '2026-07-01T00:03:00.000Z',
    });

    const shell = renderShell();
    const readiness = [...shell.querySelectorAll<HTMLElement>('.context-item')]
      .find((item) => item.textContent?.includes('运行就绪'));
    const systemStatus = [...shell.querySelectorAll<HTMLElement>('.global-status-item')]
      .find((item) => item.textContent?.includes('系统状态'));

    expect(readiness?.textContent).toContain('AI 后端异常');
    expect(readiness?.textContent).toContain('Claude Code · 缺少 CLI');
    expect(readiness?.querySelector('strong')?.classList.contains('bad')).toBe(true);
    expect(systemStatus?.textContent).toContain('执行方式需处理');
    expect(systemStatus?.classList.contains('bad')).toBe(true);
  });

  it('uses the active pending request project when no workflow run exists', () => {
    resetState();
    const requestProject: ProjectDto = {
      ...project,
      id: 'proj_pending_request',
      name: 'no-run-project',
      defaultBranch: 'fixture-main',
      agentBackend: 'claude_code',
    };
    const unrelatedProject: ProjectDto = {
      ...project,
      id: 'proj_unrelated_run',
      name: 'unrelated-run-project',
      agentBackend: 'codex',
    };
    const pendingRequest: WorkflowRequestDto = {
      ...request,
      id: 'wreq_pending_without_run',
      projectId: requestProject.id,
      branch: 'requested-branch',
      status: 'pending',
      workflowRunId: null,
      agentBackend: 'claude_code',
    };
    data.projects = [unrelatedProject, requestProject];
    data.requests = [pendingRequest];
    data.runs = [{
      ...run,
      id: 'run_unrelated',
      projectId: unrelatedProject.id,
      branch: 'ai/unrelated-run',
      status: 'failed',
    }];
    ui.activeTaskRequestId = pendingRequest.id;
    ui.activeRunId = null;
    agentBackendPreflight.set(requestProject.id, {
      backend: 'claude_code',
      label: 'Claude Code',
      bin: 'claude',
      installed: true,
      runnable: true,
      authenticated: true,
      version: '1.0.0',
      status: 'connected',
      error: null,
      remediationHint: '',
      checkedAt: '2026-07-01T00:03:00.000Z',
    });
    agentBackendPreflight.set(unrelatedProject.id, {
      backend: 'codex',
      label: 'Codex',
      bin: null,
      installed: false,
      runnable: false,
      authenticated: null,
      version: null,
      status: 'missing_cli',
      error: 'codex missing',
      remediationHint: 'Install Codex',
      checkedAt: '2026-07-01T00:03:00.000Z',
    });

    const shell = renderShell();
    const context = shell.querySelector<HTMLElement>('.context-strip');
    const systemStatus = [...shell.querySelectorAll<HTMLElement>('.global-status-item')]
      .find((item) => item.textContent?.includes('系统状态'));

    expect(context?.textContent).toContain('no-run-project');
    expect(context?.textContent).toContain('执行分支 requested-branch');
    expect(context?.textContent).toContain('Runner online · Claude Code · 已连接');
    expect(context?.textContent).not.toContain('unrelated-run-project');
    expect(context?.textContent).not.toContain('ai/unrelated-run');
    expect(systemStatus?.textContent).toContain('正常');
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
