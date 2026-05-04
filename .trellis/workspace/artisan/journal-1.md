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
