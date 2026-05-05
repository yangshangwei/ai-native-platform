import type { FlowDef, FlowId } from '../types/workflow';

// ---------------------------------------------------------------------------
// V2 Wave 2 — FLOW_REGISTRY (cross-layer location).
//
// Originally lived at `apps/runner/src/flows/registry.ts` (W2-1 PR2).
// Moved here in W2-4 PR1 so the smart-router (server-side, in
// `apps/api/src/router.ts`) can consume the same data the runner
// orchestrator does — without forcing api to import from runner (apps
// shouldn't depend on each other) or duplicating stage-list constants.
//
// `apps/runner/src/flows/registry.ts` is preserved as a thin re-export
// shim so existing import paths (`from './flows/registry'` inside runner)
// keep working without churn.
//
// Adding a new flow recipe (canonical):
//   1. Add the new id to the `FlowId` literal union in `../types/workflow`.
//   2. Append an entry to `FLOW_REGISTRY` here.
//      `Readonly<Record<FlowId, FlowDef>>` exhaustiveness will trip
//      `tsc --noEmit` if you forget.
//   3. Update `dispatchStep` cases in `apps/runner/src/orchestrator.ts`
//      if the new flow introduces a `WorkflowStage` value not handled
//      yet. The default branch uses `_exhaustive: never` to enforce
//      coverage.
//   4. Update the trust-boundary `KNOWN_FLOW_IDS` lists in BOTH
//      `apps/api/src/routes/workflow-runs.ts` AND
//      `apps/runner/src/index.ts`. Without this step the API returns
//      400 and the CLI exits 2 even though the registry "knows" about
//      the flow.
//   5. Pin the new flow's stage order against an out-of-band reference
//      array in `apps/runner/test/flow-registry.test.ts`.
//   6. Update the spec doc `.trellis/spec/runner/backend/flow-registry.md`.
//   7. (W2-4 only) The router's per-flow estimate calculation iterates
//      `flow.stages` — no router code change required for new flows.
//
// References:
//   - Wave 2 roadmap: `.trellis/tasks/archive/2026-05/05-04-v2-wave2-workflow-polymorphism/prd.md`
//   - W2-4 PRD: `.trellis/tasks/05-05-v2-w2-4-smart-router/prd.md`
//   - Spec: `.trellis/spec/runner/backend/flow-registry.md`
// ---------------------------------------------------------------------------

/**
 * Standard 8-stage feature pipeline — a 1:1 lift of the V1 hard-coded flow.
 *
 * The stage order MUST match `runWorkflow()`'s dispatch order exactly:
 * `apps/runner/test/flow-registry.test.ts` enforces this against an
 * out-of-band reference array.
 *
 * `WorkflowStage` enum carries a 9th value `'init'` which is a *status*
 * placeholder (the value of `run.currentStage` between row creation and
 * the first stage transition); `'init'` is never dispatched, so it is not
 * a step in this flow. There is also no `'acceptance'` enum value: V1
 * folds human acceptance into `awaitHuman({ stage: 'review' })` immediately
 * after the review agent emits its artifact, so review carries the human
 * gate inline.
 */
const FEATURE_STANDARD: FlowDef = {
  id: 'feature.standard',
  kind: 'feature',
  description: 'Standard 8-stage feature pipeline (V1-equivalent; W2-1 baseline).',
  stages: [
    { stage: 'context_pack', kind: 'agent', skillId: 'context_pack' },
    { stage: 'requirement', kind: 'agent', skillId: 'cs-req' },
    { stage: 'design', kind: 'agent', skillId: 'cs-feat-design' },
    { stage: 'implementation', kind: 'agent', skillId: 'cs-feat-impl' },
    { stage: 'build_test', kind: 'engine' },
    { stage: 'review', kind: 'agent', skillId: 'cs-feat-accept' },
    { stage: 'completion', kind: 'engine' },
    { stage: 'knowledge', kind: 'engine' },
  ],
};

/**
 * Fast-forward feature pipeline — strict 4-stage subset of `feature.standard`,
 * for the V2 Wave 2 W2-3 "patch a semicolon shouldn't walk 9 stages" use case.
 *
 * Skips `context_pack` (heavy profile + knowledge load), `requirement` (no PRD
 * for fastforward), `design` (no design doc), and `knowledge` (small changes
 * rarely produce reusable knowledge). Keeps `review` because the V1 review
 * step still owns the human acceptance gate (`awaitHuman({ stage: 'review' })`
 * + `acceptance_gate` approval) — fastforward MUST NOT bypass human ack.
 * Keeps `completion` for the audit trail.
 *
 * The implementation skill running on a fastforward run won't have
 * `inputs['project_profile.md']` / `inputs['accepted_knowledge.md']` populated
 * (context_pack didn't run); the skill is expected to handle absent inputs
 * gracefully — `invokeSkill`'s `inputArtifactIds` mapping already filters
 * undefined entries via `.filter((id): id is string => Boolean(id))`.
 */
const FEATURE_FASTFORWARD: FlowDef = {
  id: 'feature.fastforward',
  kind: 'feature',
  description:
    'Fast-forward 4-stage feature pipeline — skips context_pack/requirement/design/knowledge; runs implementation -> build_test -> review (with human acceptance gate) -> completion. W2-3.',
  stages: [
    { stage: 'implementation', kind: 'agent', skillId: 'cs-feat-impl' },
    { stage: 'build_test', kind: 'engine' },
    { stage: 'review', kind: 'agent', skillId: 'cs-feat-accept' },
    { stage: 'completion', kind: 'engine' },
  ],
};

/**
 * Standard 6-stage issue/bug pipeline — V2 W2-2a.
 *
 * Ships as the second non-feature flow in FLOW_REGISTRY (W2-3 was the first
 * variant of feature; this is the first different `<work_kind>`). Skips
 * `context_pack` / `requirement` / `design` / `knowledge` (issue work has
 * no requirement/design artifact; report/analyze cover the front-end).
 * Reuses `implementation` for the fix step (semantically identical: agent →
 * diff artifact). The different prompt for "fix" vs "feature impl" is a
 * `skillId` concern handled by W2-4 routing; W2-2a leaves `skillId` as a
 * placeholder (PRD ADR Q1, Q4).
 *
 * Stages pinned by `apps/runner/test/flow-registry.test.ts` against an
 * out-of-band reference array (W2-2a PRD AC-7).
 *
 * `kind: 'bugfix'` reuses an existing WorkflowRunType that the Coordinator
 * (`apps/runner/src/agents/coordinator/rules.ts`) already routes bug-shaped
 * inputs to. The naming asymmetry (type='bugfix' vs flow='issue.standard')
 * is documented in `.trellis/spec/runner/backend/flow-registry.md` and is
 * deliberate — V2 § 4.2 calls this work "issue" but renaming the existing
 * 'bugfix' WorkflowRunType is out of scope (W2-2a PRD ADR Q2).
 */
const ISSUE_STANDARD: FlowDef = {
  id: 'issue.standard',
  kind: 'bugfix',
  description:
    'Standard 6-stage issue/bug pipeline (V2 W2-2a). Runs report -> analyze -> implementation (=fix) -> build_test -> review (with human acceptance gate) -> completion. Skips context_pack/requirement/design/knowledge.',
  stages: [
    { stage: 'report', kind: 'agent', skillId: 'cs-issue-report' },
    { stage: 'analyze', kind: 'agent', skillId: 'cs-issue-analyze' },
    { stage: 'implementation', kind: 'agent', skillId: 'cs-issue-fix' },
    { stage: 'build_test', kind: 'engine' },
    { stage: 'review', kind: 'agent', skillId: 'cs-feat-accept' },
    { stage: 'completion', kind: 'engine' },
  ],
};

/**
 * Standard 6-stage refactor pipeline — V2 W2-2b.
 *
 * Third non-feature flow in FLOW_REGISTRY (W2-2a was the second; this is the
 * first dedicated `'refactor'` work-kind). Skips `context_pack` / `requirement`
 * / `design` / `knowledge` (refactor work has no PRD; scan/plan cover the
 * front-end). Reuses `implementation` for the `apply` step (semantically
 * identical: agent → diff artifact). The different prompt for "refactor apply"
 * vs "feature impl" is a `skillId` concern handled by W2-4 routing.
 *
 * `'plan'` is a NEW WorkflowStage value (not a reuse of feature `'design'`).
 * Rationale (W2-2b PRD ADR Q1=B): feature `'design'` carries REQ-### / AC-###
 * tracing assumptions baked into `design_gate`, which would force a
 * stage-history-aware refactor of design_gate (mirroring W2-2a Q3 for
 * acceptance_gate but on a more complex 10-rule gate). Adding `'plan'` as a
 * separate stage keeps the change scoped and avoids touching design_gate.
 *
 * Stages pinned by `apps/runner/test/flow-registry.test.ts` against an
 * out-of-band reference array (W2-2b PRD AC-9).
 *
 * `kind: 'refactor'` extends WorkflowRunType (W2-2b PRD ADR Q2=A).
 * Coordinator does not currently produce 'refactor' routing — that's W2-4
 * router scope. Direct CLI / API explicit `flowId='refactor.standard'` is
 * the only entry point for now.
 */
const REFACTOR_STANDARD: FlowDef = {
  id: 'refactor.standard',
  kind: 'refactor',
  description:
    'Standard 6-stage refactor pipeline (V2 W2-2b). Runs scan -> plan -> implementation (=apply) -> build_test -> review (with human acceptance gate) -> completion. Skips context_pack/requirement/design/knowledge.',
  stages: [
    { stage: 'scan', kind: 'agent', skillId: 'cs-refactor-scan' },
    { stage: 'plan', kind: 'agent', skillId: 'cs-refactor-design' },
    { stage: 'implementation', kind: 'agent', skillId: 'cs-refactor-apply' },
    { stage: 'build_test', kind: 'engine' },
    { stage: 'review', kind: 'agent', skillId: 'cs-feat-accept' },
    { stage: 'completion', kind: 'engine' },
  ],
};

/**
 * Single source of truth for V2 flow definitions, keyed by {@link FlowId}.
 *
 * W2-1 shipped `'feature.standard'`. W2-3 adds `'feature.fastforward'`.
 * W2-2a adds `'issue.standard'`. W2-2b adds `'refactor.standard'`.
 * W2-4 (this PR) moves the registry to shared (cross-layer access) but
 * does NOT add new entries.
 *
 * Typed as `Readonly<Record<FlowId, FlowDef>>` so that:
 *   1. Adding a new FlowId literal in `../types/workflow` without
 *      registering it here trips `tsc --noEmit` (Record exhaustiveness).
 *   2. Runtime mutation is a type error (Readonly).
 */
export const FLOW_REGISTRY: Readonly<Record<FlowId, FlowDef>> = {
  'feature.standard': FEATURE_STANDARD,
  'feature.fastforward': FEATURE_FASTFORWARD,
  'issue.standard': ISSUE_STANDARD,
  'refactor.standard': REFACTOR_STANDARD,
};
