# Agent Runtime 与 Harness 架构设计

> 日期：2026-06-27  
> 来源：由 `2026-06-27-agent-orchestration-and-harness-improvement-plan.md` 拆分。  
> 性质：架构设计，描述目标模块、数据流、边界和迁移策略。

## 1. 设计结论

目标架构不是重写平台，而是在当前边界上增加 Agent runtime 层：

```text
Workflow Engine
  -> Step Runtime / Checkpoint
  -> Agent Session / Trajectory
  -> Context Orchestrator
  -> AgentBackend
  -> Tool Registry / Tool Invocation
  -> Gate / Evidence / Report
```

现有不变量保持不变：

- API Workflow Engine 仍是唯一状态写者。
- Gate Engine 仍是唯一 pass / warn / fail 判定者。
- Runner 仍只通过 API 上报事件。
- AgentBackend 仍只执行受控 step。
- Knowledge accepted 状态仍需人工或明确 promotion action。

## 2. 当前架构锚点

- Flow：`packages/shared/src/flows/registry.ts`
- Runner orchestration：`apps/runner/src/orchestrator.ts`
- Step implementation：`apps/runner/src/orchestrator/steps.ts`
- Agent invocation：`apps/runner/src/orchestrator/invoke-skill.ts`
- Context：`apps/runner/src/context/*`
- Agent backend contract：`apps/runner/src/agents/types.ts`
- SkillSpec：`packages/shared/src/types/skill.ts`
- Gate：`apps/api/src/gate-engine.ts`
- Eval：`scripts/eval-harness.ts`

架构升级应优先围绕这些已有接口加薄层，不引入平行控制面。

## 3. 目标组件

### 3.1 Step Runtime

职责：

- 把 `StageStep` 解析成可执行 `StepDefinition`。
- 为每次 step 生成 `StepCheckpoint`。
- 记录 retry index、resume cursor、失败原因和关联 session/tool/gate。
- 先兼容现有顺序执行，后续再支持 branch / join。

建议先做 read/write metadata，不马上替换 `dispatchStep()`。

### 3.2 Agent Session

职责：

- 表示一次 backend invocation。
- 绑定 AgentTask / AgentResult。
- 绑定 ContextPack、skill version、backend policy snapshot。
- 承载 tool invocation、handoff、guardrail、context retry 的关联。

推荐字段：

```text
id
workflowRunId
stepRunId
agentTaskId
agentResultId
backend
stage
skillId
skillVersion
contextPackId
parentSessionId
retryIndex
status
startedAt
completedAt
metadata
```

### 3.3 Tool Registry

职责：

- 定义平台可审计工具。
- 记录每次工具调用。
- 将权限、输入、输出、证据和 digest 串起来。

MVP 工具：

| Tool | 来源 | side effect | 说明 |
|---|---|---|---|
| `runner.command_run` | Runner | command | 封装 whitelisted command |
| `runner.git_diff_capture` | Runner | read-only | 捕获 diff 和 changed files |
| `api.artifact_read` | API | read-only | 读取 artifact 内容并验证 digest |
| `runner.context_supplement` | Runner | read-only | 生成 supplement ContextPack |

ToolInvocation 不能代替 CommandRun / Artifact，而是索引它们。

### 3.4 Context Orchestrator

职责：

- 统一 context plan、source resolver、ContextPack builder、context_request retry。
- 保留当前 builder/retriever/renderer。
- 给 same-step retry 生成 supplement pack 和 retry session。

流程：

```text
build base ContextPack
  -> invoke agent
  -> parse context_request
  -> build supplement ContextPack
  -> retry same skill within limit
  -> finish or blocked
```

### 3.5 Memory Lifecycle

职责：

- 在 KnowledgeArtifact 之上定义 memory taxonomy 和 metadata contract。
- 将 selected usage、retro finding、context conflict 转成 review signal。
- 用 normalizer 提供一致读取，不急着大表拆分。

Memory 类型：

- `semantic`
- `episodic`
- `procedural`

状态：

- `candidate`
- `draft`
- `accepted`
- `stale`
- `superseded`
- `rejected`
- `needs_review`

### 3.6 Handoff Runtime

职责：

- 记录 bounded multi-agent handoff。
- 限制子任务 scope。
- 把子任务结果返回主 workflow。

Handoff 不拥有状态迁移权。采用与否由 coordinator/gate/human 决定。

### 3.7 Eval Runtime

职责：

- 扩展 scenario schema。
- 支持 fake backend。
- 支持 workflow fixture replay。
- 输出 JSON/HTML，并可作为 CI gate。

新 scenario kind：

- `context_pack_fixture`
- `agent_backend_fixture`
- `workflow_fixture`

## 4. 数据流

### 4.1 正常 Agent Step

```text
StepRuntime creates checkpoint
  -> invokeSkill creates AgentSession
  -> ContextOrchestrator builds ContextPack
  -> AgentBackend runs skill
  -> outputs become artifacts
  -> ToolInvocation / Context / Knowledge usage linked
  -> Gate consumes evidence
```

### 4.2 Context Retry

```text
Agent output includes context_request
  -> runner parses and sanitizes request
  -> context_supplement artifact recorded
  -> new AgentSession(parentSessionId=base)
  -> same skill retries with supplement
  -> retry result linked to same StepCheckpoint
```

### 4.3 Handoff

```text
Main session requests handoff
  -> Handoff record created
  -> child AgentSession runs bounded task
  -> child output artifact recorded
  -> main workflow adopts/rejects through gate/coordinator/human
```

### 4.4 Eval Replay

```text
Eval scenario fixture
  -> fake store/backend/tool results
  -> run target subsystem
  -> compare outputs to expectations
  -> write JSON/HTML report
```

## 5. API 边界

建议新增只读 route：

- `GET /workflow-runs/:id/agent-sessions`
- `GET /agent-sessions/:id/trajectory`
- `GET /workflow-runs/:id/tool-invocations`
- `GET /workflow-runs/:id/handoffs`

写入仍通过 Runner event ingress 或 Workflow Engine 封装函数完成，避免 route 直接改复杂状态。

## 6. Shared Types

建议新增类型文件：

- `packages/shared/src/types/agent-session.ts`
- `packages/shared/src/types/tool-invocation.ts`
- `packages/shared/src/types/memory.ts`
- `packages/shared/src/types/handoff.ts`
- `packages/shared/src/types/step-checkpoint.ts`

也可以先放在现有 `agent.ts` / `command.ts` / `knowledge-entity.ts` 中，但需要避免文件过大。

## 7. 数据库策略

推荐小步迁移：

1. 新增 nullable / additive 表，不改旧表语义。
2. AgentSession 先引用 AgentTask / AgentResult。
3. ToolInvocation 先引用 CommandRun / Artifact。
4. Handoff 初期只作为 audit/read model。
5. Memory lifecycle 先通过 KnowledgeArtifact metadata normalizer 落地。

这样历史 rows 能正常加载，旧 run 不需要 backfill。

## 8. Web 展示

优先挂到任务详情页的诊断折叠区：

- Agent Sessions
- Context Retry
- Tool Invocations
- Handoffs
- Memory Used
- Eval / Regression Evidence

不要把这些变成主操作流。默认折叠，用于排查和评审。

## 9. 迁移顺序

1. Shared type draft + API store additive tables。
2. Runner `invokeSkill()` 写 AgentSession。
3. Command/diff/context supplement 写 ToolInvocation。
4. Context same-step retry 使用 parentSessionId。
5. Eval harness 加 fake backend fixture。
6. Web/API 读模型聚合。

## 10. 风险控制

- 保持现有 `AgentTask` / `AgentResult` 不破坏。
- 保持现有 `ContextPack` renderer 不 fork。
- 不让 ToolInvocation 决定 gate status。
- 不让 Handoff 决定 workflow transition。
- 不让 Memory 自动 accepted。
- Eval fixture 优先 deterministic。

## 11. 开放问题

- AgentSession 是独立表，还是 AgentTask 的扩展表？建议独立表，减少旧语义膨胀。
- StepCheckpoint 是否需要第一阶段落 DB？建议先落 metadata/read model，再决定完整 graph runtime。
- ToolInvocation 是否覆盖 backend 原生 tool call？建议第二阶段再做，MVP 只管 Runner-owned tools。
- Memory 是否拆表？建议先 metadata normalizer，等 usage 数据稳定后再拆。
