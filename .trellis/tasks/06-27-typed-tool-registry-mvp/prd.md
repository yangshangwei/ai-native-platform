# Typed Tool Registry MVP

## Goal

Implement Epic B from the Agent Runtime docs: add a typed ToolInvocation ledger for Runner-owned tools so command execution and diff capture are queryable, auditable, and linked to existing CommandRun / Artifact evidence without weakening whitelist or Gate Engine authority.

## Source Documents

- `docs/2026-06-27-agent-runtime-requirements.md`
- `docs/2026-06-27-agent-runtime-architecture-design.md`
- `docs/2026-06-27-agent-runtime-development-tasks.md`
- `docs/2026-06-27-agent-runtime-red-green-test-plan.md`

## Requirements

1. Define shared `ToolSpec` / `ToolInvocation` contracts, status guards, side-effect levels, permission tiers, argument digest, and result refs.
2. Persist ToolInvocation records through the API with an explicit migration and store/read model.
3. Runner command execution must create ToolInvocation records for compile/test command runs, preserving `runWhitelistedCommand()` as the hard command gate.
4. Denied non-whitelisted commands must be representable as ToolInvocation `denied` records without a CommandRun.
5. Implementation diff capture must produce a `runner.git_diff_capture` ToolInvocation pointing to the diff artifact, changed-files artifact/path metadata, and changed-file count.
6. API workflow-run detail must expose ToolInvocations alongside commands/gates/artifacts.
7. Web task detail must expose tool invocations in a readable folded section, including command/diff status and evidence refs.
8. ToolInvocation must not decide gate status; Gate Engine remains the only pass/warn/fail authority.

## Acceptance Criteria

- [x] Shared tests cover valid/invalid ToolInvocation status and tool ids.
- [x] API store/route tests cover recording ToolInvocation and listing by workflow run.
- [x] Runner tests prove compile/test command ToolInvocations point to CommandRun ids and digests.
- [x] Runner tests prove a denied command produces a denied ToolInvocation and no CommandRun.
- [x] Runner tests prove implementation diff capture creates `runner.git_diff_capture` with diff artifact evidence.
- [x] Web/projection tests or typecheck prove workflow detail can render ToolInvocations.
- [x] `bun run eval` still passes.
- [x] `bun run eval -- --scenario-dir eval/scenarios-red` still exits 1.
- [x] `bun test packages/shared/test apps/api/test apps/runner/test` passes for touched surfaces.
- [x] `bun run typecheck` passes.

## Out of Scope

- Backend-native LLM tool calls.
- Tool approval UI.
- Replacing CommandRun, Artifact, GateRun, or AgentSession with ToolInvocation.
- Changing command whitelist semantics.
- New gate authority or Evidence Gate rule rewrites beyond consuming existing evidence.

## Technical Notes

- ToolInvocation is an index over existing evidence, not the evidence itself.
- Runner must report ToolInvocation through API event ingress; it must not write the API DB directly.
- For command execution, `resultRefs` should include the CommandRun id and digest evidence when available.
- For denied command attempts, `permissionDecision='denied'`, `status='denied'`, `resultRefs=[]`, and no command is spawned.
- For diff capture, `argumentsDigest` should cover changed files / artifact paths rather than raw diff contents when practical.
- Web DTOs should derive from shared types.

## Definition of Done

- B1-B4 are implemented and covered by red/green tests.
- Relevant specs are updated with the ToolInvocation contract.
- Task is validated, committed, archived, and session-recorded without staging unrelated dirty Trellis files.
