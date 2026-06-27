# Context Management P4 Stage Handoff Task Breakdown

> Date: 2026-06-27  
> Scope: Backend MVP and planning handoff to Context Flow panel.

## Milestone P4-A: Contract and Spec

### A1. Define Stage Handoff Metadata

- Add shared type or documented metadata contract for
  `ainp.stage_handoff.v1`.
- Include produced artifact refs with `key`, `artifactId`, `kind`, and
  `injectionPreference`.
- Add type guards or metadata parsing helpers if the implementation stores the
  payload in `HandoffRecord.metadata`.

Acceptance:

- Typecheck catches invalid stage names and injection preferences.
- Existing `HandoffRecord` shape remains backward compatible.

### A2. Update Context Protocol Spec

- Document storage location.
- Document that stage handoff is evidence/navigation only.
- Document requirement -> design MVP behavior.

Acceptance:

- `.trellis/spec/shared/backend/context-injection-protocol.md` includes the
  P4 contract and tests required.

## Milestone P4-B: Runner Creation

### B1. Build Deterministic Handoff Extractor

- Parse requirement markdown into summary, decisions, risks, and open
  questions.
- Avoid inferred facts.
- Cap summary length.

Acceptance:

- Unit tests cover headings present, headings missing, and Chinese/English
  headings where practical.

### B2. Record Requirement -> Design Handoff

- After requirement stage persists `requirement.md`, create stage handoff.
- Persist via existing handoff event/API or direct runner dependency.
- Link produced artifact ids.

Acceptance:

- Runner test proves `recordHandoff` is called with
  `metadata.stageHandoff.schemaVersion='ainp.stage_handoff.v1'`.
- `requirement.md` artifact id appears in `producedArtifacts`.

## Milestone P4-C: Downstream Consumption

### C1. Render Handoff Markdown Input

- Convert `StageHandoffMetadata` to compact markdown.
- Add it to `RunCtx.inputs` under a stable key such as
  `stage_handoff.requirement.design.md`.

Acceptance:

- Design-stage `invokeSkill` receives this input.
- Existing `requirement.md` input remains available.

### C2. Add Input Policy for Handoff

- Configure design skill input policy for the handoff key.
- Keep `requirement.md` summary/reference policy.

Acceptance:

- Prompt renderer includes handoff content and artifact reference.
- Full requirement body is not required for the first handoff path.

## Milestone P4-D: API and Governance

### D1. Expose Stage Handoff in Context Governance

- Add `stageHandoffs` to `ContextGovernance`.
- Parse only valid `metadata.stageHandoff`.
- Preserve malformed records as ignored rather than synthetic data.

Acceptance:

- API test proves `/workflow-runs/:id/context` includes the handoff summary,
  stages, and produced artifact refs.

### D2. Preserve Existing Handoff Behavior

- Ensure bounded reviewer/debugger handoff routes/tests still pass.
- Do not change gate or workflow status semantics.

Acceptance:

- Existing handoff tests pass unchanged or with additive assertions only.

## Milestone P4-E: Context Flow Panel Follow-up

### E1. Update Context Flow Panel PRD

- Expand panel scope from simple artifact input/output flow to P1-P4 trace:
  context packs, checkpoints, handoffs, injection decisions, and retry chains.

Acceptance:

- `06-27-context-flow-panel/prd.md` states P4 dependency and visualization
  requirements.

### E2. Defer UI Implementation

- Keep UI implementation in the existing `context-flow-panel` task.
- Do not add web code in P4.

Acceptance:

- P4 implementation diff contains no Web UI changes unless required for shared
  DTO typing.

## Suggested Implementation Order

1. A1 shared contract.
2. B1 extractor.
3. B2 handoff recording in requirement stage.
4. C1 design-stage consumption.
5. C2 input policy.
6. D1 governance read model.
7. D2 regression tests.
8. E1 context-flow-panel PRD update.

## Verification Commands

Run targeted tests first:

```bash
bun x --bun vitest run \
  packages/shared/test/handoff.test.ts \
  apps/runner/test/orchestrator-run-stage.test.ts \
  apps/api/test/context-governance-route.test.ts \
  apps/api/test/workflow-runs-route.test.ts
```

Then run:

```bash
bun run typecheck
```

Full `bun run test` currently includes Bun-native shared contract files that
Vitest collects incorrectly, so report that known harness issue separately if
it remains.
