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
