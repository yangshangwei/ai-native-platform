import { describe, expect, it } from 'vitest';
import {
  buildStreamDisplayLines,
  lastStreamSequenceForRun,
  rememberStreamEventInCache,
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
  };
}

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
      prefix: '[1–3 Claude Code assistant]',
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
      '[1 Claude Code assistant]',
      '[2 Claude Code assistant]',
      '[3 Claude Code assistant]',
      '[4 Claude Code stderr]',
      '[5 Claude Code result]',
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
      '[1 Claude Code system]',
      '[2 Claude Code assistant]',
      '[3 Claude Code user]',
      '[4 Claude Code assistant]',
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
      prefix: '[10 Claude Code assistant]',
      text: 'I will inspect this.',
      sequences: [10],
    });
    expect(lines[1]).toMatchObject({
      prefix: '[10 Claude Code assistant]',
      text: '[tool→ Read] {"file_path":"apps/web/src/main.ts"}',
      sequences: [10],
    });
    expect(lines[2]).toMatchObject({
      prefix: '[11 Claude Code assistant]',
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
      prefix: '[20 Claude Code assistant]',
      text: '{"type":"stream_event","event":{"type":"message_start"}}',
    });
    expect(lines[1]).toMatchObject({
      className: 'stream-line assistant assistant-readable',
      prefix: '[21 Claude Code assistant]',
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
        prefix: '[1–3 Claude Code assistant]',
        text: 'Hello',
        sequences: [1, 2, 3],
      },
    ]);
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
});
