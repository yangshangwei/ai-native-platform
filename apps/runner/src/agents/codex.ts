/**
 * CodexBackend — drives `codex exec --json` as a non-interactive AgentBackend.
 *
 * The runner keeps platform invariants:
 * - non-implementation stages must write exactly one markdown artifact under
 *   ctx.artifactsDir;
 * - implementation edits the worktree only; runner captures git diff itself;
 * - gates, command execution, and approvals remain outside the agent.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import {
  agentBackendCliArgs,
  buildAgentBackendCliSpawn,
  buildResolvedAgentBackendCliSpawn,
  maskSecrets,
  resolveAgentBackendCliCandidates,
  type AgentStreamEventInput,
  type SkillSpec,
} from '@ainp/shared';
import { api } from '../api-client';
import { sh } from '../sh';
import type { AgentArtifactOutput, AgentBackend, AgentRunResult, AgentTaskContext } from './native';
import { parseCodexJsonLine } from './codex-parser';
import { renderAgentPrompt, renderCombinedAgentPrompt } from '../context/renderer';
import { parseContextRequestFromAgentOutput } from '../context/request';

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
    const targetPath = join(ctx.artifactsDir, expected.name);
    if (!existsSync(targetPath)) await writeFile(targetPath, '', 'utf8');

    const prompt = buildPrompt(skill, ctx, {
      mode: 'produce_file',
      targetPath,
      outputName: expected.name,
    });
    const { exitCode, lastMessage } = await this.invokeCli(prompt, ctx, skill);
    if (exitCode !== 0) throw new Error(`codex exited ${exitCode} for stage ${skill.stage}`);

    if (!existsSync(targetPath)) {
      if (isStructuredContextRequest(lastMessage, ctx, skill)) return { outputs: [], lastMessage };
      throw new Error(`codex did not write expected artifact at ${targetPath}`);
    }
    const buf = await readFile(targetPath);
    if (buf.byteLength === 0) {
      if (isStructuredContextRequest(lastMessage, ctx, skill)) return { outputs: [], lastMessage };
      throw new Error(`codex produced empty artifact at ${targetPath}`);
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
    const prompt = buildPrompt(skill, ctx, { mode: 'implementation' });
    const { exitCode, lastMessage } = await this.invokeCli(prompt, ctx, skill);
    if (exitCode !== 0) throw new Error(`codex exited ${exitCode} during implementation`);

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
    prompt: string,
    ctx: AgentTaskContext,
    skill: SkillSpec,
  ): Promise<{ exitCode: number; lastMessage: string | null }> {
    const lastMessagePath = join(ctx.artifactsDir, '.codex-last-message.txt');
    const args = [
      'exec',
      '--json',
      '--ephemeral',
      '--skip-git-repo-check',
      '--cd',
      ctx.workspacePath,
      '--add-dir',
      ctx.artifactsDir,
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

    await emitMeta(ctx, 'started', { bin, stage: skill.stage, skillId: skill.id, sandbox: 'workspace-write' });

    const child = spawn(invocation.command, invocation.args, {
      cwd: ctx.workspacePath,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
      shell: invocation.shell,
      windowsHide: invocation.windowsHide,
    });
    child.stdin.end(prompt);

    const timeoutMs = this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
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

    const lastMessage = await readOptionalText(lastMessagePath);
    await emitMeta(ctx, 'finished', { exitCode, timedOut, lastMessagePath });
    return { exitCode, lastMessage };
  }
}

export async function codexCliAvailable(bin?: string): Promise<boolean> {
  const candidates = resolveAgentBackendCliCandidates('codex', {
    bin,
    env: process.env,
    platform: process.platform,
  });

  for (const candidate of candidates) {
    if (await exitsZero(candidate, agentBackendCliArgs('codex', 'version'))) return true;
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

interface BuildPromptArgs {
  mode: 'produce_file' | 'implementation';
  targetPath?: string;
  outputName?: string;
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

function pickFileOutput(skill: SkillSpec): { name: string; contentType: string } {
  const out = skill.outputs[0];
  if (!out) throw new Error(`skill ${skill.id} has no outputs`);
  return { name: out.name, contentType: 'text/markdown' };
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

async function emit(
  ctx: AgentTaskContext,
  parsed: { type: AgentStreamEventInput['type']; payload: Record<string, unknown>; text: string | null },
): Promise<void> {
  try {
    await api.postAgentEvent({
      workflowRunId: ctx.workflowRunId,
      stepRunId: ctx.stepRunId ?? null,
      agentKind: 'codex',
      type: parsed.type,
      payload: parsed.payload,
      text: parsed.text,
    });
  } catch (err) {
    // API push failure must not stop the local Codex process. The local console still gets it.
    process.stderr.write(`[codex] postAgentEvent failed: ${maskSecrets((err as Error).message)}\n`);
  }
}

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
