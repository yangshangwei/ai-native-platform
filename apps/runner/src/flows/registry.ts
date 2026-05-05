// V2 W2-4 PR1: FLOW_REGISTRY moved to `@ainp/shared/flows/registry` for
// cross-layer access (the smart-router in `apps/api/src/router.ts` consumes
// the same data the runner orchestrator does, without duplication or
// runner→api dependency inversion).
//
// This file is preserved as a thin re-export shim so existing imports
// (`from './flows/registry'` inside runner) keep working without churn.
// New code may import directly from `@ainp/shared`.
export { FLOW_REGISTRY } from '@ainp/shared';
