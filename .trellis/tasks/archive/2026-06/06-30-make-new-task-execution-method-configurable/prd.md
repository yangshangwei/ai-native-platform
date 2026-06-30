# Make New Task Execution Method Configurable

## Goal

Allow operators to choose the AI execution backend for a single new task from the Advanced Settings area, making task creation flexible without changing the project's default backend.

## Requirements

- The New Task advanced section must render execution method as a selectable control with `Claude Code` and `Codex` options.
- The selection must default to the chosen project's configured `agentBackend`.
- Changing projects must reset the task-level backend selection to that project's default.
- The selected execution method must be submitted with the workflow request and persisted with the request.
- API validation must reject unknown request-level backends and still reject task creation when neither request nor project backend is configured.
- Runner Coordinator triage must prefer the request-level backend when present, falling back to the project backend.
- Runner orchestration must execute the request-level backend when present, falling back to the project backend.
- Existing project-level backend configuration remains the default and is not modified by task creation.

## Acceptance Criteria

- [x] In the New Task page, Advanced Settings > 执行方式 is a dropdown instead of a read-only label.
- [x] The dropdown default matches the selected project's backend.
- [x] Submitting a task sends `agentBackend` in `POST /workflow-requests`.
- [x] `GET /workflow-requests` / detail responses include the request-level `agentBackend`.
- [x] Runner watch passes the request-level backend into Coordinator preference and workflow orchestration.
- [x] Runtime backend selection uses request override when provided and project backend otherwise.
- [x] Invalid `agentBackend` request bodies fail with HTTP 400 before DB writes.
- [x] Targeted unit/render tests cover frontend hydration, API validation/persistence, and runner selection.

## Definition of Done

- Tests added or updated for touched layers.
- Typecheck / targeted tests pass.
- Relevant specs updated because this changes the previous project-default-only contract.
- No new dependencies.

## Technical Approach

Add `agentBackend: ProjectAgentBackendKind | null` to `WorkflowRequest`.
Persist it as `workflow_requests.agent_backend` via a new numbered SQLite migration.
Accept optional `agentBackend` in `POST /workflow-requests`, validate with the shared `isProjectAgentBackendKind` guard, and store either the explicit request value or the project default.

In `apps/web/src/page-new-task.ts`, replace the read-only backend label with a select control. Use the existing backend preflight helpers and check the selected backend, keyed by project where possible. Keep the existing "检测连接" action and readiness language, but base it on the selected task backend.

In `apps/runner/src/cmd/watch.ts`, include `agentBackend` on pending/claimed request picks. `defaultTriage` should prefer `req.agentBackend ?? project.agentBackend`. `cmdWatch` should pass the request override to `cmdOrchestrate`. `cmdOrchestrate` should override the fetched project object's `agentBackend` before calling `selectAgentBackend`.

## Decision (ADR-lite)

**Context**: The existing contract says task creation only displays the project backend, and Runner selection reads only `project.agentBackend`. The user wants the New Task Advanced Settings execution method to be switchable per task.

**Decision**: Implement a request-level backend override with project default fallback.

**Consequences**: This adds a persisted request field and a schema migration, but keeps the model explicit and auditable. It avoids mutating project settings from a one-off task. Existing requests get `NULL` in the new column and continue using project defaults.

## Out of Scope

- Changing or removing the project-level default backend setting.
- Adding new backend types beyond `Claude Code` and `Codex`.
- Per-stage backend switching inside a workflow run.
- Changing workflow run records to store backend history; request-level audit is enough for this task.

## Technical Notes

- User request came from screenshot feedback: New Task > 高级设置 > 执行方式 should be switchable.
- Existing UI entry point: `apps/web/src/page-new-task.ts`.
- Existing API entry point: `apps/api/src/routes/workflow-requests.ts`.
- Existing request persistence: `apps/api/src/store/store.ts` and `apps/api/src/store/db.ts`.
- Existing Runner selection: `apps/runner/src/cmd/watch.ts`, `apps/runner/src/orchestrator.ts`, `apps/runner/src/backend-selection.ts`.
- Relevant specs:
  - `.trellis/spec/web/frontend/agent-backend-ui.md`
  - `.trellis/spec/web/frontend/state-management.md`
  - `.trellis/spec/api/backend/database.md`
  - `.trellis/spec/api/backend/error-handling.md`
  - `.trellis/spec/runner/backend/agent-backend-runtime.md`
