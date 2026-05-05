# AI Native Platform 端到端业务流程

> 日期：2026-05-06
> 性质：**业务流程梳理**，面向产品理解、用户使用与新人交接。
> 范围：从「项目接入」到「知识沉淀」的完整一次交付闭环，覆盖 V1 九阶段与 V2 多 Flow 多态。
> 配套文档：`2026-05-06-technical-architecture-design.md`（技术方案）。

## 1. 平台定位

AI Native Platform（以下简称 AINP）是一个 **AI 软件交付工作台**，不是「把任务丢给 AI 然后等奇迹」的黑盒。它把一句话需求变成一次可追溯、可审计、可复盘的交付：

```text
一句话需求 → 智能路由 → AI 协作（需求/设计/编码/测试/审查）
         → 真实命令构建测试 → 人工把关 → 验收报告 → 项目知识
```

四条核心约束（不可放水）：

1. **Workflow Engine 是唯一状态写入者**，Agent 只能产出候选，不能推进状态。
2. **Agent 不能宣布 Gate 通过**，每个 Gate 由 `gate-engine` 决定。
3. **Build/Test 必须来自真实命令**，CommandRun + Surefire XML 是唯一证据。
4. **每次交付必有 Completion Report**，引用每条 Artifact / Gate / CommandRun。

## 2. 端到端业务全景

```text
┌─ 项目接入 ──────────────────────────────────────────────┐
│  注册本地仓库 → 选择 Agent Backend → 校验 CLI Preflight   │
└──────────────┬──────────────────────────────────────────┘
               ▼
┌─ 任务发起 ───────────────────────────────────────────────┐
│  Web 创建 WorkflowRequest（标题 + 选定 Source Branch）    │
│  Coordinator 分诊（proceed / pause_for_human / abort）   │
└──────────────┬──────────────────────────────────────────┘
               ▼
┌─ 智能路由 ───────────────────────────────────────────────┐
│  Smart Router 根据 runType + 标题 + 项目知识库            │
│  推荐 flowId + startStage + relevantKnowledge + 估时      │
└──────────────┬──────────────────────────────────────────┘
               ▼
┌─ Runner Watch 认领 ─────────────────────────────────────┐
│  心跳报到 → 创建 Git worktree → 准备执行环境             │
└──────────────┬──────────────────────────────────────────┘
               ▼
┌─ 按 Flow 顺序执行 Stage ─────────────────────────────────┐
│  feature.standard:    context_pack → requirement →     │
│                       design → implementation →         │
│                       build_test → review → completion │
│                       → knowledge                       │
│  feature.fastforward: implementation → build_test →    │
│                       review → completion              │
│  issue.standard:      report → analyze → fix →         │
│                       build_test → review → completion │
│  refactor.standard:   scan → plan → apply →            │
│                       build_test → review → completion │
└──────────────┬──────────────────────────────────────────┘
               ▼
┌─ 报告与知识沉淀 ─────────────────────────────────────────┐
│  Completion Report（审计/溯源）                           │
│  Knowledge Candidate → Knowledge Gate → 入库回写          │
└─────────────────────────────────────────────────────────┘
```

## 3. 用户与系统的角色边界

| 角色 | 职责 | 不能做 |
|---|---|---|
| 终端用户 | 接入项目、提需求、阅读草稿、审批关键 Gate、接受验收 | 跳过 Gate；改 Workflow 状态 |
| Coordinator Agent | 看用户描述，决定 proceed/pause/abort，判断 runType | 写状态；改 Gate 结论 |
| Smart Router | 根据规则推荐 flowId + startStage + 相关知识 | 用户已指定 flowId 时强制覆盖 |
| Specialist Agent | 输出 Requirement / Design / Diff / Review / Plan / Analysis 草稿 | 自我宣布 Gate 通过 |
| Workflow Engine | 唯一状态写者：StepRun、GateRun、Approval、Audit | 触发 Agent；执行命令 |
| Gate Engine | 执行规则，产出 pass / warn / fail | 自动批准 manual gate |
| Local Runner | 心跳、worktree、白名单命令、Surefire 解析 | 直接写状态 |
| Web UI | 项目接入、任务队列、阶段板、证据钻取、人工检查点 | 绕过 API 直接写库 |

## 4. 阶段一：项目接入

目标：让一个已存在的本地项目能被 AINP 编排，但不牺牲后续审计严格度。

1. 用户在 Web 接入项目：填写本地路径、名称，选择 **Agent Backend**（`claude_code` 或 `codex`）。
2. API 持久化 `Project`：包含 `localPath`、`defaultBranch`、`agentBackend`、`agentBackendBin?`。
3. Runner 启动 watch 时做 **CLI preflight**：`claude --version` 或 `codex --version`，失败时直接给出安装/登录修复提示。
4. Web 通过 `POST /runner/control/start` 让 API 启动并监控本地 Runner watch 进程；失败时回退到手动 `bun run runner -- watch`。
5. 第一次执行 `context_pack` 时生成 **Project Profile**（薄地图：仓库结构、构建系统、JDK/Maven 版本、README 摘要），后续复用。

原则：**初始化做薄地图，不一次性读懂全部项目；后续按需补全**。

## 5. 阶段二：任务发起 + Coordinator 分诊

1. 用户在 Web「新建任务」：选 Project、写标题/描述、选 Source Branch、可选 runType（默认 feature）。
2. API 创建 `WorkflowRequest`，状态 `pending`，并把第一条用户消息写进 `request_messages`（同事务）。
3. Runner watch 循环 → 拿到 `pending` → 调 Coordinator：
   - **proceed**：决定 `runType`（`feature` / `bugfix` / `refactor` / `smoke`），进入路由。
   - **pause_for_human**：往聊天线程贴问题，状态切到 `awaiting_clarification`，等用户回复。
   - **abort**：状态切 `cancelled`。
4. 用户回复后再次循环，直到 Coordinator decide `proceed`。

Coordinator 的职责是 **意图澄清 + runType 选择**，不直接决定 flowId（那是路由器的事）。

## 6. 阶段三：智能路由

`createWorkflowRun()` 在 `flowId` 缺省时调用 `recommend()`，规则按优先级短路：

| runType | 触发条件 | 推荐 flowId |
|---|---|---|
| bugfix | — | `issue.standard` |
| refactor | — | `refactor.standard` |
| smoke | — | `feature.standard`（不快进） |
| feature | 标题 < 60 字 或 含 `typo / rename / 改个 / 小修 / 微调` 等关键词 | `feature.fastforward` |
| feature | 其他 | `feature.standard` |

`startStage` 二次决定（仅 `feature.standard` 支持跳前缀）：
- 项目知识库已有 `accepted` 状态的 `design` 实体且与标题关键词匹配 → 从 `implementation` 开始。
- 已有 `accepted` 的 `requirement` 实体匹配 → 从 `design` 开始。
- 否则 `null`（从 flow 第一个 stage 开始）。

输出：`{ flowId, startStage, relevantKnowledge[], estimates: {timeSec, tokens}, rulesFired[] }`。Web UI 可通过 `POST /router/recommend` 做 dry-run 预览。

用户始终拥有最终决定权：Web 可显式选择 `flowId` 或「完整流程」覆盖路由建议。

## 7. 阶段四：Runner 认领与 Worktree 准备

1. Runner `claim` 该 `WorkflowRequest`（status → `claimed`）。
2. `cmdOrchestrate` 创建 `WorkflowRun`，分支命名 `ai/{runId}-{slug}`。
3. `TrustedLocalWorktreeEnvironment.prepare(run)` 在 `~/.ai-native/worktrees/{projectId}/{runId}/workspace` 创建独立 git worktree，checkout 到 `sourceBranch`，再 checkout 到任务分支。
4. 上报 `workspace.prepared` 事件 → Workflow Engine 写 `workspacePath`。

Worktree 只隔离代码工作区，不隔离命令、网络、secret——**MVP 不追求沙箱级强制**。

## 8. 阶段五：按 Flow 顺序执行 Stage

下面以 `feature.standard` 完整 8 步为基准；其余 Flow 是它的子集或变体。

### 8.1 context_pack（仅 feature.standard）

1. 生成/复用 Project Profile（项目薄地图）。
2. 收集历史 `accepted` 知识（`~/.ai-native/projects/{projectId}/knowledge/*.md`）。
3. 调 `skill.context_pack`：让 Agent 把 user_request 与代码、历史决策、已有实现、踩坑关联，输出 `context_pack.md`，每条主张必须 cite `src/...` 路径。

### 8.2 requirement（仅 feature.standard）

调 `skill.requirement_draft`，按 cs-req 方法论产出 `requirement.md`：
- frontmatter 必含 `doc_type: requirement / pitch / status: draft / REQ-###`
- 四段：用户故事（≥2 条 `作为 ...` 句式）/ 为什么需要 / 怎么解决 / 边界
- 至少一条 `AC-### 验收标准`，引用 Context Pack 中 `src/...` 证据

`requirement_gate` 自动跑 9 条规则；通过后 `awaitHuman({stage:'requirement'})` 等用户在 Web 点击 **批准需求**。Approval 写入 `approvals` 表 + `requirement_gate` GateRun。

### 8.3 design（仅 feature.standard）

调 `skill.design`，按 cs-feat-design 方法论产出 `design.md`：
- frontmatter 必含 `design_id: DSN-### / related_req: REQ-### / status: draft`
- 五段：现状 / 变化 / 挂载点（**3-5 条硬约束**）/ 推进策略 / 验收契约
- 可选 `traceability.json`：AC → 文件 / 测试 / Gate 的映射

`design_gate` 跑 10 条规则（覆盖矩阵、测试策略、风险、DSN id、挂载点数量等）；通过后 `awaitHuman` 等批准设计。

### 8.4 implementation（所有 Flow 都有）

调 `skill.implementation`：Agent 在 worktree 内修改代码（白名单 `src/**`、`examples/**`，不允许网络）。输出 `diff`（git diff）+ `changed-files`。

立即跑两条 Gate：
- `diff_scope_gate`：所有 changed file 必须在 `allowedPrefixes` 内，否则 `fail` 直接终止。
- `sensitive_change_gate`：触碰 `pom.xml / .gitignore / security / secrets / .env` 时返回 `warn`，触发 `awaitHuman({stage:'implementation'})` 等人工批准敏感变更。

### 8.5 build_test（所有 Flow 都有）

Runner 在 worktree 内 spawn 真实命令（白名单）：

```bash
./mvnw -B -DskipTests compile   # 或回退到 mvn
./mvnw -B test
```

每条命令都生成 `CommandRun`：`exitCode / startedAt / finishedAt / durationMs / stdoutRef / stderrRef / timedOut`。test 完成后扫描 `target/surefire-reports/*.xml` + `target/failsafe-reports/*.xml`，解析为 `TestRun`（per-suite 计数）+ `BuildRun`。

随后 `gate-engine` 跑：
- `compile_gate`：`compile.exit_zero` + `compile.no_timeout`。
- `test_gate`：`test.exit_zero` + `test.no_timeout` + `test.surefire_present` + `test.failures_zero` + `test.errors_zero` + `test.required_not_all_skipped`。

任意 fail 都会 `c.ok.value = false` 并抛错；后续 stage 不执行，但 `finally` 块仍把 `workflowCompleted(ok=false)` 上报。

### 8.6 review + acceptance（所有 Flow 都有）

调 `skill.review`：Agent 读 diff + test 报告，写 `review.md`（结论 / 风险 / follow-ups）。

随后 `acceptance_gate` 自动跑 traceability：要求 requirement / design / diff / review / 最近一次 `test_gate=pass` 全部齐备（issue.standard / refactor.standard / fastforward 中 requirement/design 不在 flow 内时该规则自动 not-applicable）。

通过后 `awaitHuman({stage:'review'})`，用户在 Web **接受验收**。一旦 approve：
- 把当前 run 中的 `requirement_draft` / `design_doc` 草稿 **promote** 为 KnowledgeArtifact（REQ-### / DSN-###），版本递增，prior accepted 自动 `superseded`。
- 全部进入下一 stage。

### 8.7 completion（所有 Flow 都有）

API `POST /workflow-runs/:id/completion-report` 拉取 SQLite 中所有 step / command / gate / artifact / build / test / approval，渲染为 markdown + JSON sidecar：

```text
~/.ai-native/reports/{runId}/{artId}.md
~/.ai-native/reports/{runId}/{artId}.json
```

报告包含：阶段时间线、Gate 结论、Build & Tests、Commands、Artifacts、Approvals。**所有结论引用事实源**，不允许 LLM 自述。

### 8.8 knowledge（仅 feature.standard）

API `POST /workflow-runs/:id/knowledge-candidate` 生成候选（Pattern / Decision / Pitfall），随后 `awaitHuman({stage:'knowledge'})`。

用户在 Web 「知识检视」面板可逐条 accept / edit / ignore；Approve 后：
- `persistKnowledgeCandidate` 把 curated 内容落盘到 `~/.ai-native/projects/{projectId}/knowledge/{runId}.md`。
- 下次 context_pack 阶段会自动 `collectAcceptedKnowledge` 注入。

Reject 则 `c.ok.value = false`（V1 quirk：拒绝不抛错，但 run 结果标记 failed）。

## 9. 人工 Gate 触发点（仅 6 个）

| 触发点 | 等待 stage | 决策 |
|---|---|---|
| 需求审批 | `requirement` | 批准 / 打回 |
| 设计审批 | `design` | 批准 / 打回 |
| 敏感变更审批 | `implementation` | 批准 / 打回（仅 sensitive 命中 warn 时触发） |
| 验收 | `review` | 接受验收 / 拒绝 |
| 知识入库 | `knowledge` | accept/edit/ignore 逐条 + 总开关 approve/reject |

**只在关键业务取舍点打扰用户**；机械检查全部由 Gate Engine + 真实命令完成。

## 10. 异常处理与可恢复性

- Approval 超时：Runner 由 `AINP_APPROVAL_TIMEOUT_MS` 控制；未配置时无限等待，可由用户在 Web 显式 reject。
- Compile/Test 失败：当前 V1 直接终止，不重试；用户可在仓库手动修复后重新创建 WorkflowRequest。
- Worktree 清理：默认 `cleanup=true`；调试时设 `--keep-worktree` 保留供 Inspect。
- Coordinator pause：用户在聊天线程回答即可继续，不需要新建任务。

V2 计划：每个 stage 完成时 snapshot 会话状态，失败时支持「从最近 checkpoint 恢复」（未落地）。

## 11. 用户视角端到端时间线（举例：`feature.fastforward`）

```text
00:00  用户：「给 Calculator 加 divide 方法」  → 创建 WorkflowRequest
00:05  Coordinator：proceed, runType=feature
00:06  Smart Router：feature.fastforward（短标题）
00:08  Runner：worktree 准备完成
00:30  Implementation：Agent 输出 diff，diff_scope=pass，sensitive=pass
01:30  Build/Test：mvn test 通过，3/3 pass
01:45  Review：Agent 输出 review.md，acceptance_gate=pass
01:50  → 等用户验收 ← （用户阅读 diff + 测试报告，点击「接受」）
02:10  Completion Report 生成
02:11  Run 标记 passed
```

`feature.standard` 完整流程通常 5-15 分钟（视 LLM 推理时间），`issue.standard` ~3-8 分钟。

## 12. 与设计文档的对应关系

- 业务流程主线总览：`2026-05-01-ai-native-platform-business-flow-integrated.md`
- V2 演进方向：`2026-05-04-ai-native-platform-v2-design-notes.md`
- 交接 / 落地清单：`2026-05-01-ai-native-platform-handoff.md`
- 当前执行环境决策：`2026-05-02-ai-native-platform-local-worktree-decision.md`
- 技术方案设计：本系列 `2026-05-06-technical-architecture-design.md`
