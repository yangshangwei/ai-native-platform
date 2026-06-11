import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { store } from '../store/store';

/** Uniform JSON error response: body is exactly `{ error: message }`. */
export function jsonError(c: Context, message: string, status: ContentfulStatusCode) {
  return c.json({ error: message }, status);
}

/**
 * 404 guard for `/:id` workflow-run routes. Returns the `{ error: 'not found' }`
 * response to send when the run does not exist, or null when it does.
 *
 * Usage: `const missing = requireWorkflowRun(c, id); if (missing) return missing;`
 */
export function requireWorkflowRun(c: Context, id: string) {
  return store.workflowRuns.has(id) ? null : jsonError(c, 'not found', 404);
}
