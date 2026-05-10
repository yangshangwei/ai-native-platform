import { describe, expect, test } from 'vitest';
import { parseCodexJsonLine } from '../src/agents/codex-parser';

describe('codex parser — raw / unknown lines', () => {
  test('keeps non-JSON output as raw stream text', () => {
    expect(parseCodexJsonLine('plain text')).toMatchObject({
      type: 'raw',
      text: 'plain text',
    });
  });

  test('falls back to meta for unknown event names', () => {
    expect(
      parseCodexJsonLine(JSON.stringify({ type: 'something.unknown', extra: 1 })),
    ).toMatchObject({
      type: 'meta',
      text: '[meta:something.unknown]',
    });
  });
});

describe('codex parser — new item/turn protocol', () => {
  test('thread.started and turn.started are silent meta events', () => {
    expect(parseCodexJsonLine(JSON.stringify({ type: 'thread.started', thread_id: 't1' }))).toMatchObject({
      type: 'meta',
      text: null,
    });
    expect(parseCodexJsonLine(JSON.stringify({ type: 'turn.started' }))).toMatchObject({
      type: 'meta',
      text: null,
    });
  });

  test('item.started for command_execution emits a [tool→ exec…] line', () => {
    expect(
      parseCodexJsonLine(
        JSON.stringify({
          type: 'item.started',
          item: { id: 'i1', type: 'command_execution', command: 'bash -lc ls', status: 'in_progress' },
        }),
      ),
    ).toMatchObject({
      type: 'assistant',
      text: '[tool→ exec…] bash -lc ls',
    });
  });

  test('item.started for agent_message stays silent until completion', () => {
    expect(
      parseCodexJsonLine(
        JSON.stringify({ type: 'item.started', item: { id: 'i2', type: 'agent_message' } }),
      ),
    ).toMatchObject({ type: 'meta', text: null });
  });

  test('item.completed for agent_message emits a [codex] line suitable for merging', () => {
    expect(
      parseCodexJsonLine(
        JSON.stringify({
          type: 'item.completed',
          item: {
            id: 'i3',
            type: 'agent_message',
            text: 'Repo contains docs, sdk, and examples directories.',
          },
        }),
      ),
    ).toMatchObject({
      type: 'assistant',
      text: '[codex] Repo contains docs, sdk, and examples directories.',
    });
  });

  test('item.completed for reasoning emits a [think] line', () => {
    expect(
      parseCodexJsonLine(
        JSON.stringify({ type: 'item.completed', item: { type: 'reasoning', text: 'Plan the fix.' } }),
      ),
    ).toMatchObject({ type: 'assistant', text: '[think] Plan the fix.' });
  });

  test('item.completed for command_execution emits a [tool←] line with exit code', () => {
    const parsed = parseCodexJsonLine(
      JSON.stringify({
        type: 'item.completed',
        item: {
          type: 'command_execution',
          command: 'bash -lc ls',
          exit_code: 0,
          aggregated_output: 'README.md\npackage.json',
        },
      }),
    );
    expect(parsed.type).toBe('user');
    expect(parsed.text).toBe('[tool← ok] exec exit=0 — bash -lc ls\nREADME.md\npackage.json');
  });

  test('item.completed for a failed command_execution is marked ERR', () => {
    const parsed = parseCodexJsonLine(
      JSON.stringify({
        type: 'item.completed',
        item: { type: 'command_execution', command: 'false', exit_code: 1 },
      }),
    );
    expect(parsed).toMatchObject({ type: 'user', text: '[tool← ERR] exec exit=1 — false' });
  });

  test('item.updated for agent_message emits streaming [codex…] delta lines', () => {
    expect(
      parseCodexJsonLine(
        JSON.stringify({ type: 'item.updated', item: { type: 'agent_message', delta: 'hel' } }),
      ),
    ).toMatchObject({ type: 'assistant', text: '[codex…] hel' });
  });

  test('turn.completed summarizes usage tokens as a result line', () => {
    expect(
      parseCodexJsonLine(
        JSON.stringify({
          type: 'turn.completed',
          usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 12, reasoning_output_tokens: 3 },
        }),
      ),
    ).toMatchObject({
      type: 'result',
      text: '[result:turn] in=100 cache=40 out=12 reason=3',
    });
  });

  test('turn.failed surfaces the error message through stderr', () => {
    expect(
      parseCodexJsonLine(
        JSON.stringify({ type: 'turn.failed', error: { message: 'rate limited' } }),
      ),
    ).toMatchObject({ type: 'stderr', text: '[turn:failed] rate limited' });
  });
});

describe('codex parser — legacy events', () => {
  test('maps assistant message deltas to [codex…] lines for UI merging', () => {
    expect(
      parseCodexJsonLine(
        JSON.stringify({ type: 'response.output_text.delta', delta: 'hello' }),
      ),
    ).toMatchObject({ type: 'assistant', text: '[codex…] hello' });
  });

  test('keeps legacy exec_command_begin format for older Codex CLIs', () => {
    expect(
      parseCodexJsonLine(
        JSON.stringify({ type: 'exec_command_begin', cmd: 'sed -n 1,20p README.md' }),
      ),
    ).toMatchObject({
      type: 'assistant',
      text: '[tool→ exec] sed -n 1,20p README.md',
    });
  });

  test('maps legacy task_complete metadata to a result event', () => {
    expect(
      parseCodexJsonLine(
        JSON.stringify({ type: 'task_complete', last_agent_message: 'Wrote the artifact.' }),
      ),
    ).toMatchObject({ type: 'result', text: '[result] Wrote the artifact.' });
  });
});
