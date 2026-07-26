# Fix collapsed sidebar menu click behavior

## Goal

When the sidebar is collapsed, clicking a menu icon should navigate without expanding the sidebar. When the sidebar is expanded, clicking a menu item should navigate without collapsing it. Only the explicit collapse/expand sidebar control should change the sidebar width state.

## What I already know

- User reports that clicking a menu icon while the sidebar is collapsed currently expands the menu.
- Desired behavior is state-stable navigation: menu clicks navigate only.
- `apps/web/src/shell.ts` renders both expanded nav buttons and collapsed icon buttons.
- Current collapse state is represented only by the `.sidebar-collapsed` DOM class on `.app-shell`.
- `setHash()` navigation triggers a root rebuild; a DOM-only class is lost when the rebuilt shell is mounted.
- Web state conventions say user-owned UI state that must survive `render()` belongs in module state, not transient DOM.

## Assumptions

- The collapsed sidebar state is a user-owned UI preference within the current session.
- Persisting the sidebar collapsed state to localStorage is out of scope unless the existing app already does so.
- The existing collapsed bottom expand button remains the only way to expand from collapsed state.

## Requirements

- Collapsed sidebar nav icon click changes page/hash but keeps the shell collapsed.
- Expanded sidebar nav item click changes page/hash but keeps the shell expanded.
- The expanded footer collapse button collapses the sidebar.
- The collapsed footer expand button expands the sidebar.
- Theme toggle and polling re-renders do not accidentally reset the sidebar width state.

## Acceptance Criteria

- [x] Rendering honors `ui.sidebarCollapsed` by adding `.sidebar-collapsed` to `.app-shell`.
- [x] Collapsed nav icon click keeps `ui.sidebarCollapsed === true`.
- [x] Expanded nav item click keeps `ui.sidebarCollapsed === false`.
- [x] Collapse and expand buttons are the only sidebar controls that mutate `ui.sidebarCollapsed`.
- [x] Focused shell rendering tests cover collapsed and expanded navigation behavior.
- [x] `bun run test -- apps/web/test/shell-rendering.test.ts` passes.
- [x] Relevant typecheck passes or the touched files have no TypeScript diagnostics.

## Out of Scope

- Redesigning the sidebar layout.
- Persisting collapsed state across browser sessions.
- Changing nav labels, page routing, or menu item ordering.
- Replacing hand-written SVG path icons with an icon library.

## Technical Notes

- Main implementation candidate: `apps/web/src/state.ts` and `apps/web/src/shell.ts`.
- Existing shell tests: `apps/web/test/shell-rendering.test.ts`.
- Relevant spec: `.trellis/spec/web/frontend/state-management.md`.
