/**
 * Render core — root rebuild plus the render-stability contracts.
 *
 * `render()` rebuilds the app root from in-memory state. Around that
 * rebuild it enforces the three spec contracts from
 * `.trellis/spec/web/frontend/state-management.md`:
 *   1. defer the rebuild entirely while an IME composition is active
 *      (`ui.coordinatorReplyComposing` / `ui.knowledgeEditComposing`);
 *   2. capture/restore user-owned disclosure (`<details>`) state;
 *   3. capture/restore scroll positions (viewport + scrollable panes).
 * Moved verbatim out of `main.ts` (T2.1 base-layer split) with one wiring
 * change: the page shell renderer (shell.ts) and the coordinator/new-task
 * composer capture/restore helpers (coordinator-chat.ts / page-new-task.ts)
 * are feature modules above this base layer, so main.ts injects them via
 * `setRenderHooks` (avoids a base-layer -> feature-module import).
 */

import { clear } from './dom';
import { ui } from './state';
import { applyPageEnterAnimation } from './router';

interface RenderHooks {
  renderShell: () => HTMLElement;
  captureCoordinatorReplyComposerState: (root: HTMLElement) => void;
  captureNewTaskFormState: (root: HTMLElement) => void;
  restoreCoordinatorReplyComposerFocus: (root: HTMLElement) => void;
  restoreNewTaskFormFocus: (root: HTMLElement) => void;
}

// Registered by main.ts at bootstrap, before the first render() call.
let renderHooks: RenderHooks | null = null;

export function setRenderHooks(hooks: RenderHooks): void {
  renderHooks = hooks;
}

const scrollPositionState = new Map<string, { top: number; left: number }>();
const SCROLLABLE_STATE_SELECTOR = '[data-scroll-key], .doc-preview';
let viewportScrollPosition = { top: 0, left: 0 };
const detailsOpenState = new Map<string, boolean>();

export function render(): void {
  const root = document.getElementById('app');
  if (!root) return;
  if (!renderHooks) return;
  const hooks = renderHooks;
  // IME composition on the Coordinator reply textarea must not be interrupted
  // by a root rebuild. Defer the render; `compositionend` flushes the
  // pending render on the next microtask.
  if (ui.coordinatorReplyComposing) {
    ui.coordinatorReplyRenderDeferred = true;
    return;
  }
  if (ui.knowledgeEditComposing) {
    ui.knowledgeEditRenderDeferred = true;
    return;
  }
  captureDetailsOpenState(root);
  captureViewportScrollPosition();
  captureScrollPositionState(root);
  hooks.captureCoordinatorReplyComposerState(root);
  hooks.captureNewTaskFormState(root);
  ui.isReplacingAppRootForRender = true;
  try {
    clear(root);
    root.appendChild(hooks.renderShell());
    restoreDetailsOpenState(root);
    restoreScrollPositionState(root);
    restoreViewportScrollPosition();
    hooks.restoreCoordinatorReplyComposerFocus(root);
    hooks.restoreNewTaskFormFocus(root);
    applyPageEnterAnimation();
  } finally {
    ui.isReplacingAppRootForRender = false;
  }
}

function captureDetailsOpenState(root: HTMLElement): void {
  root.querySelectorAll('details').forEach((details) => {
    detailsOpenState.set(detailsStateKey(details), details.open);
  });
}

function captureViewportScrollPosition(): void {
  viewportScrollPosition = { top: window.scrollY, left: window.scrollX };
}

function restoreViewportScrollPosition(): void {
  window.scrollTo(viewportScrollPosition.left, viewportScrollPosition.top);
  const restored = { top: window.scrollY, left: window.scrollX };
  requestAnimationFrame(() => {
    if (window.scrollY === restored.top && window.scrollX === restored.left) {
      window.scrollTo(viewportScrollPosition.left, viewportScrollPosition.top);
    }
  });
}

function captureScrollPositionState(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>(SCROLLABLE_STATE_SELECTOR).forEach((node) => {
    scrollPositionState.set(scrollStateKey(node), { top: node.scrollTop, left: node.scrollLeft });
  });
}

function restoreScrollPositionState(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>(SCROLLABLE_STATE_SELECTOR).forEach((node) => {
    const key = scrollStateKey(node);
    const saved = scrollPositionState.get(key);
    if (saved) restoreScrollableNode(node, saved);
    node.onscroll = () => {
      scrollPositionState.set(key, { top: node.scrollTop, left: node.scrollLeft });
    };
  });
}

function restoreScrollableNode(node: HTMLElement, saved: { top: number; left: number }): void {
  node.scrollTop = saved.top;
  node.scrollLeft = saved.left;
  const restored = { top: node.scrollTop, left: node.scrollLeft };
  requestAnimationFrame(() => {
    if (node.scrollTop === restored.top && node.scrollLeft === restored.left) {
      node.scrollTop = saved.top;
      node.scrollLeft = saved.left;
    }
  });
}

function scrollStateKey(node: HTMLElement): string {
  return [window.location.hash || ui.activePage, node.dataset.scrollKey ?? fallbackScrollStateKey(node)]
    .filter(Boolean)
    .join(' > ');
}

function fallbackScrollStateKey(node: HTMLElement): string {
  const context: string[] = [];
  let current: HTMLElement | null = node.parentElement;
  while (current) {
    if (current instanceof HTMLDetailsElement) context.push(detailsSummaryKey(current));
    current = current.parentElement;
  }
  const text = node.textContent ?? '';
  return ['preview', ...context.reverse(), shortTextHash(text)].join(':');
}

function shortTextHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = Math.imul(31, hash) + text.charCodeAt(i) | 0;
  }
  return Math.abs(hash).toString(36);
}

function restoreDetailsOpenState(root: HTMLElement): void {
  root.querySelectorAll('details').forEach((details) => {
    const key = detailsStateKey(details);
    if (detailsOpenState.has(key)) details.open = detailsOpenState.get(key) ?? false;
    details.ontoggle = () => {
      detailsOpenState.set(key, details.open);
    };
  });
}

function detailsStateKey(details: HTMLDetailsElement): string {
  const explicitKey = details.dataset.detailsKey;
  if (explicitKey) return [window.location.hash || ui.activePage, explicitKey].join(' > ');

  const path: string[] = [];
  let current: HTMLElement | null = details;
  while (current) {
    if (current instanceof HTMLDetailsElement) path.push(detailsSummaryKey(current));
    current = current.parentElement;
  }
  return [window.location.hash || ui.activePage, ...path.reverse()].join(' > ');
}

function detailsSummaryKey(details: HTMLDetailsElement): string {
  const summary = details.querySelector(':scope > summary');
  const primary = summary?.querySelector('strong')?.textContent ?? summary?.textContent ?? details.className;
  return primary.replace(/\s*\(\d+\)/g, '').replace(/\s+/g, ' ').trim();
}
