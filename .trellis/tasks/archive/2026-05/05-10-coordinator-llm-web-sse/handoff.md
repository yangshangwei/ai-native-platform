# Handoff — task 05-10-coordinator-llm-web-sse

> 给下一个 session 接手用。所有上下文齐了，可以直接拿起 PR2 继续干。

## 0. 一句话状态

PR1（channel schema + bus + SSE 路由）**已完成**，typecheck 全绿、全量 552/552 测试通过。**PR2 / PR3 / PR4 待做**。代码已在工作树（未 commit）。

## 1. 任务总览

完整 PRD：`.trellis/tasks/05-10-coordinator-llm-web-sse/prd.md`（必读 D1/D2/D3 + Technical Approach + Out of Scope）。

**核心目标**：让 Web Coordinator 对话区在 LLM 分诊期间实时看到 partial text，消除"提交 → 静默 → 一次性出结果"的痛点。

**4 个 PR 拆解**：
1. **PR1（done）**：channel 模型扩展（schema/bus/SSE 路由），后端协议层零行为变化。
2. **PR2（next）**：Coordinator runner 端流式化 — `runClaudeOneShot`/`runCodexOneShot` 改 chunk-by-chunk emit。
3. **PR3**：Web `renderCoordinatorChatPanel` 订阅 request channel + run 创建后切换 channel。
4. **PR4**：spec 三处更新 + 必要兜底。

**Decision 锁定**（不要重新讨论）：
- D1：`AgentStreamEvent` 既能挂 `workflowRunId` 也能挂 `workflowRequestId`（互斥），bus 用 `${kind}:${id}` 复合 key，新 SSE 路由 `GET /workflow-requests/:id/agent-stream`。
- D2：复用 `claude-code.ts:290-302` / `codex.ts:175-184` 的 `consumeLines + parse*Line + emit` 现成模式，不重写。
- D3：MVP 只做核心闭环（项 1）。**项 2/3/4/5 全部 OUT** — 不做 triage events 在 run 视图回放、不做 cancel/abort、不做并发 retriage 防御、**不做 `/coordinator/preview` 流式**（preview 是 rules-only / 几毫秒返回，无痛点；prd 里详细记了这个误判撤回过程）。

## 2. PR1 已落改动（参考但不要改）

### 改动文件清单
- `packages/shared/src/types/agent-event.ts`：`workflowRunId` 改 nullable、新增 `workflowRequestId?`、新增 `isAgentStreamChannel(input) → AgentStreamChannel | null` / `agentStreamChannelKey(channel)` helper。
- `apps/api/src/store/db.ts`：CREATE TABLE 把 `workflow_run_id` 改 nullable + ALTER 加 `workflow_request_id` 列 + `idx_agent_events_request` index + **老 DB 重建表 idempotent migration**（处理已有 NOT NULL 约束）。
- `apps/api/src/store/store.ts:1190-1267`：`AgentEventRow` / `rowToAgentEvent` / `insert` / `nextSequence` 改用 channel API + 新增 `byRequest(workflowRequestId, sinceSeq)`。
- `apps/api/src/agent-stream-bus.ts`：subscribers 改成 `${kind}:${id}` 复合 key、`subscribe(channel: AgentStreamChannel, fn)` / `subscriberCount(channel)`。
- `apps/api/src/workflow-engine.ts:1, 967`：import `isAgentStreamChannel`、`recordAgentEvent` validate 互斥 + 用 channel API 拿 sequence。
- `apps/api/src/routes/workflow-runs.ts:304`：subscribe 调用改 `{kind:'run', id}`。
- `apps/api/src/routes/runner-events.ts:117`：`POST /runner/events/agent-stream` 加互斥 input validation（400 if both/neither）。
- `apps/api/src/routes/workflow-requests.ts`：新增 `GET /:id/agent-events` history endpoint + `GET /:id/agent-stream` SSE（streamSSE，先 ready event → replay history > sinceSeq → live tail → 5s ping → onAbort 清理 unsubscribe，与 run channel 同形）。

### 新增测试
- `apps/api/test/agent-stream-bus.test.ts`（6 tests）：channel isolation、多 subscriber、unsubscribe、subscriberCount per-channel-kind、neither id 静默 drop、subscriber 抛错不阻塞其他。
- `apps/api/test/agent-events-channels.test.ts`（9 tests）：`recordAgentEvent` 互斥校验（neither/both）、per-channel sequence 独立、history endpoint 200/sinceSeq/404、`POST /runner/events/agent-stream` 互斥校验 + request channel 接受。

### 验证状态（`bun run typecheck` + `bun test`）
- typecheck exit 0（4 个 tsc 项目）
- 552 pass / 0 fail（含 PR1 新增 15 条）

### 已踩过的坑
- **测试必须用 `bun x --bun vitest run`**（package.json 里 `test: bun x --bun vitest run`），不能用 `npx vitest` —— 后者解析不了 `bun:sqlite`，整个 db.ts 链路全 fail。
- **SQLite 不能 ALTER COLUMN nullability** —— 老 DB 已有 `workflow_run_id NOT NULL` 约束的，必须用 `CREATE TABLE __rebuild → INSERT SELECT → DROP → RENAME` 重建。我已经在 db.ts 加了 idempotent rebuild migration，PRAGMA table_info 检测到 notnull=1 才执行。

## 3. PR2 — Coordinator runner 端流式化（next）

### 范围

`apps/runner/src/agents/coordinator/llm-fallback.ts`：把 `runClaudeOneShot` / `runCodexOneShot` 从"整段 buffer"改成"chunk-by-chunk emit + 同时拿 final"。

### 改动点（按文件 + line）

**1. `apps/runner/src/agents/coordinator/llm-fallback.ts`**

入口 `classifyByLlm(input, opts)` 现在签名只接收 `ClassifyInput`，需要扩展接收 `workflowRequestId` 用于 emit channel：
```ts
export interface ClassifyByLlmOptions {
  preferredBackend?: LlmBackendKind;
  deps?: LlmFallbackDeps;
  /** PR2 NEW: when set, emit chunk-by-chunk stream events to this request channel. */
  workflowRequestId?: string;
}
```

`LlmFallbackDeps.runOneShot` 签名扩展：
```ts
runOneShot(
  backend: LlmBackendKind,
  system: string,
  user: string,
  timeoutMs: number,
  /** PR2 NEW: when set, runOneShot must emit per-line stream events. */
  emit?: (event: { type: AgentStreamEventType; payload: Record<string, unknown>; text: string | null }) => void,
): Promise<string>;
```

`DEFAULT_DEPS.runOneShot` 把 `emit` 传给 `runClaudeOneShot` / `runCodexOneShot`；测试 deps 可继续不实现 emit（向后兼容）。

`classifyByLlm` 内部：当 `opts.workflowRequestId` 有值时，构造 emit callback 调 `api.postAgentEvent({ workflowRunId: null, workflowRequestId, agentKind: chosen, ... })`，并发 `meta:cli_started` / `meta:cli_finished` / `meta:decided` 三个生命周期事件包住整个调用。

**2. `runClaudeOneShot` / `runCodexOneShot`（同文件 175-241）**

把 `runFirstCandidate(...)` 替换为新的"流式 spawn 助手"。当前 `runFirstCandidate` / `spawnCandidate`（243-351）是"收 stdout 整段拼成 raw"，**新增**一个并行的 `runFirstCandidateStreaming(backend, args, timeoutMs, { stdin, emit, onLine })`：
- 同样的候选解析、HOME 隔离、env forwarding 逻辑
- stdout 用 `createInterface({ input: child.stdout, crlfDelay: Infinity })` 行级消费（参考 `claude-code.ts:290` 的 `consumeLines`）
- 每行 push 进 buffer 用于最终拼出 `raw` 返回；同时用 `parseStreamLine`（Claude Code）/ `parseCodexJsonLine`（Codex）解析 → 调 `onLine(parsed)` 让上层 emit
- stderr 类似，但不进 raw buffer，单独 emit `type: 'stderr'`

注意 Codex 需要保留 `--output-last-message` sidecar 拿最终决策 JSON（参考 `codex.ts:175-194` 顺序）；stdout 流先消费完再 read sidecar。

**3. `apps/runner/src/agents/coordinator/index.ts:40-96`**

`triageRequest(input)` 已经接收 `workflowRequestId`（在 input 里），把它透给 `classifyByLlm({ preferredBackend, deps: input.llmDeps, workflowRequestId: input.workflowRequestId })`。

**4. `apps/runner/src/api-client.ts:419`**

`api.postAgentEvent` 已经接受 `AgentStreamEventInput`（PR1 改了 schema 后 `workflowRunId` 可为 null、可加 `workflowRequestId`），无需改 signature。但确认一下：调用方传 `null` 不会被 `workflowRunId: WorkflowRunId | null` 类型拒绝（PR1 已改）。

### 新增测试

`apps/runner/test/coordinator-llm-fallback.test.ts` 加几条：
- 当 `workflowRequestId` 给出时，`classifyByLlm` 在 LLM 调用前后发 `meta:cli_started` / `meta:cli_finished`，期间至少一条 `assistant` event（用 mock deps 验证 emit callback 被调用顺序）。
- `meta:decided` event 含最终 decision payload。
- 不给 `workflowRequestId` 时旧行为不变（既有 21 条用例不能破）。
- emit 失败（network throw）不阻塞 LLM 调用结果。

### Out of scope（PR2 内不做）

- 不改 Codex / Claude Code 的命令行参数集（保留 `--print --output-format stream-json --include-partial-messages` 等已用过的）。
- 不重写 `runFirstCandidate`（保留作为 non-streaming fallback 或留给将来；新增的是 sibling 函数）。
- 不动 web 端 / spec / db。

### 验证

```bash
bun x --bun vitest run apps/runner/test/coordinator-llm-fallback.test.ts apps/runner/test/coordinator-degraded-fallback.test.ts
bun run typecheck
bun test  # 全量回归
```

## 4. PR3 — Web 订阅 + UI 渲染

### 范围

`apps/web/src/main.ts:1016 renderCoordinatorChatPanel(request)` 当前是 polling 拉 `coordinatorChats`。改造：

- 在 request 阶段（无 workflowRunId）开 `EventSource(${API_BASE}/workflow-requests/${request.id}/agent-stream?sinceSeq=${lastSeq})`，参考 `main.ts:4901-5114` 的 `streamES` 现成模式（订阅 / `onmessage` / dedupe / `sinceSeq` resume）。
- 复用 `apps/web/src/stream-rendering.ts` 的 `buildStreamDisplayLines` 把 partial assistant text 合并成 readable 块。
- 在 Coordinator 对话气泡内或下方加 partial-text 增量渲染区（不重做整体布局）。
- triage 决定 → request 状态变为 `claimed` 且 `workflowRunId` 非空 → close 当前 EventSource、open 新的 `/workflow-runs/:id/agent-stream`（参考 `main.ts:5114`）。订阅切换不丢实时性。

### 关键缓存

现有 `streamEventsByRun: StreamEventCache<...>` (`stream-rendering.ts:21`) 是 `Map<workflowRunId, Map<sequence, T>>`。扩展为按 channel kind 区分：要么加 `streamEventsByRequest`，要么改 cache key 为 `${kind}:${id}`。后者更对称，推荐改。

### 测试

- `apps/web/test/projection.test.ts` 加 channel 切换、sinceSeq 断流恢复、partial 合并 case。

### 验证

```bash
bun x --bun vitest run apps/web/test/
bun run typecheck
```

## 5. PR4 — Spec 更新 + 兜底

按 PRD DoD 更新 3 处 spec（保持 spec 与代码一致）：

1. `.trellis/spec/runner/backend/agent-backend-runtime.md`：加一条"Coordinator triage 必须接入 agent-stream channel（按 workflowRequestId 维度），禁止 buffer-then-emit"。
2. `.trellis/spec/shared/backend/agent-backend-contract.md`：channel ID 模型新增 `workflowRequestId` 维度，`workflowRunId | workflowRequestId` 二选一约束（运行时 guard：`isAgentStreamChannel`）。
3. `.trellis/spec/web/frontend/agent-backend-ui.md`：Coordinator 对话区订阅 / channel 切换语义（request → run channel 时不丢实时性、不闪屏、`sinceSeq` resume）。
4. 必要时 `.trellis/spec/api/backend/database-guidelines.md` 记录 `agent_events.workflow_request_id` 列 + idempotent rebuild migration 的模式（用作未来类似 schema 演进的参考）。

## 6. 完成后的 trellis 收尾流程

按 workflow-state hook：
1. `trellis-implement` / `trellis-check` 所有 PR 完成。
2. `trellis-update-spec` 落 spec（PR4 已经做了；如果 spec 在实施过程中发现新约定，再补）。
3. **commit (Phase 3.4)**：main agent 驱动，按 PR 拆 4 个 commit（或按 commit style 灵活调整）。先 user-facing text 说 commit 计划，再 `git commit`。
4. `/trellis:finish-work` 归档任务。注意 finish-work 拒绝 dirty tree（`.trellis/workspace/` 和 `.trellis/tasks/` 之外的路径必须干净）。

## 7. 接手时第一件事

```bash
# 确认工作树状态
git status
git diff --stat HEAD

# 确认 PR1 仍然全绿
bun run typecheck && bun test

# 读 PRD 完整 context（不要只看本文件）
cat .trellis/tasks/05-10-coordinator-llm-web-sse/prd.md

# 开始 PR2
```

## 8. 工作流约束 reminder

- workflow-state 默认要派 `trellis-implement` sub-agent；inline override 短语必须在用户当前消息里出现（白名单：`do it inline` / `no sub-agent` / `你直接改` / `别派 sub-agent` / `main session 写就行` / `不用 sub-agent`）。本任务前两轮里我把 "你直接干" 当 override 用了；如果新 session 的用户没说 override 短语，**默认派 sub-agent**。
- task 已 `task.py start`（in_progress 状态），不需要再 start。
- 现有 in_progress 任务还有兄弟任务 `05-10-coordinator-llm-skill-prefix-json-compat`（已实现完，未 commit）—— 注意 git status 上的 modified 文件包含那个任务的成果，**不要误删**。
