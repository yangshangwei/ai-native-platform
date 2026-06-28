# Memory Lifecycle and Stage Handoff Optimization Plan

## Goal

Close the gap between the current ContextPack / KnowledgeArtifact implementation and the intended three-layer memory model. The work should make memory scope, lifecycle, review state, usage, decay, and stage-to-stage semantic handoff explicit enough that downstream agents receive trustworthy context and operators can explain why a memory was selected, downgraded, queued for review, or ignored.

## What I Already Know

* Shared context types already define `KnowledgeReviewSignal` and `ContextPack.calibrationSignals`.
* Shared artifact metadata already includes `memoryKind`, `reviewStatus`, `supersedes`, `hitCount`, and `lastUsedAt`.
* Runner records selected knowledge usage through `/knowledge-artifacts/usage`, updating `hitCount` and `lastUsedAt`.
* Context builder already degrades possibly-stale or review-marked knowledge to evidence-only summary/historical context.
* Legacy accepted knowledge markdown is still collected from local project knowledge files, but `acceptedKnowledgeMarkdownForContext()` suppresses the blob when structured `KnowledgeArtifact` rows are available.
* Stage handoff is not missing entirely: `requirement -> design` is implemented through `StageHandoffMetadata`, `stage_handoff.requirement.design.md`, and `HandoffRecord.metadata.stageHandoff`.
* Existing implementation is intentionally non-destructive: calibration signals and review actions do not mutate accepted knowledge automatically.

## Current Gaps

* Memory lifecycle is partially modeled but not complete: there is no first-class `scope`, `decayPolicy`, `expiresAt`, `lastValidatedAt`, or lifecycle status that distinguishes candidate/current/stale/superseded/rejected across semantic, episodic, and procedural memory.
* `KnowledgeReviewSignal` is generated and recorded as workflow/knowledge actions, but there is no durable review queue with dedupe, assignment, status transitions, or SLA/ageing semantics.
* Decay/staleness is passive. The builder reacts to existing metadata, but no scheduled or explicit job evaluates time, code churn, supersession, gate failures, or conflicting evidence and marks review candidates.
* Legacy accepted markdown remains a compatibility source. It is suppressed when structured knowledge exists, but there is no migration/reporting path that tells operators which projects still depend on blob fallback.
* Stage handoff is path-specific. `requirement -> design` is wired, while `design -> implementation`, `implementation -> review`, and `review -> report` still rely more heavily on generic artifacts, input policies, and role handoffs.
* Retrieval ranking does not yet use memory lifecycle fields deeply enough. `hitCount`, `lastUsedAt`, review queue state, scope, and decay score should become explicit ranking factors.
* Procedural memory is only implicit in `SkillSpec`, prompts, tool policy, and specs. It is not represented as memory that can be scoped, versioned, reviewed, and selected.

## Requirements

* Define a memory lifecycle metadata contract that covers semantic, episodic, and procedural memory without replacing existing `KnowledgeArtifact` storage immediately.
* Keep all writes additive and legacy-safe.
* Preserve current non-destructive review behavior: automated jobs may create review candidates and lower trust in selection, but must not silently overwrite accepted knowledge.
* Add a durable review queue or equivalent first-class read/write model for conflict, stale, superseded, upgrade, and downgrade signals.
* Add deterministic decay/staleness evaluation with bounded inputs and auditable reasons.
* Keep ContextPack as the selection/rendering contract and add lifecycle fields to manifest/audit output where needed.
* Generalize stage handoff after `requirement -> design` using the existing `StageHandoffMetadata` pattern.
* Keep legacy accepted markdown as fallback only, while adding migration visibility and structured import paths.

## Acceptance Criteria

* [ ] A current accepted memory with no negative review state can be selected as authoritative/full context when relevant.
* [ ] A stale/conflict/superseded/downgrade memory is never injected as authoritative full context.
* [ ] A review signal creates or updates a durable review queue item with subject refs, evidence refs, recommended action, source ContextPack, and dedupe key.
* [ ] A decay/staleness job can mark review candidates deterministically without mutating memory content.
* [ ] `/workflow-runs/:id/context` exposes memory lifecycle and review queue evidence for selected knowledge.
* [ ] Projects using legacy accepted markdown fallback are detectable, and structured knowledge presence suppresses blob injection.
* [ ] `design -> implementation` and `implementation -> review` have structured handoff records or explicitly documented out-of-scope status.
* [ ] Tests cover metadata normalization, builder selection, review queue creation, decay evaluation, legacy fallback behavior, and generalized handoff consumption.

## Technical Approach

### Recommended Architecture

Use an additive Memory Lifecycle layer over current `KnowledgeArtifact` and `HandoffRecord` infrastructure.

1. Extend shared metadata normalization rather than introducing a new memory table first.
2. Add a `memory_review_items` table or equivalent store model for durable review workflow.
3. Add a deterministic `evaluateMemoryLifecycle()` service used by an API route/job and by tests.
4. Feed review queue state back into `buildContextPack()` as evidence-only selection policy.
5. Generalize stage handoff with a small registry of stage transitions and deterministic extractors.
6. Add governance surfaces before UI-heavy work: API/read model first, Web rendering second.

This path reuses current artifacts, context packs, knowledge usage updates, and handoff infrastructure while closing the missing lifecycle loop.

### Memory Metadata Additions

Candidate fields:

* `memoryScope`: `run | task | project | workspace | global`
* `memoryStatus`: `candidate | current | stale | superseded | rejected`
* `decayPolicy`: `none | time | code_churn | evidence_conflict | manual_review`
* `lastValidatedAt`: ISO timestamp or null
* `expiresAt`: ISO timestamp or null
* `decayReason`: short deterministic reason
* `supersededBy`: string array

Existing fields to preserve:

* `memoryKind`
* `reviewStatus`
* `supersedes`
* `hitCount`
* `lastUsedAt`
* `trustLevel`
* `freshness`
* `sourceRefs`
* `confidence`

### Review Queue Model

Suggested record:

```ts
type MemoryReviewItem = {
  id: string
  projectId: string
  workflowRunId?: string | null
  contextPackId?: string | null
  signalKind: 'conflict' | 'stale' | 'superseded' | 'upgrade_candidate' | 'downgrade_candidate'
  status: 'open' | 'accepted' | 'dismissed' | 'resolved'
  subjectRefs: string[]
  evidenceRefs: string[]
  recommendedAction: string
  reason: string
  dedupeKey: string
  createdAt: string
  updatedAt: string
  resolvedAt?: string | null
}
```

The runner should continue recording workflow actions for local run evidence, but API/store should also upsert durable review items for project-level follow-up.

### Decay and Staleness Evaluation

Inputs:

* memory metadata age and `lastValidatedAt`
* `lastUsedAt` / `hitCount`
* review queue state
* artifact status and supersession links
* code/source refs changed since last validation where available
* conflicting facts detected during ContextPack construction

Outputs:

* review item upsert
* metadata patch candidate
* ContextPack selection downgrade reason

No content overwrite should happen in this evaluator.

### Stage Handoff Generalization

Keep `StageHandoffMetadata` as the common schema and add transition-specific extractors:

* `requirement -> design`: already implemented
* `design -> implementation`: decisions, mounting points, acceptance contract, risks, produced `design.md`
* `implementation -> review`: changed files, produced diff/artifacts, known test status, risk notes
* `review -> report`: review findings, gate outcomes, unresolved risks, evidence refs

Do not make handoff own workflow state. It remains evidence/navigation only.

## Implementation Plan

### PR1: Memory Lifecycle Contract

* Extend shared memory metadata types and normalizers.
* Add validation for `memoryScope`, `memoryStatus`, `decayPolicy`, `lastValidatedAt`, `expiresAt`, `supersededBy`.
* Update tests in shared context/artifact coverage.
* Keep legacy rows additive-safe with defaults.

### PR2: Review Queue Persistence

* Add additive store/API support for durable memory review items.
* Upsert review queue items from runner-recorded `KnowledgeReviewSignal`.
* Add dedupe by project + signal kind + subject refs + normalized evidence refs.
* Add API tests for create/update/resolve and invalid payloads.

### PR3: Decay Evaluator

* Implement deterministic `evaluateMemoryLifecycle()` service.
* Add route or runner/admin entrypoint to evaluate one project.
* Generate review items for stale/superseded/conflict candidates.
* Do not mutate content or accepted status automatically.

### PR4: ContextPack Selection Integration

* Feed memory lifecycle metadata and review queue state into candidate scoring.
* Add explicit manifest fields/reasons for lifecycle downgrade.
* Use `hitCount`, `lastUsedAt`, review state, scope, freshness, and confidence as ranking factors.
* Extend context governance read model with lifecycle/review evidence.

### PR5: Legacy Accepted Knowledge Migration Visibility

* Add an audit/read model flag when legacy accepted markdown fallback is used.
* Add structured import helper for local accepted markdown into `KnowledgeArtifact` candidates.
* Keep fallback behavior for API-unavailable or pre-migration projects.
* Add tests proving structured artifacts suppress blob injection.

### PR6: Generalized Stage Handoff

* Add transition registry for stage handoffs.
* Implement `design -> implementation` first.
* Optionally add `implementation -> review` if it can reuse existing implementation/reviewer handoff context.
* Extend skill input policies for new handoff inputs.
* Add runner and governance tests.

### PR7: Web/Governance Polish

* Expose review queue and memory lifecycle status in existing context/knowledge panels.
* Keep UI read-only for first pass except explicit resolve/dismiss if API already supports it.
* Add projection tests for new DTO fields.

## Planning Review Addendum

Reviewed on 2026-06-28 against the current code, context-management docs, Agent Runtime docs, and Trellis specs.

### Current-State Corrections

* `requirement -> design` stage handoff is already implemented via `StageHandoffMetadata`, `stage_handoff.requirement.design.md`, `HandoffRecord.metadata.stageHandoff`, API governance parsing, and Web Context Flow projection. The generalized handoff work should extend this pattern rather than recreate it.
* Bounded reviewer/debugger handoffs also exist, but they are not the same as generalized `StageHandoffMetadata` transitions. `implementation -> review` can reuse their evidence and parent/child session references, but should be explicitly modeled if it joins the stage handoff registry.
* Memory lifecycle metadata currently covers `memoryKind`, `reviewStatus`, `supersedes`, `hitCount`, and `lastUsedAt`. The missing contract fields are additive deltas: `memoryScope`, `memoryStatus`, `decayPolicy`, `lastValidatedAt`, `expiresAt`, `decayReason`, and `supersededBy`.
* `KnowledgeReviewSignal` currently becomes a runner-recorded workflow/knowledge action. A durable project-level review queue is still missing and should be the authority for assignment, status, dedupe, SLA/ageing, and resolution history.
* Legacy accepted markdown fallback is already suppressed when structured `KnowledgeArtifact` rows are available. The missing work is visibility, reporting, and structured import, not changing the fallback priority.
* All writes must preserve existing harness boundaries: API Workflow Engine remains the state writer, Gate Engine remains the gate authority, Runner writes through API events, and handoff/memory review records remain evidence/governance data.

### Added Risks And Mitigations

* Metadata drift in freeform JSON could make selection policy ambiguous. Mitigate with shared literal catalogs, `is*()` guards, normalizers, API trust-boundary validation, and tests for invalid metadata rejection.
* Review queue noise or duplicate rows could overwhelm operators. Mitigate with deterministic dedupe keys, bounded signal generation, explicit status transitions, and idempotent upserts from the same ContextPack signal.
* Decay false positives could reduce useful accepted knowledge. Mitigate by creating review candidates and selection downgrade reasons only; do not overwrite content or accepted status automatically.
* Ranking changes could regress ContextPack relevance. Mitigate with red/yellow/green tests for conflict/stale/current memory, stable tie-breaking, and manifest assertions that prove why each lifecycle decision was made.
* Schema migration mistakes could break local SQLite installs. Mitigate through numbered migrations in `apps/api/src/store/db.ts`, takeover probes, migration tests for the new review queue table, and no import-time IO.
* Legacy accepted markdown import could duplicate or elevate stale facts. Mitigate by importing as candidate/review-needed structured artifacts with source refs, not as automatically accepted authoritative knowledge.
* Stage handoff generalization could become workflow control flow by accident. Mitigate by keeping handoffs evidence/navigation-only and asserting they do not set WorkflowRun, GateRun, approval, or acceptance state.
* Governance UI could become noisy or expose raw internals as primary user copy. Mitigate with read-only/collapsed diagnostic surfaces and projection tests before any write-capable UI.
* Full E2E verification can fail if project-profile artifacts are outside allowed roots. Run full E2E with `AINP_HOME`, `AINP_DB_PATH`, `AINP_ARTIFACTS_DIR`, `AINP_REPORTS_DIR`, and `AINP_PROJECTS_DIR` under one temp root.

### Acceptance Criteria Refinements

* Memory lifecycle contract:
  * Shared types and normalizers cover `memoryScope`, `memoryStatus`, `decayPolicy`, `lastValidatedAt`, `expiresAt`, `decayReason`, and `supersededBy` with legacy-safe defaults.
  * API validation rejects invalid lifecycle metadata before persistence and does not coerce unknown values into trusted states.
  * Existing `memoryKind`, `reviewStatus`, `supersedes`, `hitCount`, and `lastUsedAt` behavior remains backward-compatible.
* Review queue persistence:
  * A durable review item model exists with subject refs, evidence refs, recommended action, source ContextPack id/artifact id, dedupe key, status, assignment-ready fields, and resolution timestamps.
  * Replaying the same `KnowledgeReviewSignal` upserts the same queue item rather than creating duplicates.
  * Queue item creation does not mutate accepted knowledge content or status.
* Decay evaluator:
  * `evaluateMemoryLifecycle()` is deterministic for the same project snapshot and returns auditable reasons.
  * The evaluator can create/upsert review candidates for stale, superseded, conflict, expiry, or code-churn conditions without destructive knowledge mutation.
  * Tests cover at least one red path (`conflict` full injection forbidden), one yellow path (`possibly_stale` evidence-only), and one green path (current accepted memory selected).
* ContextPack selection integration:
  * Candidate scoring and downgrade logic use lifecycle metadata, review queue state, `hitCount`, `lastUsedAt`, scope, freshness, confidence, and source refs with stable ordering.
  * Manifest/audit output records lifecycle status, review item refs, decay reason, and downgrade reason where applicable.
  * `/workflow-runs/:id/context` exposes lifecycle/review evidence from persisted sources only.
* Legacy accepted knowledge migration visibility:
  * Operators can detect projects still using legacy accepted markdown fallback.
  * Structured `KnowledgeArtifact` presence continues to suppress blob injection.
  * Import helper creates structured candidates with source refs and review/default lifecycle metadata, not automatically accepted facts.
* Generalized stage handoff:
  * A transition registry or equivalent deterministic extractor model extends the existing `requirement -> design` pattern.
  * `design -> implementation` is implemented first with design decisions, mount points, acceptance contract, risks, open questions, and produced artifact refs.
  * `implementation -> review` either becomes a stage handoff using existing implementation/reviewer handoff evidence or is explicitly documented as deferred with tests proving existing bounded handoff behavior remains intact.
* Web/governance polish:
  * Read-only lifecycle/review/handoff projections render from API DTOs without adding a second read model.
  * Resolve/dismiss UI is added only if API status transitions already exist.
  * Web tests cover DTO projection and collapsed diagnostic behavior for new fields.

### Implementation Breakdown By Priority

1. Memory Lifecycle Contract
   * Extend shared lifecycle metadata types, literal guards, validation errors, and normalizers.
   * Add shared tests for defaults, invalid values, status-derived metadata, and legacy rows.
   * Update API write boundaries that persist `KnowledgeArtifact.metadata`.
2. Review Queue Persistence
   * Add numbered SQLite migration for `memory_review_items`.
   * Add store methods, engine/API mutation helpers, route/read model coverage, and idempotent dedupe.
   * Wire runner-recorded `KnowledgeReviewSignal` actions into durable review item upsert.
3. Decay Evaluator
   * Add a pure evaluator service that reads knowledge metadata, review items, supersession links, usage, source refs, and optional changed-source hints.
   * Return review item upserts, metadata patch candidates, and ContextPack downgrade reasons.
   * Add API/admin or runner entrypoint only after the pure evaluator is tested.
4. ContextPack Selection Integration
   * Feed lifecycle/review state into builder/retriever candidate scoring and degradation.
   * Extend `contextSelectionAudit()` and governance parsing with lifecycle/review fields.
   * Preserve cross-project filtering and sensitive path filtering.
5. Legacy Accepted Knowledge Migration Visibility
   * Add audit/read model flag for legacy fallback usage.
   * Add structured import helper for local accepted markdown into candidate `KnowledgeArtifact` rows.
   * Keep fallback only for API-unavailable or pre-migration projects.
6. Generalized Stage Handoff
   * Add transition registry around existing `StageHandoffMetadata`.
   * Implement `design -> implementation` extractor/renderer/consumption path.
   * Decide whether `implementation -> review` should be explicit `StageHandoffMetadata` or remain bounded reviewer handoff evidence for this task.
7. Web/Governance Polish
   * Surface lifecycle status, review queue state, legacy fallback flags, and stage handoff transitions in existing panels.
   * Keep write actions out of UI unless API status transitions are complete.

### Source Map For Implementation

Implementation agents should start from these code areas:

* Shared contracts: `packages/shared/src/types/artifact.ts`, `packages/shared/src/types/context.ts`, `packages/shared/src/types/handoff.ts`, `packages/shared/src/types/workflow.ts`.
* Runner context: `apps/runner/src/context/builder.ts`, `apps/runner/src/context/retriever.ts`, `apps/runner/src/context/renderer.ts`, `apps/runner/src/context/request.ts`.
* Runner orchestration: `apps/runner/src/orchestrator/invoke-skill.ts`, `apps/runner/src/orchestrator/stage-handoff.ts`, `apps/runner/src/orchestrator/steps.ts`, `apps/runner/src/knowledge.ts`.
* API persistence/governance: `apps/api/src/store/db.ts`, `apps/api/src/store/store.ts`, `apps/api/src/workflow-engine.ts`, `apps/api/src/routes/knowledge-artifacts.ts`, `apps/api/src/context-governance.ts`, `apps/api/src/reports.ts`.
* Web projections: `apps/web/src/projection.ts`, `apps/web/src/types.ts`, `apps/web/src/page-knowledge.ts`, `apps/web/src/page-task-detail.ts`.
* Existing tests to extend: `packages/shared/test/context.test.ts`, `packages/shared/test/handoff.test.ts`, `apps/runner/test/context-builder.test.ts`, `apps/runner/test/context-retriever.test.ts`, `apps/runner/test/orchestrator-invoke-skill.test.ts`, `apps/runner/test/stage-handoff.test.ts`, `apps/api/test/knowledge-artifacts-route.test.ts`, `apps/api/test/context-governance-route.test.ts`, `apps/api/test/workflow-runs-route.test.ts`, `apps/web/test/projection.test.ts`, `apps/web/test/context-flow-panel.test.ts`, `apps/web/test/page-knowledge.test.ts`.

### Verification Plan

* Run targeted shared/API/runner tests after each priority slice.
* Run `bun run typecheck` after cross-package type changes.
* Run `bun run eval` when ContextPack selection or red/yellow/green memory behavior changes.
* Use full `bun run e2e` only with all AINP paths under one isolated temp root as noted above.

## Out of Scope

* Replacing SQLite/artifact storage with a new vector database.
* LLM-generated handoff summaries.
* Automatic destructive overwrite of accepted knowledge.
* Full procedural memory authoring UI.
* Multi-tenant security redesign.

## Technical Notes

Inspected files:

* `packages/shared/src/types/context.ts`
* `packages/shared/src/types/artifact.ts`
* `packages/shared/src/types/handoff.ts`
* `apps/runner/src/context/builder.ts`
* `apps/runner/src/context/retriever.ts`
* `apps/runner/src/orchestrator/invoke-skill.ts`
* `apps/runner/src/orchestrator/stage-handoff.ts`
* `apps/runner/src/orchestrator/steps.ts`
* `apps/runner/src/knowledge.ts`
* `apps/api/src/routes/knowledge-artifacts.ts`
* `apps/api/src/context-governance.ts`
* `apps/api/src/router.ts`
* `.trellis/spec/shared/backend/context-injection-protocol.md`
* `docs/2026-06-27-context-management-architecture.md`
* `docs/2026-06-27-context-management-optimization-requirements.md`
* `docs/2026-06-27-context-management-optimization-design.md`
* `docs/2026-06-27-context-management-optimization-tasks.md`
* `docs/2026-06-27-context-management-p4-stage-handoff-design.md`
* `docs/2026-06-27-agent-orchestration-and-harness-improvement-plan.md`
* `docs/2026-06-27-agent-runtime-requirements.md`

## Planning Decision

Introduce `memory_review_items` immediately. `workflow_actions` remain per-run evidence for how a signal was observed, but review ownership, dedupe, assignment, SLA/ageing, and resolution are project-long-lived concerns and should not be coupled to a single workflow run.
