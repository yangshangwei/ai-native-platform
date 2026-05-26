# Review and fix current code

## Goal

Run a Trellis/code review pass over the current `feature/acp` worktree, fix any concrete findings, and verify the result with the project's test suite.

## Scope

- Review the current ACP runner integration and nearby backend contract changes.
- Include untracked skill/research directories in the worktree state assessment, but do not rewrite unrelated generated content unless the review finds a concrete defect.
- Preserve current public behavior unless a review finding proves a bug.

## Acceptance Criteria

- Trellis/code-review checks are run and findings are recorded in the session.
- Concrete review findings are fixed with scoped changes.
- `bun run typecheck` passes.
- `bun run test` passes, or any failure is explained with a concrete blocker.
- Final report lists changed files, simplifications/fixes made, and remaining risks.

## Review Result

- Finding fixed: ACP `session/new.additionalDirectories` exposed extra read roots to ACP agents, but `fs/read_text_file` authorization only allowed workspace/artifacts. The fix makes additional directories read-authorized while keeping write authorization limited to workspace/artifacts.
- Regression tests added for reading an additional directory and rejecting writes to that read-only additional directory.
- Verification:
  - `bun run typecheck`
  - `bun x --bun vitest run apps/runner/test/acp-backend.test.ts`
  - `bun x --bun vitest run apps/runner/test/acp-backend.test.ts apps/runner/test/coordinator-llm-fallback.test.ts apps/runner/test/claude-code-backend.test.ts apps/runner/test/codex-backend.test.ts`
  - `bun run test`
