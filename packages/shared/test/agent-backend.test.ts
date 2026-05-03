import { expect, test } from 'vitest';
import { agentBackendDisplayName, isProjectAgentBackendKind, maskSecrets } from '../src';

test('project agent backend kind accepts only real user-selectable backends', () => {
  expect(isProjectAgentBackendKind('claude_code')).toBe(true);
  expect(isProjectAgentBackendKind('codex')).toBe(true);
  expect(isProjectAgentBackendKind('native')).toBe(false);
  expect(isProjectAgentBackendKind('gemini')).toBe(false);
});

test('agent backend display names hide legacy fixture names from product UI', () => {
  expect(agentBackendDisplayName('claude_code')).toBe('Claude Code');
  expect(agentBackendDisplayName('codex')).toBe('Codex');
  expect(agentBackendDisplayName('native')).toBe('Legacy test backend');
});

test('CLI diagnostics redact common secret shapes', () => {
  const masked = maskSecrets(
    'OPENAI_API_KEY=sk-test-codex-secret token=abcdef1234567890 Bearer abcdef1234567890ghp_123456789012345678901234',
  );

  expect(masked).toContain('OPENAI_API_KEY=[redacted]');
  expect(masked).toContain('token=[redacted]');
  expect(masked).toContain('Bearer [redacted]');
  expect(masked).not.toContain('sk-test-codex-secret');
  expect(masked).not.toContain('abcdef1234567890');
});
