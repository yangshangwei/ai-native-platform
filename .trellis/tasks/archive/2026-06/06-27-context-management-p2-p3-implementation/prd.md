# context management p2 p3 implementation

## Goal

Implement the next context management milestones after P0/P1:

- P2: stage context checkpoints that can restore `RunCtx.inputs` and
  `RunCtx.inputArtifactIds`.
- P3: input injection policy so large upstream artifacts are no longer always
  injected in full.

## What I already know

- P0/P1 already calibrated docs and persisted per-invocation base/supplement
  `ContextPack` artifacts.
- `invokeSkill()` already supports one same-step supplement retry.
- Existing API `StepCheckpoint` rows are merged from step, agent session,
  tool invocation, gate, and result events.
- `StepCheckpoint.metadata` can carry additive context snapshots without a DB
  migration.
- `runStage()` and markdown stage helpers currently propagate outputs by
  writing artifact ids to `RunCtx.inputArtifactIds` and full text to
  `RunCtx.inputs`.
- `renderAgentPrompt()` currently iterates `inputs` and renders every non-user
  input artifact body as untrusted data unless it is sensitive-filtered.

## Requirements

### P2 Stage checkpoint

- Write a stage context checkpoint at stage start with:
  - phase `start`
  - `inputs`
  - `inputArtifactIds`
  - current context pack artifact ids if known
- Write/update the checkpoint at stage finish with:
  - phase `finish`
  - final `inputs`
  - final `inputArtifactIds`
  - produced artifact ids
  - context pack artifact ids
- Preserve existing `StepCheckpoint` fields and route responses.
- Provide a typed runner helper to restore `RunCtx.inputs` and
  `RunCtx.inputArtifactIds` from the latest checkpoint metadata.
- Add tests proving `requirement.md` artifact ids are captured and restore
  recreates the maps.

### P3 Input injection policy

- Add a shared `SkillInputInjectionPolicy` contract.
- Extend `SkillSpec` with optional `inputPolicies`.
- Add renderer support for `full`, `summary`, `reference`, and `omit`.
- Default policy must keep `user_request` full.
- Configure `requirement.md` for the design stage as summary/reference rather
  than full injection.
- Apply deterministic budget downgrade:
  - `full -> summary -> reference -> omit`
  - required inputs must never silently disappear; keep at least a reference
    and an audit warning.
- Add prompt audit data showing each input name, selected mode, source artifact
  id if known, and downgrade reason if any.

## Acceptance Criteria

- [ ] Stage start and finish checkpoint metadata includes `inputs` and
      `inputArtifactIds`.
- [ ] Requirement stage finish checkpoint includes `requirement.md` and its
      artifact id.
- [ ] A restore helper can rebuild `RunCtx.inputs` and
      `RunCtx.inputArtifactIds` from checkpoint metadata.
- [ ] Design-stage rendering summarizes `requirement.md` and includes an
      artifact reference instead of injecting the full body.
- [ ] Large optional inputs downgrade deterministically under budget pressure.
- [ ] Required inputs downgraded by budget keep at least a reference and emit
      an audit warning.
- [ ] Existing workflows remain compatible when a skill has no explicit input
      policies.
- [ ] Unit tests cover P2 checkpointing/restoration and P3 renderer policy.
- [ ] `bun run typecheck` and relevant tests pass.

## Out of Scope

- P4 explicit stage handoff.
- New DB tables or migrations.
- Historical run backfill.
- Vector search, BM25, embeddings, or MCP resource gateway.

## Technical Notes

- Use existing `StepCheckpoint.metadata` for `stageContext`.
- Do not replace existing `StepCheckpoint.inputArtifactIds` array; add richer
  named maps in metadata for context recovery.
- Keep prompt input artifacts labeled as untrusted data.
- Reuse existing sensitive path filtering.
- Related docs:
  - `docs/2026-06-27-context-management-optimization-tasks.md`
  - `docs/2026-06-27-context-management-optimization-design.md`
  - `docs/2026-06-27-context-management-architecture.md`
