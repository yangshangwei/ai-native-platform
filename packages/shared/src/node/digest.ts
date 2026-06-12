import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export type DigestVerification =
  | { algorithm: 'sha256'; expected: string; actual: string; verified: boolean }
  | { algorithm: 'sha256'; expected: null; actual: string; verified: null };

export function sha256Buffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function sha256File(path: string): string {
  return sha256Buffer(readFileSync(path));
}

export function verifyFileSha256(path: string, expected?: string | null): DigestVerification {
  const actual = sha256File(path);
  if (!expected) return { algorithm: 'sha256', expected: null, actual, verified: null };
  return { algorithm: 'sha256', expected, actual, verified: actual === expected };
}

/**
 * Combined-stream digest contract for `CommandRun.combinedSha256`
 * (see `types/command.ts`): the digest covers stdout and stderr bytes with
 * NUL-delimited stream labels, i.e.
 * `sha256("stdout\0" + <stdout bytes> + "\0stderr\0" + <stderr bytes>)`.
 * The separators keep the stream boundary unambiguous, so ("ab", "") never
 * collides with ("a", "b"). Do not change this layout without a migration
 * plan for previously recorded digests.
 */
export function sha256CombinedStreams(stdout: Buffer, stderr: Buffer): string {
  return createHash('sha256')
    .update('stdout\0')
    .update(stdout)
    .update('\0stderr\0')
    .update(stderr)
    .digest('hex');
}
