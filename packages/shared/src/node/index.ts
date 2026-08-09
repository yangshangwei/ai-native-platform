// Node-only shared helpers, exposed via the `@ainp/shared/node` subpath.
//
// RED LINE: nothing in this directory may be re-exported from `src/index.ts`.
// The main barrel is consumed by the web browser bundle and must stay free of
// `node:*` imports. `apps/web` must never import `@ainp/shared/node`.
export * from './agent-backend-preflight';
export * from './digest';
export * from './redacted-write';
