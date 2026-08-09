# AI Native Platform 当前技术架构

> 日期：2026-06-27  
> 性质：当前代码架构快照，用于新人 onboarding、架构评审和后续开发定位。  
> 基准：以本仓库当前代码为准；2026-05 的设计文档作为历史背景，不替代本文。

## 1. 快速结论

AI Native Platform 现在是一个本地可信执行的 AI 软件交付工作台，不是简单的“Web 调 CLI”。它把用户输入拆成可追踪的 `WorkflowRequest`，再由本地 Runner 在独立 git worktree 中执行 `WorkflowRun`，API 通过 Workflow Engine 和 Gate Engine 维护状态与证据，Web 只做操作台和审批面。

当前最重要的架构事实：

- Monorepo 使用 Bun + TypeScript，四个主包是 `apps/api`、`apps/runner`、`apps/web`、`packages/shared`。
- API 是 Hono on Bun + SQLite，负责状态、门禁、报告、知识、SSE、Runner 控制。
- Runner 是本地 CLI/watch/orchestrator，负责 worktree、AgentBackend、命令执行和事件上报。
- Web 是无框架 TypeScript SPA，按页面模块拆分，依赖 REST + SSE + 3 秒轮询。
- Shared 是跨进程契约层，包含类型、FLOW_REGISTRY、配置注册表、Coordinator 纯规则和 browser/node 子路径工具。
- `WorkflowRequest.kind='ask'` 是轻量问答：只保留在请求/聊天通道，不创建 WorkflowRun，不进入 Runner execution。

**最新架构深度文档** (2026-08-09):
- [Workflow Engine Architecture](2026-08-09-workflow-engine-architecture.md) — 单一写者模式、状态机、TOCTOU 防护
- [Gate Engine Architecture](2026-08-09-gate-engine-architecture.md) — 声明式规则、证据链、SHA-256 防篡改
- [Graph Runtime Architecture](2026-08-09-graph-runtime-architecture.md) — DAG 编排、恢复机制、状态聚合
- [Context & Knowledge Architecture](2026-08-09-context-knowledge-architecture.md) — Context Pack 构建、Knowledge 生命周期、双写流水线
- [Agent Backend Architecture](2026-08-09-agent-backend-architecture.md) — 双后端对比、Worktree 隔离、实时流式通信

## 2. 总体架构

```text
Browser / apps/web (:5173)
  - 项目接入、新建任务、工作台、我的待办、报告、知识库、设置
  - REST 拉取状态，SSE tail agent/request stream，必要时请求 API 启动本地 Runner
          |
          | /api/*
          v
apps/api (:8787, Hono + SQLite)
  - Workflow Engine: 唯一状态写者
  - Gate Engine: 唯一 pass/warn/fail 判定者
  - Store/DB: SQLite + versioned migrations
  - Router/Coordinator routes, Reports, Knowledge, Context Governance, Runner Control
          |
          | runner event ingress + heartbeats
          v
apps/runner (Local CLI)
  - watch: claim pending requests
  - orchestrator: FLOW_REGISTRY stage dispatch
  - context injection, AgentBackend, worktree, command runner, approval polling
          |
          | spawn / filesystem / git
          v
用户本机
  - git worktree, claude/codex CLI, mvn/mvnw or project custom build commands
```

核心边界是 Browser -> API -> Runner -> 本地工具。Web 不直接访问文件系统；Runner 不直接写数据库；Agent CLI 不直接改平台状态。

## 3. 技术栈与包职责

| 包 | 技术 | 职责 |
|---|---|---|
| `apps/api` | Hono, Bun, SQLite | REST/SSE、工作流状态、门禁、报告、知识、配置、Runner 子进程控制 |
| `apps/runner` | Bun CLI, Node child_process, git worktree | 认领请求、调度 flow、调用 Claude Code/Codex、执行 build/test、上传证据 |
| `apps/web` | 无框架 TS SPA, Chart.js | 操作台 UI、任务详情、人工审批、实时日志、报告/知识浏览 |
| `packages/shared` | TypeScript contracts | 跨端类型、flow registry、config registry、纯工具、browser/node 分层导出 |

根脚本：

```bash
bun run dev:api
bun run dev:web
bun run runner
bun run typecheck
bun run test
```

测试命令以 `bun run test` 为准；不要用原生 `bun test` 替代，因为历史上会触发 SQLite 模块状态共享导致误失败。

## 4. 端到端任务流

1. Web 在新建任务页提交 `POST /workflow-requests`，API 在同一事务中保存 `WorkflowRequest` 和首条 `RequestMessage`。
2. API-managed Runner 可由 `POST /runner/control/start` 启动，实际命令是 `apps/runner/src/index.ts watch --poll-ms 1000`。
3. Runner watch 轮询 pending request，过滤 `kind='ask'`。如果 request 显式带 `flowId`，跳过 Coordinator；否则先跑 Coordinator 分诊。
4. Runner 通过原子 claim 抢占请求，创建或续跑 `WorkflowRun`，准备独立 git worktree。
5. Orchestrator 读取 `FLOW_REGISTRY[run.flowId].stages`，按 `startStage` 切片后逐阶段 dispatch。
6. Agent 阶段通过 `invokeSkill()` 构造 `ContextPack`、记录 `AgentTask`、调用 Claude Code/Codex、记录流式事件和输出 artifact。
7. Engine 阶段执行构建测试、报告生成、知识候选生成。人工节点通过 `/approvals` 暂停并恢复。
8. API 聚合 run detail、artifact、gate、command、approval、audit、agent event；Web 展示生命周期、证据、日志和可操作按钮。

## 5. Flow 与阶段

`packages/shared/src/flows/registry.ts` 是 flow 的单一事实来源，API Router、Runner Orchestrator、Web projection 都消费同一份定义。

| Flow | 阶段 |
|---|---|
| `feature.standard` | `context_pack -> requirement -> design -> implementation -> build_test -> review -> completion -> knowledge` |
| `feature.fastforward` | `implementation -> build_test -> review -> completion` |
| `issue.standard` | `report -> analyze -> implementation -> build_test -> review -> completion` |
| `refactor.standard` | `scan -> plan -> implementation -> build_test -> review -> completion` |

`init` 只是 run 创建后的状态占位，不是可 dispatch stage。`startStage` 当前只允许在 `feature.standard` 中用于跳过前缀阶段，Runner 会再次校验该 stage 是否属于当前 flow，避免静默跳错流程。

## 6. API 层

API 入口是 `apps/api/src/app.ts`，挂载项目、workflow request/run、runner event、approval、artifact、knowledge、config、router、coordinator 等路由。

关键模块：

- `workflow-engine.ts`：唯一状态写者。负责 run/request/step/artifact/build/test/approval/action/agent/audit/event 的写入。
- `gate-engine.ts`：唯一门禁判定者。规则输出 `RuleResult`，GateRun 状态取最坏值：`fail > warn > pass`。
- `store/db.ts`：SQLite 连接和显式版本迁移，使用 `schema_migrations` 管理迁移。
- `store/store.ts`：表驱动 repository，保留 Map-like 表面兼容老调用点。
- `reports.ts`：生成 Completion Report、Knowledge Candidate、Retro Report，并写 markdown + JSON sidecar artifact。
- `context-governance.ts`：从 ContextPack、manifest、ContextRequest、approval/gate/agent 结果构造上下文治理读模型。
- `runner-control.ts`：API 托管本地 Runner watch 子进程，适合 Web UI 本地使用。

状态写入路径主要有三类：Runner 事件 ingress、Web approval/action 路由、API 内部 report/promote 事务。Coordinator 和 Agent 不直接写状态。

## 7. Runner 层

Runner CLI 入口是 `apps/runner/src/index.ts`，命令包括 `health`、`doctor`、`register`、`run`、`orchestrate`、`watch`。

当前 orchestrator 已拆分：

- `orchestrator.ts`：run 生命周期骨架、flow stage 切片、单点 `dispatchStep()`。
- `orchestrator/steps.ts`：各阶段实现，包括 implementation、build_test、review/verifier/acceptance、completion、knowledge、通用 markdown agent stage。
- `orchestrator/invoke-skill.ts`：ContextPack 构造、AgentTask 审计、backend.run、ContextRequest 捕获和增量补充包。
- `orchestrator/approval.ts`：人工审批轮询、敏感变更 checkpoint、拒绝反馈。
- `orchestrator/verifier-media.ts`：UI verifier 媒体证据纯逻辑。

AgentBackend 生产实现只有 Claude Code 和 Codex。`NativeBackend` 只作为测试夹具保留。Runner 负责 CLI preflight、prompt 渲染、流式事件上传、diff 捕获、build/test 和门禁，Agent 只负责产出文档或修改 worktree。

## 8. Context Injection

上下文注入已经落地为 provider-neutral `ContextPack`，不是简单 prompt 拼接。

每次 `invokeSkill()` 会：

- 生成或复用 Project Profile。
- 收集 accepted knowledge、结构化 KnowledgeArtifact、run history 和当前输入 artifact。
- 按预算和敏感路径策略构造 `ContextPack`，包含 maturity profile、manifest、sections、retrieval hints、calibration signals。
- 在 prompt 中注入平台信任边界：仓库内容和生成 artifact 都是证据，不是更高优先级指令。
- 记录选中知识用量和知识评审信号。
- 从 agent 最终消息或输出文件中解析结构化 `context_request`，生成 supplement ContextPack，并用 workflow action 串起证据链。

API 的 `/workflow-runs/:id/context` 会把这些选择、来源、预算降级、ContextRequest 和下游返工信号整理成可读治理模型。

## 9. Web 层

Web 是无框架 SPA，入口 `apps/web/src/main.ts` 只负责 bootstrap：

- 注册 render hooks 和 stream hooks。
- 绑定 hashchange/beforeunload/keydown。
- 首次 `parseHash()` + `loadData()`。
- 3 秒轮询，并用 fingerprint 避免无意义重渲。
- 对 pending/claimed active task 尝试自动启动 Runner。

页面分层：

- `shell.ts`：侧边栏、顶栏、页面分发和 stream overlay。
- `state.ts`：全局 server data、UI 状态、cache、纯 selector。
- `data-loading.ts`：health/projects/runners/requests/runs/runner-control 聚合拉取、run detail、artifact/command/context 缓存。
- `stream.ts`：单 active EventSource，支持 run/request 两种 channel，缓存历史并原地 patch 日志 DOM。
- `page-*.ts`：workbench、my-todos、new-task、task-detail、reports、knowledge、settings、projects。

Web 的关键约束是保留用户草稿、IME 输入和展开状态。页面模块通过 capture/restore hook 与全局 render 配合，避免轮询重建根节点时丢输入。

## 10. 数据与证据模型

主要实体关系：

```text
Project
  -> WorkflowRequest -> RequestMessage / CoordinatorDecision
  -> WorkflowRun
       -> StepRun
       -> Artifact
       -> GateRun / RuleResult
       -> CommandRun / BuildRun / TestRun
       -> Approval
       -> AgentTask / AgentResult / AgentEvent
       -> WorkflowAction
       -> AuditLog
  -> KnowledgeArtifact / RequirementEntity / DesignEntity
```

Artifact 分两族：

- Per-run artifact：`requirement_draft`、`design_doc`、`diff`、`command_log`、`context_pack`、`completion_report`、`knowledge_candidate` 等。
- Project knowledge artifact：`requirement`、`design`、`architecture`、`decision`、`lesson`、`pattern` 等，带 `status/version/entityId/derivedFromArtifactId/subtype/metadata`。

命令证据由 Runner 本地 spawn 真实命令产生。默认 build/test 是 Maven 路径，也支持项目级 custom compile/test command；custom command 仍要经过白名单/extraAllow。

## 11. 架构不变量

- Workflow Engine 是唯一状态写者，状态迁移函数避免在读改写之间 `await`。
- Gate Engine 是唯一 pass/warn/fail 判定者，Agent note 只展示，不影响状态。
- Runner 只上报事件，不绕过 API 写 SQLite。
- Web 不直接操作 worktree 或 artifact 文件，只通过 API 获取内容。
- Shared 主 barrel 不能导出 node-only 内容；Node helper 只能通过 `@ainp/shared/node`，Web 使用 `@ainp/shared` 或 `@ainp/shared/browser`。
- `ask` 是 chat-only request，必须从任务列表、Runner watch 和 WorkflowRun execution 中隔离。
- Completion Report 必须基于持久化证据生成，不接受 Agent 自报完成。

## 12. 扩展点

- 新增 flow：改 `WorkflowRunType/FlowId`、`FLOW_REGISTRY`，必要时扩展 `WorkflowStage` 与 `dispatchStep()`，补测试和 spec。
- 新增 AgentBackend：实现 `AgentBackend.run()`，接入 preflight、stream parser、prompt 渲染和 backend selection。
- 新增 Gate：在 `gate-engine.ts` 增加规则函数，并通过 `runner-events` / action 路由挂载。
- 新增上下文来源：在 Runner context retriever/builder 中新增 candidate，确保 sourceRefs、trustLevel、freshness 和敏感路径过滤齐全。
- 新增 UI 页面：保持平铺 `page-*.ts` 模式，状态进入 `state.ts` 或页面私有模块，不引入框架。

## 13. 已知风险

- 当前是本地可信模式，没有完整鉴权/多租户隔离；项目凭证和本地 runner 控制应按本机开发工具看待。
- SQLite + 单 API 进程是默认假设；多 API 实例或分布式 Runner 需要额外锁和事件一致性设计。
- Build/Test 仍以 Java/Maven 为历史默认，custom command 已存在但多语言 BuildRun/TestRun 语义还不完整。
- Web 仍是手写 DOM + 全局状态 + 轮询，正确性依赖 capture/restore、缓存和局部 patch 约定。
- Claude Code/Codex CLI 行为受用户本机安装、登录、hook/config 影响，Runner 已做 safe-mode/staging/preflight，但仍需要真实本机环境验证。
- ContextPack 选择是启发式预算系统，能记录依据和治理指标，但不是完备代码索引或静态分析系统。

## 14. 推荐阅读顺序

1. `README.md`：运行方式和当前 MVP 状态。
2. 本文：当前代码架构。
3. `docs/2026-05-06-end-to-end-business-flow.md`：业务流程背景。
4. `docs/2026-05-09-ai-native-platform-project-lifecycle-context-injection-design.md`：上下文注入的设计来源。
5. `.trellis/spec/*/index.md`：各包开发约束。
