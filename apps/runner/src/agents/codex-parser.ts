/**
 * Best-effort parser for `codex exec --json` JSONL output.
 *
 * Codex CLI event names can vary between versions, so this parser intentionally
 * keys off broad event families and preserves the raw payload for audit. The UI
 * only needs a stable bucket (`assistant`/`user`/`result`/`meta`/`raw`) plus a
 * short human-readable line.
 */

import type { AgentStreamEventInput } from '@ainp/shared';

export interface ParsedCodexLine {
  type: AgentStreamEventInput['type'];
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

  const eventType = String(payload['type'] ?? payload['event'] ?? '');
  const mapped = mapCodexEventType(eventType);
  return { type: mapped, payload, text: renderCodexText(mapped, payload) };
}

export function mapCodexEventType(eventType: string): AgentStreamEventInput['type'] {
  const t = eventType.toLowerCase();
  if (t.includes('error')) return 'stderr';
  if (t.includes('complete') || t.includes('completed') || t.includes('result')) return 'result';
  if (t.includes('assistant') || t.includes('output_text') || t.includes('exec_command')) return 'assistant';
  if (t.includes('user') || t.includes('tool_result')) return 'user';
  if (t.includes('system') || t.includes('session') || t.includes('started')) return 'system';
  return 'meta';
}

function renderCodexText(
  mapped: AgentStreamEventInput['type'],
  payload: Record<string, unknown>,
): string | null {
  const eventType = String(payload['type'] ?? payload['event'] ?? '');
  const lower = eventType.toLowerCase();

  if (lower.includes('output_text') && typeof payload['delta'] === 'string') {
    return payload['delta'];
  }
  if (lower.includes('output_text') && typeof payload['text'] === 'string') {
    return payload['text'];
  }
  if (lower.includes('exec_command')) {
    const cmd = payload['cmd'] ?? payload['command'] ?? payload['args'];
    return `[tool→ exec] ${truncate(stringify(cmd), 240)}`;
  }
  if (mapped === 'result') {
    const msg =
      payload['last_agent_message'] ??
      payload['result'] ??
      payload['message'] ??
      payload['text'] ??
      payload['summary'];
    return `[result] ${truncate(stringify(msg), 400)}`.trim();
  }
  if (mapped === 'stderr') {
    return truncate(stringify(payload['message'] ?? payload['error'] ?? payload), 400);
  }
  if (mapped === 'system') {
    return `[system] ${eventType || truncate(JSON.stringify(payload), 160)}`;
  }
  if (mapped === 'assistant' || mapped === 'user') {
    const text = payload['text'] ?? payload['message'] ?? payload['delta'];
    return text == null ? null : truncate(stringify(text), 400);
  }
  return eventType ? `[meta:${eventType}]` : null;
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
