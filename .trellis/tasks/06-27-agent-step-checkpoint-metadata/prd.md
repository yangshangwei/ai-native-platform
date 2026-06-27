# Agent Step Checkpoint Metadata

## Goal

Implement R2 from the Agent Runtime roadmap: add a durable, queryable step checkpoint read model for workflow steps, starting with agent/runtime metadata that already exists in the platform evidence graph.

The MVP must preserve current sequential flow behavior. It should not introduce a graph runtime, branch/join execution, resume execution, or new gate authority. The checkpoint is an audit/read model that links each step to inputs, ContextPack, AgentSession, ToolInvocation, GateRun, retry index, and failure reason.

## Source Documents

- `docs/2026-06-27-agent-runtime-requirements.md`
- `docs/2026-06-27-agent-runtime-architecture-design.md`
- `docs/2026-06-27-agent-runtime-development-tasks.md`
- `docs/2026-06-27-agent-runtime-red-green-test-plan.md`
- `.trellis/spec/api/backend/database.md`
- `.trellis/spec/runner/backend/flow-registry.md`
- `.trellis/spec/shared/backend/context-injection-protocol.md`
- `.trellis/spec/shared/backend/evidence-verifier-protocol.md`

## Requirements

1. Define shared `StepCheckpoint` types and guards that can express:
   - workflowRunId, stepRunId, stage, status.
   - inputArtifactIds.
   - contextPackId.
   - agentSessionIds.
   - toolInvocationIds.
   - gateRunIds.
   - retryIndex.
   - resumeCursor.
   - failureReason.
   - createdAt / updatedAt.
2. Add API persistence and read models for step checkpoints, including `GET /workflow-runs/:id/step-checkpoints`.
3. Keep legacy runs safe: a run without checkpoint rows returns an empty list.
4. Runner must record checkpoint metadata for agent-producing steps without changing dispatch order or status authority.
5. Checkpoints must be updated from existing evidence events where possible:
   - AgentSession start/finish links session ids and contextPackId.
   - ToolInvocation links tool ids to stepRunId.
   - GateRun links gate ids to stepRunId.
   - Step finish records pass/fail status and failure reason when available.
6. Completion report / workflow summary should expose checkpoint metadata as diagnostic evidence, not as a source of pass/fail truth.

## Acceptance Criteria

- [x] Shared tests cover StepCheckpoint type shape, status guard, and legacy-safe optional fields.
- [x] API migration/store/route tests prove valid checkpoints are persisted and returned by workflow run.
- [x] API route tests prove old runs with no checkpoint rows return an empty list.
- [x] Runner tests prove an agent step records a checkpoint with contextPackId, AgentSession id, output/input artifact refs, and retry index.
- [x] Runner/API tests prove ToolInvocation and GateRun ids are linked to checkpoint metadata by stepRunId.
- [x] Failure-path tests prove failed step metadata records failureReason without changing Gate Engine authority.
- [x] Completion report or workflow summary tests prove checkpoint metadata appears in structured diagnostic output.
- [x] `bun test packages/shared/test apps/api/test apps/runner/test` passes for touched surfaces.
- [x] `bun run eval` still passes.
- [x] `bun run eval -- --scenario-dir eval/scenarios-red` still exits 1.
- [x] `bun run typecheck` passes.

## Out of Scope

- Replacing the sequential orchestrator with a graph runtime.
- Retrying or resuming a run from checkpoints.
- Branch/join execution.
- Letting checkpoint status decide WorkflowRun or GateRun status.
- UI redesign beyond existing read/report surfaces.

## Technical Notes

- Prefer additive table + read model mirroring AgentSession / ToolInvocation / Handoff patterns.
- Workflow Engine and Gate Engine remain authoritative.
- Runner should write or update checkpoints through runner event ingress/API client; avoid direct DB access from runner.
- If multiple records touch one step, the store should upsert/merge deterministically instead of creating duplicate checkpoints for the same `stepRunId`.
- Use nullable fields for forward compatibility with engine-only steps and old data.

## Definition of Done

- R2 Durable Step Checkpoint has a shared contract, API store/read route, runner writes, and tests.
- The task is validated, committed, archived, and journaled without staging unrelated dirty Trellis files.
