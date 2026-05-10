import { CONTEXT_POLICY_SENSITIVE_PATH_PATTERNS_DEFAULT } from '../config/defaults';

export function normalizeSensitivePathPatterns(
  patterns: readonly string[] | undefined,
): string[] {
  const source = patterns && patterns.length > 0
    ? patterns
    : CONTEXT_POLICY_SENSITIVE_PATH_PATTERNS_DEFAULT;
  return [...new Set(source)]
    .map((pattern) => pattern.toLowerCase().replace(/\\/g, '/').trim())
    .filter(Boolean);
}

export function isSensitiveContextPath(
  value: string | null | undefined,
  patterns: readonly string[] = CONTEXT_POLICY_SENSITIVE_PATH_PATTERNS_DEFAULT,
): boolean {
  const text = value?.trim().replace(/\\/g, '/').toLowerCase();
  if (!text) return false;
  const normalizedPatterns = normalizeSensitivePathPatterns(patterns);
  const candidates = [
    text,
    ...text.split(':').slice(1).map((part) => part.trim()).filter(Boolean),
  ];
  return candidates.some((candidate) => matchesSensitiveContextPath(candidate, normalizedPatterns));
}

function matchesSensitiveContextPath(
  text: string,
  normalizedPatterns: readonly string[],
): boolean {
  const filename = text.split('/').filter(Boolean).at(-1) ?? text;
  return normalizedPatterns.some((rawPattern) => {
    const pattern = rawPattern.trim();
    if (!pattern) return false;
    if (pattern.endsWith('/')) {
      return text === pattern.slice(0, -1)
        || text.includes(pattern)
        || text.includes(`/${pattern}`);
    }
    if (pattern.startsWith('.')) {
      return filename === pattern
        || filename.startsWith(`${pattern}.`)
        || text.includes(`/${pattern}`)
        || text.includes(`/${pattern}.`);
    }
    return filename === pattern
      || filename.includes(pattern)
      || text.includes(`/${pattern}`)
      || text.includes(`/${pattern}/`);
  });
}

export function sanitizeSensitiveContextText(
  text: string,
  patterns: readonly string[] = CONTEXT_POLICY_SENSITIVE_PATH_PATTERNS_DEFAULT,
): string {
  if (!text.trim()) return text;
  return text
    .split('\n')
    .filter((line) => !lineContainsSensitivePath(line, patterns))
    .join('\n');
}

export function lineContainsSensitivePath(
  line: string,
  patterns: readonly string[] = CONTEXT_POLICY_SENSITIVE_PATH_PATTERNS_DEFAULT,
): boolean {
  const tokens = line
    .replace(/[`'"*()[\]{}<>]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  return tokens.some((token) => isSensitiveContextPath(token, patterns));
}
