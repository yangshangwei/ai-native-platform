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
