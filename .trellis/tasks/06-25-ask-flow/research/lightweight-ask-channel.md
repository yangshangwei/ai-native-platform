# 研究：轻量只读问答旁路落点

> 目标：做一条「只读问答旁路」——复用现有对话能力，但**不在任务列表/工作台里留下 workflow_request 条目**。本文梳理 request→run→chat 数据流、任务列表数据来源，并给出 2-3 个可选落点。仅调研，不改代码。

---

## 1. 现有 request → run → chat 数据流

### 1.1 三个实体的关系

| 实体 | 表 | 何时创建 | 作用 |
|------|----|---------|------|
| **workflow_request** | `workflow_requests` | `POST /workflow-requests` 时立即创建 | 待办队列条目，runner 从这里 pick up |
| **workflow_run** | `workflow_runs` | runner claim 后、orchestrate 阶段才创建（`createWorkflowRun`，由 runner 经 `/runner/events/*` 触发） | 真正的执行实例（stages / gates / artifacts 挂这里） |
| **chat 消息** | `workflow_request_messages` + `coordinator_decisions` | 创建 request 时可带 firstMessage；之后经 `POST /workflow-requests/:id/messages` 追加 | 对话 transcript，**全部以 `workflowRequestId` 为外键**，run 不存 chat |

关键：**chat 完全挂在 request 上，不挂 run**。即使 run 已创建，chat 仍按 requestId 查询。

### 1.2 POST /workflow-requests handler

`apps/api/src/routes/workflow-requests.ts:56-144`：

1. 校验 project（存在/未归档/已配 agentBackend）+ title 非空。
2. 校验 `firstMessage`（role ∈ {user, coordinator}，content 非空）——**在任何 DB 写之前**，保证原子性。
3. 校验可选 `flowId` / `startStage` UI 覆盖。
4. 调 `createWorkflowRequest(...)`（`workflow-engine.ts:149-207`）：
   - `newId('wreq')`，status=`'pending'`，workflowRunId=`null`。
   - 若带 firstMessage，用 `db.transaction()` 把 request + 第一条 `RequestMessage` **同事务**写入（`store.workflowRequests.set` + `store.requestMessages.insert`）。
   - 否则只写 request。
   - 写一条 `audit(null, 'workflow_request.created', ...)`。
   - **不创建 workflow_run**（run 由 runner 后续创建）。
5. 返回 201 + request。

### 1.3 coordinator chat 相关

- **写消息**：`POST /workflow-requests/:id/messages`（`routes/workflow-request-chat.ts:50-78`，挂在 `app.route('/', workflowRequestChat)` 即根路径）→ `store.requestMessages.insert`。
- **读消息**：`GET /workflow-requests/:id/messages`（同文件 80-88）→ 返回 `{ messages, decision, status }`，`decision = store.coordinatorDecisions.latestForRequest(id)`。
- **写决策**：`POST /coordinator-decisions`（同文件 117-142），runner triage 后回填。
- **状态机**：`PATCH /workflow-requests/:id/status`（90-115），白名单 `ALLOWED_TRANSITIONS`；用户回复后 web 端把状态 bounce 回 `pending` 让 runner 重新 triage（`coordinator-chat.ts:244-249 sendCoordinatorReply`）。
- **前端**：`loadCoordinatorChat(requestId)`（`apps/web/src/coordinator-chat.ts:184`）轮询 `/messages`，当 status ∈ {pending, awaiting_clarification} 时 1.5s 续询。
- **另有 `/coordinator/preview`**（`routes/coordinator.ts`）：纯只读 dry-run 规则分类器，**无 DB 写、无 LLM**，仅给 new-task UI 预览 runType。它跟 chat 无关，但证明「无副作用的 coordinator 端点」已有先例。

### 1.4 LLM 对话能力在哪

实际对话/分类发生在 **runner 侧**：
- `apps/runner/src/agents/coordinator/`（`index.ts:triageRequest` / `llm-fallback.ts:classifyByLlm`）。
- `llm-fallback.ts` 通过 spawn `claude` / `codex` CLI 跑 one-shot，支持把流式事件经 `api.postAgentEvent` 推到 **request channel**（`workflowRequestId`）。
- 触发入口只有 watch loop 的 `defaultTriage`（见 §3）。**没有**独立的「纯聊天不分类」入口——现有 LLM 调用都绑定 triage 决策语义。

### 1.5 agent_events（流式）双通道

`agent_events` 表有 `workflow_run_id` 和 `workflow_request_id` 两列，**互斥**（`recordAgentEvent` 在 `workflow-engine.ts:1123` 强制 exactly-one；DB 不做 CHECK）。
- request channel SSE：`GET /workflow-requests/:id/agent-stream`（`workflow-requests.ts:228`）。
- run channel SSE：`/workflow-runs/:id/agent-stream`。
- 序列号按 channel 独立递增。
- 这意味着**流式对话能力本身已经能脱离 run、只挂在 request 上工作**。

---

## 2. 任务列表（工作台）的数据来源

### 2.1 唯一数据源：`GET /workflow-requests`（无 filter）

`apps/web/src/data-loading.ts:79`：
```
api<{ items: WorkflowRequestDto[] }>('/workflow-requests') -> data.requests
api<{ items: WorkflowRunDto[] }>('/workflow-runs')         -> data.runs
```
`GET /workflow-requests`（`workflow-requests.ts:41-48`）默认 `store.workflowRequests.values()`（按 created_at 全量返回），可选 `?status=` 过滤。

### 2.2 各页面如何用 `data.requests`

- **工作台 `page-workbench.ts`**：
  - `renderWorkbenchOverviewPanel`（165）：`activeRequests = data.requests.filter(status ∈ {pending,claimed})`；`totalTasks = data.requests.length`（「任务总数」卡片）。
  - `renderTodosAlert` 用 `myTodosCount()`。
- **我的待办 `page-my-todos.ts`**：`myTodos()`（`state.ts:236`）= `data.requests.filter(status ∈ {awaiting_clarification, failed})`。
- **报表 `page-reports.ts`**：主要按 `data.runs`，但 184 行用 `data.requests.find(r.workflowRunId === run.id)` 关联 request。

### 2.3 「不进任务列表」的精确含义

任务列表 = 从 `GET /workflow-requests` 拿到的全部 `workflow_requests` 行。所以「不进任务列表」 = **不在 `workflow_requests` 表里留可见行**，或留下但被列表查询/前端过滤排除。具体可通过：
- (a) 根本不写 `workflow_requests`；或
- (b) 写一个带「问答」标记的特殊行，并在 `GET /workflow-requests` 默认查询 + 前端 `data.requests` 消费处统一排除该标记。

---

## 3. runner watch loop 如何 pick up

`apps/runner/src/cmd/watch.ts`：
- `cmdWatch` 循环调 `processNextWorkflowRequest`，`listPending: api.listWorkflowRequests({ status: 'pending' })`（即 `GET /workflow-requests?status=pending`）。
- 取第一个 pending → 若 `flowId` 已固定则跳过 coordinator，否则 `defaultTriage`（跑 LLM、回填 decision、必要时发问题并置 `awaiting_clarification`）→ `claim`（原子 `claimIfPending`）→ `orchestrate`（创建 run、跑 stages）→ `complete`。

**结论**：runner 只认 `status='pending'` 的 `workflow_requests` 行。只要旁路不写 status=pending 的行（或写一个 watch loop 查询会排除的标记/状态），runner 永不会执行它——这正是「只读旁路」想要的。

---

## 4. 可选落点（2-3 个）

### 落点 A：全新独立的「ask」端点 + 临时（非持久 / 独立表）会话——推荐

**做法**：新增 `POST /ask`（或 `/coordinator/ask`），完全不碰 `workflow_requests`。
- 对话消息存到**新表**（如 `ask_sessions` / `ask_messages`）或干脆不落库（一次性 request→response），与 workflow_request_messages 解耦。
- 复用 LLM 能力：可走 runner 侧 `llm-fallback.classifyByLlm` 的纯 one-shot 路径（去掉 triage 决策语义），或新增一个「纯问答」runner 任务类型。
- 流式：若要复用 SSE，可单独为 ask channel 加 `agent_events` 的第三类 key，或新建独立 SSE。

**改动面**：API 新端点 + 新表（或无表）+ runner 新的「纯问答」执行入口 + 前端新增 ask UI。
**利**：与任务列表彻底零耦合，任务列表查询、myTodos、reports 全都天然看不到，无需到处加过滤；语义最清晰（「问答」≠「工作请求」）。
**弊**：改动面最大；要新造 runner 触发路径（现有 watch loop 只认 workflow_requests，ask 需要另一种触发——同步 HTTP 内联调 LLM，或新的轻量 worker）；流式若要复用需扩 channel。

### 落点 B：复用 workflow_requests，但加「问答」种类标记 + 全局过滤

**做法**：给 `workflow_requests` 加一列（如 `kind='ask'` 或新 status `'ask'`/`'readonly'`），创建时不置 `pending`。
- `POST /workflow-requests`（或新端点）写一行 kind=ask 的请求 + firstMessage，复用现有 `requestMessages` / `coordinator_decisions` / request-channel SSE。
- runner watch loop 天然忽略（它只查 `status='pending'`）；若用新 status 则更安全。
- **关键**：必须在 `GET /workflow-requests` 默认查询排除 kind=ask，且前端所有 `data.requests` 消费点（workbench overview 的 totalTasks、myTodos、reports 关联）统一过滤，否则会漏进任务列表。

**改动面**：1 个 migration（加列）+ POST handler 分支 + `GET /workflow-requests` 查询过滤 + 前端 `data.requests` 过滤（state.ts/工作台/myTodos）。
**利**：最大化复用现有 chat / SSE / coordinator-decisions 链路，几乎不用新建对话基础设施；只读语义靠「不进 pending + 加 kind」实现。
**弊**：`workflow_requests` 表语义被污染（混入非工作请求）；过滤点分散（任务总数卡片、myTodos、reports 都直接读 `data.requests`），漏一处就泄漏到列表；状态机 `ALLOWED_TRANSITIONS` 可能需为 ask 种类调整。

### 落点 C：纯前端 + 无持久化，仅用现有 `/coordinator/preview` 式只读端点扩展

**做法**：参照 `routes/coordinator.ts` 的 `/preview`（纯读、无 DB 写、无 LLM 也可加 LLM），做一个 `POST /coordinator/ask`：服务端**不写任何表**，直接（同步或经 runner 内联）调一次 LLM 返回答案；对话历史只存浏览器内存/前端 state，不落库。

**改动面**：1 个新只读端点（API 内联调 LLM 或转发 runner）+ 前端 ask 面板（自管 transcript）。
**利**：零数据库写入 = 零任务列表风险，无需任何过滤；改动面最小，符合「轻量只读」直觉；与 `/coordinator/preview` 已有的「无副作用端点」先例一致。
**弊**：对话历史不持久（刷新即丢，无法跨会话回看）；LLM 调用需在 API 进程内同步 spawn CLI（现有 LLM 都在 runner 侧，API 进程内联 spawn 是新模式，需评估超时/流式/可用性检测如何接入）；若将来要「问答转正式任务」则需另写迁移逻辑。

---

## 5. 关键文件索引

| 关注点 | 文件:行 |
|--------|--------|
| POST /workflow-requests handler | `apps/api/src/routes/workflow-requests.ts:56` |
| createWorkflowRequest（含 firstMessage 事务） | `apps/api/src/workflow-engine.ts:149` |
| createWorkflowRun（run 由 runner 创建） | `apps/api/src/workflow-engine.ts:79` |
| chat 写/读/决策端点 | `apps/api/src/routes/workflow-request-chat.ts:50/80/117` |
| coordinator 只读 preview（无副作用先例） | `apps/api/src/routes/coordinator.ts:56` |
| schema（workflow_requests / messages / coordinator_decisions / agent_events 双通道） | `apps/api/src/store/db.ts:109,341,352,326` + migration 14/15/20/21 |
| WorkflowRequest 类型 + status 枚举 | `packages/shared/src/types/workflow.ts:204,212` |
| 任务列表数据加载 | `apps/web/src/data-loading.ts:79` |
| GET /workflow-requests 列表查询 | `apps/api/src/routes/workflow-requests.ts:41` |
| 工作台消费 data.requests | `apps/web/src/page-workbench.ts:166` |
| myTodos 过滤 | `apps/web/src/state.ts:236` |
| runner watch loop pick up（只认 status=pending） | `apps/runner/src/cmd/watch.ts:60,214` |
| runner LLM 对话/分类 | `apps/runner/src/agents/coordinator/index.ts:45`、`llm-fallback.ts:classifyByLlm` |
| request-channel SSE / history | `apps/api/src/routes/workflow-requests.ts:211,228` |
| 前端 chat 加载/轮询 | `apps/web/src/coordinator-chat.ts:184` |
