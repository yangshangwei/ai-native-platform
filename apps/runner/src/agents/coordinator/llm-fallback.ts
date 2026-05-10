/**
 * LLM-backed Coordinator triage. Used by the parent agent when the
 * rule-based classifier confidence is below threshold.
 *
 * (PR2) The system prompt, one-shot timeout, and all five fallback
 * question strings come from the runtime config layer via `getConfig()`.
 * Default values are byte-for-byte transcribed in
 * `packages/shared/src/config/defaults.ts`.
 *
 * (PR3, PRD §P0-1) Both Claude Code and Codex CLIs are now first-class
 * fallback channels. The active project's `agentBackend` selects which
 * one runs first; the other is automatic fallback when the preferred
 * CLI is unavailable. When neither CLI is available the call degrades
 * to `pause_for_human` so the user gets asked instead of silently
 * mis-routed.
 *
 * The CLI invocations are injectable via `classifyByLlm({ ..., deps })`
 * so unit tests can exercise the selection-strategy logic without
 * spawning real `claude` or `codex` processes.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildAgentBackendCliSpawn,
  maskSecrets,
  resolveAgentBackendCliCandidates,
  type CoordinatorAction,
} from '@ainp/shared';
import { buildUserPrompt } from './prompt';
import { claudeCliAvailable, emptyClaudeHooksSettings, readUserSettingsEnv } from '../claude-code';
import { codexCliAvailable } from '../codex';
import { getConfig } from '../../config-client';
import type { ClassifyInput, ClassifyOutput } from './rules';

/**
 * Backends that can answer the Coordinator's one-shot triage prompt.
 * `native` is excluded — it produces deterministic stub output, not an LLM
 * judgment, so it has no business in this fallback.
 */
export type LlmBackendKind = 'claude_code' | 'codex';

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

export interface LlmFallbackDeps {
  /** Returns true when the requested CLI is available and runnable. */
  checkAvailability(backend: LlmBackendKind): Promise<boolean>;
  /** Run one-shot prompt against the chosen CLI; returns the assistant text. */
  runOneShot(
    backend: LlmBackendKind,
    system: string,
    user: string,
    timeoutMs: number,
  ): Promise<string>;
}

export interface ClassifyByLlmOptions {
  /** Project's agentBackend; when set the matching CLI is tried first. */
  preferredBackend?: LlmBackendKind;
  /** Override for tests; defaults to the real spawn-based implementations. */
  deps?: LlmFallbackDeps;
}

const DEFAULT_DEPS: LlmFallbackDeps = {
  checkAvailability: async (backend) => {
    if (backend === 'codex') return codexCliAvailable();
    return claudeCliAvailable();
  },
  runOneShot: (backend, system, user, timeoutMs) => {
    if (backend === 'codex') return runCodexOneShot(system, user, timeoutMs);
    return runClaudeOneShot(system, user, timeoutMs);
  },
};

/**
 * Order in which to try LLM backends, given the project's preference.
 *
 *   preferred = 'codex'        → ['codex', 'claude_code']
 *   preferred = 'claude_code'  → ['claude_code', 'codex']
 *   preferred = undefined      → ['claude_code', 'codex']  (legacy default)
 */
function selectionOrder(preferredBackend: LlmBackendKind | undefined): LlmBackendKind[] {
  if (preferredBackend === 'codex') return ['codex', 'claude_code'];
  if (preferredBackend === 'claude_code') return ['claude_code', 'codex'];
  return ['claude_code', 'codex'];
}

export async function classifyByLlm(
  input: ClassifyInput,
  opts: ClassifyByLlmOptions = {},
): Promise<ClassifyOutput> {
  const fallback = await loadFallbackQuestions();
  const deps = opts.deps ?? DEFAULT_DEPS;
  const order = selectionOrder(opts.preferredBackend);

  let chosen: LlmBackendKind | null = null;
  for (const candidate of order) {
    if (await deps.checkAvailability(candidate)) {
      chosen = candidate;
      break;
    }
  }
  if (!chosen) {
    return {
      decision: {
        action: 'pause_for_human',
        questions: [fallback.unavailable],
        reason: 'no LLM backend available',
      },
      confidence: 0.5,
      rulesFired: ['llm.unavailable'],
      failureKind: 'unavailable',
    };
  }

  const systemPrompt = await getConfig('coordinator.system_prompt');
  const timeoutMs = await getConfig('runner.coordinator.oneshot_timeout_ms');
  const userPrompt = buildUserPrompt(input.userRequest, input.messageHistory);

  let raw = '';
  try {
    raw = await deps.runOneShot(chosen, systemPrompt, userPrompt, timeoutMs);
  } catch (err) {
    return {
      decision: {
        action: 'pause_for_human',
        questions: [fallback.invocationFailed],
        reason: `${chosen} CLI invocation failed: ${(err as Error).message}`,
      },
      confidence: 0.5,
      rulesFired: ['llm.invocation_failed'],
      failureKind: 'invocation_failed',
    };
  }

  const decision = parseDecision(raw, chosen, fallback);
  // Transient-failure annotation: an `empty` decision means the CLI ran but
  // produced no usable output, which we treat as availability degradation
  // (same family as invocation_failed / unavailable). `invalid_json` /
  // `unknown_action` are NOT transient — the LLM answered, just badly.
  const failureKind: ClassifyOutput['failureKind'] =
    decision.action === 'pause_for_human' && decision.reason === 'empty LLM output'
      ? 'empty'
      : null;

  return {
    decision,
    confidence: 0.7,
    rulesFired: [`llm.classified.${chosen}`],
    failureKind,
  };
}

// ---- Claude Code one-shot --------------------------------------------------

function runClaudeOneShot(system: string, user: string, timeoutMs: number): Promise<string> {
  // Mirror ClaudeCodeBackend: pass a local --settings JSON with every known
  // hook event set to an empty array. Stop hook etc. would otherwise loop on
  // every message_stop and burn the timeout. Do NOT use --setting-sources:
  // it hides user env/settings needed by third-party auth.
  // AINP_CLAUDE_LOAD_USER_SETTINGS=1 keeps user hooks active for debugging.
  const keepUserHooks = process.env.AINP_CLAUDE_LOAD_USER_SETTINGS === '1';
  const settingsArgs = keepUserHooks
    ? []
    : ['--settings', JSON.stringify({ hooks: emptyClaudeHooksSettings() })];
  const args = [
    '--print',
    '--output-format',
    'stream-json',
    '--verbose',
    '--no-session-persistence',
    ...settingsArgs,
    '--permission-mode',
    'default',
    '--append-system-prompt',
    system,
    user,
  ];
  return runFirstCandidate('claude_code', args, timeoutMs);
}

// ---- Codex one-shot (PR3 new) ---------------------------------------------

/**
 * Run codex non-interactively. Codex `exec` reads the user prompt from
 * stdin and writes the final assistant message to a sidecar file when
 * `--output-last-message` is supplied — that's a cleaner contract than
 * tailing the JSON event stream because the file always contains the
 * final assistant text and only the final assistant text. This mirrors
 * how `apps/runner/src/agents/codex.ts` already invokes the CLI for
 * production runs (see `--output-last-message` usage there).
 */
async function runCodexOneShot(system: string, user: string, timeoutMs: number): Promise<string> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'ainp-coord-codex-'));
  const lastMessagePath = join(tmpDir, 'codex-last-message.txt');
  const args = [
    'exec',
    '--json',
    '--ephemeral',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '--output-last-message',
    lastMessagePath,
    '-',
  ];
  const stdin = `${system}\n\n${user}\n`;
  try {
    await runFirstCandidate('codex', args, timeoutMs, { stdin });
    try {
      return readFileSync(lastMessagePath, 'utf8');
    } catch {
      return '';
    }
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
}

// ---- Spawn helper (shared) ------------------------------------------------

interface SpawnOpts {
  stdin?: string;
}

async function runFirstCandidate(
  backend: LlmBackendKind,
  args: string[],
  timeoutMs: number,
  spawnOpts: SpawnOpts = {},
): Promise<string> {
  const candidates = resolveAgentBackendCliCandidates(backend, {
    env: process.env,
    platform: process.platform,
  });
  let lastError: Error | null = null;
  for (const candidate of candidates) {
    try {
      return await spawnCandidate(backend, candidate, args, timeoutMs, spawnOpts);
    } catch (err) {
      lastError = err as Error;
    }
  }
  throw lastError ?? new Error(`no ${backend} CLI candidates resolved`);
}

function spawnCandidate(
  backend: LlmBackendKind,
  bin: string,
  args: string[],
  timeoutMs: number,
  spawnOpts: SpawnOpts,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const invocation = buildAgentBackendCliSpawn(bin, args, {
      env: process.env,
      platform: process.platform,
    });
    // Match the production claude-code backend: inherit the user's local
    // Claude Code environment by default so OAuth/keychain login and config
    // remain visible. Empty-HOME isolation is an explicit debugging opt-in.
    const isolateHome = backend === 'claude_code' && process.env.AINP_CLAUDE_HOME_ISOLATION === '1';
    const isolatedHome = isolateHome ? mkdtempSync(join(tmpdir(), 'ainp-coord-home-')) : null;
    const childEnv: NodeJS.ProcessEnv = { ...process.env };
    if (isolatedHome) {
      childEnv.HOME = isolatedHome;
      delete childEnv.CLAUDE_CONFIG_DIR;
      delete childEnv.XDG_CONFIG_HOME;
    } else if (backend === 'claude_code' && process.env.AINP_CLAUDE_LOAD_USER_SETTINGS !== '1') {
      // Duplicate the user settings `env` block into process env as a
      // compatibility belt-and-suspenders while hooks are neutralized by the
      // --settings overlay (see runClaudeOneShot above).
      const userEnv = readUserSettingsEnv(process.env.CLAUDE_CONFIG_DIR, process.env.HOME);
      for (const [k, v] of Object.entries(userEnv)) {
        if (childEnv[k] === undefined) childEnv[k] = v;
      }
    }
    const child = spawn(invocation.command, invocation.args, {
      stdio: [spawnOpts.stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      env: childEnv,
      shell: invocation.shell,
      windowsHide: invocation.windowsHide,
    });
    const cleanupHome = (): void => {
      if (!isolatedHome) return;
      try {
        rmSync(isolatedHome, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    };
    let out = '';
    let errOut = '';
    let timer: ReturnType<typeof setTimeout> | null = null;
    timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${bin} one-shot timed out`));
    }, timeoutMs);
    child.stdout?.on('data', (d: Buffer) => {
      out += d.toString('utf8');
    });
    child.stderr?.on('data', (d: Buffer) => {
      errOut += d.toString('utf8');
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      cleanupHome();
      reject(err);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      cleanupHome();
      if (code !== 0) {
        reject(
          new Error(
            `${bin} one-shot exited ${code ?? 'unknown'}: ${compactCliError(errOut || out)}`,
          ),
        );
        return;
      }
      resolve(out);
    });
    if (spawnOpts.stdin && child.stdin) {
      child.stdin.write(spawnOpts.stdin);
      child.stdin.end();
    }
  });
}

function compactCliError(value: string): string {
  const masked = maskSecrets(value)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
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

function parseDecision(
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

  const cleaned = finalText.replace(/```(?:json)?\n?/g, '').replace(/```/g, '').trim();

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
