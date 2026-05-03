/**
 * LLM-backed Coordinator triage. Used by the parent agent when the
 * rule-based classifier confidence is below threshold.
 *
 * Calls the local `claude` CLI in stream-json mode as a one-shot, parses
 * the final assistant text as a CoordinatorAction. On any failure (CLI
 * unavailable, parse error, empty output) returns a pause_for_human
 * decision so the user gets asked instead of getting silently mis-routed.
 */

import { spawn } from 'node:child_process';
import type { CoordinatorAction } from '@ainp/shared';
import { COORDINATOR_SYSTEM_PROMPT, buildUserPrompt } from './prompt';
import { claudeCliAvailable } from '../claude-code';
import type { ClassifyInput, ClassifyOutput } from './rules';

const ONESHOT_TIMEOUT_MS = 30_000;

export async function classifyByLlm(input: ClassifyInput): Promise<ClassifyOutput> {
  if (!(await claudeCliAvailable())) {
    return {
      decision: {
        action: 'pause_for_human',
        questions: ['LLM 后端暂不可用，能否补充 1-2 句具体场景？'],
        reason: 'no LLM backend available',
      },
      confidence: 0.5,
      rulesFired: ['llm.unavailable'],
    };
  }

  const userPrompt = buildUserPrompt(input.userRequest, input.messageHistory);
  let raw = '';
  try {
    raw = await runClaudeOneShot(COORDINATOR_SYSTEM_PROMPT, userPrompt);
  } catch (err) {
    return {
      decision: {
        action: 'pause_for_human',
        questions: ['LLM 调用失败，能否补充更多上下文？'],
        reason: `claude CLI invocation failed: ${(err as Error).message}`,
      },
      confidence: 0.5,
      rulesFired: ['llm.invocation_failed'],
    };
  }

  return {
    decision: parseDecision(raw),
    confidence: 0.7,
    rulesFired: ['llm.classified'],
  };
}

function runClaudeOneShot(system: string, user: string): Promise<string> {
  const bin = process.env.AINP_CLAUDE_BIN ?? 'claude';
  const args = [
    '--print',
    '--output-format',
    'stream-json',
    '--verbose',
    '--no-session-persistence',
    '--bare',
    '--permission-mode',
    'default',
    '--append-system-prompt',
    system,
    user,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let timer: ReturnType<typeof setTimeout> | null = null;
    timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('claude one-shot timed out'));
    }, ONESHOT_TIMEOUT_MS);
    child.stdout.on('data', (d: Buffer) => {
      out += d.toString('utf8');
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', () => {
      if (timer) clearTimeout(timer);
      resolve(out);
    });
  });
}

interface AssistantContentBlock {
  type?: string;
  text?: string;
}
interface AssistantEvent {
  type?: string;
  message?: { content?: AssistantContentBlock[] };
}

function extractFinalAssistantText(raw: string): string {
  const lines = raw.split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const evt = JSON.parse(lines[i]!) as AssistantEvent;
      if (evt.type === 'assistant' && Array.isArray(evt.message?.content)) {
        const textBlock = evt.message!.content!.find((b) => b.type === 'text');
        if (textBlock?.text) return textBlock.text;
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

function parseDecision(raw: string): CoordinatorAction {
  const finalText = extractFinalAssistantText(raw);
  if (!finalText) {
    return {
      action: 'pause_for_human',
      questions: ['LLM 返回为空，能换种说法描述吗？'],
      reason: 'empty LLM output',
    };
  }

  const cleaned = finalText
    .replace(/```(?:json)?\n?/g, '')
    .replace(/```/g, '')
    .trim();

  let obj: RawDecision;
  try {
    obj = JSON.parse(cleaned) as RawDecision;
  } catch {
    return {
      action: 'pause_for_human',
      questions: ['LLM 返回不是合法 JSON，能否再描述一下？'],
      reason: `failed to parse LLM JSON: ${cleaned.slice(0, 100)}`,
    };
  }

  if (obj.action === 'proceed') {
    return {
      action: 'proceed',
      routeCase: typeof obj.routeCase === 'string' ? (obj.routeCase as never) : 'feature_clear',
      runType: typeof obj.runType === 'string' ? (obj.runType as never) : 'feature',
      reason: typeof obj.reason === 'string' ? obj.reason : 'llm decided',
    };
  }
  if (obj.action === 'pause_for_human') {
    const questions = Array.isArray(obj.questions)
      ? obj.questions.filter((q): q is string => typeof q === 'string')
      : [];
    return {
      action: 'pause_for_human',
      questions,
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
    questions: ['LLM 返回的 action 不在已知集合，能再描述一次吗？'],
    reason: `unknown action: ${String(obj.action)}`,
  };
}
