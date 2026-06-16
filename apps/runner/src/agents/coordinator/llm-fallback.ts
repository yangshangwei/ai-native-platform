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
  errorMessage,
  maskSecrets,
  resolveAgentBackendCliCandidates,
  type CoordinatorAction,
  type AgentStreamEventInput,
  type WorkflowRequestId,
} from '@ainp/shared';
import { buildUserPrompt } from './prompt';
import { parseDecision, type FallbackQuestions } from './decision';
import { claudeCliAvailable, emptyClaudeHooksSettings, readUserSettingsEnv } from '../claude-code';
import { codexCliAvailable } from '../codex';
import { consumeLines } from '../cli-common';
import { parseStreamLine } from '../claude-code-parser';
import { parseCodexJsonLine } from '../codex-parser';
import { api } from '../../api-client';
import { getConfig } from '../../config-client';
import type { ClassifyInput, ClassifyOutput } from './rules';

/**
 * Backends that can answer the Coordinator's one-shot triage prompt.
 * `native` is excluded — it produces deterministic stub output, not an LLM
 * judgment, so it has no business in this fallback.
 */
export type LlmBackendKind = 'claude_code' | 'codex';

type CoordinatorStreamEvent = Pick<AgentStreamEventInput, 'type' | 'payload' | 'text'>;
type CoordinatorStreamEmit = (event: CoordinatorStreamEvent) => void | Promise<void>;

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
    emit?: CoordinatorStreamEmit,
  ): Promise<string>;
}

export interface ClassifyByLlmOptions {
  /** Project's agentBackend; when set the matching CLI is tried first. */
  preferredBackend?: LlmBackendKind;
  /** Override for tests; defaults to the real spawn-based implementations. */
  deps?: LlmFallbackDeps;
  /** When set, stream Coordinator LLM events to this pre-run request channel. */
  workflowRequestId?: WorkflowRequestId;
  /**
   * Default true for direct `classifyByLlm` callers. `triageRequest` sets this
   * false so it can emit exactly one final `decided` event after applying its
   * degraded-fallback override.
   */
  emitDecisionEvent?: boolean;
}

const DEFAULT_DEPS: LlmFallbackDeps = {
  checkAvailability: async (backend) => {
    if (backend === 'codex') return codexCliAvailable();
    return claudeCliAvailable();
  },
  runOneShot: (backend, system, user, timeoutMs, emit) => {
    if (backend === 'codex') return runCodexOneShot(system, user, timeoutMs, emit);
    return runClaudeOneShot(system, user, timeoutMs, emit);
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

function createCoordinatorEmitter(
  workflowRequestId: WorkflowRequestId,
  agentKind: LlmBackendKind,
): CoordinatorStreamEmit {
  return async (event) => {
    try {
      await api.postAgentEvent({
        workflowRunId: null,
        workflowRequestId,
        stepRunId: null,
        agentKind,
        type: event.type,
        payload: event.payload,
        text: event.text,
      });
    } catch (err) {
      // Coordinator decisions must not depend on the API/SSE side channel.
      process.stderr.write(
        `[coordinator:${agentKind}] postAgentEvent failed: ${maskSecrets(errorMessage(err))}\n`,
      );
    }
  };
}

async function emitMeta(
  emit: CoordinatorStreamEmit | undefined,
  event: string,
  detail: Record<string, unknown>,
): Promise<void> {
  if (!emit) return;
  const text = `[coordinator:${event}]`;
  await emit({ type: 'meta', payload: { event, ...detail }, text });
}

async function emitDecision(
  emit: CoordinatorStreamEmit | undefined,
  decision: CoordinatorAction,
  confidence: number,
  rulesFired: string[],
  source?: 'llm' | 'rules',
): Promise<void> {
  if (!emit) return;
  await emitMeta(emit, 'decided', {
    action: decision.action,
    confidence,
    rulesFired,
    ...(source ? { source } : {}),
    routeCase: decision.action === 'proceed' ? decision.routeCase : null,
    runType: decision.action === 'proceed' ? decision.runType : null,
  });
}

export async function emitCoordinatorDecisionEvent(params: {
  workflowRequestId: WorkflowRequestId;
  agentKind: LlmBackendKind;
  decision: CoordinatorAction;
  confidence: number;
  rulesFired: string[];
  source: 'llm' | 'rules';
}): Promise<void> {
  const emit = createCoordinatorEmitter(params.workflowRequestId, params.agentKind);
  await emitDecision(emit, params.decision, params.confidence, params.rulesFired, params.source);
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

  // PR2: Read clarification style and max rounds configuration
  const [clarificationStyle, maxClarificationRounds, defaultPrompt, grillMePrompt, timeoutMs] =
    await Promise.all([
      getConfig('coordinator.clarification_style'),
      getConfig('coordinator.max_clarification_rounds'),
      getConfig('coordinator.system_prompt'),
      getConfig('coordinator.system_prompt_grill_me'),
      getConfig('runner.coordinator.oneshot_timeout_ms'),
    ]);

  // PR2: Count coordinator messages in history to enforce max rounds
  const coordinatorMessageCount = input.messageHistory.filter((m) => m.role === 'coordinator').length;

  // PR2: Select system prompt based on clarification style
  let systemPrompt: string;
  if (clarificationStyle === 'grill-me') {
    systemPrompt = grillMePrompt;
  } else {
    if (clarificationStyle !== 'default') {
      // Invalid style value - log warning and fallback to default
      process.stderr.write(
        `[coordinator:llm-fallback] Invalid clarification_style "${clarificationStyle}", falling back to "default"\n`,
      );
    }
    systemPrompt = defaultPrompt;
  }

  // PR2: Append convergence instruction if max rounds reached
  if (coordinatorMessageCount >= maxClarificationRounds) {
    systemPrompt += `\n\nIMPORTANT: You have reached the maximum clarification rounds (${maxClarificationRounds}). You MUST make a decision (proceed or abort) based on current information. Do not ask more questions.`;
    process.stdout.write(
      `[coordinator:llm-fallback] Max clarification rounds (${maxClarificationRounds}) reached, forcing convergence\n`,
    );
  }
  const userPrompt = buildUserPrompt(input.userRequest, input.messageHistory);
  const emit =
    opts.workflowRequestId == null
      ? undefined
      : createCoordinatorEmitter(opts.workflowRequestId, chosen);
  const shouldEmitDecision = opts.emitDecisionEvent !== false;

  let raw = '';
  try {
    await emitMeta(emit, 'cli_started', { backend: chosen, timeoutMs });
    raw = await deps.runOneShot(chosen, systemPrompt, userPrompt, timeoutMs, emit);
    await emitMeta(emit, 'cli_finished', { backend: chosen, ok: true });
  } catch (err) {
    await emitMeta(emit, 'cli_finished', {
      backend: chosen,
      ok: false,
      error: maskSecrets(errorMessage(err)),
    });
    const decision: CoordinatorAction = {
      action: 'pause_for_human',
      questions: [fallback.invocationFailed],
      reason: `${chosen} CLI invocation failed: ${errorMessage(err)}`,
    };
    if (shouldEmitDecision) {
      await emitDecision(emit, decision, 0.5, ['llm.invocation_failed'], 'llm');
    }
    return {
      decision: {
        action: 'pause_for_human',
        questions: [fallback.invocationFailed],
        reason: `${chosen} CLI invocation failed: ${errorMessage(err)}`,
      },
      confidence: 0.5,
      rulesFired: ['llm.invocation_failed'],
      agentKind: chosen,
      failureKind: 'invocation_failed',
    };
  }

  let decision = parseDecision(raw, chosen, fallback);

  // PR2: grill-me mode output validation - truncate to single question if multiple returned
  if (
    clarificationStyle === 'grill-me' &&
    decision.action === 'pause_for_human' &&
    decision.questions.length > 1
  ) {
    process.stderr.write(
      `[coordinator:llm-fallback] grill-me mode returned ${decision.questions.length} questions, truncating to first one\n`,
    );
    decision = {
      ...decision,
      questions: [decision.questions[0]!],
    };
  }

  // Transient-failure annotation: an `empty` decision means the CLI ran but
  // produced no usable output, which we treat as availability degradation
  // (same family as invocation_failed / unavailable). `invalid_json` /
  // `unknown_action` are NOT transient — the LLM answered, just badly.
  const failureKind: ClassifyOutput['failureKind'] =
    decision.action === 'pause_for_human' && decision.reason === 'empty LLM output'
      ? 'empty'
      : null;
  if (shouldEmitDecision) {
    await emitDecision(emit, decision, 0.7, [`llm.classified.${chosen}`], 'llm');
  }

  return {
    decision,
    confidence: 0.7,
    rulesFired: [`llm.classified.${chosen}`],
    agentKind: chosen,
    failureKind,
  };
}

// ---- Claude Code one-shot --------------------------------------------------

function runClaudeOneShot(
  system: string,
  user: string,
  timeoutMs: number,
  emit?: CoordinatorStreamEmit,
): Promise<string> {
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
    '--include-partial-messages',
    '--no-session-persistence',
    ...settingsArgs,
    '--permission-mode',
    'default',
    '--append-system-prompt',
    system,
    user,
  ];
  if (!emit) return runFirstCandidate('claude_code', args, timeoutMs);
  return runFirstCandidateStreaming('claude_code', args, timeoutMs, {
    emit,
    parseLine: parseStreamLine,
  });
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
async function runCodexOneShot(
  system: string,
  user: string,
  timeoutMs: number,
  emit?: CoordinatorStreamEmit,
): Promise<string> {
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
    if (emit) {
      await runFirstCandidateStreaming('codex', args, timeoutMs, {
        stdin,
        emit,
        parseLine: parseCodexJsonLine,
      });
    } else {
      await runFirstCandidate('codex', args, timeoutMs, { stdin });
    }
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

interface StreamingSpawnOpts extends SpawnOpts {
  emit: CoordinatorStreamEmit;
  parseLine: (line: string) => CoordinatorStreamEvent;
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

async function runFirstCandidateStreaming(
  backend: LlmBackendKind,
  args: string[],
  timeoutMs: number,
  spawnOpts: StreamingSpawnOpts,
): Promise<string> {
  const candidates = resolveAgentBackendCliCandidates(backend, {
    env: process.env,
    platform: process.platform,
  });
  let lastError: Error | null = null;
  for (const candidate of candidates) {
    try {
      return await spawnCandidateStreaming(backend, candidate, args, timeoutMs, spawnOpts);
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
    const { childEnv, cleanupHome } = buildCoordinatorChildEnv(backend);
    const child = spawn(invocation.command, invocation.args, {
      stdio: [spawnOpts.stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      env: childEnv,
      shell: invocation.shell,
      windowsHide: invocation.windowsHide,
    });
    let out = '';
    let errOut = '';
    let timer: ReturnType<typeof setTimeout> | null = null;
    let hardKillTimer: ReturnType<typeof setTimeout> | null = null;
    timer = setTimeout(() => {
      child.kill('SIGTERM');
      // R1.3: SIGKILL upgrade after 5-10s if SIGTERM doesn't terminate the process
      hardKillTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
      }, 10_000);
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
      if (hardKillTimer) clearTimeout(hardKillTimer);
      cleanupHome();
      reject(err);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (hardKillTimer) clearTimeout(hardKillTimer);
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

function spawnCandidateStreaming(
  backend: LlmBackendKind,
  bin: string,
  args: string[],
  timeoutMs: number,
  spawnOpts: StreamingSpawnOpts,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const invocation = buildAgentBackendCliSpawn(bin, args, {
      env: process.env,
      platform: process.platform,
    });
    const { childEnv, cleanupHome } = buildCoordinatorChildEnv(backend);
    const child = spawn(invocation.command, invocation.args, {
      stdio: [spawnOpts.stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      env: childEnv,
      shell: invocation.shell,
      windowsHide: invocation.windowsHide,
    });

    let out = '';
    let errOut = '';
    let timedOut = false;
    let hardKillTimer: ReturnType<typeof setTimeout> | null = null;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // R1.3: SIGKILL upgrade after 5-10s if SIGTERM doesn't terminate the process
      hardKillTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
      }, 10_000);
    }, timeoutMs);

    const stdoutDone = consumeLines(child.stdout, async (line) => {
      out += `${line}\n`;
      const parsed = spawnOpts.parseLine(line);
      if (parsed.text) process.stdout.write(`${parsed.text}\n`);
      await spawnOpts.emit(parsed);
    });
    const stderrDone = consumeLines(child.stderr, async (line) => {
      const safeLine = maskSecrets(line);
      errOut += `${safeLine}\n`;
      process.stderr.write(`[${backend}:stderr] ${safeLine}\n`);
      await spawnOpts.emit({ type: 'stderr', payload: { line: safeLine }, text: safeLine });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (hardKillTimer) clearTimeout(hardKillTimer);
      cleanupHome();
      reject(err);
    });
    child.on('close', async (code) => {
      clearTimeout(timer);
      if (hardKillTimer) clearTimeout(hardKillTimer);
      await Promise.allSettled([stdoutDone, stderrDone]);
      cleanupHome();
      if (timedOut) {
        reject(new Error(`${bin} one-shot timed out`));
        return;
      }
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

function buildCoordinatorChildEnv(backend: LlmBackendKind): {
  childEnv: NodeJS.ProcessEnv;
  cleanupHome: () => void;
} {
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
  return {
    childEnv,
    cleanupHome: () => {
      if (!isolatedHome) return;
      try {
        rmSync(isolatedHome, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    },
  };
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

