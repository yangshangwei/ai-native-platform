import { writeFile } from 'node:fs/promises';
import { maskSecrets } from '../utils/redaction';
import { sha256Buffer } from './digest';

/**
 * The single boundary through which evidence reaches disk (08-09 P1-3).
 *
 * `maskSecrets` existed and was complete, but only agent-stream and
 * coordinator paths called it — command stdout/stderr and git diffs, the two
 * places credentials most often surface (`mvn -Dtoken=…`, a connection string
 * in a failure trace, a committed `.env` showing up in a diff), went to disk
 * verbatim.
 *
 * Redaction MUST happen before the digest is taken. `evidence.artifact_digests_match`
 * (P1-1) recomputes sha256 on read and fails the gate on any disagreement, so
 * writing raw bytes and hashing redacted ones — or vice versa — would report
 * every credential-bearing command as tampered evidence. Returning the digest
 * from the same call makes that ordering impossible to get wrong.
 */
export interface RedactedWriteResult {
  /** sha256 of the bytes actually on disk, i.e. post-redaction. */
  sha256: string;
  /** Byte length actually written, which may differ from the input. */
  bytes: number;
  /** The redacted bytes, so callers can hash combinations without re-reading. */
  content: Buffer;
}

/**
 * Redact `content`, write it to `path`, and return the digest of what landed.
 *
 * Binary-safe: content that is not valid UTF-8 is written through untouched
 * rather than mangled by a decode/encode round-trip. A tool emitting a
 * progress bar or a packed artifact should survive this path unchanged — and
 * such output cannot carry a `key = value` credential anyway.
 */
export async function writeRedactedFile(path: string, content: Buffer): Promise<RedactedWriteResult> {
  const redacted = redactBuffer(content);
  await writeFile(path, redacted);
  return { sha256: sha256Buffer(redacted), bytes: redacted.byteLength, content: redacted };
}

/**
 * Redact a buffer's text content, preserving non-UTF-8 input byte-for-byte.
 *
 * Node's UTF-8 decoder is lossy — it replaces invalid sequences with U+FFFD
 * rather than failing — so a decode/encode round-trip would silently corrupt
 * binary data. Re-encoding and comparing detects that case.
 */
export function redactBuffer(content: Buffer): Buffer {
  const text = content.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(content)) return content;
  const masked = maskSecrets(text);
  return masked === text ? content : Buffer.from(masked, 'utf8');
}
