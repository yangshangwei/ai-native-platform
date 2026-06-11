# Business Flow End-to-End Audit and Hardening

## Goal

Run the AI Native Platform delivery workflow as a real end-to-end business process, from requirements through architecture/design, implementation, verification, browser/UI validation, and final completion evidence. If the process exposes broken or mismatched behavior, fix the issue in the smallest scope that makes the requested full workflow true.

## What I already know

- The user asked to run the complete process from requirements to final architecture, development, and verification, and to use Playwright/browser tooling where useful.
- The current branch is `feat/context-injection-layer-mvp`; the working tree was clean before this task started.
- The platform's documented user workflow is: project onboarding -> task creation -> Coordinator triage -> Smart Router -> Runner watch/orchestrate -> staged workflow -> report and knowledge closure.
- The documented full feature flow is `context_pack -> requirement -> design -> implementation -> build_test -> review -> completion -> knowledge`.
- Existing verification scripts cover two different surfaces:
  - `bun run e2e`: direct Runner orchestration with auto-approved human gates.
  - `bun run scripts/e2e-via-watch.ts`: WorkflowRequest queue plus Runner `watch --once`, closer to Web task submission.
- The branch already contains a Context Injection Layer implementation and archived PRD with all full-loop acceptance boxes checked, but this task must re-verify against current state rather than trusting archived intent.
- The current app is cross-layer: shared protocol types, runner context builder/renderer/request parsing, API governance/report routes, and Web task/detail/context-governance views.

## Assumptions

- The sample project under `examples/java-maven-sample` remains the canonical full-lifecycle fixture.
- Local commands may depend on Bun, Git, JDK, Maven, and configured Claude Code/Codex CLI. Failures must be classified as product defects vs environment/setup blockers.
- Browser validation should focus on the real Web UI paths that prove a user can inspect and drive the workflow, not only static screenshots.
- No new dependency should be added for this task.

## Requirements

1. Preserve the Trellis workflow record for this work: PRD, architecture/design notes, implementation/check context, verification evidence, spec-update judgment, and commit plan.
2. Reconstruct the current architecture from code and docs before changing code.
3. Verify the current core contracts with automated checks:
   - TypeScript typecheck for shared/api/runner/web.
   - Unit/integration tests, at least the relevant context, flow, API, runner, and Web suites; full `bun test` when feasible.
   - Direct full-lifecycle smoke (`bun run e2e`) when environment allows.
   - Queue/watch lifecycle smoke (`bun run scripts/e2e-via-watch.ts`) when environment allows.
4. Start the API/Web dev servers and use Playwright/browser validation for the UI path where possible:
   - Workbench loads without a blank screen.
   - Project/task/report/knowledge/settings navigation remains usable.
   - Task detail and Context Governance surfaces do not visually break at desktop and mobile widths.
5. If verification finds product-side failures, fix them with scoped changes following the existing architecture and specs.
6. Do not mask environment failures as product success. Record exact commands, error evidence, and a practical fallback/next step when an external dependency blocks a runtime smoke.

## Acceptance Criteria

- [ ] PRD exists for this task and captures the full requested scope.
- [ ] `info.md` records the current architecture/design and validation plan.
- [ ] `implement.jsonl` and `check.jsonl` contain curated spec/research context entries, not only the seed row.
- [ ] Any code changes are tied to a concrete failure discovered by the end-to-end audit.
- [ ] `bun run typecheck` passes, or any failure is fixed/classified with evidence.
- [ ] Relevant tests pass; full `bun test` is run when feasible.
- [ ] Full-lifecycle direct smoke is attempted and either passes or has a classified blocker with run/command evidence.
- [ ] WorkflowRequest/watch smoke is attempted and either passes or has a classified blocker with request/run/command evidence.
- [ ] Browser/Playwright validation is run against the local Web UI, with screenshots or concrete observations recorded.
- [ ] Final report states which end-to-end business paths are green, degraded, blocked, or fixed.

## Out of Scope

- Replacing the workflow engine or adding new workflow stages.
- Introducing a new frontend framework or test framework.
- Adding Docker/K8s/microVM sandboxing.
- Making external Claude Code/Codex account availability a product requirement for this task; unavailable credentials should be classified separately.
- Broad UI redesign unrelated to the end-to-end workflow proof.

## Technical Notes

- Primary docs:
  - `README.md`
  - `docs/2026-05-06-end-to-end-business-flow.md`
  - `docs/2026-05-06-ui-end-to-end-operations.md`
  - `docs/2026-05-09-ai-native-platform-project-lifecycle-context-injection-design.md`
  - `docs/2026-05-09-ai-native-platform-project-lifecycle-context-injection-execution.md`
- Primary code surfaces:
  - `packages/shared/src/types/context.ts`
  - `apps/runner/src/context/*`
  - `apps/runner/src/orchestrator.ts`
  - `apps/api/src/context-governance.ts`
  - `apps/api/src/routes/*`
  - `apps/web/src/main.ts`
  - `apps/web/src/projection.ts`
  - `scripts/e2e.ts`
  - `scripts/e2e-via-watch.ts`
- Research map: `research/current-business-flow-map.md`.

## Definition of Done

- The current business process has been exercised from durable requirements/design through implementation/fix, automated verification, and browser validation.
- Any product defects found in scope have been fixed and re-verified.
- Remaining risks are explicit and evidence-backed.
- Trellis Phase 3 steps are completed: final check, spec update judgment, commit plan, and wrap-up note.
