# Typed Tool Registry MVP research

## Current code facts

- `apps/runner/src/command-runner.ts` creates `CommandRun` with stdout/stderr/combined SHA-256 digests and enforces `isWhitelisted()` before spawning.
- `apps/runner/src/orchestrator/steps.ts` posts compile/test CommandRuns through `api.commandRun()` and captures implementation diff artifacts after agent output.
- `apps/api/src/routes/runner-events.ts` has event ingress for `command-run`; Runner must use API events, not direct DB access.
- `apps/api/src/routes/workflow-runs.ts` returns run detail with commands/gates/artifacts/agentSessions but no toolInvocations yet.
- `apps/web/src/page-task-detail.ts` already renders command runs and evidence sections; a ToolInvocation section can sit beside those without replacing them.

## Epic B requirements distilled

- B1: Shared type and guards for ToolSpec / ToolInvocation.
- B2: Command execution records ToolInvocation linked to CommandRun and digest evidence. Whitelist remains hard gate.
- B3: Diff capture records `runner.git_diff_capture` linked to diff artifact and changed files.
- B4: API/Web expose workflow-run ToolInvocations.

## Red/green behavior

- Red: non-whitelisted command is not executed; ToolInvocation is denied and has no CommandRun ref.
- Red: ToolInvocation claiming command success without CommandRun/digest evidence must be detectable by tests/read model; Evidence Gate remains independent.
- Green: compile/test command exit 0 yields CommandRun plus ToolInvocation success with digest-bearing refs.
- Green: diff capture ToolInvocation points to diff artifact and changed-files evidence.

## Boundaries

- ToolInvocation never decides gate status.
- CommandRun and Artifact remain primary evidence records.
- MVP only covers Runner-owned tools: command execution and git diff capture.
- Backend-native tool calls and approval UI are later phases.
