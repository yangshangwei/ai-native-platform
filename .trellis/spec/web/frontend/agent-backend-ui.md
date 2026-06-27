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
- Project/task-creation API load failures must show concise user-facing Chinese
  copy in the primary form flow. Do not render raw backend payloads, HTML error
  pages, stack traces, or proxy diagnostics as default-visible form text. Keep
  those details in a collapsed technical disclosure with a stable
  `data-details-key`.

### 4. Validation & Error Matrix

- User chooses no backend -> show setup hint and block save/submit where applicable.
- Preflight returns `missing_cli` -> show install hint.
- Preflight returns `needs_login` -> show login hint.
- Preflight returns `not_runnable` -> show raw diagnostic preview plus remediation hint.
- SSE malformed event -> ignore that event, keep connection alive.
- SSE reconnect -> replay history greater than `sinceSeq` and continue live tail without duplicate lines.
- Request→run channel switch -> old request SSE is closed, new run SSE is opened with the run channel's last sequence; request partial output remains visible where cached, but live tail follows the active channel.
- `/projects` or related setup endpoints return an HTML/Bun error page -> show
  a short failure summary, keep retry/setup actions visible, and keep the raw
  response available only inside collapsed diagnostics.

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

## Scenario: new-task API failure handling

### 1. Scope / Trigger

- Trigger: changes to `apps/web/serve.ts` `/api/*` proxy behavior, new-task
  project loading, or form-level API failure notices.
- The UI must keep task creation readable even when the API process is down,
  while preserving enough diagnostics for local operators.

### 2. Signatures

- Browser API base remains `const API_BASE = '/api'` in `apps/web/src/main.ts`.
- Web dev proxy entry point:
  `createWebServer({ apiBase?: string }).fetch('/api/<path>')`.
- Proxy target default:
  `process.env.AINP_API_BASE ?? 'http://127.0.0.1:8787'`.

### 3. Contracts

- Successful proxy responses are passed through from the API unchanged.
- A network-level proxy failure returns JSON, not Bun's HTML fallback:
  `{ error: 'api proxy unavailable', detail: string, apiBase: string }` with
  HTTP `502`.
- New-task project load errors show concise Chinese primary copy. Raw payloads,
  proxy diagnostics, HTML pages, or stack traces belong only inside a collapsed
  technical disclosure with a stable `data-details-key`.
- The retry action and project setup action stay visible when project loading
  fails.

### 4. Validation & Error Matrix

- API process not listening on `AINP_API_BASE` -> proxy returns JSON `502`.
- `/projects` returns a Bun/HTML error page -> primary form notice summarizes
  the failure and keeps the raw response collapsed.
- `/projects` returns JSON `{ items }` -> project select lists projects and the
  project-load notice is absent.
- Very long diagnostic strings -> wrap or scroll inside the notice without
  increasing document horizontal scroll width.

### 5. Good/Base/Bad Cases

- Good: API is running; `/api/projects` returns `200 application/json`, and the
  new-task form shows registered projects.
- Base: API is down; `/api/projects` returns JSON `502`, the form shows a short
  failure notice plus retry/setup actions.
- Bad: API is down and the browser receives a `text/html` Bun error page, or
  the form renders raw HTML as default-visible text.

### 6. Tests Required

- `apps/web/test/serve.test.ts` should cover unreachable proxy target -> JSON
  `502`.
- Typecheck `@ainp/web` after touching the proxy or render helper.
- Manual or Playwright smoke should verify `/api/projects` through the web
  origin returns JSON when the API is running, and that the new-task form no
  longer shows `项目列表加载失败`.

### 7. Wrong vs Correct

#### Wrong

```ts
return fetch(target, init);
```

#### Correct

```ts
try {
  return await fetch(target, init);
} catch {
  return Response.json({ error: 'api proxy unavailable' }, { status: 502 });
}
```

## Scenario: task detail review-first hierarchy

### 1. Scope / Trigger

- Trigger: changes to the workflow request detail page, approval checkpoints,
  Runner panels, evidence drill-downs, or task lifecycle cards.
- The task detail page is primarily a reviewer surface. It must answer "what
  needs my attention?" before exposing execution internals.

### 2. Signatures

- Existing render entry points stay in `apps/web/src/main.ts`:
  - `renderTaskHero(request, detail, projection)`
  - `renderTaskNextActionPanel(request, detail, projection)`
  - `renderCurrentStagePanel(request, detail, projection)`
  - `renderEvidencePanel(detail)`
  - `renderRunnerControlPanel()`
  - `renderAgentStreamPanel()`
- Do not change approval API calls from these UI changes:
  - `submitApproval(runId, gateId, approved, reason?)`
  - `submitAcceptanceDecision(runId, decision, reason?)`

### 3. Contracts

- Primary, always-visible copy should use user-facing Chinese labels:
  `等待你确认`, `批准需求`, `打回修改`, `当前阶段`, `任务进度`.
- Raw identifiers such as `requirement_gate`, run ids, request ids,
  worktree paths, command counts, and Runner process ids belong in collapsed
  diagnostics unless they are the exact thing the user must act on.
- Technical `<details>` panels that can be opened during polling need stable
  `data-details-key` values so disclosure state survives `render()` rebuilds.
- Desktop may keep the checkpoint action in the right column. Mobile must show
  the same next-action panel near the top of the task detail flow, before long
  chat, lifecycle, or artifact sections.
- After an approval/rejection is recorded for the current gate but the run is
  still `awaiting_human`, the checkpoint panel must switch to an acknowledged
  state such as `已批准，等待继续` or `已打回，等待修订`. Do not keep showing the
  same action buttons, because that makes a successful click look inert.
- Stream panels must keep the backend-specific title/status and recording
  action visible, but the raw log body should be collapsed by default on the
  task detail page.

### 4. Validation & Error Matrix

- Awaiting human gate -> show plain-language checkpoint copy and action labels;
  do not show raw gate ids in the primary panel title or buttons.
- Recorded approval while run is still awaiting human -> show the submitted
  decision and wait message; do not offer the same approve/reject action again
  unless a newer automated gate run supersedes that approval.
- Running/no pending gate -> show that the system is progressing automatically;
  do not ask the user to inspect Requirement/Design/Gate internals.
- Runner stopped/error -> keep Runner controls reachable in the diagnostic
  panel; do not remove the fallback start action.
- Mobile viewport -> document `scrollWidth` should not exceed
  `window.innerWidth`; wide lifecycle tracks should scroll inside their own
  container.

### 5. Good/Base/Bad Cases

- Good: `requirement_gate` pending renders `等待你确认`, `批准需求`, and
  `打回修改`, with Gate Runs available only after expanding technical evidence.
- Base: a running task with no pending gate shows progress and current stage;
  the right column contains collapsed diagnostics.
- Bad: the hero exposes `Approve requirement_gate`, worktree paths, command
  counts, or Runner pids as default visible content.

### 6. Tests Required

- Typecheck `@ainp/web` after changing render helpers.
- Run `vitest` for `apps/web/test` to protect projection and stream helpers.
- Manual/Playwright visual check at desktop and mobile widths:
  - no overlap between task hero and side panel;
  - no mobile horizontal page overflow;
  - approval action appears above long diagnostic sections on mobile;
  - stream/evidence/Runner details remain reachable when expanded.

### 7. Wrong vs Correct

#### Wrong

```ts
panelHeader('等待人工确认', `${STAGE_LABELS[currentStage]} 暂停在 ${pendingGate}`);
button(`Approve ${pendingGate}`, 'button primary');
```

#### Correct

```ts
const copy = reviewGateCopy(pendingGate, currentStage);
panelHeader('等待你确认', copy.subtitle);
button(copy.approveLabel, 'button primary');
```

## Scenario: ask-routed task detail UI

### 1. Scope / Trigger

- Trigger: changes to `apps/web/src/page-task-detail.ts`, `apps/web/src/projection.ts`, Coordinator chat rendering, or request/run stream switching for read-only Q&A.
- Applies when `WorkflowRequest.kind === 'ask'` or the persisted Coordinator decision is `proceed/routeCase='ask'`.

### 2. Signatures

- `WorkflowRequestDto.kind: 'ask' | null` is the primary discriminator.
- Coordinator chat state can also identify ask with `decision.action === 'proceed' && decision.routeCase === 'ask'`.
- `WorkflowRunDto.type` is derived from shared `WorkflowRun.type`; `buildRunProjection(detail)` must return an empty lifecycle when `detail.run.type === 'ask'`.
- Request-channel stream events are read via `buildAgentStreamView({ kind: 'request', id: request.id })`.

### 3. Contracts

- Ask detail pages are chat-first. They show the Coordinator/chat panel and may show request-channel activity, but must not show lifecycle cards, current-stage panels, stage backend details, evidence panels, Runner controls, or "start Runner" calls to action.
- Ask hero metrics must describe Q&A status and read-only execution, not `当前阶段` or `任务进度`.
- Activity copy may surface the latest request-channel stream line while the system is live; once the request is terminal (`completed` or `cancelled`), the activity indicator disappears.
- If a legacy ask `WorkflowRun` leaks into the frontend, projection must return `stages=[]` and `visibleStages=[]` so no empty or fallback feature stage board renders.
- Keep ask detection defensive: `kind='ask'` wins immediately; Coordinator decision routeCase is a fallback for legacy rows.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| `request.kind === 'ask'` and no run exists | Render chat/ask next action; no stage board and no Runner start panel. |
| Coordinator decision later loads as `routeCase='ask'` | Re-render into ask UI even if `kind` was missing on an older row. |
| Request-channel stream is live | Show a lightweight activity indicator sourced from request stream state. |
| Ask request is `completed` or `cancelled` | Hide the activity indicator. |
| Leaked `detail.run.type === 'ask'` | `buildRunProjection()` returns empty stage arrays. |

### 5. Good/Base/Bad Cases

- Good: user asks "Where is routing configured?" and the detail page shows chat plus read-only Q&A state, with no seven-card lifecycle.
- Base: feature/bugfix/refactor task detail pages keep the normal reviewer hierarchy, lifecycle, evidence, and Runner controls.
- Bad: ask detail shows `启动 Runner`, `当前阶段`, `任务进度 0/7`, or `feature.standard` lifecycle fallback.
- Bad: an ask run missing `flowId` falls back to `feature.standard` and renders seven waiting cards.

### 6. Tests Required

- `apps/web/test/projection.test.ts` should cover leaked ask runs returning empty `stages` and `visibleStages`.
- Task-detail DOM tests or manual smoke should cover ask pages rendering no `.stage-board`, no Runner control panel, and no lifecycle/current-stage panels.
- Regression checks for ordinary feature/refactor/bugfix projections must continue to pass after adding ask guards.

### 7. Wrong vs Correct

#### Wrong

```ts
detail ? renderLifecycle(detail, projection!) : renderQueuedLifecycle(request);
```

This renders the default feature lifecycle for ask requests when no run-specific flow exists.

#### Correct

```ts
isAskRouted(request)
  ? renderAskActivityIndicator(request)
  : detail ? renderLifecycle(detail, projection!) : renderQueuedLifecycle(request);
```

## Scenario: report center status projection

### 1. Scope / Trigger

- Trigger: changes to the reports page, report status labels, report filtering,
  completion-report detail rendering, or `apps/web/src/projection.ts` helpers
  used by those views.
- The reports page is an operational acceptance surface. It must classify
  finished workflow runs by acceptance readiness, not by internal terminal enum
  names.

### 2. Signatures

- Projection helpers in `apps/web/src/projection.ts`:
  - `reportStats(runs: WorkflowRunDto[]): ReportStats`
  - `reportNeedsAttention(run: WorkflowRunDto): boolean`
  - `reportIsAcceptable(run: WorkflowRunDto): boolean`
  - `reportIsRunning(run: WorkflowRunDto): boolean`
  - `reportStatusLabel(status: string): string`
- `ReportStats` fields: `{ total, attention, acceptable, running, completed, failed }`.
- Reports page render entry points in `apps/web/src/main.ts`:
  - `renderReportsPage()`
  - `renderReportsOverview(stats)`
  - `renderReportTabs(stats)`
  - `renderReportRow(run)`
  - `renderActiveReportDetail()`

### 3. Contracts

- `run.status === 'passed'` is a successful terminal run and must be treated as
  report-acceptable everywhere the reports page counts, filters, or labels
  acceptable work.
- `run.status === 'completed'` remains acceptable for legacy/imported data.
- `ReportStats.completed` is intentionally the same count as `acceptable`
  until the backend exposes a separate product-level completion state. Do not
  count only `status === 'completed'`, because current workflow success writes
  `status='passed'`.
- `reportStatusLabel('passed')` and `reportStatusLabel('completed')` both
  return `可验收`.
- Attention statuses are `failed`, `awaiting_human`, and
  `awaiting_clarification`.
- Running statuses are `running`, `pending`, and `claimed`.
- Report detail should parse the structured completion-report JSON sidecar when
  present; markdown parsing is a fallback only.

### 4. Validation & Error Matrix

- `passed` run appears on reports page -> count under `可验收`, not `执行中` or
  `需处理`.
- `passed` run filtered by acceptable tab -> row remains visible.
- `failed` run -> count under both `需处理` and `失败`.
- `awaiting_human` / `awaiting_clarification` -> count under `需处理`, not
  `可验收`.
- `pending` / `claimed` / `running` -> count under `执行中`.
- Completion report has JSON sidecar -> render sidecar title/summary/sections
  instead of scraping markdown.

### 5. Good/Base/Bad Cases

- Good: one `passed`, one `failed`, and one `running` run produce stats
  `{ acceptable: 1, completed: 1, attention: 1, running: 1, failed: 1 }`.
- Base: legacy `completed` runs still display `可验收`.
- Bad: a passed run is missing from the acceptable tab because the UI filters
  only `status === 'completed'`.
- Bad: the overview says zero completed reports while all current successful
  runs have `status === 'passed'`.

### 6. Tests Required

- Projection tests must cover `passed` as acceptable, `completed` aliasing, and
  mixed-status stats.
- Sidecar projection tests must cover `ainp.completion_report.v1` JSON
  preferred over markdown fallback.
- Manual/Playwright report-page smoke should verify the `可验收` tab and KPI
  count are nonzero after a passing end-to-end run.

### 7. Wrong vs Correct

#### Wrong

```ts
export function reportIsAcceptable(run: WorkflowRunDto): boolean {
  return run.status === 'completed';
}
```

#### Correct

```ts
export function reportIsAcceptable(run: WorkflowRunDto): boolean {
  return run.status === 'passed' || run.status === 'completed';
}
```
