import { describe, expect, it } from 'vitest';
import {
  agentBackendAuthCliArgs,
  agentBackendCliArgs,
  buildAgentBackendCliSpawn,
  resolveAgentBackendCliCandidates,
} from '../src';

describe('agent backend CLI resolution', () => {
  it('uses ordinary binary names on macOS and Linux', () => {
    expect(resolveAgentBackendCliCandidates('claude_code', { platform: 'darwin', env: {} })).toEqual(['claude']);
    expect(resolveAgentBackendCliCandidates('codex', { platform: 'linux', env: {} })).toEqual(['codex']);
  });

  it('tries Windows npm/Bun shim and executable candidates before bare command names', () => {
    expect(resolveAgentBackendCliCandidates('claude_code', { platform: 'win32', env: {} })).toEqual([
      'claude.cmd',
      'claude.exe',
      'claude.bat',
      'claude',
    ]);
    expect(resolveAgentBackendCliCandidates('codex', { platform: 'win32', env: {} })).toEqual([
      'codex.cmd',
      'codex.exe',
      'codex.bat',
      'codex',
    ]);
  });

  it('expands env overrides without an extension on Windows', () => {
    expect(resolveAgentBackendCliCandidates('codex', {
      platform: 'win32',
      env: { AINP_CODEX_BIN: 'C:\\Tools\\codex-custom' },
    })).toEqual([
      'C:\\Tools\\codex-custom.cmd',
      'C:\\Tools\\codex-custom.exe',
      'C:\\Tools\\codex-custom.bat',
      'C:\\Tools\\codex-custom',
    ]);
  });

  it('honors env override paths that already name a Windows shim', () => {
    expect(resolveAgentBackendCliCandidates('claude_code', {
      platform: 'win32',
      env: { AINP_CLAUDE_BIN: '"C:\\Program Files\\Claude\\claude.cmd"' },
    })).toEqual(['C:\\Program Files\\Claude\\claude.cmd']);
  });

  it('wraps Windows .cmd shims through cmd.exe without building a shell string', () => {
    const invocation = buildAgentBackendCliSpawn('codex.cmd', ['exec', '--json', '-'], {
      platform: 'win32',
      env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
    });

    expect(invocation).toEqual({
      bin: 'codex.cmd',
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'codex.cmd', 'exec', '--json', '-'],
      shell: false,
      windowsHide: true,
    });
  });

  it('wraps Windows .bat shims and preserves spaced paths as spawn argv tokens', () => {
    const invocation = buildAgentBackendCliSpawn(
      'C:\\Program Files\\Claude\\claude.bat',
      ['--add-dir', 'C:\\Work Trees\\project', '--version'],
      {
        platform: 'win32',
        env: { COMSPEC: 'C:\\Windows\\System32\\cmd.exe' },
      },
    );

    expect(invocation).toEqual({
      bin: 'C:\\Program Files\\Claude\\claude.bat',
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: [
        '/d',
        '/s',
        '/c',
        'C:\\Program Files\\Claude\\claude.bat',
        '--add-dir',
        'C:\\Work Trees\\project',
        '--version',
      ],
      shell: false,
      windowsHide: true,
    });
  });

  it('does not wrap Windows .exe commands through cmd.exe', () => {
    const invocation = buildAgentBackendCliSpawn('claude.exe', ['--version'], { platform: 'win32', env: {} });

    expect(invocation).toMatchObject({
      bin: 'claude.exe',
      command: 'claude.exe',
      args: ['--version'],
      shell: false,
      windowsHide: true,
    });
  });

  it('centralizes preflight subcommands so API and Runner use the same arguments', () => {
    expect(agentBackendCliArgs('claude_code', 'version')).toEqual(['--version']);
    expect(agentBackendAuthCliArgs('claude_code')).toEqual(['auth', 'status']);
    expect(agentBackendCliArgs('codex', 'version')).toEqual(['--version']);
    expect(agentBackendAuthCliArgs('codex')).toEqual(['login', 'status']);
  });
});
