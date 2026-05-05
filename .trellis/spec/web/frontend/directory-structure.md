# Directory Structure

> Module layout for `apps/web/`.

---

## TL;DR

`apps/web/` is a **vanilla TypeScript SPA** built with Vite. There is no
React, no Vue, no Svelte, no framework. The codebase is intentionally small:
three TypeScript files plus an HTML entry point.

```
apps/web/
├── index.html                 # Vite HTML entry; loads /src/main.ts as a module
├── src/
│   ├── main.ts                # Application entry — DOM wiring + state
│   ├── projection.ts          # Pure projection helpers: API DTOs → DOM-ready view models
│   └── settings-projection.ts # Same idea, scoped to settings UI
├── package.json
└── vite.config.ts             # If present; otherwise Vite defaults
```

The dev server listens on **port 5173** (Vite default; documented in the
project memory directive about UI design). The api proxy under `/api` is
configured in `vite.config.ts`; `main.ts:29` codifies `const API_BASE = '/api'`.

---

## How a feature is added

1. Define the **DTO type** in `main.ts` (or extract to `projection.ts` if
   reused). Match the api response shape; reference `@ainp/shared` types
   where they exist.
2. Add a **projection helper** in `projection.ts` that turns the DTO into a
   render-ready view model (e.g., `buildRunProjection(run)` already exists
   for workflow runs).
3. Call the api from `main.ts` (via `fetch(\`${API_BASE}${path}\`)`),
   project the response, and render into the existing DOM.
4. Wire DOM event listeners using vanilla `addEventListener`.

There is no router; the UI is page-state-driven. `Page` (line 31) is a
literal union (`'workbench' | 'task' | 'projects' | 'new-task' | 'reports' |
'knowledge' | 'settings'`); `main.ts` switches on it to choose what to
render.

---

## Where things go

### `src/main.ts` — the entry

This is the largest file in the SPA. Project memory flags it as a hot path
(50+ references in recent task records). It owns:

- All page-level state objects (`ProjectDto`, `LocalDirectoryPickerState`,
  ...).
- DOM lookups (`document.getElementById(...)`).
- Page-switch logic.
- Event handlers and submit forms.
- API call orchestration.

Because it's large, **prefer extracting feature modules to keep main.ts
linear**. The natural extraction point is the projection layer below.

### `src/projection.ts` — pure transforms

Pure functions that take an API DTO (or array of DTOs) and return either a
renderable string / DOM, or a structured view model:

- Stage display names: `STAGE_LABELS`, `STAGE_HELP`, `STAGES`,
  `USER_VISIBLE_STAGES` constants.
- Per-run helpers: `buildRunProjection`, `buildAcceptanceChecklist`,
  `buildWorkbenchOverview`, `changedFilesFromDiff`, `latestArtifactOfKind`.
- Artifact-content parsers: `parseDesignArtifact`,
  `parseRequirementArtifact`, `parseKnowledgeArtifact`,
  `parseCompletionReportArtifact`.

Pure, no DOM, no fetch. Tests can run them directly with vitest.

### `src/settings-projection.ts` — scoped projection

Same idea but for the settings page. `buildSettingsViewModel(settings)`
returns a structured view model that `main.ts` renders.

---

## Anti-patterns

- **Adding React, Vue, or Svelte without a brainstorming round.** This SPA
  is intentionally framework-free. Introducing a framework is a substantial
  decision that needs its own task; don't slide one in by importing a
  library. (See the project memory directive about the AI software
  delivery workbench design.)
- **Nested deep folder hierarchies.** With three source files, deeper
  folders are pure noise.
- **Splitting `main.ts` along page lines that don't match `Page`.** If you
  do extract, group by feature/concept (workbench, task-detail, settings),
  not by arbitrary "components/", "containers/", "pages/" nesting.
- **Putting fetch logic in `projection.ts`.** Projection is pure. Fetch
  belongs in `main.ts` (where the page state lives).
- **Importing from `apps/api/` or `apps/runner/`.** The api server is a
  remote system from the SPA's perspective; talk to it via
  `fetch('/api/...')`, not via direct module import.
