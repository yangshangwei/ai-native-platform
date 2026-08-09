/**
 * Lightweight tooltip system for technical term explanations.
 *
 * Usage: tooltipTerm('Gate', 'Quality gates are...') returns a <span>
 * that shows a tooltip on hover. CSS positioning and show/hide in styles.css.
 */

export function tooltipTerm(term: string, explanation: string): HTMLElement {
  const wrapper = document.createElement('span');
  wrapper.className = 'tooltip-term';
  wrapper.textContent = term;
  wrapper.setAttribute('data-tooltip', explanation);
  return wrapper;
}

/**
 * Inline help icon with tooltip — sits next to a label or heading.
 */
export function tooltipIcon(explanation: string): HTMLElement {
  const icon = document.createElement('span');
  icon.className = 'tooltip-icon';
  icon.textContent = '?';
  icon.setAttribute('data-tooltip', explanation);
  icon.setAttribute('aria-label', explanation);
  return icon;
}
