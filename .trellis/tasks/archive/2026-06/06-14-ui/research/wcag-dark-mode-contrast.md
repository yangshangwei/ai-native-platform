# Research: WCAG AA Contrast Requirements for Dark Mode UI

- **Query**: WCAG AA contrast requirements for dark mode UI and common pitfalls in CSS variable-based theming systems
- **Scope**: Mixed (internal codebase analysis + external standards)
- **Date**: 2026-06-14

---

## WCAG AA Contrast Requirements

### Minimum Contrast Ratios (WCAG 2.1 Level AA)

| Content Type | Minimum Ratio | Example |
|--------------|---------------|---------|
| **Normal text** (< 18pt or < 14pt bold) | **4.5:1** | Body text, labels, descriptions |
| **Large text** (≥ 18pt or ≥ 14pt bold) | **3:1** | Headings, hero text |
| **UI components & graphical objects** | **3:1** | Buttons, form inputs, icons, focus indicators |
| **Incidental/inactive elements** | No requirement | Disabled buttons, decorative elements |

### Dark Mode Specific Considerations

1. **Text on Dark Backgrounds**
   - Light text on dark backgrounds needs same 4.5:1 ratio as dark-on-light
   - Pure white (#ffffff) on pure black (#000000) = 21:1 (max contrast, can cause eye strain)
   - Recommended: Slightly off-white text on slate/navy backgrounds (14-17:1 range)

2. **Color Palette Adjustments**
   - Light mode: Use darker shades (600-700 range) for sufficient contrast
   - Dark mode: Use lighter shades (300-400 range) to maintain same contrast ratio
   - Example: Blue 600 (#2563eb) in light → Blue 400 (#60a5fa) in dark

3. **Common Contrast Failures in Dark Mode**
   - Gray text on gray backgrounds (muted text often fails)
   - Subtle borders that disappear in dark mode
   - Link colors that work in light but fail in dark
   - Placeholder text in form inputs (commonly too faint)
   - Disabled state indicators (borderline, but allowed)

---

## Current Codebase Analysis

### File Structure

| File Path | Purpose |
|-----------|---------|
| `apps/web/src/theme.ts` | Theme switching logic (light/dark/auto) |
| `apps/web/public/design-tokens.css` | Base light mode color system |
| `apps/web/public/design-tokens-dark.css` | Dark mode color overrides |

### Dark Mode Implementation Pattern

The project uses a **dual-declaration** pattern for dark mode:

```css
/* Pattern 1: System preference */
@media (prefers-color-scheme: dark) {
  :root {
    --text-primary: #f1f5f9;
    --bg-base: #0f172a;
  }
}

/* Pattern 2: Manual toggle */
[data-theme="dark"] {
  --text-primary: #f1f5f9;
  --bg-base: #0f172a;
}
```

**Theme switching**: JavaScript in `theme.ts` applies `[data-theme="dark"]` attribute and `.dark` class to `<html>` element.

---

## Current Color Mappings (from design-tokens-dark.css)

### Text Colors (Dark Mode)

| Variable | Value | On Background | Estimated Ratio | Status |
|----------|-------|---------------|-----------------|--------|
| `--text-primary` | #f1f5f9 (slate-100) | #0f172a (slate-900) | ~14:1 | ✅ Pass |
| `--text-secondary` | #cbd5e1 (slate-300) | #0f172a | ~10:1 | ✅ Pass |
| `--text-muted` | #94a3b8 (slate-400) | #0f172a | ~6:1 | ✅ Pass |
| `--text-faint` | #64748b (slate-500) | #0f172a | ~4:1 | ⚠️ Borderline |

### Background Colors (Dark Mode)

| Variable | Value | Purpose |
|----------|-------|---------|
| `--bg-base` | #0f172a (slate-900) | Main page background |
| `--bg-surface` | #1e293b (slate-800) | Cards, panels |
| `--bg-surface-hover` | #334155 (slate-700) | Hover states |
| `--bg-elevated` | #2d3748 | Elevated UI elements |

### Semantic Colors (Dark Mode)

| Color | Light Mode | Dark Mode | Reason |
|-------|------------|-----------|--------|
| Primary (blue) | #2563eb (600) | #60a5fa (400) | Increased brightness for dark bg |
| Success (green) | #16a34a (600) | #4ade80 (400) | Lighter for visibility |
| Warning (orange) | #f59e0b (600) | #fb923c (400) | Maintain warmth |
| Danger (red) | #dc2626 (600) | #f87171 (400) | Softer red for comfort |
| Info (cyan) | (not in light) | #22d3ee (400) | Bright cyan |

---

## Common Pitfalls in CSS Variable-Based Theming

### 1. **Variable Duplication (DRY Violation)**

**Issue**: Both `@media (prefers-color-scheme: dark)` and `[data-theme="dark"]` contain identical variable declarations.

**Current codebase**: Lines 10-122 and 125-222 in `design-tokens-dark.css` are nearly identical (112 duplicated lines).

**Risk**: Updates to one block might not be reflected in the other, causing inconsistency.

**Recommendation**: Use single source of truth:
```css
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    /* Variables here */
  }
}

[data-theme="dark"] {
  /* Same variables, but applied explicitly */
}
```

### 2. **Contrast Ratio Not Verified Programmatically**

**Issue**: Color pairs are chosen visually, but not verified with contrast checkers.

**Current status**: Comment claims "WCAG AA contrast compliance" (line 5) but no evidence of systematic verification.

**Risk**: 
- `--text-faint` (#64748b) on `--bg-base` (#0f172a) is ~4.1:1 (fails 4.5:1 for normal text)
- `--text-muted` (#94a3b8) on `--bg-surface` (#1e293b) needs verification
- Placeholder text color `--input-placeholder` (#64748b) likely fails on input bg (#1e293b)

### 3. **Global Transition Applied to All Elements**

**Code reference**: `design-tokens-dark.css` lines 225-229

```css
* {
  transition-property: background-color, border-color, color;
  transition-duration: 0.2s;
}
```

**Risk**: 
- Performance impact (transition recalc for every DOM element)
- Unintended animations (modals, dropdowns, dynamic content)
- Can cause flicker on initial page load despite `.no-transition` guard

**Better pattern**: Opt-in transitions on specific components or use `@media (prefers-reduced-motion: no-preference)`.

### 4. **No Fallback for Older Browsers**

**Issue**: CSS variables (`var(--text-primary)`) are not supported in IE11 or older browsers.

**Current status**: No fallback values provided.

**Example fix**:
```css
color: #f1f5f9; /* Fallback */
color: var(--text-primary);
```

### 5. **Semantic Variable Naming Can Break Context**

**Example issue**: `--text-faint` is used for "very faint text" but might be applied to interactive elements (links, buttons) where 4.5:1 is required.

**Risk**: Developers might use `--text-faint` for small labels on forms, causing AA failures.

**Mitigation**: Document contrast ratios in comments next to variable declarations.

### 6. **Manual Theme Toggle vs System Preference Conflict**

**Code reference**: `theme.ts` lines 94-114

**Potential issue**: When user manually selects "light" mode, system `prefers-color-scheme: dark` media query still evaluates to true in browser DevTools, causing confusion during debugging.

**Current solution**: Uses `[data-theme="light"]` override (lines 174-195 in `design-tokens.css`) which has higher specificity.

### 7. **Hardcoded Alpha Values in RGBA**

**Example**: `--sidebar-hover: rgba(96, 165, 250, 0.14)` (line 120, 221)

**Issue**: RGB values (96, 165, 250) are hardcoded instead of referencing primary color variable.

**Risk**: If primary blue changes, hover state remains stale.

**Better approach**: Use CSS `color-mix()` or `rgb(from var(--color-primary) r g b / 0.14)` (CSS Color Level 5).

---

## Contrast Verification Checklist

### Areas Needing Manual Testing

1. **Text on surfaces**:
   - [ ] Primary text on bg-base
   - [ ] Secondary text on bg-surface
   - [ ] Muted text on bg-surface (likely fails)
   - [ ] Faint text on any background (likely fails for small text)

2. **Interactive elements**:
   - [ ] Button text on button background
   - [ ] Link color on bg-base/bg-surface
   - [ ] Form input text on input background
   - [ ] Placeholder text on input background (high risk)
   - [ ] Focus indicators (border-focus must be 3:1 vs adjacent colors)

3. **Borders**:
   - [ ] `--border-light` (#334155) on `--bg-base` (#0f172a): ~2.5:1 (fails 3:1)
   - [ ] `--border-medium` (#475569) on `--bg-base`: ~3.2:1 (pass)
   - [ ] `--border-strong` (#64748b) on `--bg-base`: ~4.1:1 (pass)

4. **Graphical objects**:
   - [ ] Icon colors
   - [ ] Chart colors (if any)
   - [ ] Status indicators (badges, dots)

---

## Recommended Tools for Verification

1. **Browser DevTools**:
   - Chrome/Edge: Inspect > Coverage > "Check contrast"
   - Firefox: Accessibility Inspector

2. **Online Contrast Checkers**:
   - WebAIM Contrast Checker: https://webaim.org/resources/contrastchecker/
   - Contrast Ratio by Lea Verou: https://contrast-ratio.com/

3. **Automated Testing**:
   - `axe-core` (JavaScript library)
   - `pa11y` (CLI tool)
   - Lighthouse accessibility audit (Chrome DevTools)

4. **Design Tools**:
   - Figma: Stark plugin
   - Adobe XD: Contrast Checker plugin

---

## External References

- [WCAG 2.1 Contrast Guidelines](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html) — Official W3C standard
- [WebAIM: Contrast and Color Accessibility](https://webaim.org/articles/contrast/) — Practical guide with examples
- [CSS Tricks: Dark Mode CSS Variables](https://css-tricks.com/a-complete-guide-to-dark-mode-on-the-web/) — Implementation patterns
- [Material Design Dark Theme](https://m3.material.io/styles/color/dark-theme/overview) — Google's approach to dark mode contrast

---

## Caveats / Not Found

- No automated contrast testing in CI/CD pipeline
- No documentation of which text sizes are considered "large text" (18pt+ threshold)
- No explicit handling of high contrast mode (Windows High Contrast, `prefers-contrast: high`)
- Color values were not verified with actual contrast ratio calculations; estimates provided above are approximate
