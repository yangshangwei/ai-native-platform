# Journal - artisan (Part 1)

> AI development session journal
> Started: 2026-05-03

---



## Session 1: PR4 settings polish + config_audit mirror + projection test

**Date**: 2026-05-04
**Task**: PR4 settings polish + config_audit mirror + projection test
**Branch**: `main`

### Summary

Implemented PR4 of the runtime-config-UI series inline (sub-agent service was throwing API 500 panics): (1) config_audit rows mirror to .omc/audit/config-YYYY-MM-DD.jsonl with fail-open semantics in store.ts; (2) extracted buildSettingsViewModel() to apps/web/src/settings-projection.ts with 10 vitest cases covering 24-key tab grouping, override application (scalar / array replace / default), dirty-state semantics (overrideCount stays accurate when key has both override + draft), and audit linkage; (3) styled ~150 lines of light-theme CSS for the existing .config-* class names in apps/web/index.html (no main.ts class-name churn). Spec doc at docs/superpowers/specs/2026-05-04-pr4-settings-polish-design.md; PRD Open Q3 marked RESOLVED + F1 followup (trellis-check on PR1/PR2) registered pending sub-agent service. 202 pass / 1 fail (pre-existing flaky workflow-requests test, unrelated). Commit 704cf51 contains 8 files / 954+/12-.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `704cf51` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 2: Close requirement-analysis stage design-impl gaps (P0-1/P0-2/P0-3 + P1-4/P1-5/P1-7)

**Date**: 2026-05-04
**Task**: Close requirement-analysis stage design-impl gaps (P0-1/P0-2/P0-3 + P1-4/P1-5/P1-7)
**Branch**: `main`

### Summary

Closed 6 gaps between docs/2026-05-03-requirements-phase-adaptation-plan.md design and current implementation in 4 atomic PRs. PR1 (api): POST /workflow-requests now accepts firstMessage and writes both inside db.transaction so the runner watch loop never races; PATCH /workflow-requests/:id/status enforces ALLOWED_TRANSITIONS with 409 on illegal moves. PR3 (runner): rewrote Coordinator LLM fallback with LlmFallbackDeps injection seam + codex one-shot via --output-last-message; selectionOrder picks the project's configured agentBackend first, falls back to the other CLI, degrades to pause_for_human only when both unavailable. PR2 (web): submitWorkflowRequest is a single call carrying firstMessage; new renderCoordinatorVerdictMetric exposes 'Coordinator 判定' next to 'Project 用户标记' with warn highlight on mismatch. PR4 (docs): requirement-workflow.md flow diagram + new chapter on awaiting_clarification; adaptation-plan.md gets a Closure table mapping each gap to its landing. Final check: bun test 221/221, bun run typecheck PASS for shared/api/runner/web.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `c36becc` | (see git log) |
| `d1dd5ab` | (see git log) |
| `b3d64dc` | (see git log) |
| `6cbc182` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 3: V2 P0-2 entity-tables-bootstrap: brainstorm + 6-PR series

**Date**: 2026-05-04
**Task**: V2 P0-2 entity-tables-bootstrap: brainstorm + 6-PR series
**Branch**: `main`

### Summary

V2 P0-2 entity tables bootstrap: brainstorm to PRD with 5 ADR-lite decisions (Q1=scope-alpha / Q2=head-pointer / Q3=hybrid-FK / Q4=no-backfill / Q5=API-side entity_id authority), then implemented across 6 PRs. PR1 added shared TS types (RequirementEntity / DesignEntity / PromoteRequest / PromoteResponse). PR2 added requirements + designs entity tables with composite PK (project_id, id) and composite FK designs(project_id, ref_req) -> requirements(project_id, id) ON DELETE RESTRICT, plus store CRUD with upsertHead. PR3 collapsed entity_id resolution + max+1 fallback + version bump + supersede + INSERT + UPSERT into a single db.transaction in apps/api/src/promote.ts; included a schema refinement that promoted the original draft's id-as-PK design to composite (project_id, id) after the inter-test pollution bug surfaced. PR4 exposed POST /knowledge-artifacts/promote with proper 400/409/500 error mapping. PR5 collapsed runner promoteAcceptedDraftToKnowledge from ~70 lines (algorithm) to ~25 lines (HTTP wrapper); PromoteDeps narrowed from 4 deps to 1; PR3 success log line preserved verbatim. PR6 promoted .trellis/spec/api/backend/database-guidelines.md from stub to real reference (FK convention rule, P0-2 upgrade semantics) and closed all 23 PRD acceptance criteria. Final: bun run --filter '*' typecheck PASS for shared/api/runner/web, bun test 296/296 pass, zero flake. V2 Wave 1 now 2/3 (artifact_kind expansion + entity tables done; dual-write pipeline still pending).

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `f2f97ed` | (see git log) |
| `c0275c4` | (see git log) |
| `5165060` | (see git log) |
| `c9ce155` | (see git log) |
| `50caaaa` | (see git log) |
| `683f8b9` | (see git log) |
| `3d01e93` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 4: V2 P1-1 dual-write-pipeline: brainstorm + 4-PR series

**Date**: 2026-05-04
**Task**: V2 P1-1 dual-write-pipeline: brainstorm + 4-PR series
**Branch**: `main`

### Summary

V2 P1-1 dual-write pipeline (DB + 文件): brainstorm to PRD with 6 ADR-lite decisions (Q1=scope-alpha REQ+DSN only / Q2=codestable layout / Q3=Stage-then-Finalize / Q4=no auto-commit / Q5=no drift scan / Q6=typed core + freeform extension frontmatter), then implemented across 4 PRs. PR1 added shared TS types (DualWriteEntityKind / EntityFileFrontmatter discriminated union / RenderEntityInput / StageEntityFileInput) and the pure renderEntityMarkdown function with stable-order frontmatter and ISO-8601 single-quoting; ENTITY_ID_PATTERN regex for path safety. PR2 added the IO layer: ensureCodestableDir (mkdir -p, fail-fast pre-tx), writeEntityFile (atomic via tmp+rename with random hex suffix), deleteEntityFile (compensating cleanup with ENOENT-as-success), plus path helpers resolveCodestableDir / resolveEntityFilePath. PR3 wired dual-write into promoteDraftInTransaction: function became async, pre-tx step looks up project.localPath + ensureCodestableDir, post-tx step renders frontmatter with FINAL values from the tx and writes to <localPath>/codestable/<kind-plural>/<entityId>.md; file write failure logs with knowledge_artifact_id but does not roll back DB (R10/R11). promote.test.ts rewritten to async with project row seeded in beforeAll; promote-route.test.ts also seeds project. PR4 promoted .trellis/spec/api/backend/database-guidelines.md with a dedicated dual-write section: file layout reference, frontmatter schema doc, Stage-then-Finalize protocol, 5-stage failure-semantics matrix, git working-tree note, race-window note, plus 2 new common-mistakes entries. Final: bun run --filter '*' typecheck PASS for shared/api/runner/web, bun test 333/333 pass, zero flake. V2 Wave 1 NOW COMPLETE (3/3): artifact_kind expansion + entity tables + dual-write pipeline all shipped.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `31a143e` | (see git log) |
| `4596462` | (see git log) |
| `950b450` | (see git log) |
| `72c07e4` | (see git log) |
| `217ce86` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 5: V2 Wave 2 roadmap brainstorm — workflow polymorphism + smart routing

**Date**: 2026-05-04
**Task**: V2 Wave 2 roadmap brainstorm — workflow polymorphism + smart routing
**Branch**: `main`

### Summary

V2 Wave 2 roadmap-only brainstorm (no code). 4 ADR-lite decisions pinned: Q1 Roadmap mode (global structural decisions only; 4 child tasks documented as slug + scope summaries rather than pre-created); Q2 FLOW_REGISTRY = TypeScript object literal at apps/runner/src/flows/registry.ts with FlowDef + StageStep typed shape; Q3 sub-project order W2-1 (FLOW_REGISTRY bootstrap, 1 wk) → W2-3 (fastforward, 1 wk) → W2-2 (issue + refactor, 2 wk) → W2-4 (smart router, 2 wk), total ~6 weeks; Q4 naming conventions FlowId = '<work_kind>.<variant>' (feature.standard / feature.fastforward / issue.standard / refactor.standard) with WorkflowStage enum kept as-is. PRD has R1-R15 + 5 AC + full Wave 2 roadmap section with 4 future-task descriptors and a dependency graph. References V2 design notes § 2.1 (工作类型多态) / § 3.2 (智能路由 - V2's second architectural pillar) / § 4.2 (first-stage scope = 3 work flows) / § 5 (Wave 2 estimates) / § 6 (forbidden zones — graphical editor avoidance). Workflow: brainstorm → start → commit (af2253d) → archive in one session, since the task is documentation-only. User creates each child task manually via task.py create when ready.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `af2253d` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 6: V2 W2-1 — FLOW_REGISTRY bootstrap shipped (4-PR series, 0 regression)

**Date**: 2026-05-05
**Task**: V2 W2-1 — FLOW_REGISTRY bootstrap shipped (4-PR series, 0 regression)
**Branch**: `main`

### Summary

Wave 2 keystone task W2-1 done end-to-end. PR1 = FlowId/FlowDef/StageStep shared types. PR2 = FLOW_REGISTRY with feature.standard FlowDef + 9-test stage-order pin. PR3 = workflow_runs.flow_id NOT NULL DEFAULT 'feature.standard' migration + WorkflowRun.flowId required field + createWorkflowRun.flowId? optional + runWorkflow refactored to drive iteration from FLOW_REGISTRY[run.flowId].stages via for-of + dispatchStep, with 5 V1 inline blocks (implementation/build_test/acceptance/completion/knowledge) extracted into executeXxx(ctx: RunCtx) inner functions. PR4 = .trellis/spec/runner/backend/flow-registry.md spec doc covering thin (Q1=alpha) semantics, 8-stage layout, flowId entry contract, executeXxx invariants, validation matrix, and W2-3+ extension recipe. Tests 352 pass / 0 fail (V1 baseline 340 + 9 PR2 + 3 PR3). typecheck 4/4 green. Behavior byte-for-byte equivalent to V1 (PRD ADR Q1 = alpha thin refactor).

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `a188ede` | (see git log) |
| `ac16371` | (see git log) |
| `a37815a` | (see git log) |
| `becfddf` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
