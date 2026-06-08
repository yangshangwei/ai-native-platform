import { createHash } from 'node:crypto';

export function sha256Buffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function sha256CombinedStreams(stdout: Buffer, stderr: Buffer): string {
  return createHash('sha256')
    .update('stdout\0')
    .update(stdout)
    .update('\0stderr\0')
    .update(stderr)
    .digest('hex');
}
