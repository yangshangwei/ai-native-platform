# context management p4 stage handoff

## Goal

Implement the backend MVP for explicit stage handoff in the context management
pipeline. P4 should make the semantic transition from `requirement` to
`design` visible and consumable without adding UI in this task.

## What I already know

- P1 now persists per-invocation base and supplement `ContextPack` artifacts.
- P2 now writes stage start/finish checkpoints that can restore
  `RunCtx.inputs` and `RunCtx.inputArtifactIds`.
- P3 now supports `SkillSpec.inputPolicies` and prompt audit for input
  injection modes.
- The platform already has a bounded multi-agent `HandoffRecord`, but that
  record is role/session-oriented. P4 needs a stage semantic handoff that
  explains stage outputs to downstream stages.
- Existing routes already expose `/workflow-runs/:id/handoffs`, and the context
  governance read model can be extended without a new UI first.
- First chain to prove: `requirement.md` output from `requirement` stage should
  produce a handoff that `design` consumes before rendering.

## Requirements

### Backend MVP Scope

- Define a stage handoff shared contract or metadata contract with:
  - `workflowRunId`
  - `fromStage`
  - `toStage`
  - `summary`
  - `decisions`
  - `risks`
  - `openQuestions`
  - `producedArtifacts`
  - `createdAt`
- Record a handoff artifact/action when a stage completes.
- Preserve original artifacts as the source of truth. Handoff is a navigation
  and summary layer, not a replacement for `requirement.md`.
- Include produced artifact references with artifact key, artifact id, kind,
  and injection preference.
- Feed upstream stage handoff into downstream stage inputs or context candidate
  selection before agent invocation.
- Extend the context governance read model so `/workflow-runs/:id/context`
  can show stage handoffs alongside context packs, checkpoints, and
  context_request retry history.

### First Chain: requirement -> design

- When `requirement` stage finishes and posts `requirement.md`, create a
  stage handoff for `requirement -> design`.
- The handoff must include:
  - requirement summary
  - decisions or confirmed constraints when detectable
  - risks
  - open questions
  - `requirement.md` artifact id
  - recommended injection preference of `summary` or `reference`
- Before `design` stage invokes its agent, inject or expose the requirement
  handoff so the design prompt can prefer the semantic summary and artifact
  reference over full `requirement.md` body.

### Context Flow Panel Follow-up

- This backend task does not build UI.
- After P4 lands, the existing `context-flow-panel` task should visualize:
  - P1 context pack artifacts
  - P2 stage checkpoints
  - P3 input injection decisions
  - P4 stage handoffs
  - context_request base -> request -> supplement -> retry chains

## Acceptance Criteria

- [ ] A stage handoff contract exists in shared types or a documented metadata
      schema.
- [ ] Requirement stage finish creates a handoff artifact/action for
      `requirement -> design`.
- [ ] The handoff includes `summary`, `decisions`, `risks`,
      `openQuestions`, and `producedArtifacts`.
- [ ] `producedArtifacts` includes `requirement.md` and its artifact id.
- [ ] Design stage consumes the requirement handoff before agent invocation.
- [ ] Design prompt/context includes the handoff summary and artifact
      reference, not only raw `requirement.md`.
- [ ] Context governance read model exposes stage handoff records.
- [ ] Existing bounded multi-agent handoff behavior remains compatible.
- [ ] Unit tests cover handoff creation, design-stage consumption, and
      governance read model exposure.
- [ ] `bun run typecheck` and relevant tests pass.

## Out of Scope

- Web UI implementation for the context flow panel.
- P5 audit report UI polish.
- P7 hybrid retrieval, embeddings, BM25, or MCP resource gateway.
- Replacing the existing bounded multi-agent `HandoffRecord` table.
- Letting handoff records drive workflow status, gates, or approvals.
- LLM-based summarization service for handoff content.

## Technical Notes

- Prefer a small deterministic extractor for the MVP:
  - summary from first meaningful heading/paragraph of `requirement.md`
  - decisions from requirement bullet lines with confirmed/constraint keywords
  - risks/open questions from explicit sections when present
  - fallback to empty arrays rather than inventing facts
- Existing files likely involved:
  - `packages/shared/src/types/handoff.ts`
  - `apps/runner/src/orchestrator/steps.ts`
  - `apps/runner/src/orchestrator/types.ts`
  - `apps/runner/src/api-client.ts`
  - `apps/api/src/routes/runner-events.ts`
  - `apps/api/src/workflow-engine.ts`
  - `apps/api/src/context-governance.ts`
- Related docs:
  - `docs/2026-06-27-context-management-optimization-requirements.md`
  - `docs/2026-06-27-context-management-optimization-design.md`
  - `docs/2026-06-27-context-management-optimization-tasks.md`
  - `docs/2026-06-27-context-management-p4-stage-handoff-requirements.md`
  - `docs/2026-06-27-context-management-p4-stage-handoff-design.md`
  - `docs/2026-06-27-context-management-p4-stage-handoff-tasks.md`
