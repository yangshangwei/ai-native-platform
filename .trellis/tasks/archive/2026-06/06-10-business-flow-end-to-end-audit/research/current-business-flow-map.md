# Current Business Flow Map

## Sources inspected

- `README.md`
- `docs/2026-05-06-end-to-end-business-flow.md`
- `docs/2026-05-06-ui-end-to-end-operations.md`
- `docs/2026-05-09-ai-native-platform-project-lifecycle-context-injection-execution.md`
- Archived task `.trellis/tasks/archive/2026-06/05-09-context-injection-layer-mvp/`
- `scripts/e2e.ts`
- `scripts/e2e-via-watch.ts`
- `scripts/smoke.ts`
- `apps/runner/src/orchestrator.ts`
- `apps/web/src/main.ts`

## Business flow surfaces

### Direct orchestration smoke

`bun run e2e` requires an already-running API and drives `runner orchestrate` directly against `examples/java-maven-sample`. It auto-approves requirement, design, review/acceptance, and knowledge gates. It asserts the lifecycle reached core stages, gates passed, Maven compile/test command evidence exists, agent audit rows exist, completion report and knowledge candidate artifacts exist, and approvals were recorded.

This validates the core Runner/API workflow engine path, but not the Web-created WorkflowRequest queue or Coordinator triage path.

### WorkflowRequest/watch smoke

`bun run scripts/e2e-via-watch.ts` requires an already-running API and creates a WorkflowRequest through `/workflow-requests`. It runs `runner watch --once`, which exercises Coordinator triage, request claim, run creation, orchestration, auto-approval, and request completion. It asserts the Coordinator decision, run type parity, gates, tests, and key artifacts.

This is closer to user-facing Web task submission, but still bypasses manual browser interactions.

### Browser/UI path

The Web UI is a vanilla TypeScript SPA served by `apps/web/serve.ts` on port 5173, proxying `/api` to the API server. The expected user path is:

1. Project onboarding / backend configuration.
2. New task creation and recommendation preview.
3. Task detail lifecycle review and human gates.
4. Evidence/report/knowledge/context-governance inspection.
5. Settings and runner control when needed.

Browser validation should prove the app loads, navigation works, and important task/detail/governance surfaces are not blank or visually broken at desktop/mobile widths.

## Architecture checkpoints

- Workflow Engine remains the sole state writer; Runner emits events.
- Gate Engine decides gate pass/warn/fail; agents cannot self-certify success.
- Build/test evidence must come from real commands and persisted CommandRun/TestRun rows.
- Completion Report must cite persisted artifacts/gates/commands/actions.
- ContextPack governance spans shared types, runner builder/renderer, prompt audit lines, API read model, reports, and Web display.
- Repository content is untrusted data in prompts, not instructions.

## Likely verification commands

- `bun run typecheck`
- `bun test`
- Focused tests if failures narrow scope:
  - `bun x --bun vitest run packages/shared/test/context.test.ts`
  - `bun x --bun vitest run apps/runner/test/context-builder.test.ts apps/runner/test/context-renderer.test.ts apps/runner/test/context-request.test.ts apps/runner/test/context-retriever.test.ts`
  - `bun x --bun vitest run apps/api/test/context-governance-route.test.ts apps/api/test/report-sidecars.test.ts apps/api/test/workflow-actions.test.ts`
  - `bun x --bun vitest run apps/web/test/projection.test.ts apps/web/test/stream-rendering.test.ts apps/web/test/structured-projection.test.ts`
- Runtime smokes after API is running:
  - `bun run e2e`
  - `bun run scripts/e2e-via-watch.ts`
- Browser checks after API/Web are running:
  - Visit `http://127.0.0.1:5173/` with desktop and mobile viewports.
  - Validate no blank screen, no page-level horizontal overflow, and key navigation pages render.

## Risk classification rules

- Product defect: deterministic failure in repo code, route contract, projection, state transition, gate logic, or browser rendering.
- Environment blocker: missing Maven/JDK/Git/Bun, unavailable API server, unavailable backend CLI/auth, or external account balance/credential failure.
- Test harness defect: smoke script assertion no longer matches intentional product behavior while product evidence is otherwise valid.

## Findings from 2026-06-11 audit

### External runtime/auth blockers

- Codex backend direct e2e could not be accepted as product evidence: `codex login status` appeared logged in, but a runtime probe returned `401 Unauthorized`.
- Classification: environment blocker. The product should fail fast and surface this cleanly, but it does not prove the business workflow is broken when Claude Code is the configured real backend.

### Product defects fixed during audit

- Claude Code runner sessions were still able to invoke `Bash` and `Skill` despite old allowed-tools metadata. The runtime contract now passes both `--tools <stage-tools>` and `--allowed-tools <stage-tools>`, and explicitly denies `WebFetch,WebSearch,Bash,Skill`.
- Claude Code runner sessions can be affected by user-global hooks/plugins. The runtime now defaults to `--safe-mode` plus hook-emptying `--settings`, while preserving the user's auth/config environment.
- Produce-file stages pre-created empty artifact targets, which can make Claude Code's `Write` tool refuse to write because the target already exists. The runner now lets the backend create the artifact and validates existence/content after exit.
- Requirement and design gates were too brittle for real agent Markdown with numbered/bolded level-2 headings and explicit AC bullet lines. Gate parsing now tolerates those forms while still checking the same substantive sections.
- E2E harnesses were not explicit enough about the real project backend. Direct and watch scripts now use `AINP_E2E_AGENT_BACKEND` and configure the project backend instead of relying on a native/dry-run fallback.
- Maven Surefire reports needed to be persisted into run artifacts before the runner removed the worktree. Report collection now copies reports into durable artifact directories.
- Reports UI incorrectly treated only legacy `completed` runs as acceptable. The API currently marks successful workflow runs as `passed`, so reports now classify `passed` as `可验收`.
- Completion report summaries used a generic `Status:` label for a snapshot taken at report-generation time. They now label it `Status at report generation:` to avoid confusing it with the live workflow-row status.

## Notes from prior audit

Archived `05-05-end-to-end-business-flow-check` found that validating only direct orchestration was insufficient. This task must keep both direct and queue/watch paths in scope, and should add browser validation because the user explicitly allowed Playwright/browser use.
