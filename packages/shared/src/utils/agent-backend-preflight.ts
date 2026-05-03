import {
  agentBackendDisplayName,
  type AgentBackendPreflight,
  type ProjectAgentBackendKind,
} from '../types/agent';
import { nowIso } from './id';
import { maskSecrets } from './redaction';

export interface AgentBackendCliResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error: string | null;
}

export function notConfiguredAgentBackendPreflight(): AgentBackendPreflight {
  return {
    backend: null,
    label: 'Agent Backend',
    bin: null,
    installed: false,
    runnable: false,
    authenticated: null,
    version: null,
    status: 'not_configured',
    error: 'Agent Backend is not configured for this project.',
    remediationHint: 'Choose Claude Code or Codex in the project Agent Backend card, then run Check connection.',
    checkedAt: nowIso(),
  };
}

export function missingCliAgentBackendPreflight(
  backend: ProjectAgentBackendKind,
  bin: string,
  result: AgentBackendCliResult,
): AgentBackendPreflight {
  return {
    backend,
    label: agentBackendDisplayName(backend),
    bin,
    installed: false,
    runnable: false,
    authenticated: null,
    version: null,
    status: 'missing_cli',
    error: compactRawError(result) || `${bin} --version failed`,
    remediationHint: installHint(backend, bin),
    checkedAt: nowIso(),
  };
}

export function classifyAgentBackendAuthPreflight(
  backend: ProjectAgentBackendKind,
  bin: string,
  version: string | null,
  result: AgentBackendCliResult,
): AgentBackendPreflight {
  return backend === 'claude_code'
    ? classifyClaudeCodeAuthStatus(bin, version, result)
    : classifyCodexLoginStatus(bin, version, result);
}

export function firstNonEmptyLine(value: string): string | null {
  return value.split('\n').map((line) => line.trim()).find(Boolean) ?? null;
}

export type ClaudeAuthStatusParse =
  | { valid: true; loggedIn: boolean }
  | { valid: false; reason: string };

export type CodexLoginStatusParse =
  | { state: 'logged_in' }
  | { state: 'logged_out' }
  | { state: 'unknown' };

export function parseClaudeAuthStatus(text: string): ClaudeAuthStatusParse {
  const parsed = parseJsonObject(text.trim()) ?? parseJsonLine(text);
  if (!parsed) return { valid: false, reason: 'invalid_json' };
  if (typeof parsed['loggedIn'] !== 'boolean') {
    return { valid: false, reason: 'missing_loggedIn' };
  }
  return { valid: true, loggedIn: parsed['loggedIn'] };
}

export function parseCodexLoginStatus(text: string): CodexLoginStatusParse {
  if (/\b(not logged in|not currently logged in|logged out|not authenticated|not signed in|login required)\b/i.test(text)) {
    return { state: 'logged_out' };
  }
  if (/\blogged in\b/i.test(text)) return { state: 'logged_in' };
  return { state: 'unknown' };
}

function classifyClaudeCodeAuthStatus(
  bin: string,
  version: string | null,
  result: AgentBackendCliResult,
): AgentBackendPreflight {
  const label = agentBackendDisplayName('claude_code');
  const output = `${result.stdout}\n${result.stderr}`;
  const parsed = parseClaudeAuthStatus(output);

  if (result.exitCode === 0 && parsed.valid && parsed.loggedIn) {
    return connectedPreflight('claude_code', label, bin, version);
  }

  const detail = result.exitCode === 0
    ? authStatusJsonError(parsed, output)
    : compactAuthStatusFailure(result);
  const needsLogin = (parsed.valid && !parsed.loggedIn) || looksLikeLoginMissing(detail);

  return {
    backend: 'claude_code',
    label,
    bin,
    installed: true,
    runnable: false,
    authenticated: false,
    version,
    status: needsLogin ? 'needs_login' : 'not_runnable',
    error: detail,
    remediationHint: needsLogin ? loginHint('claude_code', bin) : runnableHint('claude_code', bin),
    checkedAt: nowIso(),
  };
}

function classifyCodexLoginStatus(
  bin: string,
  version: string | null,
  result: AgentBackendCliResult,
): AgentBackendPreflight {
  const label = agentBackendDisplayName('codex');
  const output = `${result.stdout}\n${result.stderr}`;
  const parsed = parseCodexLoginStatus(output);

  if (result.exitCode === 0 && parsed.state === 'logged_in') {
    return connectedPreflight('codex', label, bin, version);
  }

  const detail = result.exitCode === 0
    ? codexLoginStatusError(parsed, output)
    : compactCodexLoginStatusFailure(result);
  const needsLogin = parsed.state === 'logged_out' || (result.exitCode !== 0 && looksLikeLoginMissing(detail));

  return {
    backend: 'codex',
    label,
    bin,
    installed: true,
    runnable: false,
    authenticated: false,
    version,
    status: needsLogin ? 'needs_login' : 'not_runnable',
    error: detail,
    remediationHint: needsLogin ? loginHint('codex', bin) : runnableHint('codex', bin),
    checkedAt: nowIso(),
  };
}

function connectedPreflight(
  backend: ProjectAgentBackendKind,
  label: string,
  bin: string,
  version: string | null,
): AgentBackendPreflight {
  return {
    backend,
    label,
    bin,
    installed: true,
    runnable: true,
    authenticated: true,
    version,
    status: 'connected',
    error: null,
    remediationHint: `${label} is installed and authenticated; runtime prompts will run when a workflow starts.`,
    checkedAt: nowIso(),
  };
}

function parseJsonLine(text: string): Record<string, unknown> | null {
  for (const line of text.split('\n')) {
    const parsed = parseJsonObject(line.trim());
    if (parsed) return parsed;
  }
  return null;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function authStatusJsonError(parsed: ClaudeAuthStatusParse, output: string): string {
  if (parsed.valid && !parsed.loggedIn) return 'Claude Code auth status reported loggedIn=false.';
  const reason = parsed.valid ? 'unexpected auth status' : parsed.reason;
  const preview = compactText(output, 500);
  return preview
    ? `Claude Code auth status returned ${reason}; expected JSON with loggedIn=true.\n${preview}`
    : `Claude Code auth status returned ${reason}; expected JSON with loggedIn=true.`;
}

function codexLoginStatusError(parsed: CodexLoginStatusParse, output: string): string {
  if (parsed.state === 'logged_out') return 'Codex login status reported not logged in.';
  const preview = compactText(output, 500);
  return preview
    ? `Codex login status output was not recognized; expected "Logged in".\n${preview}`
    : 'Codex login status output was not recognized; expected "Logged in".';
}

function compactAuthStatusFailure(result: AgentBackendCliResult): string {
  const detail = compactText([result.error, result.stderr, result.stdout].filter(Boolean).join('\n'), 700);
  const parts: string[] = [];
  if (result.timedOut) parts.push('Timed out while checking Claude Code auth status.');
  if (result.exitCode != null && result.exitCode !== 0) parts.push(`claude auth status exited with code ${result.exitCode}.`);
  if (detail) parts.push(detail);
  return parts.join('\n').trim() || 'claude auth status failed.';
}

function compactCodexLoginStatusFailure(result: AgentBackendCliResult): string {
  const detail = compactText([result.error, result.stderr, result.stdout].filter(Boolean).join('\n'), 700);
  const parts: string[] = [];
  if (result.timedOut) parts.push('Timed out while checking Codex login status.');
  if (result.exitCode != null && result.exitCode !== 0) parts.push(`codex login status exited with code ${result.exitCode}.`);
  if (detail) parts.push(detail);
  return parts.join('\n').trim() || 'codex login status failed.';
}

function compactRawError(result: AgentBackendCliResult): string {
  const detail = [result.error, result.stderr, result.stdout]
    .filter(Boolean)
    .join('\n')
    .trim();
  const prefix = result.timedOut ? 'Timed out during preflight.\n' : '';
  return compactText(`${prefix}${detail}`, 2_000);
}

function compactText(s: string, n: number): string {
  return truncate(maskSecrets(s).split('\n').map((line) => line.trim()).filter(Boolean).join('\n'), n);
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}

function looksLikeLoginMissing(message: string): boolean {
  return /login|log in|logged out|not logged|sign in|credential|unauthorized|forbidden|api key|apikey|token|not authenticated/i.test(message);
}

function installHint(backend: ProjectAgentBackendKind, bin: string): string {
  return backend === 'claude_code'
    ? `Install Claude Code or set AINP_CLAUDE_BIN to the ${bin} binary path, then run claude --version.`
    : `Install Codex CLI or set AINP_CODEX_BIN to the ${bin} binary path, then run codex --version.`;
}

function loginHint(backend: ProjectAgentBackendKind, bin: string): string {
  return backend === 'claude_code'
    ? `Run ${bin} login (or configure Claude Code credentials) on the runner machine, then retry Check connection.`
    : `Run ${bin} login (or configure Codex credentials) on the runner machine, then retry Check connection.`;
}

function runnableHint(backend: ProjectAgentBackendKind, bin: string): string {
  return backend === 'claude_code'
    ? `Run ${bin} auth status on the runner machine and fix the reported CLI/auth-status error.`
    : `Run ${bin} login status on the runner machine and fix the reported CLI/login-status error.`;
}
