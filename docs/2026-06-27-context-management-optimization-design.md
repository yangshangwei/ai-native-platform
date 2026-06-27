# 交付工作台上下文管理优化方案设计

> 日期：2026-06-27  
> 性质：方案设计文档  
> 对应需求：`docs/2026-06-27-context-management-optimization-requirements.md`

## 1. 设计原则

1. 保留现有 `ContextPack` 架构，只增强持久化、交接和治理能力。
2. artifact 是事实源，handoff 是语义交接层，prompt 是消费结果。
3. 每次 agent invocation 都应有可追溯的 context snapshot。
4. 阶段之间不只传文件内容，还要传关键结论、风险、未决问题和注入建议。
5. prompt 注入由策略控制，不默认全文拼接所有输入。
6. 新能力优先旁路接入，降低对现有 workflow 的影响。

## 2. 当前链路

```text
WorkflowRequest
  -> WorkflowRun
  -> runStage()
  -> invokeSkill()
  -> build ContextPack
  -> persist base ContextPack artifact
  -> render prompt
  -> invoke agent / skill
  -> persist output artifact
  -> merge output into RunCtx.inputs
  -> next stage
```

当前链路的关键点：

- `ContextPack` 是每次 invocation 新建。
- 新 invocation 的 base `ContextPack` 会在 backend 调用前保存为 `context_pack` JSON artifact。
- stage output 会进入 artifact 和 `RunCtx.inputs`。
- 后续 stage 通过 input artifact 和 fresh `ContextPack` 消费上游结果。
- `context_request` 已支持一次 supplement retry。

当前不足：

- 历史 run 的 base `ContextPack` 可能仍只能从 prompt audit 恢复摘要。
- 阶段 handoff 不是一等对象。
- checkpoint 不足以支撑精确恢复。
- renderer 缺少输入级注入策略。

## 3. 目标链路

```text
WorkflowRequest
  -> WorkflowRun
  -> Stage Start Checkpoint
  -> build ContextPack
  -> persist ContextPack Artifact
  -> render prompt by InjectionPolicy
  -> invoke agent / skill
  -> capture context_request if any
  -> retry once with supplement ContextPack if needed
  -> persist output artifacts
  -> create StageHandoff
  -> Stage Finish Checkpoint
  -> next stage consumes handoff + artifact refs
```

## 4. 架构分层

### 4.1 Orchestrator 层

主要文件：

- `apps/runner/src/orchestrator/invoke-skill.ts`
- `apps/runner/src/orchestrator/steps.ts`
- `apps/runner/src/orchestrator/types.ts`

职责：

- 生成 `invocationId`。
- 保存 base 和 supplement context pack artifact。
- 保存 stage start / finish checkpoint。
- 保存 stage handoff。
- 在恢复时重建 `RunCtx`。

### 4.2 Context 层

主要文件：

- `apps/runner/src/context/builder.ts`
- `apps/runner/src/context/renderer.ts`

职责：

- 构建候选上下文。
- 记录选择、降级、丢弃结果。
- 根据输入注入策略渲染 prompt。
- 生成 prompt audit 数据。

### 4.3 Skill Contract 层

主要文件：

- `apps/runner/src/skills/index.ts`

职责：

- 声明 skill 输入。
- 声明输入注入偏好。
- 声明输出 artifact key。
- 声明下游 handoff 推荐。

### 4.4 API / Web 治理层

职责：

- API 聚合 context pack、handoff、checkpoint 和 agent session 记录。
- Web 展示上下文审计报告。
- Completion report 引用上下文治理数据。

## 5. 数据模型设计

### 5.1 ContextInvocationSnapshot

```ts
type ContextInvocationSnapshot = {
  invocationId: string
  workflowRunId: string
  stepRunId: string | null
  stage: WorkflowStage
  skillId: string
  skillVersion: string
  contextPackId: string
  contextPackArtifactId: string | null
  contextPackRole: 'base' | 'supplement'
  retryIndex: number
  parentInvocationId?: string | null
  contextRequestId?: string | null
  baseContextPackId?: string | null
  createdAt: string
}
```

用途：

- 把一次 agent 调用和对应 context artifact 绑定。
- 支持审计、回放、失败排查。
- 支持 same-step retry 链路展示。

### 5.2 StageContextCheckpoint

```ts
type StageContextCheckpoint = {
  runId: string
  stageId: string
  phase: 'start' | 'finish'
  inputs: Record<string, string>
  inputArtifactIds: Record<string, string>
  producedArtifactIds: Record<string, string>
  contextPackArtifactIds: string[]
  handoffArtifactIds: string[]
  createdAt: string
}
```

用途：

- 阶段级恢复。
- 阶段输入输出审计。
- 定位某个 artifact 从哪一步开始进入上下文。

### 5.3 StageHandoff

```ts
type StageHandoff = {
  runId: string
  fromStage: string
  toStage?: string
  summary: string
  decisions: string[]
  risks: string[]
  openQuestions: string[]
  producedArtifacts: Array<{
    key: string
    artifactId: string
    kind: 'requirement' | 'design' | 'plan' | 'test' | 'code' | 'other'
    injectionPreference: 'full' | 'summary' | 'reference'
  }>
  createdAt: string
}
```

用途：

- 让下游阶段知道“应该看什么”和“为什么看”。
- 避免下游只拿到一堆文件，却不知道优先级。
- 让 UI 可以展示阶段交接摘要。

### 5.4 SkillInputInjectionPolicy

```ts
type SkillInputInjectionPolicy = {
  artifactKey: string
  mode: 'full' | 'summary' | 'reference' | 'omit'
  maxTokens?: number
  required?: boolean
}
```

推荐默认策略：

| 输入类型 | 默认模式 | 说明 |
| --- | --- | --- |
| `user_request` | `full` | 用户原始任务必须完整保留。 |
| `requirement.md` | `summary` + `reference` | 架构设计通常需要关键约束，不一定需要全文。 |
| `design.md` | `summary` + `reference` | 实现阶段需要决策和接口，不一定需要完整设计叙事。 |
| `test-spec.md` | `summary` | 实现阶段重点消费验收点。 |
| 大型日志/报告 | `reference` | 默认不给全文，避免 prompt 噪音。 |

## 6. 核心流程设计

### 6.1 需求分析到架构设计

```text
requirement stage
  -> output requirement.md artifact
  -> create StageHandoff
     - summary
     - decisions
     - risks
     - openQuestions
     - artifact reference
     - injectionPreference
  -> design stage
     - read upstream handoff
     - apply injection policy
     - inject requirement summary + constraints + artifact reference
```

架构设计 agent 最终看到的是：

```text
## Upstream Requirement Summary
...

## Confirmed Constraints
- ...

## Open Questions
- ...

## Requirement Artifact Reference
artifact://requirement.md/<artifactId>
```

### 6.2 ContextPack 持久化

每次 `invokeSkill()` 构建 base `ContextPack` 后：

1. 生成 `invocationId`。
2. 写入 `kind='context_pack'`、`metadata.contextPackRole='base'` 的 JSON artifact。
3. 把 artifact id 记录到 agent session metadata。
4. 把 context selection audit 写入 metadata。

如果触发 `context_request`：

1. 捕获 request。
2. 构建 supplement `ContextPack`。
3. 写入 request artifact 和 `kind='context_pack'`、`metadata.contextPackRole='supplement'` 的 supplement artifact。
4. 用 supplement pack retry 同一个 skill 一次。
5. 将 retry 关系写入 invocation snapshot、AgentSession metadata 和 context governance read model。

### 6.3 Stage checkpoint

阶段开始：

```text
write checkpoint phase=start
```

阶段结束：

```text
write checkpoint phase=finish
```

恢复时：

```text
load latest checkpoint
  -> restore inputs
  -> restore inputArtifactIds
  -> reload required artifact bodies if needed
  -> continue from next runnable stage
```

### 6.4 Prompt 注入

renderer 的输入处理从“遍历并拼接 inputs”调整为：

```text
for each input artifact:
  resolve policy
  if full:
    inject full body
  if summary:
    inject summary and source reference
  if reference:
    inject artifact reference only
  if omit:
    skip, but keep audit record
```

budget 不足时降级：

```text
full -> summary -> reference -> omit
```

required 输入不能静默 omit。若预算不足，至少保留 artifact reference 和警告。

## 7. 兼容策略

1. 保留现有 `RunCtx.inputs` 行为。
2. 新增 context pack artifact、checkpoint 和 handoff 先作为旁路记录；P1 已落地 base/supplement context pack artifact。
3. 老 skill 没有声明注入策略时使用默认策略。
4. 初期仅对大文档和明确配置的关键 artifact 应用降级。
5. 恢复逻辑先提供内部函数和测试，再切换真实 resume 流程。

## 8. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| artifact 数量增加 | 存储增长 | context artifact 设置保留策略和压缩策略。 |
| 注入策略过度降级 | agent 缺少关键事实 | required 输入至少保留 reference，并在 audit 中标红。 |
| handoff 摘要质量不稳定 | 下游误解上游结论 | handoff 不替代原 artifact，只作为导航层。 |
| checkpoint 体积过大 | 写入和读取成本上升 | 大内容存 artifact，checkpoint 保存引用和 hash。 |
| 审计 UI 噪音 | 用户难以理解 | 默认展示摘要，支持展开详情。 |

## 9. 二期扩展

二期在一期链路稳定后推进：

1. FTS/BM25 文档索引。
2. 代码符号索引。
3. 可选 embedding 检索。
4. hybrid ranking。
5. MCP resource gateway。
6. prompt caching 分层优化。

## 10. 推荐落地顺序

1. 校准现有架构说明和测试事实。
2. 持久化 base/supplement context pack。
3. 增加 stage checkpoint。
4. 增加输入注入策略。
5. 增加 stage handoff。
6. 增加审计报告。
7. 引入检索增强。
