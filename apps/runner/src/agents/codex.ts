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
import type { AgentStreamEventInput, SkillSpec } from '@ainp/shared';
import { api } from '../api-client';
import { sh } from '../sh';
import type { AgentArtifactOutput, AgentBackend, AgentTaskContext } from './native';
import { parseCodexJsonLine } from './codex-parser';

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
  ): Promise<{ outputs: AgentArtifactOutput[] }> {
    await mkdir(ctx.artifactsDir, { recursive: true });
    if (skill.stage === 'implementation') return this.runImplementation(skill, ctx);
    return this.runProducingFile(skill, ctx);
  }

  private async runProducingFile(
    skill: SkillSpec,
    ctx: AgentTaskContext,
  ): Promise<{ outputs: AgentArtifactOutput[] }> {
    const expected = pickFileOutput(skill);
    const targetPath = join(ctx.artifactsDir, expected.name);
    if (!existsSync(targetPath)) await writeFile(targetPath, '', 'utf8');

    const prompt = buildPrompt(skill, ctx, {
      mode: 'produce_file',
      targetPath,
      outputName: expected.name,
    });
    const { exitCode } = await this.invokeCli(prompt, ctx, skill);
    if (exitCode !== 0) throw new Error(`codex exited ${exitCode} for stage ${skill.stage}`);

    if (!existsSync(targetPath)) throw new Error(`codex did not write expected artifact at ${targetPath}`);
    const buf = await readFile(targetPath);
    if (buf.byteLength === 0) throw new Error(`codex produced empty artifact at ${targetPath}`);
    return {
      outputs: [
        {
          name: expected.name,
          path: targetPath,
          contentType: expected.contentType,
          size: buf.byteLength,
        },
      ],
    };
  }

  private async runImplementation(
    skill: SkillSpec,
    ctx: AgentTaskContext,
  ): Promise<{ outputs: AgentArtifactOutput[] }> {
    const prompt = buildPrompt(skill, ctx, { mode: 'implementation' });
    const { exitCode } = await this.invokeCli(prompt, ctx, skill);
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
    };
  }

  private async invokeCli(
    prompt: string,
    ctx: AgentTaskContext,
    skill: SkillSpec,
  ): Promise<{ exitCode: number }> {
    const bin = this.opts.bin ?? process.env.AINP_CODEX_BIN ?? 'codex';
    const lastMessagePath = join(ctx.artifactsDir, '.codex-last-message.txt');
    const args = [
      'exec',
      '--json',
      '--color',
      'never',
      '--ephemeral',
      '--skip-git-repo-check',
      '--cd',
      ctx.workspacePath,
      '--add-dir',
      ctx.artifactsDir,
      '--sandbox',
      'workspace-write',
      '--ask-for-approval',
      'never',
      '--output-last-message',
      lastMessagePath,
    ];
    const model = this.opts.model ?? process.env.AINP_CODEX_MODEL;
    if (model) args.push('--model', model);
    args.push('-');

    await emitMeta(ctx, 'started', { bin, stage: skill.stage, skillId: skill.id, sandbox: 'workspace-write' });

    const child = spawn(bin, args, {
      cwd: ctx.workspacePath,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
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
      process.stderr.write(`[codex:stderr] ${line}\n`);
      await emit(ctx, { type: 'stderr', payload: { line }, text: line });
    });

    const exitCode: number = await new Promise((resolve) => {
      child.once('exit', (code) => resolve(code ?? -1));
    });
    await Promise.allSettled([stdoutDone, stderrDone]);
    clearTimeout(timer);

    await emitMeta(ctx, 'finished', { exitCode, timedOut, lastMessagePath });
    return { exitCode };
  }
}

export async function codexCliAvailable(bin = process.env.AINP_CODEX_BIN ?? 'codex'): Promise<boolean> {
  try {
    const r = await sh(bin, ['--version']);
    return r.exitCode === 0;
  } catch {
    return false;
  }
}

interface BuildPromptArgs {
  mode: 'produce_file' | 'implementation';
  targetPath?: string;
  outputName?: string;
}

function buildPrompt(skill: SkillSpec, ctx: AgentTaskContext, args: BuildPromptArgs): string {
  const writableGlobs = skill.toolPolicy.writableGlobs.length > 0
    ? skill.toolPolicy.writableGlobs.join(', ')
    : '(none)';
  const lines = [
    'You are an AI software engineer running inside the AI Native Platform workflow.',
    `Skill: ${skill.id} (stage=${skill.stage})`,
    `Workflow run: ${ctx.workflowRunId}`,
    `Branch: ${ctx.branch}`,
    `Working directory: ${ctx.workspacePath}`,
    `Artifacts directory: ${ctx.artifactsDir}`,
    `Title: ${ctx.title}`,
    '',
    'SKILL INSTRUCTIONS:',
    skill.instructions,
    '',
    'TOOL POLICY:',
    `- Allowed commands hint: ${skill.toolPolicy.allowedCommands.join(', ') || '(none specific)'}`,
    `- Writable globs: ${writableGlobs}`,
    `- Network: ${skill.toolPolicy.networkAllowed ? 'allowed' : 'forbidden'}`,
    '- Do not run build/test commands. The runner owns compile/test.',
    '',
  ];

  if (args.mode === 'produce_file' && args.targetPath && args.outputName) {
    lines.push(
      'OUTPUT REQUIREMENT:',
      `Write the final ${args.outputName} markdown to this exact absolute path:`,
      args.targetPath,
      'Do not modify source files for this stage.',
      '',
    );
  } else {
    lines.push(
      'OUTPUT REQUIREMENT:',
      `Edit files inside the worktree (${ctx.workspacePath}) only.`,
      'Stay within the writable globs above. Do not run git, mvn, or build commands.',
      'The runner will capture git diff after you finish.',
      '',
    );
  }

  lines.push('USER REQUEST:', ctx.title, '');
  for (const [name, value] of Object.entries(ctx.inputs)) {
    if (name === 'user_request' || !value) continue;
    lines.push(`--- ${name} ---`, value, '');
  }
  return lines.join('\n');
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
  await api.postAgentEvent({
    workflowRunId: ctx.workflowRunId,
    stepRunId: ctx.stepRunId ?? null,
    agentKind: 'codex',
    type: parsed.type,
    payload: parsed.payload,
    text: parsed.text,
  });
}

async function emitMeta(
  ctx: AgentTaskContext,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await emit(ctx, { type: 'meta', payload: { event, ...payload }, text: `[codex:${event}]` });
}
