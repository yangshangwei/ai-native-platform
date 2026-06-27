# Graph Runtime MVP — 改动报告 & 自测报告

> Task: `06-28-graph-runtime-api-ledger`（标题已校正为「Graph Runtime MVP verification & R5 authority guard」）
> Date: 2026-06-28 · Branch: `feat/context-injection-layer-mvp`

---

## 1. 核心结论

**任务前提已过时。** 三份规划文档（`docs/2026-06-27-graph-runtime-*.md`）把 Epic A/B 标为已完成、C–F 待开发；但实际代码库中 **Graph Runtime MVP（Epic C/D/E/F）早已实现、已接线进真实派发路径、且全绿** —— 由更早的提交 `42d8a89 Make failed graph nodes resumable from checkpoint evidence` 及其前序提交完成，这些提交**早于**「deepen tasks to implementation-ready」文档（`8019a1c`）。

因此本次不做重复的绿地开发，而是：**① 逐条验证 R1–R6/R10 验收信号 → ② 补一条唯一真实缺失的守护测试（R5 权威边界正向断言）→ ③ 跑全量自测 + 确定性端到端（eval）→ ④ 产出本报告。**

---

## 2. 既有实现盘点（验证，无改动）

| Epic | 需求 | 实现位置 | 验收测试 |
|---|---|---|---|
| A 共享类型/guard | R1/R4 基础 | `packages/shared/src/types/graph-runtime.ts` | `graph-runtime.test.ts` |
| B flow→graph 适配器 | R1 | `packages/shared/src/flows/graph-adapter.ts` | `flow-graph-adapter.test.ts`（4 flow topo 等价）|
| C1 ledger 表 | R4 | `apps/api/src/store/db.ts` migration **v29**（`graph_definitions`/`graph_runs`/`graph_node_runs`/`graph_events` + 唯一索引 `(graph_run_id,node_id,attempt)`）| `db-migrations.test.ts`（legacy↔fresh 等价 + takeover）|
| C2 读模型 | R4 | `apps/api/src/graph-runtime.ts` + `store.graphRuntime.byWorkflow` | route：ledger 持久化 + checkpoint 链接 |
| C3 读路由 | R4 | `GET /workflow-runs/:id/graph` | route：legacy → `{graphRun:null,nodes:[]}` |
| C4 节点↔step/checkpoint 链接 | R4 | `validateGraphNodeRunLinks`（store.ts）| route：跨 workflow stepRun 拒绝 |
| D1 调度器（纯函数）| R1 | `apps/runner/src/orchestrator/graph-scheduler.ts` `computeRunnableGraphNodes` | `graph-scheduler.test.ts`（5 例：单就绪/前驱门控/startStage 切片/ready resume/版本不匹配）|
| D2/D3 接线派发 + 事件 | R1 | `cmdOrchestrate` 主循环（orchestrator.ts:209–284）+ `runner-events` `/graph-run-started`,`/graph-node-started`,`/graph-node-finished` | route：runner graph events 入读模型 |
| E1/E2/E3 resume + facade | R2/R3/R10 | `resumeGraphNode` / `POST /…/graph/resume-node` / `resumeGraphStage` | route：resume 创建 attempt+1·拒绝 completed+无效 cursor·retry-step facade |
| F1–F3 eval fixtures | R6 | `eval/scenarios/graph-runtime-fixture.json`（+ red）+ `eval-harness.ts` | `bun run eval` 绿 / scenarios-red 设计性失败 |

### R↔验收信号追溯（全部有测试背书）
- **R1 线性等价**：adapter 测试 + scheduler 测试 + eval `linear_equivalence`（topo 序 == FLOW_REGISTRY 序，runnable=[implementation]）。
- **R2 节点级恢复**：route「failed checkpointed node → attempt2/ready」+ eval `failed_resume`（resumeAttempt=2, sourceCheckpointLinked）。
- **R3 幂等/不静默重跑**：route「拒绝 completed（cannot resume completed）+ 无效 cursor 400」+ eval `completed-resume-rejected`；attempt 作用域 `idempotencyKey` + 唯一索引。
- **R4 持久化 ledger**：route legacy 空降级 + ledger 往返 + 跨 workflow 拒绝 + db-migrations 等价。
- **R5 权威保持**：见 §3（本次新增正向守护）。
- **R6 确定性 eval**：绿 16/16 + 红 4/4 设计性失败。
- **R10 retry-step facade**：route「retry-step → graph resume attempt（graph 存在时）」。

---

## 3. 本次唯一代码改动（R5 守护测试）

**缺口**：R5（权威边界）是用户最强调的红线（「绝不写 `WorkflowRun.status`／绝不判 gate pass/fail」）。既有套件覆盖了「Workflow/Gate Engine 测试不变且全绿」，但**没有一条正向断言**「执行一次 graph 节点 resume 后 `WorkflowRun.status` 与 `GateRun` 裁决保持不变」。

**改动**：`apps/api/test/workflow-runs-route.test.ts` 新增 1 条测试
`graph resume preserves Workflow Engine and Gate Engine authority (R5)`：
1. resume 前快照 `GET /workflow-runs/:id` 的 `run.status` 与 `gates`；
2. 构造 failed + checkpoint 的节点，`POST /…/graph/resume-node`；
3. 断言：graph 侧产生 attempt=2/ready（graph 自有状态，允许）；
4. 断言：`run.status` 不变、`gates` 仍为空（Workflow/Gate 权威未被触碰）。

**为何只加这一条**：R3「唯一索引抛错」式测试不成立（store `upsertRow` 用 `INSERT OR REPLACE`，重复键坍缩为最新而非抛错），且 R3 核心验收已被覆盖，故不加（避免测实现细节）。`cmdOrchestrate` 重度集成测试不补——该循环依赖模块级单例（`api`/`env`/`selectAgentBackend`）+ 真实步骤实现，本仓库刻意以「纯函数分测 + eval 确定性 fixture」覆盖其组成，强行 mock-everything 会违背既有测试架构。

代码权威边界复核（无改动，仅确认）：`resumeGraphNode` 与 runner-events 三个 graph handler 均**只**写 `graph_*` 表 + `audit` + `graphEvents`，只读 `workflowRuns.get` 做存在校验，**从不写 `WorkflowRun.status`**，亦不产生/篡改 `GateRun`。R5 在所有 graph 代码路径成立。

---

## 4. 自测报告（全绿）

| # | 命令 | 结果 |
|---|---|---|
| 1 | `bun test packages/shared/test` | **117 pass / 0 fail**（20 文件，451 expect）|
| 2 | `bun x --bun vitest run apps/api apps/runner` | **67 文件 / 650 tests pass**（基线 649 + 本次新增 1）|
| 3 | `bun run eval` | **7 scenarios / 16 variants / 16 pass / 0 fail**（含 graph-runtime-fixture 3 variants）|
| 4 | `bun run eval -- --scenario-dir eval/scenarios-red` | **4/4 fail（预期）** —— 负向 fixture 必须失败方证明不变量（含 graph-runtime-bad-expectation）|
| 5 | `bun run typecheck` | **EXIT 0**（shared/api/runner/web 四 tsconfig 全过）|

端到端（确定性、无外部 CLI）：eval `graph_runtime_fixture` 串起 `flowToGraphDefinition → graphStageOrder → computeRunnableGraphNodes → resumeGraphNode → graph_events/ledger` 全链路；全量 650 测试均在「graph 已接线」的 orchestrator 模块下运行，构成真实派发路径的回归证据。

---

## 5. 约束自检（全部满足）

- 权威边界：未写 `WorkflowRun.status`、未判 gate、未让 Runner 直写 DB —— 本次仅加测试，且新增测试正是固化此红线。✅
- 持久化只增不改：未动任何 migration（v29 早已存在）。✅
- 行为等价：未改任何 flow / skill / gate / report 代码；4 条 flow 证据与 stage 顺序不变（650 测试全绿）。✅
- 确定性：未引入 `Date.now()`/随机到纯函数路径。✅
- 并发安全：提交仅暂存本任务文件，显式排除并发会话的 `.trellis/tasks/06-27-context-flow-panel/*`。✅

## 6. 后续（post-MVP，未做）
Epic G/H/I（分支扇出 / 汇合 join / 人工中断恢复）——规划文档明确列为 post-MVP，本次不涉及。共享契约（`GraphJoinPolicy`/`GraphEdgeMode`/`GraphEvent` 等）已为其预留。
