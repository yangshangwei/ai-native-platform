/**
 * Shared CLI-backend plumbing for ClaudeCodeBackend / CodexBackend (and the
 * Coordinator one-shot runner). Everything here was extracted verbatim from
 * the per-backend files where it had been copy-pasted; the real divergences —
 * claude's post-result grace / exit-code reconciliation and codex's
 * in-workspace staging — stay in their respective backend files.
 */

import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import {
  agentBackendCliArgs,
  buildAgentBackendCliSpawn,
  maskSecrets,
  resolveAgentBackendCliCandidates,
  type AgentStreamEventInput,
  type SkillSpec,
} from '@ainp/shared';
import { sh } from '../sh';
import { api } from '../api-client';
import { parseContextRequestFromAgentOutput } from '../context/request';
import type { AgentArtifactOutput, AgentTaskContext } from './types';

/** CLI-driven production backends (NativeBackend is a test fixture). */
export type CliBackendKind = 'claude_code' | 'codex';

/** Prompt-assembly arguments shared by both CLI backends. */
export interface BuildPromptArgs {
  mode: 'produce_file' | 'implementation';
  targetPath?: string;
  outputName?: string;
  /** Extra required files beyond the primary one (08-08 P0-2 review verdict). */
  additionalTargets?: ReadonlyArray<{ name: string; path: string }>;
}

/** A stream event already parsed from a CLI output line. */
export interface ParsedAgentEvent {
  type: AgentStreamEventInput['type'];
  payload: Record<string, unknown>;
  text: string | null;
}

/** Consume a child-process stream line by line, skipping empty lines. */
export async function consumeLines(
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

/** Returns true when `bin args...` exits 0 within ~3s (availability probe). */
export function exitsZero(bin: string, args: string[]): Promise<boolean> {
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

/** Returns true when the backend's `--version` probe exits 0 within ~3s. */
export async function cliAvailable(backend: CliBackendKind, bin?: string): Promise<boolean> {
  const candidates = resolveAgentBackendCliCandidates(backend, {
    bin,
    env: process.env,
    platform: process.platform,
  });

  for (const candidate of candidates) {
    if (await exitsZero(candidate, agentBackendCliArgs(backend, 'version'))) return true;
  }
  return false;
}

/** The single file output a produce-file stage is expected to write. */
export function pickFileOutput(skill: SkillSpec): { name: string; contentType: string } {
  const out = skill.outputs[0];
  if (!out) throw new Error(`skill ${skill.id} has no outputs`);
  return { name: out.name, contentType: contentTypeForOutputName(out.name) };
}

/**
 * Required produce-file outputs after the primary one. `skill.review` declares
 * `review.md` plus the machine-readable `review-verdict.json` (08-08 P0-2 R2);
 * every other produce-file skill still has exactly one required output, so this
 * is empty for them.
 */
export function pickAdditionalFileOutputs(
  skill: SkillSpec,
): Array<{ name: string; contentType: string }> {
  return skill.outputs
    .slice(1)
    .filter((out) => out.required === true)
    .map((out) => ({ name: out.name, contentType: contentTypeForOutputName(out.name) }));
}

function contentTypeForOutputName(name: string): string {
  return name.endsWith('.json') ? 'application/json' : 'text/markdown';
}

/**
 * Probe whether the agent's final message is a structured context_request —
 * the legitimate way for a produce-file stage to end without an artifact.
 */
export function isStructuredContextRequest(
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

/**
 * Implementation-stage diff capture: run `git diff` / `git diff --name-only`
 * in the worktree, persist them as `changes.diff` + `changed-files.txt` under
 * `artifactsDir`, and return the two artifact outputs.
 */
export async function captureWorktreeDiffOutputs(
  workspacePath: string,
  artifactsDir: string,
): Promise<AgentArtifactOutput[]> {
  const diff = await sh('git', ['diff'], { cwd: workspacePath });
  const diffPath = join(artifactsDir, 'changes.diff');
  await writeFile(diffPath, diff.stdout, 'utf8');

  const namesOnly = await sh('git', ['diff', '--name-only'], { cwd: workspacePath });
  const namesPath = join(artifactsDir, 'changed-files.txt');
  await writeFile(namesPath, namesOnly.stdout, 'utf8');

  return [
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
  ];
}

/**
 * Build the per-backend agent-event emitter. API push failure must not stop
 * streaming — it is downgraded to a local stderr line tagged `logLabel`.
 */
export function createAgentEventEmitter(
  agentKind: CliBackendKind,
  logLabel: string,
): (ctx: AgentTaskContext, parsed: ParsedAgentEvent) => Promise<void> {
  return async (ctx, parsed) => {
    // R1.6: mask secrets in agent stdout events before persisting to database
    const maskedText = parsed.text ? maskSecrets(parsed.text) : parsed.text;
    const maskedPayload = maskSecretsInPayload(parsed.payload) as Record<string, unknown>;

    try {
      await api.postAgentEvent({
        workflowRunId: ctx.workflowRunId,
        stepRunId: ctx.stepRunId ?? null,
        agentKind,
        type: parsed.type,
        payload: maskedPayload,
        text: maskedText,
      });
    } catch (err) {
      // API push failure must not stop streaming. The local console still gets it.
      process.stderr.write(
        `[${logLabel}] postAgentEvent failed: ${maskSecrets((err as Error).message)}\n`,
      );
    }
  };
}

function maskSecretsInPayload(payload: unknown): unknown {
  if (typeof payload === 'string') {
    return maskSecrets(payload);
  }
  if (payload && typeof payload === 'object') {
    if (Array.isArray(payload)) {
      return payload.map(maskSecretsInPayload);
    }
    const masked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      masked[key] = maskSecretsInPayload(value);
    }
    return masked;
  }
  return payload;
}
