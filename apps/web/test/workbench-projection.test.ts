import { Window } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTaskTrendSeries, renderWorkbenchPage } from '../src/page-workbench';
import type { RunDetail, WorkflowRunDto } from '../src/projection';
import { data, ui } from '../src/state';
import type { WorkflowRequestDto } from '../src/types';

vi.mock('../src/charts', () => ({
  createLineChart: vi.fn(),
}));

const testWindow = new Window({ url: 'http://localhost/#workbench' });
globalThis.window = testWindow as unknown as Window & typeof globalThis;
globalThis.document = testWindow.document as unknown as Document;
globalThis.HTMLElement = testWindow.HTMLElement;
globalThis.HTMLDetailsElement = testWindow.HTMLDetailsElement;
globalThis.localStorage = testWindow.localStorage as unknown as Storage;
globalThis.requestAnimationFrame = (callback: FrameRequestCallback): number => {
  callback(0);
  return 0;
};

function run(status: WorkflowRunDto['status'], createdAt: string): WorkflowRunDto {
  return {
    id: `run_${status}_${createdAt}`,
    projectId: 'proj_1',
    type: 'feature',
    title: `${status} run`,
    status,
    currentStage: 'implementation',
    flowId: 'feature.standard',
    startStage: null,
    sourceBranch: 'main',
    branch: `ai/${status}`,
    workspacePath: null,
    createdAt,
  };
}

function request(id: string, workflowRunId: string | null, status: WorkflowRequestDto['status'] = 'claimed'): WorkflowRequestDto {
  return {
    id,
    projectId: 'proj_1',
    type: 'feature',
    title: `${id} request`,
    branch: 'main',
    status,
    claimedBy: null,
    workflowRunId,
    error: null,
    createdAt: '2026-06-29T00:00:00.000Z',
    updatedAt: '2026-06-29T00:00:00.000Z',
    agentBackend: null,
    flowId: null,
    startStage: null,
    kind: null,
  };
}

function runDetail(workflowRun: WorkflowRunDto): RunDetail {
  return {
    run: workflowRun,
    steps: [],
    commands: [
      {
        id: 'cmd_failed',
        stepRunId: null,
        cwd: '/tmp/demo',
        command: 'mvn test',
        stage: 'test',
        status: 'failed',
        exitCode: 1,
        durationMs: 1200,
        stdoutRef: 'stdout.log',
        stderrRef: 'stderr.log',
        stdoutSha256: null,
        stderrSha256: null,
        combinedSha256: null,
        startedAt: '2026-06-29T08:00:01.000Z',
        timedOut: false,
        truncated: false,
      },
    ],
    toolInvocations: [],
    gates: [],
    artifacts: [],
    builds: [],
    tests: [],
    approvals: [],
    actions: [],
    agentTasks: [],
    agentResults: [],
    handoffs: [],
    stepCheckpoints: [],
    audit: [],
  };
}

function resetState(): void {
  data.health = null;
  data.projects = [
    {
      id: 'proj_1',
      name: 'Demo Project',
      localPath: '/tmp/demo',
      sourceKind: 'local',
      status: 'active',
      agentBackend: 'codex',
      language: 'typescript',
      buildTool: 'bun',
      defaultBranch: 'main',
      sourceBranches: ['main'],
      registeredAt: '2026-06-29T00:00:00.000Z',
    },
  ];
  data.runners = [];
  data.requests = [];
  data.runs = [];
  data.activeDetail = null;
  data.runnerControl = null;
  ui.activePage = 'workbench';
  ui.activeRunId = null;
  ui.activeTaskRequestId = null;
  window.location.hash = 'workbench';
  localStorage.clear();
}

describe('workbench task trend projection', () => {
  const now = new Date('2026-06-29T12:00:00.000Z');

  it('does not invent chart data when no runs exist', () => {
    const trend = buildTaskTrendSeries([], now);

    expect(trend.hasRealData).toBe(false);
    expect(trend.datasets.flatMap((dataset) => dataset.data)).toEqual(Array(21).fill(0));
  });

  it('counts real runs in the seven-day window', () => {
    const trend = buildTaskTrendSeries([
      run('passed', '2026-06-29T08:00:00.000Z'),
      run('failed', '2026-06-28T08:00:00.000Z'),
      run('running', '2026-06-28T09:00:00.000Z'),
      run('passed', '2026-06-10T08:00:00.000Z'),
    ], now);

    expect(trend.hasRealData).toBe(true);
    expect(trend.labels).toEqual(['6/23', '6/24', '6/25', '6/26', '6/27', '6/28', '6/29']);
    expect(trend.datasets.find((dataset) => dataset.label === '成功')?.data).toEqual([0, 0, 0, 0, 0, 0, 1]);
    expect(trend.datasets.find((dataset) => dataset.label === '失败')?.data).toEqual([0, 0, 0, 0, 0, 1, 0]);
    expect(trend.datasets.find((dataset) => dataset.label === '进行中')?.data).toEqual([0, 0, 0, 0, 0, 1, 0]);
  });
});

describe('workbench action queue rendering', () => {
  afterEach(resetState);

  it('opens the task detail page for run-based actions with matching workflow requests', () => {
    resetState();
    data.requests = [request('wreq_waiting', 'run_waiting')];
    data.runs = [run('awaiting_human', '2026-06-29T08:00:00.000Z')];
    data.runs[0]!.id = 'run_waiting';
    data.runs[0]!.title = 'Needs approval';

    const page = renderWorkbenchPage();
    const action = [...page.querySelectorAll<HTMLButtonElement>('button')]
      .find((candidate) => candidate.textContent === '处理确认');

    expect(action).not.toBeUndefined();
    action?.click();

    expect(window.location.hash).toBe('#task/wreq_waiting');
  });

  it('opens visible run evidence for failed run actions without matching workflow requests', () => {
    resetState();
    data.runs = [run('failed', '2026-06-29T08:00:00.000Z')];
    data.runs[0]!.id = 'run_failed';
    data.runs[0]!.title = 'Needs evidence';

    const initialPage = renderWorkbenchPage();
    const action = [...initialPage.querySelectorAll<HTMLButtonElement>('button')]
      .find((candidate) => candidate.textContent === '查看证据');

    expect(action).not.toBeUndefined();
    action?.click();

    expect(window.location.hash).toBe('#run/run_failed');

    ui.activeRunId = 'run_failed';
    data.activeDetail = runDetail(data.runs[0]!);

    const activeRunPage = renderWorkbenchPage();

    expect(activeRunPage.querySelector('.evidence-summary-panel')).not.toBeNull();
    expect(activeRunPage.textContent).toContain('证据摘要');
    expect(activeRunPage.textContent).toContain('1 条异常');
  });

  it('does not show active run evidence on the plain workbench overview', () => {
    resetState();
    data.runs = [run('failed', '2026-06-29T08:00:00.000Z')];
    data.runs[0]!.id = 'run_failed';
    ui.activeRunId = 'run_failed';
    data.activeDetail = runDetail(data.runs[0]!);
    window.location.hash = 'workbench';

    const page = renderWorkbenchPage();

    expect(page.querySelector('.evidence-summary-panel')).toBeNull();
  });

  it('keeps request actions on the task detail page', () => {
    resetState();
    data.requests = [request('wreq_clarify', null, 'awaiting_clarification')];

    const page = renderWorkbenchPage();
    const action = [...page.querySelectorAll<HTMLButtonElement>('button')]
      .find((candidate) => candidate.textContent === '补充信息');

    expect(action).not.toBeUndefined();
    action?.click();

    expect(window.location.hash).toBe('#task/wreq_clarify');
  });
});
