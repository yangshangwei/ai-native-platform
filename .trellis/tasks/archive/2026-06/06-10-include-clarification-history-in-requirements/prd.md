# 澄清对话参与需求文档生成

## Goal

Ensure that after a Workflow Request goes through Coordinator clarification, the downstream WorkflowRun stages (`context_pack`, `requirement`) receive the full clarified intent instead of only the first request title.

## Problem

In the current flow, `defaultTriage()` reads `workflow_request_messages` and uses the latest user reply for Coordinator classification. After the request proceeds, `cmdWatch()` calls `cmdOrchestrate({ title: request.title })`, and `cmdOrchestrate()` seeds `inputs.user_request` from `opts.title` only. The later clarification messages are not part of the requirement agent input, so generated `requirement.md` can reflect only the first round.

## Requirements

- Preserve the original WorkflowRun/UI title as the request title.
- Build an agent-facing clarified task brief from the persisted request conversation when messages exist.
- Include both Coordinator questions and user replies in the brief so the requirement agent can trace decisions to the conversation.
- Keep direct `runner orchestrate` / non-chat paths unchanged: when no conversation exists, behavior remains title-only.
- Keep the change runner/API-layer scoped; do not change the frontend chat UI in this task.

## Acceptance Criteria

- [x] Watch-mode orchestration passes a full conversation-derived user request into `cmdOrchestrate` after clarification.
- [x] `cmdOrchestrate` keeps run creation title unchanged while using the clarified brief for `inputs.user_request` and ContextPack task brief.
- [x] Regression tests prove a multi-message request includes later user replies in the agent-facing brief.
- [x] Relevant runner tests and workspace typecheck pass.

## Definition of Done

- Tests added or updated for the regression.
- `bun test` and `bun run typecheck` pass or failures are explicitly explained.
- Spec updated if a new workflow contract is established.

## Out of Scope

- Rewriting historical requirement artifacts.
- Changing Coordinator's question wording or classification rules.
- Changing API database schema.

## Technical Notes

- Likely files: `apps/runner/src/cmd/watch.ts`, `apps/runner/src/orchestrator.ts`, runner tests.
- Existing message API: `api.listRequestMessages(requestId)` returns persisted chat history.
- Existing issue evidence: screenshots show follow-up user text not reflected in `requirement.md`.
