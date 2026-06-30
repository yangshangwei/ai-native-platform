import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { describe, expect, it, vi } from 'vitest';

const landingScript = readFileSync(new URL('../public/landing.js', import.meta.url), 'utf8');

function rect(top: number, height = 0): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    right: 0,
    bottom: top + height,
    left: 0,
    width: 0,
    height,
    toJSON: () => ({}),
  };
}

function setupLanding(url = 'http://127.0.0.1:5173/landing.html#top') {
  const testWindow = new Window({ url });
  testWindow.document.body.innerHTML = `
    <span id="top" aria-hidden="true"></span>
    <header class="nav">
      <a class="nav-brand" href="#top">AI Native Platform</a>
    </header>
    <main>
      <section id="how">怎么工作</section>
      <a id="how-link" href="#how">怎么工作</a>
      <a id="top-link" href="#top">回到顶部</a>
    </main>
  `;

  Object.defineProperty(testWindow, 'scrollY', { value: 200, writable: true });
  testWindow.matchMedia = vi.fn().mockReturnValue({ matches: false });

  const nav = testWindow.document.querySelector<HTMLElement>('.nav');
  const how = testWindow.document.getElementById('how');
  if (!nav || !how) throw new Error('test fixture failed');

  nav.getBoundingClientRect = vi.fn(() => rect(0, 64));
  how.getBoundingClientRect = vi.fn(() => rect(620, 100));
  testWindow.scrollTo = vi.fn();

  Function('window', 'document', 'localStorage', 'IntersectionObserver', landingScript)(
    testWindow,
    testWindow.document,
    testWindow.localStorage,
    undefined,
  );

  return testWindow;
}

function click(testWindow: Window, selector: string): void {
  const link = testWindow.document.querySelector(selector);
  if (!link) throw new Error(`Missing test link: ${selector}`);

  link.dispatchEvent(new testWindow.MouseEvent('click', { bubbles: true, cancelable: true }));
}

describe('landing anchors', () => {
  it('scrolls to the document top even when the current hash is already #top', () => {
    const testWindow = setupLanding();

    click(testWindow, '#top-link');

    expect(testWindow.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'smooth' });
    expect(testWindow.location.hash).toBe('#top');
  });

  it('keeps same-page section anchors working with sticky-nav offset', () => {
    const testWindow = setupLanding('http://127.0.0.1:5173/landing.html');

    click(testWindow, '#how-link');

    expect(testWindow.scrollTo).toHaveBeenCalledWith({ top: 744, left: 0, behavior: 'smooth' });
    expect(testWindow.location.hash).toBe('#how');
  });
});
