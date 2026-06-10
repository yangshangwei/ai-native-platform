# 修复 web 5173 白屏

## Goal

Restore the `apps/web` development UI at `http://localhost:5173/` so the page renders under the existing lightweight Bun dev server instead of failing during browser module resolution.

## What I Already Know

- Port `5173` is listening via `bun run serve.ts` and `/` returns HTTP 200.
- Headless Chrome reports: `Failed to resolve module specifier "@ainp/shared"`.
- The failure is caused by a runtime value import from `@ainp/shared` in `apps/web/src/projection.ts`; the current `apps/web/serve.ts` transpiles TypeScript but does not bundle or resolve bare workspace package specifiers for the browser.
- Type-only imports from `@ainp/shared` are erased and are not the runtime problem.

## Requirements

- Keep the web app framework-free and compatible with the existing Bun `serve.ts` dev server.
- Preserve flow-aware lifecycle behavior for `feature.standard`, `feature.fastforward`, `issue.standard`, and `refactor.standard`.
- Keep the fix narrow to the web frontend/runtime module-loading issue.

## Acceptance Criteria

- [x] `http://localhost:5173/` no longer logs the unresolved `@ainp/shared` module error in Chrome.
- [x] The page body contains rendered application UI, not only the empty `#app` mount node.
- [x] Existing projection tests for flow-aware lifecycle stages pass.
- [x] Web typecheck passes.

## Definition of Done

- Tests/typecheck run with evidence recorded in the final response.
- No new dependency is introduced.
- Any remaining risk is called out explicitly.

## Out of Scope

- Replacing the lightweight web server with Vite.
- Bundling all workspace package imports for the browser.
- Changing backend API behavior.

## Technical Notes

- Relevant files: `apps/web/src/projection.ts`, `apps/web/serve.ts`, `apps/web/test/projection.test.ts`.
- Relevant specs: `.trellis/spec/web/frontend/*`, `.trellis/spec/guides/*`.
