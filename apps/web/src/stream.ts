/**
 * SSE agent stream controller — EventSource lifecycle + live view patching.
 *
 * Not a page: it is the live-tail engine consumed by the task-detail /
 * workbench / coordinator-chat / shell renderers (import direction stays
 * one-way: consumers → this module). Owns the stream* state family:
 *   - `streamES` / `streamChannel`: the single active EventSource and the
 *     run/request channel it is attached to;
 *   - `streamEventsByChannel`: per-channel event cache so reattaching
 *     resumes from `sinceSeq` instead of replaying history;
 *   - `streamConnection`: connection status for the attached channel;
 *   - `expandedStreamRunId`: which run's stream overlay is maximized
 *     (exported read-only; main.ts renders the overlay).
 * `refreshStreamViewsForChannel` is the hot path: it patches the stream
 * title/summary/body nodes in place on every SSE event instead of going
 * through the full root `render()`. Moved verbatim out of `main.ts`
 * (T2.2 page split).
 */

import {
  buildStreamDisplayLines,
  lastStreamSequenceForChannel,
  rememberStreamEventInCache,
  streamChannelForEvent,
  streamChannelKey,
  streamEventsForChannel,
  type StreamDisplayLine,
  type StreamChannel,
  type StreamEventCache,
} from './stream-rendering';
import type { AgentBackendKind, WorkflowRequestDto } from './types';
import { API_BASE } from './api';
import { el, shortId } from './dom';
import {
  activeRunAgentBackend,
  activeTaskRequest,
  data,
  selectedProjectBackend,
  ui,
} from './state';
import { render } from './render-core';

export interface AgentStreamEvent {
  id: string;
  workflowRunId: string | null;
  workflowRequestId?: string | null;
  stepRunId: string | null;
  agentKind: AgentBackendKind;
  sequence: number;
  type: 'system' | 'assistant' | 'user' | 'result' | 'stderr' | 'raw' | 'meta';
  payload: Record<string, unknown>;
  text: string | null;
  ts: string;
}

let streamES: EventSource | null = null;
// Read-only live bindings for importers (only this module assigns them):
// main.ts reads `streamChannel` for the coordinator stream view and
// `expandedStreamRunId` for the maximized-overlay shell rendering.
export let streamChannel: StreamChannel | null = null;
export let expandedStreamRunId: string | null = null;
const streamEventsByChannel: StreamEventCache<AgentStreamEvent> = new Map();
let streamConnection: { channelKey: string | null; label: string; cls: 'live' | 'idle' | 'error' } = {
  channelKey: null,
  label: 'disconnected',
  cls: 'idle',
};
const STREAM_EVENT_TYPES = ['system', 'assistant', 'user', 'result', 'stderr', 'meta', 'raw'] as const;

function setStreamStatus(label: string, cls: 'live' | 'idle' | 'error', channel: StreamChannel | null = streamChannel): void {
  const channelKey = channel ? streamChannelKey(channel) : null;
  streamConnection = { channelKey, label, cls };
  updateStreamStatusNodes(channel, label, cls);
}

function appendStreamEvent(ev: AgentStreamEvent): void {
  if (!rememberStreamEvent(ev)) return;
  const channel = streamChannelForEvent(ev);
  if (!channel || !streamChannel || streamChannelKey(channel) !== streamChannelKey(streamChannel)) return;
  refreshStreamViewsForChannel(channel);
}

function rememberStreamEvent(ev: AgentStreamEvent): boolean {
  return rememberStreamEventInCache(streamEventsByChannel, ev);
}

function agentStreamEventsForChannel(channel: StreamChannel): AgentStreamEvent[] {
  return streamEventsForChannel(streamEventsByChannel, channel);
}

function lastStreamSeqForChannel(channel: StreamChannel): number {
  return lastStreamSequenceForChannel(streamEventsByChannel, channel);
}

export interface AgentStreamViewModel {
  channel: StreamChannel | null;
  runId: string | null;
  title: string;
  summary: string;
  status: { label: string; cls: 'live' | 'idle' | 'error' };
  events: AgentStreamEvent[];
  lines: StreamDisplayLine[];
}

export function buildAgentStreamView(channel: StreamChannel | null): AgentStreamViewModel {
  const events = channel ? agentStreamEventsForChannel(channel) : [];
  const runId = channel?.kind === 'run' ? channel.id : null;
  const backend = streamBackendForChannel(channel, events);
  const title = channel?.kind === 'request'
    ? '开发者日志'
    : backend === 'claude_code'
      ? 'Claude Code 执行日志'
      : backend === 'codex'
        ? 'Codex 执行日志'
        : 'Agent 执行日志';
  return {
    channel,
    runId,
    title,
    summary: streamSummaryText(channel, events.length),
    status: streamStatusForChannel(channel),
    events,
    lines: buildStreamDisplayLines(events, true), // Native mode: hide metadata prefixes
  };
}

export function buildAgentStreamViewForRun(runId: string | null): AgentStreamViewModel {
  return buildAgentStreamView(runId ? { kind: 'run', id: runId } : null);
}

function streamBackendForRun(runId: string | null, events: readonly AgentStreamEvent[]): AgentBackendKind | null {
  if (runId && data.activeDetail?.run.id === runId) {
    return activeRunAgentBackend() ?? events.at(-1)?.agentKind ?? selectedProjectBackend();
  }
  if (events.length > 0) return events.at(-1)?.agentKind ?? null;
  const run = runId ? data.runs.find((item) => item.id === runId) : null;
  return data.projects.find((project) => project.id === run?.projectId)?.agentBackend ?? selectedProjectBackend();
}

function streamBackendForChannel(channel: StreamChannel | null, events: readonly AgentStreamEvent[]): AgentBackendKind | null {
  if (events.length > 0) return events.at(-1)?.agentKind ?? null;
  if (channel?.kind === 'run') return streamBackendForRun(channel.id, events);
  const request = channel?.kind === 'request' ? data.requests.find((item) => item.id === channel.id) : null;
  return data.projects.find((project) => project.id === request?.projectId)?.agentBackend ?? selectedProjectBackend();
}

function streamRunTitle(runId: string | null): string | null {
  if (!runId) return null;
  if (data.activeDetail?.run.id === runId) return data.activeDetail.run.title;
  return data.runs.find((run) => run.id === runId)?.title ?? null;
}

function streamRequestTitle(requestId: string): string | null {
  return data.requests.find((request) => request.id === requestId)?.title ?? null;
}

function streamSummaryText(channel: StreamChannel | null, eventCount: number): string {
  if (!channel) return '等待 stream channel';
  if (channel.kind === 'request') {
    const requestTitle = streamRequestTitle(channel.id);
    return `${requestTitle ? `${requestTitle} · ` : ''}Request ${shortId(channel.id)} · ${eventCount} events`;
  }
  const runTitle = streamRunTitle(channel.id);
  return `${runTitle ? `${runTitle} · ` : ''}Run ${shortId(channel.id)} · ${eventCount} events`;
}

function streamViewAttrs(view: AgentStreamViewModel, role: 'title' | 'summary' | 'status' | 'body'): Record<string, string> {
  const attrs: Record<string, string> = { [`data-stream-${role}`]: 'agent-stream' };
  if (view.channel) attrs['data-stream-channel-key'] = streamChannelKey(view.channel);
  if (view.runId) attrs['data-stream-run-id'] = view.runId;
  return attrs;
}

export function renderStreamTitle(view: AgentStreamViewModel, id?: string): HTMLElement {
  return el('h2', { id, text: view.title, attrs: streamViewAttrs(view, 'title') });
}

export function renderStreamSummary(view: AgentStreamViewModel, id?: string): HTMLElement {
  return el('small', { id, class: 'muted', text: view.summary, attrs: streamViewAttrs(view, 'summary') });
}

export function renderStreamStatus(view: AgentStreamViewModel): HTMLElement {
  return el('span', { class: `stream-status ${view.status.cls}`, text: view.status.label, attrs: streamViewAttrs(view, 'status') });
}

export function renderAgentStreamBody(
  view: AgentStreamViewModel,
  opts: { id?: string; expanded?: boolean; scrollKeyPrefix: string },
): HTMLElement {
  const attrs = streamViewAttrs(view, 'body');
  if (view.channel) {
    const key = streamChannelKey(view.channel);
    attrs['data-scroll-key'] = `${opts.scrollKeyPrefix}:${key}`;
    attrs['aria-label'] = `${view.title} ${view.summary}`;
  }
  attrs.role = 'log';
  attrs['aria-live'] = 'polite';
  attrs['aria-relevant'] = 'additions text';
  return el('div', {
    id: opts.id,
    class: `stream-body${opts.expanded ? ' stream-body-expanded' : ''}`,
    attrs,
    children: renderStreamBodyChildren(view),
  });
}

function renderStreamBodyChildren(view: AgentStreamViewModel): HTMLElement[] {
  return view.events.length
    ? view.lines.map(renderStreamDisplayLine)
    : [el('div', { class: 'stream-line meta', text: '等待真实 Agent Backend 输出；连接后会先回放历史事件，再继续 live tail。' })];
}

function renderStreamDisplayLine(line: StreamDisplayLine): HTMLElement {
  return el('div', {
    class: line.className,
    attrs: {
      'data-stream-sequences': line.sequences.join(','),
      ...(line.title ? { title: line.title } : {}),
    },
    children: [
      line.prefix ? el('span', { class: 'stream-prefix', text: line.prefix }) : null,
      el('span', { class: 'stream-text', text: line.prefix ? ` ${line.text}` : line.text }),
    ].filter(Boolean) as Node[],
  });
}

export function openExpandedStream(runId: string): void {
  expandedStreamRunId = runId;
  render();
  requestAnimationFrame(() => {
    scrollStreamBodiesToBottom({ kind: 'run', id: runId });
    document.querySelector<HTMLButtonElement>('[data-stream-close="agent-stream"]')?.focus();
  });
}

export function closeExpandedStream(): void {
  const closingRunId = expandedStreamRunId;
  expandedStreamRunId = null;
  render();
  if (closingRunId) {
    requestAnimationFrame(() => focusStreamExpandButton(closingRunId));
  }
}

function refreshStreamViewsForChannel(channel: StreamChannel): void {
  const view = buildAgentStreamView(channel);
  const key = streamChannelKey(channel);
  document.querySelectorAll<HTMLElement>('[data-stream-title="agent-stream"]').forEach((node) => {
    if (node.dataset.streamChannelKey === key) node.textContent = view.title;
  });
  document.querySelectorAll<HTMLElement>('[data-stream-summary="agent-stream"]').forEach((node) => {
    if (node.dataset.streamChannelKey === key) node.textContent = view.summary;
  });
  document.querySelectorAll<HTMLElement>('[data-stream-body="agent-stream"]').forEach((body) => {
    if (body.dataset.streamChannelKey !== key) return;
    body.setAttribute('aria-label', `${view.title} ${view.summary}`);
    body.replaceChildren(...renderStreamBodyChildren(view));
    body.scrollTop = body.scrollHeight;
  });
}

function updateStreamStatusNodes(channel: StreamChannel | null, label: string, cls: 'live' | 'idle' | 'error'): void {
  const key = channel ? streamChannelKey(channel) : null;
  document.querySelectorAll<HTMLElement>('[data-stream-status="agent-stream"]').forEach((node) => {
    if ((node.dataset.streamChannelKey ?? null) !== key) return;
    node.textContent = label;
    node.className = `stream-status ${cls}`;
  });
}

function scrollStreamBodiesToBottom(channel: StreamChannel): void {
  const key = streamChannelKey(channel);
  document.querySelectorAll<HTMLElement>('[data-stream-body="agent-stream"]').forEach((body) => {
    if (body.dataset.streamChannelKey === key) body.scrollTop = body.scrollHeight;
  });
}

function focusStreamExpandButton(runId: string): void {
  document.querySelectorAll<HTMLButtonElement>('[data-stream-expand-run-id]').forEach((button) => {
    if (button.dataset.streamExpandRunId === runId) button.focus();
  });
}

export function detachStream(): void {
  const detachedChannel = streamChannel;
  if (streamES) streamES.close();
  streamES = null;
  streamChannel = null;
  setStreamStatus('disconnected', 'idle', detachedChannel);
}

function attachStream(channel: StreamChannel): void {
  if (
    streamChannel &&
    streamChannelKey(streamChannel) === streamChannelKey(channel) &&
    streamES &&
    streamES.readyState !== EventSource.CLOSED
  ) return;
  const previousChannel = streamChannel;
  if (streamES) {
    streamES.close();
    setStreamStatus('disconnected', 'idle', previousChannel);
  }
  streamChannel = channel;
  setStreamStatus('connecting…', 'idle', channel);

  const sinceSeq = lastStreamSeqForChannel(channel);
  const endpoint = channel.kind === 'run'
    ? `/workflow-runs/${encodeURIComponent(channel.id)}/agent-stream`
    : `/workflow-requests/${encodeURIComponent(channel.id)}/agent-stream`;
  const es = new EventSource(`${API_BASE}${endpoint}?sinceSeq=${sinceSeq}`);
  streamES = es;
  es.addEventListener('ready', () => {
    if (streamES === es) setStreamStatus('live', 'live', channel);
  });
  es.addEventListener('ping', () => {
    if (streamES === es) setStreamStatus('live', 'live', channel);
  });
  for (const type of STREAM_EVENT_TYPES) {
    es.addEventListener(type, (raw) => {
      try {
        appendStreamEvent(JSON.parse((raw as MessageEvent<string>).data) as AgentStreamEvent);
      } catch {
        // ignore malformed SSE payloads
      }
    });
  }
  es.onerror = () => {
    if (streamES === es) setStreamStatus('reconnecting…', 'error', channel);
  };
}

export function attachRunStream(runId: string): void {
  attachStream({ kind: 'run', id: runId });
}

export function attachRequestStream(requestId: string): void {
  attachStream({ kind: 'request', id: requestId });
}

export function shouldSubscribeRequestStream(request: WorkflowRequestDto): boolean {
  return request.status === 'pending' || request.status === 'claimed' || request.status === 'awaiting_clarification';
}

export function syncActiveStreamSubscription(): void {
  if (ui.activePage === 'task') {
    const task = activeTaskRequest();
    if (!task) {
      detachStream();
      return;
    }
    if (task.workflowRunId) attachRunStream(task.workflowRunId);
    else if (shouldSubscribeRequestStream(task)) attachRequestStream(task.id);
    else detachStream();
    return;
  }
  if (ui.activePage === 'workbench' && ui.activeRunId) {
    attachRunStream(ui.activeRunId);
    return;
  }
  detachStream();
}

function streamStatusForChannel(channel: StreamChannel | null): { label: string; cls: 'live' | 'idle' | 'error' } {
  if (channel && streamConnection.channelKey === streamChannelKey(channel)) return streamConnection;
  return { label: 'disconnected', cls: 'idle' };
}
