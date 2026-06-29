import { Window } from 'happy-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { newTaskFormDraft, renderNewTaskPage } from '../src/page-new-task';
import { data, ui } from '../src/state';

const testWindow = new Window();
globalThis.window = testWindow as unknown as Window & typeof globalThis;
globalThis.document = testWindow.document as unknown as Document;
globalThis.HTMLElement = testWindow.HTMLElement;
globalThis.HTMLDetailsElement = testWindow.HTMLDetailsElement;
globalThis.localStorage = testWindow.localStorage as unknown as Storage;

function resetState(): void {
  data.projects = [
    {
      id: 'proj_1',
      name: 'Demo Project',
      localPath: '/tmp/demo',
      sourceKind: 'local',
      status: 'active',
      agentBackend: 'codex',
      language: 'java',
      buildTool: 'maven',
      defaultBranch: 'main',
      sourceBranches: ['main', 'feature/demo'],
      registeredAt: '2026-06-29T00:00:00.000Z',
    },
  ];
  data.runners = [
    {
      id: 'runner_1',
      host: 'localhost',
      version: 'test',
      jdkVersion: '21',
      mavenVersion: '3.9',
      gitVersion: '2.45',
      lastSeenAt: '2026-06-29T00:00:00.000Z',
      status: 'online',
    },
  ];
  data.requests = [];
  data.runs = [];
  data.activeDetail = null;
  data.runnerControl = null;
  ui.projectsLoadError = null;
  ui.lastError = null;
  Object.assign(newTaskFormDraft, {
    projectId: 'proj_1',
    type: '',
    title: 'Improve task creation',
    details: 'Keep draft and focus stable.',
    branch: 'feature/demo',
    flowId: '',
    startStage: '',
  });
  localStorage.clear();
}

describe('new-task rendering', () => {
  afterEach(() => {
    resetState();
  });

  it('hydrates user drafts into the command composer and keeps stable disclosure keys', () => {
    resetState();

    const page = renderNewTaskPage();

    expect(page.querySelector('.new-task-composer')).not.toBeNull();
    expect(page.querySelector<HTMLInputElement>('[data-new-task-title]')?.value).toBe('Improve task creation');
    expect(page.querySelector<HTMLTextAreaElement>('[data-new-task-details]')?.value).toBe('Keep draft and focus stable.');
    expect(page.querySelector<HTMLSelectElement>('select[name="branch"]')?.value).toBe('feature/demo');
    expect(page.querySelector('details[data-details-key="new-task-advanced"]')).not.toBeNull();
    expect(page.querySelector('.new-task-submit-guard')?.textContent).toContain('创建前检查');
    expect(page.querySelector('.new-task-readiness')?.textContent).toContain('项目已选择');
  });
});
