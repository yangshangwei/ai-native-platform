/**
 * Landing page behavior — AI Native Platform.
 * Two concerns, both vanilla / dependency-free:
 *   1. Theme toggle (light/dark) persisted to localStorage, honoring the
 *      system preference on first visit. Mirrors the [data-theme] convention
 *      the main app uses so the shared design tokens resolve correctly.
 *   2. In-page hash links with sticky-nav-safe scrolling. Native repeated
 *      clicks on the current hash are no-ops, so #top needs explicit handling.
 *   3. Scroll-reveal via IntersectionObserver — the one piece the existing
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

  /* ---------- Hash scrolling ---------- */
  function currentPath() {
    return window.location.pathname.replace(/\/+$/, '');
  }

  function targetFromHash(hash) {
    if (!hash || hash === '#') return null;
    if (hash === '#top') return { hash: hash, top: 0 };

    var id = hash.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch (e) {
      return null;
    }

    var target = document.getElementById(id);
    if (!target) return null;

    var nav = document.querySelector('.nav');
    var navHeight = nav ? nav.getBoundingClientRect().height : 0;
    var top = target.getBoundingClientRect().top + window.scrollY - navHeight - 12;
    return { hash: hash, top: Math.max(0, top) };
  }

  function samePageHash(anchor) {
    var rawHref = anchor.getAttribute('href') || '';
    if (rawHref.charAt(0) === '#') return rawHref;

    try {
      var url = new URL(rawHref, window.location.href);
      if (url.origin !== window.location.origin) return null;
      if (url.pathname.replace(/\/+$/, '') !== currentPath()) return null;
      return url.hash || null;
    } catch (e) {
      return null;
    }
  }

  function scrollToHash(hash) {
    var target = targetFromHash(hash);
    if (!target) return false;

    if (window.location.hash !== target.hash) {
      window.history.pushState(null, '', target.hash);
    }

    window.scrollTo({ top: target.top, left: 0, behavior: 'smooth' });
    return true;
  }

  function initHashLinks() {
    document.addEventListener('click', function (event) {
      var anchor = event.target.closest ? event.target.closest('a[href]') : null;
      if (!anchor) return;

      var hash = samePageHash(anchor);
      if (!hash || !targetFromHash(hash)) return;

      event.preventDefault();
      scrollToHash(hash);
    });
  }

  initHashLinks();

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
