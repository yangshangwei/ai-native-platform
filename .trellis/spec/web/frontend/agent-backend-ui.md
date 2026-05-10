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
- Stream endpoints:
  - `GET /workflow-runs/:id/agent-stream?sinceSeq=<n>` for workflow-run execution.
  - `GET /workflow-requests/:id/agent-stream?sinceSeq=<n>` for pre-run Coordinator triage.
- Stream event display uses `agentKind`, `sequence`, `type`, `text`, and `ts`.

### 3. Contracts

- Backend select options are exactly `Claude Code` and `Codex`.
- Missing backend displays `Needs setup` / `未配置`; it must not display a default fake value.
- The project card owns persistent backend selection; task creation only displays the current project default and status.
- Creating a task must be disabled or rejected until a project backend is configured and preflight is connected.
- The stream panel title should be backend-specific when known: `Claude Code 执行日志` or `Codex 执行日志`.
- The stream panel should expose a clear recording/expanded-view action when a
  run is available. The expanded view is UI-only: reuse the same
  `streamEventsByRun` cache, status state, and readable renderer; never open a
  second SSE connection, clear cached events, or change the Runner/API stream
  protocol just to enlarge the log.
- Compact and expanded stream views must show the same backend-specific title,
  run title/short id, live status, event count, and readable aggregated lines.
- The stream panel defaults to a readable view for Claude Code partial text:
  consecutive assistant text deltas rendered as `[claude…] ...` are grouped
  into one visible prose block, labelled with the merged raw sequence range.
  Tool calls, tool input, tool results, stderr, result, system, meta, and raw
  events remain visible boundaries and must not be merged into prose blocks.
- SSE reconnect uses `sinceSeq` from the last displayed event and dedupes by monotonic `sequence`.
- Stream cache keys must include channel kind (`run:<id>` / `request:<id>`). Never dedupe by sequence alone because request and run channels have independent sequence counters.
- The Coordinator conversation panel subscribes to the request channel while `workflowRunId` is absent, renders partial Coordinator output in a developer/details area, and keeps the main chat bubbles reserved for persisted user-friendly Coordinator messages.
- When the request gains `workflowRunId`, close the request-channel `EventSource` and switch to the run-channel stream without clearing cached history for either channel. The switch must preserve `sinceSeq` resume semantics per channel and avoid opening duplicate SSE connections.
- Cached preflight status is valid only when its `backend` matches the current project backend.

### 4. Validation & Error Matrix

- User chooses no backend -> show setup hint and block save/submit where applicable.
- Preflight returns `missing_cli` -> show install hint.
- Preflight returns `needs_login` -> show login hint.
- Preflight returns `not_runnable` -> show raw diagnostic preview plus remediation hint.
- SSE malformed event -> ignore that event, keep connection alive.
- SSE reconnect -> replay history greater than `sinceSeq` and continue live tail without duplicate lines.
- Request→run channel switch -> old request SSE is closed, new run SSE is opened with the run channel's last sequence; request partial output remains visible where cached, but live tail follows the active channel.

### 5. Good/Base/Bad Cases

- Good: project configured as Codex; task form shows `Codex · Connected`; run detail opens `Codex 执行日志` and streams events live.
- Base: project not configured; project card shows Agent Backend select and task form tells the user to configure it first.
- Bad: project was changed from Claude Code to Codex but UI reuses an old Claude preflight cache; always key/validate cache by matching backend.

### 6. Tests Required

- Projection/render tests for backend label/status helpers where practical.
- Route-level tests should cover task creation blocking without backend.
- Stream behavior should be verified with stored history plus live events so replay/live races do not drop lines.
- Stream rendering tests should cover Claude Code readable aggregation,
  boundary preservation, and sequence-based replay/live dedupe.
- Coordinator stream tests should cover request/run channel isolation, per-channel resume sequence, and malformed channel event rejection.
- Expanded/recording stream UI should be protected by either DOM tests or a
  pure renderer/cache test proving multiple views read identical snapshots from
  one cached event stream.
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
