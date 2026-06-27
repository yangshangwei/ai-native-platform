# Bounded Multi-agent Handoff MVP

## Goal

Implement Epic E from the Agent Runtime docs: make multi-agent collaboration explicit, bounded, auditable, and subordinate to the main workflow. Handoff children may produce review/debug evidence, but they must not mutate WorkflowRun status, bypass Gate Engine decisions, or silently adopt their own output.

## Source Documents

- `docs/2026-06-27-agent-runtime-requirements.md`
- `docs/2026-06-27-agent-runtime-architecture-design.md`
- `docs/2026-06-27-agent-runtime-development-tasks.md`
- `docs/2026-06-27-agent-runtime-red-green-test-plan.md`
- `.trellis/spec/shared/backend/context-injection-protocol.md`
- `.trellis/spec/shared/backend/evidence-verifier-protocol.md`

## Requirements

1. Define a shared Handoff record with `fromRole`, `toRole`, `reason`, input artifact refs, expected output schema, stop condition, adoption decision, status, and parent/child AgentSession links.
2. Add API persistence and read models for handoffs, including `GET /workflow-runs/:id/handoffs`.
3. Reject malformed handoff writes at runner/API trust boundaries, especially missing input artifact refs or expected output schema.
4. Support independent reviewer handoff evidence after implementation/review paths without letting child output directly change WorkflowRun or GateRun status.
5. Support debugger handoff evidence for build/test failure paths as root-cause/fix-recommendation artifacts or report evidence, without auto-applying code changes.
6. Completion Report / workflow run summary must expose handoff records and adoption decisions.
7. Existing AgentSession trajectory must be able to link parent and child sessions for handoff children.

## Acceptance Criteria

- [x] Shared tests cover Handoff status/role/adoption guards and valid parent/child linkage fields.
- [x] API route tests prove valid handoffs are persisted and returned by workflow run.
- [x] API route tests prove missing input artifact refs or expected output schema are rejected.
- [x] API route tests prove child reviewer handoff cannot directly mutate WorkflowRun status.
- [ ] Runner tests prove independent review handoff creates a child AgentSession and review evidence artifact/report reference.
- [ ] Runner tests prove build/test failure debugger handoff creates analysis evidence without applying a fix or changing Gate Engine authority.
- [x] Completion report tests prove handoff evidence and adoption decisions appear in structured sidecar output.
- [x] `bun test packages/shared/test apps/api/test apps/runner/test` passes for touched surfaces.
- [x] `bun run eval` still passes.
- [x] `bun run eval -- --scenario-dir eval/scenarios-red` still exits 1.
- [x] `bun run typecheck` passes.

## Out of Scope

- Free-form multi-agent chat.
- Backend-native subagent orchestration as the platform control plane.
- Automatic adoption of child output.
- Direct child writes to WorkflowRun status, GateRun status, or accepted knowledge.
- Full UI workflow for handoff management beyond existing read/report surfaces.

## Technical Notes

- Prefer additive shared/API/store surfaces, mirroring AgentSession and ToolInvocation patterns.
- Handoff status should distinguish requested/running/completed/failed/cancelled and adopted/rejected review outcomes.
- Handoff children should link through AgentSession `parentSessionId` and an explicit handoff id/reference.
- Report and gate evidence may consume handoff output, but Gate Engine remains the only pass/warn/fail authority.

## Definition of Done

- E1-E3 are implemented or explicitly covered by focused tests.
- Specs are updated with the Handoff contract.
- Task is validated, committed, archived, and journaled without staging unrelated dirty Trellis files.
