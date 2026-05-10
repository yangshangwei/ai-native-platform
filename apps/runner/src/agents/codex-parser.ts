/**
 * Parser for `codex exec --json` JSONL output.
 *
 * Codex emits a structured event stream where the useful content lives inside
 * `item.completed` events, keyed by `item.type` (`agent_message`, `reasoning`,
 * `command_execution`, `file_change`, `mcp_tool_call`, `web_search`, …).
 * Housekeeping events (`thread.started`, `turn.started`, `item.started`) carry
 * lifecycle info and should mostly be silent in the UI to keep the live log
 * readable, matching the Claude Code CLI style where each log line maps to a
 * concrete user-visible action.
 *
 * The parser produces prefixed text (`[codex]`, `[codex…]`, `[tool→ …]`,
 * `[tool← …]`, `[think]`, `[result:turn]`, …) that the web stream renderer
 * can merge into readable blocks, mirroring the Claude Code UX.
 */

import type { AgentStreamEventInput, AgentStreamEventType } from '@ainp/shared';

export interface ParsedCodexLine {
  type: AgentStreamEventType;
  payload: Record<string, unknown>;
  text: string | null;
}

export function parseCodexJsonLine(line: string): ParsedCodexLine {
  const trimmed = line.trim();
  if (!trimmed) return { type: 'raw', payload: {}, text: null };

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return { type: 'raw', payload: { line: trimmed }, text: trimmed };
  }

  const eventType = stringOr(payload['type'] ?? payload['event'], '');
  const rendered = renderCodexEvent(eventType, payload);
  return { type: rendered.type, payload, text: rendered.text };
}

export function mapCodexEventType(eventType: string): AgentStreamEventType {
  return renderCodexEvent(eventType, {}).type;
}

interface RenderedCodexEvent {
  type: AgentStreamEventType;
  text: string | null;
}

function renderCodexEvent(eventType: string, payload: Record<string, unknown>): RenderedCodexEvent {
  switch (eventType) {
    case 'thread.started':
    case 'turn.started':
      return { type: 'meta', text: null };
    case 'turn.completed':
      return { type: 'result', text: renderTurnCompleted(payload) };
    case 'turn.failed':
      return { type: 'stderr', text: renderTurnFailed(payload) };
    case 'item.started':
      return renderItemStarted(payload);
    case 'item.completed':
      return renderItemCompleted(payload);
    case 'item.updated':
      return renderItemUpdated(payload);
    case 'error':
      return { type: 'stderr', text: renderErrorEvent(payload) };
    default:
      return renderLegacyEvent(eventType, payload);
  }
}

function renderTurnCompleted(payload: Record<string, unknown>): string {
  const usage = readObject(payload['usage']);
  const parts: string[] = [];
  const input = readNumber(usage?.['input_tokens']);
  const cached = readNumber(usage?.['cached_input_tokens']);
  const output = readNumber(usage?.['output_tokens']);
  const reasoning = readNumber(usage?.['reasoning_output_tokens']);
  if (input != null) parts.push(`in=${input}`);
  if (cached != null) parts.push(`cache=${cached}`);
  if (output != null) parts.push(`out=${output}`);
  if (reasoning != null && reasoning > 0) parts.push(`reason=${reasoning}`);
  return parts.length > 0 ? `[result:turn] ${parts.join(' ')}` : '[result:turn]';
}

function renderTurnFailed(payload: Record<string, unknown>): string {
  const error = readObject(payload['error']);
  const message =
    stringOr(error?.['message'], '') ||
    stringOr(payload['message'], '') ||
    stringOr(payload['error'], '');
  return `[turn:failed] ${truncate(message || stringify(payload), 400)}`.trim();
}

function renderItemStarted(payload: Record<string, unknown>): RenderedCodexEvent {
  const item = readObject(payload['item']);
  const itemType = stringOr(item?.['type'], '');
  switch (itemType) {
    case 'command_execution': {
      const cmd = stringOr(item?.['command'], '') || stringify(item?.['command']);
      return { type: 'assistant', text: `[tool→ exec…] ${truncate(cmd, 240)}` };
    }
    case 'file_change': {
      const changes = readArray(item?.['changes']);
      const summary = summarizeFileChanges(changes);
      return { type: 'assistant', text: `[tool→ file_change…] ${summary}` };
    }
    case 'mcp_tool_call': {
      const server = stringOr(item?.['server'], '');
      const tool = stringOr(item?.['tool'] ?? item?.['name'], '');
      const label = [server, tool].filter(Boolean).join(':') || '(mcp)';
      return { type: 'assistant', text: `[tool→ mcp…] ${label}` };
    }
    case 'web_search': {
      const query = stringOr(item?.['query'], '');
      return { type: 'assistant', text: `[tool→ search…] ${truncate(query, 240)}` };
    }
    case 'agent_message':
    case 'reasoning':
      // Text arrives at completion; avoid emitting empty placeholders.
      return { type: 'meta', text: null };
    case 'plan_update':
    case 'todo':
      return { type: 'system', text: `[plan…] ${truncate(stringify(item), 240)}` };
    default:
      return { type: 'meta', text: null };
  }
}

function renderItemUpdated(payload: Record<string, unknown>): RenderedCodexEvent {
  const item = readObject(payload['item']);
  const itemType = stringOr(item?.['type'], '');
  if (itemType === 'agent_message') {
    const delta = stringOr(item?.['delta'] ?? item?.['text_delta'], '');
    if (delta) return { type: 'assistant', text: `[codex…] ${truncate(delta, 280)}` };
  }
  if (itemType === 'reasoning') {
    const delta = stringOr(item?.['delta'] ?? item?.['text_delta'], '');
    if (delta) return { type: 'assistant', text: `[think…] ${truncate(delta, 200)}` };
  }
  return { type: 'meta', text: null };
}

function renderItemCompleted(payload: Record<string, unknown>): RenderedCodexEvent {
  const item = readObject(payload['item']);
  const itemType = stringOr(item?.['type'], '');
  switch (itemType) {
    case 'agent_message': {
      const text = stringOr(item?.['text'], '');
      return text
        ? { type: 'assistant', text: `[codex] ${truncate(text, 400)}` }
        : { type: 'meta', text: null };
    }
    case 'reasoning': {
      const text = stringOr(item?.['text'] ?? item?.['summary'], '');
      return text ? { type: 'assistant', text: `[think] ${truncate(text, 240)}` } : { type: 'meta', text: null };
    }
    case 'command_execution': {
      const cmd = stringOr(item?.['command'], '') || stringify(item?.['command']);
      const exit = readNumber(item?.['exit_code']);
      const isErr = typeof exit === 'number' ? exit !== 0 : false;
      const output =
        stringOr(item?.['aggregated_output'] ?? item?.['output'] ?? item?.['stdout'], '') ||
        stringOr(item?.['stderr'], '');
      const head = `[tool← ${isErr ? 'ERR' : 'ok'}] exec${exit != null ? ` exit=${exit}` : ''}${cmd ? ` — ${truncate(cmd, 160)}` : ''}`;
      return {
        type: 'user',
        text: output ? `${head}\n${truncate(output, 400)}` : head,
      };
    }
    case 'file_change': {
      const changes = readArray(item?.['changes']);
      return { type: 'user', text: `[tool← ok] file_change ${summarizeFileChanges(changes)}` };
    }
    case 'mcp_tool_call': {
      const server = stringOr(item?.['server'], '');
      const tool = stringOr(item?.['tool'] ?? item?.['name'], '');
      const status = stringOr(item?.['status'], 'ok');
      const label = [server, tool].filter(Boolean).join(':') || '(mcp)';
      const result = stringify(item?.['result'] ?? item?.['output']);
      const head = `[tool← ${status === 'failed' || status === 'error' ? 'ERR' : 'ok'}] mcp ${label}`;
      return { type: 'user', text: result ? `${head}\n${truncate(result, 400)}` : head };
    }
    case 'web_search': {
      const query = stringOr(item?.['query'], '');
      return { type: 'user', text: `[tool← ok] search ${truncate(query, 240)}` };
    }
    case 'plan_update':
    case 'todo':
      return { type: 'system', text: `[plan] ${truncate(stringify(item), 280)}` };
    default: {
      // Unknown item type: keep visible so we can debug without drowning the log.
      const label = itemType || 'item';
      return { type: 'meta', text: `[item:${label}] ${truncate(stringify(item), 200)}` };
    }
  }
}

function renderErrorEvent(payload: Record<string, unknown>): string {
  const message =
    stringOr(payload['message'], '') ||
    stringOr(payload['error'], '') ||
    stringify(payload);
  return truncate(message, 400);
}

// ---------------------------------------------------------------------------
// Legacy compatibility — older Codex CLI versions and coordinator LLM tests
// still emit events like `response.output_text.delta`, `exec_command_begin`,
// and `task_complete`. Keep best-effort rendering so we don't regress.

function renderLegacyEvent(eventType: string, payload: Record<string, unknown>): RenderedCodexEvent {
  const lower = eventType.toLowerCase();
  if (!eventType) return { type: 'meta', text: null };

  if (lower.includes('error')) return { type: 'stderr', text: renderErrorEvent(payload) };

  if (lower.includes('output_text')) {
    const delta = stringOr(payload['delta'], '');
    if (delta) return { type: 'assistant', text: `[codex…] ${truncate(delta, 280)}` };
    const text = stringOr(payload['text'], '');
    if (text) return { type: 'assistant', text: `[codex] ${truncate(text, 400)}` };
    return { type: 'assistant', text: null };
  }

  if (lower.includes('exec_command')) {
    const cmd = payload['cmd'] ?? payload['command'] ?? payload['args'];
    const head = `[tool→ exec] ${truncate(stringify(cmd), 240)}`;
    return { type: 'assistant', text: head };
  }

  if (lower.includes('tool_result')) {
    const content = stringify(payload['content'] ?? payload['result'] ?? payload['output']);
    return { type: 'user', text: `[tool← ok] ${truncate(content, 400)}` };
  }

  if (lower.includes('task_complete') || lower.includes('complete') || lower === 'result') {
    const msg =
      payload['last_agent_message'] ??
      payload['result'] ??
      payload['message'] ??
      payload['text'] ??
      payload['summary'];
    const text = stringify(msg);
    return { type: 'result', text: `[result] ${truncate(text, 400)}`.trim() };
  }

  if (lower.includes('assistant')) {
    const text = stringOr(payload['text'] ?? payload['message'] ?? payload['delta'], '');
    return { type: 'assistant', text: text ? `[codex] ${truncate(text, 400)}` : null };
  }

  if (lower.includes('user')) {
    const text = stringOr(payload['text'] ?? payload['message'], '');
    return { type: 'user', text: text ? truncate(text, 400) : null };
  }

  if (lower.includes('system') || lower.includes('session') || lower.includes('started')) {
    return { type: 'system', text: `[system] ${eventType}` };
  }

  return { type: 'meta', text: `[meta:${eventType}]` };
}

// ---------------------------------------------------------------------------
// Helpers

function summarizeFileChanges(changes: readonly unknown[]): string {
  if (changes.length === 0) return '(no files)';
  const paths = changes
    .map((entry) => (entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null))
    .map((entry) => stringOr(entry?.['path'], ''))
    .filter(Boolean);
  if (paths.length === 0) return `${changes.length} change${changes.length === 1 ? '' : 's'}`;
  const head = paths.slice(0, 3).join(', ');
  const extra = paths.length > 3 ? ` (+${paths.length - 3} more)` : '';
  return `${head}${extra}`;
}

function readObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function stringify(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}

export type { AgentStreamEventInput };
