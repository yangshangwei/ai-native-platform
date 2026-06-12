/**
 * API access — the single fetch wrapper for the backend.
 *
 * `API_BASE` is the dev-server proxy prefix (`/api`); `api()` wraps fetch
 * with JSON decoding and uniform error text. No DOM access, no global
 * state. Moved verbatim out of `main.ts` (T2.1 base-layer split).
 */

export const API_BASE = '/api';

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`api ${path}: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}
