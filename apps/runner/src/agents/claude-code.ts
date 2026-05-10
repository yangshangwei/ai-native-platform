/**
 * ClaudeCodeBackend — drives the local `claude` CLI in `--print
 * --output-format stream-json` mode and relays every event in real time both
 * to the runner's own stdout and to the platform API (which broadcasts via
 * SSE for the Web UI).
 *
 * Design constraints (see memory: feedback_claude-code-cli-streaming-realtime.md):
 *   - **Real-time** is non-negotiable. Events are forwarded one at a time as
 *     soon as a stream-json line arrives. No batching.
 *   - Producing artifacts: for non-implementation stages the prompt instructs
 *     the model to write the final markdown to an absolute path under
 *     `ctx.artifactsDir`. After the CLI exits the runner reads that file.
 *   - For the implementation stage, the model edits files in the worktree;
 *     after exit the runner runs `git diff` itself (mirroring NativeBackend).
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import {
  agentBackendCliArgs,
  buildAgentBackendCliSpawn,
  buildResolvedAgentBackendCliSpawn,
  maskSecrets,
  resolveAgentBackendCliCandidates,
  type SkillSpec,
  type AgentStreamEventInput,
  type AgentBackendKind,
} from '@ainp/shared';
import { sh } from '../sh';
import { api } from '../api-client';
import { parseStreamLine } from './claude-code-parser';
import type { AgentArtifactOutput, AgentBackend, AgentRunResult, AgentTaskContext } from './native';
import { renderAgentPrompt } from '../context/renderer';
import { parseContextRequestFromAgentOutput } from '../context/request';

export interface ClaudeCodeBackendOpts {
  /** Override binary path; defaults to `AINP_CLAUDE_BIN` env or `claude`. */
  bin?: string;
  /** Per-stage hard timeout. */
  timeoutMs?: number;
  /**
   * Grace window after a `result` event arrives before the runner actively
   * SIGTERMs the CLI. Some Claude Code local configurations (hooks, session
   * keepalives) keep the process alive after the assistant answer is
   * complete; without this, the runner waits the full `timeoutMs`. The
   * grace gives the CLI time to exit on its own first.
   */
  postResultGraceMs?: number;
  /** Permission mode passed to the CLI. */
  permissionMode?: 'acceptEdits' | 'bypassPermissions' | 'default';
  /** Spending cap forwarded to the CLI. */
  maxBudgetUsd?: number;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_POST_RESULT_GRACE_MS = 5_000;
const DEFAULT_BUDGET_USD = 5;
export const CLAUDE_HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'UserPromptSubmit',
  'Stop',
  'SessionStart',
  'Notification',
  'SubagentStop',
] as const;

export class ClaudeCodeBackend implements AgentBackend {
  kind: AgentBackendKind = 'claude_code';

  constructor(private opts: ClaudeCodeBackendOpts = {}) {}

  async run(
    skill: SkillSpec,
    ctx: AgentTaskContext,
  ): Promise<AgentRunResult> {
    await mkdir(ctx.artifactsDir, { recursive: true });

    if (skill.stage === 'implementation') {
      return this.runImplementation(skill, ctx);
    }
    return this.runProducingFile(skill, ctx);
  }

  private async runProducingFile(
    skill: SkillSpec,
    ctx: AgentTaskContext,
  ): Promise<AgentRunResult> {
    const expected = pickFileOutput(skill);
    const targetPath = join(ctx.artifactsDir, expected.name);
    // Pre-create an empty target file so the model has a clear write target;
    // also makes "did it produce something" detection less ambiguous.
    if (!existsSync(targetPath)) await writeFile(targetPath, '', 'utf8');

    const { systemPrompt, userPrompt } = buildPrompts(skill, ctx, {
      mode: 'produce_file',
      targetPath,
      outputName: expected.name,
    });

    const { exitCode, lastMessage } = await this.invokeCli(systemPrompt, userPrompt, ctx, skill);
    if (exitCode !== 0) {
      throw new Error(`claude exited ${exitCode} for stage ${skill.stage}`);
    }

    if (!existsSync(targetPath)) {
      if (isStructuredContextRequest(lastMessage, ctx, skill)) return { outputs: [], lastMessage };
      throw new Error(`claude did not write expected artifact at ${targetPath}`);
    }
    const buf = await readFile(targetPath);
    if (buf.byteLength === 0) {
      if (isStructuredContextRequest(lastMessage, ctx, skill)) return { outputs: [], lastMessage };
      throw new Error(`claude produced empty artifact at ${targetPath}`);
    }
    return {
      outputs: [
        {
          name: expected.name,
          path: targetPath,
          contentType: expected.contentType,
          size: buf.byteLength,
        },
      ],
      lastMessage,
    };
  }

  private async runImplementation(
    skill: SkillSpec,
    ctx: AgentTaskContext,
  ): Promise<AgentRunResult> {
    const { systemPrompt, userPrompt } = buildPrompts(skill, ctx, { mode: 'implementation' });

    const { exitCode, lastMessage } = await this.invokeCli(systemPrompt, userPrompt, ctx, skill);
    if (exitCode !== 0) {
      throw new Error(`claude exited ${exitCode} during implementation`);
    }

    const diff = await sh('git', ['diff'], { cwd: ctx.workspacePath });
    const diffPath = join(ctx.artifactsDir, 'changes.diff');
    await writeFile(diffPath, diff.stdout, 'utf8');

    const namesOnly = await sh('git', ['diff', '--name-only'], { cwd: ctx.workspacePath });
    const namesPath = join(ctx.artifactsDir, 'changed-files.txt');
    await writeFile(namesPath, namesOnly.stdout, 'utf8');

    return {
      outputs: [
        {
          name: 'diff',
          path: diffPath,
          contentType: 'text/x-diff',
          size: Buffer.byteLength(diff.stdout, 'utf8'),
        },
        {
          name: 'changed-files',
          path: namesPath,
          contentType: 'text/plain',
          size: Buffer.byteLength(namesOnly.stdout, 'utf8'),
        },
      ],
      lastMessage,
    };
  }

  private async invokeCli(
    systemPrompt: string,
    userPrompt: string,
    ctx: AgentTaskContext,
    skill: SkillSpec,
  ): Promise<{ exitCode: number; lastMessage: string | null }> {
    const allowedTools = computeAllowedTools(skill);
    const disallowedTools = ['WebFetch', 'WebSearch'];
    // User-level `~/.claude/settings.json` may register hooks (Stop,
    // PreToolUse, ...) that don't make sense in a runner-driven session — most
    // notably a Stop hook that reads a per-session transcript file. Inside our
    // worktree path the transcript is at a different location than the user's
    // normal setup, so the hook fails, Claude Code re-injects the failure as a
    // synthetic user message, the model answers again, the hook fires again,
    // and the loop only ends at the 10-minute hard timeout (exit 143).
    //
    // Fix: pass a local `--settings` JSON with every known hook event set to
    // an empty array. Do NOT use `--setting-sources project,local`: that also
    // hides the user's env block and breaks third-party-router auth. The
    // explicit settings overlay keeps user config visible while neutralizing
    // hooks for runner-driven sessions.
    //
    // Escape hatch: AINP_CLAUDE_LOAD_USER_SETTINGS=1 keeps user settings
    // active (hooks fire too), for debugging hook behavior.
    const keepUserHooks = process.env.AINP_CLAUDE_LOAD_USER_SETTINGS === '1';
    const settingsArgs = keepUserHooks
      ? []
      : ['--settings', JSON.stringify({ hooks: emptyClaudeHooksSettings() })];
    const args = [
      '--print',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--no-session-persistence',
      ...settingsArgs,
      '--permission-mode', this.opts.permissionMode ?? 'acceptEdits',
      '--max-budget-usd', String(this.opts.maxBudgetUsd ?? DEFAULT_BUDGET_USD),
      '--add-dir', ctx.workspacePath,
      '--add-dir', ctx.artifactsDir,
      '--allowed-tools', allowedTools.join(' '),
      '--disallowed-tools', disallowedTools.join(' '),
      '--append-system-prompt', systemPrompt,
      userPrompt,
    ];
    const invocation = buildResolvedAgentBackendCliSpawn('claude_code', args, {
      bin: this.opts.bin,
      env: process.env,
      platform: process.platform,
    });
    const bin = invocation.bin;

    await emitMeta(ctx, 'started', {
      bin,
      stage: skill.stage,
      skillId: skill.id,
      allowedTools,
      disallowedTools,
      userHooksOverridden: !keepUserHooks,
    });

    // Default to the user's local Claude Code environment so OAuth/keychain
    // login and ~/.claude config remain visible. HOME isolation is still useful
    // for debugging hook/config loops, but it is now explicit opt-in.
    const isolateHome = process.env.AINP_CLAUDE_HOME_ISOLATION === '1';
    const isolatedHome = isolateHome ? mkdtempSync(join(tmpdir(), 'ainp-claude-home-')) : null;
    const childEnv: NodeJS.ProcessEnv = { ...process.env };
    if (isolatedHome) {
      childEnv.HOME = isolatedHome;
      delete childEnv.CLAUDE_CONFIG_DIR;
      delete childEnv.XDG_CONFIG_HOME;
    } else if (!keepUserHooks) {
      // Forward the user settings `env` block as process env as well. The CLI
      // still loads user config by default; this duplicate forwarding keeps
      // auth stable for router setups that expect env variables before plugin
      // initialization while hooks remain disabled by the settings overlay.
      const userEnv = readUserSettingsEnv(process.env.CLAUDE_CONFIG_DIR, process.env.HOME);
      for (const [k, v] of Object.entries(userEnv)) {
        if (childEnv[k] === undefined) childEnv[k] = v;
      }
    }

    const child = spawn(invocation.command, invocation.args, {
      cwd: ctx.workspacePath,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv,
      shell: invocation.shell,
      windowsHide: invocation.windowsHide,
    });

    const timeoutMs = this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const postResultGraceMs = this.opts.postResultGraceMs ?? DEFAULT_POST_RESULT_GRACE_MS;
    let timedOut = false;
    let resultSeen = false;
    let resultSubtype: string | null = null;
    let lastMessage: string | null = null;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    let graceShutdownInitiated = false;
    const hardTimer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    // Some Claude Code local setups (hooks, session keepalives) keep the
    // CLI process alive after the `result` event has been emitted. Without
    // this, the runner blocks on the 10-minute hard timeout. After we see
    // a `result` event, give the CLI a short grace window to exit on its
    // own; if it doesn't, SIGTERM it. The original exit code is recorded
    // verbatim in agent_event/agent_result so postmortem still has the
    // evidence (per runner error-handling spec).
    const armPostResultGrace = (): void => {
      if (graceTimer) return;
      graceTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          graceShutdownInitiated = true;
          child.kill('SIGTERM');
        }
      }, postResultGraceMs);
    };

    const stdoutDone = consumeLines(child.stdout, async (line) => {
      const parsed = parseStreamLine(line);
      if (parsed.text) process.stdout.write(`${parsed.text}\n`);
      await emitParsed(ctx, parsed);
      if (parsed.type === 'result' && !resultSeen) {
        resultSeen = true;
        const sub = (parsed.payload as { subtype?: unknown }).subtype;
        resultSubtype = typeof sub === 'string' ? sub : null;
        const result = (parsed.payload as { result?: unknown }).result;
        lastMessage = typeof result === 'string' && result.trim() ? result.trim() : parsed.text;
        armPostResultGrace();
      }
    });

    const stderrDone = consumeLines(child.stderr, async (line) => {
      const safeLine = maskSecrets(line);
      process.stderr.write(`[claude:stderr] ${safeLine}\n`);
      await emit(ctx, { type: 'stderr', payload: { line: safeLine }, text: safeLine });
    });

    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        child.once('exit', (code, signal) => resolve({ code, signal }));
      },
    );
    await Promise.allSettled([stdoutDone, stderrDone]);
    clearTimeout(hardTimer);
    if (graceTimer) clearTimeout(graceTimer);

    // Exit code reconciliation:
    //   - Natural exit (code !== null) wins regardless of how we got here.
    //   - Signal exit caused by our post-result grace SIGTERM, when the
    //     result event reported success and the hard timeout did NOT fire,
    //     is treated as exit 0. The CLI finished business work; we just
    //     terminated it because the local setup wouldn't.
    //   - Anything else (hard timeout, signal without grace) stays -1 and
    //     surfaces as a failure with the original signal recorded.
    let effectiveExitCode: number;
    if (exit.code !== null) {
      effectiveExitCode = exit.code;
    } else if (graceShutdownInitiated && resultSubtype === 'success' && !timedOut) {
      effectiveExitCode = 0;
    } else {
      effectiveExitCode = -1;
    }

    await emitMeta(ctx, 'finished', {
      exitCode: effectiveExitCode,
      rawExitCode: exit.code,
      signal: exit.signal,
      timedOut,
      resultSeen,
      resultSubtype,
      graceShutdown: graceShutdownInitiated,
    });
    return { exitCode: effectiveExitCode, lastMessage };
  }
}

export function emptyClaudeHooksSettings(): Record<(typeof CLAUDE_HOOK_EVENTS)[number], []> {
  return Object.fromEntries(CLAUDE_HOOK_EVENTS.map((event) => [event, []])) as Record<
    (typeof CLAUDE_HOOK_EVENTS)[number],
    []
  >;
}

// ---- prompt assembly ------------------------------------------------------

interface BuildPromptArgs {
  mode: 'produce_file' | 'implementation';
  targetPath?: string;
  outputName?: string;
}

function buildPrompts(
  skill: SkillSpec,
  ctx: AgentTaskContext,
  args: BuildPromptArgs,
): { systemPrompt: string; userPrompt: string } {
  return renderAgentPrompt({
    skill,
    workflowRunId: ctx.workflowRunId,
    workspacePath: ctx.workspacePath,
    artifactsDir: ctx.artifactsDir,
    branch: ctx.branch,
    title: ctx.title,
    inputs: ctx.inputs,
    mode: args.mode,
    targetPath: args.targetPath,
    outputName: args.outputName,
    contextPack: ctx.contextPack,
    sensitivePathPatterns: ctx.sensitivePathPatterns,
  });
}

function computeAllowedTools(skill: SkillSpec): string[] {
  // Read-only stages get exploration tools only.
  // Implementation stage gets edit tools but still no Bash (build/test belongs to runner).
  switch (skill.stage) {
    case 'implementation':
      return ['Read', 'Glob', 'Grep', 'Edit', 'Write'];
    case 'context_pack':
    case 'requirement':
    case 'design':
    case 'review':
      return ['Read', 'Glob', 'Grep', 'Write'];
    default:
      return ['Read', 'Glob', 'Grep'];
  }
}

function pickFileOutput(skill: SkillSpec): { name: string; contentType: string } {
  const out = skill.outputs[0];
  if (!out) throw new Error(`skill ${skill.id} has no outputs`);
  return { name: out.name, contentType: 'text/markdown' };
}

// ---- streaming helpers ----------------------------------------------------

/**
 * Read the `env` block from `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`).
 * Used to forward user-defined environment variables — e.g.
 * `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL` for third-party routers — into
 * the spawned Claude CLI process when we have to skip the user-level setting
 * source for hook isolation. See `invokeCli` above for the rationale.
 *
 * Returns an empty object on any read/parse error; the runner is responsible
 * for surfacing auth failures via the CLI's own error stream.
 */
export function readUserSettingsEnv(
  claudeConfigDir: string | undefined,
  home: string | undefined,
): Record<string, string> {
  const dir = claudeConfigDir ?? (home ? join(home, '.claude') : null);
  if (!dir) return {};
  const path = join(dir, 'settings.json');
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as { env?: Record<string, string> };
    if (!parsed.env || typeof parsed.env !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.env)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

async function consumeLines(
  stream: NodeJS.ReadableStream | null,
  onLine: (line: string) => Promise<void>,
): Promise<void> {
  if (!stream) return;
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    await onLine(line);
  }
}

async function emitParsed(
  ctx: AgentTaskContext,
  parsed: { type: AgentStreamEventInput['type']; payload: Record<string, unknown>; text: string | null },
): Promise<void> {
  await emit(ctx, parsed);
}

async function emit(
  ctx: AgentTaskContext,
  parsed: { type: AgentStreamEventInput['type']; payload: Record<string, unknown>; text: string | null },
): Promise<void> {
  try {
    await api.postAgentEvent({
      workflowRunId: ctx.workflowRunId,
      stepRunId: ctx.stepRunId ?? null,
      agentKind: 'claude_code',
      type: parsed.type,
      payload: parsed.payload,
      text: parsed.text,
    });
  } catch (err) {
    // API push failure must not stop streaming. The local console still gets it.
    process.stderr.write(`[claude-code] postAgentEvent failed: ${maskSecrets((err as Error).message)}\n`);
  }
}

async function emitMeta(
  ctx: AgentTaskContext,
  event: string,
  detail: Record<string, unknown>,
): Promise<void> {
  const text = `[meta:${event}] ${JSON.stringify(detail)}`;
  process.stdout.write(`${text}\n`);
  await emit(ctx, { type: 'meta', payload: { event, ...detail }, text });
}

// ---- availability check --------------------------------------------------

/** Returns true when `claude --version` exits 0 within ~3s. */
export async function claudeCliAvailable(bin?: string): Promise<boolean> {
  const candidates = resolveAgentBackendCliCandidates('claude_code', {
    bin,
    env: process.env,
    platform: process.platform,
  });

  for (const candidate of candidates) {
    if (await exitsZero(candidate, agentBackendCliArgs('claude_code', 'version'))) return true;
  }
  return false;
}

function exitsZero(bin: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const invocation = buildAgentBackendCliSpawn(bin, args, {
      env: process.env,
      platform: process.platform,
    });
    const child = spawn(invocation.command, invocation.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: invocation.shell,
      windowsHide: invocation.windowsHide,
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(false);
    }, 3000);
    child.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

function isStructuredContextRequest(
  message: string | null,
  ctx: AgentTaskContext,
  skill: SkillSpec,
): boolean {
  if (!message) return false;
  return parseContextRequestFromAgentOutput({
    workflowRunId: ctx.workflowRunId,
    stepRunId: ctx.stepRunId ?? null,
    stage: skill.stage,
    sources: [{ name: 'last_message', text: message }],
    idFactory: () => 'ctxreq_probe',
  }) !== null;
}
