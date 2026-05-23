# ACP protocol integration for Claude Code and Codex

## Goal

Move runner execution for Claude Code and Codex from backend-specific CLI streaming protocols to Agent Client Protocol (ACP) stdio JSON-RPC, using official ACP-compatible agents where available.

## What I Already Know

- The user requested a new `feature/acp` branch from `feat/context-injection-layer-mvp`.
- The current branch is `feature/acp`.
- Existing runner backends directly call local CLIs:
  - `apps/runner/src/agents/claude-code.ts` uses `claude --print --output-format stream-json`.
  - `apps/runner/src/agents/codex.ts` uses `codex exec --json`.
- ACP local agents communicate over newline-delimited JSON-RPC 2.0 on stdio.
- Minimal ACP lifecycle is `initialize` -> `session/new` -> `session/prompt`.
- ACP streams output via `session/update` notifications.
- Official npm packages expose:
  - `claude-agent-acp` from `@agentclientprotocol/claude-agent-acp`.
  - `codex-acp` from `@agentclientprotocol/codex-acp`.
- Project policy says no new dependencies without explicit request, so the MVP should implement the small stdio client internally instead of adding `@agentclientprotocol/sdk`.

## Requirements

- Add a shared ACP stdio client in the runner.
- Claude Code and Codex backend runtime paths must drive ACP agents with `initialize`, `session/new`, and `session/prompt`.
- Preserve existing runner invariants:
  - non-implementation stages must produce the expected artifact under `ctx.artifactsDir`;
  - implementation stage must capture `git diff` and changed files after agent execution;
  - stream event upload failures must not kill the local agent process;
  - backend exit or ACP prompt failure must fail the workflow;
  - context rendering continues through the shared renderer.
- Runtime command must be configurable:
  - Claude ACP agent override via `AINP_CLAUDE_ACP_BIN` or constructor option.
  - Codex ACP agent override via `AINP_CODEX_ACP_BIN` or constructor option.
  - Defaults: `claude-agent-acp`, `codex-acp`.
- Keep current CLI preflight/auth checks for existing project setup, because the ACP adapters still rely on the underlying installed/authenticated Claude/Codex environments.
- Keep a temporary escape hatch to the previous direct CLI runtime for compatibility/debugging.

## Acceptance Criteria

- [ ] Runner has unit tests proving Claude backend sends ACP `initialize`, `session/new`, and `session/prompt`.
- [ ] Runner has unit tests proving Codex backend sends ACP `initialize`, `session/new`, and `session/prompt`.
- [ ] ACP `session/update` notifications are converted to existing `AgentStreamEventInput` shapes for UI/API streaming.
- [ ] ACP `fs/read_text_file` and `fs/write_text_file` requests are handled within the workspace/artifact scope.
- [ ] Existing Claude/Codex backend tests still pass or are intentionally updated to ACP behavior.
- [ ] `bun run typecheck` passes.
- [ ] Relevant runner tests pass.

## Out of Scope

- Adding UI for ACP settings.
- Replacing project-level backend choices.
- Adding terminal/MCP client support in this MVP.
- Adding `@agentclientprotocol/sdk` as a runtime dependency.
- Removing the existing direct CLI implementation entirely before ACP has bake time.

## Technical Notes

- Research notes: `research/acp-protocol.md`.
- Relevant specs:
  - `.trellis/spec/runner/backend/agent-backend-runtime.md`
  - `.trellis/spec/shared/backend/agent-backend-contract.md`
  - `.trellis/spec/shared/backend/context-injection-protocol.md`
