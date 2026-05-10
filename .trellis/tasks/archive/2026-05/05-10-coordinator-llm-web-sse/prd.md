# Coordinator 阶段 LLM 流式过程透传到 Web SSE

## Goal

让 Web 端 "Coordinator 对话" 区域在 Coordinator 一次性 LLM 分诊（Codex / Claude Code 一次几十秒到几分钟）期间，实时看到后端 LLM 的进度（assistant text delta、tool 调用、阶段切换、最终 decision），而不是当前的"提交 → 静默 → 一次性出结果"。要严格符合 MEMORY 里"Claude Code CLI 调用必须实时流式"硬约束。

## What I already know

### 已有基建（出乎意料地完整）

- `packages/shared/src/types/agent-event.ts` 已定义 `AgentStreamEvent`：`assistant` / `system` / `user` / `result` / `stderr` / `raw` / `meta` 七种 type，含 `sequence` 单调序号、`payload`、`text`、`workflowRunId`。
- `apps/api/src/agent-stream-bus.ts` 是 in-process pub/sub。`apps/api/src/workflow-engine.ts:55,967` 的 `recordAgentEvent` 写 SQLite 同时 publish。
- `apps/api/src/routes/runner-events.ts:117-124` `POST /runner/events/agent-stream` 接收 batched / single events。
- `apps/api/src/routes/workflow-runs.ts:282-357` `GET /:id/agent-stream?sinceSeq=` SSE：先 replay history `> sinceSeq`，订阅在 history 之前以避免 race；5s ping、Bun idleTimeout 255s。
- `apps/runner/src/api-client.ts:419` runner 端 `postAgentEvent`。
- `apps/runner/src/agents/claude-code.ts:290-345` 是已有的真流式样板：`consumeLines` 从 `child.stdout` 逐行 → `parseStreamLine` → `emit()` chunk-by-chunk POST。
- `apps/web/src/main.ts:4901-5114` 已有 `EventSource` 客户端订阅 `/workflow-runs/:id/agent-stream?sinceSeq=`；`apps/web/src/stream-rendering.ts` 合并 assistant delta、boundary 行、meta 渲染。

### 关键 Gap（用户痛点根因）

1. **Coordinator 的 LLM spawn 是整段 buffer，根本没接 stream-bus。** `apps/runner/src/agents/coordinator/llm-fallback.ts:140-153` 的 `runClaudeOneShot` / `runCodexOneShot` 调 `runFirstCandidate(...)` 收 stdout 整段拼成 `raw` 再 `parseDecision`。整个 LLM 几十秒到几分钟期间没有任何 `postAgentEvent` 调用。
2. **Channel ID 协议不匹配。** `AgentStreamEvent.workflowRunId: WorkflowRunId` 必填，SSE 也是按 `workflowRunId` 路由（`workflow-runs.ts:282-357`、`agent_events` 表索引、`agent-stream-bus.ts:13` 的 `subscribers Map<string, Set>`）。但 Coordinator triage 发生在 `WorkflowRequest` 阶段，**还没有 workflow run**——`apps/runner/src/agents/coordinator/index.ts:88-89` 返回的 `CoordinatorDecision.workflowRunId === null`。
3. **前端 Coordinator 对话区是 polling 而非订阅。** `apps/web/src/main.ts:1016` 的 `renderCoordinatorChatPanel(request)` 拿的是 `coordinatorChats` 缓存（轮询填充）；现成的 `EventSource` 仅在已存在 workflowRun 后才被 attach（`main.ts:5114`）。

### 受约束的不可动项

- 不能禁用 Codex / Claude Code 的 Skill / 用户配置（已在 05-10-coordinator-llm-skill-prefix-json-compat 任务约定）。
- Coordinator decision schema (`CoordinatorDecision`、`CoordinatorAction`) 不应改变。
- 不引入新依赖。
- 不重做前端聊天组件结构（`renderCoordinatorChatPanel` 内部增量渲染可接受）。

## Assumptions (temporary)

- Bun (Hono `streamSSE`) 在 macOS / Linux dev 环境下已经稳定支持 SSE，本任务不需要切 WebSocket。
- Coordinator triage 同一时间只跑一个 LLM，不需要多路并发的复杂订阅模型（同一 `workflowRequestId` 只对应一条流）。
- Web 端 `EventSource` 已有的 `sinceSeq` resume 语义对 Coordinator 阶段同样适用（断网刷新仍可恢复 partial）。

## Resolved Questions

- **Q1 [Blocking] Channel ID 选 A1**：扩 stream channel 含 `workflowRequestId`。详见 Decision (ADR-lite)。
- **Q2 [Preference] 后端 spawn 流式实现：复用现有 `consumeLines + parse*Line + emit` 模式**。`apps/runner/src/agents/claude-code.ts:290-302` 和 `apps/runner/src/agents/codex.ts:175-184` 已是真流式样板（chunk-by-chunk POST `/runner/events/agent-stream`），Coordinator 不重写一份；区别只是不需要 artifacts / git diff / acceptEdits 这些工作流相关副作用，spawn 与流读部分共用。
- **Q3 [Preference] Codex 流式形态**：Codex 现有 `exec --json` 已是 line-delimited JSON，与 Claude Code `--output-format stream-json` 同形态，可被同样的 `consumeLines + parseCodexJsonLine` 消费。Coordinator 当前 `runCodexOneShot` (`llm-fallback.ts:212-241`) 只用 `--output-last-message` sidecar 拿 final，没读 stdout——改造方向：保留 sidecar 拿最终 JSON 决策，同时新增对 stdout 的 `consumeLines + emit` 走流式通道。

## Open Questions

(none — all blocking / preference questions resolved.)

## Requirements

- Coordinator triage 期间，Web Coordinator 对话区可以**接近实时**（< 1s 首条事件到达）看到 assistant text delta（含 partial JSON 和自然语言前缀，因 task 05-10-coordinator-llm-skill-prefix-json-compat 而成为常见形态）、阶段 meta（`cli_started` / `cli_finished` / `decided` 等）、stderr。
- Coordinator 的两个一次性 LLM 调用入口（`runClaudeOneShot` / `runCodexOneShot`，`apps/runner/src/agents/coordinator/llm-fallback.ts`）改为 chunk-by-chunk emit；不允许再"整段 buffer 后一次性发"。
- Stream channel 模型扩展到既能挂在 `workflowRunId` 也能挂在 `workflowRequestId` 上；既存 `/workflow-runs/:id/agent-stream` 行为不受影响。
- 新增 SSE 路由 `GET /workflow-requests/:id/agent-stream?sinceSeq=`，与既有 run 路由同形语义（先 replay history > sinceSeq，再订阅 live；5s ping）。
- 前端 `renderCoordinatorChatPanel` 在 request 阶段订阅 request channel；triage 决定且 workflow run 创建后，UI 切换到 run channel（不复制 events，两条流各自独立）。
- 流断开后（刷新 / 网络抖动），重连时通过 `sinceSeq=` resume，不丢失也不重复。
- 后端 raw assistant text 与前端展示给用户的"自然语言澄清问题"分层：UI 主气泡仍只展示 task 05-10-coordinator-llm-skill-prefix-json-compat 给出的自然语言 fallback；partial / raw assistant text 在 dev / 折叠区可见。

## Acceptance Criteria

- [ ] Coordinator triage 触发 1s 内 Web 端能收到第一条 `meta` 或 `assistant` 事件。
- [ ] 一次完整 triage 至少产生有序事件流：`meta:cli_started` → ≥1 条 `assistant`（partial 或完整）→ `meta:cli_finished` → `meta:decided`。
- [ ] LLM JSON 解析失败时，前端 Coordinator 主气泡仍显示自然语言澄清问题（task 05-10-coordinator-llm-skill-prefix-json-compat 的契约），同时 dev 折叠区可见 raw assistant text。
- [ ] 刷新页面（断 EventSource）后基于 `sinceSeq` 重连，能补齐期间错过的 events，不重复也不丢。
- [ ] triage 决定 → 创建 workflow run 后，UI 自动切换订阅源到 `/workflow-runs/:id/agent-stream`；切换瞬间不闪屏 / 不丢实时性。
- [ ] 既有 `apps/runner/test/coordinator-llm-fallback.test.ts`、`apps/api/test/workflow-runs-route.test.ts` 等全绿。
- [ ] 新增测试覆盖：bus 双 channel 路由、`recordAgentEvent` 接受 `workflowRequestId`、SSE request 路由 history+live race、Coordinator emit 顺序（Claude Code / Codex 双 backend）、Codex stdout 流 + sidecar 共存、Web 订阅切换 channel、断流恢复。
- [ ] `bun run typecheck` / `bun test` 通过。

## Definition of Done

- 不禁用 Skill；Coordinator 流式行为在用户安装 / 不安装 Skill 两种形态下都正常。
- 更新 spec：
  - `.trellis/spec/runner/backend/agent-backend-runtime.md`：明确 Coordinator triage 必须接入 agent-stream channel，禁止 buffer-then-emit。
  - `.trellis/spec/shared/backend/agent-backend-contract.md`：channel ID 模型新增 `workflowRequestId` 维度，`workflowRunId | workflowRequestId` 二选一约束。
  - `.trellis/spec/web/frontend/agent-backend-ui.md`：Coordinator 对话区订阅 / channel 切换语义。
  - 必要时更新 `.trellis/spec/api/backend/database-guidelines.md` 记录 `agent_events.workflow_request_id` migration。
- 按 Lore Commit Protocol 提交（按 PR 拆解分多个 commit，每个 PR 一个 commit）。Trellis 任务归档留给 finish-work。

## Out of Scope

- 不切换协议到 WebSocket。
- 不重做 Coordinator decision schema（`CoordinatorDecision` / `CoordinatorAction`）。
- 不重做 Coordinator 对话 UI 结构（`renderCoordinatorChatPanel` 内部增量渲染区可加，整体布局不动）。
- 不改 Codex / Claude Code 的命令行参数语义（仅在必要时复用 ClaudeCodeBackend / CodexBackend 已使用过的 flag 集，不新增 flag 用法）。
- 不顺手重写 `runFirstCandidate` 的命令行 / 错误聚合逻辑。
- 不做 triage events 在 run 视图回放（项 2，OUT）。
- 不做 LLM cancel / abort 协议（项 3，OUT）。
- 不做并发 retriage 服务端去重 / 替换（项 4，OUT）。
- 不做 `/coordinator/preview` 流式（项 5，OUT；preview 本来就是 rules-only / 几毫秒，无痛点）。
- 不顺手把 Router / 其他 pre-workflow-run 阶段接入 stream channel（A1 抽象天然支持但不在本任务）。
- 不引入新依赖。

## Technical Approach

按可独立 review / 可独立验证的边界拆 4 个 PR：

**PR1 — Channel 模型扩展（后端协议层，行为零变化）**
- shared: `AgentStreamEvent` 加 `workflowRequestId?: WorkflowRequestId | null`，`workflowRunId` 改可空；运行时校验"二者不能同时为空"。`AgentStreamEventInput` 同步。
- API: `agent_events` 表 migration（加 `workflow_request_id` 列 + 联合 index）；`recordAgentEvent` 接受新参数；`agent-stream-bus` subscribers map 用 `${kind}:${id}` 复合 key（`run:<id>` / `req:<id>`）。
- API: 新增 `GET /workflow-requests/:id/agent-stream?sinceSeq=` 路由，复用 `streamSSE`。
- API: `POST /runner/events/agent-stream` 接受 `workflowRequestId` 字段。
- 单测：bus 双 channel 隔离、recordAgentEvent 校验、SSE request 路由 history+live race。
- 既有 run channel 端到端不受影响（旧 events 的 `workflowRequestId === null`）。

**PR2 — Coordinator runner 端流式化**
- `apps/runner/src/agents/coordinator/llm-fallback.ts`：`runClaudeOneShot` / `runCodexOneShot` 改用 `consumeLines + parseStreamLine` / `parseCodexJsonLine` + emit 模式（复用 `claude-code.ts:290-302` / `codex.ts:175-184` 的现成函数，必要时把 `consumeLines` / parser 共享路径提到独立模块避免循环依赖）。
- 新增 `emitCoordinatorEvent({ workflowRequestId, agentKind, type, payload, text })` helper，调 `api.postAgentEvent({ workflowRequestId, ... })`。
- `triageRequest` / `classifyByLlm` 接受 `workflowRequestId`；triage 全过程发 `meta:cli_started` / 若干 `assistant` / `meta:cli_finished` / `meta:decided`（含最终 decision 摘要）。
- Codex 保留 `--output-last-message` sidecar 拿最终决策 JSON，但 stdout 流必须先消费完才 read sidecar（与 `codex.ts:175-194` 顺序一致）。
- 单测：emit 顺序、Codex 双通道、Claude Code 失败降级、CLI 不可用降级。

**PR3 — Web 订阅 + UI 渲染**
- `apps/web/src/main.ts:renderCoordinatorChatPanel`：在 request 阶段（无 workflowRunId）开 EventSource 订阅 `/workflow-requests/:id/agent-stream`，复用 `stream-rendering.ts` 的 readable 合并；在 Coordinator 对话气泡内或下方加 partial-text 增量渲染区。
- triage 决定 → 创建 workflow run 后切换订阅源到 `/workflow-runs/:id/agent-stream`；订阅切换不丢实时性。
- 复用现有 `streamEventsByRun` 模式扩展为 `streamEventsByChannel`（key 为 `${kind}:${id}`）。
- 测试：projection 测断流恢复、channel 切换、partial 合并。

**PR4 — Spec 更新 + 必要的兼容兜底**
- 更新 spec 三处（agent-backend-runtime / agent-backend-contract / agent-backend-ui），加 channel ID 模型 / Coordinator streaming 约束 / UI channel 切换语义。
- 必要时更新 `database-guidelines.md` 记录 migration。
- 验证既存 run channel 行为完全不变（spec 中明示"`workflowRunId === null` 仅出现在 pre-run 阶段"）。

## Research References

无（所有决策基于既有 repo 代码 + spec 直接 derive，未需要外部研究）。

## Technical Notes

主要文件：
- Runner: `apps/runner/src/agents/coordinator/llm-fallback.ts:107-241`、`apps/runner/src/agents/coordinator/index.ts:40-96`、`apps/runner/src/agents/claude-code.ts:171-302`（复用样板）、`apps/runner/src/agents/codex.ts:127-196`（复用样板）、`apps/runner/src/api-client.ts:419`、`apps/runner/src/agents/claude-code-parser.ts`、`apps/runner/src/agents/codex-parser.ts`。
- API: `apps/api/src/agent-stream-bus.ts`、`apps/api/src/workflow-engine.ts:967`、`apps/api/src/routes/runner-events.ts:117`、`apps/api/src/routes/workflow-runs.ts:282-357`、`apps/api/src/store/db.ts`（migration 入口）。
- Web: `apps/web/src/main.ts:1016, 3787-3899, 4901-5114`、`apps/web/src/stream-rendering.ts`、`apps/web/src/projection.ts`。
- Shared: `packages/shared/src/types/agent-event.ts`、`packages/shared/src/types/ids.ts`（`WorkflowRequestId`）。

约束 / 约定：
- MEMORY: `feedback_claude-code-cli-streaming-realtime.md` — Claude Code CLI 调用必须实时流式，行级解析，console + UI 同等延迟，禁止 buffer。
- `.trellis/spec/runner/backend/agent-backend-runtime.md`（含 Coordinator parser 容错规则）、`.trellis/spec/shared/backend/agent-backend-contract.md`（AgentStreamEvent schema）、`.trellis/spec/web/frontend/agent-backend-ui.md`（流式渲染契约）、`.trellis/spec/api/backend/coordinator-preview.md`（preview = rules-only，不要误改）。

## Decision (ADR-lite)

### D1. Channel ID 模型 (resolved)

**Context**: Coordinator triage 在 `WorkflowRequest` 阶段触发，早于 workflow run；现有 stream channel 全部按 `workflowRunId` 索引（schema NOT NULL、SSE 路由 `/workflow-runs/:id/agent-stream`、`agent-stream-bus` 用 `Map<workflowRunId, Set<Subscriber>>`）。

**Decision**: A1 — 扩展 channel 模型让一条流既能挂在 `workflowRunId` 也能挂在 `workflowRequestId` 上。具体：
- `AgentStreamEvent` 增加可空 `workflowRequestId` 字段；`workflowRunId` 改为可空（二者不能同时为空）。
- `agent_events` 表新增 `workflow_request_id` 列 + index；查询函数 `byWorkflow` 拆 / 重命名以支持两种 channel 维度。
- `agent-stream-bus` 用 channel key（`run:<id>` / `req:<id>`）做 subscribers 路由。
- 新增 SSE 路由 `GET /workflow-requests/:id/agent-stream?sinceSeq=`，复用现有 `streamSSE` 实现。
- `recordAgentEvent` 接收 `{ workflowRunId?, workflowRequestId? }` 并 publish 到对应 channel；当 triage 决定后创建 workflow run，从那一刻起 events 切回 `run:` channel（不在两个 channel 间复制 events）。

**Consequences**: schema migration 一列 + 一 index；bus 复合 key（约 30 行改动）；新增 1 条 SSE 路由（复用 streamSSE，约 80 行）；前端在 request 列表项渲染 `renderCoordinatorChatPanel` 时即可订阅，不需要等到 workflow run 创建。triage 与正式 run 是两条 channel，UI 在 run 创建后切换订阅源（`workflowRequest` 上记录 `workflowRunId` 后做切换）。未来 router / preview 等也可挂 `workflowRequestId` channel 复用同一通道。

### D2. 流式 spawn 实现 (resolved)

**Decision**: Coordinator `runClaudeOneShot` / `runCodexOneShot` 改用与 ClaudeCodeBackend / CodexBackend 同样的 `consumeLines + parse*Line + emit` 流式模式。共用 parser (`claude-code-parser.parseStreamLine` / `codex-parser.parseCodexJsonLine`)。Codex 保留 `--output-last-message` sidecar 拿最终决策 JSON，**同时**对 stdout 做行级 emit；Claude Code 的 `--print --output-format stream-json` 输出直接走 emit，最终决策从 stdout 流中提取（已有的 `extractFinalAssistantText` 仍可用）。

emit 接口：抽出共享 helper `emitCoordinatorEvent({ workflowRequestId, agentKind, ... })`，复用 `api.postAgentEvent` 但走 `workflowRequestId` channel；不引入新 API client 方法。

### D3. MVP 范围 (resolved)

**Decision**: 仅做"核心闭环"——Coordinator triage 流式 + request channel + UI 实时渲染 partial text。回放 / 取消 / 并发防御 / Router&Preview 流式均不在本任务范围（详见 Expansion Sweep 末尾的逐项裁剪）。

## Expansion Sweep (DIVERGE)

### Future evolution

- 当前只有 Coordinator triage 是 pre-workflow-run LLM 阶段；未来 Router、Preview、需求评估等也可能成为 pre-run 阶段。A1 的 channel 抽象天然支持，但是否在本任务里把 Router 也接进来需要决定。
- 当前 Coordinator 是 single-shot triage（一次 LLM → decision）；未来可能演进为多轮对话（chat-style continuation）。多轮的话每轮可以是独立 channel 子序列，schema 不需要再改。

### Related scenarios

- 切换 channel 时机：triage 决定 → 创建 workflow run → UI 切换到 `workflow-runs/:id/agent-stream`。**triage 阶段的 events 是否需要在 workflow run 视图里也能看到**？两种语义：
  - "两条独立流"：UI 在 Coordinator 对话区看 request channel，工作流面板看 run channel；triage 历史不混入 run。
  - "继承"：run 创建时把 request channel 的 events 复制 / link 到 run channel，让工作流面板能完整回放从 triage 到执行的全过程。
- 同一 `workflowRequestId` 并发 retriage（用户连续点两次"提交"）：是否需要服务端去重 / 取消上一次的 spawn？

### Failure / edge cases

- 用户在 triage 中途关闭页面 / 取消请求：后端 LLM 是否中止？目前 `triageRequest` 不接受 abort signal。是否本任务范围内做？
- SSE 断开但后端 LLM 仍在跑：现有 `sinceSeq=` resume 可用，但 Coordinator 整个 triage 通常 < 60s，重连价值有限。要不要做？
- Codex `--output-last-message` 文件最终态 vs stdout 流式 events：要不要保证 emit 顺序（stdout 流先 → 最后才 read sidecar）？这块已有实现（`codex.ts:175-194`）可参考。
- LLM 返回的 partial assistant text 含敏感字段（用户原始描述里可能有 secret）：emit 前是否走 `maskSecrets`？现有 `claude-code.ts:306` 是仅对 stderr 做 mask。

### MVP 范围 (CONVERGE) — Locked

候选项最初列了 5 条，逐项裁剪后 MVP 只保留 **项 1**：

1. **核心闭环（IN MVP）**：Coordinator triage 流式 + request channel + UI 实时渲染 partial text。
2. **Triage events 在 run 视图回放（OUT）**：仅在多人复盘场景下有强需求，目前没有报告该痛点。
3. **取消 / abort（OUT）**：triage 通常 < 60s，没有具体痛点报告；现有 `runFirstCandidate` 没 abort 协议，做起来要顺手改 spawn 协议，不值得。
4. **并发 retriage 防御（OUT）**：用户连续点两次"提交"概率小，没有具体痛点报告。
5. **顺手做 Router / Preview 流式（OUT, 撤回）**：经查 `.trellis/spec/api/backend/coordinator-preview.md`，`/coordinator/preview` 是 **rules-only, no LLM call, zero token cost**（设计上为新建任务表单的实时 hint 服务，不能 burn tokens on every keystroke debounce）——本来就是几毫秒返回，没有同步阻塞痛点。前期未读 spec 给出的推荐是错误的，撤回。
