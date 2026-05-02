import type { AgentStreamEvent } from '@ainp/shared';

/**
 * In-process pub/sub for live agent event streaming. SSE handlers subscribe
 * per workflow run; runner POSTs publish to all subscribers.
 *
 * History is in `agent_events` SQLite — this bus is **only** for live tail.
 * SSE endpoints fetch history first, then attach a subscriber to receive
 * subsequent events (no race because both go through `publish`).
 */
type Subscriber = (event: AgentStreamEvent) => void;

const subscribers = new Map<string, Set<Subscriber>>();

export function subscribe(workflowRunId: string, fn: Subscriber): () => void {
  let set = subscribers.get(workflowRunId);
  if (!set) {
    set = new Set();
    subscribers.set(workflowRunId, set);
  }
  set.add(fn);
  return () => {
    const s = subscribers.get(workflowRunId);
    if (!s) return;
    s.delete(fn);
    if (s.size === 0) subscribers.delete(workflowRunId);
  };
}

export function publish(event: AgentStreamEvent): void {
  const set = subscribers.get(event.workflowRunId);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(event);
    } catch {
      // Subscriber failures must not stop other listeners.
    }
  }
}

export function subscriberCount(workflowRunId: string): number {
  return subscribers.get(workflowRunId)?.size ?? 0;
}
