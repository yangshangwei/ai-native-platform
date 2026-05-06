# AI Native Platform 架构支柱详解：4 Flow / 9 Stage / 10 KA / 唯一写者 / 真命令证据 / 5 人工 Gate / SSE 流式

> 日期：2026-05-06
> 性质：**架构支柱代码级详解**，面向新人源码 onboarding + 架构评审。
> 范围：把「AI 软件交付工作台」7 大底层契约从代码事实出发拆开，每条带文件锚点和行号。
> 配套：业务流程 `2026-05-06-end-to-end-business-flow.md`；核心架构 `2026-05-06-technical-architecture-design.md`；执行与演进 `2026-05-06-technical-architecture-execution.md`。

---

## 0. 一句话先行

**4 个 Flow 给「做什么类型工作」分诊；9 个 Stage 是其中的 atomic step；10 类 KnowledgeArtifact 把 stage 产出沉淀成项目长记忆；唯一写者契约保证状态只有一处可写、可审计；真命令证据让 Gate 决策不能被 Agent 自吹；5 个人工 Gate 只在关键取舍点打扰人；SSE 流式让人和 console 看到一样的实时进度。**

这 7 块加起来，构成「AI 输出可被信任 + 用户随时能拦下」的工作台契约。

---

## 1. 4 条 Flow（pipeline 多态）

源码：`packages/shared/src/flows/registry.ts:193`，`Readonly<Record<FlowId, FlowDef>>` 是跨层 SoT，类型层强制注册穷尽（漏注册 `tsc --noEmit` 直接红）。

| FlowId | runType | 阶段序 | 用途 |
|---|---|---|---|
| `feature.standard` | feature | context_pack → requirement → design → implementation → build_test → review → completion → knowledge | V1 完整 8 步特性流（baseline，唯一带 knowledge 沉淀的） |
| `feature.fastforward` | feature | implementation → build_test → review → completion | "改个 typo 不该走 9 步"——4 步极简，但人工验收 gate 不可跳 |
| `issue.standard` | bugfix | report → analyze → implementation(=fix) → build_test → review → completion | bug 修复 6 步，前面是 cs-issue-report / cs-issue-analyze 两个特定 skill |
| `refactor.standard` | refactor | scan → plan → implementation(=apply) → build_test → review → completion | 重构 6 步，scan/plan 是新 stage 值，不是 design 复用 |

### 1.1 关键设计点

- **`implementation` stage 在 4 个 flow 中完全复用同一个 enum 值**，靠不同 `skillId` 区分语义（`cs-feat-impl` / `cs-issue-fix` / `cs-refactor-apply`）——一条 dispatch 路径配多 prompt。
- **`review` stage 4 个 flow 都用 `cs-feat-accept`**，因为 `awaitHuman({stage:'review'})` 把人工验收 gate 折叠在这里。
- **`feature.fastforward` 只跳「文档密集型」stage**（context_pack / requirement / design / knowledge），保留 build_test 和人工 review。`skillId='cs-feat-impl'` 在没有 `inputs['project_profile.md']` 时必须能优雅降级（registry.ts:84-88 注释明说）。
- **`refactor.standard` 用全新的 `plan` 而非复用 `design`**：design_gate 内置 `requirement coverage / REQ-### / AC-###` 假设，refactor 没有 REQ；强行复用就要让 design_gate 全部规则做 stage-history-aware 改造，比新增一个 stage 复杂——这就是「契约纯净度」优先于「枚举节俭」的具体体现。

### 1.2 新增一条 Flow 要同时改 6 处

`registry.ts:18-39` 的 canonical recipe：

1. FlowId 字面量加（`packages/shared/src/types/workflow.ts`）；
2. `FLOW_REGISTRY` 加条目（本文件）；
3. orchestrator dispatch case（`apps/runner/src/orchestrator.ts`），默认分支 `_exhaustive: never` 强制覆盖；
4. API + runner 的 `KNOWN_FLOW_IDS` 信任边界两处都要加（`apps/api/src/routes/workflow-runs.ts` + `apps/runner/src/index.ts`）；
5. flow-registry test 锚定（`apps/runner/test/flow-registry.test.ts`）；
6. spec doc 更新（`.trellis/spec/runner/backend/flow-registry.md`）。

---

## 2. 9 个 WorkflowStage（实际 13 个 enum 值）

源码：`packages/shared/src/types/workflow.ts`（WorkflowStage 枚举）+ `apps/runner/src/orchestrator.ts` 的 `dispatchStep` exhaustive match。

```text
init                        // 状态占位，run 创建后第一次 transitionStage 之前的值；不被 dispatch
context_pack                // feature.standard 独有
requirement                 // feature.standard 独有
design                      // feature.standard 独有
implementation              // 4 个 flow 都有（语义随 skillId 变）
build_test                  // 4 个 flow 都有（engine kind，非 agent）
review                      // 4 个 flow 都有，折叠人工 acceptance gate
completion                  // 4 个 flow 都有（engine kind）
knowledge                   // 仅 feature.standard
report                      // V2 issue.standard 新增
analyze                     // V2 issue.standard 新增
scan                        // V2 refactor.standard 新增
plan                        // V2 refactor.standard 新增（不是 design 复用）
```

### 2.1 `init` 是状态占位

永远不会被 dispatch，作用是 `WorkflowRun` row 创建到第一次 stage 转换之间有个合法值。第一次 `transitionStage()` 调用立刻把它替换。

### 2.2 StageStep.kind 四种

- `agent` — 调 SkillSpec（context_pack / requirement / design / implementation / review / report / analyze / scan / plan）。
- `engine` — 平台代码直接执行（build_test 跑 mvn / completion 渲染报告 / knowledge 生成 candidate）。
- `gate` — 自动 Gate 检查（隐式由 engine kind 触发）。
- `human` — `awaitHuman()` 阻塞等用户。

### 2.3 review = review + 人工 acceptance

V1 没有独立 `acceptance` enum 值。**人工验收折叠在 review stage 内**：Specialist Agent 跑完 `skill.review` 产出 review.md，Runner 立刻调 `awaitHuman({stage:'review'})`，状态切 `awaiting_human`。`acceptance_gate` 在用户审批之后写入 GateRun（ruleId 列表见 §6）。

---

## 3. 10 类 KnowledgeArtifact + per-run 12 类 Artifact

源码：`packages/shared/src/types/artifact.ts:22-91`。两套生命周期物理隔离。

### 3.1 PerRunArtifactKind（12 个，run-scoped、一次性）

`artifacts` 表，`workflow_run_id NOT NULL`，写完不改：

```text
project_profile        // 项目薄地图（只在 context_pack 阶段产生 1 次，后续 run 复用）
context_pack           // 当次 run 的代码 + 历史决策摘要
requirement_draft      // 草稿（acceptance 后会被 promote 成 KnowledgeArtifact 'requirement'）
design_doc             // 草稿（acceptance 后被 promote 成 KnowledgeArtifact 'design'）
traceability           // AC → 文件 / 测试 / Gate 的映射 JSON
diff                   // git diff
command_log            // CommandRun stdout/stderr 落盘文件
surefire_report        // Surefire XML 原文
failsafe_report        // Failsafe XML 原文
completion_report      // markdown + JSON 双格式
knowledge_candidate    // 候选知识（用户 curate 后才进 KnowledgeArtifact）
other                  // 兜底（review.md 当前归这里，是个 V1 quirk）
```

### 3.2 KnowledgeArtifactKind（10 个，project-scoped、版本化）

`knowledge_artifacts` 表，project_id 维度，三态生命周期：`draft | accepted | superseded`：

| kind | subtype（KNOWLEDGE_SUBTYPES） | entityId 样式 |
|---|---|---|
| `requirement` | （无） | REQ-### |
| `design` | （无） | DSN-### |
| `architecture` | （无） | （无固定 prefix） |
| `roadmap` | feature / milestone / vision | （无） |
| `decision` | tech_stack / architecture / constraint / convention | ADR-### |
| `lesson` | pitfall / knowledge | LSN-### |
| `pattern` | pattern / library / technique | （无） |
| `explore` | question / module_overview / spike | （无） |
| `dev_guide` | （无） | （无） |
| `api_doc` | （无） | （无） |

强约束（`artifact.ts:165-176`）：subtype 必须命中 `KNOWLEDGE_SUBTYPES` 白名单；`isValidKnowledgeSubtype()` 在写入前校验。空数组的 kind 写 subtype 会拒绝。

### 3.3 双表的衔接：promote 流程

**当前自动促进只有两种**（`knowledge-entity.ts:118-124`）：

- `requirement_draft` → `KnowledgeArtifact(kind='requirement', entityId='REQ-###')`
- `design_doc` → `KnowledgeArtifact(kind='design', entityId='DSN-###')`

`POST /knowledge-artifacts/promote` 在单事务里 6 步原子化（`knowledge-entity.ts:99-110`）：

1. frontmatter regex 抽 entityId；
2. project-scoped `max(version)+1`；
3. version 递增；
4. 同 entityId 的 prior accepted 标记 `superseded`；
5. INSERT 新 knowledge_artifact；
6. UPSERT entity head row（`requirements` / `designs` 表，currentVersion 指针）。

**P0-2 的 head-pointer 模型**（`knowledge-entity.ts:5-17`）：`requirements` / `designs` 表是 head 指针表，行 = 当前权威版本；历史在 `knowledge_artifacts` 里靠 `(project_id, entity_id)` 索引可回溯。`designs.ref_req` 是**唯一一个 DB 级 FK**（ON DELETE RESTRICT），保护「REQ↔DSN 必须可追溯」这一条契约。

### 3.4 还没自动促进的 8 类

`architecture / roadmap / decision / lesson / pattern / explore / dev_guide / api_doc` 当前**只能手工写或经 knowledge_candidate 用户 curate**——没有专属 stage 产出，没有专属 promote 路径。

这是后续要补的「CodeStable 风格维护流」缺口（见 `2026-05-06-architecture-pillars-detail.md` 的演进建议或 V2 §7.2 todo）。

---

## 4. 唯一写者契约（Workflow Engine = sole state writer）

源码：`apps/api/src/workflow-engine.ts:54-59` 头部注释 + 全文 843 行。

### 4.1 唯一写者是什么

**所有** `WorkflowRun / StepRun / GateRun / Artifact / Approval / AuditLog / AgentTask / AgentResult / AgentEvent / BuildRun / TestRun / KnowledgeArtifact` 的 mutation **必须**通过 workflow-engine.ts 暴露的函数。SQLite 返回 fresh object，不持久化引用——**每条 mutation 必须 explicit `store.X.set(...)`**。

### 4.2 函数族（按职责分组）

| 类别 | 函数 | 触发方 |
|---|---|---|
| Run 生命周期 | `createWorkflowRun` / `transitionStage` / `awaitHuman` | API routes |
| Step 生命周期 | `startStep` / `finishStep` | Runner events |
| 命令证据 | `recordCommandRun` | Runner events |
| 构建证据 | `recordMavenBuild`（**自动触发 runCompileGate + runTestGate**） | Runner events |
| 人工 Gate | `recordApproval`（幂等：同 gate 同 decision 重放返回旧记录；自动 `runManualGate`） | API `/approvals` |
| Agent 调用 | `recordAgentTask` / `recordAgentResult` | Runner events |
| 流式事件 | `recordAgentEvent`（持久化 + 发布到 SSE bus；保 sequence 单调） | Runner events |
| Per-run 产物 | `createArtifact` | Runner events |
| 项目级产物 | `createKnowledgeArtifact` / `setKnowledgeArtifactStatus` | Internal promote |
| 操作记录 | `recordWorkflowAction` | API（knowledge_suggestion / acceptance_decision） |

### 4.3 三个写入入口（全部都要审计）

外部进来的写入路径**严格只有三类**：

1. `/runner/events/*`——Runner 上报（10+ 个事件路径）；
2. `/approvals`——Web 提交人工 gate 决策；
3. 内部 promote 流程——`/knowledge-artifacts/promote` 的事务里调 `createKnowledgeArtifact + setKnowledgeArtifactStatus`。

每条写入操作都 emit `audit(workflowRunId, kind, payload)`（如 `workflow-engine.ts:106-120` 的 `workflow_run.created`）→ 写入 `audit_log` 表。**所有状态变更可在 audit 里溯源到来源**。

### 4.4 不能写状态的人

- Coordinator Agent（`apps/runner/src/agents/coordinator/*.ts`）；
- Specialist Agent（context_pack / requirement / design / implementation / review / report / analyze / scan / plan）；
- Runner 的 CommandRunner / Worktree 模块；
- Web 前端（不能直连 DB）。

它们都只能通过事件上报让 workflow-engine 替自己写。Specialist Agent 可以在产物里加 `agentNote` 字段，但 Gate Engine 只把它**作为 GateRun.agentNote 展示**，不影响 status。

---

## 5. 真命令证据（CommandRun + Surefire）

源码：`apps/runner/src/command-runner.ts`、`packages/shared/src/utils/whitelist.ts`、`packages/shared/src/utils/surefire.ts`、`apps/api/src/gate-engine.ts:67-200`。

### 5.1 命令白名单（不在表里的命令 Runner 拒绝 spawn）

```text
git status
git diff
git diff --name-only
./mvnw -B -DskipTests compile     /  mvn -B -DskipTests compile
./mvnw -B test                    /  mvn -B test
```

不允许任意 shell。**白名单内的命令仍能读 `~/.m2`、能联网下依赖**——MVP 不做 egress 拦截，是「可信本地」的边界。

### 5.2 CommandRun 结构（每条命令必带这些字段）

```text
cwd / command / exitCode / startedAt / finishedAt / durationMs
stdoutRef / stderrRef               # 落盘文件 URI（超 DEFAULT_MAX_LOG_BYTES 截断）
timedOut: boolean                   # 超 DEFAULT_TIMEOUT_MS 强杀进程树
stage: 'compile' | 'test' | ...     # 后面 Gate 用 stage 字段筛
```

### 5.3 BuildRun + TestRun + Surefire 解析链

build_test stage 的执行链（`gate-engine.ts:67-200` + `recordMavenBuild`）：

```text
1. Runner spawn ./mvnw compile          → CommandRun#1 (stage='compile')
2. Runner spawn ./mvnw test             → CommandRun#2 (stage='test')
3. Runner glob target/surefire-reports/*.xml + target/failsafe-reports/*.xml
4. Runner 解析 XML → SurefireAggregate { total, passed, failed, errors, skipped }
                  + per-suite TestRun rows
5. Runner POST /runner/events/maven-build  → recordMavenBuild()
6. recordMavenBuild() 写 BuildRun 表 + N 条 TestRun + 报告 Artifact，
   然后**自动**触发：
   - runCompileGate(buildRun)            ← 不需要 Runner 显式 runGate
   - runTestGate(buildRun, testRuns, surefireAggregate)
```

### 5.4 compile_gate 规则（`gate-engine.ts:67-111`）

| ruleId | 判断 |
|---|---|
| `compile.command_present` | 该 build 必须有 stage='compile' 的 CommandRun，否则 fail |
| `compile.exit_zero` | exitCode === 0 |
| `compile.no_timeout` | timedOut === false |

### 5.5 test_gate 规则（`gate-engine.ts:115-200`）

| ruleId | 判断 |
|---|---|
| `test.command_present` | 必须有 stage='test' 的 CommandRun |
| `test.exit_zero` | mvn test 退出 0 |
| `test.no_timeout` | 没超时 |
| `test.surefire_present` | XML 真的解出来了 |
| `test.failures_zero` | aggregate.failed === 0 |
| `test.errors_zero` | aggregate.errors === 0 |
| `test.required_not_all_skipped` | 不能全 skip 当作通过（warn 级） |

**status = worst(fail > warn > pass)**（`gate-engine.ts:27-31`）。

### 5.6 关键约束：Agent 不能伪造证据

- Agent 输出的 review.md 里写「测试我跑过了通过」——**不算证据**，test_gate 没有对应 RuleResult 就 fail；
- 没有 `surefire-reports/*.xml` 文件——`test.surefire_present=fail`，整个 test_gate fail；
- `recordMavenBuild` 是**唯一**能产生 BuildRun 的入口，必须从 Runner 上报，API 没有手工标记通过的接口。

---

## 6. 5 个人工 Gate（manual checkpoint）

源码：`recordApproval` → `runManualGate`（`gate-engine.ts:584-601`），gateId 取自 `awaitHuman({stage})` 的 stage 名映射。

| # | 触发 | 等待 stage | 自动规则 | 人工决策 | 通过后副作用 |
|---|---|---|---|---|---|
| 1 | `requirement` 阶段产出 requirement_draft 后 | `requirement` | `requirement_gate` 9 条规则全 pass | 批准/打回 | 进入 design |
| 2 | `design` 阶段产出 design_doc 后 | `design` | `design_gate` 10 条规则全 pass | 批准/打回 | 进入 implementation |
| 3 | `implementation` 阶段 diff 触碰敏感路径时（条件触发） | `implementation` | `sensitive_change_gate` 命中 warn | 批准/打回 | 进入 build_test |
| 4 | `review` 阶段产出 review.md 后 | `review` | `acceptance_gate` 5 条规则全 pass（含 stage-history-aware NA） | 接受验收/拒绝 | 自动 promote 草稿 → KnowledgeArtifact |
| 5 | `knowledge` 阶段产出 knowledge_candidate 后 | `knowledge` | （无前置 gate） | 总开关 + 逐条 accept/edit/ignore | 落盘到 `~/.ai-native/projects/{projectId}/knowledge/` |

### 6.1 自动 gate 的规则数

- **requirement_gate**（9 条）：draft_present / ids / acceptance / scope / context_evidence / pitch / four_sections（用户故事 / 为什么需要 / 怎么解决 / 边界）/ user_stories≥2 / boundary。
- **design_gate**（10 条）：doc_present / coverage / test_strategy / risks / context_grounding / dsn_id / 现状 / 变化 / 挂载点 3-5 / 推进策略。
- **acceptance_gate**（5 条，stage-history-aware）：requirement_present (NA-able) / design_present (NA-able) / diff_present / review_present / test_gate_passed。
- **diff_scope_gate**（1 条）：within_allowed。
- **sensitive_change_gate**（1 条）：no_high_risk_path（命中 warn 才升级到人工）。

### 6.2 关键设计：幂等 + 自动级联

`recordApproval` 幂等（同 gate 同 decision 重放返回旧记录）→ 自动调 `runManualGate` 把人工决策也写成 GateRun（`ruleId='manual.human_decision'`），**人工决策也走和自动 gate 一样的证据链**——不是状态字段，是 GateRun row。

### 6.3 acceptance_gate 的 stage-history-aware

`gate-engine.ts:454-531`：`issue.standard / refactor.standard / fastforward` 中并不存在 requirement / design 步骤。Gate 引擎用 `store.stepRuns.byWorkflow` 检测当前 run 实际跑过哪些 stage：未跑过的 stage 不强制 artifact 存在，规则返回 `pass: not applicable`。这个机制是 W2-2a / W2-3 必须解决的——否则 fastforward run 永远 fail acceptance。

### 6.4 为什么只有 5 个

设计原则（业务流程文档 §9）：「**只在关键业务取舍点打扰用户**；机械检查全部由 Gate Engine + 真实命令完成」。所以白名单越界、编译失败、测试失败、surefire 缺失等都直接 fail run，**不打扰用户**。

> 注：业务流程文档 §9 小标题写「仅 6 个」但表里实际列 5 行——这是文案遗留 typo，代码层面就是 5 个。

---

## 7. SSE 流式（console + UI 同等延迟）

源码：`apps/api/src/agent-stream-bus.ts`（44 行）+ `recordAgentEvent`（`apps/api/src/workflow-engine.ts`）+ `apps/runner/src/agents/claude-code.ts` 的 stream-json 行级解析。

### 7.1 端到端链路

```text
claude / codex CLI                        ← 必须 --output-format stream-json
  │  逐行输出 JSON Lines（assistant / tool_use / tool_result / result 四类）
  ▼
Runner agents/claude-code.ts                ← 行级 JSON.parse，禁止 buffer
  │  转成 AgentStreamEvent(input shape)
  ▼
POST /runner/events/agent-event             ← 立即上报，不批量
  │
  ▼
api/workflow-engine.recordAgentEvent()
  ├─ store.agentEvents.insert()           ← 写 SQLite，sequence 单调（per workflow_run）
  └─ publishAgentEvent(event)             ← in-memory pub/sub
                                           │
                                           ▼
                          agent-stream-bus.publish(event)
                                           │  扇出到所有订阅者
                                           ▼
                          GET /workflow-runs/:id/events/stream (SSE)
                                           │  浏览器 EventSource 持续接收
                                           ▼
                                Web UI agent-stream 面板实时渲染
```

### 7.2 关键不变量

- **Sequence 单调**（per workflow_run_id）：`agent_events` 表带 `sequence` 列，`recordAgentEvent` 在事务里 `max(sequence)+1`。Web 离线时可用 `?afterSeq=N` 拉取历史，**不会丢、不会乱序**。
- **History + live 双轨**：SSE 接入时先调 `GET /workflow-runs/:id/events?afterSeq=0` 拉历史（agent_events 表），再 `subscribe()` 接 live——bus 只做 live tail，**没有 race**因为两端都过 `recordAgentEvent` 的写入路径。
- **订阅器隔离失败**（`agent-stream-bus.ts:33-37`）：单个 subscriber 抛错不影响其他 subscriber，`try/catch` 兜底。
- **没有跨进程 pub/sub**：`subscribers` 是单进程 in-memory `Map`——意味着 **API 必须单进程**，多实例部署需要换 Redis pub/sub 或类似。这是 MVP 限制。

### 7.3 「console + UI 同等延迟」的硬约束

项目记忆 `memory/feedback_claude-code-cli-streaming-realtime.md` 明记：用 `claude --output-format stream-json` 行级解析，**禁止 buffer**。具体表现：

- Runner 收到一行 JSON 立刻 parse 立刻 POST，不攒批；
- API `recordAgentEvent` 写 SQLite + publish 是同步的，不延迟；
- SSE handler 收到 publish 立刻 `controller.enqueue(...)` 写到响应流。

任何一环 buffer（比如「等 100ms 再批量发」）都违反这条契约——用户在 UI 看到的 token 流速 = console 看 `claude` 输出的速度。

### 7.4 四类事件载荷

源自 claude-code 的 stream-json 格式（runner 转译为 AgentStreamEvent）：

| stream 行类型 | 含义 | UI 渲染 |
|---|---|---|
| `assistant` | 模型 partial / final 文本 | 思考流式打字 |
| `tool_use` | 模型决定调工具 | "正在读 X 文件…" |
| `tool_result` | 工具返回 | 折叠面板可展开 |
| `result` | 整轮结束（含 tokens / duration） | 收尾标识 + 成本 |

---

## 8. 速查索引（一页定位代码）

| 主题 | 主文件 | 关键行 |
|---|---|---|
| Flow registry | `packages/shared/src/flows/registry.ts` | 57 / 90 / 125 / 165 / 193 |
| WorkflowStage 枚举 | `packages/shared/src/types/workflow.ts` | （定义处） |
| ArtifactKind 二族 | `packages/shared/src/types/artifact.ts` | 22-91 |
| KNOWLEDGE_SUBTYPES 表 | `packages/shared/src/types/artifact.ts` | 165-176 |
| Knowledge entity head pointer | `packages/shared/src/types/knowledge-entity.ts` | 45-97 |
| Promote 事务契约 | `packages/shared/src/types/knowledge-entity.ts` | 99-176 |
| Workflow Engine 头部 | `apps/api/src/workflow-engine.ts` | 54-59 |
| createWorkflowRun + 路由集成 | `apps/api/src/workflow-engine.ts` | 61-120 |
| compile_gate 规则 | `apps/api/src/gate-engine.ts` | 67-111 |
| test_gate 规则 | `apps/api/src/gate-engine.ts` | 115-200 |
| requirement_gate 9 条 | `apps/api/src/gate-engine.ts` | 255-348 |
| design_gate 10 条 | `apps/api/src/gate-engine.ts` | 350-452 |
| acceptance_gate stage-history-aware | `apps/api/src/gate-engine.ts` | 454-531 |
| diff_scope_gate / sensitive_change_gate | `apps/api/src/gate-engine.ts` | 533-582 |
| runManualGate | `apps/api/src/gate-engine.ts` | 584-601 |
| Agent stream bus | `apps/api/src/agent-stream-bus.ts` | 全文 44 行 |
| 命令白名单 | `packages/shared/src/utils/whitelist.ts` | （定义处） |
| Surefire 解析 | `packages/shared/src/utils/surefire.ts` | （定义处） |

---

## 9. 把 7 块串成一句话

**4 个 Flow** 决定「这次做什么类型的工作」；**9 个 Stage** 把工作切成 atomic step；**10 类 KnowledgeArtifact** 把跨 run 长记忆和 12 类 per-run 一次性证据物理隔离；**Workflow Engine 唯一写者**让所有状态变更可审计、可重放；**真命令证据**让 Gate 决策不能被 Agent 自吹；**5 个人工 Gate** 只在关键业务取舍点打扰人，不替机器干校验的活；**SSE 流式**让用户看到的 token 流速 = console 看 claude 输出的速度。

→ 工作台契约：**AI 输出可被信任 + 用户随时能拦下 + 每个结论都能引用到源码 / CommandRun / GateRun / Artifact**。
