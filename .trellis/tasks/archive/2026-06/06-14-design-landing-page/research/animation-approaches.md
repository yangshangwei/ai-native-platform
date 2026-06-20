# Research: Lightweight Animation & Micro-Interaction Patterns for Landing Pages

> Scope: CSS-only animations, vanilla-JS scroll effects, SVG techniques, performance, and minimal-dependency examples. No framework (GSAP / Framer Motion / Lottie / AOS) required.
> Date: 2026-06-14
> Note: External web-search tooling was unavailable in this session; external references below are drawn from established, stable domain knowledge (MDN, web.dev, CSS Triggers, caniuse). Internal codebase findings are fully verified with file paths and line numbers.

---

## 1. Existing Animation Infrastructure in This Repo (verified)

The project already ships a complete, framework-free animation layer. A landing page should **reuse these tokens and the existing `prefers-reduced-motion` block** rather than introduce new dependencies.

### 1.1 Animation library — `apps/web/public/animations.css`
A single CSS file (349 lines) with reusable `@keyframes` + utility classes:

| Category | Keyframes / Classes | Lines |
|----------|---------------------|-------|
| Page transitions | `fadeIn`, `fadeOut` → `.page-enter`, `.page-exit` | 10–34 |
| Skeleton loading | `skeleton` (gradient sweep) → `.skeleton`, dark-mode variant | 40–71 |
| Toast slide | `slideInRight/OutRight/InTop/OutTop` → `.toast-enter`, `.toast-top-enter` | 77–135 |
| Button feedback | `buttonPress`, `ripple` → `.btn-press`, `.btn-interactive` (`::after` ripple) | 141–194 |
| Dropdown | `dropdownSlideDown/Up/ScaleIn` → `.dropdown-enter`, `.dropdown-scale-enter` | 200–244 |
| Utility loops | `spin`, `pulse`, `bounce` → `.spin`, `.pulse`, `.bounce` | 250–287 |
| **Reduced motion** | global `@media (prefers-reduced-motion: reduce)` kill-switch | 293–320 |
| Transition utils | `.transition-fast/base/slow/colors/transform/opacity` | 326–348 |

Key patterns already established here, directly reusable on a landing page:
- All animations are **opacity + transform** only (GPU-friendly — see §5).
- `cubic-bezier(0.4, 0, 0.2, 1)` (Material standard ease) used for enters; `cubic-bezier(0.4, 0, 1, 1)` for exits.
- Comprehensive reduced-motion block at lines 293–320 that nukes `animation-duration`/`transition-duration` to `0.01ms`.

### 1.2 Design tokens — `apps/web/public/design-tokens.css`
Pre-defined timing + elevation tokens (verified):
```
--transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);   /* line 160 */
--transition-base: 200ms cubic-bezier(0.4, 0, 0.2, 1);   /* line 161 */
--transition-slow: 300ms cubic-bezier(0.4, 0, 0.2, 1);   /* line 162 */
--shadow-sm / -md / -lg / -xl                             /* lines 129–132 */
```
A landing page should bind hover/reveal timing to `var(--transition-*)` for consistency.

### 1.3 Hover micro-interactions already in use — `apps/web/public/components.css`
- `.metric-card-v2:hover` → `box-shadow: var(--shadow-md); transform: translateY(-1px)` (lines 54–57)
- `.card-enhanced:hover` → shadow lift (lines 146–148)
- `.btn-primary/secondary/danger:hover` → `transform: translateY(-1px)` + shadow (lines 203–232)
- `.data-table tbody tr:hover` → background swap (line 339)

These "lift on hover" patterns are the house style and should extend to landing-page cards/CTAs.

### 1.4 Reduced-motion handling — `apps/web/public/utilities.css`
Second `@media (prefers-reduced-motion: reduce)` block at line 356 (in addition to the one in animations.css). Any new landing-page animation must respect this convention.

### 1.5 What is NOT present (gap for landing page)
- **`IntersectionObserver`: 0 occurrences** across `apps/` (verified via grep). No scroll-reveal infrastructure exists — this is net-new work for a landing page.
- No parallax / scroll-linked / `scroll-snap` usage found.
- `requestAnimationFrame` is used (toast progress, scroll-position restore, theme flash-prevention in `theme.ts`) but never for scroll-reveal.

**Implication:** The landing page can rely 100% on existing CSS keyframes/tokens for entrance/hover/loop effects, and only needs to add a small vanilla-JS `IntersectionObserver` helper for scroll-triggered reveals.

---

## 2. CSS-Only Animation Techniques (keyframes / transitions / transforms)

### 2.1 Transitions for micro-interactions (cheapest, no JS)
Best for hover/focus/active state changes. Always transition specific properties, never `all`, and prefer `transform`/`opacity`.
```css
.cta {
  transition: transform var(--transition-fast), box-shadow var(--transition-fast);
}
.cta:hover { transform: translateY(-2px); box-shadow: var(--shadow-lg); }
.cta:active { transform: translateY(0); }
```

### 2.2 Keyframe entrance animations (hero, on load)
Reuse `fadeIn` / `slideInTop` from animations.css. For staggered hero elements, use per-child `animation-delay`:
```css
.hero > * { animation: fadeIn 0.5s cubic-bezier(0.4,0,0.2,1) both; }
.hero > *:nth-child(1) { animation-delay: 0.0s; }
.hero > *:nth-child(2) { animation-delay: 0.1s; }
.hero > *:nth-child(3) { animation-delay: 0.2s; }
```
`animation-fill-mode: both` (the `both` keyword) keeps element hidden pre-start and pinned post-end — prevents flash-of-unstyled-content.

### 2.3 Modern CSS-only scroll & state primitives (progressive enhancement)
These eliminate JS for several common effects (use as enhancement, fall back gracefully):

| Feature | Use case | Support note |
|---------|----------|--------------|
| `animation-timeline: view()` / `scroll()` | **Scroll-driven** reveal & progress bars with zero JS | Chromium 115+ / Firefox behind flag; not Safari-stable. Use as enhancement only. |
| `@starting-style` + `transition` | Enter animation for elements appearing (incl. `display:none`→block, popovers) | Chromium 117+, Safari 17.5+, Firefox 129+ |
| `transition-behavior: allow-discrete` | Animate `display`/`visibility` on/off | Same as above |
| `scroll-behavior: smooth` | Anchor-nav smooth scroll | Broad support; respect reduced-motion |
| `scroll-snap-type` / `scroll-snap-align` | Section/carousel snapping | Broad support |
| `:has()` selector | Parent-state micro-interactions w/o JS | Broad modern support |
| CSS `@property` | Animate gradients/custom props (e.g. animated border-gradient) | Chromium/Safari yes, FF 128+ |

**Recommendation for this repo:** Because Safari lacks stable `animation-timeline`, treat CSS scroll-driven animation as *enhancement* and use the JS IntersectionObserver path (§3) as the reliable baseline.

### 2.4 Animated gradient / shimmer (CSS-only)
The existing `.skeleton` (animations.css lines 40–59) is the template: a `linear-gradient` with `background-size: 200%` animated via `background-position`. Same trick produces animated CTA borders and text shimmer without JS.

---

## 3. Vanilla-JS Scroll-Triggered Effects (Intersection Observer)

This is the **primary net-new pattern** the landing page needs (zero IO usage exists today).

### 3.1 Canonical reveal-on-scroll pattern
```css
/* initial hidden state */
.reveal { opacity: 0; transform: translateY(24px);
          transition: opacity 0.6s ease, transform 0.6s ease; }
.reveal.is-visible { opacity: 1; transform: none; }

@media (prefers-reduced-motion: reduce) {
  .reveal { opacity: 1; transform: none; transition: none; }
}
```
```js
const els = document.querySelectorAll('.reveal');
if (!('IntersectionObserver' in window) ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  els.forEach(el => el.classList.add('is-visible')); // graceful fallback: show all
} else {
  const io = new IntersectionObserver((entries, obs) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('is-visible');
      obs.unobserve(e.target);            // one-shot → cheap, no re-trigger
    }
  }, { threshold: 0.15, rootMargin: '0px 0px -10% 0px' });
  els.forEach(el => io.observe(el));
}
```
Key choices:
- **`unobserve` after first reveal** — avoids holding observers / re-running.
- **`rootMargin` bottom-negative** — fires slightly before element fully enters viewport (feels responsive).
- **`threshold: 0.1–0.2`** — triggers once ~15% visible.
- **Always provide a fallback** that shows content if IO unsupported or reduced-motion is set (never leave content stuck at `opacity:0`).

### 3.2 Staggered list reveals
Apply incremental `transition-delay` via inline style or `--i` custom property:
```css
.reveal.is-visible { transition-delay: calc(var(--i, 0) * 80ms); }
```
```js
els.forEach((el, i) => el.style.setProperty('--i', i % 6)); // cap stagger depth
```

### 3.3 Scroll progress / parallax (use sparingly)
- **Scroll progress bar:** a single passive `scroll` listener computing `scrollY / (scrollHeight - innerHeight)` → set a CSS var width. Throttle via `requestAnimationFrame` (pattern already used in `apps/web/src/toast.ts:100,135` and `render-core.ts:91`).
- **Parallax:** prefer pure-CSS `transform: translateZ()` + `perspective` for layered depth (no JS, compositor-only) over JS scroll math. JS parallax forces layout reads on every frame — avoid unless necessary.
- **Passive listeners:** always `addEventListener('scroll', fn, { passive: true })` to avoid blocking scroll.

### 3.4 Repo conventions to follow
- `requestAnimationFrame` for any per-frame DOM work (established: `toast.ts`, `stream.ts`, `theme.ts`, `page-reports.ts`).
- TypeScript source lives in `apps/web/src/`; a `reveal.ts` helper would fit the existing module pattern (small focused modules like `theme.ts`, `dom.ts`).

---

## 4. SVG Animation Techniques

### 4.1 CSS-driven SVG (preferred — lightest)
- Animate `transform`, `opacity`, `fill`, `stroke` on SVG elements via the same CSS `@keyframes`/`transition` engine. Inline the SVG in markup so CSS can target its parts.
- Use `transform-box: fill-box` + `transform-origin: center` so SVG element transforms rotate/scale around their own center.

### 4.2 Line-draw / stroke animation (no JS)
The classic "self-drawing" effect — ideal for hero illustrations, logos, checkmarks:
```css
.draw path {
  stroke-dasharray: var(--len);     /* = path total length */
  stroke-dashoffset: var(--len);
  animation: draw 1.2s ease forwards;
}
@keyframes draw { to { stroke-dashoffset: 0; } }
```
Get `var(--len)` from `path.getTotalLength()` (one tiny JS read) or hardcode after measuring.

### 4.3 SMIL `<animate>` (declarative, in-SVG, no CSS/JS)
`<animate>`, `<animateTransform>`, `<animateMotion>` work inline in the SVG with no external code. Good for small looping accents (pulsing dots, spinners). Broadly supported in modern browsers (deprecation reversed). For motion paths, CSS `offset-path`/`offset-distance` is the modern alternative.

### 4.4 Practical guidance
- Optimize/minify SVGs (SVGO) and inline critical ones to allow styling + avoid extra requests.
- Animate `transform`/`opacity` on SVG, not geometry attributes (`width`, `cx`, `d`) where avoidable — geometry changes trigger layout/paint.

---

## 5. Performance Best Practices for Landing Pages

### 5.1 The compositor-only rule (most important)
Animate **only** `transform` and `opacity`. These run on the GPU compositor thread without layout or paint. (CSS Triggers reference.)
- ❌ Avoid animating: `top/left/right/bottom`, `width/height`, `margin`, `padding` → trigger **layout (reflow)** every frame.
- ❌ Avoid animating: `box-shadow`, `background-position` (large), `color` in hot loops → trigger **paint**.
- ✅ The repo's animations.css already follows this — every keyframe uses `transform`/`opacity`.

### 5.2 `will-change` — use surgically
- Add `will-change: transform` (or `opacity`) **only** to elements about to animate; **remove it after**. Permanent/blanket `will-change` wastes GPU memory and can *hurt* performance.
- Better: add it on hover-intent or just before triggering, not in static CSS for many elements.

### 5.3 Respect user & device
- **`prefers-reduced-motion`** — mandatory. Repo already has two global kill-switch blocks (animations.css:293, utilities.css:356). Every new animation must degrade there.
- Gate non-essential motion; keep essential affordances (focus rings, state changes) instant rather than animated under reduced-motion.

### 5.4 Loading & paint performance
- Keep entrance animations short (200–600ms) and avoid blocking LCP — don't fade-in the hero's LCP image with a long delay (hurts Largest Contentful Paint).
- Use `content-visibility: auto` on below-the-fold sections to skip rendering off-screen content (cheap perf win, pairs well with scroll-reveal).
- Lazy-load below-fold images (`loading="lazy"`) and decode async.
- Prefer CSS over JS where possible (compositor handles it off main thread).

### 5.5 Event-handler hygiene
- `{ passive: true }` on scroll/touch listeners.
- Throttle scroll work with `requestAnimationFrame`; never do layout reads (`getBoundingClientRect`, `offsetTop`) inside an unthrottled scroll handler (layout thrashing).
- Prefer `IntersectionObserver` over scroll listeners for visibility detection — it's async, off-main-thread, and batched.

### 5.6 Animation count / jank
- Cap simultaneous animated elements; stagger reveals instead of animating dozens at once.
- Avoid animating `filter: blur()` / large `box-shadow` on many elements (expensive paint).

---

## 6. Minimal-Dependency Landing-Page Patterns (reference approaches)

Common zero/low-dependency techniques used by performance-focused landing pages:
1. **CSS-only entrance** via `@keyframes fadeIn/slideIn` + staggered `animation-delay` (no JS). → Already available in repo.
2. **IntersectionObserver reveal-on-scroll** with `is-visible` class toggle — the de-facto vanilla replacement for the AOS library (~no KB cost). → §3.
3. **Hover lift** (`translateY(-1px/-2px)` + shadow) for cards/buttons. → Already the repo house style.
4. **CSS `scroll-snap`** for full-section scroll experiences (no JS).
5. **SVG stroke-draw** hero accents (one `getTotalLength` read, otherwise CSS). → §4.2.
6. **Animated gradient/shimmer** via `background-position` keyframes. → repo `.skeleton` template.
7. **Progressive enhancement to CSS scroll-driven animations** (`animation-timeline: view()`) where supported, JS-IO fallback elsewhere.

These map cleanly onto the repo: items 1, 3, 6 are *already built*; items 2 and 5 are small net-new additions; item 4 is pure CSS; item 7 is optional enhancement.

---

## 7. Files Referenced (internal, verified)

| Path | Relevance |
|------|-----------|
| `apps/web/public/animations.css` | Full keyframe + transition library; reduced-motion block |
| `apps/web/public/design-tokens.css` | `--transition-fast/base/slow`, `--shadow-*` tokens (lines 129–132, 160–162) |
| `apps/web/public/components.css` | Existing hover micro-interactions (cards, buttons, table rows) |
| `apps/web/public/utilities.css` | Second `prefers-reduced-motion` block (line 356); responsive `@media` |
| `apps/web/src/toast.ts` | `requestAnimationFrame` progress pattern (lines 100, 135) |
| `apps/web/src/render-core.ts` | rAF + scroll-position capture/restore convention |
| `apps/web/src/theme.ts` | rAF double-frame flash-prevention pattern |

**Grep facts:** `IntersectionObserver` → **0** matches in `apps/`; `requestAnimationFrame` → present in 7 source files; `prefers-reduced-motion` → 2 global blocks.

---

## 8. External References (stable domain knowledge)
> Web-search tools were unavailable this session; the following are well-established sources to consult during implementation.
- MDN: Using CSS animations / transitions; `prefers-reduced-motion`; `IntersectionObserver` API; SVG SMIL (`<animate>`, `<animateTransform>`).
- web.dev: "Animations and performance", "Stick to compositor-only properties", "`content-visibility`".
- CSS Triggers (csstriggers.com): which properties cause layout/paint/composite.
- caniuse.com: support for `animation-timeline`, `@starting-style`, `scroll-snap`, `:has()`.
- Chrome Developers: scroll-driven animations (`animation-timeline: view()/scroll()`).

---

### Summary for the landing-page designer
- **Reuse, don't rebuild:** entrance, hover, loading, and loop animations already exist in `animations.css` + tokens. Bind to `var(--transition-*)`.
- **One net-new helper:** a small vanilla `IntersectionObserver` reveal module (no IO exists yet) with `is-visible` toggle, `unobserve` after first hit, and reduced-motion/no-support fallbacks.
- **Performance non-negotiables:** animate `transform`/`opacity` only; respect both existing `prefers-reduced-motion` blocks; `passive` scroll listeners; throttle with rAF; never block LCP.
- **SVG:** CSS-driven transforms + stroke-dash draw for hero accents; SMIL for tiny loops.
