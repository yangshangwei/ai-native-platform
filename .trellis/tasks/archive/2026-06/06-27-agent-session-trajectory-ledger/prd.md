# Agent Session Trajectory Ledger

## Goal

Implement Epic A from the Agent Runtime and Harness design docs: introduce a first-class `AgentSession` / trajectory ledger that records each backend invocation envelope and exposes a read model by workflow run. This creates the shared spine needed for context retry, typed tool invocations, handoff, and deterministic agent harness tests.

## Source Documents

- `docs/2026-06-27-agent-orchestration-and-harness-improvement-plan.md`
- `docs/2026-06-27-agent-runtime-requirements.md`
- `docs/2026-06-27-agent-runtime-architecture-design.md`
- `docs/2026-06-27-agent-runtime-development-tasks.md`
- `docs/2026-06-27-agent-runtime-red-green-test-plan.md`
- `docs/2026-06-27-current-technical-architecture.md`
- `docs/2026-06-27-context-management-architecture.md`

## What I Already Know

- The design docs explicitly recommend implementing `06-27-agent-session-trajectory-ledger` first.
- Epic A covers A1 shared types, A2 API storage/read model, and A3 Runner writes from `invokeSkill()`.
- `AgentTask` / `AgentResult` already exist, but they do not provide a single queryable session envelope with context pack and retry linkage.
- `ContextPack` is built before each backend invocation in `apps/runner/src/orchestrator/invoke-skill.ts`.
- API schema changes must be additive numbered migrations in `apps/api/src/store/db.ts`.
- Workflow Engine remains the only state writer; Runner writes through API ingress.
- Gate Engine remains the only pass/warn/fail authority. AgentSession is audit/read-model data only.

## Requirements

1. Add shared `AgentSession`, `AgentSessionStatus`, and `AgentSessionLink` types.
2. The type must express `workflowRunId`, `agentTaskId`, optional `agentResultId`, backend, stage, skill id/version, `contextPackId`, `parentSessionId`, `retryIndex`, status, timestamps, and metadata.
3. Add API persistence and store accessors for agent sessions without breaking legacy databases.
4. Add a read model endpoint for querying sessions by workflow run.
5. Runner `invokeSkill()` must create a session for every backend invocation, update it on success and failure, and link AgentTask / AgentResult / ContextPack.
6. Existing workflow behavior must not change.

## Acceptance Criteria

- [x] Shared tests prove valid `AgentSession` records can express normal invocations and retry/child invocations.
- [x] API tests prove old runs with no sessions return an empty list, not a crash.
- [x] API tests prove agent sessions can be created/updated and queried by workflow run.
- [x] Runner tests prove a successful `invokeSkill()` records a success session linked to AgentTask, AgentResult, and ContextPack.
- [x] Runner tests prove a failing invocation records a failed session instead of leaving success or no session.
- [x] `bun test packages/shared/test` passes.
- [x] `bun test apps/api/test apps/runner/test` passes for the touched test surface.
- [x] `bun run typecheck` passes.

## Out of Scope

- Typed Tool Registry / ToolInvocation.
- Same-step context retry behavior changes.
- Memory lifecycle filtering.
- Bounded multi-agent handoff execution.
- Eval harness expansion beyond any focused fixture needed to protect AgentSession behavior.
- Web UI rendering for sessions unless a minimal API contract requires it.

## Technical Notes

- Prefer a new shared type file such as `packages/shared/src/types/agent-session.ts` to avoid overloading `agent.ts`.
- Persist sessions in an additive table with nullable links for backward compatibility.
- Keep writes behind Runner event/API client boundaries; do not let the Runner mutate platform state directly.
- Do not make sessions authoritative for gate status, workflow status, or completion claims.
- If a session starts before `AgentTask` exists, use a two-step create/update path so the completed record still links to the task/result.

## Definition of Done

- Implementation satisfies Epic A A1-A3 and the red/green tests for trajectory ledger.
- Docs/spec notes are updated if code contracts shift.
- No unrelated dirty Trellis task files are staged or committed.
