# AI Native 云开发平台：Agent 执行后端与 Claude Code / Codex 取舍

日期：2026-05-01

## 11. Claude Code SubAgent vs 自研 Agent 编排

有两种实现方式：

### 方案 A：基于 Claude Code SubAgent

把 Requirement Agent、Design Agent、Implementation Agent、Review Agent 等做成 Claude Code subagent。

优点：

```text
- 实现快
- 适合代码库任务
- 有上下文隔离
- 可并行执行
- 可限制工具权限
```

问题：

```text
- 强 vendor lock-in
- 平台控制力不足
- 可观测性不一定满足云平台要求
- 跨 Agent 通信不适合依赖原生机制
- Hook / Gate 不应该绑在 Claude Code 上
```

### 方案 B：平台自己实现 Agent 编排

平台自己定义 Agent 调度、上下文输入、工具权限、执行状态、结果校验、产物落盘。

优点：

```text
- 平台可控
- 更容易切 Claude / Codex / OpenAI / Gemini
- 更容易做多租户权限
- 更容易做强门禁
- 更容易形成统一平台资产
```

缺点：

```text
- 实现周期更长
- 容易过度设计
- 代码修改能力需要自己补齐或借助 coding backend
```

## 12. 推荐折中架构

推荐：

> 平台自研控制平面，执行层可先接 Claude Code SubAgent / Codex。

结构：

```text
Workflow Engine
  ↓
Agent Orchestrator
  ↓
AgentBackend interface
  ├── ClaudeCodeBackend
  ├── CodexBackend
  ├── OpenAIBackend
  └── AnthropicBackend
```

平台自己负责：

```text
Workflow Engine
Coordinator
Hooks
Gates
Artifact Store
Human Approval
Trace
Permissions
```

Claude Code / Codex 负责：

```text
执行一个受控 step，尤其是代码探索、代码修改、测试失败修复、局部重构。
```

## 13. Agent Contract

先定义自己的 Agent Contract，而不是先选 Claude Code 还是 Codex。

```ts
type AgentTask = {
  id: string
  workflowRunId: string
  role: AgentRole
  objective: string
  inputs: ArtifactRef[]
  contextPack: ContextPack
  workspace: WorkspaceRef
  toolPolicy: ToolPolicy
  outputSchema: JSONSchema
  stopConditions: StopCondition[]
}
```

```ts
type AgentResult = {
  status: 'completed' | 'failed' | 'needs_human' | 'needs_reroute'
  summary: string
  artifacts: Artifact[]
  evidence: EvidenceRef[]
  changedFiles: string[]
  toolCalls: ToolCallRecord[]
  nextActions?: CoordinatorAction[]
}
```

只要 contract 是平台自己的，底层 backend 可以替换。

## 14. Claude Code Backend 的边界

如果使用 Claude Code，不要让 Claude Code 管全流程。

正确方式：

```text
平台生成明确任务
  ↓
调用 Claude Code subagent
  ↓
subagent 只完成这个 step
  ↓
返回结构化结果
  ↓
平台解析并进入 Gate
```

Implementation Step 示例约束：

```text
你是 Implementation Agent。
只允许根据 approved design 修改代码。
不得修改 design 未声明的模块。
完成后输出：
1. changed files
2. implementation summary
3. tests run
4. known risks
```

完成后平台继续执行：

```text
diff scope gate
test gate
review gate
```

## 15. Codex Backend 兼容方式

Codex Backend 也实现同一个接口：

```ts
class CodexBackend implements AgentBackend {
  async run(task: AgentTask): Promise<AgentResult> {
    // 1. 创建 workspace / branch
    // 2. 组装 prompt
    // 3. 注入 context pack
    // 4. 暴露工具
    // 5. 执行
    // 6. 收集 diff / logs / artifacts
    // 7. 返回统一 AgentResult
  }
}
```

平台不关心底层是不是 Claude Code。

## 16. 哪些适合交给 Claude Code / Codex，哪些应平台自研

适合 coding backend：

```text
代码探索
代码实现
代码 review
测试失败修复
局部重构
文档生成
```

应平台自研：

```text
Workflow 状态机
Human approval
Artifact schema
Gate 判断
权限系统
审计日志
任务队列
成本控制
多租户隔离
知识库索引
Context Pack 构建
```

## 17. 推荐实施路线

### 阶段 1：定义平台抽象

先定义：

```text
Workflow
Step
AgentTask
AgentResult
Artifact
Gate
Hook
Workspace
ToolPolicy
```

### 阶段 2：做 Native LLM Agent Runner

先实现不强依赖 coding runtime 的 agent：

```text
Requirement Agent
Design Agent
Review Agent
Knowledge Agent
```

### 阶段 3：Implementation Agent 接 Claude Code / Codex Backend

写代码这件事先交给 Claude Code / Codex。

平台仍做：

```text
diff 检查
测试
review
审批
artifact 存储
```

### 阶段 4：增加更多 Backend

因为接口已抽象，新增 Codex / OpenAI / Anthropic backend 不影响产品层。

## 18. 最终建议

如果目标是快速做 MVP：

> 控制平面自己写，代码执行先借 Claude Code / Codex。

如果目标是长期可扩展平台：

> 不要把 Claude Code SubAgent 作为核心模型。

边界：

```text
Claude Code SubAgent：执行一个受控 step
平台：决定为什么执行、何时执行、能不能继续、结果算不算合格
```

一句话：

> SubAgent 可以是工人，但不能是制度。平台的 Workflow / Hook / Gate / Artifact 才是制度。

---

相关：`2026-05-01-ai-native-platform-runtime-configuration-notes.md`。
