# Core Business Flow E2E

## Goal

Verify the full platform delivery lifecycle through the Codex backend path, from workflow request creation through context, gated stages, implementation, build/test, completion, knowledge candidate generation, and accepted knowledge persistence.

## Requirements

- Run the E2E in an isolated environment with `AINP_HOME`, `AINP_DB_PATH`, `AINP_ARTIFACTS_DIR`, `AINP_REPORTS_DIR`, and `AINP_PROJECTS_DIR` under the same temp root.
- Exercise the Codex backend selection path and confirm no Claude Code backend events or tasks are used.
- Verify a `feature.standard` run reaches completion for the Java calculator sample task.
- Verify compile/test gates pass and Maven test evidence is persisted.
- Verify completion and knowledge artifacts are produced and accepted knowledge is persisted.
- Record failed attempts and remaining risk when the real local Codex provider cannot complete a cloud call.

## Acceptance Criteria

- [x] E2E run uses the Codex backend path only.
- [x] Workflow stages pass through context, requirement, design, implementation, build/test, review, completion, and knowledge.
- [x] Compile and test commands pass with Maven evidence.
- [x] Human gates are approved by the harness and final run status is `passed`.
- [x] Artifacts include context packs, requirement/design outputs, implementation diff, surefire report, completion report, and knowledge candidate.
- [x] Accepted knowledge is persisted for later context use.
- [x] The report documents why a real Codex cloud run could not be completed in this environment.

## Evidence

- Test report: `.trellis/tasks/06-30-core-business-flow-e2e/test-report.md`
- Verification command also passed in the current workspace: `bun run test`
