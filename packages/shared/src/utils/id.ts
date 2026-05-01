/**
 * Tiny URL-safe id. crypto.randomUUID is available on Node 18+ and Bun.
 * We strip dashes and shorten so logs/branch names stay readable.
 */
export function newId(prefix: string): string {
  const raw = (globalThis.crypto?.randomUUID?.() ?? fallbackUuid()).replace(/-/g, '');
  return `${prefix}_${raw.slice(0, 12)}`;
}

function fallbackUuid(): string {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Branch slug — lowercase, alnum + dashes, max 30 chars.
 * Empty input returns "task".
 */
export function slugify(input: string): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
  return cleaned || 'task';
}
