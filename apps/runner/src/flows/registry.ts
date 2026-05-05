import type { FlowDef, FlowId } from '@ainp/shared';

// ---------------------------------------------------------------------------
// V2 Wave 2 / W2-1 / PR2 — FLOW_REGISTRY (feature.standard)
//
// V1 hard-codes a single 8-stage feature pipeline directly inside
// `runWorkflow()` (`apps/runner/src/orchestrator.ts:99-318`). This module
// lifts that sequence into a declarative registry so future flow types
// (feature.fastforward, issue.standard, refactor.standard) can be added
// without forking the orchestrator.
//
// THIN refactor (PRD ADR Q1=α). `runWorkflow()` does NOT yet read this
// registry — it continues to dispatch stage-by-stage exactly as V1 did.
// PR3 of the same task (W2-1) refactors the orchestrator main loop to
// drive iteration from `FLOW_REGISTRY[run.flowId].stages`. Until then,
// this module exists solely as a forward-compatible declaration consumed
// by:
//   - the unit test in `apps/runner/test/flow-registry.test.ts`, which
//     pins the V1 stage order against an out-of-band reference array
//     (PRD AC-10 — V1 zero-regression invariant)
//   - subsequent PRs of W2-1 (PR3 wires it into runWorkflow; PR4 adds
//     spec doc at `.trellis/spec/runner/backend/...`).
//
// `StageStep.kind` and `StageStep.skillId` are populated for every step
// but **not yet read by `runWorkflow()`** in this PR. W2-3 onwards will
// begin consuming `kind` to drive a generic dispatcher and `skillId` to
// resolve agent skills via the existing `findSkillForStage` mechanism.
//
// References:
//   - PRD: `.trellis/tasks/05-04-v2-w2-1-flow-registry-bootstrap/prd.md`
//     (R4-R15, AC-7~AC-10, ADR Q1=α)
//   - Roadmap: `.trellis/tasks/archive/2026-05/05-04-v2-wave2-workflow-polymorphism/prd.md`
//   - V2 design notes § 2.1 (work-type polymorphism) + § 5
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
 * Single source of truth for V2 flow definitions, keyed by {@link FlowId}.
 *
 * W2-1 shipped `'feature.standard'`. W2-3 adds `'feature.fastforward'`.
 * W2-2a adds `'issue.standard'`. Subsequent Wave 2 tasks append entries:
 *   - `'refactor.standard'`   (W2-2b)
 *
 * Typed as `Readonly<Record<FlowId, FlowDef>>` so that:
 *   1. Adding a new FlowId literal in `@ainp/shared` without registering
 *      it here trips `tsc --noEmit` (Record exhaustiveness).
 *   2. Runtime mutation is a type error (Readonly).
 */
export const FLOW_REGISTRY: Readonly<Record<FlowId, FlowDef>> = {
  'feature.standard': FEATURE_STANDARD,
  'feature.fastforward': FEATURE_FASTFORWARD,
  'issue.standard': ISSUE_STANDARD,
};
