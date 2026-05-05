# Hook Guidelines

> What plays the role of "hooks" in `apps/web/`.

---

## TL;DR

There are no hooks here. No React `useState` / `useEffect`, no Vue
`ref` / `watch`, no Svelte stores. The SPA is vanilla TypeScript. Don't
import a "hooks" library; don't simulate hooks with closures and pretend.

What this file documents instead: the patterns that cover the use cases
hooks would handle in a framework — **state, side effects, subscriptions**.

---

## State

State is module-scope `let` variables in `main.ts` plus typed interfaces:

```ts
// main.ts — sketch of the actual pattern
interface PageState {
  page: Page;
  selectedProjectId?: string;
  workflowRuns: WorkflowRunDto[];
  // ...
}

let state: PageState = { page: 'workbench', workflowRuns: [] };

function setState(patch: Partial<PageState>): void {
  state = { ...state, ...patch };
  rerender();
}
```

The `rerender()` is also explicit — there's no reactivity. After every
state mutation, call the renderer for the affected region.

---

## Side effects (data fetching)

Plain `async` functions called from event handlers or page-switch logic.
No `useEffect`-shaped wrapper.

```ts
async function loadProjects(): Promise<void> {
  const res = await fetch(`${API_BASE}/projects`);
  if (!res.ok) {
    setState({ projectsError: await res.text() });
    return;
  }
  const data = await res.json() as { items: ProjectDto[] };
  setState({ projects: data.items });
}
```

Patterns to follow:

- Wrap fetch in a small named function per resource. Keeps `main.ts`'s
  switch readable.
- Always check `res.ok` before parsing.
- Cast the parsed JSON to a typed shape with `as { ... }`. Prefer types
  that already live in `@ainp/shared`.

---

## Subscriptions (live updates via SSE)

The api exposes Server-Sent Events for live tailing of agent streams and
workflow audit:

```ts
// Agent stream for a specific workflow run
const es = new EventSource(`${API_BASE}/runner/events/agent-stream/${runId}`);
es.addEventListener('message', (ev) => {
  const event = JSON.parse(ev.data) as AgentStreamEvent;
  setState({ agentStream: [...state.agentStream, event] });
});
es.addEventListener('error', () => { /* reconnect or surface */ });

// Cleanup when leaving the page
function leaveTaskPage(): void {
  es.close();
}
```

Lifecycle:

1. **Open** when entering a page that needs live data.
2. **Append** received events to state and rerender.
3. **Close** when leaving the page or the component unmounts (in this SPA,
   when `state.page` changes away from the page that owns the connection).

The api side documents the contract in `apps/api/src/agent-stream-bus.ts:7`:

> History is in `agent_events` SQLite — this bus is **only** for live tail.
> SSE endpoints fetch history first, then attach a subscriber to receive
> subsequent events (no race because both go through `publish`).

So the web pattern is: **fetch history once, then open SSE for live
appends**. Don't only-SSE; you'd miss everything before the connect.

---

## Polling (when SSE isn't available)

For resources without an SSE endpoint, use `setInterval` and clear it on
page-leave:

```ts
let pollHandle: number | null = null;

function startPollingProjects(): void {
  pollHandle = window.setInterval(async () => {
    await loadProjects();
  }, 5000);
}

function stopPollingProjects(): void {
  if (pollHandle !== null) {
    window.clearInterval(pollHandle);
    pollHandle = null;
  }
}
```

Always have a corresponding stop function. A leaked interval keeps fetching
forever and ages the user's tab.

---

## Naming

There's no `use*` convention because there are no hooks. Use plain verbs:

- `loadProjects` / `loadWorkflowRun` — async data fetch.
- `subscribeAgentStream` / `unsubscribeAgentStream` — SSE.
- `startPolling*` / `stopPolling*` — interval-based.
- `render*` — DOM renderers.
- `setState` — state mutator.

---

## Common mistakes

- **Importing `react` / `useEffect` / `useState`.** This project has no
  React. Don't.
- **Leaking SSE connections.** When `state.page` changes, close any
  EventSource the previous page opened. The browser will eventually clean
  up tab-close, but during a long session it accumulates.
- **Polling without stopping.** Pair every `setInterval` with a `clearInterval`
  on the page transition.
- **Reading state via `document.querySelector`.** State is in TS. The DOM
  is rendered output.
- **Pretending a closure is a hook.** A `const useThing = () => { let x; return [x, setX] }` is just confusing. Use plain functions.
