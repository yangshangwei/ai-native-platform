# 深色/浅色模式 UI 全方位审查与修正

## Goal

对 AI Native Platform Web 应用的深色模式和浅色模式进行全方位 UI 审查，确保两种模式下的视觉一致性、对比度合规性、以及设计系统的完整性。修正发现的所有不一致或不符合设计规范的地方。

## What I already know

### Current theme system
- Theme management: `apps/web/src/theme.ts` 
  - Supports 'light', 'dark', 'auto' modes
  - Persists preference to localStorage
  - System preference detection via media query
  - Manual toggle with smooth transitions

### Design token files
- `apps/web/public/design-tokens.css` - Light mode base tokens (Sub2API inspired)
- `apps/web/public/design-tokens-dark.css` - Dark mode overrides
- `apps/web/public/components.css` - Component styles using tokens

### Key design system elements
- Color palette: Primary (blue), Success (green), Warning (orange), Danger (red), Info (cyan), Purple
- Components: metric cards, buttons, badges, tables, charts
- Spacing, typography, shadows, transitions defined via CSS custom properties

## Research References

- [`research/wcag-dark-mode-contrast.md`](research/wcag-dark-mode-contrast.md) — WCAG AA contrast requirements, dark mode pitfalls, contrast verification checklist
- [`research/css-variable-theming-patterns.md`](research/css-variable-theming-patterns.md) — CSS variable organization, dual naming system inconsistency analysis

## Critical Issues Discovered

### Issue #1: Dual CSS Variable Naming Systems (High Priority)

**Problem**: Two conflicting variable naming systems coexist:

1. **Design Tokens System** (in `design-tokens.css`, `components.css`)
   - Semantic, hyphenated: `--bg-primary`, `--text-secondary`, `--border-light`
   - Used by component styles (.btn, .card, etc.)
   
2. **Index.html Inline System** (in `index.html` <style> block)
   - Short, non-prefixed: `--bg`, `--surface`, `--line`, `--text`, `--muted`
   - Used by layout shell (sidebar, navigation)

**Impact**: 
- Maintenance burden (dual source of truth)
- Semantic overlap (e.g., `--bg-primary` vs `--bg` serve same purpose)
- Confusion for developers

### Issue #2: Variable Duplication in Dark Mode

**Problem**: Dark mode variables are duplicated in both `@media (prefers-color-scheme: dark)` and `[data-theme="dark"]` selector (112 lines of duplication in `design-tokens-dark.css`).

**Impact**: Updates to one block might not be reflected in the other.

### Issue #3: Contrast Ratio Failures (WCAG AA)

**Problem**: Several color pairs fail or are borderline for WCAG AA compliance:

- `--text-faint` (#64748b) on `--bg-base` (#0f172a): ~4.1:1 (fails 4.5:1 for normal text)
- `--input-placeholder` (#64748b) on `--input-bg` (#1e293b): likely fails
- `--border-light` (#334155) on `--bg-base` (#0f172a): ~2.5:1 (fails 3:1 for UI components)

### Issue #4: Performance - Global Transition

**Problem**: Universal `*` selector applies transitions to all elements (lines 225-229 in `design-tokens-dark.css`).

**Impact**: Performance overhead, unintended animations on modals/dropdowns.

## Requirements (evolving)

### Phase 1: Consolidate CSS Variable Systems
- [ ] Audit all usages of short-name variables (`--bg`, `--surface`, etc.) in `index.html`
- [ ] Map short names to design token equivalents
- [ ] Replace inline variable references with design token variables
- [ ] Remove duplicate variable definitions from `index.html`
- [ ] Update all TypeScript modules if they reference inline variables

### Phase 2: Fix Dark Mode Duplication
- [ ] Consolidate duplicated variables in `design-tokens-dark.css`
- [ ] Use single source of truth pattern (either extract to shared block or use CSS nesting)

### Phase 3: Fix Contrast Failures
- [ ] Verify all text/background pairs with contrast checker
- [ ] Adjust `--text-faint` to meet 4.5:1 ratio (or document as decorative only)
- [ ] Adjust `--input-placeholder` to meet 4.5:1 ratio
- [ ] Adjust `--border-light` to meet 3:1 ratio for UI components
- [ ] Add comments documenting contrast ratios

### Phase 4: Optimize Transitions
- [ ] Remove universal `*` transition selector
- [ ] Apply transitions only to specific themeable components
- [ ] Consider `@media (prefers-reduced-motion)` respect

### Phase 5: Validate (验证修正)
- [ ] Test all pages in light mode
- [ ] Test all pages in dark mode
- [ ] Verify theme toggle smooth transition
- [ ] Run automated contrast checker (if available)
- [ ] Generate audit report with before/after comparisons

## Technical Approach

### Phase 1: Variable Consolidation Strategy

**Decision**: Migrate inline variables to design token system (not the reverse) because:
- Design tokens already used by `components.css` (more extensive)
- Semantic naming is more maintainable
- Follows Sub2API design system conventions

**Mapping table** (inline → design tokens):

| Inline Variable | Design Token Equivalent | Notes |
|----------------|------------------------|-------|
| `--bg` | `--bg-base` | Main background (add if missing) |
| `--surface` | `--bg-surface` | Card/panel background |
| `--surface-2` | `--bg-surface-hover` | Hover state |
| `--line` | `--border-light` | Light border |
| `--line-strong` | `--border-medium` | Medium border |
| `--text` | `--text-primary` | Primary text |
| `--muted` | `--text-muted` | Muted text |
| `--faint` | `--text-faint` | Very faint text |
| `--primary` | `--color-primary` | Primary brand color |
| `--good` | `--color-success` | Success state |
| `--bad` | `--color-danger` | Danger state |
| `--warn` | `--color-warning` | Warning state |

### Phase 2: Contrast Fixes

Adjust these variables to meet WCAG AA:

```css
/* Before */
--text-faint: #64748b;  /* ~4.1:1 on dark bg */

/* After */
--text-faint: #94a3b8;  /* ~6:1 on dark bg */
```

```css
/* Before */
--border-light: #334155;  /* ~2.5:1 */

/* After */
--border-light: #475569;  /* ~3.2:1 */
```

### Phase 3: Remove Duplication

Use single declaration with cascade:

```css
/* Strategy: Keep data-theme as single source */
[data-theme="light"] {
  /* Light variables */
}

[data-theme="dark"] {
  /* Dark variables */
}

/* Media query as fallback only */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) {
    /* Same as [data-theme="dark"] */
  }
}
```

## Acceptance Criteria

- [ ] Single CSS variable naming system (design tokens only)
- [ ] All inline styles migrated to use design token variables
- [ ] Zero variable duplication in dark mode definitions
- [ ] All text/background pairs meet WCAG AA contrast (4.5:1 normal, 3:1 large/UI)
- [ ] Transitions scoped to specific components (no universal `*`)
- [ ] Theme toggle works smoothly in light/dark/auto modes
- [ ] Visual consistency across all pages in both themes
- [ ] Audit report generated with contrast verification results

## Definition of Done

- 所有发现的 UI 不一致问题已修正
- 深色/浅色模式通过人工视觉验证
- 代码通过 lint/typecheck
- 生成 audit report（markdown 格式）
- 提交 PR 并推送

## Technical Notes

### Files to audit
- `apps/web/public/design-tokens.css`
- `apps/web/public/design-tokens-dark.css`
- `apps/web/public/components.css`
- `apps/web/src/*.ts` (all page modules)
- `apps/web/index.html`

### Known constraints
- Must maintain Sub2API design system aesthetic
- Smooth transitions (0.2s) already implemented
- Theme persistence via localStorage
- Auto-detection of system preference

## Out of Scope

- 添加新的设计 token 或颜色变量（仅修正现有）
- 重构组件结构（仅修正样式）
- 添加新的主题模式（如 high-contrast）
- 性能优化（CSS 加载、渲染性能）
