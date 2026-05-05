# Quality Guidelines

> Code standards specific to `apps/web/`.

---

## Pre-commit gate

```bash
bun test
bun run typecheck
```

`bun run typecheck` runs across the workspace. The web side is the most
likely to drift on api response shapes — when the api adds a field or
changes a union, web's local DTOs (declared in `main.ts`) drift silently if
you don't import from `@ainp/shared`. Always prefer the shared type.

---

## Test placement

Vitest co-located with the file under test where applicable:

- `projection.test.ts` next to `projection.ts` — pure transforms, easy to
  test.
- `settings-projection.test.ts` next to `settings-projection.ts`.
- `main.ts` is mostly DOM wiring + fetch; it doesn't get unit tests. Test
  coverage for `main.ts` comes from the api-level integration smokes
  (`bun run smoke`, `bun run e2e`).

---

## Hot path: `main.ts`

Project memory flags `apps/web/src/main.ts` as a hot path (50+ references
in recent task records). It's large by design — the framework-free SPA
keeps page-level glue here. **Prefer extracting feature modules over
inline growth** when a page section approaches 100+ lines:

- Heavy projection logic → `projection.ts` (already there).
- Heavy settings logic → `settings-projection.ts` (already there).
- A new substantial feature area → consider a sibling module.

But don't extract for the sake of extraction; the SPA's structural
clarity comes from a small file count, not many tiny files.

---

## Naming

| What | Convention | Example |
|---|---|---|
| Function | `camelCase` | `buildRunProjection`, `loadProjects` |
| Type / interface | `PascalCase` | `WorkflowRunDto`, `ProjectDto` |
| File | `kebab-case.ts` | `settings-projection.ts` |
| Const | `SCREAMING_SNAKE` for top-level config | `STAGE_LABELS`, `API_BASE` |
| DOM ids | `kebab-case` matching state keys | `workflow-run-card-${runId}` |

---

## Type safety

- DTOs cast at the fetch boundary: `await res.json() as { items: WorkflowRunDto[] }`.
  After the cast, treat the value as typed.
- Prefer `@ainp/shared` types for anything the api also defines. The web's
  local DTOs (in `main.ts:36-53`, e.g. `ProjectDto`) exist for the cases
  where the web needs a slightly different shape (e.g.
  `hasSourceCredential: boolean` masking the secret); use them as a thin
  wrapper, not as a duplicate of the entire api type.
- Trust-boundary checks for unions:
  ```ts
  type Page = 'workbench' | 'task' | 'projects' | 'new-task' | 'reports' | 'knowledge' | 'settings';
  function isPage(value: unknown): value is Page {
    return typeof value === 'string' && [
      'workbench', 'task', 'projects', 'new-task', 'reports', 'knowledge', 'settings',
    ].includes(value);
  }
  ```
  Use these when reading user input (URL hash, localStorage values).

---

## DOM safety (XSS)

- Don't insert untrusted strings directly into an element's HTML-string
  property. Use `textContent` (auto-escapes) or build elements via
  `createElement` + `appendChild`.
- For string templates that DO go through the HTML setter, every
  interpolated value must be either a known-safe literal (e.g.,
  `STAGE_LABELS[stage]` — a constant string the team controls) or
  HTML-escaped at the boundary:
  ```ts
  function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]!));
  }
  ```
- Coordinator messages, project titles, artifact contents — anything that
  came from a workflow originally entered by a user — needs escaping.
- For untrusted HTML that legitimately needs to render as HTML (rare in
  this SPA), use a sanitizer like DOMPurify. Don't hand-roll.

---

## Anti-patterns this team has hit

### 1. Coordinator reply input reset

> Reference: archived task `05-03-fix-coordinator-reply-input-reset`.

Earlier the SPA rerendered the coordinator panel on every new event,
which blew away the user's in-progress draft reply. Fix: keep
`coordinatorReplyDrafts` keyed by request id in module-scope state, and
restore focus to the input after rerender. **Always think about
in-progress user input when you rerender** — module-scope state survives,
DOM does not.

### 2. Live edit prompts/rules/configs panel

> Reference: archived task
> `05-03-expose-internal-prompts-rules-and-configs-to-ui-for-live-edit`.

The pattern that emerged: configs, rules, prompts come from the api in
their canonical form; the SPA edits a draft in module-scope state, posts
on save, and only re-fetches after the api ack. Never mutate the api
response object in place — keep a separate `draftFoo` state.

---

## Forbidden patterns

- **`any`** in fetch return casts. Define the DTO shape.
- **`@ts-ignore` / `@ts-expect-error`** as a silencer. Fix the type.
- **Inline event handlers in HTML strings**
  (`<button onclick="...">`). Bypasses TypeScript entirely and breaks under
  strict CSP.
- **Legacy synchronous output APIs of the document.** Always
  `appendChild` / `textContent`.
- **`alert` / `confirm` / `prompt`** for production flows. Use a custom
  modal pattern.
- **Hard-coded `http://localhost:8787` URLs.** Always go through
  `${API_BASE}` (= `/api`) so Vite's proxy can re-route.
- **Storing secrets in `localStorage`.** PATs and credentials live on the
  api side. The SPA only ever sees `hasSourceCredential: boolean`.
