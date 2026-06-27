# Agent Runtime 与 Harness 升级需求文档

> 日期：2026-06-27  
> 来源：由 `2026-06-27-agent-orchestration-and-harness-improvement-plan.md` 拆分。  
> 性质：PRD / 需求基线，定义下一阶段 Agent 编排、记忆、上下文、工具调用和 Harness 的产品化目标。

## 1. 背景

当前平台已经把 Workflow、Gate、Artifact、Context、Evidence 放在平台控制面，Claude Code / Codex 只是受控执行后端。这是正确方向，但当前 Agent runtime 仍偏 MVP：

- Runner 按 `FLOW_REGISTRY` 顺序执行 stage，缺少可持久化的 graph/checkpoint/retry 模型。
- Agent 调用有 `AgentTask` / `AgentResult`，但没有完整 trajectory ledger。
- `context_request` 能生成 supplement pack，但不能在同一 step 自动重试。
- KnowledgeArtifact 已承载项目知识，但缺少 semantic / episodic / procedural memory 生命周期。
- Tool policy 主要是 prompt + command whitelist，缺少 typed tool invocation ledger。
- Eval harness 主要覆盖 router，还不能回归完整 Agent workflow。

本需求的目标是把平台从“有证据的顺序工作流”升级为“可审计、可回放、可评测的 Agent Runtime”。

## 2. 目标用户

- 平台开发者：需要可靠扩展 Agent 编排、工具、记忆和 eval，不破坏现有 Workflow/Gate 边界。
- 任务操作者：需要知道 Agent 为什么这么做、用了什么上下文、调用了什么工具、结果是否可信。
- 架构评审者：需要查看一次 run 的完整证据链和后续可执行任务。
- CI / 质量负责人：需要无外部模型依赖的 regression harness，验证核心 Agent runtime 行为。

## 3. 用户价值

- 降低 Agent 幻觉和自证完成风险。
- 让 context 缺失可以在当前 step 内闭环，而不是延迟到后续阶段才暴露。
- 让工具调用、handoff、memory 使用都可追溯。
- 让架构演进可以通过 deterministic eval 回归。
- 让多智能体协作保持受控，不退化成自由群聊。

## 4. 范围

### In Scope

- Agent Session / Trajectory Ledger。
- Typed Tool Registry MVP。
- `context_request` same-step bounded retry。
- Memory lifecycle contract。
- Bounded multi-agent handoff。
- Eval harness scenario expansion。
- API / Runner / Shared / Web 需要的最小读模型和诊断入口。

### Out of Scope

- 不引入完整第三方 graph runtime 替换当前 orchestrator。
- 不让 Claude Code / Codex 原生 subagent 成为平台编排核心。
- 不让自动生成知识直接进入 accepted knowledge。
- 不做自由多 Agent 群聊。
- 不把 eval 基础回归绑定到真实外部模型。
- 不改变 Workflow Engine 和 Gate Engine 的唯一权威边界。

## 5. 需求

### R1 Trajectory Ledger

平台必须记录一次 Agent invocation 的完整运行外壳：

- backend kind、skill id/version、stage、workspace、branch。
- contextPackId、input artifact ids、output artifact ids。
- final message / prompt audit 的摘要或 digest。
- context_request、knowledge usage、calibration signal 的关联。
- tool invocation、handoff、guardrail result 的关联位。

验收：从一个 session id 可以追到 AgentTask、AgentResult、ContextPack、output artifacts、context_request chain 和相关 gate/evidence。

### R2 Durable Step Checkpoint

平台必须为后续 graph runtime 留出 step checkpoint：

- 当前 step 的输入 artifact ids。
- contextPackId / agentSessionId。
- toolInvocationIds / gateIds。
- retry index、resume cursor、失败原因。

验收：现有顺序 flow 行为不变，但每个 agent step 具备可查询 checkpoint 元数据。

### R3 Context Request Same-step Retry

Agent 缺工程事实时输出结构化 `context_request` 后，平台必须能在同一 step 内 bounded retry：

- 生成 supplement ContextPack。
- retry 当前 skill，带上 supplement metadata。
- 最多 1-2 次，避免循环。
- 超限后进入 blocked artifact 或 human question，而不是继续猜测。

验收：fixture backend 第一次输出 context_request，第二次收到 supplement 后产出目标 artifact；trajectory 能展示两次 invocation 的父子关系。

### R4 Typed Tool Registry MVP

Runner-owned 工具必须有平台级定义和调用账本：

- ToolSpec：name、schema version、输入输出 schema、side effect level、权限等级。
- ToolInvocation：arguments digest、permission decision、result refs、status、duration、error。
- 首批工具：command run、git diff capture、artifact read、context supplement。

验收：build/test 命令和 diff capture 都能从 ToolInvocation 追到 digest-bearing evidence。

### R5 Memory Lifecycle

记忆必须分层并具有生命周期：

- Semantic memory：稳定项目事实、架构决策、领域规则、历史坑。
- Episodic memory：某次 run 的失败、审批、gate、context_request、retro finding。
- Procedural memory：SkillSpec、workflow pattern、tool policy、团队规范。

每条 memory 至少有 scope、sourceRefs、trustLevel、freshness、status、reviewStatus、hitCount、lastUsedAt、supersedes。

验收：stale/conflict/superseded memory 不进入 authoritative context；accepted/current memory 可被解释性选中。

### R6 Bounded Multi-agent Handoff

多智能体协作必须通过显式 handoff：

- from/to role。
- reason。
- input artifact refs。
- expected output schema。
- stop condition。
- adoption decision。

验收：implementation 后可以触发 independent review，但 review 结果只能进入 report/gate evidence，不能直接改 run status。

### R7 Eval Harness Expansion

现有 `bun run eval` 必须扩展到 Agent runtime 回归：

- `context_pack_fixture`：验证 ContextManifest、sourceRefs、degradation。
- `agent_backend_fixture`：用 fake backend 验证 invokeSkill、context retry、trajectory。
- `workflow_fixture`：回放 gate/artifact/command/report。

验收：无外部 CLI 时也能跑基础回归，输出 JSON/HTML 报告。

### R8 可观测与报告

Web/API 必须能回答：

- 这次 Agent 调用了哪些工具？
- 用了哪些 memory 和 context？
- 有没有 context retry？
- 有没有 handoff？
- 哪些证据让 Gate 通过？
- 哪些风险进入 retro / follow-up？

验收：run detail 或 context governance 读模型能聚合这些信息，Completion Report 至少引用关键 session/tool/context/handoff/eval evidence。

## 6. 成功指标

- 100% Agent invocation 有 session / trajectory 记录。
- 100% Runner-owned tool execution 有 ToolInvocation 记录。
- context_request same-step retry 的 fixture 测试通过。
- stale/conflict memory 注入负例测试为红灯。
- eval harness 至少覆盖 router、context、agent fixture、workflow fixture 四类 scenario。
- Completion Report 不依赖 Agent 自述作为唯一完成证据。

## 7. 风险

- 一次性改造 orchestrator 容易破坏现有 flow。策略：先加 ledger/checkpoint，再逐步 generic dispatcher。
- 记忆字段过多会造成 schema 噪声。策略：先做 normalizer 和 metadata contract，不急着大迁移。
- Tool registry 如果直接接 backend 原生工具会复杂。策略：先纳入 Runner-owned 工具。
- Same-step retry 可能循环。策略：硬限制 retry count，并记录 blocked result。
- Eval 过早接真实模型会不稳定。策略：fake backend 优先。

## 8. Definition of Done

- 需求、架构设计、研发任务和红黄绿测试文档完成并进入 docs 索引。
- 后续每个实现任务都有明确验收标准和测试类型。
- 不改变当前运行行为，除非进入对应实现任务。
