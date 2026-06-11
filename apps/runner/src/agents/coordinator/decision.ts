/**
 * Pure JSON decision parsing for the Coordinator LLM fallback.
 *
 * Extracted from `llm-fallback.ts` — everything in this module is a pure
 * function over strings: no I/O, no spawn, no config access. `parseDecision`
 * turns the raw one-shot CLI output into a `CoordinatorAction`, degrading to
 * `pause_for_human` with the configured fallback question when the output is
 * empty / unparsable / carries an unknown action.
 */

import type { CoordinatorAction } from '@ainp/shared';
import type { LlmBackendKind } from './llm-fallback';

export interface FallbackQuestions {
  unavailable: string;
  invocationFailed: string;
  empty: string;
  invalidJson: string;
  unknownAction: string;
}

interface AssistantContentBlock {
  type?: string;
  text?: string;
}
interface AssistantEvent {
  type?: string;
  message?: { content?: AssistantContentBlock[] };
  result?: string;
}

export function extractFinalAssistantText(raw: string): string {
  const lines = raw.split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const evt = JSON.parse(lines[i]!) as AssistantEvent;
      if (evt.type === 'assistant' && Array.isArray(evt.message?.content)) {
        const textBlock = evt.message!.content!.find((b) => b.type === 'text');
        if (textBlock?.text) return textBlock.text;
      }
      if (evt.type === 'result' && typeof evt.result === 'string' && evt.result.trim()) {
        return evt.result.trim();
      }
    } catch {
      /* skip non-JSON lines */
    }
  }
  return '';
}

interface RawDecision {
  action?: unknown;
  routeCase?: unknown;
  runType?: unknown;
  reason?: unknown;
  questions?: unknown;
}

type ProceedDecision = Extract<CoordinatorAction, { action: 'proceed' }>;

const KNOWN_DECISION_ACTIONS = new Set(['proceed', 'pause_for_human', 'abort']);
const KNOWN_ROUTE_CASES = new Set([
  'feature_clear',
  'feature_brainstorm',
  'roadmap_needed',
  'bugfix',
  'refactor_clear',
  'unclear',
]);
const KNOWN_RUN_TYPES = new Set(['feature', 'bugfix', 'smoke', 'refactor']);

function stripOuterMarkdownFence(value: string): string {
  const match = value.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i);
  return match ? match[1]!.trim() : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasDecisionShape(value: unknown): value is RawDecision {
  return isRecord(value) && Object.prototype.hasOwnProperty.call(value, 'action');
}

function hasKnownDecisionAction(value: RawDecision): boolean {
  return typeof value.action === 'string' && KNOWN_DECISION_ACTIONS.has(value.action);
}

function normalizeRouteCase(value: unknown): ProceedDecision['routeCase'] {
  return typeof value === 'string' && KNOWN_ROUTE_CASES.has(value)
    ? (value as ProceedDecision['routeCase'])
    : 'feature_clear';
}

function normalizeRunType(value: unknown): ProceedDecision['runType'] {
  return typeof value === 'string' && KNOWN_RUN_TYPES.has(value)
    ? (value as ProceedDecision['runType'])
    : 'feature';
}

function parseRawDecision(value: string): RawDecision | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return hasDecisionShape(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function* jsonObjectCandidates(value: string): Generator<string> {
  for (let start = 0; start < value.length; start++) {
    if (value[start] !== '{') continue;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let end = start; end < value.length; end++) {
      const ch = value[end]!;

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') {
        depth++;
        continue;
      }
      if (ch !== '}') continue;

      depth--;
      if (depth === 0) {
        yield value.slice(start, end + 1);
        break;
      }
    }
  }
}

export function extractDecisionObject(finalText: string): RawDecision | null {
  const cleaned = stripOuterMarkdownFence(finalText.trim());
  const direct = parseRawDecision(cleaned);
  if (direct) return direct;

  let firstUnknownActionCandidate: RawDecision | null = null;
  for (const candidate of jsonObjectCandidates(finalText)) {
    const obj = parseRawDecision(candidate);
    if (!obj) continue;
    if (hasKnownDecisionAction(obj)) return obj;
    firstUnknownActionCandidate ??= obj;
  }
  return firstUnknownActionCandidate;
}

export function parseDecision(
  raw: string,
  source: LlmBackendKind,
  fallback: FallbackQuestions,
): CoordinatorAction {
  // Claude returns a stream-json line set; Codex `--output-last-message`
  // returns the final text directly. Use the right extractor per source.
  const finalText = source === 'claude_code' ? extractFinalAssistantText(raw) : raw.trim();
  if (!finalText) {
    return {
      action: 'pause_for_human',
      questions: [fallback.empty],
      reason: 'empty LLM output',
    };
  }

  const obj = extractDecisionObject(finalText);
  if (!obj) {
    return {
      action: 'pause_for_human',
      questions: [fallback.invalidJson],
      reason: `failed to parse LLM JSON: ${finalText.trim().slice(0, 100)}`,
    };
  }

  if (obj.action === 'proceed') {
    return {
      action: 'proceed',
      routeCase: normalizeRouteCase(obj.routeCase),
      runType: normalizeRunType(obj.runType),
      reason: typeof obj.reason === 'string' ? obj.reason : 'llm decided',
    };
  }
  if (obj.action === 'pause_for_human') {
    const questions = Array.isArray(obj.questions)
      ? obj.questions.filter((q): q is string => typeof q === 'string')
      : [];
    return {
      action: 'pause_for_human',
      questions: questions.length > 0 ? questions : [fallback.invalidJson],
      reason: typeof obj.reason === 'string' ? obj.reason : 'llm requested clarification',
    };
  }
  if (obj.action === 'abort') {
    return {
      action: 'abort',
      reason: typeof obj.reason === 'string' ? obj.reason : 'llm aborted',
    };
  }

  return {
    action: 'pause_for_human',
    questions: [fallback.unknownAction],
    reason: `unknown action: ${String(obj.action)}`,
  };
}
