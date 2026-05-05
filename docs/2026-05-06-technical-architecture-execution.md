# AI Native Platform 技术方案：执行与演进

> 日期：2026-05-06
> 性质：**技术方案沉淀（执行与演进篇）**，承接核心架构篇。
> 范围：Skill / AgentBackend、Local Runner / Worktree、持久化布局、SSE、API 接口分类、安全 / 可观测性、V2 演进路线、设计原则速查。
> 配套：业务流程 `2026-05-06-end-to-end-business-flow.md`；核心架构 `2026-05-06-technical-architecture-design.md`。

## 1. Skill 与 AgentBackend

### 1.1 SkillSpec（Canonical）

```ts
interface SkillSpec {
  id: string                  // skill.context_pack / skill.requirement_draft / ...
  version: string             // 0.1.0 / 0.2.0
  stage: WorkflowStage
  instructions: string        // 可被 runtime config 在线覆盖
  inputs: SkillInput[]        // {name, kind: text|artifact, required, description}
  outputs: SkillOutput[]      // {name, kind: artifact, required, description}
  toolPolicy: ToolPolicy      // {allowedCommands, writableGlobs, networkAllowed}
  requiredGates: GateId[]
  compatibleBackends: ProjectAgentBackendKind[]
}
```

平台维护 9 个 Canonical Skill：

| stage | skill id | 输出 |
|---|---|---|
| context_pack | `skill.context_pack` | `context_pack.md` |
| requirement | `skill.requirement_draft` | `requirement.md` (+ `.json`) |
| design | `skill.design` | `design.md` (+ `.json` / `traceability.json`) |
| implementation | `skill.implementation` | `diff` + `changed-files` |
| review | `skill.review` | `review.md` |
| report (issue) | `skill.issue_report` | `report.md` |
| analyze (issue) | `skill.issue_analyze` | `analysis_doc.md` |
| scan (refactor) | `skill.refactor_scan` | `scan_doc.md` |
| plan (refactor) | `skill.refactor_design` | `refactor_plan.md` |

### 1.2 在线编辑 instructions

`findSkillForStage(stage)` 异步查询 runtime config，把 `${skill.id}.instructions` 覆盖到返回值。Web 配置中心可在线编辑这些文本，无需重启 API/Runner。结构字段（id / inputs / outputs / requiredGates / toolPolicy / compatibleBackends）始终硬编码契约，禁止 UI 修改。

### 1.3 AgentBackend Adapter

```ts
interface AgentBackend {
  kind: 'claude_code' | 'codex' | 'native'
  run(skill: SkillSpec, ctx: SkillContext): Promise<{ outputs: AgentOutput[] }>
  cancel(taskId): Promise<void>
}
```

`apps/runner/src/agents/{claude-code,codex}.ts`：

- 跨平台 CLI 解析：macOS/Linux 默认 `claude` / `codex`；Windows 优先尝试 `.cmd` / `.exe` / npm/Bun shim。
- 可通过 `AINP_CLAUDE_BIN` / `AINP_CODEX_BIN` 固定路径。
- 用 `--output-format stream-json` 流式输出，按行解析 `assistant` / `tool_use` / `tool_result` / `result` 事件，转 `AgentStreamEvent` 写入 SSE bus。
- preflight 通过的解析结果会复用，避免每次重新 spawn。

### 1.4 Skill 调用协议

orchestrator 给每个 skill 喂入：

```ts
interface SkillContext {
  workflowRunId
  stepRunId
  workspacePath          // worktree
  branch                 // 任务分支
  title                  // user request
  artifactsDir           // ~/.ai-native/artifacts/{runId}/{stage}/
  inputs: Record<string, string>   // 累积所有 prior stage 的产物文本
}
```

skill 必须按 `outputs[].name` 在 `artifactsDir` 中落盘；orchestrator 读回文件 → `api.postArtifact()` → 把文本回灌 `inputs` 给下一 stage。这个 4 步循环（喂入 / 落盘 / 注册 / 透传）在 V1 已稳定，V2 仅增加 `draftsToPromote` 数组用于 acceptance 后升级知识库。

### 1.5 Coordinator Agent

`apps/runner/src/agents/coordinator/*.ts` 二段式分诊：

1. **Rules**：基于关键词匹配先做 fast path（`bug / 修复 / 重构 / refactor / 新功能` 等）。
2. **LLM fallback**：规则不命中时调 `preferredBackend`（项目配置的 agentBackend）做意图理解，输出 `{action, runType, routeCase, confidence, questions[]}`。

输出 `CoordinatorDecision` 持久化到 `coordinator_decisions` 表 + 关联 `workflow_request_id`，每条 question post 到聊天线程并触发 `awaiting_clarification`。

## 2. Local Runner 与 Worktree 执行环境

### 2.1 ExecutionEnvironment 接口

```ts
interface ExecutionEnvironment {
  prepare(run: WorkflowRun): Promise<WorkspaceRef>
  runCommand(spec: CommandSpec): Promise<CommandRun>
  collectArtifacts(run: WorkflowRun): Promise<ArtifactRef[]>
  cleanup(workspace: WorkspaceRef): Promise<void>
}
```

MVP 实现：`TrustedLocalWorktreeEnvironment`。未来扩展点保留：`LocalDockerSandboxEnvironment / CloudKubernetesEnvironment / MicroVMEnvironment`，但当前主线明确不追求沙箱级强制。

### 2.2 Worktree 布局

```text
~/.ai-native/
  artifacts/{runId}/{stage}/<output.name>     # agent 落盘
  worktrees/{projectId}/{runId}/workspace/    # git worktree
  worktrees/{projectId}/{runId}/logs/         # CommandRun stdout/stderr
  reports/{runId}/<artId>.md|json             # Completion Report
  projects/{projectId}/profile.md             # ProjectProfile
  projects/{projectId}/knowledge/{runId}.md   # accepted knowledge
  db.sqlite                                   # 主存储
```

worktree 创建：从 `sourceBranch` clone 到独立工作区，再 checkout 到 `ai/{runId}-{slug}` 任务分支。结束时 `cleanup=true` 默认删除；调试时设 `--keep-worktree` 保留。

### 2.3 命令白名单

`packages/shared/src/utils/whitelist.ts` 限制 Runner 能 spawn 的命令：

```text
git status / git diff / git diff --name-only
./mvnw -B -DskipTests compile     /  mvn -B -DskipTests compile
./mvnw -B test                    /  mvn -B test
```

每条 CommandRun 强制带：`cwd / command / exitCode / startedAt / finishedAt / durationMs / stdoutRef / stderrRef / timedOut`。日志超 `DEFAULT_MAX_LOG_BYTES` 截断；超时 `DEFAULT_TIMEOUT_MS` 强杀进程树。

## 3. 持久化与产物管理

### 3.1 SQLite 主存储

- `apps/api/src/store/db.ts` 管理迁移；`store.ts` 是 repository 模式。
- 所有 entity 通过 `set()` / `insert()` / `updateXxx()` 写入；事务用 `db.transaction(...)`（如 promote draft → knowledge）。
- 索引访问器：`byWorkflow / byProject / byKind / latestForGate / byBuild`。

### 3.2 双写策略（V2 § 3.1，部分落地）

V1：仅落盘 + 写 DB index（DB 是真相源）。
V2 目标：**文件是真相源，DB 是关系镜像**。已落地的部分：

- `requirement.md` / `design.md` 既写 `~/.ai-native/artifacts/{runId}/{stage}/...` 又 `postArtifact` 写 DB；UI 可点击穿透到文件原文。
- KnowledgeArtifact 在 promote 时同时写 `knowledge_artifacts` 表 + 项目 knowledge 目录。
- `derivedFromArtifactId` 串起 per-run draft → 项目级实体的因果链。

仍未落地的双写目标：把 `~/.ai-native/projects/{projectId}/` 提升为 git-tracked 仓库目录、frontmatter 强约束自动校验、UI 编辑后回写 git。

### 3.3 产物级别

| 类型 | 表 | scope | 生命周期 |
|---|---|---|---|
| Per-run Artifact | `artifacts` | workflow_run_id NOT NULL | 一次性证据 |
| KnowledgeArtifact | `knowledge_artifacts` | project_id | 长期 / 版本化 |
| AuditLog | `audit_log` | workflow_run_id 可空 | 永久 |
| AgentEvent | `agent_events` | workflow_run_id + sequence | 永久流式记录 |
| RequestMessage | `request_messages` | workflow_request_id | 聊天上下文 |

### 3.4 Knowledge 反馈环路

```text
acceptance approve
  → promoteAcceptedDraftToKnowledge(REQ-### / DSN-###)   [server-side, transactional]
knowledge_gate approve
  → persistKnowledgeCandidate (curated by user actions)
  → ~/.ai-native/projects/{projectId}/knowledge/{runId}.md
next run's context_pack
  → collectAcceptedKnowledge
  → inputs['accepted_knowledge.md']
  → 喂给 skill.context_pack 的 prompt
```

这一环路是「让交付让知识库跑前一步」的核心链路。

## 4. SSE 与实时事件流

`agent_stream_bus.ts` + `agent-stream-bus.ts` 提供单进程 in-memory pub/sub：

- Runner 上报每条 stream 事件 → `recordAgentEvent()` 持久化（含 monotone sequence）+ 发布到 bus。
- Web 通过 `GET /workflow-runs/:id/events/stream`（SSE）订阅；前端实时渲染 Agent 思考、tool_use、tool_result、partial assistant message。
- 离线时可用 `GET /workflow-runs/:id/events?afterSeq=N` 拉取历史。

延迟约束：**console + UI 同等延迟**——Runner 必须 stream-json 行级解析，禁止 buffer。这是用户体验的硬约束（项目记忆中的明确指令）。

## 5. API 接口分类

| 类型 | 路径 | 用途 |
|---|---|---|
| 健康/概览 | `GET /health` | 各 entity 计数 |
| 项目 | `POST/GET /projects[/:idOrName]` | 注册/查询 |
| 任务请求 | `POST/GET /workflow-requests`, `:id/{claim,complete}`, 聊天 `:id/messages` | UI → Runner watch 队列 |
| Workflow Run | `POST/GET /workflow-runs[/:id]` | 创建（含路由）/详情（runs+steps+gates+commands+artifacts+builds+tests+approvals+audit+actions） |
| 报告 | `POST /workflow-runs/:id/{completion-report,knowledge-candidate}` | 生成 |
| 审批 | `POST/GET /approvals` | 人工 Gate 决策 |
| Runner | `POST /runner/events/{workspace-prepared,step-started,step-finished,command-run,stage-transition,await-human,workflow-completed,heartbeat,maven-build,artifact,run-gate}` | 心跳 / 事件入口 |
| Runner Control | `GET/POST /runner/control/{status,start,stop}` | API-managed Runner 启停 |
| Runners | `GET /runners` | 心跳与版本 |
| 产物钻取 | `GET /artifacts/:id/content`, `/artifacts/workflow-runs/:id/:kind/latest/content`, `/command-runs/:id/logs` | UI Evidence 钻取 |
| 知识 | `POST /knowledge-artifacts/promote`, `GET /knowledge-artifacts` | 升级 + 查询 |
| 路由 | `POST /router/recommend` | dry-run 预览 |
| 配置 | `GET/PUT /config/:key` | runtime override |
| SSE | `GET /workflow-runs/:id/events/stream` | 实时事件流 |

设计原则：**所有写入只有 `/runner/events/*` + `/approvals` + `/promote` + `/config` 四类入口**，任何状态变更都能在 audit 中找到来源。

## 6. 安全、可观测性与边界

### 6.1 安全

MVP 是「**可信本地模式**」：用户接入的是自己的本地仓库，跑的是自己的 Maven，访问的是自己的 secret。

约束：

- 命令白名单：禁止任意 shell 命令；但白名单内的 mvn 仍能读 `~/.m2`、能联网下依赖，不做 egress 拦截。
- Worktree 不隔离网络 / secret / 资源；改 sensitive 路径（`pom.xml / .gitignore / security / secrets / .env`）触发 warn → 强制人工 gate。
- API key、`AINP_CLAUDE_BIN` 等通过环境变量；不在 DB / 日志中留存（`packages/shared/src/utils/redaction.ts` 兜底脱敏）。
- CLI preflight 失败时直接给安装/登录修复提示，不静默降级。

不在 MVP 范围：Docker/K8s/microVM 沙箱、Tool Policy 强制、多租户隔离、零信任网络。

### 6.2 可观测性

- 所有 Workflow Engine 写入产 `AuditLog` 行：`audit(workflowRunId, kind, payload)`。
- 关键 emit：`workflow_run.created / stage_transition / step.started/finished / command.recorded / gate.recorded / approval.recorded / artifact.created / agent_task.recorded / agent_result.recorded / maven_build.recorded`。
- Runner 心跳含 jdk / maven / git 版本，便于排查环境差异。
- SSE 实时输出 + 持久化 stream events 双轨。
- Completion Report 既是面向人的交付说明，也是面向审计的事实清单。

### 6.3 失败模式 cheat-sheet

| 失败 | 现象 | 处理 |
|---|---|---|
| CLI 未装 | preflight 抛错 | Web 提示安装命令 |
| 编译失败 | `compile_gate=fail` | 终止 run，`ok=false`；用户改代码后重提 WorkflowRequest |
| 测试失败 | `test_gate=fail` | 同上 |
| diff 越界 | `diff_scope_gate=fail` | 终止 run；提示用户回退或调 `allowedPrefixes` |
| 敏感路径 | `sensitive_change_gate=warn` | 转人工 gate；用户 reject 则失败 |
| 验收 reject | 用户在 review 阶段拒绝 | run 标记 failed；不 promote 草稿 |
| 知识 reject | 用户 reject knowledge | run 标记 failed，但流程已完成（V1 quirk，不抛错） |
| Approval 超时 | `AINP_APPROVAL_TIMEOUT_MS` 命中 | 抛错并终止 |

## 7. V2 已落地 vs 待办

### 7.1 已落地

- ✅ 4 条 Flow（feature.standard / feature.fastforward / issue.standard / refactor.standard）
- ✅ FLOW_REGISTRY 跨层共享（shared/flows/registry.ts）
- ✅ Smart Router 规则 V1（按 runType + 标题 + 知识库匹配）
- ✅ KnowledgeArtifactKind 10 类 + entityId 编号 + 版本/状态机
- ✅ Acceptance 自动 promote `requirement_draft` → REQ / `design_doc` → DSN
- ✅ stage-history-aware acceptance_gate（NA 规则覆盖 fastforward / issue / refactor）
- ✅ Coordinator 二段式分诊（rules + LLM 兜底）
- ✅ 实时 stream-json 事件流（console + UI 同延迟）
- ✅ runtime config 在线编辑 instructions（PR1-PR3）
- ✅ Web 启停本地 Runner（`/runner/control/start`）

### 7.2 V2 待办（按 ROI 排）

| 改动 | 体现 V2 哲学 | 难度 |
|---|---|---|
| 双写真正落地（仓库目录 git-tracked） | 架构主轴 1 | 中 |
| 长会话 + checkpoint 替代每 stage spawn | 性能 / 可靠 | 大（最大风险） |
| 语义 verifier 扩 gate（traceability / freshness） | 强约束硬于软建议 | 持续 |
| acceptance 回写提案（Architecture / Lesson 自动写入） | 闭环回写 | 中 |
| inputs 截断 / 摘要策略 | token 成本 | 小 |
| 编号穿透浏览（点 AC 跳设计 / 测试 / commit） | 编号是契约 | 中 |
| 知识失效高亮 + 多视图切换 | 产品化 | 中 |
| LLM fallback Smart Router | 路由智能 | 中 |
| Stage retry / 从 checkpoint 恢复 | 可靠性 | 中 |
| frontmatter 强约束自动校验 | 强约束 | 小 |

### 7.3 不在 V2 范围

- Docker/K8s/microVM 沙箱级强制
- Tool Policy 运行时拦截
- 多租户隔离与 RBAC
- IDE 插件（VS Code / JetBrains）
- 深度 PR/CI 集成
- 多语言（Python / Node / Go / Rust）—— 当前仅 Java + Maven

但相关接口（`ExecutionEnvironment` / `AgentBackend` / `SkillSpec` / `BuildRunner`）都已抽象，未来扩展不需推翻骨架。

## 8. 设计原则速查（可贴墙）

1. **Workflow Engine 唯一状态写者**——其他模块只能读或发事件。
2. **Agent 不能宣布 Gate 通过**——agentNote 仅作展示。
3. **Build/Test 必须真实**——CommandRun + Surefire 是唯一证据。
4. **Skill 属于平台，Backend 只是载体**——Claude Code / Codex / Native 互换不影响契约。
5. **每次交付有 Completion Report**——引用每条 Artifact / Gate / CommandRun。
6. **经验先 Knowledge Candidate，再人工入库**——Decision 类必须人确认。
7. **配置 UI 化、版本化、运行时可追溯**——runtime_config + audit。
8. **可信本地，不追求沙箱**——MVP 边界明确；Docker/K8s 是未来扩展点。
9. **流程多态 + 智能路由**——按工作类型选 flow，按现状选 startStage。
10. **编号串因果链**——REQ-### / DSN-### / AC-### / ADR-### / LSN-### 是机器可追溯契约。
