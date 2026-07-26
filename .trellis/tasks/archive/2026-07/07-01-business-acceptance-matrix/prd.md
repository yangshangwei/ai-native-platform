# Business Acceptance Matrix

## Goal

Upgrade acceptance from "build/test command passed" to a business acceptance matrix: Acceptance Gate should evaluate requirement ACs, design verification strategy, persisted execution evidence, and explicit human risk decisions. `mvn test` / project test commands remain required engineering evidence, but they are no longer sufficient to prove business acceptance by themselves.

## Why

The current workflow has a strong build/test evidence base, but acceptance is too coarse. A passing `mvn test` proves the configured test suite ran successfully; it does not prove the suite covers the requested core behavior, boundary cases, and exceptional paths. This lets vague requirements such as "acceptance is mvn test passes" slip through without an AC-by-AC proof surface.

## What I Already Know

- Build/test currently runs real local commands and records command evidence; this must stay.
- `acceptance_gate` currently checks requirement/design/diff/review presence and latest `test_gate=pass`.
- `evidence_gate` already validates digest-backed evidence and has UI-specific verifier matrix rules.
- Shared types already define `VerifierAcMatrix` and `VerifierAcceptanceCriterionEvidence` in `packages/shared/src/types/artifact.ts`.
- Runner already has `executeVerifier()` that can write `verifier-ac-matrix.json`, but it is currently UI-triggered and media-focused.
- Web already renders an acceptance checklist from requirement ACs, design coverage, compile/test gates, and acceptance approval; it does not yet consume a generic persisted acceptance matrix as the source of truth.
- Completion reports currently emphasize command/gate evidence; they need an AC-by-AC business acceptance section.

## Current Gaps

- Acceptance matrix is not a general per-run artifact required for normal acceptance.
- Existing verifier status values are `pass | fail | blocked`; the product acceptance vocabulary needs `passed | missing | at_risk | failed` or an explicit mapping.
- Existing matrix rows lack business scenario classification such as `core`, `boundary`, `exception`, `regression`.
- Requirement/design gates check for AC presence and test strategy, but do not strongly reject "AC = mvn test passes" when no business scenario is stated.
- Acceptance Gate does not verify every AC has specific evidence.
- Human risk acceptance is not tied to individual missing/partial AC evidence.
- UI acceptance checklist is projection-derived, not persisted matrix-derived.
- E2E coverage does not prove that `mvn test` alone is insufficient for acceptance.

## Requirements

### R1. Shared Acceptance Matrix Contract

- Define or extend a shared acceptance matrix shape that represents AC-by-AC business verification.
- Each criterion row must include:
  - AC id.
  - Business description.
  - Scenario type: `core`, `boundary`, `exception`, or `regression`.
  - Verification method.
  - Evidence refs.
  - Status.
  - Optional risk note / risk acceptance marker.
- Preserve compatibility with the existing verifier matrix where possible instead of inventing an unrelated schema.

### R2. Requirement and Design Gate Tightening

- Requirement output must contain structured `AC-###` criteria with business meaning, not only a command.
- Design output must map each AC to a verification strategy.
- Gate rules must detect and fail materially vague ACs such as "mvn test passes" when no behavior, boundary, or exception scenario is described.
- The system should encourage coverage of core, boundary, and exception scenarios for feature work.

### R3. Generic Verifier Matrix Artifact

- Before acceptance, runner must produce or collect a persisted verifier/acceptance matrix artifact for flows that have AC-bearing requirement/design artifacts.
- The matrix must read from requirement/design/diff/command/test/UI evidence already present in the run.
- `mvn test` can satisfy a row only when the row explains which business behavior that command/test evidence proves.
- UI media verifier evidence remains supported but becomes one evidence source, not the only verifier use case.

### R4. Acceptance Gate Uses Matrix

- `acceptance_gate` must require the matrix when the flow has AC-bearing requirement/design artifacts.
- `test_gate=pass` remains necessary for code changes with test commands, but it is not sufficient.
- Gate passes only when all required AC rows are proven or explicitly accepted as risk according to the workflow rules.
- Missing AC evidence fails acceptance.
- Partial evidence may be surfaced as risk, but must require explicit human acknowledgement before completion can proceed.

### R5. Workbench Acceptance UI

- The task detail acceptance panel must show the persisted matrix when available.
- Each row must display AC id, scenario type, status, verification method, evidence links/labels, and risk text.
- Rejecting acceptance should be understandable in terms of specific missing or failed ACs.
- Existing projection-derived checklist can remain as fallback for legacy runs.

### R6. Completion Report

- Completion report markdown and structured JSON sidecar must include a business acceptance matrix section.
- The report must cite the same persisted matrix and evidence refs used by the gate.
- The report must make clear which ACs passed, which were accepted at risk, and which blocked acceptance.

### R7. Regression and E2E Coverage

- Add focused unit/integration tests for matrix parsing, gate decisions, UI projection, and report generation.
- Add an E2E or deterministic harness fixture for a business-shaped request such as a captcha toggle:
  - Core: disabling captcha means login no longer requires captcha.
  - Boundary: enabling captcha still requires captcha.
  - Exception: invalid config falls back to a safe default.
- Verify that a run with passing build/test command evidence but missing AC matrix evidence cannot pass acceptance.

## MVP Scope

The first implementation slice should deliver the smallest complete correctness loop:

1. Extend the shared matrix row contract with scenario type, verification method, business status, and risk fields while remaining compatible with `VerifierAcMatrix`.
2. Make runner produce a generic matrix artifact for AC-bearing feature runs before `acceptance_gate`.
3. Make `acceptance_gate` require and evaluate that matrix for feature runs.
4. Make Web acceptance panel prefer the persisted matrix.
5. Add tests proving `test_gate=pass` alone does not pass acceptance.

## Later Scope

- Richer automatic inference from individual test names and API/UI evidence.
- Per-AC risk acceptance UI.
- Dedicated workflow stage name for verifier instead of review sub-stage.
- Better report drill-down with direct artifact/log viewers for each evidence ref.
- Non-feature flow adaptation for issue/refactor work that lacks formal AC artifacts.

## Out of Scope

- Removing Maven or project build/test commands.
- Adding new runtime dependencies.
- Replacing the existing gate engine authority model.
- Making agents directly decide gate status.
- Full sandbox/isolation redesign for command execution.

## Acceptance Criteria

- [x] AC-001: Shared types expose a business acceptance matrix row shape with AC id, scenario type, verification method, evidence refs, status, and risk fields.
- [x] AC-002: Requirement/design validation rejects or warns on command-only acceptance criteria that do not state business behavior.
- [x] AC-003: Feature runs with formal ACs produce a persisted matrix artifact before acceptance.
- [x] AC-004: `acceptance_gate` fails when `test_gate=pass` exists but required AC matrix evidence is missing.
- [x] AC-005: `acceptance_gate` passes when all AC rows are proven by matrix evidence and existing traceability/build/test evidence is present.
- [x] AC-006: Workbench acceptance panel shows matrix rows, status, scenario type, verification method, evidence, and risk text.
- [x] AC-007: Completion report includes the business acceptance matrix in markdown and structured JSON outputs.
- [x] AC-008: Tests cover core, boundary, and exception-style AC rows and the "mvn test alone is insufficient" regression.

## Technical Notes

- Relevant existing types: `VerifierAcMatrix`, `VerifierAcceptanceCriterionEvidence`, `VerifierStatus`, `VerifierEvidenceRef`.
- Relevant runner code: `executeVerifier()` and `executeAcceptance()` in `apps/runner/src/orchestrator/steps.ts`.
- Relevant API code: `runAcceptanceGate()`, `runEvidenceGate()`, and verifier matrix parsing helpers in `apps/api/src/gate-engine.ts`.
- Relevant Web code: `buildAcceptanceChecklist()` in `apps/web/src/projection.ts` and `renderAcceptancePanel()` in `apps/web/src/page-task-detail.ts`.
- Relevant report code: `apps/api/src/reports.ts`.
- Relevant spec: `.trellis/spec/shared/backend/evidence-verifier-protocol.md`.

## Definition of Done

- Tests added or updated for shared/API/runner/web behavior touched by the change.
- `bun run typecheck` passes.
- Focused relevant tests pass.
- If E2E is run, use an isolated environment for `AINP_HOME`, `AINP_DB_PATH`, `AINP_ARTIFACTS_DIR`, `AINP_REPORTS_DIR`, and `AINP_PROJECTS_DIR` under the same temp root.
- Specs updated if the evidence/verifier protocol changes.
