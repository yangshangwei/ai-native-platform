import { Window } from 'happy-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { renderSettingsPage, settingsConfig } from '../src/page-settings';
import { data, ui } from '../src/state';

const testWindow = new Window();
globalThis.window = testWindow as unknown as Window & typeof globalThis;
globalThis.document = testWindow.document as unknown as Document;
globalThis.HTMLElement = testWindow.HTMLElement;
globalThis.HTMLDetailsElement = testWindow.HTMLDetailsElement;

function resetState(): void {
  data.projects = [];
  data.runners = [];
  data.requests = [];
  data.runs = [];
  data.activeDetail = null;
  data.runnerControl = null;
  Object.assign(settingsConfig, {
    activeTab: 'intelligent_analysis',
    loading: false,
    error: null,
    registry: null,
    overrides: {},
    loadedOnce: true,
  });
  settingsConfig.drafts.clear();
  settingsConfig.saving.clear();
  settingsConfig.expandedHistory.clear();
  settingsConfig.audits.clear();
  settingsConfig.recentlySaved.clear();
  ui.runnerStartInFlight = false;
}

describe('settings rendering', () => {
  afterEach(resetState);

  it('promotes runtime diagnostics when setup is incomplete', () => {
    resetState();

    const page = renderSettingsPage();
    const diagnostics = page.querySelector<HTMLDetailsElement>('details[data-details-key="settings-runtime-diagnostics"]');

    expect(diagnostics).not.toBeNull();
    expect(diagnostics?.open).toBe(true);
    expect(diagnostics?.classList.contains('attention')).toBe(true);
    expect(diagnostics?.textContent).toContain('需要连接项目');
  });

  it('keeps runtime diagnostics collapsed when setup is healthy', () => {
    resetState();
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

    const page = renderSettingsPage();
    const diagnostics = page.querySelector<HTMLDetailsElement>('details[data-details-key="settings-runtime-diagnostics"]');

    expect(diagnostics).not.toBeNull();
    expect(diagnostics?.open).toBe(false);
    expect(diagnostics?.classList.contains('attention')).toBe(false);
    expect(diagnostics?.textContent).toContain('运行环境详情');
  });
});
