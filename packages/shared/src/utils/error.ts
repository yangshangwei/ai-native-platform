/**
 * Canonical error-to-string formatting used across api / runner / web.
 * Replaces the ubiquitous `err instanceof Error ? err.message : String(err)`
 * ternary so catch blocks stay one expression.
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
