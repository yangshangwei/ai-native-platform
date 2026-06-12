/**
 * Hash router — maps `window.location.hash` to/from navigation state.
 *
 * `setHash` writes the hash for a target page/entity; `parseHash` decodes
 * the current hash into `ui.activePage` / `ui.activeRunId` /
 * `ui.activeTaskRequestId`. No DOM rendering, no fetch. Moved verbatim out
 * of `main.ts` (T2.1 base-layer split). `actionLink` (a navigation button
 * shared by several pages) followed in the T2.2 page split.
 */

import type { Page } from './types';
import { button } from './dom';
import { data, ui } from './state';

export function setHash(page: Page, id?: string): void {
  if (page === 'task' && id) window.location.hash = `task/${encodeURIComponent(id)}`;
  else if (id) window.location.hash = `run/${encodeURIComponent(id)}`;
  else window.location.hash = page;
}

export function parseHash(): void {
  const raw = window.location.hash.replace(/^#/, '');
  if (raw.startsWith('run/')) {
    ui.activePage = 'workbench';
    ui.activeRunId = decodeURIComponent(raw.slice('run/'.length));
    ui.activeTaskRequestId = null;
    return;
  }
  if (raw.startsWith('task/')) {
    ui.activePage = 'task';
    ui.activeTaskRequestId = decodeURIComponent(raw.slice('task/'.length));
    ui.activeRunId = null;
    data.activeDetail = null;
    return;
  }
  ui.activeTaskRequestId = null;
  if (['workbench', 'projects', 'new-task', 'reports', 'knowledge', 'settings'].includes(raw)) {
    ui.activePage = raw as Page;
  }
}

export function actionLink(label: string, page: Page): HTMLButtonElement {
  const btn = button(label, 'button secondary');
  btn.onclick = () => setHash(page);
  return btn;
}
