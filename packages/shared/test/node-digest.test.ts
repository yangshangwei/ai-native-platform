import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sha256Buffer, sha256CombinedStreams, sha256File, verifyFileSha256 } from '../src/node/digest';

describe('sha256Buffer', () => {
  it('hashes bytes to lowercase hex sha-256', () => {
    const expected = createHash('sha256').update('hello').digest('hex');
    expect(sha256Buffer(Buffer.from('hello'))).toBe(expected);
    expect(sha256Buffer(Buffer.alloc(0))).toBe(createHash('sha256').digest('hex'));
  });
});

describe('sha256File / verifyFileSha256', () => {
  it('hashes file contents and verifies expected digests', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ainp-digest-'));
    const path = join(dir, 'artifact.txt');
    writeFileSync(path, 'artifact-bytes', 'utf8');
    const actual = sha256Buffer(Buffer.from('artifact-bytes'));

    expect(sha256File(path)).toBe(actual);
    expect(verifyFileSha256(path, actual))
      .toEqual({ algorithm: 'sha256', expected: actual, actual, verified: true });
    expect(verifyFileSha256(path, 'deadbeef'))
      .toEqual({ algorithm: 'sha256', expected: 'deadbeef', actual, verified: false });
  });

  it('reports verified=null when no expected digest is provided', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ainp-digest-'));
    const path = join(dir, 'legacy.txt');
    writeFileSync(path, 'legacy', 'utf8');
    const actual = sha256Buffer(Buffer.from('legacy'));

    expect(verifyFileSha256(path)).toEqual({ algorithm: 'sha256', expected: null, actual, verified: null });
    expect(verifyFileSha256(path, null)).toEqual({ algorithm: 'sha256', expected: null, actual, verified: null });
  });
});

describe('sha256CombinedStreams', () => {
  it('matches the documented stdout\\0 … \\0stderr\\0 separator layout', () => {
    const stdout = Buffer.from('out-bytes');
    const stderr = Buffer.from('err-bytes');
    const manual = createHash('sha256')
      .update('stdout\0')
      .update(stdout)
      .update('\0stderr\0')
      .update(stderr)
      .digest('hex');

    expect(sha256CombinedStreams(stdout, stderr)).toBe(manual);
  });

  it('keeps the stream boundary unambiguous via the separators', () => {
    expect(sha256CombinedStreams(Buffer.from('ab'), Buffer.alloc(0)))
      .not.toBe(sha256CombinedStreams(Buffer.from('a'), Buffer.from('b')));
    expect(sha256CombinedStreams(Buffer.from('ab'), Buffer.alloc(0)))
      .not.toBe(sha256Buffer(Buffer.from('ab')));
  });
});
