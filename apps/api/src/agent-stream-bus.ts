import {
  agentStreamChannelKey,
  isAgentStreamChannel,
  type AgentStreamChannel,
  type AgentStreamEvent,
} from '@ainp/shared';

/**
 * In-process pub/sub for live agent event streaming. SSE handlers subscribe
 * per channel; runner POSTs publish to all subscribers on the matching
 * channel.
 *
 * Channels:
 *   - `run:<workflowRunId>`     — events from a workflow run
 *   - `request:<workflowRequestId>` — events from a pre-run phase such as
 *     Coordinator triage
 *
 * History is in `agent_events` SQLite — this bus is **only** for live tail.
 * SSE endpoints fetch history first, then attach a subscriber to receive
 * subsequent events (no race because both go through `publish`).
 */
type Subscriber = (event: AgentStreamEvent) => void;

const subscribers = new Map<string, Set<Subscriber>>();

export function subscribe(channel: AgentStreamChannel, fn: Subscriber): () => void {
  const key = agentStreamChannelKey(channel);
  let set = subscribers.get(key);
  if (!set) {
    set = new Set();
    subscribers.set(key, set);
  }
  set.add(fn);
  return () => {
    const s = subscribers.get(key);
    if (!s) return;
    s.delete(fn);
    if (s.size === 0) subscribers.delete(key);
  };
}

export function publish(event: AgentStreamEvent): void {
  const channel = isAgentStreamChannel(event);
  if (!channel) return;
  const set = subscribers.get(agentStreamChannelKey(channel));
  if (!set) return;
  for (const fn of set) {
    try {
      fn(event);
    } catch {
      // Subscriber failures must not stop other listeners.
    }
  }
}

export function subscriberCount(channel: AgentStreamChannel): number {
  return subscribers.get(agentStreamChannelKey(channel))?.size ?? 0;
}
