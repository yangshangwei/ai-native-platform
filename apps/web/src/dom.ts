/**
 * DOM utilities — zero-state element builders and formatters.
 *
 * Every function here is stateless: no module-level mutable state, no
 * fetch, no app data. `el()` is the universal element factory the whole
 * SPA renders with; the rest are small formatting/widget helpers. Moved
 * verbatim out of `main.ts` (T2.1 base-layer split; `panelHeader` /
 * `configSummaryItem` / `previewText` followed in the T2.2 page split
 * because they are shared across page modules).
 */

import type { StatusKind } from './types';

export { tooltipTerm, tooltipIcon } from './tooltip';

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: {
    class?: string;
    id?: string;
    text?: string;
    children?: Array<Node | null | undefined | false>;
    attrs?: Record<string, string>;
  } = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.id) node.id = opts.id;
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
  if (opts.children) {
    for (const child of opts.children) if (child) node.appendChild(child);
  }
  return node;
}

export function icon(path: string): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '2');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(p);
  return svg;
}

export function octopusIcon(): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '28');
  svg.setAttribute('height', '28');
  svg.style.display = 'block';

  // Gate icon: three vertical bars with checkmarks, representing quality gates in a workflow
  // Left gate (requirement)
  const gate1 = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  gate1.setAttribute('x', '4');
  gate1.setAttribute('y', '6');
  gate1.setAttribute('width', '6');
  gate1.setAttribute('height', '20');
  gate1.setAttribute('rx', '1.5');
  gate1.setAttribute('fill', 'none');
  gate1.setAttribute('stroke', 'currentColor');
  gate1.setAttribute('stroke-width', '2');

  const check1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  check1.setAttribute('d', 'M 5.5 15 L 6.5 16 L 8.5 14');
  check1.setAttribute('fill', 'none');
  check1.setAttribute('stroke', 'currentColor');
  check1.setAttribute('stroke-width', '2');
  check1.setAttribute('stroke-linecap', 'round');
  check1.setAttribute('stroke-linejoin', 'round');

  // Center gate (implementation + test)
  const gate2 = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  gate2.setAttribute('x', '13');
  gate2.setAttribute('y', '6');
  gate2.setAttribute('width', '6');
  gate2.setAttribute('height', '20');
  gate2.setAttribute('rx', '1.5');
  gate2.setAttribute('fill', 'none');
  gate2.setAttribute('stroke', 'currentColor');
  gate2.setAttribute('stroke-width', '2');

  const check2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  check2.setAttribute('d', 'M 14.5 15 L 15.5 16 L 17.5 14');
  check2.setAttribute('fill', 'none');
  check2.setAttribute('stroke', 'currentColor');
  check2.setAttribute('stroke-width', '2');
  check2.setAttribute('stroke-linecap', 'round');
  check2.setAttribute('stroke-linejoin', 'round');

  // Right gate (acceptance)
  const gate3 = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  gate3.setAttribute('x', '22');
  gate3.setAttribute('y', '6');
  gate3.setAttribute('width', '6');
  gate3.setAttribute('height', '20');
  gate3.setAttribute('rx', '1.5');
  gate3.setAttribute('fill', 'none');
  gate3.setAttribute('stroke', 'currentColor');
  gate3.setAttribute('stroke-width', '2');

  const check3 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  check3.setAttribute('d', 'M 23.5 15 L 24.5 16 L 26.5 14');
  check3.setAttribute('fill', 'none');
  check3.setAttribute('stroke', 'currentColor');
  check3.setAttribute('stroke-width', '2');
  check3.setAttribute('stroke-linecap', 'round');
  check3.setAttribute('stroke-linejoin', 'round');

  svg.appendChild(gate1);
  svg.appendChild(check1);
  svg.appendChild(gate2);
  svg.appendChild(check2);
  svg.appendChild(gate3);
  svg.appendChild(check3);

  return svg;
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}

export function fmtTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 14)}…` : id;
}

export function statusKind(status: string): StatusKind {
  if (['passed', 'pass', 'success', 'approved', 'online', 'completed'].includes(status)) return 'good';
  if (['failed', 'fail', 'rejected', 'offline', 'cancelled'].includes(status)) return 'bad';
  if (['warn', 'stale', 'awaiting_human', 'awaiting_clarification', 'paused'].includes(status)) return 'warn';
  if (['running', 'pending', 'claimed'].includes(status)) return 'info';
  return 'muted';
}

export function pill(label: string, kind: StatusKind = statusKind(label)): HTMLElement {
  return el('span', { class: `pill ${kind}`, text: label });
}

export function metric(label: string, value: string, hint?: string, kind: StatusKind = 'muted', onClick?: () => void): HTMLElement {
  const valueElement = el('strong', { class: `metric-value ${kind} ${onClick ? 'clickable' : ''}`, text: value });

  if (onClick) {
    valueElement.onclick = onClick;
    valueElement.style.cursor = 'pointer';
  }

  return el('div', {
    class: 'metric-card',
    children: [
      el('span', { class: 'metric-label', text: label }),
      valueElement,
      hint ? el('span', { class: 'metric-hint', text: hint }) : null,
    ],
  });
}

/**
 * metricCardV2 - workbench metric card
 * 紧凑图标 + 数字 + 辅助文字
 */
export function metricCardV2(
  label: string,
  value: string,
  iconPath: string,
  kind: StatusKind | 'success' | 'warning' | 'danger' | 'primary' | 'purple' = 'info',
  hint?: string,
  onClick?: () => void,
): HTMLElement {
  const iconCircle = el('div', {
    class: `metric-icon ${kind}`,
    children: [icon(iconPath)],
  });

  const content = el('div', {
    class: 'metric-content',
    children: [
      el('div', { class: 'metric-label', text: label }),
      el('div', { class: 'metric-value', text: value }),
      hint ? el('div', { class: 'metric-hint', text: hint }) : null,
    ],
  });

  const card = el('div', {
    class: `metric-card-v2 ${onClick ? 'clickable' : ''}`,
    children: [iconCircle, content],
  });

  if (onClick) {
    card.onclick = onClick;
    card.style.cursor = 'pointer';
  }

  return card;
}

export function field(label: string, value: Node | string): HTMLElement {
  const valueNode = typeof value === 'string' ? el('span', { text: value }) : value;
  return el('div', {
    class: 'field-row',
    children: [el('span', { class: 'field-label', text: label }), valueNode],
  });
}

export function button(label: string, className = 'button secondary'): HTMLButtonElement {
  const btn = el('button', { class: className, text: label, attrs: { type: 'button' } });
  return btn;
}

export function panelHeader(title: string, subtitle?: string): HTMLElement {
  return el('div', {
    class: 'panel-header',
    children: [el('h2', { text: title }), subtitle ? el('p', { text: subtitle }) : null],
  });
}

export function configSummaryItem(label: string, value: Node | string): HTMLElement {
  const valueNode = typeof value === 'string' ? el('strong', { text: value }) : value;
  return el('div', {
    class: 'settings-summary-item',
    children: [el('span', { text: label }), valueNode],
  });
}

export function previewText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= 1400) return trimmed;
  return `${trimmed.slice(0, 1400)}\n\n… truncated for overview; open artifact path for full content.`;
}

export function labeledInput(label: string, name: string, placeholder: string): HTMLElement {
  return controlledInput(label, name, placeholder, '', () => undefined);
}

export function controlledInput(
  label: string,
  name: string,
  placeholder: string,
  value: string,
  onInput: (value: string) => void,
  type = 'text',
): HTMLElement {
  const input = el('input', { attrs: { name, placeholder, value, type } });
  input.oninput = () => onInput(input.value);
  return el('label', { class: 'input-block', children: [el('span', { text: label }), input] });
}

// Clamps a DOM selectionDirection string to the three valid values for
// setSelectionRange. Moved verbatim from main.ts (T2.3 page split): shared
// by the coordinator reply composer and the new-task form focus restore.
export function normalizeSelectionDirection(direction: string | null): 'forward' | 'backward' | 'none' {
  return direction === 'forward' || direction === 'backward' ? direction : 'none';
}

/**
 * skeletonCard - Card skeleton placeholder
 * Returns a shimmer-animated card skeleton with header and body bars.
 */
export function skeletonCard(): HTMLElement {
  return el('div', {
    class: 'skeleton-card',
    children: [
      el('div', { class: 'skeleton-header' }),
      el('div', { class: 'skeleton-body' }),
      el('div', { class: 'skeleton-body short' }),
    ],
  });
}

/**
 * skeletonList - List skeleton placeholder
 * Returns a shimmer-animated list skeleton with multiple rows.
 */
export function skeletonList(rows = 5): HTMLElement {
  const items = Array.from({ length: rows }, () =>
    el('div', { class: 'skeleton-list-item' }),
  );
  return el('div', {
    class: 'skeleton-list',
    children: items,
  });
}

/**
 * skeletonText - Text skeleton placeholder
 * Returns a shimmer-animated text line skeleton.
 */
export function skeletonText(width: 'short' | 'medium' | 'long' = 'medium'): HTMLElement {
  return el('div', { class: `skeleton-text ${width}` });
}

/**
 * showToast - Display a toast notification
 * @param message - Main message to display
 * @param type - 'success' or 'error'
 * @param duration - Auto-dismiss duration in milliseconds (default 3000)
 */
export function showToast(message: string, type: 'success' | 'error' = 'success', duration = 3000): void {
  let container = document.getElementById('toast-container') as HTMLElement | null;
  if (!container) {
    container = el('div', { id: 'toast-container', class: 'toast-container' });
    document.body.appendChild(container);
  }

  const toast = el('div', {
    class: `toast toast-${type}`,
    children: [
      el('div', {
        class: 'toast-header',
        children: [
          el('div', { class: 'toast-icon', text: type === 'success' ? '✓' : '✕' }),
          el('div', {
            class: 'toast-content',
            children: [
              el('h3', { class: 'toast-title', text: type === 'success' ? '保存成功' : '操作失败' }),
              el('p', { class: 'toast-message', text: message }),
            ],
          }),
          (() => {
            const closeBtn = el('button', { class: 'toast-close', text: '×', attrs: { type: 'button' } });
            closeBtn.onclick = () => dismissToast(toast);
            return closeBtn;
          })(),
        ],
      }),
    ],
  });

  container.appendChild(toast);

  setTimeout(() => dismissToast(toast), duration);
}

function dismissToast(toast: HTMLElement): void {
  toast.classList.add('toast-hiding');
  setTimeout(() => {
    toast.remove();
    const container = document.getElementById('toast-container');
    if (container && container.children.length === 0) {
      container.remove();
    }
  }, 300);
}
