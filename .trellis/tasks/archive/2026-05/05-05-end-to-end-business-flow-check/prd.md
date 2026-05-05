# Validate end-to-end business flow

## Goal

Validate the current AI Native Platform end-to-end business flow from the real user entry paths that exist today, confirm which paths are green, and identify any broken steps or contract mismatches in the lifecycle.

## What I Already Know

- The product goal is a closed loop from request to completion report and knowledge candidate.
- The documented 9-stage lifecycle is `init → context_pack → requirement → design → implementation → build_test → review → completion → knowledge`.
- `bun run e2e` is an existing full-lifecycle smoke that starts `runner orchestrate`, auto-approves the four human gates, and asserts workflow steps, gates, artifacts, commands, agent audit rows, completion report, and knowledge candidate.
- `bun run smoke` is an existing narrower smoke that covers project registration, worktree preparation, `mvn -B test`, and persisted command/build status.
- Normal Web usage is API-managed: the UI calls `/runner/control/start`, and the API supervises `runner watch` for request-queue processing.
- The Web-facing path is distinct from direct CLI orchestration, so validating only `bun run e2e` is not enough to prove the full current business flow exposed to users.

## Assumptions (Temporary)

- Local dependencies needed for execution are available or failures will make the gaps explicit: Bun, Git, Java, Maven, and one configured agent backend CLI.
- The sample project under `examples/java-maven-sample` is the intended end-to-end fixture.
- Endpoint-level validation of the Web/API-managed queue flow is sufficient even if a real browser pass is not run in this task.

## Open Questions

- Does the API-managed Runner control plus WorkflowRequest queue path complete successfully end to end, not just direct `runner orchestrate`?
- If failures appear, are they environment/setup gaps or product flow defects?

## Requirements

- Verify the direct full-lifecycle path using the existing scripted E2E smoke.
- Verify the API-managed Runner watch path that mirrors Web task submission more closely.
- Record concrete evidence for stage progression, approvals, gates, artifacts, and final run status.
- Distinguish environment blockers from product-flow defects.
- If a failure is clearly product-side and low-risk to fix within this session, fix it and re-run the affected validation.

## Acceptance Criteria

- [x] A direct full-lifecycle validation has been executed against the current codebase and its result is recorded. (`run_75dd25561a7a` passed via deterministic fake backend; `bun run e2e` real-backend attempts `run_6beb318c2ee7` / `run_340b2046742a` recorded as failed.)
- [x] A queue-based/API-managed validation has been executed against the current codebase and its result is recorded. (`wreq_5218be86ddc5` paused at `awaiting_clarification` with cause recorded.)
- [x] Any failure includes concrete reproduction evidence and a classification of likely root cause. (6 issues with run/wreq ids + reproduction commands in `research/e2e-validation-report.md`.)
- [ ] If a product defect is fixed, the affected flow is re-run and verified. — **Out of scope this task**: defects 4/5/6 filed as cs-issue reports under `codestable/issues/2026-05-05-*` for follow-up. Defects 1/2 are script-side and tracked as recommended follow-ups. Defect 3 is environment-side (Codex 403 insufficient balance), not platform.
- [x] The final report states which user-facing business flows are green, degraded, or blocked. (See `## Confirmed Green Path` and `## Issues Found` in the validation report.)

## Out of Scope

- Designing new workflow stages or changing product scope.
- Broad exploratory UI polish review unrelated to the core business flow.
- Non-local deployment validation.

## Technical Notes

- Relevant files inspected:
  - `README.md`
  - `scripts/e2e.ts`
  - `scripts/smoke.ts`
- Planned validation surfaces:
  - direct CLI orchestration path
  - API-managed Runner control path
  - WorkflowRequest queue path
- Relevant specs:
  - `.trellis/spec/api/backend/index.md`
  - `.trellis/spec/runner/backend/index.md`
  - `.trellis/spec/runner/backend/agent-backend-runtime.md`
  - `.trellis/spec/runner/backend/flow-registry.md`
  - `.trellis/spec/web/frontend/index.md`
  - `.trellis/spec/web/frontend/agent-backend-ui.md`
  - `.trellis/spec/guides/cross-layer-thinking-guide.md`
