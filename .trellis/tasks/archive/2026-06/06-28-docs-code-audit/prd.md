# Audit and Update Docs Against Code

## Goal

Update the repository's current-facing documentation so it matches the implementation as of 2026-06-28.

## Scope

- Correct current entry points: `README.md`, `docs/README.md`, and `docs/user/requirement-workflow.md`.
- Correct the current architecture snapshot only if code evidence contradicts it.
- Correct nearby source comments that describe runnable documentation, such as `scripts/e2e.ts`.
- Do not rewrite historical discussion or handoff documents as if they were current docs; mark their relationship from the docs index instead.

## Acceptance Criteria

- README describes the current `feature.standard` flow as 8 dispatch stages, with `init` only as a run status placeholder.
- User guide reflects API-managed Runner startup as the normal Web path and manual `watch` as a fallback/debug path.
- Docs index points readers to the latest harness engineering note and does not claim all Markdown files are under 300 lines.
- API surface documentation distinguishes core endpoints from governance/debug endpoints added in code.
- Verification includes at least a targeted search for stale "9-stage" current-facing claims and a typecheck or equivalent syntax check.
