/**
 * Landing page behavior — AI Native Platform.
 * Two concerns, both vanilla / dependency-free:
 *   1. Theme toggle (light/dark) persisted to localStorage, honoring the
 *      system preference on first visit. Mirrors the [data-theme] convention
 *      the main app uses so the shared design tokens resolve correctly.
 *   2. Scroll-reveal via IntersectionObserver — the one piece the existing
 *      animations.css layer doesn't provide. Reveals once, then unobserves.
 *      Falls back to showing everything if the API is unavailable or the user
 *      prefers reduced motion.
 */
(function () {
  'use strict';

  /* ---------- Theme ---------- */
  var STORAGE_KEY = 'ainp-theme';
  var root = document.documentElement;

  function systemPrefersDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
  }

  function initTheme() {
    var stored = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      /* localStorage may be unavailable (private mode); fall back to system. */
    }
    applyTheme(stored || (systemPrefersDark() ? 'dark' : 'light'));
  }

  function toggleTheme() {
    var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch (e) {
      /* ignore persistence failure */
    }
  }

  initTheme();

  var toggle = document.getElementById('theme-toggle');
  if (toggle) toggle.addEventListener('click', toggleTheme);

  /* ---------- Scroll reveal ---------- */
  function revealAll(nodes) {
    for (var i = 0; i < nodes.length; i++) nodes[i].classList.add('is-visible');
  }

  function initReveal() {
    var nodes = document.querySelectorAll('.reveal');
    if (!nodes.length) return;

    var prefersReduced =
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // No observer or reduced motion → show everything immediately.
    if (prefersReduced || typeof IntersectionObserver === 'undefined') {
      revealAll(nodes);
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i];
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
    );

    for (var i = 0; i < nodes.length; i++) observer.observe(nodes[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initReveal);
  } else {
    initReveal();
  }
})();
