# State Management

> How state is managed in this project.

---

## Overview

The current web app is a lightweight TypeScript DOM app. It rebuilds the app
root from in-memory state via `render()` instead of using a framework-level
virtual DOM.

### Convention: Preserve user-owned drafts across polling renders

**What**: Any editable field that can be visible while automatic polling calls
`render()` must store its draft value outside the DOM before the root is
cleared, then restore the value when the field is rebuilt.

**Why**: Polling refreshes are server-owned state updates. User-owned drafts
must not be lost just because the app re-rendered while the user was typing.

**Required contract**:

- Key draft state by the stable entity id being edited (for example
  `requestId`), not by a transient DOM node.
- Capture the current DOM value immediately before `clear(root)`.
- Rehydrate the rebuilt control from the draft state.
- If the focused control is rebuilt, restore focus with `preventScroll: true`
  and clamp selection offsets to the rebuilt value length.
- Treat blur events caused by root replacement as render internals, not as
  user intent. Use a short-lived render-replacement guard so DOM removal does
  not erase the pending focus restore.
- Make focus restoration one-shot. After focus/caret is restored, clear the
  restore marker; the next render should only restore focus if the control was
  actually focused at the start of that render.
- Clear the draft when the server-side workflow leaves the editable state or
  after a successful submit.

**Wrong**:

```typescript
// Rebuilt every poll tick; typed text disappears when render() clears the DOM.
const replyArea = el('textarea', { attrs: { placeholder: 'Reply…' } });
```

**Correct**:

```typescript
const drafts = new Map<string, string>();

const replyArea = el('textarea', {
  attrs: { 'data-request-id': requestId, placeholder: 'Reply…' },
});
replyArea.value = drafts.get(requestId) ?? '';
replyArea.oninput = () => drafts.set(requestId, replyArea.value);
```

Also add capture/restore hooks around the root rebuild when focus or cursor
position must survive the render.

---

## State Categories

<!-- Local state, global state, server state, URL state -->

(To be filled by the team)

---

## When to Use Global State

<!-- Criteria for promoting state to global -->

(To be filled by the team)

---

## Server State

<!-- How server data is cached and synchronized -->

(To be filled by the team)

---

## Common Mistakes

### Don't rely on DOM-held form values for polling pages

If a page is refreshed by `setInterval`, SSE updates, or background fetches,
uncontrolled inputs/textarea values are temporary DOM state. Treat those values
as disposable unless they are copied into app state before render.
