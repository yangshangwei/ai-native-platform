# Optimize Project Status Header Focus

## Goal

Improve the topbar project/status display so an operator can quickly decide whether the current task context is ready to run AI work. The current summary gives Project, Branch, Runner, Agent Backend, and Build Env equal visual weight; the updated view should prioritize the business decision: "Can I safely start work on this project now?"

## What I Already Know

- The user provided a screenshot where Project, Branch, Runner, Agent Backend, and Build Env appear as separate equal cards.
- The visible business context is project execution readiness: project identity, selected branch, online Runner, configured backend, and Java/Maven build environment.
- The screenshot maps to the Web shell topbar `context-strip`, implemented in `apps/web/src/shell.ts`.
- The existing shell already derives project, active run branch, runner, backend, and build environment state from `state.ts`.
- Existing Web UI is a vanilla TypeScript SPA with DOM renderer functions and CSS in `apps/web/index.html`.

## Assumptions

- The target surface is the task/workflow topbar context strip shown in the screenshot, not the registered-project card/list on the Projects page.
- No backend/API contract changes are needed.
- Branch remains important but should read as execution context, not compete with project identity.
- Runner, Agent Backend, and Build Env should read as readiness checks with clear status emphasis.

## Requirements

- Make the project identity the primary focus of the topbar context strip.
- Present readiness as a compact, scannable status/checklist:
  - Runner status
  - Agent Backend configuration/preflight state
  - Build environment/toolchain signal when available
- Keep branch visible as project/run context.
- Reduce equal-weight metadata blocks by grouping related signals:
  - project + branch as "current execution target"
  - Runner + Agent Backend as "run readiness"
  - Build Env as supporting environment detail
- Keep Chinese-facing product copy concise and operator-focused.
- Maintain mobile layout without text overlap or horizontal scrolling.

## Acceptance Criteria

- [x] The task/workflow topbar visually emphasizes the project name and a single readiness/status message before secondary metadata.
- [x] Branch, Runner, Agent Backend, and Build Env are grouped by business meaning instead of equal unrelated tiles.
- [x] Missing/needs-attention states are visually stronger than healthy secondary details.
- [x] Existing project rendering tests are updated or extended for the new readiness surface.
- [x] `bun test apps/web/test/projects-rendering.test.ts` passes.
- [x] `bun run typecheck` passes, or any unrelated pre-existing failure is documented.
- [x] A browser/manual screenshot check confirms the card is readable at desktop and mobile widths if a dev server can run.

## Out of Scope

- Changing API response shapes or Runner registration behavior.
- Changing backend preflight semantics.
- Adding new dependencies, icon packs, or a component framework.
- Redesigning unrelated Workbench/task detail status bars.

## Technical Notes

- Relevant code:
  - `apps/web/src/shell.ts`
  - `apps/web/index.html`
  - `apps/web/test/*rendering*.test.ts`
  - `apps/web/index.html`
- Relevant specs:
  - `.trellis/spec/web/frontend/component-guidelines.md`
  - `.trellis/spec/web/frontend/quality-guidelines.md`
  - `.trellis/spec/web/frontend/type-safety.md`
  - `.trellis/spec/web/frontend/agent-backend-ui.md`
- Existing helper patterns:
  - `pill(label, kind)` and `statusKind(status)` for status display.
  - `projectAvailability(project)` and `agentBackendStatusForProject(project)` in `state.ts`.
  - `latestRunner()` for runner/toolchain status on the project page.
