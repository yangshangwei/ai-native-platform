import { expect, test } from 'vitest';
import { parseCodexJsonLine } from '../src/agents/codex-parser';

test('codex parser keeps non-JSON output as raw stream text', () => {
  expect(parseCodexJsonLine('plain text')).toMatchObject({
    type: 'raw',
    text: 'plain text',
  });
});

test('codex parser maps assistant message deltas to assistant events', () => {
  expect(
    parseCodexJsonLine(
      JSON.stringify({
        type: 'response.output_text.delta',
        delta: 'hello',
      }),
    ),
  ).toMatchObject({
    type: 'assistant',
    text: 'hello',
  });
});

test('codex parser renders exec tool events for UI streaming', () => {
  expect(
    parseCodexJsonLine(
      JSON.stringify({
        type: 'exec_command_begin',
        cmd: 'sed -n 1,20p README.md',
      }),
    ),
  ).toMatchObject({
    type: 'assistant',
    text: '[tool→ exec] sed -n 1,20p README.md',
  });
});

test('codex parser maps terminal result metadata to result events', () => {
  expect(
    parseCodexJsonLine(
      JSON.stringify({
        type: 'task_complete',
        last_agent_message: 'Wrote the artifact.',
      }),
    ),
  ).toMatchObject({
    type: 'result',
    text: '[result] Wrote the artifact.',
  });
});
