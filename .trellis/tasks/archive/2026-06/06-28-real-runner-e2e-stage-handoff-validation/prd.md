# real runner e2e stage handoff validation

## Goal

Run a real Agent Backend runner end-to-end workflow after P4 to prove the
`requirement -> design` stage handoff works in an actual orchestration path,
not only in unit and route tests.

## What I already know

* P4 implementation commit `be1933e` added `StageHandoffMetadata`,
  requirement-stage handoff persistence, design-stage handoff input policy, and
  context governance exposure.
* `scripts/e2e.ts` runs a full `feature.standard` workflow through the real
  runner and auto-approves human gates.
* `AINP_E2E_AGENT_BACKEND=codex bun run e2e` uses the Codex backend.
* `AINP_E2E_AGENT_BACKEND=claude_code bun run e2e` uses the Claude Code
  backend.
* The script verifies baseline lifecycle evidence, but this task must also
  inspect P4-specific evidence after the run.

## Requirements

* Use the real runner path, not fake backend fixtures.
* Start the API locally with isolated `AINP_DB_PATH` and `AINP_HOME` so the
  validation does not mutate the user's default runtime state.
* Run at least one real backend E2E path (`codex` first, because the project
  default E2E backend is Codex).
* If Claude Code is installed and authenticated, run the same path with
  `claude_code` as well; if it is not available, record the preflight result
  as a verification gap rather than blocking Codex validation.
* After each successful run, inspect persisted evidence for:
  * `HandoffRecord.metadata.stageHandoff.schemaVersion =
    'ainp.stage_handoff.v1'`
  * `stageHandoff.fromStage = 'requirement'`
  * `stageHandoff.toStage = 'design'`
  * `producedArtifacts` includes `requirement.md`
  * handoff Markdown artifact exists
  * design-stage prompt or input audit includes
    `stage_handoff.requirement.design.md`
  * `/workflow-runs/:id/context` exposes `stageHandoffs`

## Acceptance Criteria

* [x] Real runner E2E run completes with workflow status `passed` for at least
      one real backend.
* [x] P4 handoff evidence is present in stored handoff metadata and artifact
      records.
* [x] Design-stage invocation consumed the handoff input before agent
      execution.
* [x] Context governance read model exposes the stage handoff.
* [x] Any unavailable backend is documented with command output.
* [x] No product code changes are made unless the real E2E uncovers a defect
      that must be fixed.

## Definition of Done

* E2E command output and post-run evidence are inspected.
* Results are summarized in this task or the journal.
* Trellis task is archived after verification.

## Out of Scope

* Adding UI for context-flow-panel.
* Changing P4 behavior unless the live E2E exposes a real bug.
* Running destructive tests against the user's default production DB.

## Technical Notes

* Use `bun run dev:api` for the API server.
* Use `bun run e2e` with `AINP_E2E_AGENT_BACKEND` set.
* Relevant files:
  * `scripts/e2e.ts`
  * `apps/runner/src/orchestrator/steps.ts`
  * `apps/runner/src/orchestrator/stage-handoff.ts`
  * `apps/api/src/context-governance.ts`
  * `packages/shared/src/types/handoff.ts`

## Results

* Isolated API/HOME/DB: `AINP_API_PORT=8877`,
  `AINP_HOME=.tmp/e2e-stage-handoff/home`,
  `AINP_DB_PATH=.tmp/e2e-stage-handoff/ainp.sqlite`.
* Codex real backend run `run_b2291729048b` passed full lifecycle:
  6 steps, 2 commands, 14 gates, 17 artifacts, Maven tests `6/6`.
* Claude Code first run `run_49722bbfeef9` exposed a real `design_gate`
  false negative: Claude emitted numbered section headings with full-width
  translation parentheses, e.g. `## 1. 现状（Current State）`; the gate already
  intended to accept real-agent heading decorations but did not accept this
  shape.
* Fixed the gate matcher to accept equivalent heading translation punctuation
  while still requiring the exact Chinese section title, and added a regression
  test for the Claude Code heading shape.
* Claude Code rerun `run_4acdf25ced97` passed full lifecycle:
  6 steps, 2 commands, 14 gates, 17 artifacts, Maven tests `6/6`.
* P4 handoff evidence verified on both passing real backend runs:
  `stageHandoff.schemaVersion = ainp.stage_handoff.v1`,
  `fromStage=requirement`, `toStage=design`, `producedArtifacts` includes
  `requirement.md`, `stage_handoff.requirement.design.md` exists and is present
  in design-stage context packs, and `/workflow-runs/:id/context` exposes
  `stageHandoffs`.
* Verification:
  * `bun test apps/api/test/design-gate-cs-feat-design.test.ts` passed:
    9 pass, 0 fail.
  * `bun run typecheck` passed.
  * `bun test` passed: 865 pass, 0 fail.
