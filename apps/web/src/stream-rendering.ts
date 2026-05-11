import type { AgentBackendKind, AgentStreamEventType } from '@ainp/shared';

export type StreamDisplayEventType = AgentStreamEventType;

export interface StreamDisplayEvent {
  sequence: number;
  agentKind: AgentBackendKind;
  type: StreamDisplayEventType;
  payload: Record<string, unknown>;
  text: string | null;
  ts?: string | null;
}

export interface StreamDisplayLine {
  className: string;
  prefix: string;
  text: string;
  sequences: number[];
  title?: string;
  ts?: string | null;
}

export type StreamChannelKind = 'run' | 'request';

export interface StreamChannel {
  kind: StreamChannelKind;
  id: string;
}

export interface StreamChannelEvent {
  workflowRunId?: string | null;
  workflowRequestId?: string | null;
  sequence: number;
}

export type StreamEventCache<T extends StreamChannelEvent> = Map<string, Map<number, T>>;

type AssistantTextFlavor = 'delta' | 'message';

interface AssistantTextSegment {
  mergeable: true;
  agentKind: string;
  sequence: number;
  text: string;
  flavor: AssistantTextFlavor;
  ts: string | null;
}

interface BoundarySegment {
  mergeable: false;
  event: StreamDisplayEvent;
  text: string;
}

type StreamTextSegment = AssistantTextSegment | BoundarySegment;

interface PendingAssistantGroup {
  agentKind: string;
  sequences: number[];
  text: string;
  lastFlavor: AssistantTextFlavor;
  firstTs: string | null;
}

export function streamChannelKey(channel: StreamChannel): string {
  return `${channel.kind}:${channel.id}`;
}

export function streamChannelForEvent(event: StreamChannelEvent): StreamChannel | null {
  const hasRun = typeof event.workflowRunId === 'string' && event.workflowRunId.length > 0;
  const hasRequest = typeof event.workflowRequestId === 'string' && event.workflowRequestId.length > 0;
  if (hasRun === hasRequest) return null;
  return hasRun
    ? { kind: 'run', id: event.workflowRunId as string }
    : { kind: 'request', id: event.workflowRequestId as string };
}

export function rememberStreamEventInCache<T extends StreamChannelEvent>(
  cache: StreamEventCache<T>,
  event: T,
  maxEvents = 1_000,
): boolean {
  const channel = streamChannelForEvent(event);
  if (!channel) return false;
  const key = streamChannelKey(channel);
  let events = cache.get(key);
  if (!events) {
    events = new Map();
    cache.set(key, events);
  }
  if (events.has(event.sequence)) return false;
  events.set(event.sequence, event);
  while (events.size > maxEvents) {
    const [first] = [...events.keys()].sort((a, b) => a - b);
    if (first === undefined) break;
    events.delete(first);
  }
  return true;
}

export function streamEventsForChannel<T extends StreamChannelEvent>(
  cache: StreamEventCache<T>,
  channel: StreamChannel,
): T[] {
  return [...(cache.get(streamChannelKey(channel))?.values() ?? [])].sort((a, b) => a.sequence - b.sequence);
}

export function lastStreamSequenceForChannel<T extends StreamChannelEvent>(
  cache: StreamEventCache<T>,
  channel: StreamChannel,
): number {
  return streamEventsForChannel(cache, channel).at(-1)?.sequence ?? -1;
}

export function streamEventsForRun<T extends StreamChannelEvent & { workflowRunId: string }>(
  cache: StreamEventCache<T>,
  runId: string,
): T[] {
  return streamEventsForChannel(cache, { kind: 'run', id: runId });
}

export function lastStreamSequenceForRun<T extends StreamChannelEvent & { workflowRunId: string }>(
  cache: StreamEventCache<T>,
  runId: string,
): number {
  return lastStreamSequenceForChannel(cache, { kind: 'run', id: runId });
}

export function buildStreamDisplayLines(events: readonly StreamDisplayEvent[]): StreamDisplayLine[] {
  const lines: StreamDisplayLine[] = [];
  let pending: PendingAssistantGroup | null = null;

  const flushPending = (): void => {
    if (!pending) return;
    const text = pending.text.trimEnd();
    if (text) {
      const backend = streamAgentBackendDisplayName(pending.agentKind);
      const sequenceLabel = formatSequenceLabel(pending.sequences);
      const time = formatEventTime(pending.firstTs);
      lines.push({
        className: 'stream-line assistant assistant-readable',
        prefix: `[${time} ${sequenceLabel} ${backend} assistant]`,
        text,
        sequences: [...pending.sequences],
        title: `raw sequences: ${formatSequenceTitle(pending.sequences)}`,
        ts: pending.firstTs,
      });
    }
    pending = null;
  };

  for (const event of events) {
    for (const segment of streamTextSegments(event)) {
      if (!segment.mergeable) {
        flushPending();
        lines.push(renderBoundaryLine(segment.event, segment.text));
        continue;
      }

      if (!pending || pending.agentKind !== segment.agentKind) {
        flushPending();
        pending = {
          agentKind: segment.agentKind,
          sequences: [segment.sequence],
          text: segment.text,
          lastFlavor: segment.flavor,
          firstTs: segment.ts,
        };
        continue;
      }

      appendSequence(pending.sequences, segment.sequence);
      pending.text = appendAssistantText(pending.text, segment.text, segment.flavor, pending.lastFlavor);
      pending.lastFlavor = segment.flavor;
    }
  }

  flushPending();
  return lines;
}

export function streamAgentBackendDisplayName(kind: string | null | undefined): string {
  if (kind === 'claude_code') return 'Claude Code';
  if (kind === 'codex') return 'Codex';
  return 'Legacy test backend';
}

function streamTextSegments(event: StreamDisplayEvent): StreamTextSegment[] {
  const text = event.text ?? renderStreamFallbackText(event);
  if (event.type === 'assistant') {
    const assistantSegments = assistantTextSegments(event, text);
    if (assistantSegments.length > 0) return assistantSegments;
  }

  const lines = splitRenderableLines(text);
  return (lines.length ? lines : [`(${event.type})`]).map((line) => ({
    mergeable: false,
    event,
    text: line,
  }));
}

function assistantTextSegments(event: StreamDisplayEvent, text: string): StreamTextSegment[] {
  const segments: StreamTextSegment[] = [];
  let pending: { text: string; lastFlavor: AssistantTextFlavor } | null = null;

  const flushPending = (): void => {
    if (!pending) return;
    const text = pending.text.trimEnd();
    if (text) {
      segments.push({
        mergeable: true,
        agentKind: event.agentKind,
        sequence: event.sequence,
        text,
        flavor: pending.lastFlavor,
        ts: event.ts ?? null,
      });
    }
    pending = null;
  };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd();
    const prose = parseAssistantProseLine(line);
    if (prose) {
      if (!pending) {
        pending = { text: prose.text, lastFlavor: prose.flavor };
      } else {
        pending.text = appendAssistantText(pending.text, prose.text, prose.flavor, pending.lastFlavor);
        pending.lastFlavor = prose.flavor;
      }
      continue;
    }

    if (line.length === 0) {
      if (pending) pending.text = `${pending.text}\n`;
      continue;
    }

    if (pending && !isAssistantBoundaryLine(line)) {
      pending.text = `${pending.text}${pending.text.endsWith('\n') ? '' : '\n'}${line}`;
      continue;
    }

    flushPending();
    segments.push({ mergeable: false, event, text: line });
  }

  flushPending();
  return segments;
}

function parseAssistantProseLine(line: string): { text: string; flavor: AssistantTextFlavor } | null {
  const claudeDelta = /^\[claude…\]\s?(.*)$/.exec(line);
  if (claudeDelta) return { text: claudeDelta[1] ?? '', flavor: 'delta' };

  const claudeMessage = /^\[claude\]\s?(.*)$/.exec(line);
  if (claudeMessage) return { text: claudeMessage[1] ?? '', flavor: 'message' };

  const codexDelta = /^\[codex…\]\s?(.*)$/.exec(line);
  if (codexDelta) return { text: codexDelta[1] ?? '', flavor: 'delta' };

  const codexMessage = /^\[codex\]\s?(.*)$/.exec(line);
  if (codexMessage) return { text: codexMessage[1] ?? '', flavor: 'message' };

  return null;
}

function isAssistantBoundaryLine(line: string): boolean {
  return /^\[(?:tool→|tool-input…|think\]|stop:)/.test(line);
}

function appendAssistantText(
  current: string,
  next: string,
  nextFlavor: AssistantTextFlavor,
  previousFlavor: AssistantTextFlavor,
): string {
  if (!current) return next;
  if (!next) return current;
  if (nextFlavor === 'delta' && previousFlavor === 'delta') return `${current}${next}`;
  if (current.endsWith('\n') || current.endsWith(' ') || next.startsWith('\n') || next.startsWith(' ')) {
    return `${current}${next}`;
  }
  return `${current}\n${next}`;
}

function renderBoundaryLine(event: StreamDisplayEvent, text: string): StreamDisplayLine {
  const backend = streamAgentBackendDisplayName(event.agentKind);
  const time = formatEventTime(event.ts);
  return {
    className: `stream-line ${event.type}`,
    prefix: `[${time} ${event.sequence} ${backend} ${event.type}]`,
    text,
    sequences: [event.sequence],
    ts: event.ts,
  };
}

function renderStreamFallbackText(event: StreamDisplayEvent): string {
  if (event.type === 'meta') {
    const metaEvent = typeof event.payload.event === 'string' ? event.payload.event : 'meta';
    return `[meta:${metaEvent}]`;
  }
  return JSON.stringify(event.payload);
}

function splitRenderableLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

function appendSequence(sequences: number[], sequence: number): void {
  if (sequences.at(-1) !== sequence) sequences.push(sequence);
}

function formatSequenceLabel(sequences: readonly number[]): string {
  const sorted = uniqueSortedSequences(sequences);
  const first = sorted[0];
  if (first === undefined) return '?';
  if (sorted.length === 1) return String(first);
  const last = sorted.at(-1)!;
  const contiguous = sorted.every((seq, index) => index === 0 || seq === sorted[index - 1]! + 1);
  if (contiguous) return `${first}–${last}`;
  if (sorted.length <= 5) return sorted.join(',');
  return `${first}–${last} (${sorted.length})`;
}

function formatSequenceTitle(sequences: readonly number[]): string {
  const sorted = uniqueSortedSequences(sequences);
  if (sorted.length <= 20) return sorted.join(', ');
  return `${sorted.slice(0, 12).join(', ')}, …, ${sorted.slice(-5).join(', ')}`;
}

function uniqueSortedSequences(sequences: readonly number[]): number[] {
  return [...new Set(sequences)].sort((a, b) => a - b);
}

function formatEventTime(ts: string | null | undefined): string {
  if (!ts) return '--:--:--';
  try {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  } catch {
    return '--:--:--';
  }
}
