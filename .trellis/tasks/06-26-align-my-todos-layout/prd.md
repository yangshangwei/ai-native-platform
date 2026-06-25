# Align My Todos Layout

## Goal

The My Todos page should keep the todo list and empty-state panel visually aligned with the filters panel above it. The page currently makes the list panel use different internal spacing, and the empty state inherits a global margin that shifts it inside the page grid.

## Requirements

- Keep the existing My Todos page content and behavior unchanged.
- Align the todo list panel's left and right edges with the filters panel.
- Align the empty-state panel's left and right edges with the filters panel when no todos are present.
- Preserve responsive behavior without introducing horizontal overflow on mobile.

## Acceptance Criteria

- [ ] On desktop, the filters panel, todo list panel, and empty-state panel share the same page-grid column width.
- [ ] Todo items sit inside the same panel padding used by the filters panel instead of touching the panel edge.
- [ ] The My Todos empty state has no extra outer margin inside `.page-grid`.
- [ ] Mobile width remains contained within the viewport.
- [ ] Typecheck passes.

## Definition of Done

- The narrow layout fix is implemented in the web frontend.
- Relevant Trellis context files are listed in `implement.jsonl` and `check.jsonl`.
- Typecheck and a focused visual smoke are completed.
- Changes are committed using the repository commit protocol.

## Technical Approach

Use existing panel spacing instead of introducing a new layout system:

- Remove the My Todos-specific `padding: 0` override for the list panel.
- Keep `.my-todos-list` as a simple vertical stack inside the standard `.panel`.
- Add a My Todos-specific empty-state class so the page can reset the global `.empty-state` margin only in this page.

## Decision (ADR-lite)

**Context**: The visual mismatch is caused by local CSS overrides, not by missing layout structure.

**Decision**: Reuse the existing `.panel` spacing contract and only override the My Todos empty-state margin.

**Consequences**: This keeps the diff small and avoids changing global `.empty-state` behavior used by other pages.

## Out of Scope

- Redesigning the My Todos page.
- Changing button behavior, filters, sorting, routing, or data loading.
- Refactoring global panel or empty-state styles.

## Technical Notes

- Relevant implementation files:
  - `apps/web/src/page-my-todos.ts`
  - `apps/web/public/components.css`
- Relevant style source:
  - `apps/web/index.html` defines base `.panel` and `.empty-state` card styles.
- Specs read:
  - `.trellis/spec/web/frontend/index.md`
  - `.trellis/spec/web/frontend/component-guidelines.md`
  - `.trellis/spec/web/frontend/quality-guidelines.md`
  - `.trellis/spec/web/frontend/agent-backend-ui.md`
  - `.trellis/spec/guides/index.md`
