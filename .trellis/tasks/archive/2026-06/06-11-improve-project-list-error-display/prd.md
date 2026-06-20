# Improve project list error display

## Goal

Make the new-task page's project-list failure state readable and contained when `/api/projects` fails, and prevent the web dev proxy from returning Bun HTML error pages when the API service is unavailable. The current UI rendered the raw backend/Bun HTML error page inline because the proxy threw an uncaught connection error.

## What I already know

* The screenshot shows `项目列表加载失败` rendering a long HTML/Bun error response directly in the inline notice.
* `apps/web/src/main.ts` stores `/projects` failures in `projectsLoadError` and passes that full string to `renderNewTaskInlineNotice`.
* `renderNewTaskInlineNotice` currently renders the message as a plain compact paragraph.
* The web app is a lightweight TypeScript DOM app that rebuilds from module-scope state.
* The web dev server proxies `/api/*` to `http://127.0.0.1:8787`; when that API server is not running, `fetch()` throws and Bun emits an HTML 500 fallback page.

## Assumptions

* Operators still need access to the raw diagnostic text for debugging, but it should not be shown as primary content.
* The API service still needs to be running for real project data; the proxy fix should make outages debuggable rather than pretending project data exists.

## Requirements

* Show a short, user-facing Chinese error summary for project-list load failures.
* Detect HTML error payloads and avoid rendering raw markup as the primary message.
* Keep retry and project-access actions visible.
* Put raw technical details behind a collapsed disclosure.
* Ensure very long error strings wrap inside the notice and do not create page overflow.
* Return structured JSON from the web dev proxy when the API target is unreachable.
* Verify that starting the API service makes `/api/projects` return a normal JSON project list through the web proxy.

## Acceptance Criteria

* [ ] When `/projects` returns an HTML/Bun error page, the form shows a compact readable failure notice instead of raw HTML.
* [ ] The raw error remains available under a collapsed diagnostics disclosure.
* [ ] Long unbroken diagnostics wrap/scroll within the notice and do not stretch the page.
* [ ] When the API service is down, `/api/projects` returns JSON `502` instead of a Bun HTML error page.
* [ ] When the API service is running, `/api/projects` returns a JSON project list.
* [ ] `@ainp/web` typecheck passes.

## Definition of Done

* Tests/verification run for the changed web surface.
* No new dependencies.
* Final report lists changed files, simplifications, and remaining risks.

## Out of Scope

* Changing API response contracts.
* Redesigning the whole new-task form.

## Technical Notes

* Relevant spec: `.trellis/spec/web/frontend/state-management.md`.
* Relevant spec: `.trellis/spec/web/frontend/agent-backend-ui.md`.
* Likely files: `apps/web/src/main.ts`, `apps/web/index.html`.
