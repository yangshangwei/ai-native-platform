# Bounded Multi-agent Handoff research

## Current code facts

- `packages/shared/src/types/agent-session.ts` already supports `parentSessionId`, `retryIndex`, and `AgentSessionLinkKind = 'retry' | 'handoff_child'`.
- `apps/api/src/store/store.ts` already has AgentSession and ToolInvocation tables/repositories plus workflow-scoped read helpers.
- `apps/api/src/routes/workflow-runs.ts` already exposes workflow run summaries, agent sessions, and tool invocations.
- `apps/api/src/routes/runner-events.ts` is the existing runner trust boundary for AgentSession and ToolInvocation writes.
- `apps/runner/src/orchestrator/invoke-skill.ts` already creates parent/retry AgentSessions and records context-request review signals.
- `apps/runner/src/orchestrator/steps.ts` owns build/test, implementation diff capture, review stage, completion report, and runner-side evidence plumbing.
- `apps/api/src/reports.ts` already assembles completion/retro report structured sidecars from persisted artifacts, actions, gates, command runs, context requests, and knowledge review signals.

## Gaps to close

- There is no shared Handoff type/guard/status/adoption contract.
- There is no API store or route for workflow-scoped handoff records.
- Runner events cannot persist handoff lifecycle records.
- Completion report sidecars cannot answer whether handoff occurred, what child evidence was produced, or whether output was adopted/rejected.
- Review/debug child work currently has no explicit bounded envelope separate from normal review stages.

## Epic E requirements distilled

- E1: Add explicit Handoff records with parent/child AgentSession linkage and validation.
- E2: Independent reviewer handoff produces review evidence only; Gate Engine remains authoritative.
- E3: Build/test failure debugger handoff produces root-cause/fix recommendation evidence only; main workflow controls any later fix step.

## Red/green behavior

- Red: handoff without input artifact refs or expected output schema is accepted.
- Red: child reviewer directly mutates WorkflowRun status or GateRun status.
- Yellow: child output has no adoption decision; output appears in reports as needs_review and does not affect gate status.
- Green: implementation/review path can persist Handoff record, child AgentSession link, review artifact refs, and report evidence.
- Green: build/test failure path can persist debugger handoff evidence without applying code changes.

## Boundaries

- Workflow Engine / Gate Engine remain the authority for run and gate state.
- Handoff is a bounded evidence envelope, not an orchestration free-for-all.
- Child output must be adopted, rejected, or marked needs_review by the parent workflow/coordinator/human path.
