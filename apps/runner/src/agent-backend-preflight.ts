// Re-export shim: apps/runner/test/backend-selection.test.ts imports this
// path directly. The implementation lives in packages/shared/src/node/.
export { preflightAgentBackend } from '@ainp/shared/node';
