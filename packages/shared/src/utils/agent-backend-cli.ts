import type { ProjectAgentBackendKind } from '../types/agent';

export type AgentBackendCliPurpose = 'version' | 'claude_auth_status' | 'codex_login_status';

export interface AgentBackendCliResolveOptions {
  env?: Record<string, string | undefined>;
  platform?: string;
  bin?: string | null;
}

export interface AgentBackendCliSpawnOptions extends AgentBackendCliResolveOptions {
  comSpec?: string | null;
}

export interface AgentBackendCliSpawn {
  /** The backend binary/shim selected by resolver logic. */
  bin: string;
  /** The actual process to pass as child_process.spawn(command, args, options). */
  command: string;
  /** Full argument vector to pass to spawn; never a concatenated shell string. */
  args: string[];
  /** Kept explicit so callers do not enable shell string interpolation accidentally. */
  shell: false;
  windowsHide: boolean;
}

export function agentBackendEnvKey(backend: ProjectAgentBackendKind): 'AINP_CLAUDE_BIN' | 'AINP_CODEX_BIN' {
  return backend === 'claude_code' ? 'AINP_CLAUDE_BIN' : 'AINP_CODEX_BIN';
}

export function agentBackendDefaultBin(backend: ProjectAgentBackendKind): 'claude' | 'codex' {
  return backend === 'claude_code' ? 'claude' : 'codex';
}

export function agentBackendCliArgs(
  backend: ProjectAgentBackendKind,
  purpose: AgentBackendCliPurpose,
): string[] {
  if (purpose === 'version') return ['--version'];
  if (backend === 'claude_code' && purpose === 'claude_auth_status') return ['auth', 'status'];
  if (backend === 'codex' && purpose === 'codex_login_status') return ['login', 'status'];
  throw new Error(`Unsupported ${backend} CLI purpose: ${purpose}`);
}

export function agentBackendAuthCliArgs(backend: ProjectAgentBackendKind): string[] {
  return backend === 'claude_code'
    ? agentBackendCliArgs(backend, 'claude_auth_status')
    : agentBackendCliArgs(backend, 'codex_login_status');
}

export function resolveAgentBackendCliCandidates(
  backend: ProjectAgentBackendKind,
  opts: AgentBackendCliResolveOptions = {},
): string[] {
  const platform = opts.platform ?? defaultPlatform();
  const env = opts.env ?? {};
  const override = normalizeBin(opts.bin ?? env[agentBackendEnvKey(backend)]);

  if (override) {
    return isWindows(platform) ? expandWindowsBinCandidates(override) : [override];
  }

  const base = agentBackendDefaultBin(backend);
  if (!isWindows(platform)) return [base];
  return expandWindowsBinCandidates(base);
}

export function resolveAgentBackendCliBin(
  backend: ProjectAgentBackendKind,
  opts: AgentBackendCliResolveOptions = {},
): string {
  return resolveAgentBackendCliCandidates(backend, opts)[0] ?? agentBackendDefaultBin(backend);
}

export function buildAgentBackendCliSpawn(
  bin: string,
  args: readonly string[],
  opts: AgentBackendCliSpawnOptions = {},
): AgentBackendCliSpawn {
  const platform = opts.platform ?? defaultPlatform();
  const normalizedBin = normalizeBin(bin) ?? bin;
  if (isWindows(platform) && isWindowsCommandShim(normalizedBin)) {
    return {
      bin: normalizedBin,
      command: opts.comSpec ?? opts.env?.ComSpec ?? opts.env?.COMSPEC ?? 'cmd.exe',
      args: ['/d', '/s', '/c', normalizedBin, ...args],
      shell: false,
      windowsHide: true,
    };
  }

  return {
    bin: normalizedBin,
    command: normalizedBin,
    args: [...args],
    shell: false,
    windowsHide: isWindows(platform),
  };
}

export function buildResolvedAgentBackendCliSpawn(
  backend: ProjectAgentBackendKind,
  args: readonly string[],
  opts: AgentBackendCliSpawnOptions = {},
): AgentBackendCliSpawn {
  return buildAgentBackendCliSpawn(resolveAgentBackendCliBin(backend, opts), args, opts);
}

export function isWindowsCommandShim(bin: string): boolean {
  return /\.(?:cmd|bat)$/i.test(stripQueryish(bin));
}

function expandWindowsBinCandidates(bin: string): string[] {
  if (hasWindowsExecutableExtension(bin)) return [bin];
  return unique([`${bin}.cmd`, `${bin}.exe`, `${bin}.bat`, bin]);
}

function hasWindowsExecutableExtension(bin: string): boolean {
  return /\.(?:cmd|bat|exe|com)$/i.test(stripQueryish(bin));
}

function normalizeBin(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function stripQueryish(bin: string): string {
  // Defensive: keep extension checks stable if a future caller passes a file URL-ish value.
  return bin.split(/[?#]/, 1)[0] ?? bin;
}

function isWindows(platform: string): boolean {
  return platform === 'win32';
}

function defaultPlatform(): string {
  const maybeGlobal = globalThis as { process?: { platform?: string } };
  return maybeGlobal.process?.platform ?? 'linux';
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
