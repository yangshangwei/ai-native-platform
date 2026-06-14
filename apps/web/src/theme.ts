/**
 * Theme Management - Dark Mode Toggle
 *
 * Features:
 * - Auto-detect system preference
 * - Manual toggle with localStorage persistence
 * - Smooth transitions
 * - Event notifications
 */

export type Theme = 'light' | 'dark' | 'auto';

const STORAGE_KEY = 'ainp-theme-preference';

let currentTheme: Theme = 'auto';
let resolvedTheme: 'light' | 'dark' = 'light';

/**
 * Initialize theme system
 * Call this once on page load
 */
export function initTheme(): void {
  // Load saved preference or default to 'auto'
  const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
  currentTheme = saved && ['light', 'dark', 'auto'].includes(saved) ? saved : 'auto';

  // Apply initial theme without transition
  document.documentElement.classList.add('no-transition');
  applyTheme(currentTheme);

  // Re-enable transitions after a frame
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.documentElement.classList.remove('no-transition');
    });
  });

  // Listen for system theme changes
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', handleSystemThemeChange);
}

/**
 * Get current theme preference (light, dark, or auto)
 */
export function getTheme(): Theme {
  return currentTheme;
}

/**
 * Get resolved theme (light or dark, auto is resolved)
 */
export function getResolvedTheme(): 'light' | 'dark' {
  return resolvedTheme;
}

/**
 * Set theme preference
 */
export function setTheme(theme: Theme): void {
  if (!['light', 'dark', 'auto'].includes(theme)) {
    console.warn(`Invalid theme: ${theme}. Using 'auto'.`);
    theme = 'auto';
  }

  currentTheme = theme;
  localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);

  // Dispatch custom event for components to react
  window.dispatchEvent(new CustomEvent('themechange', {
    detail: { theme, resolved: resolvedTheme }
  }));
}

/**
 * Toggle between light and dark modes
 * If currently on auto, switches to the opposite of current resolved theme
 */
export function toggleTheme(): void {
  if (currentTheme === 'auto') {
    // If auto, switch to opposite of current resolved
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  } else if (currentTheme === 'light') {
    setTheme('dark');
  } else {
    setTheme('light');
  }
}

/**
 * Apply theme to document
 */
function applyTheme(theme: Theme): void {
  const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

  if (theme === 'auto') {
    resolvedTheme = systemPrefersDark ? 'dark' : 'light';
  } else {
    resolvedTheme = theme;
  }

  // Apply theme attribute
  if (resolvedTheme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.classList.remove('dark');
  }

  // Update color-scheme meta tag for native browser UI
  updateColorSchemeMeta(resolvedTheme);
}

/**
 * Handle system theme preference change
 */
function handleSystemThemeChange(event: MediaQueryListEvent): void {
  if (currentTheme === 'auto') {
    resolvedTheme = event.matches ? 'dark' : 'light';
    applyTheme('auto');

    window.dispatchEvent(new CustomEvent('themechange', {
      detail: { theme: 'auto', resolved: resolvedTheme }
    }));
  }
}

/**
 * Update color-scheme meta tag
 */
function updateColorSchemeMeta(theme: 'light' | 'dark'): void {
  let meta = document.querySelector('meta[name="color-scheme"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'color-scheme');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', theme);
}

/**
 * Check if dark mode is currently active
 */
export function isDarkMode(): boolean {
  return resolvedTheme === 'dark';
}

/**
 * Check if system prefers dark mode
 */
export function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}
