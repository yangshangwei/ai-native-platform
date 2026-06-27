# Checkpoint Gap Audit

## Current Evidence

The Agent Runtime roadmap has shipped most ledger pieces:

- `AgentSession`: shared type, API store/read route, runner `invokeSkill()` writes, retry/handoff parent links.
- `ToolInvocation`: shared type, API store/read route, runner command/diff/context supplement writes.
- `Handoff`: shared type, API store/read route, runner review/debugger handoff evidence, report sidecar.
- Eval harness: `context_pack_fixture`, `agent_backend_fixture`, and `workflow_fixture` exist with green and red scenarios.
- Memory lifecycle: context selection excludes stale/conflict/superseded authoritative memory.

## Remaining Gap

R2 in `docs/2026-06-27-agent-runtime-requirements.md` requires durable step checkpoint metadata:

- input artifact ids.
- contextPackId / agentSessionId.
- toolInvocationIds / gateIds.
- retry index, resume cursor, failure reason.

Search evidence shows no first-class `StepCheckpoint` shared type, table, store, route, or runner write path. Existing records can be correlated by `stepRunId`, but the platform has no queryable checkpoint envelope.

## MVP Shape

Implement a thin additive read model:

- one checkpoint row per `stepRunId` where possible.
- nullable fields for legacy and non-agent/engine steps.
- API event helper that upserts/merges evidence refs as existing runner events arrive.
- `GET /workflow-runs/:id/step-checkpoints`.
- workflow summary/report includes checkpoint diagnostics.

Do not implement graph resume or alter dispatch order in this task.
