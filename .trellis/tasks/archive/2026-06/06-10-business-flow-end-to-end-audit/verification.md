# Verification Evidence

## Runtime

- API: `http://127.0.0.1:8787`
- Web: `http://localhost:5173`
- Isolated runtime root: `.trellis/tasks/06-10-business-flow-end-to-end-audit/runtime/verify-2026-06-11/`
- Real backend used for accepted runtime smokes: Claude Code.

## Direct orchestration e2e

- Command: `AINP_E2E_AGENT_BACKEND=claude_code bun run e2e`
- Final verified run after Claude tool-policy hardening: `run_de2104a71d0e`
- Result: passed, `stage=completion`
- Gates: requirement, design, diff scope, sensitive change, compile, test, acceptance, evidence, and knowledge all passed.
- Commands: 2 Maven commands, both passed.
- Tests: Maven Surefire `total=6 passed=6 failed=0`.
- Claude metadata showed `--safe-mode`, `--tools`, and `disallowedTools=["WebFetch","WebSearch","Bash","Skill"]`.

## Queue/watch e2e

- Command: `AINP_E2E_AGENT_BACKEND=claude_code bun run scripts/e2e-via-watch.ts`
- Final verified request: `wreq_36e54cc1faab`
- Final verified run: `run_d242dc83aeb6`
- Coordinator: `source=rules action=proceed confidence=0.71`
- Result: passed, request completed.
- Gates: requirement, design, diff scope, sensitive change, compile, test, acceptance, evidence, and knowledge all passed.
- Commands: 2 Maven commands, both passed.
- Tests: Maven Surefire `total=5 passed=5 failed=0`.
- Claude metadata showed `--safe-mode`, `--tools`, and `disallowedTools=["WebFetch","WebSearch","Bash","Skill"]` across context, requirement, design, implementation, and review stages.

## Browser validation

Playwright ran against the restarted API/web servers with the isolated task DB.

- Workbench desktop/mobile loaded and rendered nonblank.
- Projects, reports, knowledge, and settings pages rendered expected operational content.
- Task detail for `wreq_36e54cc1faab` rendered lifecycle, evidence, runner status, and backend details.
- Context governance panel expanded and showed `Context Manifest`, `Budget Decisions`, and `SourceRefs`.
- Reports page classified `passed` runs as `可验收` and showed a nonzero acceptable count.
- Final browser checks: 51 assertions, no console warnings/errors, no page errors, no bad HTTP responses, no failed requests except expected agent-stream teardown aborts, no horizontal overflow at desktop or mobile widths.

Screenshots saved under `browser-evidence/`:

- `workbench-desktop.png`
- `workbench-mobile.png`
- `projects-desktop.png`
- `reports-desktop.png`
- `knowledge-desktop.png`
- `settings-desktop.png`
- `task-detail-desktop.png`
- `task-detail-mobile.png`
- `task-context-expanded-desktop.png`
- `task-context-expanded-mobile.png`

## Automated checks

- `bun x --bun vitest run apps/runner/test/claude-code-backend.test.ts apps/runner/test/claude-code-backend-grace.test.ts` passed.
- `bun x --bun vitest run apps/api/test/requirement-gate-cs-req.test.ts apps/api/test/gate-engine.test.ts` passed.
- `bun x --bun vitest run apps/api/test/report-sidecars.test.ts apps/web/test/projection.test.ts` passed.
- `bun run typecheck` passed.
- `bun test` passed: `621 pass, 0 fail`.

## External blocker

Codex backend direct e2e was not accepted as product evidence because `codex login status` reported logged in while a runtime probe returned `401 Unauthorized`. This is classified as an external auth/runtime blocker, not an API/Runner product failure.
