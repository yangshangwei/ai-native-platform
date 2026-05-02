import { describe, it, expect } from 'vitest';
import { parseStreamLine, mapClaudeCodeType, renderHumanReadable } from '../src/agents/claude-code-parser';

describe('claude-code parser', () => {
  it('maps top-level claude `type` to AgentStreamEventType', () => {
    expect(mapClaudeCodeType('system')).toBe('system');
    expect(mapClaudeCodeType('assistant')).toBe('assistant');
    expect(mapClaudeCodeType('user')).toBe('user');
    expect(mapClaudeCodeType('result')).toBe('result');
    expect(mapClaudeCodeType('foo')).toBe('meta');
    expect(mapClaudeCodeType(null)).toBe('meta');
  });

  it('returns raw fallback for non-JSON lines', () => {
    const r = parseStreamLine('not a json line');
    expect(r.type).toBe('raw');
    expect(r.payload).toEqual({ line: 'not a json line' });
    expect(r.text).toBe('not a json line');
  });

  it('skips empty lines as raw with null text', () => {
    const r = parseStreamLine('   ');
    expect(r.type).toBe('raw');
    expect(r.text).toBeNull();
  });

  it('parses a system/init event', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'init',
      cwd: '/tmp/work',
      model: 'claude-opus-4-7',
    });
    const r = parseStreamLine(line);
    expect(r.type).toBe('system');
    expect(r.text).toContain('cwd=/tmp/work');
    expect(r.text).toContain('model=claude-opus-4-7');
  });

  it('parses an assistant text block', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'Hello world' }],
      },
    });
    const r = parseStreamLine(line);
    expect(r.type).toBe('assistant');
    expect(r.text).toContain('[claude] Hello world');
  });

  it('parses an assistant tool_use block', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: '/tmp/x.java' } }],
      },
    });
    const r = parseStreamLine(line);
    expect(r.type).toBe('assistant');
    expect(r.text).toContain('[tool→ Read]');
    expect(r.text).toContain('file_path');
  });

  it('parses a user tool_result block', () => {
    const line = JSON.stringify({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_1',
            is_error: false,
            content: [{ type: 'text', text: 'class Calculator { ... }' }],
          },
        ],
      },
    });
    const r = parseStreamLine(line);
    expect(r.type).toBe('user');
    expect(r.text).toContain('[tool← ok]');
    expect(r.text).toContain('Calculator');
  });

  it('flags tool_result errors', () => {
    const line = JSON.stringify({
      type: 'user',
      message: {
        content: [{ type: 'tool_result', is_error: true, content: 'permission denied' }],
      },
    });
    const r = parseStreamLine(line);
    expect(r.text).toContain('[tool← ERR]');
    expect(r.text).toContain('permission denied');
  });

  it('parses the terminal result event', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      duration_ms: 1234,
      total_cost_usd: 0.01,
      result: 'Done.',
    });
    const r = parseStreamLine(line);
    expect(r.type).toBe('result');
    expect(r.text).toContain('1234ms');
    expect(r.text).toContain('$0.01');
    expect(r.text).toContain('Done.');
  });

  it('renderHumanReadable returns null for unknown blocks', () => {
    expect(renderHumanReadable('assistant', { message: { content: [] } })).toBeNull();
  });

  it('truncates long assistant text', () => {
    const long = 'x'.repeat(500);
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: long }] },
    });
    const r = parseStreamLine(line);
    expect(r.text!.length).toBeLessThan(long.length);
    expect(r.text).toContain('…');
  });

  it('renders content_block_delta text deltas as live tokens', () => {
    const line = JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } },
    });
    const r = parseStreamLine(line);
    expect(r.type).toBe('assistant'); // bucketed under assistant for UI styling
    expect(r.text).toContain('Hello');
    expect(r.text).toContain('claude…');
  });

  it('renders tool-use block start as a live tool open', () => {
    const line = JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_start', content_block: { type: 'tool_use', name: 'Read' } },
    });
    const r = parseStreamLine(line);
    expect(r.type).toBe('assistant');
    expect(r.text).toContain('Read');
    expect(r.text).toContain('tool→');
  });

  it('silences uninteresting partial events (message_start / content_block_stop)', () => {
    const a = parseStreamLine(JSON.stringify({ type: 'stream_event', event: { type: 'message_start' } }));
    const b = parseStreamLine(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_stop' } }));
    expect(a.text).toBeNull();
    expect(b.text).toBeNull();
  });
});
