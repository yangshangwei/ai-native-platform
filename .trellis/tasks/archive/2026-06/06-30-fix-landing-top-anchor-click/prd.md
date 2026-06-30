# fix landing top anchor click

## Goal

Fix the landing page so clicking `#top` reliably scrolls back to the top of the page, including when the current URL already contains `#top`.

## Requirements

* The landing page's "回到顶部" and brand links must scroll the page back to the document top when clicked.
* The behavior must work even if the current location hash is already `#top`.
* In-page section links should continue to work after the change.
* The fix should remain small and local to the landing page static assets.

## Acceptance Criteria

* [x] Clicking a landing-page link with `href="#top"` triggers a scroll back to the top.
* [x] The `#top` behavior still works after the user has already loaded the page with `#top` in the URL.
* [x] Existing section anchor navigation such as `#how` still scrolls to the expected section.
* [x] A regression test covers the landing-page anchor behavior.

## Definition of Done

* Targeted tests pass.
* Web package typecheck passes.
* The change does not alter unrelated workbench behavior.

## Technical Approach

Update the landing-page static HTML/JS so the top anchor targets the document top instead of the sticky header, and add explicit hash-link scrolling logic in `landing.js` to handle repeated clicks and sticky-nav offset safely.

## Decision (ADR-lite)

**Context**: Native fragment navigation is unreliable here because `#top` currently points at a sticky header and repeated clicks on the same hash can be a no-op.

**Decision**: Keep the fix inside the landing page static assets by moving the `#top` target to the page root and adding a small client-side hash-scroll handler.

**Consequences**: The page gets robust repeated-click behavior without touching the SPA runtime. The page also gains explicit control over sticky-nav offset for section anchors.

## Out of Scope

* Redesigning the landing page layout or copy.
* Changing the main SPA router or workbench navigation behavior.

## Technical Notes

* Affected files are expected to stay in `apps/web/public/`.
* Relevant frontend guidance lives under `.trellis/spec/web/frontend/`.
