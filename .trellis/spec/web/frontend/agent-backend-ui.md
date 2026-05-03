# Agent Backend UI

## Scenario: project setup and live execution logs

### 1. Scope / Trigger

- Trigger: changes to Web project setup, task creation gating, backend status labels, or Agent Stream rendering.
- The UI must make the real backend obvious without repeatedly interrupting users.

### 2. Signatures

- Project DTO field: `agentBackend: 'claude_code' | 'codex' | null`.
- Preflight endpoints:
  - `POST /projects/agent-backend/preflight`
  - `POST /projects/:id/agent-backend/preflight`
  - `PUT /projects/:id/agent-backend`
- Stream endpoint: `GET /workflow-runs/:id/agent-stream?sinceSeq=<n>`.
- Stream event display uses `agentKind`, `sequence`, `type`, `text`, and `ts`.

### 3. Contracts

- Backend select options are exactly `Claude Code` and `Codex`.
- Missing backend displays `Needs setup` / `未配置`; it must not display a default fake value.
- The project card owns persistent backend selection; task creation only displays the current project default and status.
- Creating a task must be disabled or rejected until a project backend is configured and preflight is connected.
- The stream panel title should be backend-specific when known: `Claude Code 执行日志` or `Codex 执行日志`.
- SSE reconnect uses `sinceSeq` from the last displayed event and dedupes by monotonic `sequence`.
- Cached preflight status is valid only when its `backend` matches the current project backend.

### 4. Validation & Error Matrix

- User chooses no backend -> show setup hint and block save/submit where applicable.
- Preflight returns `missing_cli` -> show install hint.
- Preflight returns `needs_login` -> show login hint.
- Preflight returns `not_runnable` -> show raw diagnostic preview plus remediation hint.
- SSE malformed event -> ignore that event, keep connection alive.
- SSE reconnect -> replay history greater than `sinceSeq` and continue live tail without duplicate lines.

### 5. Good/Base/Bad Cases

- Good: project configured as Codex; task form shows `Codex · Connected`; run detail opens `Codex 执行日志` and streams events live.
- Base: project not configured; project card shows Agent Backend select and task form tells the user to configure it first.
- Bad: project was changed from Claude Code to Codex but UI reuses an old Claude preflight cache; always key/validate cache by matching backend.

### 6. Tests Required

- Projection/render tests for backend label/status helpers where practical.
- Route-level tests should cover task creation blocking without backend.
- Stream behavior should be verified with stored history plus live events so replay/live races do not drop lines.
- Manual smoke: open Web UI, configure backend, run a workflow, and confirm live logs show real CLI output.

### 7. Wrong vs Correct

#### Wrong

```ts
return tasks.at(-1)?.backend ?? 'native / codex / claude_code';
```

#### Correct

```ts
return project.agentBackend ? agentBackendDisplayName(project.agentBackend) : '未配置';
```
