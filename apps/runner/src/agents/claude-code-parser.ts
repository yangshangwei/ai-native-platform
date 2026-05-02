/**
 * Pure parsing helpers for the `claude --output-format stream-json` line
 * protocol. Kept separate from the spawning code so unit tests can drive it
 * with fixtures without touching the filesystem or child processes.
 *
 * The CLI emits one JSON object per line. Top-level discriminator is `type`:
 *   - `system`    — init / hook lifecycle / model info
 *   - `assistant` — assistant message (text deltas, tool_use blocks)
 *   - `user`      — user message (typically tool_result objects)
 *   - `result`    — terminal event with cost / duration / final text
 */

import type { AgentStreamEventType, AgentStreamEventInput, AgentBackendKind } from '@ainp/shared';

export interface ParsedClaudeLine {
  type: AgentStreamEventType;
  payload: Record<string, unknown>;
  text: string | null;
}

export function parseStreamLine(line: string): ParsedClaudeLine {
  const trimmed = line.trim();
  if (!trimmed) return { type: 'raw', payload: {}, text: null };

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return { type: 'raw', payload: { line: trimmed }, text: trimmed };
  }

  const type = mapClaudeCodeType((payload.type as string | undefined) ?? null);
  const text = renderHumanReadable(type, payload);
  return { type, payload, text };
}

export function mapClaudeCodeType(t: string | null): AgentStreamEventType {
  switch (t) {
    case 'system':
      return 'system';
    case 'assistant':
    // `stream_event` carries Anthropic SDK partial deltas (with
    // `--include-partial-messages`) — they're streamed assistant tokens, so
    // bucket them under 'assistant' for UI/styling.
    case 'stream_event':
      return 'assistant';
    case 'user':
      return 'user';
    case 'result':
      return 'result';
    default:
      return 'meta';
  }
}

/**
 * Pre-render a short human line for terminal/UI display.
 * Returns null when the event has no useful surface text (silent ping etc.).
 */
export function renderHumanReadable(
  type: AgentStreamEventType,
  payload: Record<string, unknown>,
): string | null {
  switch (type) {
    case 'system':
      return renderSystem(payload);
    case 'assistant':
      return renderAssistant(payload);
    case 'user':
      return renderUser(payload);
    case 'result':
      return renderResult(payload);
    case 'stderr':
      return (payload['line'] as string | undefined) ?? null;
    case 'raw':
      return (payload['line'] as string | undefined) ?? null;
    case 'meta':
      return renderMeta(payload);
    default:
      return null;
  }
}

function renderSystem(p: Record<string, unknown>): string | null {
  const sub = p['subtype'] as string | undefined;
  if (sub === 'init') {
    const cwd = p['cwd'] as string | undefined;
    const model = p['model'] as string | undefined;
    return `[init] cwd=${cwd ?? '?'} model=${model ?? '?'}`;
  }
  if (sub === 'hook_started') {
    return `[hook→] ${(p['hook_name'] as string) ?? '?'}`;
  }
  if (sub === 'hook_response') {
    const exit = p['exit_code'];
    return `[hook←] ${(p['hook_name'] as string) ?? '?'} exit=${exit ?? '?'}`;
  }
  return `[system] ${sub ?? ''}`.trim();
}

function renderAssistant(p: Record<string, unknown>): string | null {
  // Partial-delta events arrive as `{type: 'stream_event', event: {...SDK...}}`
  // when `--include-partial-messages` is on. These carry per-token text deltas
  // and are the closest thing to "as if I'm in the CLI" — preserve them.
  if (p['type'] === 'stream_event') {
    return renderStreamEventDelta(p);
  }
  const message = p['message'] as { content?: unknown } | undefined;
  if (!message || !Array.isArray(message.content)) return null;
  const parts: string[] = [];
  for (const block of message.content as unknown[]) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    if (b['type'] === 'text') {
      const text = (b['text'] as string | undefined) ?? '';
      if (text) parts.push(`[claude] ${truncate(text, 280)}`);
    } else if (b['type'] === 'tool_use') {
      const name = (b['name'] as string | undefined) ?? '?';
      const input = b['input'];
      parts.push(`[tool→ ${name}] ${truncate(stringifyInput(input), 200)}`);
    } else if (b['type'] === 'thinking') {
      const text = (b['thinking'] as string | undefined) ?? '';
      if (text) parts.push(`[think] ${truncate(text, 200)}`);
    }
  }
  return parts.length === 0 ? null : parts.join('\n');
}

interface SdkStreamEvent {
  type?: string;
  delta?: { type?: string; text?: string; partial_json?: string };
  content_block?: { type?: string; name?: string; text?: string };
  message?: { stop_reason?: string };
}

function renderStreamEventDelta(p: Record<string, unknown>): string | null {
  const evt = p['event'] as SdkStreamEvent | undefined;
  if (!evt || !evt.type) return null;
  switch (evt.type) {
    case 'content_block_start': {
      const blk = evt.content_block;
      if (blk?.type === 'tool_use') return `[tool→ ${blk.name ?? '?'}…]`;
      if (blk?.type === 'text') return blk.text ? `[claude…] ${truncate(blk.text, 280)}` : null;
      return null;
    }
    case 'content_block_delta': {
      const d = evt.delta;
      if (!d) return null;
      if (d.type === 'text_delta' && d.text) return `[claude…] ${truncate(d.text, 280)}`;
      if (d.type === 'input_json_delta' && d.partial_json) {
        return `[tool-input…] ${truncate(d.partial_json, 200)}`;
      }
      return null;
    }
    case 'message_delta':
      return evt.message?.stop_reason ? `[stop:${evt.message.stop_reason}]` : null;
    case 'message_start':
    case 'content_block_stop':
    case 'message_stop':
      return null; // silent
    default:
      return null;
  }
}

function renderUser(p: Record<string, unknown>): string | null {
  const message = p['message'] as { content?: unknown } | undefined;
  if (!message || !Array.isArray(message.content)) return null;
  const parts: string[] = [];
  for (const block of message.content as unknown[]) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    if (b['type'] === 'tool_result') {
      const isError = b['is_error'] === true;
      const content = b['content'];
      const flat = Array.isArray(content)
        ? content
            .map((it) => (typeof it === 'object' && it && 'text' in it ? String(it['text']) : ''))
            .filter(Boolean)
            .join('\n')
        : typeof content === 'string'
          ? content
          : JSON.stringify(content);
      parts.push(`[tool← ${isError ? 'ERR' : 'ok'}] ${truncate(flat, 280)}`);
    }
  }
  return parts.length === 0 ? null : parts.join('\n');
}

function renderResult(p: Record<string, unknown>): string {
  const subtype = p['subtype'] as string | undefined;
  const dur = p['duration_ms'] as number | undefined;
  const cost = p['total_cost_usd'] as number | undefined;
  const result = (p['result'] as string | undefined) ?? '';
  const head = `[result:${subtype ?? '?'}] ${dur != null ? `${dur}ms` : ''} ${cost != null ? `$${cost}` : ''}`.trim();
  if (!result) return head;
  return `${head}\n${truncate(result, 400)}`;
}

function renderMeta(p: Record<string, unknown>): string | null {
  const evt = p['event'] as string | undefined;
  if (!evt) return null;
  const detail = JSON.stringify({ ...p, event: undefined });
  return `[meta:${evt}] ${truncate(detail, 200)}`;
}

function stringifyInput(input: unknown): string {
  if (input == null) return '';
  if (typeof input === 'string') return input;
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}

export interface BuildEventOpts {
  workflowRunId: string;
  stepRunId: string | null;
  agentKind: AgentBackendKind;
}

export function toEventInput(
  parsed: ParsedClaudeLine,
  opts: BuildEventOpts,
): AgentStreamEventInput {
  return {
    workflowRunId: opts.workflowRunId,
    stepRunId: opts.stepRunId,
    agentKind: opts.agentKind,
    type: parsed.type,
    payload: parsed.payload,
    text: parsed.text,
  };
}
