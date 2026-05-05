# Component Guidelines

> How "components" are built in `apps/web/`.

---

## There are no components in the framework sense

`apps/web/` is a vanilla TypeScript SPA. There are no React components, no
Vue SFCs, no Svelte components, no JSX. Don't write any.

What plays the role of a component here is a **renderer function**:
a TypeScript function that takes a parent DOM element + a state snapshot and
mutates the DOM to match.

```ts
function renderWorkflowRunCard(parent: HTMLElement, run: WorkflowRunDto): void {
  // imperative DOM construction via createElement / appendChild,
  // OR template-literal HTML assignment via the element's HTML-string property
}
```

The two flavors used in this codebase:

1. **Pure DOM construction** with `document.createElement` /
   `parent.appendChild`. Best for elements that need event listeners,
   typed-property access, or that fragment of code is reused.
2. **Template-literal HTML assignment** for static structure with
   interpolated values. Faster to write; safe ONLY when every interpolated
   string is already escaped or is a known-safe literal. (See the XSS
   note in `quality-guidelines.md`.)

`main.ts` uses both flavors — pick the one that matches the situation.

---

## Renderer function shape

```ts
function render<Thing>(
  parent: HTMLElement,
  state: ThingState,
  // additional params if needed (e.g. event handlers)
): void
```

Renderers should:

- Take all input as parameters. Don't reach into module-scope variables
  inside the function body.
- Be **idempotent**: calling `render(parent, state)` twice with the same
  `state` produces the same DOM. The simplest way is to clear the parent
  before rendering.
- Be **deterministic**: no `Math.random()`, no `Date.now()` for ids that
  appear in the DOM, unless those values are part of `state`.

`main.ts:30+` does most of the rendering work directly inside the page
switch logic. When a renderer grows past ~30 lines, extract it as a named
function.

---

## State → DOM via projection

The pattern this codebase prefers:

1. Fetch raw API response → typed DTO.
2. Pass through a projection helper (`projection.ts`) → view model.
3. Renderer takes the view model, never the raw DTO.

Reason: API shapes change; renderers shouldn't bind to those shapes
directly. Projection is the translation layer.

```ts
// main.ts (sketch)
const data = await fetch('/api/workflow-runs/' + id).then(r => r.json());
const view = buildRunProjection(data);     // projection.ts
renderRunDetail(container, view);          // imperative DOM
```

---

## Event handling

Use plain `element.addEventListener('click', handler)`. Don't:

- Set `onclick="..."` via string-template HTML assignment and rely on the
  global scope to find handlers — it works but breaks under strict CSP and
  is un-typable.
- Build a homegrown event-bus when DOM events suffice.

Re-render-on-event is fine. The SPA is small enough that re-rendering a
section is cheap.

---

## Styling

The project's Vite setup loads CSS via standard `<link>` and `<style>` in
the HTML entry (or via Vite's `import './style.css'` from `main.ts` if
used). There's no styled-components, no Tailwind, no CSS-in-JS.

Class names are plain strings. Keep them tied to the page-state hierarchy:
`workbench-card`, `task-detail-step`, `settings-row`. No BEM enforcement;
just be consistent.

---

## Accessibility

- Use semantic HTML (`<button>` for buttons, `<a href>` for navigation,
  `<form>` for submission flows).
- `<button type="button">` for non-submit buttons; the default is `submit`
  which surprises forms.
- For dynamic regions that update (live SSE feeds, status pills),
  `aria-live="polite"` on the container so screen readers announce changes.
- Keyboard focus restore after rerender: `coordinatorReplyDrafts` + focus
  restore was the fix in archived task `05-03-fix-coordinator-reply-input-reset`.
  Lesson: when you replace a parent's HTML wholesale, focus is gone — capture
  `document.activeElement?.id` before, restore after.

---

## Common mistakes

- **Treating wholesale HTML replacement as cheap.** It re-creates child
  nodes; any focused input loses focus. For inputs, prefer
  `element.value = state.x` over rebuilding.
- **Reading state from the DOM.** The DOM is the rendered output, not the
  source. Keep state in TS objects; DOM mirrors it.
- **Inline event handler strings.** Always `addEventListener`.
- **Reaching into `apps/api/` types directly.** Use `@ainp/shared` for
  cross-package types; if you need a web-private DTO that mirrors api
  response shape, declare it in `main.ts`.
- **Creating a "component framework" inside the SPA.** Don't. The
  framework-free choice is intentional.
