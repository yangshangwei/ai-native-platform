/**
 * Best-effort redaction for CLI diagnostics that may include local API keys,
 * bearer tokens, or credential environment variables.
 */
export function maskSecrets(value: string): string {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-[redacted]')
    .replace(/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g, '$1_[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, 'Bearer [redacted]')
    .replace(
      /\b(api[_ -]?key|token|credential|secret)\s*[:=]\s*("[^"\s]+"|'[^'\s]+'|[^\s]+)/gi,
      '$1=[redacted]',
    )
    .replace(
      /\b([A-Z0-9_]*(?:API[_-]?KEY|TOKEN|CREDENTIAL|SECRET))\s*[:=]\s*("[^"\s]+"|'[^'\s]+'|[^\s]+)/g,
      '$1=[redacted]',
    );
}
