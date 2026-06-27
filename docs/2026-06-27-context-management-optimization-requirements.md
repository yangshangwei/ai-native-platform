# 交付工作台上下文管理优化需求文档

> 日期：2026-06-27  
> 性质：需求文档  
> 范围：交付工作台任务创建后，多阶段 agent 执行过程中的上下文传递、审计、恢复和注入治理。  
> 关联文档：`docs/2026-06-27-context-management-architecture.md`

## 1. 背景

当前交付工作台在用户创建任务并输入任务信息后，会创建 `WorkflowRequest`，Runner 领取后创建 `WorkflowRun`，再按工作流阶段调用不同 agent/skill。阶段产物会保存为 artifact，并累计进入运行上下文，后续阶段再通过新的 `ContextPack` 获取上下文。P1 之后，每次 agent invocation 的 base `ContextPack` 也会在 backend 调用前保存为 `context_pack` JSON artifact。

现有机制已经能完成基本传递。例如需求分析阶段产出的 `requirement.md` 会作为 artifact 保存，并进入后续阶段的输入集合，架构设计 agent 可以基于它继续工作。

但当前链路仍偏隐式：上游产物如何交给下游、每次 agent 实际看到了哪些上下文、哪些内容被全文注入、哪些内容被降级或丢弃、失败后如何恢复，都缺少清晰的一等记录。

## 2. 当前问题

1. 阶段之间主要依赖 `RunCtx.inputs` 和 `inputArtifactIds` 传递产物，缺少显式 stage handoff。
2. P1 之前，每次 agent invocation 的 base `ContextPack` 主要存在于 prompt audit，未稳定作为 artifact 持久化；本分支已开始把新 invocation 的 base pack artifact 化，历史 run 仍可能只能从 prompt audit 恢复摘要。
3. 阶段级 checkpoint 不足，失败恢复时难以精确重建当时的 `RunCtx.inputs`。
4. prompt 渲染阶段容易把上游 input artifact 全文注入，token 成本高，也会增加噪音。
5. skill 对输入依赖和注入方式的声明不够明确，下游阶段依赖隐式约定。
6. context selection、budget downgrade、context request retry 的审计信息分散，排障成本高。
7. 现有架构说明文档中关于 `context_request` 是否 same-step retry 的描述需要校准。当前代码中 `invokeSkill()` 已支持一次 supplement retry。

## 3. 目标

1. 每次 agent 调用使用的上下文可持久化、可审计、可回放。
2. 阶段之间通过显式 handoff 传递关键结论、产物引用、风险和开放问题。
3. 支持从 stage checkpoint 重建 `RunCtx.inputs` 和 `inputArtifactIds`。
4. 支持按策略注入上游输入，包括全文、摘要、引用和跳过。
5. 保留现有 `ContextPack` 架构，不推倒重来。
6. 为二期检索增强预留接口，包括 FTS/BM25、代码符号索引、embedding 和 MCP resource gateway。

## 4. 非目标

1. 一期不重写 workflow runner。
2. 一期不引入新的向量数据库。
3. 一期不替换现有 artifact 存储模型。
4. 一期不全面改造所有 agent prompt。
5. 一期不做复杂 UI 重构，只补足必要审计视图和数据结构。

## 5. 用户故事

### 5.1 交付工作台用户

作为交付工作台用户，我希望需求分析完成后，架构设计 agent 能明确拿到需求分析结论，而不是依赖后台隐式拼接。

### 5.2 平台开发者

作为平台开发者，我希望能查看某次 agent 调用到底使用了哪些 artifact、哪些上下文片段和哪些输入注入策略。

### 5.3 排障人员

作为排障人员，我希望某个阶段失败后，可以基于 checkpoint 恢复上下文状态，而不是依赖内存态或重新跑完整流程。

### 5.4 Skill 开发者

作为 skill 开发者，我希望可以声明当前 skill 需要哪些输入，以及每类输入应该全文注入、摘要注入还是只给 artifact 引用。

## 6. 功能需求

### FR1：持久化每次调用的 ContextPack

每次 `invokeSkill()` 构建 base `ContextPack` 后，在真正调用 agent 前将其保存为 artifact。

现有 `ArtifactKind` 仍使用兼容的 `context_pack`。具体角色通过 metadata 区分：

```ts
metadata.contextPackRole = 'base' | 'supplement'
```

需要记录：

- `runId`
- `stageId`
- `skillName`
- `invocationId`
- `contextPackId`
- `sourceRefs`
- `budget`
- `selectedItems`
- `downgradedItems`
- `droppedItems`
- `trustLevel`
- `freshness`
- `score`
- 是否由 `context_request` 触发 supplement
- 对应 `invocationId`
- 对应 `contextPackArtifactId`，该 id 至少写入 `AgentSession.metadata`

### FR2：增加阶段上下文 checkpoint

每个阶段开始和结束时记录 checkpoint。

```ts
type StageContextCheckpoint = {
  runId: string
  stageId: string
  phase: 'start' | 'finish'
  inputs: Record<string, string>
  inputArtifactIds: Record<string, string>
  producedArtifactIds: Record<string, string>
  contextPackArtifactIds: string[]
  createdAt: string
}
```

checkpoint 用于：

- 恢复 `RunCtx.inputs`
- 恢复 `inputArtifactIds`
- 审计阶段输入输出
- 定位上下文污染、缺失或错误覆盖

### FR3：增加显式 stage handoff

阶段完成时生成 handoff 记录，描述本阶段产物如何交给下游阶段使用。

```ts
type StageHandoff = {
  runId: string
  fromStage: string
  toStage?: string
  summary: string
  producedArtifacts: Array<{
    key: string
    artifactId: string
    kind: 'requirement' | 'design' | 'plan' | 'test' | 'code' | 'other'
    injectionPreference: 'full' | 'summary' | 'reference'
  }>
  decisions: string[]
  openQuestions: string[]
  risks: string[]
  createdAt: string
}
```

示例：需求分析到架构设计的 handoff 应包含：

- 需求摘要
- 已确认约束
- 未决问题
- 主要风险
- `requirement.md` artifact 引用
- 推荐注入方式

### FR4：增加输入注入策略

renderer 不再默认把所有 `c.inputs` 全文拼入 prompt，而是根据策略注入。

```ts
type InputInjectionPolicy = {
  artifactKey: string
  mode: 'full' | 'summary' | 'reference' | 'omit'
  maxTokens?: number
  required?: boolean
}
```

策略来源优先级：

1. skill 显式声明
2. stage handoff 推荐
3. artifact metadata 推荐
4. 系统默认策略

默认建议：

- 短文档可全文注入。
- 长文档注入摘要和 artifact 引用。
- `requirement.md` 默认注入摘要、关键约束和引用。
- `design.md` 默认注入摘要和引用。
- 超预算时从全文降级为摘要，再降级为引用。

### FR5：支持 resume/replay

当 run 中断或阶段失败时，可以从最近 checkpoint 恢复。

恢复步骤：

1. 找到最新 `StageContextCheckpoint`。
2. 重建 `RunCtx.inputs`。
3. 重建 `RunCtx.inputArtifactIds`。
4. 读取必要 artifact。
5. 继续后续阶段。

### FR6：上下文审计报告

每次 stage/skill 调用后可以查看：

- 使用了哪些 artifact
- 哪些被全文注入
- 哪些被摘要注入
- 哪些只作为引用
- 哪些候选上下文被丢弃
- 是否发生 `context_request`
- 是否触发 same-step supplement retry
- token 预算和降级原因

### FR7：校准现有架构说明

当前实现中，`invokeSkill()` 在捕获 `context_request` 后，会结束 base invocation，然后用 supplement `ContextPack` 重试同一个 skill 一次。如果 retry 再次请求上下文，则达到 retry limit 并失败。

需要更新既有架构说明，避免继续描述为“只补充给后续阶段，不同 step retry”。

## 7. 验收标准

1. 任意一次 agent 调用都能找到对应的 base context pack 记录。
2. 触发 `context_request` 时能找到 request artifact、supplement context pack 和 retry 记录。
3. 需求分析产出的 `requirement.md` 能通过 handoff 明确传递给架构设计阶段。
4. 阶段失败后可以通过 checkpoint 重建 `RunCtx.inputs` 和 `inputArtifactIds`。
5. prompt audit 能展示每个输入采用的注入模式。
6. 长文档不会默认全文注入。
7. 老工作流保持兼容，不因新增 artifact 或 metadata 中断。

## 8. 一期边界

一期聚焦四件事：

1. 上下文调用快照持久化。
2. 阶段 checkpoint。
3. 输入注入策略。
4. 显式 stage handoff。

二期再考虑检索能力增强，包括 BM25/FTS、代码符号索引、embedding 和 MCP resource gateway。
