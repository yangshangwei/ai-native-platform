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
  if (['warn', 'stale', 'awaiting_human', 'awaiting_clarification'].includes(status)) return 'warn';
  if (['running', 'pending', 'claimed'].includes(status)) return 'info';
  return 'muted';
}

export function pill(label: string, kind: StatusKind = statusKind(label)): HTMLElement {
  return el('span', { class: `pill ${kind}`, text: label });
}

export function metric(label: string, value: string, hint?: string, kind: StatusKind = 'muted'): HTMLElement {
  return el('div', {
    class: 'metric-card',
    children: [
      el('span', { class: 'metric-label', text: label }),
      el('strong', { class: `metric-value ${kind}`, text: value }),
      hint ? el('span', { class: 'metric-hint', text: hint }) : null,
    ],
  });
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
