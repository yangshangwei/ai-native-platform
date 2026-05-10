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
- The same readable-prose aggregation applies to Codex output. Codex assistant
  text arrives either as `[codex…] ...` deltas (`item.updated` with
  `agent_message`, or the legacy `response.output_text.delta`) or as a single
  final `[codex] ...` message (`item.completed` with `agent_message`). Parsers
  must preserve those prefixes so the web stream renderer can merge
  consecutive deltas into one prose block, alongside Claude prose.
- Codex JSONL events `thread.started`, `turn.started`, and `item.started` for
  `agent_message` or `reasoning` carry no user-visible content and must render
  as silent meta events (no text line). Do not map them to `[system] …` or
  stream prefixes such as `item.started`; that floods the log and breaks the
  "as if I were in the CLI" reading experience.
- Codex `item.completed` events must be rendered by item type rather than the
  outer event name: `agent_message` → `[codex] ...`, `reasoning` →
  `[think] ...`, `command_execution` → `[tool← ok|ERR] exec exit=<n> — <cmd>`
  with trailing aggregated output when present, `file_change` / `mcp_tool_call`
  / `web_search` → matching `[tool← …]` lines, and `turn.completed` →
  `[result:turn] in=<n> cache=<n> out=<n> reason=<n>`. Unknown item types are
  surfaced as a single `[item:<type>] …` meta line rather than raw JSON.
- SSE reconnect uses `sinceSeq` from the last displayed event and dedupes by monotonic `sequence`.
- Stream cache keys must include channel kind (`run:<id>` / `request:<id>`). Never dedupe by sequence alone because request and run channels have independent sequence counters.
- The Coordinator conversation panel subscribes to the request channel while `workflowRunId` is absent, renders partial Coordinator output in a developer/details area, and keeps the main chat bubbles reserved for persisted user-friendly Coordinator messages.
- When a request is `awaiting_clarification`, the Coordinator conversation panel must prioritize the user-facing clarification flow: show the pending question cards and reply composer before any stream/log details. Developer logs are supporting diagnostics and should default collapsed in this context, even when live events already exist.
- Coordinator clarification messages should be visually distinguishable from user replies and must remain text-rendered DOM nodes (`textContent`/element text), not HTML strings, because Coordinator content can originate from user-provided workflow text.
- Coordinator clarification options are parsed from untrusted Coordinator text, not a structured API contract. Keep parsing in a pure helper, render options as text-only buttons, and cover mixed inline/line option formats in unit tests (for example `Question? A. one\nB. two`). Do not use HTML injection for option text.
- Clickable clarification options may update the reply composer, but they must reuse the existing draft/focus/IME preservation path. Generated option replies should be replaceable as a block so changing a selection does not erase user-written supplements.
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
- Coordinator clarification UI changes should be verified for ordering: pending question cards and reply composer before developer logs, collapsed log details by default, and draft/focus/IME preservation while polling renders continue.
- Coordinator clarification option parsing should be covered with pure helper tests for inline options, line-based options, mixed inline/line options, multi-select detection, and non-option dotted text such as `A.1`.
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
