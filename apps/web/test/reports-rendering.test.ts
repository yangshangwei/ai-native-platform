import { Window } from 'happy-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { renderReportsPage } from '../src/page-reports';
import { data, ui } from '../src/state';
import type { WorkflowRunDto } from '../src/projection';

const testWindow = new Window();
globalThis.window = testWindow as unknown as Window & typeof globalThis;
globalThis.document = testWindow.document as unknown as Document;
globalThis.HTMLElement = testWindow.HTMLElement;
globalThis.HTMLDetailsElement = testWindow.HTMLDetailsElement;

const baseRun: WorkflowRunDto = {
  id: 'run_base',
  projectId: 'proj_1',
  title: 'Base run',
  type: 'feature',
  status: 'running',
  currentStage: 'implementation',
  flowId: 'feature.standard',
  startStage: null,
  sourceBranch: 'main',
  branch: 'ai/run_base',
  workspacePath: '/tmp/worktree',
  createdAt: '2026-06-29T00:00:00.000Z',
};

function run(id: string, title: string, status: WorkflowRunDto['status'], createdAt: string): WorkflowRunDto {
  return {
    ...baseRun,
    id,
    title,
    status,
    branch: `ai/${id}`,
    createdAt,
  };
}

function resetState(): void {
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
  data.requests = [];
  data.runs = [];
  data.activeDetail = null;
  ui.activeRunId = null;
}

describe('reports rendering', () => {
  afterEach(resetState);

  it('renders report rows as an action-first review inbox', () => {
    resetState();
    data.runs = [
      run('run_running', 'Still running', 'running', '2026-06-29T03:00:00.000Z'),
      run('run_passed', 'Ready to accept', 'passed', '2026-06-29T04:00:00.000Z'),
      run('run_failed', 'Needs repair', 'failed', '2026-06-29T01:00:00.000Z'),
      run('run_waiting', 'Needs approval', 'awaiting_human', '2026-06-29T02:00:00.000Z'),
    ];

    const page = renderReportsPage();
    const rows = [...page.querySelectorAll<HTMLElement>('.report-card-v2')];

    expect(rows.map((row) => row.querySelector('.report-card-title')?.textContent)).toEqual([
      'Needs repair',
      'Needs approval',
      'Ready to accept',
      'Still running',
    ]);
    expect(rows[0].querySelector('.report-card-priority')?.textContent).toContain('需处理');
    expect(rows[0].querySelector('.report-card-next-action')?.textContent).toContain('查看失败证据');
    const details = rows[0].querySelector<HTMLDetailsElement>('details[data-details-key="report-run-tech:run_failed"]');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
  });
});
