# Agent 编排与 Harness 改进方案

> 日期：2026-06-27  
> 性质：当前实现分析 + 主流 Agent 架构对照 + 改进路线与任务拆解。  
> 基准：以当前代码为准；不替代 `2026-06-27-current-technical-architecture.md` 和 `2026-06-27-context-management-architecture.md`，而是给后续演进提供路线图。

## 1. 快速结论

当前 AI Native Platform 的方向是对的：平台控制 Workflow、Gate、Artifact、Context、Evidence，Claude Code / Codex 只是受控执行后端。这比“多个 Agent 自己聊天推进任务”更接近生产级 Agent Harness。

但当前实现仍是 MVP 形态：

- 编排是 `FLOW_REGISTRY` 驱动的顺序 stage dispatcher，不是可 checkpoint、retry、branch、join 的 durable graph。
- 多智能体主要体现为阶段专职 skill，而不是一等公民的 handoff / delegation / arbitration 协议。
- ContextPack 已经可审计，但 `context_request` 只补给后续 stage，不会自动回到同一 agent step 重试。
- 记忆已有 `KnowledgeArtifact`、accepted knowledge、usage metadata 和 calibration signal，但还不是完整的 semantic / episodic / procedural memory 生命周期。
- 工具策略已有 `SkillSpec.toolPolicy`、Runner command whitelist、Gate 证据链，但缺少面向 LLM 工具调用的 typed tool registry、call ledger、schema validation 和 replay。
- Harness 已有真实 worktree、命令证据、digest、Evidence Gate、deterministic eval harness，但 eval 还主要覆盖 router，不足以回归完整 agent trajectory。

建议下一阶段不要先堆 prompt，而是补平台级运行时能力：Trajectory Ledger、Typed Tool Registry、Durable Step Runtime、Memory Lifecycle、Context Retry Loop、Bounded Multi-agent Handoff、Workflow/Agent Eval Harness。

## 2. 当前实现地图

### 2.1 控制平面

- `apps/api/src/workflow-engine.ts` 是状态写入入口。
- `apps/api/src/gate-engine.ts` 是唯一 pass / warn / fail 判定者。
- `apps/api/src/context-governance.ts` 从 ContextPack、prompt audit、workflow action、gate、approval、agent result 重建“Agent 为什么知道这些”的读模型。
- `packages/shared/src/flows/registry.ts` 定义 flow；API、Runner、Web 共享它。

设计强点是状态和证据在平台，不在 Agent 自我声明里。

### 2.2 Runner 编排

- `apps/runner/src/orchestrator.ts:cmdOrchestrate()` 创建/恢复 `WorkflowRun`，准备本地 git worktree，加载 context policy，然后按 `FLOW_REGISTRY[run.flowId].stages` 顺序执行。
- `dispatchStep()` 是固定 switch router：`context_pack`、`requirement`、`design`、`implementation`、`build_test`、`review`、`completion`、`knowledge`、`report`、`analyze`、`scan`、`plan` 分派到对应函数。
- `StageStep.kind` 和 `skillId` 已在 shared 类型里存在，但当前注释明确说明 thin implementation 尚未真正用它们驱动 generic dispatcher。

这说明平台已经有 declarative flow 的壳，但运行时仍是顺序函数调用。

### 2.3 Agent 调用边界

- `apps/runner/src/orchestrator/invoke-skill.ts:invokeSkill()` 是统一 Agent 调用边界。
- 它先构造 fresh `ContextPack`，记录 `AgentTask.prompt`，记录 selected knowledge usage / review signal，再调用 backend。
- `AgentBackend.run(skill, ctx)` 是 backend contract；生产实现是 Claude Code 和 Codex，`NativeBackend` 仅作为测试夹具。

这是正确边界：平台拥有 task/context/evidence，backend 只负责执行。

### 2.4 记忆与上下文

- `packages/shared/src/types/context.ts` 定义 ContextPack、ContextManifestItem、ContextRequest、KnowledgeReviewSignal。
- `apps/runner/src/context/builder.ts` 构造候选上下文，过滤敏感路径和跨项目 knowledge，生成 maturity profile、manifest、retrieval hints、calibration signals。
- `apps/runner/src/context/retriever.ts` 做确定性 scoring、dedupe 和预算降级。
- `apps/runner/src/context/request.ts` 解析 fenced JSON / YAML `context_request`。
- `apps/runner/src/knowledge.ts` 和 API knowledge routes 负责 accepted knowledge / KnowledgeArtifact 使用与沉淀。

当前记忆更像“项目知识 + 当前 run context”，还没有一等公民的 memory taxonomy 和 lifecycle。

### 2.5 工具调用与证据

- `packages/shared/src/types/skill.ts` 的 `ToolPolicy` 是平台 skill 的声明。
- `apps/runner/src/command-runner.ts` 只执行 whitelisted command，记录 stdout/stderr、timeout、truncation 和 SHA-256 digest。
- `apps/api/src/gate-engine.ts` 消费 command/artifact/gate evidence；Agent note 不影响 gate status。
- Build/test 由 Runner 执行，Agent prompt 也明确要求不要跑 build/test。

这对“真实命令证据”很好，但还没有把 Agent 内部工具调用变成平台可回放记录。

### 2.6 Harness 与 Eval

- 真实运行 harness 已有：worktree、AgentTask、AgentResult、AgentEvent、Artifact、CommandRun、GateRun、Approval、Completion Report。
- `scripts/eval-harness.ts` 已有 deterministic local eval，读取 `eval/scenarios`，输出 JSON/HTML 到 `.ainp/evals`。
- 当前 scenario kind 只有 `router_recommendation`，variants 元数据已预留 backend / skill / knowledge A/B。

也就是说 eval 架子存在，但还不是完整 agent workflow / trajectory regression harness。

## 3. 主流方案对照

| 主流模式 | 关键能力 | 对本项目的启发 | 建议取舍 |
|---|---|---|---|
| OpenAI Agents SDK / Responses 风格 | typed tools、handoff、guardrails、trace | 把 agent step、tool call、handoff 和 guardrail 变成结构化对象 | 学协议形态，不把平台绑死到单一 SDK |
| LangGraph 风格 | durable graph、checkpoint、interrupt、resume、state reducer | 把顺序 flow 升级成可恢复的 Step Runtime / Graph Runtime | 优先做内部轻量 graph，不急着引入依赖 |
| CrewAI / AutoGen 风格 | role-based collaboration、multi-agent conversation | 多角色有价值，但自由聊天难审计、难验收 | 只采用 bounded handoff，不采用无约束群聊 |
| SWE-agent / OpenHands / Codex harness | worktree/sandbox、patch、trajectory log、tests、replay、benchmark | coding agent 交付应以 diff、test、tool trajectory 和 eval 为核心 | 本项目已经有一半，下一步补 trajectory/replay |
| RAG / agent memory 最佳实践 | semantic/episodic/procedural memory、provenance、freshness、decay | 记忆必须有范围、证据、时效和人工晋升 | 把 KnowledgeArtifact 拆成明确 memory lifecycle |
| MCP / typed tool registry 模式 | 工具 schema、权限、调用账本、结果校验 | 工具不应只靠 prompt 约束，要平台可验证 | 新增 typed tool registry + invocation ledger |

共同结论：生产级 Agent 系统的核心不是“更强模型”，而是“可审计运行时”。模型输出只是事件之一，平台必须拥有状态、工具、记忆、上下文、证据和评测。

## 4. 当前强项

- 控制权在平台：Workflow Engine / Gate Engine / Runner / Artifact boundary 已经分清。
- Evidence-first：CommandRun digest、Artifact digest、Evidence Gate、Completion Report 已经形成防自证闭环。
- Provider-neutral：Claude Code / Codex 共用 SkillSpec 和 Context renderer。
- ContextPack 可审计：manifest、sourceRefs、budget degradation、context_request chain 都能查。
- 本地 worktree 执行隔离清楚，Agent 不直接改平台状态。
- Eval harness 有起点，variants schema 已经为 A/B 和 backend comparison 留口。

这些不应推倒重来。改进应沿着当前边界补运行时能力。

## 5. 主要差距

1. `FLOW_REGISTRY` 是 declarative，但 dispatcher 仍是 hard-coded switch，无法表达 branch / join / retry policy / timeout policy / compensation。
2. Agent invocation 没有一等公民的 `AgentSession` / `Trajectory`：prompt、output、stream event 有记录，但 tool calls、handoffs、context retries、guardrail results 没有统一 ledger。
3. `context_request` 不触发同 step retry，导致“缺事实”只能影响后续阶段，当前 step 可能仍以不完整状态结束。
4. 记忆缺少 lifecycle：没有明确区分 semantic project knowledge、episodic run memory、procedural skill memory，也缺少 decay、staleness jobs、promotion review queue、eval-backed memory quality。
5. 工具调用缺 typed protocol：Agent 可用工具主要靠 backend 原生能力和 prompt，平台无法逐个校验 LLM tool call schema、权限、idempotency 和结果。
6. 多智能体缺 handoff contract：当前是 stage-specialist，不是可记录的 delegated subtask、critic pass、verifier pass、arbiter decision。
7. Eval harness 不覆盖完整 workflow：缺 fake backend、tool trajectory replay、context pack golden、gate/report replay、agent prompt variant regression。

## 6. 目标架构

### 6.1 Durable Agent Run Graph

把 flow 从“stage list + switch”升级成平台内部的 step graph：

- `StepDefinition`：stage、kind、skillId、inputs、outputs、retryPolicy、timeoutPolicy、gatePolicy。
- `StepRunCheckpoint`：输入 artifact ids、contextPackId、agentSessionId、toolInvocationIds、gateIds、resume cursor。
- `GraphRuntime`：按依赖执行 step，支持 resume、retry from checkpoint、human interrupt、branch/join。

第一步可以很轻：先继续保留现有 flow 顺序，只把 dispatch metadata 和 checkpoint 持久化，避免一次性重写 orchestrator。

### 6.2 Agent Session / Trajectory Ledger

在 `AgentTask` / `AgentResult` 之外新增或扩展 trajectory：

- `AgentSession`：一次 backend invocation 的完整 envelope，记录 backend、skill version、contextPackId、workspace、policy snapshot。
- `AgentMessage`：system/user/final summary 的摘要和 digest，不一定持久化全文。
- `AgentToolInvocation`：tool name、schema version、arguments digest、permission decision、result refs、duration、status。
- `AgentHandoff`：from role、to role、reason、input refs、expected output、status。
- `GuardrailResult`：input/output/policy 检查结果。

这样 harness 能回放“Agent 是如何得出结果的”，而不仅是看最终 artifact。

### 6.3 Typed Tool Registry

在平台侧定义 tool registry，而不是只依赖 backend 原生工具：

- tool schema：name、description、input JSON schema、output schema、side effect level。
- permission tier：read-only、workspace-write、command、network、platform-write。
- invocation policy：allowed stages、allowed paths、timeout、idempotency key、approval requirement。
- result ledger：stdout/stderr/artifact refs、digest、truncation、error class。

短期只把 Runner-owned 工具纳入：read artifact、read file snapshot、search, git diff, command run。长期再适配 backend 原生 tool call。

### 6.4 Memory Store 分层

把当前 KnowledgeArtifact 体系演进为三层记忆：

- Semantic memory：稳定项目事实、架构决策、领域规则、历史坑，来源是 accepted KnowledgeArtifact。
- Episodic memory：某次 WorkflowRun 的事件、失败、context_request、gate、approval、retro finding。
- Procedural memory：SkillSpec、prompt variant、tool policy、workflow pattern、团队 convention。

每条 memory 必须有 `scope`、`sourceRefs`、`trustLevel`、`freshness`、`status`、`lastUsedAt`、`hitCount`、`reviewStatus`、`supersedes`。自动写入只能进入 draft / candidate；accepted 仍需人工或明确 gate。

### 6.5 Context Orchestrator

把 ContextPack builder 从“每次调用前构造”扩成可观察的上下文运行时：

- context plan：本 step 需要哪些 context classes、预算和最低信任等级。
- source resolver：project profile、knowledge、run artifacts、code probe、tool results。
- supplement loop：`context_request` 触发 bounded same-step retry，最多 N 次，且 retry 必须复用 supplement pack。
- degradation policy：full / snippet / summary / retrieval_hint 的选择记录真实 token 估算和原因。
- golden test：重要任务的 ContextManifest 可回归。

这样“缺事实”可以在同一 stage 闭环，而不是拖到后续 stage。

### 6.6 Bounded Multi-agent Handoff

多智能体不要做自由群聊，采用显式交接：

- handoff 必须有 owner、reason、input artifact refs、expected output schema、stop condition。
- critic / verifier 只能评价已定义 artifact 和证据，不可暗中扩 scope。
- arbitration 由 coordinator 或 gate policy 决定，不能由两个 Agent 自行“达成共识”后改状态。
- 所有 handoff 记录进 trajectory ledger，并进入 Completion Report / Retro。

优先场景：implementation 后的 independent review、test failure debugger、security-sensitive diff reviewer、context recovery explorer。

### 6.7 Harness / Eval 扩展

把 `scripts/eval-harness.ts` 扩展成四类 scenario：

- `router_recommendation`：保留现有 deterministic router eval。
- `context_pack_fixture`：固定 project profile / knowledge / artifacts，断言 manifest、sourceRefs、degradation。
- `agent_backend_fixture`：fake backend 输出固定 artifact / context_request / tool calls，回归 invokeSkill、context retry、trajectory ledger。
- `workflow_fixture`：回放 StepRun / GateRun / CommandRun / Artifact，断言 Evidence Gate、Completion Report、Retro。

每个 scenario 支持 backend / skill / knowledge / context policy variants，输出 JSON/HTML，并能作为 CI regression gate。

## 7. 落地路线

### Phase 0：协议冻结与文档对齐

- 写 `AgentSession`、`ToolInvocation`、`MemoryRecord`、`StepCheckpoint` 的 shared type draft。
- 明确哪些只是 read model，哪些要落 DB。
- 补 spec：runner backend、shared backend、api backend 的 agent harness contract。

验收：类型草案和迁移计划完成，不改变运行行为。

### Phase 1：Trajectory Ledger

- 扩展 AgentTask/AgentResult 或新增 AgentSession 表。
- 在 `invokeSkill()` 记录 contextPackId、skill version、backend policy snapshot。
- 把 backend stream event、context_request、knowledge usage、guardrail/evidence signal 关联到 session。

验收：一次真实 run 能从 session id 查到 prompt audit、context、outputs、request chain 和 gate evidence。

### Phase 2：Typed Tool Registry MVP

- 先平台注册 Runner-owned tools：command run、artifact read、context supplement、git diff capture。
- 给每次 command/tool 执行生成 `ToolInvocation`。
- 将 whitelist / timeout / digest / approval decision 纳入 tool result。

验收：build/test 命令和 diff capture 均能以 tool invocation 形式审计。

### Phase 3：Context Request Same-step Loop

- `captureContextRequest()` 后允许 bounded retry 当前 skill。
- supplement pack 明确标记 retry index。
- 防止无限循环：最多 1-2 次，且第二次仍缺事实时输出 blocked artifact / human question。

验收：fixture backend 第一次输出 context_request，第二次收到 supplement 后产出目标 artifact；trajectory 可查两次调用关系。

### Phase 4：Memory Lifecycle

- 给 KnowledgeArtifact metadata 增加 scope、freshness review、supersedes、decay candidate 字段的规范化访问器。
- 从 retro/context conflict 生成 memory review queue。
- ranking 使用 hitCount、freshness、reviewStatus、source evidence，而不是只靠文本匹配。

验收：stale/conflict memory 不进入 authoritative context；accepted/current memory 可被解释性选中。

### Phase 5：Bounded Multi-agent Handoff

- 新增 handoff record 和 handoff policy。
- 支持 review/debug/security/context-recovery 这些 bounded child tasks。
- Handoff 输出必须回到主 graph，由 gate 或 coordinator 决定是否采用。

验收：implementation 后可触发 independent reviewer，review 结果进入 report，但不能直接改 run status。

### Phase 6：Harness Maturity

- 扩展 eval scenario kinds。
- 加 fake backend 和 workflow replay。
- 把核心 context/gate/report/trajectory golden 纳入 `bun run eval`。

验收：一次无外部 CLI 的 eval 能覆盖 router、context、invokeSkill retry、evidence gate、completion report。

## 8. 建议任务拆解

1. `06-27-agent-session-trajectory-ledger`
   - 产物：shared types、DB migration、API read route、Runner write path。
   - 验收：AgentSession 能关联 ContextPack、AgentTask、AgentResult、context_request 和 outputs。

2. `06-27-typed-tool-registry-mvp`
   - 产物：ToolSpec / ToolInvocation 类型、Runner command/diff 工具落账。
   - 验收：CommandRun 与 diff capture 都可从 tool invocation 追溯，digest 可验证。

3. `06-27-context-request-same-step-retry`
   - 产物：bounded retry policy、supplement retry metadata、fixture backend 测试。
   - 验收：context_request 不再只能服务后续 stage。

4. `06-27-memory-lifecycle-contract`
   - 产物：semantic/episodic/procedural memory contract、metadata normalizer、review queue 草案。
   - 验收：stale/conflict/superseded memory 的处理可测试、可解释。

5. `06-27-handoff-policy-and-review-agent`
   - 产物：handoff record、review/debug 子任务协议、report 展示。
   - 验收：多智能体交接可审计，不能绕过 Gate。

6. `06-27-agent-harness-eval-expansion`
   - 产物：`context_pack_fixture`、`agent_backend_fixture`、`workflow_fixture` scenario kinds。
   - 验收：`bun run eval` 覆盖无外部 CLI 的 agent harness 回归。

## 9. 必须保持的不变量

- Workflow Engine 仍是唯一状态写者。
- Gate Engine 仍是唯一 pass / warn / fail 判定者。
- Agent / backend 不能直接写平台状态。
- 记忆自动沉淀不能直接变 accepted knowledge。
- Tool invocation ledger 只能增强审计，不能绕过 whitelist / approval。
- Multi-agent handoff 不能绕过主 workflow 和 human gate。
- Eval harness 优先 deterministic 和 fake backend，不能依赖外部模型才能跑基础回归。

## 10. 不建议做的事

- 不建议把 Claude Code / Codex 原生 subagent 当平台编排核心；它们应是 backend 能力，不是制度。
- 不建议用“更多 prompt 约束”替代 typed tool policy、trajectory 和 gate。
- 不建议让多个 Agent 自由群聊决定状态；所有状态转换都应回到平台。
- 不建议直接引入大而全 graph 框架重写 orchestrator；先把 checkpoint/ledger 协议落地。
- 不建议把 accepted knowledge 继续当一整块 markdown 注入；应走 scoped memory retrieval。

## 11. 推荐优先级

如果只能先做三件事：

1. Trajectory Ledger：没有运行轨迹，后续 harness 和多智能体都不可审计。
2. Context Request Same-step Retry：这是当前上下文闭环最明显的功能缺口。
3. Eval Harness Expansion：没有 fake backend / workflow fixture，架构演进无法稳定回归。

这三项完成后，再做 Typed Tool Registry 和 Memory Lifecycle 会更稳，因为它们都能挂到同一条 trajectory 上验证。
