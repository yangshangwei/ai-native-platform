# P0-1 Graph Live View：GraphRun 完成态收敛 + Web 只读投影

## Goal

把已经存在的 Graph node/event ledger 变成用户可见的运行视图。先修复 `GraphRun.status` 只在失败时收敛的缺陷，再把 API 已返回、Web 却丢弃的 `graph` 字段接进前端，让用户能看到 active node、attempt、依赖状态、首要 blocker 和 resume 位置。

来源：`.trellis/tasks/archive/2026-08/07-30-umadev/research/comparison.md` 的 P0-1 建议。

## What I already know

已核对的事实（AINP @ `21b8539`，2026-08-08 复核仍成立）：

* `apps/api/src/routes/runner-events.ts:325` — node 结束时 `status: body.status === 'failed' ? 'failed' : graphRun.status`。只有 failed 会收敛，全部节点成功后 GraphRun 永远停在 `running`。
* `apps/api/src/routes/workflow-runs.ts:173,191` — run detail 已经查询并返回 `graph`（含 `graphDefinition / graphRun / nodeRuns / events`）。
* `apps/api/src/store/store.ts:2032-2048` — `store.graphRuntime.byWorkflow()` 返回上述四元组，`graphRun` 取 `currentByWorkflow`。
* `apps/web/src/projection.ts:392-408` — `RunDetail` 接口没有 `graph` 字段，API 返回的数据在前端类型层被丢弃。同样缺失的还有 `agentSessions`。
* `apps/web/src/projection.ts:358` — `export type StepCheckpointDto = StepCheckpoint;` 说明本项目对纯数据 DTO 允许直接复用 shared 类型别名。
* `packages/shared/src/types/graph-runtime.ts:19-41` — node 状态 8 种、run 状态 6 种，已有 `isGraphNodeStatus` / `isGraphRunStatus` 守卫。
* `apps/runner/src/orchestrator/graph-scheduler.ts:10-17` — 已定义 `TERMINAL_SUCCESS` / `TERMINAL_BLOCKING` / `ACTIVE` 三组状态集合与 `latestNodeRunsByNode()`，是本任务收敛逻辑的直接语义参照。
* `apps/api/src/graph-runtime.ts:100-107` — `resumeGraphNode()` 会把 GraphRun 写回 `running`，收敛函数必须与它兼容（重开节点后聚合态要退回 running）。

## Assumptions (temporary)

* 收敛按「latest attempt per node」判定，与 `latestNodeRunsByNode()` 保持同一语义；历史 attempt 不参与聚合。
* `skipped` 是非阻塞终态（`skip_dependents` 的正常产物），不阻止 GraphRun 收敛为 `passed`。
* 本任务只做只读呈现，不引入 Web 端触发的 graph 操作（resume/retry 仍走既有 stage 级入口）。

## Open Questions

无阻塞项。两个设计分叉已按下述默认决策处理，理由记在 ADR 段。

## Requirements

### R1 — GraphRun 聚合状态收敛（shared 纯函数 + API 写入）

* 在 `packages/shared` 增加纯函数 `deriveGraphRunStatus({ nodes, nodeRuns, currentStatus })`，输入图定义节点集合与 node runs，输出 `GraphRunStatus`。
* 判定优先级（按 latest attempt per node）：
  1. 任一节点 `cancelled` → `cancelled`
  2. 任一节点 `failed` → `failed`
  3. 任一节点 `blocked` → `blocked`
  4. 任一节点处于 `pending / ready / running`，或存在尚无 run 的节点 → `running`
  5. 全部节点终态且均为 `passed / skipped` → `passed`
  6. 完全没有任何 node run → 保持 `pending`
* `apps/api/src/routes/runner-events.ts` 的 `/graph-node-finished` 用该函数替换现有三元表达式，把结果写回 `GraphRun.status`。
* 收敛为终态时插入一条 graph event 记录聚合迁移；沿用现有 `graphEvents.insert` 通道，不新增事件类型（用既有 `node_finished` 之外的最贴近类型或在 payload 标注，见 ADR-2）。
* `resumeGraphNode()` 把节点重开为 `ready` 后，聚合态需要能重新回到 `running` —— 由同一纯函数保证，不写死。

### R2 — Web 类型层接回 graph

* `apps/web/src/projection.ts` 的 `RunDetail` 增加 `graph` 字段，类型直接复用 `@ainp/shared` 的 graph runtime 类型（与 `StepCheckpointDto` 同款别名做法）。
* 字段必须容忍缺省：老 run 或未生成 graph 时 API 返回的 `graphDefinition / graphRun` 为 `null`，前端不得抛错。
* 顺带把同样被丢弃的 `agentSessions` 补上（同一处类型缺口，成本近似为零）。

### R3 — 派生只读视图模型

* 新增投影函数，从 `graph` 四元组派生 UI 需要的读模型，至少包含：
  * `activeNodes` — 当前 `running` / `ready` 的节点（label + stage + attempt）
  * `doneCount / totalCount` — 终态节点数 / 节点总数
  * `primaryBlocker` — 首个 `failed` 或 `blocked` 节点及其原因（取 node run metadata / 关联 event payload）
  * `resumable` — 是否存在带 `stepCheckpointId` 的可恢复节点及其 `resumeCursor`
  * `nodes[]` — 每节点的 latest run 状态、attempt、上下游依赖、`stepRunId`
* 投影必须是纯函数并可单测，不在渲染函数里内联计算。

### R4 — UI 呈现

* 任务详情页顶部摘要区：显示 active node、`done/total`、attempt、首要 blocker、resume 状态。
* 详情区：展示节点依赖关系、graph events 时间线、checkpoint 与 evidence 关联。
* 无 graph 数据时整块静默隐藏，不显示空壳。
* 沿用 `page-task-detail.ts` 既有渲染风格与 `render-core.ts` 的 DOM 构造方式，不引入新渲染框架。

### R5 — 测试

* `packages/shared` 补 `deriveGraphRunStatus` 单测：覆盖 6 条判定分支 + resume 后回到 running + 空 node runs。
* API 侧补 `/graph-node-finished` 收敛测试：全节点成功 → `passed`；中途失败 → `failed`。
* Web 侧补投影函数单测：active/blocker/resume/计数派生。

## Acceptance Criteria

* [ ] 全部节点成功结束后 `GraphRun.status` 收敛为 `passed`，不再停留在 `running`。
* [ ] 失败、阻塞、取消路径的聚合状态与 R1 判定表一致。
* [ ] `resumeGraphNode()` 重开节点后聚合状态回到 `running`。
* [ ] `RunDetail.graph` 在前端类型层存在，且 `graphDefinition=null` 时页面正常渲染。
* [ ] 任务详情页能看到 active node / done-total / attempt / 首要 blocker / resume 状态。
* [ ] 新增单测全部通过，`npm test` 与 type-check 无回归。

## Definition of Done

* type-check 与相关测试全绿，且贴出实际输出。
  * 修正：本仓库没有 lint 配置（无 eslint / biome / oxlint，各包只有 `typecheck` 脚本），DoD 初稿里的「lint 全绿」不适用。质量门是 `npm run typecheck` + `npm test`。
  * 测试必须在 bun runtime 下跑：`npm test`（= `bun x --bun vitest run`）或 `bun test`。`npx vitest` 会因 `bun:sqlite` 无法解析而把整个 suite 报成 skipped。
* 未新增 `execution_plan` 之类的第二真相 artifact。
* Web 只做只读渲染，未新增 graph 写操作入口。

## Out of Scope

* 不实现 node retry / join / failure policy 的 runtime enforcement（属 P1-1 及后续）。
* 不做 run-specific graph authoring 或分支/并行图。
* 不改 `graph-adapter.ts` 的线性图生成逻辑。
* 不填 `inputSelectors / outputNames`（属 P1-1 EvidenceContract）。
* 不引入装饰性团队 roster —— 节点 owner 只能来自真实 AgentSession / Handoff。

## Technical Approach

分三层落地，每层可独立验证：

1. **shared 层**：纯函数 `deriveGraphRunStatus`，语义对齐 `graph-scheduler.ts` 已有的三组状态集合，避免第二套状态语义。
2. **API 层**：`/graph-node-finished` 调用该函数写回聚合态；写入仍在既有 try/catch 事务边界内。
3. **Web 层**：类型补齐 → 纯投影函数 → 渲染。渲染只消费投影结果。

## Decision (ADR-lite)

### ADR-1：持久化收敛，而不是纯派生读模型

**Context**：研究文档给了两个选项 —— 修 `GraphRun.status` 持久化收敛，或从 node runs 派生 aggregate read model。

**Decision**：持久化收敛，但收敛逻辑抽成 shared 纯函数供读侧复用。

**Rationale**：`GraphRun.status` 已经是持久字段且失败路径已经在写它。若改成纯派生，同一字段会出现两种真相（DB 里的 `failed` vs 派生出的 `passed`），比现状更糟。抽纯函数保证写侧与读侧用同一份判定。

**Consequences**：需要保证 `resumeGraphNode()` 等其他 GraphRun 写者与该函数语义一致；已在 R1 显式覆盖。

### ADR-2：不新增 graph event 类型

**Context**：聚合状态迁移是否值得一个新的 `GRAPH_EVENT_TYPES` 成员。

**Decision**：本轮不加。聚合迁移信息写进既有事件的 payload。

**Rationale**：`GRAPH_EVENT_TYPES` 是 shared 常量数组，新增成员会波及类型守卫、持久化校验和可能的历史数据兼容。P0-1 的目标是「把已有事实露出来」，不是扩协议。

**Consequences**：若后续 P1 需要独立订阅聚合迁移，再单独提案加类型。

## Technical Notes

* `graph-scheduler.ts:10-17` 的三组状态集合是 runner 侧的调度语义；新纯函数放 shared，两边最终应指向同一组常量，避免语义漂移。
* `store.graphRuntime.byWorkflow()` 用 `currentByWorkflow` 取 graphRun，同一 workflow 可能有历史 graphRun；投影只消费 current。
* `apps/web/src/projection.ts` 的 `AuditEntryDto` 注释记录了「wire contract → shared」的既有技术债模式；本任务新增的 graph DTO 直接复用 shared 类型，不制造同类债。

## 实施中发现的问题（已修，记录以免复发）

### 1. `metadata.error` 契约错配 —— 测试验证了臆想而非真实契约

首版 `graphNodeFailureReason` 读 `metadata.failureReason` / `metadata.reason`，但 runner 实际写的是 **`metadata.error`**（`apps/runner/src/orchestrator.ts:428`，`recordGraphNodeFailure`）。生产中 `primaryBlocker.reason` 恒为 `null`，摘要条里「首要阻塞：X — 原因」的后半句永远不出现。

测试之所以是绿的，是因为 fixture 用了实现者自己假设的 key —— 测试在验证实现的假设，而不是跨模块的真实契约。**教训**：为跨模块字段写测试时，fixture 的 key 必须从真实写入方抄，不能从读取方的期望反推。

### 2. `statusKind()` 不认识 `blocked` / `skipped` / `ready`

共享的 `statusKind()` 只覆盖 passed/failed/cancelled/running/pending。首版直接 `pill(node.status)` 会把**已阻塞节点渲染成中性灰**，与已跳过节点视觉上无法区分 —— 首要 blocker 在详情区完全不突出。已补 `GRAPH_NODE_STATUS_LABELS`（8 态中文）+ `graphNodeStatusKind`（blocked→warn、failed/cancelled→bad、ready/running→info）。

### 3. graph event payload 默认全展示

首版 `JSON.stringify(event.payload)`。核查后确认当前四个写入点的 payload 只含 id / status / graphVersion / actor，**当下无实际泄漏**；但「默认全部展示」意味着未来任何写入方加字段都会自动出现在 UI 且无人察觉。已改为白名单 `GRAPH_EVENT_PAYLOAD_FIELDS`，非白名单字段只显示「+N 个未展示字段」（不静默截断）。这是默认拒绝，不依赖 P1-3。

### 4. 死代码：三种 event 类型没有生产写入方

首版有一条「从 event payload 回退取 reason」的分支。核实 7 种 `GRAPH_EVENT_TYPES` 的生产写入方数量：`graph_planned` 1、`node_started` 1、`node_finished` 1、`resume_requested` 1，而 **`node_scheduled` / `node_blocked` / `join_evaluated` 均为 0**。该回退永不触发，已删除。这也印证了研究文档「Graph 的声明能力远大于当前生产语义」的判断。

## 已知残留（不在本任务范围）

~~`/graph-node-started` 不重算聚合态~~ —— **此条已作废，见下方更正**。

### 更正（2026-08-08，提交后回查发现）

上面这条残留在本任务收尾阶段**已经被修掉**了，但主线程没有察觉，导致：

* commit `9406361` 的 message 里写了 "Known gap: `/graph-node-started` does not recompute the aggregate" —— 与它自己包含的代码矛盾；
* `.trellis/spec/shared/backend/quality-guidelines.md` 的 caller 表格漏了第三个写者，正文还写着 "Both writers"；
* 主线程向用户报告的测试数是 `1304`，而提交内容实际是 `1305`。

**真实状态**：`/graph-node-started` 在 `runner-events.ts:270` 调用 `deriveGraphRunStatus`，三个 GraphRun 写者已全部统一。该处的单调性由判定优先级保证 —— 阻塞态优先级高于活跃态，所以重开节点只能把 `passed` 拉回 `running`，不可能把失败的图变成健康的。

**根因（流程，不是代码）**：主线程在 22:27:50 跑完验证后，等待用户确认提交计划；这期间后台子代理仍在写文件；主线程 `git add` 前没有重新确认工作树，直接复用了几分钟前的验证结果。

**已改的习惯**：`git add` 之前必须重跑验证，不复用等待用户确认之前的结果。
