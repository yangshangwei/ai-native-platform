import { describe, expect, it } from 'vitest';
import {
  buildStreamDisplayLines,
  lastStreamSequenceForChannel,
  lastStreamSequenceForRun,
  rememberStreamEventInCache,
  streamChannelForEvent,
  streamChannelKey,
  streamEventsForChannel,
  streamEventsForRun,
  type StreamDisplayEvent,
  type StreamEventCache,
} from '../src/stream-rendering';

function event(
  sequence: number,
  type: StreamDisplayEvent['type'],
  text: string | null,
  payload: Record<string, unknown> = { type },
): StreamDisplayEvent {
  return {
    sequence,
    agentKind: 'claude_code',
    type,
    text,
    payload,
    ts: '2026-05-10T10:30:45.000Z',
  };
}

/** Expected local-time prefix for the test fixture ts. */
const T = (() => {
  const d = new Date('2026-05-10T10:30:45.000Z');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
})();

function streamEvent(
  workflowRunId: string,
  sequence: number,
  type: StreamDisplayEvent['type'],
  text: string | null,
): StreamDisplayEvent & { workflowRunId: string } {
  return {
    ...event(sequence, type, text),
    workflowRunId,
  };
}

function requestStreamEvent(
  workflowRequestId: string,
  sequence: number,
  type: StreamDisplayEvent['type'],
  text: string | null,
): StreamDisplayEvent & { workflowRunId: null; workflowRequestId: string } {
  return {
    ...event(sequence, type, text),
    workflowRunId: null,
    workflowRequestId,
  };
}

describe('web agent stream rendering', () => {
  it('merges consecutive Claude assistant text deltas into one readable block', () => {
    const lines = buildStreamDisplayLines([
      event(1, 'assistant', '[claude…] Hel'),
      event(2, 'assistant', '[claude…] lo'),
      event(3, 'assistant', '[claude…]  world'),
    ]);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      className: 'stream-line assistant assistant-readable',
      prefix: `[${T} 1–3 Claude Code assistant]`,
      text: 'Hello world',
      sequences: [1, 2, 3],
    });
    expect(lines[0]?.title).toContain('1, 2, 3');
  });

  it('keeps tool, stderr, and result boundaries between assistant prose blocks', () => {
    const lines = buildStreamDisplayLines([
      event(1, 'assistant', '[claude…] Reading the file'),
      event(2, 'assistant', '[tool→ Read…]'),
      event(3, 'assistant', '[claude…] Done'),
      event(4, 'stderr', 'warning from cli'),
      event(5, 'result', '[result:success] 20ms'),
    ]);

    expect(lines.map((line) => line.prefix)).toEqual([
      `[${T} 1 Claude Code assistant]`,
      `[${T} 2 Claude Code assistant]`,
      `[${T} 3 Claude Code assistant]`,
      `[${T} 4 Claude Code stderr]`,
      `[${T} 5 Claude Code result]`,
    ]);
    expect(lines.map((line) => line.text)).toEqual([
      'Reading the file',
      '[tool→ Read…]',
      'Done',
      'warning from cli',
      '[result:success] 20ms',
    ]);
    expect(lines[0]?.className).toContain('assistant-readable');
    expect(lines[1]?.className).not.toContain('assistant-readable');
  });

  it('keeps system and tool-result boundaries between assistant prose blocks', () => {
    const lines = buildStreamDisplayLines([
      event(1, 'system', '[init] cwd=/tmp model=claude'),
      event(2, 'assistant', '[claude…] Inspecting'),
      event(3, 'user', '[tool← ok] file contents'),
      event(4, 'assistant', '[claude…] Continuing'),
    ]);

    expect(lines.map((line) => line.prefix)).toEqual([
      `[${T} 1 Claude Code system]`,
      `[${T} 2 Claude Code assistant]`,
      `[${T} 3 Claude Code user]`,
      `[${T} 4 Claude Code assistant]`,
    ]);
    expect(lines.map((line) => line.text)).toEqual([
      '[init] cwd=/tmp model=claude',
      'Inspecting',
      '[tool← ok] file contents',
      'Continuing',
    ]);
    expect(lines[0]?.className).toBe('stream-line system');
    expect(lines[2]?.className).toBe('stream-line user');
  });

  it('splits mixed assistant prose and tool-use text so tool lines remain a boundary', () => {
    const lines = buildStreamDisplayLines([
      event(10, 'assistant', '[claude] I will inspect this.\n[tool→ Read] {"file_path":"apps/web/src/main.ts"}'),
      event(11, 'assistant', '[claude…] Continuing after the tool.'),
    ]);

    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({
      prefix: `[${T} 10 Claude Code assistant]`,
      text: 'I will inspect this.',
      sequences: [10],
    });
    expect(lines[1]).toMatchObject({
      prefix: `[${T} 10 Claude Code assistant]`,
      text: '[tool→ Read] {"file_path":"apps/web/src/main.ts"}',
      sequences: [10],
    });
    expect(lines[2]).toMatchObject({
      prefix: `[${T} 11 Claude Code assistant]`,
      text: 'Continuing after the tool.',
      sequences: [11],
    });
  });

  it('keeps raw fallback metadata visible when assistant events have no prose text', () => {
    const lines = buildStreamDisplayLines([
      event(20, 'assistant', null, { type: 'stream_event', event: { type: 'message_start' } }),
      event(21, 'assistant', '[claude…] visible text'),
    ]);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      className: 'stream-line assistant',
      prefix: `[${T} 20 Claude Code assistant]`,
      text: '{"type":"stream_event","event":{"type":"message_start"}}',
    });
    expect(lines[1]).toMatchObject({
      className: 'stream-line assistant assistant-readable',
      prefix: `[${T} 21 Claude Code assistant]`,
      text: 'visible text',
    });
  });

  it('dedupes replayed stream events by sequence while preserving sorted live-tail order', () => {
    const cache: StreamEventCache<StreamDisplayEvent & { workflowRunId: string }> = new Map();
    const runId = 'run_stream';

    expect(rememberStreamEventInCache(cache, streamEvent(runId, 1, 'assistant', '[claude…] He'))).toBe(true);
    expect(rememberStreamEventInCache(cache, streamEvent(runId, 1, 'assistant', '[claude…] He'))).toBe(false);
    expect(rememberStreamEventInCache(cache, streamEvent(runId, 3, 'assistant', '[claude…] lo'))).toBe(true);
    expect(rememberStreamEventInCache(cache, streamEvent(runId, 2, 'assistant', '[claude…] l'))).toBe(true);

    const stored = streamEventsForRun(cache, runId);
    expect(stored.map((storedEvent) => storedEvent.sequence)).toEqual([1, 2, 3]);
    expect(lastStreamSequenceForRun(cache, runId)).toBe(3);
    expect(buildStreamDisplayLines(stored)).toMatchObject([
      {
        prefix: `[${T} 1–3 Claude Code assistant]`,
        text: 'Hello',
        sequences: [1, 2, 3],
      },
    ]);
  });

  it('keeps request and run channels isolated while preserving per-channel resume sequence', () => {
    const cache: StreamEventCache<
      StreamDisplayEvent & { workflowRunId: string | null; workflowRequestId?: string | null }
    > = new Map();
    const requestChannel = { kind: 'request' as const, id: 'wreq_stream' };
    const runChannel = { kind: 'run' as const, id: 'wrun_stream' };

    expect(streamChannelKey(requestChannel)).toBe('request:wreq_stream');
    expect(streamChannelForEvent(requestStreamEvent(requestChannel.id, 1, 'meta', '[meta:cli_started]'))).toEqual(requestChannel);
    expect(rememberStreamEventInCache(cache, requestStreamEvent(requestChannel.id, 1, 'meta', '[meta:cli_started]'))).toBe(true);
    expect(rememberStreamEventInCache(cache, requestStreamEvent(requestChannel.id, 2, 'assistant', '[claude…] Coordinating'))).toBe(true);
    expect(rememberStreamEventInCache(cache, streamEvent(runChannel.id, 1, 'assistant', '[claude…] Implementing'))).toBe(true);
    expect(rememberStreamEventInCache(cache, requestStreamEvent(requestChannel.id, 2, 'assistant', '[claude…] Coordinating'))).toBe(false);

    expect(streamEventsForChannel(cache, requestChannel).map((stored) => stored.sequence)).toEqual([1, 2]);
    expect(streamEventsForChannel(cache, runChannel).map((stored) => stored.sequence)).toEqual([1]);
    expect(lastStreamSequenceForChannel(cache, requestChannel)).toBe(2);
    expect(lastStreamSequenceForChannel(cache, runChannel)).toBe(1);
    expect(buildStreamDisplayLines(streamEventsForChannel(cache, requestChannel)).at(-1)).toMatchObject({
      prefix: `[${T} 2 Claude Code assistant]`,
      text: 'Coordinating',
    });
  });

  it('rejects malformed stream events without a single request/run channel', () => {
    const cache: StreamEventCache<
      StreamDisplayEvent & { workflowRunId: string | null; workflowRequestId?: string | null }
    > = new Map();
    const neither = { ...event(1, 'assistant', '[claude…] orphan'), workflowRunId: null, workflowRequestId: null };
    const both = { ...event(2, 'assistant', '[claude…] ambiguous'), workflowRunId: 'run_1', workflowRequestId: 'req_1' };

    expect(streamChannelForEvent(neither)).toBeNull();
    expect(streamChannelForEvent(both)).toBeNull();
    expect(rememberStreamEventInCache(cache, neither)).toBe(false);
    expect(rememberStreamEventInCache(cache, both)).toBe(false);
    expect(cache.size).toBe(0);
  });

  it('builds identical readable live-tail snapshots for compact and expanded views from one cache', () => {
    const cache: StreamEventCache<StreamDisplayEvent & { workflowRunId: string }> = new Map();
    const runId = 'run_recording';

    rememberStreamEventInCache(cache, streamEvent(runId, 1, 'assistant', '[claude…] First'));
    rememberStreamEventInCache(cache, streamEvent(runId, 2, 'assistant', '[claude…]  line'));

    const compactBefore = buildStreamDisplayLines(streamEventsForRun(cache, runId));
    const expandedBefore = buildStreamDisplayLines(streamEventsForRun(cache, runId));
    expect(expandedBefore).toEqual(compactBefore);

    rememberStreamEventInCache(cache, streamEvent(runId, 3, 'stderr', 'warning from cli'));
    rememberStreamEventInCache(cache, streamEvent(runId, 4, 'assistant', '[claude…] Continuing live'));

    const compactAfter = buildStreamDisplayLines(streamEventsForRun(cache, runId));
    const expandedAfter = buildStreamDisplayLines(streamEventsForRun(cache, runId));
    expect(expandedAfter).toEqual(compactAfter);
    expect(compactAfter.map((line) => line.text)).toEqual([
      'First line',
      'warning from cli',
      'Continuing live',
    ]);
  });

  it('merges consecutive Codex assistant deltas using [codex…] prefix', () => {
    const lines = buildStreamDisplayLines([
      { ...event(1, 'assistant', '[codex…] Sum'), agentKind: 'codex' },
      { ...event(2, 'assistant', '[codex…] marizing'), agentKind: 'codex' },
      { ...event(3, 'assistant', '[codex…]  repo'), agentKind: 'codex' },
    ]);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      className: 'stream-line assistant assistant-readable',
      prefix: `[${T} 1–3 Codex assistant]`,
      text: 'Summarizing repo',
      sequences: [1, 2, 3],
    });
  });

  it('keeps Codex tool and result events as boundaries between prose blocks', () => {
    const lines = buildStreamDisplayLines([
      { ...event(10, 'assistant', '[codex…] Planning'), agentKind: 'codex' },
      { ...event(11, 'assistant', '[tool→ exec…] bash -lc ls'), agentKind: 'codex' },
      { ...event(12, 'user', '[tool← ok] exec exit=0 — bash -lc ls'), agentKind: 'codex' },
      { ...event(13, 'assistant', '[codex] Repo has README.'), agentKind: 'codex' },
      { ...event(14, 'result', '[result:turn] in=100 cache=40 out=12'), agentKind: 'codex' },
    ]);

    expect(lines.map((line) => line.prefix)).toEqual([
      `[${T} 10 Codex assistant]`,
      `[${T} 11 Codex assistant]`,
      `[${T} 12 Codex user]`,
      `[${T} 13 Codex assistant]`,
      `[${T} 14 Codex result]`,
    ]);
    expect(lines.map((line) => line.text)).toEqual([
      'Planning',
      '[tool→ exec…] bash -lc ls',
      '[tool← ok] exec exit=0 — bash -lc ls',
      'Repo has README.',
      '[result:turn] in=100 cache=40 out=12',
    ]);
    expect(lines[0]?.className).toContain('assistant-readable');
    expect(lines[1]?.className).not.toContain('assistant-readable');
    expect(lines[3]?.className).toContain('assistant-readable');
  });

  it('does not merge Claude and Codex prose blocks across backends', () => {
    const lines = buildStreamDisplayLines([
      { ...event(1, 'assistant', '[claude…] Claude speaking'), agentKind: 'claude_code' },
      { ...event(2, 'assistant', '[codex…] Codex speaking'), agentKind: 'codex' },
    ]);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ prefix: `[${T} 1 Claude Code assistant]`, text: 'Claude speaking' });
    expect(lines[1]).toMatchObject({ prefix: `[${T} 2 Codex assistant]`, text: 'Codex speaking' });
  });
});
