# fix: Claude Code local connection and premature implementation failure

## Goal

New workflow requests should begin in the expected planning/requirements path unless the user explicitly accepts a router skip, and Claude Code runtime execution should use the machine's working local Claude Code connection by default. The observed failure is confusing because the UI shows a task failing at code implementation before requirements/design ran, and the Claude Code log says `Not logged in` even though local Claude Code is already usable.

## What I already know

* The screenshot shows a short Chinese feature request: `登录页面 加个开关 可以关闭验证码`.
* The workflow UI reports `当前阶段: 代码实现` and highlights `skill.implementation` as failed while requirement/design cards are still waiting.
* The Claude Code event log shows the runner invoked `claude` in implementation stage and received `Not logged in · Please run /login`.
* `apps/api/src/router.ts` currently routes short feature titles to `feature.fastforward`, which intentionally starts at `implementation`.
* `apps/api/src/router.ts` also allows accepted design knowledge to set `startStage = 'implementation'` for `feature.standard`.
* `apps/runner/src/agents/claude-code.ts` currently creates a temporary HOME for every invocation unless `AINP_CLAUDE_NO_HOME_ISOLATION=1`, which hides the user's local Claude Code config/login.
* Recent commit `6d47e7c` introduced Claude Code HOME isolation to avoid hook/no-exit behavior, but this breaks users who rely on local Claude Code configuration rather than token-only auth.

## Requirements

* R1. For feature requests created through the normal server auto-pick path, short titles must not automatically skip to `feature.fastforward`.
* R2. Smart router may still recommend skip/fast-forward information for preview, but creating a run without an explicit `flowId` should default to the full `feature.standard` feature lifecycle.
* R3. Start-stage skipping based on accepted design/requirement knowledge must not silently apply to ordinary run creation unless the caller explicitly passes `startStage`.
* R4. Claude Code runtime must default to the local user environment so the existing local Claude Code connection/config is visible.
* R5. Claude Code HOME isolation must remain available as an explicit opt-in environment flag for debugging or hook-isolation scenarios.
* R6. Regression tests must cover both the no-premature-implementation routing behavior and local Claude Code HOME inheritance.

## Acceptance Criteria

* [ ] Creating a feature workflow run without `flowId` for a short title produces `flowId = 'feature.standard'` and `startStage = null`.
* [ ] Creating a feature workflow run without `flowId` when matching accepted design knowledge exists still starts from the full lifecycle unless `startStage` is explicitly supplied.
* [ ] `/router/recommend` can continue to return preview recommendations; explicit `flowId` / `startStage` request bodies still win.
* [ ] ClaudeCodeBackend invocation does not override `HOME` by default.
* [ ] Setting `AINP_CLAUDE_HOME_ISOLATION=1` makes ClaudeCodeBackend use an isolated temporary HOME.
* [ ] Lint/typecheck and targeted tests pass.

## Out of Scope

* Rebuilding the whole UI routing recommendation UX.
* Removing `feature.fastforward` as a supported explicit flow.
* Changing Claude Code preflight semantics in this task.
* Adding new dependencies.

## Technical Notes

* Likely API files: `apps/api/src/workflow-engine.ts`, `apps/api/src/router.ts`, router/workflow-engine tests.
* Likely runner files: `apps/runner/src/agents/claude-code.ts`, Claude Code backend tests.
* Relevant specs: `.trellis/spec/api/backend/smart-router.md`, `.trellis/spec/api/backend/quality-guidelines.md`, `.trellis/spec/runner/backend/agent-backend-runtime.md`, `.trellis/spec/runner/backend/quality-guidelines.md`, `.trellis/spec/guides/code-reuse-thinking-guide.md`.
