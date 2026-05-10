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

### Convention: Defer root rebuild while an IME composition is active

**What**: When a textarea / input visible during polling is mid-IME
composition (e.g. pinyin / kana / hangul not yet committed), `render()`
must not tear the element out of the DOM. Defer the rebuild until
`compositionend`, then flush the pending render.

**Why**: IME composition is browser-owned state attached to the live DOM
node. Wholesale root replacement destroys the composing node and cancels
the composition, swallowing whatever the user had just typed. Draft /
focus / selection preservation does not help here because the characters
are not yet in `.value` — they live only in the IME overlay. Deferring the
rebuild is the only way to keep the composition intact.

**Required contract**:

- Track which editable control is composing via module-scope state keyed
  by the same stable entity id used for drafts (for example
  `replyComposing: { requestId } | null`).
- On the control, listen for `compositionstart` (set the flag) and
  `compositionend` (clear the flag, flush DOM value into the draft, and
  schedule a catch-up render via `queueMicrotask(() => render())` if one
  was deferred).
- At the top of `render()`, if the composing flag is set, mark a pending
  deferred render and return immediately. Do not capture, clear, or
  rebuild.
- Use `addEventListener('compositionstart' / 'compositionend', …)` — DOM
  types do not expose `.oncompositionstart` / `.oncompositionend` as
  typed properties on `HTMLTextAreaElement` / `HTMLInputElement`, so
  property assignment would fail TypeScript.
- Flush the pending-deferred flag on genuine blur (not render-replacement
  blur) so a user tabbing away mid-composition cannot strand the app in a
  permanently-deferred render state.
- Clear both the composing flag and the pending-deferred flag whenever
  the draft itself is cleared (leaving the editable state, successful
  submit, page switch).

**Why `queueMicrotask` over `setTimeout(…, 0)`**: the catch-up render
should happen on the same task that fired `compositionend`, so the very
next paint already reflects the latest server state. `queueMicrotask`
keeps it synchronous with the event dispatch; `setTimeout` delays it by
at least one tick and can let a subsequent user keystroke race the
flush.

**Wrong**:

```typescript
// Polling render tears out the composing <textarea>; IME overlay dies mid-pinyin.
function render(): void {
  clear(root);
  root.appendChild(renderShell());
}
```

**Correct**:

```typescript
let replyComposing: { requestId: string } | null = null;
let renderDeferredByComposition = false;

function render(): void {
  if (replyComposing) {
    renderDeferredByComposition = true;
    return;
  }
  clear(root);
  root.appendChild(renderShell());
}

replyArea.addEventListener('compositionstart', () => {
  replyComposing = { requestId };
});
replyArea.addEventListener('compositionend', () => {
  replyComposing = null;
  drafts.set(requestId, replyArea.value);
  if (renderDeferredByComposition) {
    renderDeferredByComposition = false;
    queueMicrotask(() => render());
  }
});
```

### Convention: Preserve user-owned disclosure state across polling renders

**What**: `<details>` panels that users can open while automatic polling calls
`render()` must keep their open/closed state across the root rebuild.

**Why**: Disclosure state is user-owned UI state. Polling refreshes server data,
but they must not collapse a panel the user just opened.

**Required contract**:

- Capture each `<details>` open state immediately before `clear(root)`.
- Restore the state after the new root subtree is mounted.
- Prefer an explicit `data-details-key` when a panel is rendered from reusable
  helpers, has generic summary text, or can appear more than once on the same
  page.
- Include the stable entity id in explicit keys when the panel is entity-scoped
  (for example `request-debug-current-stage:${request.id}`).
- Keep the existing summary-path fallback only for panels whose page position
  and summary path are unique.

**Wrong**:

```typescript
// Two copies of this helper on the same page share the same fallback key.
el('details', {
  children: [el('summary', { text: '查看 Workflow Request 后端细节' })],
});
```

**Correct**:

```typescript
el('details', {
  attrs: { 'data-details-key': `request-debug-current-stage:${request.id}` },
  children: [el('summary', { text: '查看 Workflow Request 后端细节' })],
});
```

---

## State Categories

The SPA recognizes four state categories. Each lives in a different place
and has a different lifecycle.

| Category | Where it lives | Example |
|---|---|---|
| **Server state** | Module-scope objects in `main.ts`, populated by `fetch('/api/...')`; replaced wholesale on next poll/SSE event. | `state.workflowRuns`, `state.projects` |
| **User-owned draft state** | Module-scope `Map`s keyed by stable entity id; survives `render()` calls. | `coordinatorReplyDrafts: Map<requestId, string>`, project-form drafts. |
| **UI navigation state** | `state.page` (literal `Page` union), modal-open flags, picker-open flags. | `state.page = 'task'`, `localDirectoryPicker.open = true` |
| **Derived state** | Computed inline during render via `projection.ts` helpers; never stored. | `buildRunProjection(run)` output, `buildAcceptanceChecklist(...)`. |

The first three are stored; the fourth is recomputed every render. Resist
the urge to cache derived values — re-running a pure projection is cheap,
caching it adds an invalidation problem.

---

## When to Use Global State

There is no separate "store" library. All state is module-scope inside
`main.ts`, which IS the project's global state by virtue of being the
entry. The decision is "module-scope variable in `main.ts`" vs. "local
variable inside a renderer function".

Promote a value to module scope when:

- It must survive `render()` calls (drafts, focus restore markers).
- It's read or written from more than one renderer (page navigation,
  shared selections like `selectedProjectId`).
- It needs to outlive an event handler (e.g. polling intervals, open
  EventSource handles).

Keep it local when:

- It's a temporary value computed inside a single renderer (DOM ids
  generated from a list index, intermediate strings).
- It's an event handler's transient parameter.

Don't promote "in case we need it later" — local is the default.

---

## Server State

API responses are cached only as long as the user remains on the page that
needs them. There is no global server-state cache (no React Query, no
SWR). The patterns:

### Polling pages (workbench, task list)

```ts
let pollHandle: number | null = null;

async function loadWorkflowRuns(): Promise<void> {
  const res = await fetch(`${API_BASE}/workflow-runs`);
  if (!res.ok) return;
  const body = (await res.json()) as { items: WorkflowRunDto[] };
  state.workflowRuns = body.items;            // wholesale replacement
  render();
}

function enterWorkbench(): void {
  loadWorkflowRuns();
  pollHandle = window.setInterval(loadWorkflowRuns, 5000);
}
function leaveWorkbench(): void {
  if (pollHandle !== null) window.clearInterval(pollHandle);
  pollHandle = null;
}
```

### SSE pages (task detail, agent stream)

History fetch first, then SSE attach for live appends:

```ts
const history = await fetch(`${API_BASE}/runner/events/agent-events?workflowRunId=${id}`).then(r => r.json());
state.agentStream = history.items;

const es = new EventSource(`${API_BASE}/runner/events/agent-stream/${id}`);
es.addEventListener('message', (ev) => {
  const event = JSON.parse(ev.data) as AgentStreamEvent;
  state.agentStream.push(event);
  render();
});
```

The api side guarantees no race between history and SSE — both go through
the same `publish` (see `apps/api/src/agent-stream-bus.ts:7-10`). The
client just needs to fetch history first, then attach.

### Optimistic vs. authoritative updates

This SPA is **not** optimistic. After a `POST /workflow-runs`, wait for
the response (the new run object) and then update local state from that
response. Reason: backend rules (router recommendation audit, conservative
defaults, validation, status setting) may differ from what the client sent.

---

---

## Common Mistakes

### Don't rely on DOM-held form values for polling pages

If a page is refreshed by `setInterval`, SSE updates, or background fetches,
uncontrolled inputs/textarea values are temporary DOM state. Treat those values
as disposable unless they are copied into app state before render.
