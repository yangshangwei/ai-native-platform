# AI Native Platform 技术方案：核心架构

> 日期：2026-05-06
> 性质：**技术方案沉淀（核心架构篇）**，面向新人读源码 + 评审架构。
> 范围：总体架构、模块拆解、数据模型、Workflow Engine、Gate Engine、Smart Router。
> 配套：业务流程 `2026-05-06-end-to-end-business-flow.md`；执行篇 `2026-05-06-technical-architecture-execution.md`。

## 1. 总体架构

```text
┌──────────────────── Browser ────────────────────┐
│  apps/web (Vite-less TS, :5173)                 │
│   ├─ 项目接入 / Runner 启停                      │
│   ├─ 任务队列 / 聊天澄清                         │
│   ├─ 阶段板 / Evidence 钻取                      │
│   ├─ 人工检查点（5 个 Gate）                     │
│   └─ 报告 / 知识库 / 设置                        │
└────────────────┬────────────────────────────────┘
                 │ HTTP /api/* (proxy)
                 ▼
┌──────────────── apps/api (Hono on Bun, :8787) ──┐
│  Workflow Engine (sole state writer)            │
│  Gate Engine (rule + manual)                    │
│  Smart Router (pure function)                   │
│  Reports / Knowledge Promote                    │
│  Agent Stream Bus (SSE)                         │
│  Runner Control supervisor                      │
│  SQLite store (~/.ai-native/db.sqlite)          │
└────────────────┬────────────────────────────────┘
                 │ HTTP events ingress + heartbeats
                 ▼
┌──────────────── apps/runner (CLI watch) ────────┐
│  Heartbeat / Preflight                          │
│  Coordinator Agent (triage)                     │
│  Orchestrator (per-Flow stage dispatch)         │
│  TrustedLocalWorktreeEnvironment                │
│  AgentBackend Adapter (claude_code / codex)     │
│  CommandRunner (whitelist + timeout)            │
│  Surefire/Failsafe parser                       │
│  Knowledge Persist                              │
└────────────────┬────────────────────────────────┘
                 │ spawn
                 ▼
┌──── 用户本机 ───────────────────────────────────┐
│  Git worktree | mvn / mvnw | JDK | claude / codex CLI │
└─────────────────────────────────────────────────┘
```

四个进程边界：**Browser ↔ API ↔ Runner ↔ 本地 CLI**。Web 不直接访问文件系统；Runner 不直接写库（只发事件）。

## 2. 模块拆解

| 模块 | 路径 | 职责 |
|---|---|---|
| Workflow Engine | `apps/api/src/workflow-engine.ts` | **唯一状态写者**：WorkflowRun / StepRun / Artifact / GateRun / Approval / AuditLog / AgentTask / AgentResult / AgentEvent |
| Gate Engine | `apps/api/src/gate-engine.ts` | Compile / Test / Requirement / Design / DiffScope / Sensitive / Acceptance / Manual gate 规则 |
| Smart Router | `apps/api/src/router.ts` | 纯函数 `recommend(input)` → flowId + startStage + relevantKnowledge + estimates |
| Reports | `apps/api/src/reports.ts` | Completion Report + Knowledge Candidate（markdown + JSON sidecar） |
| Promote | `apps/api/src/promote.ts` | Draft → KnowledgeArtifact 升级（事务：bump version + supersede prior） |
| Routes | `apps/api/src/routes/*.ts` | REST endpoints + SSE |
| Store | `apps/api/src/store/{db,store}.ts` | SQLite migrations + repository pattern |
| Orchestrator | `apps/runner/src/orchestrator.ts` | 按 FLOW_REGISTRY 串 stage；调用 backend；上报事件 |
| Skills | `apps/runner/src/skills/index.ts` | Canonical SkillSpec（含可被 Web 在线编辑的 instructions 覆盖） |
| Coordinator | `apps/runner/src/agents/coordinator/*.ts` | 用户意图分诊（rules + LLM 双层） |
| Agents | `apps/runner/src/agents/{claude-code,codex,native}.ts` | AgentBackend 适配层 + stream-json 解析 |
| Worktree | `apps/runner/src/worktree.ts` | TrustedLocalWorktreeEnvironment 实现 |
| CommandRunner | `apps/runner/src/command-runner.ts` | 白名单 + 超时 + 日志截断 + 进程树清理 |
| Surefire | `packages/shared/src/utils/surefire.ts` | XML 解析（per-suite 聚合） |
| FlowRegistry | `packages/shared/src/flows/registry.ts` | 4 条 Flow 的 stage 列表 + dispatch 元数据 |
| Shared Types | `packages/shared/src/types/*.ts` | 跨进程类型契约 |

## 3. 数据模型

```text
Project (1) ──< WorkflowRequest (claimed by Runner)
Project (1) ──< WorkflowRun (1) ──< StepRun ──< CommandRun
                                ├──< Artifact (per-run)
                                ├──< GateRun ──< RuleResult
                                ├──< BuildRun ──< TestRun
                                ├──< Approval
                                ├──< AgentTask ──< AgentResult
                                ├──< AgentEvent (stream)
                                └──< WorkflowAction (knowledge_suggestion / acceptance_decision)
Project (1) ──< KnowledgeArtifact (entity-versioned: draft|accepted|superseded)
WorkflowRun (1) ──< AuditLog
RequestMessage (chat thread on WorkflowRequest)
```

### 3.1 关键不变量

- 所有产出都是 `Artifact`；`evidenceRefs` 必填。
- 每个 GateRun = `{status: pass|warn|fail, ruleResults[], evidenceRefs[]}`，status = worst(fail > warn > pass)。
- KnowledgeArtifact 的 `entityId`（REQ-### / DSN-### / ADR-### / LSN-###）在应用层维持唯一性；P0-2 升级为 DB 约束。
- 每次 promote 把同 `entityId` 的 prior accepted 标记 `superseded`，新版本 `version+1`。

### 3.2 ArtifactKind 二族

**PerRunArtifactKind**（12，run-scoped、一次性）：

```text
project_profile / context_pack / requirement_draft / design_doc /
traceability / diff / command_log / surefire_report / failsafe_report /
completion_report / knowledge_candidate / other
```

**KnowledgeArtifactKind**（10，project-scoped、版本化）：

```text
requirement / design / architecture / roadmap / decision /
lesson / pattern / explore / dev_guide / api_doc
```

每条 KnowledgeArtifact 含强类型 core 字段：`status / version / entityId / derivedFromArtifactId / subtype`，自由扩展通过 `metadata` 走。`KNOWLEDGE_SUBTYPES` 表约束每类允许的 subtype（如 `lesson` ∈ `pitfall / knowledge`）。

### 3.3 WorkflowStage 枚举

```text
init | context_pack | requirement | design | implementation | build_test |
review | completion | knowledge |
report | analyze |    // V2 issue.standard
scan  | plan          // V2 refactor.standard
```

`init` 是状态占位（run 创建后第一次 transitionStage 之前），不被 dispatch；review 阶段折叠了 acceptance 人工 gate。

## 4. Workflow Engine 设计

`apps/api/src/workflow-engine.ts` 是**唯一状态写者**，所有 mutation 都走它：

| 函数 | 职责 |
|---|---|
| `createWorkflowRun()` | 缺省 flowId 时调 `recommend()` 自动选；持久化 routerRecommendation 到 audit |
| `transitionStage(toStage, toStatus)` | 单点状态切换；触发 `audit('workflow_run.stage_transition')` |
| `awaitHuman(stage)` | 状态切 `awaiting_human`；Runner 端配合 `awaitApproval` 轮询 |
| `startStep / finishStep` | StepRun 生命周期；每条变更入 audit |
| `recordCommandRun` | 吞吐 Runner 上报命令；写 `commands` 表 |
| `recordMavenBuild` | 写 BuildRun + TestRun + 报告 Artifact，并自动触发 `runCompileGate` + `runTestGate` |
| `recordApproval` | 人工 Gate 决策；幂等（同 gate 同 decision 重放返回旧记录）；自动 `runManualGate` |
| `recordAgentTask / recordAgentResult` | LLM 调用与结果审计 |
| `recordAgentEvent` | 流式事件持久化 + 发布到 SSE Bus；保证单 run 内 sequence 单调 |
| `createArtifact` | per-run artifact |
| `createKnowledgeArtifact` / `setKnowledgeArtifactStatus` | project-level 版本化产物 |
| `recordWorkflowAction` | knowledge_suggestion_action / acceptance_decision，落到 `workflow_actions` |

**写入路径只有三处**：Runner 的 `/runner/events/*` 路由、Web 的 `/approvals` 路由、内部 promote 流程。Coordinator 与 Specialist Agent 没有任何状态写入路径。

写入操作均带 `audit(workflowRunId, kind, payload)`，便于事后回放与排错。

## 5. Gate Engine 设计

`apps/api/src/gate-engine.ts` 一组纯函数：每条规则产出 `RuleResult { ruleId, status, message, evidenceRefs[] }`，Gate 的 status = worst。

| Gate | 触发方 | 输入 | 关键规则 |
|---|---|---|---|
| `compile_gate` | `recordMavenBuild` 自动 | compile CommandRun | exit_zero / no_timeout |
| `test_gate` | `recordMavenBuild` 自动 | test CommandRun + Surefire aggregate | exit_zero / no_timeout / surefire_present / failures_zero / errors_zero / required_not_all_skipped |
| `requirement_gate` | Runner 显式 `runGate` | 最新 requirement_draft 文本 | draft_present / ids / acceptance / scope / context_evidence / pitch / four_sections / user_stories≥2 / boundary |
| `design_gate` | Runner 显式 | 最新 design_doc 文本 | doc_present / coverage / test_strategy / risks / context_grounding / dsn_id / 现状 / 变化 / 挂载点 3-5 / 推进策略 |
| `diff_scope_gate` | Runner 显式 | changedFiles + allowedPrefixes | within_allowed |
| `sensitive_change_gate` | Runner 显式 | changedFiles | no_high_risk_path（warn 触发人工） |
| `acceptance_gate` | Runner 显式（review 阶段） | requirement / design / diff / review / latest test_gate | requirement_present (NA-able) / design_present (NA-able) / diff_present / review_present / test_gate_passed |
| 任意 manual gate | `recordApproval` | actor 决策 | manual.human_decision |

### 5.1 stage-history-aware（V2 W2-2a）

`acceptance_gate` 在 issue.standard / refactor.standard / fastforward 中并不存在 requirement / design 步骤。Gate 引擎用 `store.stepRuns.byWorkflow` 检测当前 run 实际跑过哪些 stage：未跑过的 stage 不强制 artifact 存在，规则返回 `pass: not applicable`。

### 5.2 LLM 与 Gate 的关系

**Specialist Agent 永远不能影响 status**，但可以在生成的 markdown / JSON 里附 `agentNote` 字段，Gate 引擎记录到 GateRun.agentNote 仅作展示。Gate 失败时 Agent 的 review 段也仅作建议，不被自动回采纳。

## 6. Smart Router 设计

`apps/api/src/router.ts` 是纯函数 + DB 只读访问，规则按优先级短路：

```text
recommend(input) =
  flowId       = byRunType(input.runType) || byTitleLength/Keywords(input.title)
  startStage   = matchAcceptedDesign(projectId, title)    → 'implementation'
              || matchAcceptedRequirement(projectId, title) → 'design'
              || null
  knowledge    = top-5 by keyword overlap on entityId+metadata
  estimates    = sum(per-stage static: agent 90s/8K, engine 30s/0)
  reason       = rulesFired.join(' / ')
```

### 6.1 flowId 决策表

| runType | 触发条件 | 推荐 flowId |
|---|---|---|
| `bugfix` | — | `issue.standard` |
| `refactor` | — | `refactor.standard` |
| `smoke` | — | `feature.standard`（不快进） |
| `feature` | 标题 < 60 字 或 含 `typo / rename / 改个 / 小修 / 微调 / fix typo / simple / 一行 / one-line` | `feature.fastforward` |
| `feature` | 其他 | `feature.standard` |

### 6.2 startStage 决策（仅 feature.standard）

- 项目知识库已有 `accepted` 状态的 `design` 实体且 `entityId / metadata` 与标题关键词匹配 → 从 `implementation` 开始。
- 已有 `accepted` 的 `requirement` 实体匹配（且无 design）→ 从 `design` 开始。
- 否则 `null`（从 flow 第一个 stage 开始）。

关键词提取：小写 + 按 `\s\-_/.,;:!?(){}[]'"` 拆分 + 长度 ≥ 4 过滤。

### 6.3 调用点

1. `createWorkflowRun()` 在 `flowId` 缺省时自动调用（auto-pick）。
2. `POST /router/recommend` 暴露给 Web UI 做 dry-run 预览（用户在新建任务时看到推荐 + 估时）。
3. 用户始终可显式覆盖：API body 传 `flowId / startStage` 时强制采用，路由不参与（`recommend()` 不会被调用）。

### 6.4 V2 W3 待办

- LLM fallback：规则匹配不到时，喂入仓库摘要让 LLM 推荐。
- History-based learning：「同形状的请求历史用了 flow X」。
- Estimate calibration：从历史 run 校准 per-stage 估时常数。
- 配置化关键词：把 `SMALL_CHANGE_KEYWORDS` 提到 runtime config。

## 7. FLOW_REGISTRY（跨层共享）

`packages/shared/src/flows/registry.ts` 是 Single Source of Truth：

```ts
type FlowId = 'feature.standard' | 'feature.fastforward'
            | 'issue.standard' | 'refactor.standard'

interface FlowDef {
  id: FlowId
  kind: WorkflowRunType
  description: string
  stages: readonly StageStep[]
}

interface StageStep {
  stage: WorkflowStage
  kind: 'agent' | 'gate' | 'human' | 'engine'
  skillId?: string
}
```

`Readonly<Record<FlowId, FlowDef>>` 让 `tsc --noEmit` 强制：
1. 新增 FlowId 字面量必须同时在 registry 注册（exhaustiveness）；
2. 运行时禁止 mutate（Readonly）。

新加一条 Flow 的步骤（写在 registry.ts 注释里）：
1. 加 FlowId 字面量；
2. registry 加条目；
3. 若引入新 WorkflowStage 值，在 `dispatchStep` 加 case；
4. 在 `apps/api/src/routes/workflow-runs.ts` 与 `apps/runner/src/index.ts` 的 `KNOWN_FLOW_IDS` 信任边界列表加项；
5. `apps/runner/test/flow-registry.test.ts` 加 out-of-band 顺序断言；
6. 更新 `.trellis/spec/runner/backend/flow-registry.md`。

## 8. 关于本篇的范围

本篇覆盖「数据模型 + 状态写入 + 决策规则」三大静态契约。运行期细节——Skill / AgentBackend / Worktree / 持久化布局 / SSE / API 接口分类 / 安全 / V2 演进路径——见 `2026-05-06-technical-architecture-execution.md`。
