/**
 * LLM-backed Coordinator triage. Used by the parent agent when the
 * rule-based classifier confidence is below threshold.
 *
 * (PR2) The system prompt, one-shot timeout, and all five fallback
 * question strings are now read from the runtime config layer via
 * `getConfig()`. When no override is present, behaviour is unchanged.
 *
 * Calls the local `claude` CLI in stream-json mode as a one-shot, parses
 * the final assistant text as a CoordinatorAction. On any failure (CLI
 * unavailable, parse error, empty output) returns a pause_for_human
 * decision so the user gets asked instead of getting silently mis-routed.
 */

import { spawn } from 'node:child_process';
import {
  buildAgentBackendCliSpawn,
  maskSecrets,
  resolveAgentBackendCliCandidates,
  type CoordinatorAction,
} from '@ainp/shared';
import { buildUserPrompt } from './prompt';
import { claudeCliAvailable } from '../claude-code';
import { getConfig } from '../../config-client';
import type { ClassifyInput, ClassifyOutput } from './rules';

interface FallbackQuestions {
  unavailable: string;
  invocationFailed: string;
  empty: string;
  invalidJson: string;
  unknownAction: string;
}

async function loadFallbackQuestions(): Promise<FallbackQuestions> {
  const [unavailable, invocationFailed, empty, invalidJson, unknownAction] = await Promise.all([
    getConfig('coordinator.fallback.llm_unavailable'),
    getConfig('coordinator.fallback.llm_invocation_failed'),
    getConfig('coordinator.fallback.llm_empty'),
    getConfig('coordinator.fallback.llm_invalid_json'),
    getConfig('coordinator.fallback.llm_unknown_action'),
  ]);
  return { unavailable, invocationFailed, empty, invalidJson, unknownAction };
}

export async function classifyByLlm(input: ClassifyInput): Promise<ClassifyOutput> {
  const fallback = await loadFallbackQuestions();

  if (!(await claudeCliAvailable())) {
    return {
      decision: {
        action: 'pause_for_human',
        questions: [fallback.unavailable],
        reason: 'no LLM backend available',
      },
      confidence: 0.5,
      rulesFired: ['llm.unavailable'],
    };
  }

  const systemPrompt = await getConfig('coordinator.system_prompt');
  const timeoutMs = await getConfig('runner.coordinator.oneshot_timeout_ms');
  const userPrompt = buildUserPrompt(input.userRequest, input.messageHistory);

  let raw = '';
  try {
    raw = await runClaudeOneShot(systemPrompt, userPrompt, timeoutMs);
  } catch (err) {
    return {
      decision: {
        action: 'pause_for_human',
        questions: [fallback.invocationFailed],
        reason: `claude CLI invocation failed: ${(err as Error).message}`,
      },
      confidence: 0.5,
      rulesFired: ['llm.invocation_failed'],
    };
  }

  return {
    decision: parseDecision(raw, fallback),
    confidence: 0.7,
    rulesFired: ['llm.classified'],
  };
}

function runClaudeOneShot(system: string, user: string, timeoutMs: number): Promise<string> {
  const args = [
    '--print',
    '--output-format',
    'stream-json',
    '--verbose',
    '--no-session-persistence',
    '--permission-mode',
    'default',
    '--append-system-prompt',
    system,
    user,
  ];

  return runFirstClaudeCandidate(args, timeoutMs);
}

async function runFirstClaudeCandidate(args: string[], timeoutMs: number): Promise<string> {
  const candidates = resolveAgentBackendCliCandidates('claude_code', {
    env: process.env,
    platform: process.platform,
  });
  let lastError: Error | null = null;
  for (const candidate of candidates) {
    try {
      return await spawnClaudeCandidate(candidate, args, timeoutMs);
    } catch (err) {
      lastError = err as Error;
    }
  }
  throw lastError ?? new Error('no Claude Code CLI candidates resolved');
}

function spawnClaudeCandidate(bin: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const invocation = buildAgentBackendCliSpawn(bin, args, {
      env: process.env,
      platform: process.platform,
    });
    const child = spawn(invocation.command, invocation.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
      shell: invocation.shell,
      windowsHide: invocation.windowsHide,
    });
    let out = '';
    let errOut = '';
    let timer: ReturnType<typeof setTimeout> | null = null;
    timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('claude one-shot timed out'));
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => {
      out += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      errOut += d.toString('utf8');
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`claude one-shot exited ${code ?? 'unknown'}: ${compactCliError(errOut || out)}`));
        return;
      }
      resolve(out);
    });
  });
}

function compactCliError(value: string): string {
  const masked = maskSecrets(value).split('\n').map((line) => line.trim()).filter(Boolean).join('\n');
  if (!masked) return 'no output';
  return masked.length <= 500 ? masked : `${masked.slice(0, 499)}…`;
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

function parseDecision(raw: string, fallback: FallbackQuestions): CoordinatorAction {
  const finalText = extractFinalAssistantText(raw);
  if (!finalText) {
    return {
      action: 'pause_for_human',
      questions: [fallback.empty],
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
      questions: [fallback.invalidJson],
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
    questions: [fallback.unknownAction],
    reason: `unknown action: ${String(obj.action)}`,
  };
}
