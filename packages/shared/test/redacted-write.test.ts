import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { redactBuffer, writeRedactedFile } from '../src/node/redacted-write';
import { maskSecrets } from '../src/utils/redaction';

function tmpPath(name: string): string {
  return join(mkdtempSync(join(tmpdir(), 'ainp-redact-')), name);
}

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

// One case per pattern in `maskSecrets`. These are what a real command line or
// failure trace looks like, not bare tokens — the point is that redaction
// survives being embedded in surrounding output.
const CREDENTIAL_CASES: Array<{ label: string; raw: string; leaked: string }> = [
  { label: 'openai key', raw: 'calling with sk-abcdef1234567890abcdef12\n', leaked: 'sk-abcdef1234567890abcdef12' },
  { label: 'github token', raw: 'remote: ghp_AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH01\n', leaked: 'ghp_AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH01' },
  { label: 'bearer header', raw: 'curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload"\n', leaked: 'eyJhbGciOiJIUzI1NiJ9.payload' },
  { label: 'assigned api_key', raw: 'deploying with api_key=super-secret-value\n', leaked: 'super-secret-value' },
  { label: 'assigned TOKEN uppercase', raw: 'export TOKEN=another-secret-value\n', leaked: 'another-secret-value' },
];

for (const { label, raw, leaked } of CREDENTIAL_CASES) {
  test(`writeRedactedFile keeps a ${label} off disk`, async () => {
    const path = tmpPath('output.log');
    const result = await writeRedactedFile(path, Buffer.from(raw, 'utf8'));
    const onDisk = readFileSync(path);

    expect(onDisk.toString('utf8')).not.toContain(leaked);
    // The digest must describe what landed, not what was handed in — this is
    // the invariant P1-1's `evidence.artifact_digests_match` depends on.
    expect(result.sha256).toBe(sha256(onDisk));
    expect(result.bytes).toBe(onDisk.byteLength);
  });
}

test('the reported digest matches a re-read of the file, credentials or not', async () => {
  const path = tmpPath('clean.log');
  const raw = Buffer.from('BUILD SUCCESS\nTotal time: 4.201 s\n', 'utf8');
  const result = await writeRedactedFile(path, raw);

  // Nothing to redact: bytes pass through and the digest still describes disk.
  expect(readFileSync(path).equals(raw)).toBe(true);
  expect(result.sha256).toBe(sha256(raw));
});

test('non-UTF-8 output is written byte-for-byte instead of being mangled', async () => {
  const path = tmpPath('binary.bin');
  // Lone continuation bytes: Node's decoder replaces these with U+FFFD rather
  // than throwing, so a naive decode/encode round-trip would corrupt them.
  const raw = Buffer.from([0x1b, 0x5b, 0x41, 0xff, 0xfe, 0x80, 0x00, 0x42]);

  const result = await writeRedactedFile(path, raw);
  const onDisk = readFileSync(path);

  expect(onDisk.equals(raw)).toBe(true);
  expect(result.sha256).toBe(sha256(raw));
});

test('redactBuffer returns the original buffer when there is nothing to mask', () => {
  const raw = Buffer.from('plain text with no credentials\n', 'utf8');
  expect(redactBuffer(raw)).toBe(raw);
});

/**
 * Known gap, deliberately pinned rather than fixed here.
 *
 * `maskSecrets`'s assignment patterns are anchored with `\b`. `--token=…` is
 * caught, because `-` is not a word character and so a boundary exists before
 * `token`. But `-Dapi_key=…` is not: `D` and `a` are both word characters, so
 * there is no boundary between them — and `-D` is the single most common way a
 * JVM build receives a secret.
 *
 * P1-3's scope is unifying the write boundary, explicitly NOT widening the
 * pattern set: changing both at once makes it impossible to tell which side a
 * regression came from. This test documents the hole so it is visible, and so
 * whoever widens the patterns sees a red test telling them to update it.
 */
test('KNOWN GAP: a secret glued to a -D flag is not redacted', async () => {
  const path = tmpPath('maven.log');
  const raw = 'mvn deploy -Dapi_key=super-secret-value --token=caught-by-contrast\n';
  await writeRedactedFile(path, Buffer.from(raw, 'utf8'));

  const onDisk = readFileSync(path).toString('utf8');
  expect(onDisk).toContain('super-secret-value');
  // The dash-separated form IS covered, which is what makes the gap specific
  // to letter-adjacent prefixes rather than to flags in general.
  expect(onDisk).not.toContain('caught-by-contrast');
});

/**
 * The gap's exact boundary, measured rather than reasoned about.
 *
 * Two independent causes, worth separating because they need different fixes:
 *  - a letter-adjacent prefix (`-D`) eats the `\b` the patterns rely on
 *  - the assignment patterns accept `:` and `=`, but not a space
 *
 * Whoever widens the patterns should make this table all-`masked` and delete
 * the KNOWN GAP test above.
 */
test('KNOWN GAP: exactly which credential shapes leak', () => {
  const leaks = [
    '-Dapi_key=leaked', // letter-adjacent prefix
    '-Dtoken=leaked', // same
    '-token leaked', // space-separated assignment
  ];
  const covered = [
    '--token=safe', // `-` is not a word char, so the boundary survives
    '--api-key=safe',
    '-D api_key=safe', // `-D` standing alone leaves `api_key` boundary-intact
    'api_key=safe',
    'TOKEN=safe',
  ];

  for (const input of leaks) {
    expect(maskSecrets(input), `expected ${input} to still leak`).toContain('leaked');
  }
  for (const input of covered) {
    expect(maskSecrets(input), `expected ${input} to be masked`).not.toContain('safe');
  }
});
