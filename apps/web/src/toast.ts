/**
 * Toast notification system — elegant auto-dismissing notifications with countdown.
 *
 * Replaces the static success/error notices with floating toast notifications
 * that automatically disappear after 3 seconds with a visual countdown.
 */

import { el } from './dom';

interface ToastOptions {
  type: 'success' | 'error';
  title: string;
  message: string;
  duration?: number; // milliseconds, default 3000
}

let toastContainer: HTMLElement | null = null;

function ensureToastContainer(): HTMLElement {
  if (!toastContainer) {
    toastContainer = el('div', {
      class: 'toast-container',
      // a11y: a labeled region so assistive tech can locate notifications;
      // per-toast role/aria-live (set below) drives the actual announcement.
      attrs: { role: 'region', 'aria-label': '通知' },
    });
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

export function showToast(options: ToastOptions): void {
  const { type, title, message, duration = 3000 } = options;
  const container = ensureToastContainer();

  // Create toast elements
  const icon = el('div', {
    class: 'toast-icon',
    text: type === 'success' ? '✓' : '✕',
  });

  const content = el('div', {
    class: 'toast-content',
    children: [
      el('h3', { class: 'toast-title', text: title }),
      el('p', { class: 'toast-message', text: message }),
    ],
  });

  const countdownNumber = el('span', {
    class: 'toast-countdown-number',
    text: String(Math.ceil(duration / 1000)),
  });

  const countdown = el('div', {
    class: 'toast-countdown',
    children: [
      el('span', { text: '自动关闭:' }),
      countdownNumber,
      el('span', { text: '秒' }),
    ],
  });

  const closeButton = el('button', {
    class: 'toast-close',
    text: '×',
    attrs: { 'aria-label': '关闭通知', type: 'button' },
  });

  const progressBar = el('div', { class: 'toast-progress' });

  const toast = el('div', {
    class: `toast toast-${type} toast-enter`,
    // a11y: errors are assertive (interrupt), successes are polite.
    attrs: {
      role: type === 'error' ? 'alert' : 'status',
      'aria-live': type === 'error' ? 'assertive' : 'polite',
    },
    children: [
      el('div', { class: 'toast-header', children: [icon, content, closeButton] }),
      countdown,
      progressBar,
    ],
  });

  // Animation and auto-dismiss logic
  let startTime = Date.now();
  let animationFrame: number;
  let countdownInterval: ReturnType<typeof setInterval>;

  const updateProgress = () => {
    const elapsed = Date.now() - startTime;
    const remaining = Math.max(0, duration - elapsed);
    // Guard against a zero/negative duration so the scale never becomes NaN.
    const progress = duration > 0 ? remaining / duration : 0;

    progressBar.style.transform = `scaleX(${progress})`;

    if (remaining > 0) {
      animationFrame = requestAnimationFrame(updateProgress);
    } else {
      dismissToast();
    }
  };

  const updateCountdown = () => {
    const elapsed = Date.now() - startTime;
    const remaining = Math.max(0, duration - elapsed);
    const seconds = Math.ceil(remaining / 1000);
    countdownNumber.textContent = String(seconds);
  };

  const dismissToast = () => {
    cancelAnimationFrame(animationFrame);
    clearInterval(countdownInterval);

    toast.classList.remove('toast-enter');
    toast.classList.add('toast-exit');
    setTimeout(() => {
      if (toast.parentElement) {
        container.removeChild(toast);
      }
      // Clean up container if empty
      if (container.children.length === 0 && container.parentElement) {
        document.body.removeChild(container);
        toastContainer = null;
      }
    }, 200); // Match toast-exit animation duration
  };

  closeButton.onclick = dismissToast;

  // Start animations
  container.appendChild(toast);
  animationFrame = requestAnimationFrame(updateProgress);
  countdownInterval = setInterval(updateCountdown, 100);
}

export function showSuccessToast(message: string, title = '操作成功'): void {
  showToast({ type: 'success', title, message });
}

export function showErrorToast(message: string, title = '操作失败'): void {
  showToast({ type: 'error', title, message });
}
