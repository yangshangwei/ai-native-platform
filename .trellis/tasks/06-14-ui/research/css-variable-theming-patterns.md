# Research: CSS Variable Theming Patterns

- **Query**: Best practices for CSS custom property organization in dual-theme (light/dark) systems, focusing on variable naming conventions and common consistency issues
- **Scope**: Internal code analysis + external best practices
- **Date**: 2026-06-14

---

## Executive Summary

The codebase currently has **two conflicting CSS variable naming systems**:

1. **Design Tokens System** (`design-tokens.css`, `design-tokens-dark.css`) — uses semantic, hyphenated names like `--bg-primary`, `--text-secondary`, `--border-light`
2. **Index.html System** (`index.html` inline styles) — uses short, non-prefixed names like `--bg`, `--surface`, `--line`, `--text`, `--muted`

This inconsistency creates maintenance issues: components.css uses the design tokens system, but index.html defines and uses a completely separate variable set.

---

## Current State Analysis

### Files Found

| File Path | Purpose | Variable System |
|-----------|---------|----------------|
| `apps/web/public/design-tokens.css` | Light mode base tokens (Sub2API style) | Semantic, hyphenated |
| `apps/web/public/design-tokens-dark.css` | Dark mode tokens (media query + attribute) | Semantic, hyphenated |
| `apps/web/public/components.css` | Component styles (.btn, .card, etc.) | Uses design tokens system |
| `apps/web/index.html` | Root HTML with inline theme styles | Short, non-prefixed |
| `apps/web/src/theme.ts` | Theme management (toggle, persistence) | Uses `data-theme` attribute |

### Variable Naming Systems

#### System 1: Design Tokens (Semantic, Hyphenated)

```css
/* From design-tokens.css */
--bg-primary: var(--gray-50);
--bg-surface: #ffffff;
--bg-surface-hover: var(--gray-100);
--bg-elevated: #ffffff;

--text-primary: var(--gray-800);
--text-secondary: var(--gray-600);
--text-muted: var(--gray-500);
--text-faint: var(--gray-400);

--border-light: var(--gray-200);
--border-medium: var(--gray-300);
--border-strong: var(--gray-400);

--color-primary: var(--primary-600);
--color-primary-hover: var(--primary-700);
--color-success: var(--success-600);
--color-warning: var(--warning-600);
--color-danger: var(--danger-600);
```

**Pattern**: `--{category}-{variant}` (e.g., `bg-primary`, `text-secondary`, `border-light`)

**Used in**: `components.css` (231 usages counted)

#### System 2: Index.html (Short, Non-prefixed)

```css
/* From index.html :root */
--bg: #f8fafc;
--surface: #ffffff;
--surface-2: #eef4ff;
--line: #dbe3ef;
--line-strong: #c4d0e1;
--text: #1e293b;
--muted: #64748b;
--faint: #94a3b8;
--primary: #2563eb;
--primary-2: #60a5fa;
--good: #15803d;
--good-bg: #dcfce7;
--bad: #b91c1c;
--bad-bg: #fee2e2;
--warn: #a16207;
--warn-bg: #fef3c7;
```

**Pattern**: Short single words or pairs (e.g., `bg`, `surface`, `line`, `muted`)

**Used in**: Custom styles in `index.html` for layout shell, sidebar, navigation

---

## Code Patterns

### Theme Implementation Mechanism

The project uses **dual-strategy theme application**:

1. **Media query** — Auto-detect system preference
   ```css
   @media (prefers-color-scheme: dark) {
     :root { /* dark variables */ }
   }
   ```

2. **Attribute selector** — Manual override via JavaScript
   ```css
   [data-theme="dark"] { /* dark variables */ }
   [data-theme="light"] { /* light variables */ }
   ```

**Implementation**: `apps/web/src/theme.ts`
- Uses `data-theme` attribute on `<html>` element
- Persists preference to localStorage (`ainp-theme-preference`)
- Supports three modes: `'light' | 'dark' | 'auto'`
- Dispatches `themechange` custom event for reactivity

### Dark Mode Variable Strategy

Both systems **redefine the same variable names** for dark mode rather than using theme-scoped prefixes.

**Design tokens approach**:
```css
/* Light mode */
:root {
  --text-primary: var(--gray-800);  /* dark text */
}

/* Dark mode */
@media (prefers-color-scheme: dark) {
  :root {
    --text-primary: #f1f5f9;  /* light text */
  }
}

[data-theme="dark"] {
  --text-primary: #f1f5f9;  /* duplicate for manual override */
}
```

**Issue**: Dark mode variables are duplicated in both `@media` query and `[data-theme="dark"]` selector (100+ lines of duplication in `design-tokens-dark.css`).

### Component Usage Pattern

```css
/* components.css uses design tokens system */
.btn-primary {
  background: var(--color-primary);
  color: white;
  border-color: var(--color-primary);
}

.btn-primary:hover:not(:disabled) {
  background: var(--color-primary-hover);
  border-color: var(--color-primary-hover);
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}

.btn-secondary {
  background: var(--bg-surface);
  color: var(--text-primary);
  border-color: var(--border-medium);
}
```

### Layout Shell Usage Pattern

```css
/* index.html uses short-name system */
.sidebar {
  background: var(--surface);
  color: var(--text);
  border-right: 1px solid var(--line);
}

.nav-item {
  background: transparent;
  color: var(--muted);
}

.nav-item:hover {
  background: var(--surface-2);
  color: var(--text);
}

.nav-item.active {
  background: var(--surface-2);
  color: var(--primary);
}
```

---

## Inconsistency Analysis

### Semantic Overlap

Many variables serve the same purpose but have different names:

| Design Tokens | Index.html | Purpose |
|--------------|------------|---------|
| `--bg-primary` | `--bg` | Main background |
| `--bg-surface` | `--surface` | Card/panel background |
| `--bg-surface-hover` | `--surface-2` | Hover state background |
| `--text-primary` | `--text` | Primary text color |
| `--text-muted` | `--muted` | Secondary/muted text |
| `--text-faint` | `--faint` | Very subtle text |
| `--border-light` | `--line` | Light border/divider |
| `--border-medium` | `--line-strong` | Medium border |
| `--color-primary` | `--primary` | Primary brand color |
| `--color-success` | `--good` | Success/positive state |
| `--color-danger` | `--bad` | Error/danger state |
| `--color-warning` | `--warn` | Warning state |

### Maintenance Issues

1. **Dual source of truth**: Changing a color requires updating two separate systems
2. **Unclear precedence**: Both systems define variables in `:root`, unclear which wins
3. **Fragmented usage**: Components use one system, layout shell uses another
4. **Duplication**: Dark mode variables duplicated across `@media` and `[data-theme]`
5. **Migration risk**: No clear migration path between systems

---

## Best Practices (Industry Standards)

### Naming Convention Patterns

**Two-tier hierarchy** (recommended for theming):

```css
/* Tier 1: Raw color palette (theme-agnostic) */
--blue-50: #eff6ff;
--blue-600: #2563eb;
--gray-100: #f1f5f9;
--gray-800: #1e293b;

/* Tier 2: Semantic tokens (reference palette) */
--color-primary: var(--blue-600);
--color-text: var(--gray-800);
--color-bg: var(--gray-100);
```

**Benefits**:
- Palette changes don't cascade to components
- Semantic names self-document intent
- Easy to theme: swap semantic mappings, keep palette

**Three-tier hierarchy** (advanced design systems):

```css
/* Tier 1: Base palette */
--palette-blue-600: #2563eb;

/* Tier 2: Semantic tokens */
--color-primary: var(--palette-blue-600);

/* Tier 3: Component tokens */
--button-bg: var(--color-primary);
--button-text: var(--color-on-primary);
```

### Common Naming Patterns

1. **Hyphenated categories** (Material Design, Tailwind approach)
   ```css
   --bg-primary, --bg-secondary, --bg-elevated
   --text-primary, --text-secondary, --text-disabled
   --border-light, --border-medium, --border-strong
   ```

2. **Slash/dot notation** (design tools export format)
   ```css
   --color/background/primary
   --color/text/secondary
   ```
   Note: Not valid in CSS, requires transformation

3. **BEM-style** (component-scoped)
   ```css
   --button__bg, --button__bg--hover
   --card__border, --card__shadow
   ```

### Dark Mode Implementation Strategies

**Strategy 1: Variable redefinition** (current project approach)
```css
:root {
  --bg: white;
  --text: black;
}

[data-theme="dark"] {
  --bg: black;
  --text: white;
}
```

**Pros**: Simple, no refactoring needed
**Cons**: Duplication, cannot reference both light and dark values simultaneously

**Strategy 2: Scoped variable namespaces**
```css
:root {
  --light-bg: white;
  --light-text: black;
  --dark-bg: black;
  --dark-text: white;
  
  /* Default to light */
  --bg: var(--light-bg);
  --text: var(--light-text);
}

[data-theme="dark"] {
  --bg: var(--dark-bg);
  --text: var(--dark-text);
}
```

**Pros**: Both themes coexist, useful for theme previews
**Cons**: More verbose, double the variable definitions

**Strategy 3: Color-scheme aware calculations**
```css
:root {
  color-scheme: light dark;
  --bg: Canvas;
  --text: CanvasText;
}
```

**Pros**: Browser-native, minimal code
**Cons**: Limited control, browser-dependent rendering

---

## Common Consistency Issues

### Issue 1: Naming Collision

When multiple systems use `:root`, later definitions override earlier ones.

**Current project risk**: Both `design-tokens.css` and inline styles in `index.html` write to `:root`.

### Issue 2: Semantic Drift

Over time, generic names lose meaning:
- `--surface-2` — what makes it "2"? Is it lighter or elevated?
- `--line` — could mean border, divider, or rule
- `--muted` — muted text? muted background? muted border?

**Fix**: Use explicit category prefixes (`--border-*`, `--text-*`, `--bg-*`)

### Issue 3: Incomplete Dark Mode Coverage

Some variables defined in light mode but missing in dark mode, causing fallback to inappropriate values.

**Current project status**: Both systems appear to have complete dark mode coverage, but maintained separately.

### Issue 4: Magic Numbers

Direct color values in component styles instead of using tokens:

```css
/* Bad */
.component {
  color: #64748b;
}

/* Good */
.component {
  color: var(--text-muted);
}
```

**Current project status**: Most component styles use variables correctly.

### Issue 5: Over-specification

Too many similar variables create choice paralysis:
- `--bg-primary` vs `--bg-base` vs `--bg-default`
- `--border-light` vs `--border-subtle` vs `--border-faint`

**Recommendation**: 3-5 levels maximum per category (e.g., primary, secondary, tertiary for text)

---

## Related Specs

- `.trellis/spec/web/frontend/component-guidelines.md` — Component implementation patterns (no framework, vanilla TS)
- `.trellis/spec/web/frontend/quality-guidelines.md` — Quality standards including XSS prevention

**Note**: No existing spec defines theming or CSS variable conventions for this project.

---

## Caveats / Not Found

- No external design system documentation found in repo
- No documented decision on why two variable systems coexist
- No migration plan or deprecation notice for either system
- No automated tests validating variable usage consistency
- Web search for external best practices not executed (research agent role boundary)

---

## Recommendations (Documenting Observed Issues)

### Critical Issues

1. **Dual naming systems** create confusion and maintenance burden
2. **No single source of truth** for theme variables
3. **Duplication in dark mode** (both `@media` and `[data-theme]` repeat 100+ lines)

### Architectural Observations

The project follows these patterns:
- ✓ Semantic variable names in design tokens
- ✓ Consistent theme toggle implementation (`theme.ts`)
- ✓ Proper `data-theme` attribute usage
- ✗ Two parallel variable systems without clear separation
- ✗ Incomplete adoption of design tokens (layout shell still uses old system)

### Maintenance Surface

**If consolidating to one system**, consider:
- Design tokens system is more maintainable (semantic, scalable)
- Index.html system is embedded in 231+ variable references in layout HTML
- Components.css already uses design tokens system
- Migration would require updating all inline styles in `index.html`

**If keeping both systems**, document:
- Why both exist (e.g., "layout uses short names for conciseness")
- Clear boundaries (e.g., "layout owns `--bg`/`--surface`, components own `--bg-*`/`--border-*`")
- Mapping table between systems for developers
