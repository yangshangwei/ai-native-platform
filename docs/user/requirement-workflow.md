---
doc_type: user-guide
slug: requirement-workflow
component: requirement-workflow
status: current
summary: 用户录入需求前需要准备什么，以及需求录入后如何按 Pipeline 完成交付闭环。
tags: [workflow, requirement, runner, gate, coordinator]
last_reviewed: 2026-06-28
---

# 需求工作流用户指南

## 功能简介

需求工作流不是把一句话丢给 Agent 后等待“魔法完成”，而是把一次需求交付拆成可查看、可暂停、可审批、可追溯的 Pipeline。

当前实现里，用户在 Web UI 创建的是 **Workflow Request**：它先进入队列；本地 Runner 认领前会跑一次 **Coordinator 对话分诊**，把"想清楚了"的需求送进真实的 **Workflow Run**，把"还没想清楚"的请求暂停在 `awaiting_clarification` 等用户补充。Run 创建之后准备独立 Git worktree，并按 `FLOW_REGISTRY` 中的具体 flow 推进。

```text
项目接入与工具链准备
  → 新建任务请求
  → Coordinator 对话分诊（pending ↔ awaiting_clarification）
  → Runner 认领并创建 worktree
  → Context Pack（feature.standard）
  → Requirement Draft + Requirement Gate + 人工确认
  → Design + Design Gate + 人工确认
  → Implementation + Diff/Sensitive Gates
  → 本地 Maven Compile/Test Gates
  → Review + Acceptance Gate + 人工验收
  → Completion Report
  → Knowledge Candidate + 人工确认入库（feature.standard）
```

上面是标准功能流 `feature.standard` 的完整路径，共 8 个可调度阶段：`context_pack → requirement → design → implementation → build_test → review → completion → knowledge`。`init` 只是 run 创建后的状态占位，不是一个会被 Runner dispatch 的阶段。短路径会跳过部分前置或知识阶段，例如 `feature.fastforward` 只跑 `implementation → build_test → review → completion`。

从用户视角看，它应该呈现为一个直观的工作流 / Pipeline：每一格代表一个阶段，每个 Gate 决定能否进入下一格，人工只在关键确认点介入。

## 对话分诊与 awaiting_clarification

录入请求 → Runner 真正 claim 之间还有一个"分诊"阶段。Coordinator Agent 会先看一眼用户的话和（如有）后续聊天，把请求分成可执行、需澄清、只问答或取消等 case：

| Case | 含义 | 后续动作 |
|---|---|---|
| `feature_clear` | 清晰的新能力，能对得上验收 | Runner claim；Router 选择 `feature.standard` 或 `feature.fastforward` |
| `bugfix` | 现存功能坏了 / 异常 / 期望 vs 实际 | Runner claim；进入 `issue.standard` |
| `refactor_clear` | 重构、清理、结构调整，不以新功能为主 | Runner claim；进入 `refactor.standard` |
| `ask` | 只问问题，不要求改代码 | 留在请求聊天通道，不创建 WorkflowRun |
| `feature_brainstorm` / `roadmap_needed` / `unclear` | 信息不够 / 范围太大 / 完全模糊 | 暂停为 `awaiting_clarification`，把 1-2 个澄清问题贴进对话线程 |

`awaiting_clarification` 状态下：

- 任务详情页右侧的 **Coordinator 对话** 面板会显示 Coordinator 的问题，并允许用户回复。
- 用户提交回复后，请求自动回到 `pending`，Runner 重新 triage（带上完整对话历史）。
- Coordinator 调到 `proceed` 后，请求被 claim、Run 创建，并从所选 flow 的第一个阶段开始正式跑流水线。

工作台头部会同时显示 **用户标记**（你在表单里选的 type，比如 `feature`）和 **Coordinator 判定**（`runType (routeCase)`，比如 `bugfix (bugfix)`）。两者不一致时 Coordinator 判定会高亮 `warn`——这是有用的运维信号，说明用户的语义信号被 Coordinator 纠正了。

LLM fallback 通道按项目级 `agentBackend` 优先级挑选 CLI（见"项目接入"页配置），只在规则分诊信心不足或配置要求时触发：

- 项目选 `claude_code` → 优先 `claude` CLI，不可用时回落 `codex`
- 项目选 `codex` → 优先 `codex` CLI，不可用时回落 `claude`
- 两个 CLI 都不可用时，如果规则层已经能可靠 `proceed`，Runner 会采用规则结果；否则 Coordinator `pause_for_human`，让用户补充信息。

## 录入需求之前需要怎么做

### 1. 接入项目

在“项目接入”页登记本地 Git 仓库，或使用 CLI：

```bash
bun run runner -- register --path ./examples/java-maven-sample --name java-sample --agent-backend codex
```

项目至少需要提供：

- 项目名称：例如 `java-sample`
- 本地路径：必须是一个 Git work tree
- 默认分支：例如 `main`

后续每个需求都会基于这个项目创建独立分支和 worktree。

### 2. 确认 Runner 与工具链

当前 MVP 使用 Trusted Local Worktree Mode：代码、编译、测试都在用户本机的独立 Git worktree 中执行。

```bash
bun run runner -- doctor
```

Java/Maven MVP 需要：Git、JDK、Maven、Bun。

### 3. 启动 API、Web

分别启动：

```bash
bun run dev:api
bun run dev:web
```

分工是：

- API：持久化状态、Gate、Artifact、Approval、Report。
- Web UI：录入任务、查看 Pipeline、处理人工确认。
- Runner Watch：从队列认领任务，创建 worktree，并执行流程。

正常 Web UI 使用不需要手动常驻 `bun run runner -- watch`。工作台会通过 API 的 `/runner/control/start` 启动并监控本地 Runner Watch。手动 `bun run runner -- watch` 仍适合调试、API-managed Runner 不可用时的 fallback，或需要直接观察 runner stdout/stderr 的场景。

如果 Runner 没有运行，用户仍可创建任务请求，但普通执行请求会停在队列里，不会开始执行。

## 具备哪些基本条件才能开始干活

| 条件 | 为什么需要 |
|---|---|
| 项目已注册 | Workflow Request 必须绑定到 Project。 |
| 项目路径是 Git 仓库 | Runner 要创建 `ai/{runId}-{slug}` 分支和独立 worktree。 |
| Runner 在线 | UI 创建请求后，需要 Runner Watch 认领并执行。 |
| Git/JDK/Maven 可用 | 当前 Build/Test Gate 依赖本机 Java/Maven 真实命令。 |
| API 可访问 | Runner 和 Web 都要把状态、产物、审批写回 API。 |
| 用户能处理人工确认 | 标准功能流会在 Requirement、Design、Acceptance、Knowledge 暂停等待审批；短 flow 至少保留 Review/Acceptance。 |
| 需求描述包含目标或验收意图 | 越清楚的输入越容易生成可验收的 Requirement Draft。 |

建议录入需求时写清楚：业务问题、期望结果、验收标准、约束和不要做的事情。

示例：

```text
为报告页增加导出按钮。用户可以把当前 Completion Report 下载成 Markdown；不引入新前端框架；完成后 mvn test 必须通过。
```

## 录入之后，它按什么流程工作

### 0. 新建任务请求：只入队，不直接执行

用户在“新建任务”页选择项目、类型、源分支，并填写 Task Title / Intent。

提交后 API 创建 `WorkflowRequest`：

```text
pending → claimed → completed / failed
```

此时还没有真正开始改代码；它只是进入 Runner Queue。

### 1. Runner 认领并创建 Workflow Run

Runner Watch 看到 pending 请求后，会 claim 请求、创建 `WorkflowRun`、准备独立 worktree、生成 `ai/{runId}-{slug}` 分支，并把 workspace 路径写回 API。

从这里开始，工作台会出现一条可跟踪的 Run。

> 注：Runner 在 claim 之前会先跑 Coordinator 对话分诊（见 [对话分诊与 awaiting_clarification](#对话分诊与-awaiting_clarification)）。歧义请求会被暂停为 `awaiting_clarification`，由用户补充后再 claim；清晰请求会被直接 claim，并由 Coordinator / Router 决定 run type 与 flow（feature / bugfix / refactor / ask）。

当前代码里的 flow 是：

| Flow | 阶段 |
|---|---|
| `feature.standard` | `context_pack → requirement → design → implementation → build_test → review → completion → knowledge` |
| `feature.fastforward` | `implementation → build_test → review → completion` |
| `issue.standard` | `report → analyze → implementation → build_test → review → completion` |
| `refactor.standard` | `scan → plan → implementation → build_test → review → completion` |

下面以 `feature.standard` 为主线说明；其它 flow 会跳过不在自己阶段列表里的 Requirement、Design、Knowledge 等步骤。

### 2. Context Pack：先找工程背景（feature.standard）

Runner 生成项目 Profile，并把用户需求、项目结构、相关源码线索、已接受的知识经验组装成 Context Pack。

这个阶段解决的是：Agent 写需求和方案之前，先知道当前项目是什么样，而不是凭空发挥。

### 3. Requirement：把原始想法变成可验收需求（feature.standard）

Requirement Agent 输出目标、用户场景、非目标、验收标准 AC 和 Context evidence。

`requirement_gate` 检查是否有：

- `REQ-###` 需求 ID
- `AC-###` 验收标准
- goals / non-goals / scope
- Context evidence

Gate 通过后，流程暂停在人工确认点。用户在工作台查看 Requirement 卡片，确认后才进入设计阶段。

### 4. Design：把需求变成开发方案（feature.standard）

Design Agent 基于已确认 Requirement 和 Context Pack 输出设计：需求覆盖矩阵、影响模块 / 文件、测试策略、风险和 Traceability sidecar。

`design_gate` 检查设计是否覆盖需求、是否有测试策略、风险和工程上下文依据。Gate 通过后再次等待人工批准。

### 5. Implementation：在 worktree 中产生真实 diff

Implementation Agent 在独立 worktree 中修改代码，并输出 `git diff` 和 changed files。

随后执行：

- `diff_scope_gate`：检查改动是否在允许范围内。
- `sensitive_change_gate`：检查是否触碰 `pom.xml`、`.env`、secret、安全相关路径等敏感文件。

如果 Sensitive Gate 是 `warn`，工作台会出现 Sensitive Change Checkpoint，需要用户确认是否继续。

### 6. Build & Test：只认真实命令结果

默认 Java/Maven 路径会在 worktree 中执行：

```bash
mvn -B -DskipTests compile
mvn -B test
```

如果项目有 `./mvnw`，优先使用 Maven Wrapper。项目也可以配置 custom compile/test command；这些命令仍需要通过 Runner 的白名单/extraAllow，并会生成同样的 CommandRun 证据。

平台记录 CommandRun、BuildRun、TestRun、Surefire/Failsafe 报告，以及 `compile_gate` / `test_gate`。Agent 可以解释失败日志，但不能自己宣布测试通过。

### 7. Review & Acceptance：检查证据链并验收

Review Agent 写实现审查摘要；`acceptance_gate` 检查关键证据是否齐全：

```text
Requirement → Design → Diff → Test Gate → Review → Approval
```

通过后，流程暂停等待人工验收。用户应检查 Acceptance Checklist：AC 是否有证据、测试是否通过、风险是否可接受、是否需要打回修改。

### 8. Completion Report：生成交付报告

验收后平台生成 Completion Report，汇总 Requirement、Design、Review、Diff、CommandRun、BuildRun、TestRun、GateRun、Approval 和 Audit log。

它用于交付说明、审计和后续追溯。

### 9. Knowledge Capture：经验候选，人工确认后入库（feature.standard）

最后平台生成 Knowledge Candidate，例如决策、踩坑、可复用模式和项目经验。用户可以接受、编辑或忽略候选。

只有通过 Knowledge Gate 的内容才会持久化，并在未来需求的 Context Pack 中被复用。

## 用户在 UI 里应该怎么看

当前 Web UI 已按这个流程组织：

- **项目接入**：注册本地仓库，选择项目级 Agent Backend（Claude Code 或 Codex），查看 Runner / JDK / Maven / Git 状态。
- **新建任务**：创建 Workflow Request，进入 Runner Queue。
- **工作台**：Lifecycle Board 展示每个阶段是 waiting、active、blocked、done 还是 failed。
- **Human Checkpoint**：集中处理 Requirement、Design、Sensitive Change、Acceptance、Knowledge 审批。
- **证据面板**：查看 Gate、Command、Artifact、AgentTask、Audit，以及 Claude Code / Codex 的实时流式执行日志。
- **报告**：查看 Completion Report。
- **知识库**：处理 Knowledge Candidate。

## 当前 MVP 边界

- 当前主流程是本地 Java/Maven 项目优先；其它语言和构建工具还不是完整 MVP 主线。
- Runner 使用本地 trusted worktree，不提供沙箱级隔离。
- Workflow 模板、SkillSpec、Hook 目前多数仍是代码内固定配置，还不是完整 UI 化配置系统。
- Agent Backend 必须是真实本机 CLI：`claude_code`（Claude Code）或 `codex`（Codex）。项目未配置 backend 或 CLI preflight 未通过时，任务不会入队/执行。
- CLI 兼容：macOS/Linux 默认使用 `claude` / `codex`；Windows 会尝试 `claude.cmd` / `codex.cmd`、`.exe` 等 Node/npm/Bun shim。若 CLI 不在 PATH 上，可用 `AINP_CLAUDE_BIN` / `AINP_CODEX_BIN` 指定；预检和真实执行共用同一解析结果。
- Tool Policy 当前主要用于提示和审计，不作为强制沙箱策略。

## 快速路径

```bash
bun install
bun run dev:api
bun run dev:web
bun run runner -- doctor
bun run runner -- register --path ./examples/java-maven-sample --name java-sample --agent-backend codex
# 可选 fallback/debug：Web 正常会通过 /runner/control/start 启动 Runner
bun run runner -- watch
```

然后打开：

```text
http://127.0.0.1:5173/
```

进入“项目接入”确认 Claude Code/Codex 连接状态，再进入“新建任务”填写需求，回到“工作台”观察 Pipeline 和实时执行日志，并在人工确认点审批。
