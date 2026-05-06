# AI Native Platform UI 端到端操作流程

> 日期：2026-05-06
> 性质：**UI 操作流程梳理**，面向用户使用 + 客户演示 + UI/UX 评审。
> 范围：用户从打开 `http://127.0.0.1:5173/` 到完成一次交付（含人工检查点）的全部操作步骤。
> 配套：`2026-05-06-end-to-end-business-flow.md`（业务流程） / `2026-05-06-technical-architecture-design.md`（技术方案）。
> 信息源：`apps/web/{index.html,src/main.ts,src/projection.ts,src/settings-projection.ts}` 静态分析；本文不依赖运行时实跑。

## 1. 前置启动顺序

打开 UI 之前需要的服务：

```bash
bun install
bun run dev:api         # Terminal A → http://127.0.0.1:8787
bun run dev:web         # Terminal B → http://127.0.0.1:5173 (proxy /api/*)
```

Web 不需要手动启动 Runner——在 UI 里通过 `/runner/control/start` 由 API 拉起本地 watch 进程；命令行 `bun run runner -- watch` 仅作 fallback。

打开 `http://127.0.0.1:5173/` 后，看到的是一张 **Delivery Workbench** 单页应用。整个应用由 `apps/web/src/main.ts`（4272 行）+ `index.html`（含 inline CSS）+ `projection.ts`（751 行 UI 数据投射）组成，无 Vite、无框架，纯 TS hashchange 路由。

## 2. 整体布局

```text
┌──────────────────────────────────────────────────────────────────┐
│ ┌── Sidebar 284px ──┐ ┌──────── Main Shell ──────────────────┐ │
│ │ [AI] Native        │ │ ┌── Topbar ─────────────────────┐  │ │
│ │ Delivery Workbench │ │ │ AI 软件交付工作台              │  │ │
│ │                    │ │ │ <当前页面标题>                 │  │ │
│ │ [六个 Nav 按钮]    │ │ │  Project | Branch | Runner |   │  │ │
│ │                    │ │ │  Agent Backend | Build Env     │  │ │
│ │ 自动执行卡片        │ │ └────────────────────────────────┘  │ │
│ │  Pending / Claimed │ │                                     │ │
│ │  最近请求 / Runner │ │   <renderCurrentPage() 切换主体>    │ │
│ │   pid              │ │                                     │ │
│ └────────────────────┘ └─────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### 2.1 Sidebar 六个导航项

`type Page = 'workbench' | 'task' | 'projects' | 'new-task' | 'reports' | 'knowledge' | 'settings'`（`task` 是详情页，不直接出现在 nav）。

| Nav 按钮 | hash | 副标题（help） | 用途 |
|---|---|---|---|
| 工作台 | `#workbench` | 生命周期与人工确认 | 默认入口；任务总览 + 待办 |
| 项目接入 | `#projects` | 注册本地/远端 Git | 添加 / 编辑 Project |
| 新建任务 | `#new-task` | 进入 runner 队列 | 提交 WorkflowRequest |
| 报告 | `#reports` | 交付证据汇总 | Completion Report 列表 |
| 知识库 | `#knowledge` | 候选与沉淀 | KnowledgeArtifact 浏览 |
| 配置 | `#settings` | 本地 worktree 模式 | runtime config 在线编辑 |

### 2.2 Topbar 五项 context-strip（始终可见的状态总线）

- **Project**：当前选中项目名（未接入显示「未接入」）。
- **Branch**：当前活跃 run 的分支或项目 defaultBranch。
- **Runner**：心跳状态（`online` / `offline`）。
- **Agent Backend**：项目配置的 backend + preflight 结果（`Claude Code (ready)` / `Codex (failed)`）。
- **Build Env**：JDK / Maven / Git 版本（来自 Runner 心跳）。

### 2.3 Sidebar 队列卡

实时显示 `Pending / Claimed` 计数 + 最近一条 WorkflowRequest 摘要 + Runner pid。是用户判断「是否还有任务在排队」的最快入口。

## 3. 页面 1：项目接入（`#projects`）

**首次使用必经之路**。如果还没有项目，工作台总览会显示空状态并引导跳转此页。

### 3.1 操作步骤

1. 点 **新建项目** 按钮（或编辑已有卡片）。
2. 在表单中：
   - 名称：项目展示名（slug 化作为 `Project.name`）。
   - 本地路径：点 **浏览…** 弹出本地目录选择器（`openLocalDirectoryPicker`）→ 内部循环 `loadLocalDirectories(path)` 调用 `/projects/listing`。
   - 默认分支：detectProjectSource 自动识别 `git symbolic-ref refs/remotes/origin/HEAD` 或 `git branch --show-current`。
   - Agent Backend：单选 `Claude Code` 或 `Codex`；可选填 `Bin Path`（覆盖 `AINP_CLAUDE_BIN` / `AINP_CODEX_BIN`）。
3. 点 **检测项目源**：触发 `POST /projects/detect`，前端展示项目类型、构建系统、可选分支列表。
4. 点 **测试 Agent Backend**：触发 `POST /agent-backend/preflight`，UI 显示 `claude --version` / `codex --version` 是否成功；失败时给出安装/登录修复提示。
5. 点 **保存**：`POST /projects` 创建或 `PATCH /projects/:id` 更新；卡片回到列表，Topbar 的 **Agent Backend** 立即反映新状态。

### 3.2 已接入项目列表

每张 `project-card` 显示：项目名、本地路径、defaultBranch、Agent Backend 标签。点卡片切换 selected project（影响 Topbar 与新建任务表单）。右侧 actions：编辑、删除（删除前会提示）。

## 4. 页面 2：新建任务（`#new-task`）

> 2026-05-06 更新：Type 下拉已从主表单移入「高级覆盖」disclosure，默认让 Coordinator + Smart Router 两段判定。详见 `.trellis/tasks/05-06-new-task-form-router-driven-defaults/prd.md`。截图待更新。

### 4.1 字段与交互

```text
┌─ form-card.wide ───────────────────────────────────┐
│ 选择项目  [Select: 已接入项目]                      │
│ 任务标题  [Textarea: 一句话描述]  ← blur 触发预览   │
│                                                    │
│ ┌─ 智能推荐 ────────────────────────────────────┐  │
│ │ POST /coordinator/preview → /router/recommend │  │
│ │ AI 判定: feature · 置信 75%                    │  │
│ │ feature.fastforward · 从头执行                 │  │
│ │ 预估 ~6 分钟 / ~32K tokens                     │  │
│ │ 规则: rule.feature_keywords_dominant /         │  │
│ │       flow.feature_short_to_fastforward        │  │
│ └────────────────────────────────────────────────┘  │
│                                                    │
│ ▶ 高级覆盖（手动指定 Type；Flow/起始阶段 待后续）   │
│   └─ Type [Select: (让 AI 自动判定) | feature       │
│            | bugfix | smoke | refactor]            │
│                                                    │
│ Source Branch [Select: 项目分支] [Refresh]          │
│ Agent Backend [show-only: 跟随项目]                 │
│                                                    │
│ [创建任务]  [查看工作台]                             │
└────────────────────────────────────────────────────┘
```

### 4.2 关键行为

- **两段式智能推荐**（标题失焦后 400ms debounce）：
  1. 若 Type 留空（默认）：先 `POST /coordinator/preview { title }` → `{ predictedRunType, confidence, rulesFired, hint }`，再 `POST /router/recommend { projectId, title, runType: predicted }`。卡片渲染 `AI 判定: <runType> · 置信 <pct>`，hint 命中（`too_short` / `large_scope`）时渲染 ⚠ 黄色 callout。
  2. 若用户在「高级覆盖」选了 Type：跳过 coordinator preview，直接 `/router/recommend` 用 override。
- **高级覆盖 disclosure**（`<details>` 默认折叠）：当前只放 Type 一项；Flow / Start Stage override 需要扩展 `/workflow-requests` body 与 WorkflowRequest schema，列入后续任务。
- **Source Branch 列表懒加载**：第一次点 select 时才 `POST /projects/:id/branches/refresh`（避免每次切项目都跑 git）。
- **Agent Backend 不在表单内**：跟随项目配置，但提供 `去设置` 跳转链接（`renderAgentBackendSetupPrompt`）。
- **提交按钮**：`POST /workflow-requests`（含 firstMessage 写入聊天线程同事务）；如未展开高级覆盖，body 不传 `type`，server 默认 `'feature'`，Coordinator 实际跑时仍会独立判定（mismatch detector 会在任务详情里展示差异）。成功后 `setHash('task', request.id)` 跳到任务详情。

## 5. 页面 3：任务详情（`#task/{requestId}`）

**用户花最多时间的地方**。布局：左主 + 右辅。

### 5.1 左主区（workspace-main）

#### 5.1.1 Task Hero（`renderTaskHero`）

顶部一张大卡：

- 标题（一行）+ 状态 pill（pending / running / awaiting_human / passed / failed）
- 分支 / 工作区路径 / 创建时间
- 当前阶段名（中文：「需求分析」「构建测试」…）
- 进度计数：commands / gatesPassed / gatesWarned / gatesFailed / testsPassed-of-total / buildStatus

#### 5.1.2 Coordinator Chat（仅当未 proceed 时）

如果 Coordinator decide `pause_for_human`，request 状态切到 `awaiting_clarification`：

- 显示之前的 user / coordinator 聊天消息列表（`/workflow-requests/:id/messages`）。
- 底部 textarea + **回复 Coordinator** 按钮 → `POST /workflow-requests/:id/messages { role:'user' }` + `POST /workflow-requests/:id/status { status:'pending' }` 让 Runner 重新分诊。

#### 5.1.3 9-Stage 生命周期板（`renderLifecycle`）

九张 stage-card 横向排列（移动端折行），每张 110px 宽：

```text
[1 任务受理✓] [2 上下文准备✓] [3 需求分析●] [4 方案设计○] [5 代码实现○]
[6 构建测试○] [7 验收确认○] [8 交付报告○] [9 知识沉淀○]
```

状态 5 种（CSS 类）：

| 状态 | CSS class | 视觉 | 含义 |
|---|---|---|---|
| done | `.done` | 绿底 + ✓ | StepRun.passed 或 Gate.pass |
| active | `.active` | 蓝底 + 旋转 | run.status='running' 且当前 stage |
| blocked | `.blocked` | 橙底 + ⏸ | awaiting_human 等待用户操作 |
| failed | `.failed` | 红底 + ✗ | StepRun.failed 或 Gate.fail |
| waiting | （无） | 灰底 | 还没轮到 |

stage-card 鼠标悬浮显示 `STAGE_HELP[stage]`（`projection.ts:37` 的中文解释），如：「Runner 自动扫描项目资料、复用项目画像和历史知识，生成给后续 Agent 使用的上下文包。」

未启动的任务（pending）调 `renderQueuedLifecycle`，把九阶段渲染成灰色 + 一句「等待 Runner 认领」。

#### 5.1.4 当前阶段面板（`renderCurrentStagePanel`）

按 `effectiveStage`（考虑 failed 时回退到上一个有 step 的 stage）渲染主体内容。每个 stage 一种专属视图：

| 阶段 | 主体内容 |
|---|---|
| context_pack | 上下文 snapshot：project_profile.md 摘要、accepted knowledge 引用清单 |
| requirement | 结构化 RequirementDoc：goals / userScenarios / **AC 列表（带 ID）** / nonGoals / openQuestions + 原始 markdown 切换 |
| design | 结构化 DesignDoc：summary / affectedModules / filesTouched / testStrategy / risks / **覆盖矩阵表（REQ × Design × AC × verification）** |
| implementation | git diff 全文（深色代码块） + changed-files 列表 + 两条 Gate 状态 |
| build_test | Maven 命令 chip + BuildRun 列表 + Surefire/Failsafe 测试聚合表（Total / Pass / Fail / Errors / Skipped） |
| review | acceptance checklist：每条 AC × evidence 卡片（passed / at_risk / missing 三态） |
| completion | Completion Report 渲染：summary 行 + sections 折叠面板 |
| knowledge | KnowledgeSuggestion 列表：每条 Decision/Pitfall/Pattern/Lesson 候选 |

文档原文按需展开：每个面板底部有 `<details>` 折叠的「查看 markdown 原文」+「查看 JSON 原文」（call `/artifacts/:id/content`）。

#### 5.1.5 Stage Backend Details（`renderStageBackendDetails`）

九条折叠 stage-detail，每条展示 backend 视角的真实数据：

```text
▼ 3. 需求分析 (passed)
   StepRun: step_xxx (started=… completed=…)
   AgentTask: agt_yyy (backend=claude_code)
   AgentResult: success — "requirement produced 1 artifact(s)"
   Artifacts: requirement.md (12.4 KB) | requirement.json (3.1 KB)
   Gate: requirement_gate=pass (9 rules: draft_present=pass, ids_present=pass, …)
   Approvals: requirement_gate=approved by user (at …)
```

排错时直接看这一段就能定位失败点。

### 5.2 右辅区（workspace-side）

#### 5.2.1 Next Action Panel（`renderTaskNextActionPanel`）— **核心检查点入口**

根据 `pendingGate` 的值动态渲染按钮组：

| pendingGate | 按钮 | 行为 |
|---|---|---|
| `requirement_gate` | **批准需求** / **打回** | `POST /approvals { approved:true/false }` |
| `design_gate` | **批准设计** / **打回** | 同上 |
| `sensitive_change_gate` | **批准敏感变更继续** / **要求修改** | 仅当 sensitive 命中 warn 时出现 |
| `acceptance_gate` | **接受风险并验收** / **Reject** | 调 `submitAcceptanceDecision`：`POST /workflow-runs/:id/acceptance-decision { decision:'accept_risk' }` 或 `'reject'` |
| `knowledge_gate` | 三种逐条按钮 + **确认 accepted/edited 候选入库** | 见 §5.2.2 |

按钮在 in-flight 时禁用并显示 spinner，避免重复提交。

#### 5.2.2 Knowledge Suggestions Panel（仅 stage=knowledge 时）

每条 KnowledgeSuggestion 一张卡：

```text
┌─ Pattern · 规避 BigDecimal NPE ────────────┐
│ Trusted Local Worktree mode 足以覆盖低风险… │
│ Evidence: workflowRun=run_xxx               │
│ [Accept] [Edit…] [Ignore]                   │
└─────────────────────────────────────────────┘
```

- **Accept**：`POST /workflow-runs/:id/actions { kind:'knowledge_suggestion_action', action:'accepted' }`，卡片变绿。
- **Edit**：弹出 textarea 编辑 `text`，保存触发 `action:'edited'` + payload 含 `originalText`。
- **Ignore**：`action:'ignored'`，卡片置灰。

底部一颗总开关 **确认 accepted/edited 候选入库** → `POST /approvals { gateId:'knowledge_gate', approved:true }` 触发 Runner `persistKnowledgeCandidate` 落盘到 `~/.ai-native/projects/{projectId}/knowledge/{runId}.md`。

#### 5.2.3 Runner Control Panel

- 当前 Runner 状态：`online (pid=12345)` 或 `offline`。
- **启动 Runner** 按钮：`POST /runner/control/start`（API 自己 spawn `apps/runner/src/index.ts watch --poll-ms 1000`）。
- **停止 Runner** 按钮：`POST /runner/control/stop`。
- 心跳元数据：JDK / Maven / Git 版本。

#### 5.2.4 Evidence Panel（运行中才显示）

按类型分组的 `<details>` 折叠组：

- **产物（Artifacts）**：每条 artifact 一行 `<row>`，含 kind / size / createdAt + 「查看内容」按钮（调 `/artifacts/:id/content`，inline 渲染 markdown 或 JSON 或 diff）。
- **命令（Commands）**：每条 CommandRun 一行 + 「展开 stdout/stderr」（调 `/command-runs/:id/logs`）。
- **Gates**：每条 GateRun 状态 pill + 规则展开（每条 RuleResult 的 `ruleId / status / message`）。
- **Approvals**：每条 Approval 行（gateId / decision / actor / decidedAt / comment）。
- **Audit**：折叠在最底；展开后是 audit log 时间线。

#### 5.2.5 Agent Stream Panel（SSE 实时事件流）

深色面板（仿终端），订阅 `EventSource('/workflow-runs/:id/events/stream')`：

```text
┌─ Agent Stream ●live ─────────────────────────┐
│ [10:23:01] system   ↪ skill.requirement_draft │
│ [10:23:02] assistant Reading context_pack.md… │
│ [10:23:05] tool_use Read /src/Calculator.java │
│ [10:23:06] tool_result 32 lines               │
│ [10:23:08] assistant 已识别 REQ-001…          │
│ [10:23:11] result   exitCode=0                │
└────────────────────────────────────────────────┘
```

事件分类：`system / user / assistant / tool_use / tool_result / result / stderr / meta / raw`，按 CSS class 染色。状态指示器三色：`live`（绿）/ `error`（红）/ `idle`（灰）。重连失败会指数退避并显示。

## 6. 页面 4：工作台（`#workbench`）

入口页，五个并列桶 + 一份任务列表：

```text
┌─ 概览 ─────────────────────────────────────────────────┐
│ 待人工确认 (3)   失败的 Gate (1)   运行中 (2)            │
│  • run_xxx       • run_yyy           • run_zzz           │
│    需求确认        diff_scope_gate     正在 implementation│
│                                                         │
│ 待 Runner 认领 (5)        最近完成 (4)                   │
│  • req_aaa  pending        • run_uuu  passed             │
└────────────────────────────────────────────────────────┘

┌─ 任务列表 ─────────────────────────────────────────────┐
│ [task] 给 Calculator 加 divide  pending  3min ago       │
│ [task] 修复登录跳转 bug         awaiting_human  10min   │
└────────────────────────────────────────────────────────┘

┌─ Runner 控制（同任务详情页右辅） ─┐
└──────────────────────────────────┘
```

每行点进去 `setHash('task', request.id)`，等同于直接进入 §5。

## 7. 页面 5：报告（`#reports`）

- 列表展示 `WorkflowRun.status='passed'` 的 run，按时间倒序。
- 每行：标题 + 项目 + 分支 + 完成时间 + **查看报告** 按钮。
- 点击调 `GET /artifacts/workflow-runs/:id/completion_report/latest/content` 渲染 Completion Report markdown（含 stage 时间线、gate 表、command 列表、approval 记录），右侧 `<details>` 可看 JSON sidecar。

## 8. 页面 6：知识库（`#knowledge`）

V2 升级后的视图：按 KnowledgeArtifactKind 分组浏览（Requirement / Design / Architecture / Roadmap / Decision / Lesson / Pattern / Explore / Dev Guide / API Doc 共 10 类）。

- 每张卡片显示：`entityId`（REQ-001 / DSN-003 / LSN-002）+ 状态 pill（draft / accepted / superseded）+ version + subtype + updatedAt。
- 点 entityId 跳到详情面板，渲染 markdown body + version 历史时间线 + `derivedFromArtifactId` 反向跳到原 run。
- accepted 卡的「点击穿透」：点 AC-### 跳到对应 design 的挂载点 → 点挂载点跳测试报告 → 点测试跳通过 commit（V2 路线项，部分已落地）。

## 9. 页面 7：配置（`#settings`）

runtime config 在线编辑界面：

- 顶部 sticky tab 按 namespace 分组（`runner.* / skill.*.instructions / approval.* / build.*`）。
- 每条 config-row：
  - 左：`config-key`（等宽字体）+ overridden / dirty 状态 pill。
  - 中：description + 默认值（来自 registry）+ 当前覆盖值（textarea / input）。
  - 右 actions：**保存**（PUT /config/:key）/ **重置默认**（DELETE）/ **复制默认到草稿** / **历史**（按时间展开 actor + old value + new value）。
- 已 overridden 的行边框变蓝；有未保存修改的行边框变橙（dirty）。
- skill `instructions` 是大文本（textarea 自动 resize），用户可在线调整 prompt 不需重启。

## 10. 完整端到端 UI 操作时间线（举例：feature.fastforward）

下面以一条「给 Calculator 加 divide 方法」从打开浏览器到看到 Completion Report 的完整鼠标键盘动作：

```text
T+0:00  开浏览器 → http://127.0.0.1:5173/  →  显示 #workbench (空)
T+0:05  Topbar Runner 显示 offline →  右辅 Runner 控制面板 → 点 启动 Runner
        UI 调 POST /runner/control/start，2s 后变 online (pid=…)
T+0:15  点左侧 Nav 「项目接入」 → 列表为空
T+0:25  点 新建项目 → 浏览… 选 ./examples/java-maven-sample → 检测项目源
        Agent Backend 选 Claude Code → 测试 Agent Backend (preflight 绿) → 保存
T+1:00  点左侧 Nav 「新建任务」
        选项目 java-sample，类型 feature
        标题输入 "给 Calculator 加 divide 方法"
        textarea blur → 自动展示 Smart Router 预览：
          flowId=feature.fastforward  est ~6min ~32K tokens
        Source Branch 选 main，详情 textarea 简单写两行
        点 创建任务 → 跳转 #task/wreq_xxx
T+1:05  Task Hero 显示 pending；下方 Lifecycle 9 阶段全灰
        Sidebar Pending=1 闪了一下 → 几秒后变 Claimed=1
T+1:30  生命周期板 1-2 阶段亮绿（Trusted Local Worktree 已就绪）
        Agent Stream 面板开始滚动 stream-json 行
T+2:00  实现阶段 active：右辅 Evidence 出现 diff artifact
        diff_scope_gate=pass，sensitive_change_gate=pass（无敏感路径）
T+3:00  build_test active：command-chip 显示 mvn -B test
        测试聚合表显示 3 passed / 0 failed
        compile_gate=pass / test_gate=pass
T+3:30  review 阶段：当前阶段面板显示 acceptance checklist
        run.status 切 awaiting_human → Lifecycle [验收确认] 卡橙色 blocked
T+3:31  右辅 Next Action 出现两颗按钮：
          [接受风险并验收] (蓝色 primary) | [Reject] (红色 danger)
        点 [接受风险并验收]
T+3:35  Lifecycle 进入 8.completion → 9.knowledge
        Knowledge Suggestions Panel 列出 3 条候选 (Pattern / Decision / Pitfall)
        逐条 Accept (3 张卡变绿)
        点底部 [确认 accepted/edited 候选入库]
T+3:40  Run.status=passed → Hero 大状态 pill 变绿
        Lifecycle 全绿；Reports 页面顶部出现新行
T+3:45  点 Nav 「报告」 → 选刚刚的 run → 渲染 Completion Report
        阶段时间线 / Gate 表 / Build & Tests / Approvals 全部清晰
```

整套 fastforward 流程从打开浏览器到拿到报告，**4 分钟 + 1 次人工验收 + 3 次知识入库点击**。

完整 `feature.standard` 流程多 3 个人工检查点（需求 / 设计 / 验收），通常 8-15 分钟（视 LLM 推理速度）。

## 11. 用户视角的「最少必学」清单

新人接入项目后只需要会 6 件事：

1. **判断 Runner 是否在线**：看 Topbar `Runner` pill 颜色。
2. **看待办**：工作台「待人工确认」桶；点进去就是任务详情。
3. **批准 / 打回**：右辅 Next Action Panel 的两颗按钮。
4. **看证据**：右辅 Evidence Panel 折叠组逐项展开。
5. **新建任务**：Nav「新建任务」→ 写一句话 → 看路由预览 → 提交。
6. **找历史报告**：Nav「报告」按时间挑。

进阶能力（不强制）：协调器聊天澄清、Agent Stream 面板看实时推理、配置中心改 instructions、知识库穿透浏览。

## 12. 与设计文档的对应关系

历史 UI 设计文档（`2026-05-01-ai-native-platform-ui-design-{notes,continued,final}.md`）描述的是 V1 设计草稿；本文档基于当前真实代码（`apps/web/src/main.ts`）梳理实际实现。两者之间已落地的差异：

- ✅ Topbar 5 项 context-strip（设计稿 4 项，加了 `Build Env`）。
- ✅ Smart Router 预览（设计稿无，是 V2 W2-4 加的）。
- ✅ Agent Stream Panel SSE（设计稿仅提到「证据流」，实际是 stream-json 实时染色）。
- ✅ Knowledge Suggestions 逐条 accept/edit/ignore（设计稿是单按钮入库）。
- ⏳ 编号穿透浏览（设计稿要求点 AC 跳设计 / 测试 / commit，当前仅基本实现）。
- ⏳ V2 知识库 10 类分组视图（部分实现，仍以 KnowledgeArtifact 列表为主）。

本梳理可作为后续 UI 改进迭代的对照基线。
