/**
 * CodexBackend — drives `codex exec --json` as a non-interactive AgentBackend.
 *
 * The runner keeps platform invariants:
 * - non-implementation stages must write exactly one markdown artifact under
 *   ctx.artifactsDir;
 * - implementation edits the worktree only; runner captures git diff itself;
 * - gates, command execution, and approvals remain outside the agent.
 *
 * Codex sandbox note: `codex_core::tools::router` hard-blocks any `apply_patch`
 * whose target is outside the run's project root (the value passed to `--cd`),
 * regardless of `--add-dir` or `approval_policy = "never"`. This is a safety
 * check independent of OS sandboxing, and the error surfaces as
 *   `patch rejected: writing outside of the project;
 *    rejected by user approval settings`
 * For produce-file stages we therefore stage the target artifact inside the
 * workspace (at `<workspace>/.ainp-artifacts/<stage>/<name>`), let Codex write
 * it as an in-project edit, then copy the produced file back to the canonical
 * `ctx.artifactsDir` that the rest of the runner/API expects.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  buildResolvedAgentBackendCliSpawn,
  maskSecrets,
  type SkillSpec,
} from '@ainp/shared';
import type { AgentBackend, AgentRunResult, AgentTaskContext } from './types';
import { parseCodexJsonLine } from './codex-parser';
import {
  captureWorktreeDiffOutputs,
  cliAvailable,
  consumeLines,
  createAgentEventEmitter,
  isStructuredContextRequest,
  pickFileOutput,
  type BuildPromptArgs,
} from './cli-common';
import { renderAgentPrompt, renderCombinedAgentPrompt } from '../context/renderer';

export interface CodexBackendOpts {
  bin?: string;
  timeoutMs?: number;
  model?: string;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export class CodexBackend implements AgentBackend {
  kind = 'codex' as const;

  constructor(private opts: CodexBackendOpts = {}) {}

  async run(
    skill: SkillSpec,
    ctx: AgentTaskContext,
  ): Promise<AgentRunResult> {
    await mkdir(ctx.artifactsDir, { recursive: true });
    if (skill.stage === 'implementation') return this.runImplementation(skill, ctx);
    return this.runProducingFile(skill, ctx);
  }

  private async runProducingFile(
    skill: SkillSpec,
    ctx: AgentTaskContext,
  ): Promise<AgentRunResult> {
    const expected = pickFileOutput(skill);
    const finalPath = join(ctx.artifactsDir, expected.name);
    // Stage the target file inside the workspace so Codex's apply_patch sees
    // it as "inside the project". Keep the final artifact location unchanged
    // for downstream consumers (orchestrator, API artifact server).
    const stagedDir = codexStageDir(ctx.workspacePath, skill.stage);
    const stagedPath = join(stagedDir, expected.name);
    await mkdir(stagedDir, { recursive: true });
    await writeFile(stagedPath, '', 'utf8');

    const prompt = buildPrompt(skill, ctx, {
      mode: 'produce_file',
      targetPath: stagedPath,
      outputName: expected.name,
    });
    const { exitCode, lastMessage } = await this.invokeCli(prompt, ctx, skill);
    if (exitCode !== 0) throw new Error(`codex exited ${exitCode} for stage ${skill.stage}`);

    const produced = await adoptStagedArtifact(stagedPath, finalPath);
    if (!produced) {
      if (isStructuredContextRequest(lastMessage, ctx, skill)) return { outputs: [], lastMessage };
      throw new Error(`codex did not write expected artifact at ${stagedPath}`);
    }
    if (produced.size === 0) {
      if (isStructuredContextRequest(lastMessage, ctx, skill)) return { outputs: [], lastMessage };
      throw new Error(`codex produced empty artifact at ${stagedPath}`);
    }
    return {
      outputs: [
        {
          name: expected.name,
          path: finalPath,
          contentType: expected.contentType,
          size: produced.size,
        },
      ],
      lastMessage,
    };
  }

  private async runImplementation(
    skill: SkillSpec,
    ctx: AgentTaskContext,
  ): Promise<AgentRunResult> {
    const prompt = buildPrompt(skill, ctx, { mode: 'implementation' });
    const { exitCode, lastMessage } = await this.invokeCli(prompt, ctx, skill);
    if (exitCode !== 0) throw new Error(`codex exited ${exitCode} during implementation`);

    return {
      outputs: await captureWorktreeDiffOutputs(ctx.workspacePath, ctx.artifactsDir),
      lastMessage,
    };
  }

  private async invokeCli(
    prompt: string,
    ctx: AgentTaskContext,
    skill: SkillSpec,
  ): Promise<{ exitCode: number; lastMessage: string | null }> {
    // Keep Codex's sidecar write inside the workspace so the router's
    // "inside project" check succeeds — same reason we stage produce-file
    // artifacts there.
    const stagedDir = codexStageDir(ctx.workspacePath, skill.stage);
    await mkdir(stagedDir, { recursive: true });
    const lastMessagePath = join(stagedDir, '.codex-last-message.txt');
    const args = [
      'exec',
      '--json',
      '--ephemeral',
      '--ignore-rules',
      '--disable',
      'hooks',
      '--skip-git-repo-check',
      // Pin approval_policy=never so non-interactive runner sessions aren't
      // silently rejected by a user's default `on-request` policy. This is
      // still needed even after in-workspace staging because exec has no
      // human to answer on-request prompts for other tool calls (shell,
      // web_search, MCP).
      '-c',
      'approval_policy="never"',
      '--cd',
      ctx.workspacePath,
      '--sandbox',
      'workspace-write',
      '--output-last-message',
      lastMessagePath,
    ];
    const model = this.opts.model ?? process.env.AINP_CODEX_MODEL;
    if (model) args.push('--model', model);
    args.push('-');
    const invocation = buildResolvedAgentBackendCliSpawn('codex', args, {
      bin: this.opts.bin,
      env: process.env,
      platform: process.platform,
    });
    const bin = invocation.bin;

    await emitMeta(ctx, 'started', {
      bin,
      stage: skill.stage,
      skillId: skill.id,
      sandbox: 'workspace-write',
      isolation: {
        ignoreRules: true,
        ignoreUserConfig: false,
        hooksDisabled: true,
        nonInteractive: true,
      },
    });

    const child = spawn(invocation.command, invocation.args, {
      cwd: ctx.workspacePath,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CODEX_NON_INTERACTIVE: '1' },
      shell: invocation.shell,
      windowsHide: invocation.windowsHide,
    });
    child.stdin.end(prompt);

    const timeoutMs = this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
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
      const parsed = parseCodexJsonLine(line);
      if (parsed.text) process.stdout.write(`${parsed.text}\n`);
      await emit(ctx, parsed);
    });
    const stderrDone = consumeLines(child.stderr, async (line) => {
      const safeLine = maskSecrets(line);
      process.stderr.write(`[codex:stderr] ${safeLine}\n`);
      await emit(ctx, { type: 'stderr', payload: { line: safeLine }, text: safeLine });
    });

    const exitCode: number = await new Promise((resolve) => {
      child.once('exit', (code) => resolve(code ?? -1));
    });
    await Promise.allSettled([stdoutDone, stderrDone]);
    clearTimeout(timer);
    if (hardKillTimer) clearTimeout(hardKillTimer);

    const lastMessage = await readOptionalText(lastMessagePath);
    await emitMeta(ctx, 'finished', { exitCode, timedOut, lastMessagePath });
    return { exitCode, lastMessage };
  }
}

export async function codexCliAvailable(bin?: string): Promise<boolean> {
  return cliAvailable('codex', bin);
}

function buildPrompt(skill: SkillSpec, ctx: AgentTaskContext, args: BuildPromptArgs): string {
  return renderCombinedAgentPrompt(renderAgentPrompt({
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
  }));
}

const emit = createAgentEventEmitter('codex', 'codex');

async function emitMeta(
  ctx: AgentTaskContext,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await emit(ctx, { type: 'meta', payload: { event, ...payload }, text: `[codex:${event}]` });
}

async function readOptionalText(path: string): Promise<string | null> {
  try {
    const text = await readFile(path, 'utf8');
    const trimmed = text.trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * Per-stage staging directory inside the workspace. Codex's tool router hard-
 * blocks apply_patch writes outside `--cd`, so we stage artifact targets here
 * and copy them out to the canonical `ctx.artifactsDir` after the CLI exits.
 * The `.ainp-artifacts` name is intentionally distinctive so it's easy to
 * grep/ignore and, for implementation stages, trivially excluded from git
 * diffs (we reset the worktree to HEAD before diffing in practice; for
 * produce-file stages the staging dir is cleaned up after the copy).
 */
function codexStageDir(workspacePath: string, stage: string): string {
  return join(workspacePath, '.ainp-artifacts', stage);
}

/**
 * Copy a staged artifact out to its final location under `ctx.artifactsDir`
 * and clean up the staging file. Returns null when the staged file is
 * missing, or the byte size of the produced file.
 */
async function adoptStagedArtifact(
  stagedPath: string,
  finalPath: string,
): Promise<{ size: number } | null> {
  if (!existsSync(stagedPath)) return null;
  const buf = await readFile(stagedPath);
  await writeFile(finalPath, buf);
  try {
    await rm(stagedPath, { force: true });
  } catch {
    // Best-effort; leftover staged files don't affect correctness.
  }
  return { size: buf.byteLength };
}
