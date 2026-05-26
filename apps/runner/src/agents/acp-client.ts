import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import type { AgentBackendKind, AgentStreamEventInput } from '@ainp/shared';
import { buildAgentBackendCliSpawn, maskSecrets } from '@ainp/shared';
import { api } from '../api-client';

export interface AcpRunContext {
  workflowRunId: string | null;
  workflowRequestId?: string | null;
  stepRunId?: string | null;
  workspacePath: string;
  artifactsDir: string;
}

export interface AcpAgentCommand {
  bin: string;
  args: string[];
}

export interface ResolveAcpAgentCommandOptions {
  /** Constructor override. May include args, e.g. `npx -y @agentclientprotocol/codex-acp`. */
  command?: string | null;
  envKey: string;
  defaultCommand: string;
}

export interface RunAcpPromptOptions {
  command: AcpAgentCommand;
  kind: Extract<AgentBackendKind, 'claude_code' | 'codex'>;
  ctx: AcpRunContext;
  timeoutMs: number;
  prompt: string;
  additionalDirectories?: string[];
  sessionMeta?: Record<string, unknown>;
  env?: NodeJS.ProcessEnv;
  meta?: Record<string, unknown>;
  streamEmit?: (event: Pick<AgentStreamEventInput, 'type' | 'payload' | 'text'>) => void | Promise<void>;
}

export interface RunAcpPromptResult {
  exitCode: number;
  stopReason: string | null;
  lastMessage: string | null;
}

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

const PROTOCOL_VERSION = 1;
const DEFAULT_ACP_CLIENT_NAME = 'ai-native-platform-runner';

export function parseAcpAgentCommand(command: string): AcpAgentCommand {
  const parts = splitCommandLine(command.trim());
  if (!parts[0]) throw new Error('ACP agent command is empty');
  return { bin: parts[0], args: parts.slice(1) };
}

export function resolveAcpAgentCommand(opts: ResolveAcpAgentCommandOptions): AcpAgentCommand {
  return parseAcpAgentCommand(opts.command ?? process.env[opts.envKey] ?? opts.defaultCommand);
}

export async function runAcpPrompt(opts: RunAcpPromptOptions): Promise<RunAcpPromptResult> {
  const client = new AcpStdioClient(opts);
  return client.run();
}

class AcpStdioClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<JsonRpcId, {
    resolve: (value: unknown) => void;
    reject: (err: Error) => void;
  }>();
  private lastMessage: string | null = null;
  private timedOut = false;
  private settledExit = false;

  constructor(private readonly opts: RunAcpPromptOptions) {}

  async run(): Promise<RunAcpPromptResult> {
    const child = this.spawnAgent();
    this.child = child;

    const stdoutDone = this.consumeStdout(child);
    const stderrDone = this.consumeStderr(child);
    const timeout = setTimeout(() => {
      this.timedOut = true;
      child.kill('SIGTERM');
    }, this.opts.timeoutMs);

    try {
      await emitMeta(this.opts, 'acp_started', {
        bin: this.opts.command.bin,
        args: this.opts.command.args,
        ...this.opts.meta,
      });
      const initialize = await this.request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: {
          name: DEFAULT_ACP_CLIENT_NAME,
          title: 'AI Native Platform Runner',
          version: '0.0.1',
        },
        clientCapabilities: {
          fs: {
            readTextFile: true,
            writeTextFile: true,
          },
        },
      });
      await emitMeta(this.opts, 'acp_initialized', {
        protocolVersion: readObject(initialize)?.protocolVersion ?? null,
        agentInfo: readObject(initialize)?.agentInfo ?? null,
      });

      const newSession = await this.request('session/new', {
        cwd: this.opts.ctx.workspacePath,
        mcpServers: [],
        additionalDirectories: unique([
          this.opts.ctx.artifactsDir,
          ...(this.opts.additionalDirectories ?? []),
        ]),
        ...(this.opts.sessionMeta ? { _meta: this.opts.sessionMeta } : {}),
      });
      const sessionId = stringOr(readObject(newSession)?.sessionId, '');
      if (!sessionId) throw new Error('ACP agent did not return a sessionId from session/new');
      await emitMeta(this.opts, 'acp_session_new', { sessionId });

      const promptResponse = await this.request('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: this.opts.prompt }],
      });
      const stopReason = stringOr(readObject(promptResponse)?.stopReason, null);

      child.stdin.end();
      const rawExitCode = await waitForExit(child);
      await Promise.allSettled([stdoutDone, stderrDone]);
      const exitCode = rawExitCode === 0 && stopReason && stopReason !== 'end_turn'
        ? 1
        : rawExitCode;
      await emitMeta(this.opts, 'acp_finished', {
        exitCode,
        rawExitCode,
        timedOut: this.timedOut,
        stopReason,
      });

      return {
        exitCode,
        stopReason,
        lastMessage: this.lastMessage,
      };
    } finally {
      clearTimeout(timeout);
      if (!this.settledExit && !child.killed) child.kill('SIGTERM');
      await Promise.allSettled([stdoutDone, stderrDone]);
      this.rejectPending(new Error('ACP connection closed'));
    }
  }

  private spawnAgent(): ChildProcessWithoutNullStreams {
    const invocation = buildAgentBackendCliSpawn(
      this.opts.command.bin,
      this.opts.command.args,
      { env: process.env, platform: process.platform },
    );
    const child = spawn(invocation.command, invocation.args, {
      cwd: this.opts.ctx.workspacePath,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(this.opts.env ?? {}) },
      shell: invocation.shell,
      windowsHide: invocation.windowsHide,
    });
    child.once('exit', () => {
      this.settledExit = true;
      this.rejectPending(new Error('ACP connection closed'));
    });
    child.once('error', (err) => {
      this.rejectPending(err);
    });
    return child;
  }

  private async consumeStdout(child: ChildProcessWithoutNullStreams): Promise<void> {
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      let message: JsonRpcMessage;
      try {
        message = JSON.parse(line) as JsonRpcMessage;
      } catch {
        await this.emit({ type: 'raw', payload: { line }, text: line });
        continue;
      }
      await this.handleMessage(message);
    }
  }

  private async consumeStderr(child: ChildProcessWithoutNullStreams): Promise<void> {
    const rl = createInterface({ input: child.stderr, crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line) continue;
      const safeLine = maskSecrets(line);
      process.stderr.write(`[${this.opts.kind}:acp:stderr] ${safeLine}\n`);
      await this.emit({ type: 'stderr', payload: { line: safeLine }, text: safeLine });
    }
  }

  private async handleMessage(message: JsonRpcMessage): Promise<void> {
    if ('id' in message && !('method' in message)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if ('error' in message && message.error) {
        pending.reject(new Error(formatRpcError(message.error)));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (!('method' in message)) return;
    if ('id' in message) {
      const request = message as JsonRpcRequest;
      this.handleAgentRequest(request).catch((err) => {
        this.respondError(request.id, -32603, (err as Error).message);
      });
      return;
    }

    await this.handleNotification(message as JsonRpcNotification);
  }

  private async handleNotification(notification: JsonRpcNotification): Promise<void> {
    if (notification.method !== 'session/update') {
      await this.emit({
        type: 'meta',
        payload: { method: notification.method, params: notification.params },
        text: `[acp:${notification.method}]`,
      });
      return;
    }
    const parsed = renderAcpSessionUpdate(notification.params);
    if (parsed.text) process.stdout.write(`${parsed.text}\n`);
    if (parsed.lastMessage) this.lastMessage = `${this.lastMessage ?? ''}${parsed.lastMessage}`;
    await this.emit({
      type: parsed.type,
      payload: { method: notification.method, params: notification.params },
      text: parsed.text,
    });
  }

  private async handleAgentRequest(request: JsonRpcRequest): Promise<void> {
    switch (request.method) {
      case 'fs/read_text_file': {
        const params = readObject(request.params);
        const path = stringOr(params?.path, '');
        const allowedPath = await authorizeAcpFilePath(path, this.opts.ctx, {
          mode: 'read',
          additionalReadDirectories: this.opts.additionalDirectories,
        });
        const content = await readFile(allowedPath, 'utf8');
        this.respond(request.id, { content: sliceFileContent(content, params) });
        return;
      }
      case 'fs/write_text_file': {
        const params = readObject(request.params);
        const path = stringOr(params?.path, '');
        const content = stringOr(params?.content, '');
        const allowedPath = await authorizeAcpFilePath(path, this.opts.ctx, { mode: 'write' });
        await mkdir(dirname(allowedPath), { recursive: true });
        await writeFile(allowedPath, content, 'utf8');
        this.respond(request.id, null);
        return;
      }
      case 'session/request_permission': {
        const response = handlePermissionRequest(request.params, this.opts.ctx);
        await this.emit({
          type: 'meta',
          payload: { method: request.method, params: request.params, response },
          text: `[acp:permission] ${response.outcome.outcome}`,
        });
        this.respond(request.id, response);
        return;
      }
      case 'terminal/create':
      case 'terminal/output':
      case 'terminal/wait_for_exit':
      case 'terminal/kill':
      case 'terminal/release':
      case 'mcp/connect':
      case 'mcp/message':
      case 'mcp/disconnect':
        this.respondError(request.id, -32601, `${request.method} is not supported by runner ACP client`);
        return;
      default:
        this.respondError(request.id, -32601, `Unsupported ACP client request: ${request.method}`);
    }
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextRequestId++;
    const payload: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write(payload);
    });
  }

  private respond(id: JsonRpcId, result: unknown): void {
    this.write({ jsonrpc: '2.0', id, result });
  }

  private respondError(id: JsonRpcId, code: number, message: string): void {
    this.write({ jsonrpc: '2.0', id, error: { code, message } });
  }

  private write(message: JsonRpcMessage): void {
    const child = this.child;
    if (!child || child.stdin.destroyed) throw new Error('ACP process stdin is closed');
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private async emit(
    parsed: Pick<AgentStreamEventInput, 'type' | 'payload' | 'text'>,
  ): Promise<void> {
    if (this.opts.streamEmit) {
      await this.opts.streamEmit(parsed);
      return;
    }
    if (!hasStreamChannel(this.opts.ctx)) return;
    try {
      await api.postAgentEvent({
        workflowRunId: this.opts.ctx.workflowRunId,
        workflowRequestId: this.opts.ctx.workflowRequestId ?? null,
        stepRunId: this.opts.ctx.stepRunId ?? null,
        agentKind: this.opts.kind,
        type: parsed.type,
        payload: parsed.payload,
        text: parsed.text,
      });
    } catch (err) {
      process.stderr.write(`[${this.opts.kind}:acp] postAgentEvent failed: ${maskSecrets((err as Error).message)}\n`);
    }
  }

  private rejectPending(err: Error): void {
    for (const pending of this.pending.values()) pending.reject(err);
    this.pending.clear();
  }
}

interface RenderedAcpUpdate {
  type: AgentStreamEventInput['type'];
  text: string | null;
  lastMessage?: string | null;
}

function renderAcpSessionUpdate(params: unknown): RenderedAcpUpdate {
  const update = readObject(readObject(params)?.update);
  const kind = stringOr(update?.sessionUpdate, '');
  switch (kind) {
    case 'agent_message_chunk': {
      const text = contentText(update?.content);
      return { type: 'assistant', text: text ? `[acp…] ${truncate(text, 400)}` : null, lastMessage: text };
    }
    case 'agent_thought_chunk': {
      const text = contentText(update?.content);
      return { type: 'assistant', text: text ? `[think…] ${truncate(text, 240)}` : null };
    }
    case 'user_message_chunk': {
      const text = contentText(update?.content);
      return { type: 'user', text: text ? truncate(text, 400) : null };
    }
    case 'tool_call':
      return {
        type: 'assistant',
        text: `[tool→ ${stringOr(update?.kind, 'other')}] ${truncate(stringOr(update?.title, '?'), 240)}${update?.status ? ` (${String(update.status)})` : ''}`,
      };
    case 'tool_call_update':
      return {
        type: 'user',
        text: `[tool← ${update?.status === 'failed' ? 'ERR' : 'ok'}] ${truncate(stringOr(update?.title, stringOr(update?.toolCallId, 'tool')), 240)}`,
      };
    case 'plan':
      return { type: 'system', text: `[plan] ${truncate(renderPlan(update?.entries), 400)}` };
    case 'usage_update':
      return { type: 'result', text: `[usage] ${truncate(JSON.stringify(update), 240)}` };
    case 'available_commands_update':
    case 'current_mode_update':
    case 'config_option_update':
    case 'session_info_update':
      return { type: 'meta', text: `[acp:${kind}]` };
    default:
      return { type: 'meta', text: kind ? `[acp:${kind}]` : '[acp:update]' };
  }
}

function handlePermissionRequest(params: unknown, _ctx: AcpRunContext): { outcome: { outcome: 'cancelled' } | { outcome: 'selected'; optionId: string } } {
  const obj = readObject(params);
  const options = Array.isArray(obj?.options) ? obj.options : [];
  const reject = options
    .map((entry) => readObject(entry))
    .find((entry) => stringOr(entry?.kind, '').startsWith('reject'));
  const optionId = stringOr(reject?.optionId, '');
  if (optionId) return { outcome: { outcome: 'selected', optionId } };
  return { outcome: { outcome: 'cancelled' } };
}

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<number> {
  return new Promise((resolve) => {
    child.once('exit', (code) => resolve(code ?? -1));
  });
}

async function emitMeta(
  opts: RunAcpPromptOptions,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const streamEvent: Pick<AgentStreamEventInput, 'type' | 'payload' | 'text'> = {
    type: 'meta',
    payload: { event, ...payload },
    text: `[${opts.kind}:acp:${event}]`,
  };
  if (opts.streamEmit) {
    await opts.streamEmit(streamEvent);
    return;
  }
  if (!hasStreamChannel(opts.ctx)) return;
  try {
    await api.postAgentEvent({
      workflowRunId: opts.ctx.workflowRunId,
      workflowRequestId: opts.ctx.workflowRequestId ?? null,
      stepRunId: opts.ctx.stepRunId ?? null,
      agentKind: opts.kind,
      ...streamEvent,
    });
  } catch (err) {
    process.stderr.write(`[${opts.kind}:acp] postAgentEvent failed: ${maskSecrets((err as Error).message)}\n`);
  }
}

function hasStreamChannel(ctx: AcpRunContext): boolean {
  const hasRun = typeof ctx.workflowRunId === 'string' && ctx.workflowRunId.length > 0;
  const hasRequest = typeof ctx.workflowRequestId === 'string' && ctx.workflowRequestId.length > 0;
  return hasRun !== hasRequest;
}

async function authorizeAcpFilePath(
  path: string,
  ctx: AcpRunContext,
  opts: { mode: 'read' | 'write'; additionalReadDirectories?: readonly string[] },
): Promise<string> {
  if (!path || !isAbsolute(path)) throw new Error(`ACP file access denied: ${path}`);
  const requested = resolve(path);
  const roots = await acpRootInfos(
    ctx,
    opts.mode === 'read' ? opts.additionalReadDirectories ?? [] : [],
  );
  if (!roots.some((root) => isWithin(requested, root.path))) {
    throw new Error(`ACP file access denied: ${path}`);
  }

  if (opts.mode === 'read') {
    const realRequested = await realpath(requested);
    if (!roots.some((root) => isWithin(realRequested, root.realPath))) {
      throw new Error(`ACP file access denied: ${path}`);
    }
    return requested;
  }

  const existing = await nearestExistingAncestor(requested);
  if (!existing) throw new Error(`ACP file access denied: ${path}`);
  const realExisting = await realpath(existing);
  if (!roots.some((root) => isWithin(realExisting, root.realPath))) {
    throw new Error(`ACP file access denied: ${path}`);
  }
  return requested;
}

async function acpRootInfos(
  ctx: AcpRunContext,
  additionalDirectories: readonly string[] = [],
): Promise<{ path: string; realPath: string }[]> {
  const roots = unique([ctx.workspacePath, ctx.artifactsDir, ...additionalDirectories]).map((path) => resolve(path));
  const infos: { path: string; realPath: string }[] = [];
  for (const path of roots) {
    infos.push({ path, realPath: await realpath(path) });
  }
  return infos;
}

async function nearestExistingAncestor(path: string): Promise<string | null> {
  let current = path;
  while (true) {
    try {
      await lstat(current);
      return current;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function isWithin(path: string, parent: string): boolean {
  const resolvedParent = resolve(parent);
  const rel = relative(resolvedParent, resolve(path));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function sliceFileContent(content: string, params: Record<string, unknown> | null): string {
  const line = typeof params?.line === 'number' ? params.line : null;
  const limit = typeof params?.limit === 'number' ? params.limit : null;
  if (line == null && limit == null) return content;
  const lines = content.split('\n');
  const start = line != null && line > 0 ? line - 1 : 0;
  const end = limit != null && limit > 0 ? start + limit : undefined;
  return lines.slice(start, end).join('\n');
}

function contentText(content: unknown): string {
  const obj = readObject(content);
  const type = stringOr(obj?.type, '');
  if (type === 'text') return stringOr(obj?.text, '');
  if (type === 'resource_link') return stringOr(obj?.uri, '');
  if (type === 'resource') return JSON.stringify(obj?.resource ?? obj);
  return type ? `[${type}]` : '';
}

function renderPlan(entries: unknown): string {
  if (!Array.isArray(entries)) return '';
  return entries
    .map((entry) => {
      const obj = readObject(entry);
      const status = stringOr(obj?.status, '?');
      const content = stringOr(obj?.content, '');
      return content ? `${status}: ${content}` : status;
    })
    .filter(Boolean)
    .join('\n');
}

function splitCommandLine(input: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaping = false;
  for (const ch of input) {
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }
    if (ch === '\\') {
      escaping = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        out.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (escaping) current += '\\';
  if (current) out.push(current);
  return out;
}

function readObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringOr<T extends string | null>(value: unknown, fallback: T): string | T {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}

function formatRpcError(error: { code?: number; message?: string; data?: unknown }): string {
  const message = error.message ?? 'ACP request failed';
  const code = error.code == null ? '' : ` (${error.code})`;
  const data = error.data == null ? '' : ` ${truncate(JSON.stringify(error.data), 400)}`;
  return `${message}${code}${data}`;
}
