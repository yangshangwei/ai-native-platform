# Research: 性能审计（第二轮架构优化）

- **Query**: api 热路径 / web 渲染模型 / runner 轮询与循环 await / 数据增长面
- **Scope**: internal（代码扫描 + 本机线上 DB 实测）
- **Date**: 2026-06-12

实测基线（`~/.ai-native/ainp.sqlite`，38 个 run 后）：DB 20MB + WAL 4MB；`agent_events` 19,061 行 ≈ 10.6MB（占 DB 一半以上），单 run 最高 4,471 个事件 / 1.4MB 文本；`audit_log` 1,087 行；`agent_tasks` 单 run prompt 总量最高 ~23KB；`artifacts` 目录仅 888KB，`worktrees` 304MB（已有 cleanup 开关）。

---

## 按影响排序的发现

### P1 — web：SSE 每事件全量重建 stream body（真实 O(n²)）

- 证据：`apps/web/src/stream.ts:245-260` `refreshStreamViewsForChannel` 对每条 SSE 事件执行 `body.replaceChildren(...renderStreamBodyChildren(view))`；`renderStreamBodyChildren` 经 `buildAgentStreamView`（stream.ts:105-125）→ `streamEventsForChannel`（`stream-rendering.ts:101-106`，每次对整个缓存做 `sort`）→ `buildStreamDisplayLines`（stream-rendering.ts:129-180，遍历全部事件）。
- 影响量级：缓存上限 1,000 条（`stream-rendering.ts:82` `maxEvents = 1_000`）。重连/首次进入一个 4,471 事件的 run 时，SSE history replay 逐条触发——每条事件做一次"全量排序 + 全量行合并 + 全量 DOM 重建"，最坏约 10^6 量级 DOM 节点创建，主线程明显卡顿；live tail 阶段 Claude Code 高频 delta 也持续触发。
- 附带：`rememberStreamEventInCache` 超限淘汰用 `[...events.keys()].sort()`（stream-rendering.ts:93-97），每条事件 O(n log n)，被 1,000 上限封顶，次要。
- 建议（值得做）：增量 append——已渲染行数/最后序号缓存在 body dataset 上，新事件只 append 新行（assistant 合并行只 patch 最后一行）；或最简方案：history replay 期间节流（如 100ms 合帧再重建一次）。此路径完全在 stream.ts 原地 patch 区域内，不触碰 capture/restore spec 契约。

### P2 — web：3 秒轮询每 tick 触发 2 次 render() 全树重建

- 证据：`apps/web/src/main.ts:93-101` 轮询循环里 `loadData({ render: true, keepDetail: true })` 末尾 render()（`data-loading.ts:98`），紧接 `loadRunDetail(ui.activeRunId, true)` 再 render() 一次（`data-loading.ts:115`）。task-detail 页（`page-task-detail.ts` 1,933 行、约 330 处 `el(` 构建点）单次重建数千 DOM 节点（stream body 最多 1,000 行 × 3 节点 + artifact 预览 + audit/commands 列表），外加 `render-core.ts:41-74` 的 4 组 capture/restore `querySelectorAll` 全树扫描。
- 影响量级：每 3 秒 2 次全树 teardown/rebuild；在长 run 详情页是当前最大的稳定 CPU 开销，但单次重建在现代浏览器约几十 ms，尚未到不可用。
- 建议（值得做，低成本）：① 轮询路径里 `loadRunDetail(ui.activeRunId, true)` 改传 `false`，每 tick 只 render 一次（一行改动）；② loadData 拿到的 JSON 与上次做浅比较（字符串比较即可），无变化跳过 render。**不值得做**：改造 render() 为细粒度 diff/patch——capture/restore 是 `.trellis/spec/web/frontend/state-management.md` 的 spec 契约，重写渲染层成本远超 MVP 收益。
- 轮询载荷现状：每 tick 6 个请求（data-loading.ts:64-76）+ run 详情聚合（`workflow-runs.ts:124-153`，11 张表）。`GET /workflow-runs` 无分页全量返回（`workflow-runs.ts:28-34`、`store.ts:272`），当前 38 个 run 载荷仅几 KB，量级可接受，但随 run 数线性增长（见 P5）。context-governance 在 web 侧按 runId 缓存（`data-loading.ts:118-133` `ensureContextGovernance`），**不在**轮询热路径上——服务端 `buildContextGovernanceReadModel`（`context-governance.ts:107-157`）虽然每请求全量重算并逐个读盘 JSON.parse artifact 文件（context-governance.ts:211-220），但每个 run 每会话只调一次，现阶段无需缓存。

### P3 — runner→api：agent 事件逐条 HTTP POST（API 已支持批量但未用）

- 证据：`apps/runner/src/agents/cli-common.ts:160-181` `createAgentEventEmitter` 每条解析出的 stream-json 行单独 `await api.postAgentEvent(...)`；而 API 端 `apps/api/src/routes/runner-events.ts:118-138` 早已接受 `{ events: [...] }` 批量数组。每条事件在 API 侧执行 `nextSequence`（`store.ts:1323-1332`，SELECT MAX，有 `(workflow_run_id, sequence)` 索引）+ INSERT，批量路径也是逐条 `inputs.map(recordAgentEvent)`、无事务包裹。
- 影响量级：单 run 实测 4,471 次串行 HTTP 往返。本机 localhost 下每次 ~1ms 级，总计数秒额外延迟摊在整个 run 期间；非瓶颈但是最容易消除的系统性开销。
- 建议（值得做，注意约束）：runner 侧 100-200ms 微批 flush（项目记忆里有"CLI 流式必须实时"的硬要求，微批窗口要小到不损实时感）；API 批量入口加 `db.transaction()` 包裹。
- `recordKnowledgeReviewSignals` 核实：`apps/runner/src/orchestrator/invoke-skill.ts:122-153` 确实在循环中逐条 `await deps.recordKnowledgeAction`（每 signal 一次 HTTP POST）；但 calibrationSignals 每个 context pack 只有个位数条、每次 skill 调用执行一次，**量级小，不值得改**。同文件 `recordSelectedKnowledgeUsage`（invoke-skill.ts:298-318）已是单次批量调用，无问题。`steps.ts:404/436/577/629` 的循环 await（promote drafts、postArtifact per output）每 stage 个位数次，同样不构成瓶颈。

### P4 — api：bun:sqlite 每次调用重新 prepare（确认属实，但量级低）

- 证据：`apps/api/src/store/store.ts:66-115` `upsertRow`/`insertRow`/`countRows` 与 `defineTable` 的 `one`/`all`/`byId`/`hasId` 全部走 `db.prepare(sql)`。bun:sqlite 语义：`db.prepare()` 每次新建 statement 不缓存，`db.query()` 才在 Database 上按 SQL 串缓存。即所有读写每次调用都重编译 SQL。
- 影响量级：web 轮询每 3 秒触发约 20 次 prepare（6 请求 + run 详情 11 张表）；agent 事件入库每条 2 次。SQLite prepare 为微秒级，当前总开销可忽略。
- 建议（顺手做）：`defineTable` 内把 `db.prepare` 换成 `db.query`（固定 SQL 串天然适配其缓存键），一处改动覆盖全部表工厂；动态拼列的 `upsertRow`/`insertRow` SQL 形状固定（列序由 toRow 决定），同样可受益。非紧急。
- list 端点核实：所有 `byWorkflow`/`byProject`/`byStatus` 均是带索引的 SQL WHERE（db.ts:108/122/132/155/337 等），**没有**全表扫描 + 内存过滤模式；唯一全量扫描是 `GET /workflow-runs` 与 `GET /workflow-requests` 的 `values()` 无分页（见 P2/P5）。SSE tail（workflow-runs.ts:403-479）历史回放走索引查询 + 内存订阅 bus + 5s ping，无轮询 DB 成本，设计健康。

### P5 — 数据增长面：agent_events 无清理策略，是唯一的真实增长点

- 证据：全仓库（apps/api/src）只有 `projects` 和 `config_overrides` 两处 DELETE（store.ts:201、store.ts:1711）；`agent_events`/`audit_log`/`command_runs`/`workflow_actions`/`config_audit` 均只增不删。实测 38 run = 19k 事件 / 10.6MB（DB 总 20MB），平均 ~500 事件、~280KB/run。
- 影响量级：线性外推 1,000 run ≈ 500k 行 / ~300MB。对带索引的按 run 查询无影响；真正受影响的是 ① `GET /workflow-runs` 全量列表（载荷与扫描随 run 数线性涨，每 3 秒被每个打开的 tab 拉一次）② DB 文件本身。`audit_log`/`command_runs`/`workflow_actions` 实测每 run 几十行 / 几 KB，五年内不构成问题。artifact 文件目录 888KB，远小于 worktrees 304MB（后者已有 `keepWorktree` cleanup 开关，orchestrator.ts:126）。
- 建议：MVP 阶段只做两件事——`GET /workflow-runs` 加 `?limit=`（默认 100，按 created_at DESC）；写一条文档化的运维 SQL（删除 N 天前 completed run 的 agent_events）。**不值得做**：自动 retention 调度器。

### 不构成问题（已核实排除）

- runner watch 轮询：默认 2,000ms（`packages/shared/src/config/defaults.ts:252`），每 tick 一次 `GET /workflow-requests?status=pending`（watch.ts:214），命中 `idx_workflow_requests_status` 索引，开销可忽略。
- context/builder pack 组装：`apps/runner/src/context/builder.ts` 全部是对 knowledge/input artifacts 的内存 map/filter（最大循环在 667-757 行的 evidence 对账），每个 skill 调用执行一次、输入量为个位数到几十个 artifact，非热路径。
- `context-governance.ts:327-345` `summarizeSourceRefs` 里 `unique([...current.x, item])` 的重复展开是 O(n²) 形状，但 n = manifest 项数（几十），可忽略。
- run 详情聚合端点（workflow-runs.ts:124-153）11 次索引查询/请求，单请求毫秒级，健康。

## Related Specs

- `.trellis/spec/web/frontend/state-management.md` — render() capture/restore 三契约（IME 推迟 / details 状态 / 滚动位置），P2 中"不重写渲染层"判断的依据。
- `.trellis/spec/api/backend/database.md` — 迁移纪律（新 schema 变更必须走 MIGRATIONS 编号项）。

## Caveats

- bun:sqlite 的 prepare/query 缓存语义基于 Bun 官方文档结论（`Database.query()` 缓存编译结果、`prepare()` 不缓存），未在本仓库内做基准测试实测差值；鉴于量级判断为"微秒级、可忽略"，不影响结论排序。
- DOM 节点数为按代码结构的估算（未跑浏览器 profiler）；P1/P2 的"卡顿"判断基于事件量实测（4,471/run）与重建模式推导。
