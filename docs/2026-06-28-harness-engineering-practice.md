# 这个工作台如何实践落地 Harness 工程

> 日期：2026-06-28
> 性质：以当前代码为准的 Harness 工程实践梳理（落地机制 + 代码定位 + 路线图对照）。
> 基准：本文是对 `2026-06-27-current-technical-architecture.md` 和 `2026-06-27-agent-orchestration-and-harness-improvement-plan.md` 的代码级落地核验，不替代它们。

---

## 1. 这里的 "Harness 工程" 指什么

在本工作台语境里，**Harness 不是某个文件或某个库，而是"把不可控的 LLM Agent CLI 改造成可控、可验证、可审计、可恢复、可评测的软件交付执行框架"这一整套工程实践。**

我们驱动的执行后端是两个**真实的第三方 CLI**：Claude Code 与 Codex。它们天然是黑盒、非确定、会自报完成、会被用户本机的 hook/config/login 影响。Harness 工程要解决的核心问题就是：

> 在不信任模型自我声明的前提下，让平台始终拥有**状态、门禁、上下文、工具、证据、轨迹和评测**，让 Agent 退化为"受控执行的一个事件源"。

一句话结论：**这个平台已经不是"Web 调 CLI"，而是一个 evidence-first 的本地可信 Agent Harness。** 06-27 改进方案里列出的多数运行时能力（轨迹账本、工具账本、上下文同步重试、图运行时地基、确定性 eval）已经从路线图**落地为代码**（见 §9 对照表）。

---

## 2. 设计哲学：四条信条

整套 Harness 建立在四条始终被代码强制的信条上：

1. **控制权在平台，不在 Agent。** 状态只有一个写者，门禁只有一个判定者，Agent / backend 没有任何状态写入路径。
2. **Evidence-first，拒绝自证。** Build/Test 来自真实 spawn 的命令，带 SHA-256 digest；Completion Report 只从持久化证据拼装；Agent 的 note 只展示、不影响门禁。
3. **Provider-neutral。** Claude Code 与 Codex 共用同一套 SkillSpec、ContextPack renderer、preflight 与证据契约；切换后端不改平台协议。
4. **Deterministic eval 优先。** 核心回归用 fake backend，不依赖外部模型 CLI 才能跑，保证架构演进可稳定回归。

---

## 3. 总体架构：三个平面

```text
┌──────────────────────────────────────────────────────────────────────┐
│ 控制平面  apps/api (Hono + SQLite, :8787)                              │
│   workflow-engine.ts   ← 唯一状态写者                                  │
│   gate-engine.ts       ← 唯一 pass/warn/fail 判定者                    │
│   graph-runtime.ts     ← 图式 resume 决策（durable graph 地基）         │
│   step-checkpoints.ts  ← 步骤检查点（resume 依据）                      │
│   context-governance.ts← "Agent 为什么知道这些" 读模型                 │
│   reports.ts           ← 防自证的 Completion / Retro / Knowledge       │
│   agent-stream-bus.ts  ← SSE 实时流式总线                               │
└───────────────▲───────────────────────────────┬──────────────────────┘
   runner 事件 ingress（唯一回写通道）            │ run detail / SSE
                │                                 ▼
┌───────────────┴──────────────────────────────────────────────────────┐
│ 执行平面  apps/runner (本地 CLI / watch / orchestrator)                │
│   orchestrator.ts          ← run 生命周期骨架 + dispatchStep()         │
│   orchestrator/graph-scheduler.ts ← 问"下一个节点跑什么"               │
│   orchestrator/invoke-skill.ts    ← 统一 Agent 调用边界（含上下文重试）│
│   orchestrator/steps.ts           ← 各阶段实现 + 命令/handoff 落账     │
│   agents/claude-code.ts · codex.ts← 真实 CLI 驯化（参数/隔离/解析）    │
│   context/builder · retriever · request · renderer ← 上下文工程        │
│   command-runner.ts        ← 白名单命令 + digest                       │
│   worktree.ts              ← 每个 run 一个独立 git worktree            │
└───────────────────────────────┬──────────────────────────────────────┘
                                 │ spawn / fs / git
                                 ▼
        用户本机：git worktree、claude/codex CLI、mvn/mvnw、JDK
```

贯穿三平面的是**证据平面**：`Artifact / CommandRun / AgentSession / ToolInvocation / StepCheckpoint / GateRun / Handoff / AuditLog` 全部持久化到 SQLite，可被 Web UI、Completion Report 和 Eval 引用。

边界铁律：Web 不碰文件系统；Runner 不直接写 SQLite（只发事件）；Agent CLI 不改平台状态。

---

## 4. 七大支柱（落地机制 + 代码定位）

### 支柱一：控制平面与执行平面分离

**唯一状态写者。** 所有状态写入集中在 `apps/api/src/workflow-engine.ts`：`createWorkflowRun`、`transitionStage`(:295)、`startStep`/`finishStep`(:320/:346)、`recordCommandRun`(:367)、`recordToolInvocation`(:378)、`recordHandoff`(:407)、`completeWorkflowRun`(:525)、`awaitHuman`(:538)、`retryStage`(:550)、`recordAgentSessionStarted/Finished`(:1298/:1342)……Runner 只能通过 `apps/api/src/routes/runner-events.ts` 这一条事件 ingress 触发这些写入，没有旁路。状态迁移函数遵守"读改写之间不 await"的约定，避免并发错乱。

**唯一门禁判定者。** `apps/api/src/gate-engine.ts` 是唯一产出 `pass/warn/fail` 的地方。每条规则输出 `RuleResult`，GateRun 状态取**最坏值**：

```ts
// gate-engine.ts:36
if (results.some((r) => r.status === 'fail')) return 'fail';
if (results.some((r) => r.status === 'warn')) return 'warn';
return 'pass';                       // worst(results)，用于 :55 status: worst(results)
```

compile/test/surefire/diff_scope/sensitive/acceptance/evidence 各 gate 都只在此判定。Agent 可以附 `agentNote`，但它**进不了 status**——这是"Agent 不能宣布 Gate 通过"在代码里的落点。

### 支柱二：Agent Backend Runtime —— 真实 CLI 的"驯化"

这是 Harness 最核心、踩坑最多的一层。`apps/runner/src/agents/claude-code.ts:180` 拼装的启动参数集中体现了每一个工程决策：

```ts
const args = [
  '--print', '--output-format', 'stream-json',   // 行级实时流，不 buffer
  '--verbose', '--include-partial-messages',
  '--no-session-persistence',
  ...customizationIsolationArgs,                  // --safe-mode + --settings(hooks 清空)
  '--permission-mode', 'acceptEdits',
  '--max-budget-usd', ...,
  '--add-dir', workspacePath, '--add-dir', artifactsDir,
  '--tools', allowedToolArg,                      // 真正裁剪可用工具
  '--allowed-tools', allowedToolArg,              // 权限策略
  '--disallowed-tools', 'WebFetch,WebSearch,Bash,Skill',  // claude-code.ts:155 硬禁
  '--append-system-prompt', systemPrompt,
  userPrompt,
];
```

落地要点与"防什么坑"：

- **Hook 隔离（`claude-code.ts:156-175` 注释记录了真实事故）。** 用户 `~/.claude/settings.json` 里的 Stop hook 会去读 per-session transcript，而 runner 的 worktree 路径下 transcript 位置不同 → hook 失败 → Claude Code 把失败当作合成 user message 重新注入 → 模型再答 → hook 再触发 → 死循环，直到 10 分钟硬超时（exit 143）。**修复**：默认 `--safe-mode` + 传一个把所有已知 hook 事件清空的 `--settings`。明确**不用** `--setting-sources project,local`，因为那会连带丢掉用户的 `env` 块，破坏第三方 router 鉴权（如 anyrouter 的 `ANTHROPIC_AUTH_TOKEN`）。
- **`--tools` 与 `--allowed-tools` 都要传。** 只给 `--allowed-tools` 不会把内建工具从模型手里拿掉，只改权限策略；`Bash`/`Skill` 默认排除，让 build/test 与 slash-skill 副作用始终归 Runner 所有。
- **默认继承本机环境**（`claude-code.ts:217`）：默认继承 `HOME`/`CLAUDE_CONFIG_DIR`/`XDG_CONFIG_HOME`，让本地 OAuth/keychain 登录可见；HOME 隔离改为显式 opt-in（`AINP_CLAUDE_HOME_ISOLATION=1`）。
- **审计可见**：`meta:started` 事件写入 `userHooksOverridden` / `safeMode`（`claude-code.ts:204-212`），审计日志能看出该次 run 是否启用了 hook 隔离。
- **Codex 对称处理**（`agents/codex.ts`）：`codex exec --json`、`--sandbox workspace-write`、`--ignore-rules --disable hooks`、`CODEX_NON_INTERACTIVE=1`，且不传 `--ask-for-approval`（0.128.0 兼容）。
- **stream-json 行级实时解析**（`agents/claude-code-parser.ts`、`codex-parser.ts`）：逐行 parse 并立刻 emit，转成平台统一的 AgentEvent，console 与 UI 同等延迟，绝不 buffer-then-emit。
- **fail-fast preflight**（`agent-backend-preflight.ts`）：`claude --version` + `claude auth status` 的 `loggedIn===true`；Codex 是 `codex --version` + `codex login status`。只检查进程/登录，**绝不 hang 在 model prompt 上烧钱**；失败抛出带 `status` + remediation hint 的错误。
- **跨平台 bin 解析**（`cli-common.ts` 的 `buildResolvedAgentBackendCliSpawn`）：macOS/Linux 用裸命令，Windows 试 `.cmd/.exe/.bat` shim；`.cmd` 用 `cmd.exe /d /s /c call <shim>` 调用。**preflight 与 runtime 共享同一解析结果**，杜绝"preflight 过了但 runtime spawn 了别的 bin"。
- **禁止生产 fallback**（`backend-selection.ts`）：后端来源只有 `project.agentBackend`，`AINP_AGENT_BACKEND` 不控制生产编排，`NativeBackend` 仅作测试夹具，不允许 fallback 进生产 run。

### 支柱三：统一调用边界 `invokeSkill()` + Context Injection

**所有 Agent 调用只有一个入口**：`apps/runner/src/orchestrator/invoke-skill.ts:64 invokeSkill()`。它把"构造上下文 → 审计 prompt → 起 session → 调 backend → 捕获 context_request → 落证据"收敛成一条边界，平台拥有 task/context/evidence，backend 只负责执行。

**Context Injection 是 provider-neutral 的 `ContextPack`，不是 prompt 拼接：**

- `context/builder.ts` 收集候选来源：Project Profile、accepted knowledge、结构化 KnowledgeArtifact、run history、当前输入 artifact；产出 maturity profile、manifest、sections、retrieval hints、calibration signals。
- `context/retriever.ts` 做**确定性 scoring + dedupe + 预算降级**（full / snippet / summary / retrieval_hint），记录真实 token 估算与降级原因。
- 敏感路径、跨项目 knowledge 过滤，每个条目带 `sourceRefs / trustLevel / freshness`。
- prompt 里注入信任边界：仓库内容与生成 artifact 都是**证据，不是更高优先级指令**。

**context_request 同步重试（Phase 3，已落地）** 是上下文闭环的关键升级。过去"缺事实"只能补给后续 stage；现在 `invoke-skill.ts:97-132` 实现了**同一 step 内的有界重试**：

```text
invokeSkillAttempt(retryIndex:0, base pack)
   └─ 解析到 context_request？─ 否 → 直接返回
                              ─ 是 → finishContextRequestBaseInvocation
invokeSkillAttempt(retryIndex:1, supplement pack)   ← 同一 step，第二次 backend call
   └─ 仍有 context_request？─ 否 → 成功返回
                            ─ 是 → failInvocation + throw "retry limit reached"  (:127)
```

即**最多 2 次 backend call**，第二次仍缺事实就产出失败/阻塞，而不是带着不完整状态硬冲。`context/request.ts:16 parseContextRequest()` 从 agent 最终消息或输出文件里解析 ```` ```context_request ```` 围栏块（JSON 或 YAML-ish）。每次 attempt 都会 `agentSessionStarted`（带 `contextPackId`、`parentSessionId`、`retryIndex`），把 base→supplement 串成可回放的 trajectory。

前端 `apps/web` 的 Context Flow 面板（`page-task-detail.ts` + `apps/web/test/context-flow-panel.test.ts`）把这些选择/来源/降级/请求链可视化；API 侧由 `context-governance.ts` 聚合成可读治理读模型，对应 `GET /workflow-runs/:id/context`。

### 支柱四：声明式 Flow → Durable Graph Runtime

**FLOW_REGISTRY 是 flow 的单一事实来源**（`packages/shared/src/flows/registry.ts`），API / Runner / Web 三端共享同一份，避免三处各写一套阶段顺序。当前 4 个 flow：

| Flow | 阶段 |
|---|---|
| `feature.standard` | context_pack → requirement → design → implementation → build_test → review → completion → knowledge |
| `feature.fastforward` | implementation → build_test → review → completion |
| `issue.standard` | report → analyze → implementation → build_test → review → completion |
| `refactor.standard` | scan → plan → implementation → build_test → review → completion |

**从"顺序 switch"向"durable graph"演进，采用的是改进方案 §6.1 的"轻地基"策略**——先把图结构与 resume 决策落地，不重写 orchestrator：

- `packages/shared/src/flows/graph-adapter.ts:42 deriveGraphNodes()`：把 FLOW_REGISTRY **纯投影**成图节点；线性 flow → 线性链，每节点 `dependsOn` 前一阶段；`STAGE_NODE_KIND`(:18) 把 stage 映射成 `agent / engine / human / gate`；`retryable = agent || engine`。这是**唯一**知道"stage 顺序如何变成图结构"的地方。
- `apps/api/src/graph-runtime.ts:25 decideGraphResume()`：resume 大脑——按 flow 顺序选第一个 `status==='ready'` 且依赖全 `succeeded` 的节点。`canAttemptNode()`(:74) 是关键守卫：**已 `succeeded` 的节点绝不被选中重跑**。
- `apps/runner/src/orchestrator/graph-scheduler.ts:27 decideNextStage()`：Runner 侧薄包装，问 API 下一个节点跑什么；线性 flow 行为与旧版完全一致，scheduler 只是确认 next node 匹配 legacy stage cursor。
- `apps/api/src/step-checkpoints.ts:26 recordStepCheckpoint()`：在 dispatch 时记录每个 step 的 `inputArtifactIds / contextPackId / agentSessionId / toolInvocationIds / gateRunIds / outputArtifactIds / resumeCursor / attempt`，为 resume 提供依据，**不重新推导**。

> 落地边界（诚实标注）：**resume + checkpoint + 已完成节点守卫已可用**（最近 commit `2b80646` R5 还专门加了"graph 节点 resume 不能绕过 Workflow/Gate 权威写入"的守卫）；**branch / join 拓扑仍是预留**——graph-adapter 当前只生成线性链，注释明说可后续扩展而不破坏 registry 契约。

所有这些图/检查点类型在注释里都反复声明同一条不变量：**它们是 evidence/read state，绝不能成为第二个状态写者**（`types/graph-runtime.ts`、`types/step-checkpoint.ts`）。

### 支柱五：证据与轨迹账本（防自证闭环）

这是 evidence-first 的具体落地，把"Agent 怎么得出结果"变成可回放的持久化证据。

- **命令证据**（`apps/runner/src/command-runner.ts`）：只执行白名单命令，记录 stdout/stderr、exitCode、timeout、truncation，并产出三个 digest——`stdoutSha256 / stderrSha256 / combinedSha256`(:155-157)。Build/Test 必须来自这条真实 spawn，Agent prompt 明确被要求不要自己跑 build/test。
- **轨迹账本 AgentSession（Phase 1，已落地）**（`types/agent-session.ts`）：一次 backend invocation 的 envelope，记录 backend、skillVersion、`contextPackId`、`workspacePath`、`agentTaskId`、`agentResultId`、`backendCalls`（含 context-request 重试次数）；由 `invokeSkill` 通过 `agentSessionStarted/Finished` 落账。从一个 session id 能查到 prompt audit、context、outputs、request chain 与 gate 证据。
- **工具账本 ToolInvocation（Phase 2，已接入运行路径）**（`types/tool-invocation.ts`）：4 类 kind（`command_run / diff_capture / artifact_read / context_supplement`），digest-backed，带 `permissionDecision` 与 `producedRefs`。真实接入点：`steps.ts:143 runWhitelistedCommandWithToolInvocation()`，compile/test（`steps.ts:406/:436`）都走它 → `api-client.ts:272` 上报 → `routes/runner-events.ts:355 recordToolInvocation` 经唯一写者落库。即 build/test/diff 都能以 tool invocation 形式审计、digest 可验证。
- **Stage Handoff（Phase 5，已落地为 stage 形态）**（`types/handoff.ts` + `orchestrator/stage-handoff.ts`）：`steps.ts:496-499 recordHandoff()` 把 implementation→review 的交接（summary / decisions / risks / openQuestions / producedArtifacts，并用 `parentSessionId` 串联）记录下来。这是"bounded handoff"而非自由群聊——交接结果回到主 graph，由 gate/coordinator 决定是否采用，**不能直接改 run status**。
- **防自证的 Completion Report**（`apps/api/src/reports.ts`）：Completion / Retro / Knowledge Candidate 全部从 SQLite 持久化证据拼装 markdown + JSON sidecar，引用每个 Artifact / Gate / CommandRun，不接受 Agent 自报完成。Evidence Gate 消费这些 digest 证据做判定。

### 支柱六：Eval Harness —— 确定性回归

`scripts/eval-harness.ts`（约 1900 行）把评测做成 deterministic、无需外部 CLI 的回归框架，对应改进方案 §6.7 / Phase 6，已落地 **5 类 scenario**：

| scenario kind | 断言什么 |
|---|---|
| `router_recommendation` | Coordinator/router 推荐的 flowId / startStage / 相关知识 / 命中规则 |
| `agent_backend_fixture` | 用 **fake backend** 跑 `invokeSkill`：session 起止、final status、AgentResult 关联、context_request 捕获、`backendCalls`、是否动用外部 CLI |
| `context_pack_fixture` | 真实 context builder：manifest refs、source refs、敏感源排除、section 模式、retrieval hint / calibration 数量 |
| `workflow_fixture` | 把证据种进 eval SQLite，调真实 Evidence Gate：gate status、digest-backed commands、completion/retro sidecar |
| `graph_runtime_fixture` | 真实 flow→graph adapter + resume helper：线性等价、失败节点 resume 建新 attempt、已完成节点拒绝 resume、checkpoint 关联 |

落地约束（`eval/scenarios/*` + spec `eval-harness.md`）：

- 默认 `bun run eval` 只跑预期通过的 scenario；**red fixture 放在 `eval/scenarios-red/`**，显式运行时必须失败（防止坏断言悄悄进默认套件）。
- `agent_backend_fixture` 必须用 fake `AgentBackend` + fake API deps，**绝不 spawn Claude Code/Codex**——CI 不会因开发机没装 CLI 而误失败。
- context_request 变体建模有界重试：第一次 backend call 发 `context_request`，第二次成功，断言 `backendCalls: 2`。
- variant 系统支持 `backend: fake / rules_only / claude_code / codex` + `skillVariant / knowledgeVariant`，为 A/B 与后端对比留好了口子。

### 支柱七：Coordinator 分诊（pre-run）

`packages/shared/src/coordinator/`（纯规则 `rules-core.ts`）+ `apps/runner/src/agents/coordinator/`（`rules.ts` / `llm-fallback.ts` / `decision.ts` / `clarification-policy.ts`）实现请求级分诊：Runner watch 认领 pending request 后，若未显式带 `flowId` 则先跑 Coordinator 决定走哪个 flow / 是否需要人工澄清。它是一次 pre-run AgentBackend 调用，**必须 chunk-by-chunk 流到 `request:<id>` 通道**；LLM fallback 解析要能容忍 Skill/session 前言或 markdown 包裹，提取第一个合法 Coordinator JSON，失败则降级为规则 `proceed` 或给用户自然语言澄清问题。

---

## 5. 一次 `invokeSkill()` 的完整生命周期

把上面支柱串起来，一次 Agent 阶段的真实执行轨迹是：

```text
1. ensureContextFoundation       收集 project profile / accepted knowledge / run history
2. buildContextPack(base)        按预算 + 敏感路径策略构造 ContextPack
3. invokeSkillAttempt(idx=0):
     ├─ agentTaskStarted         审计 prompt（注入信任边界）
     ├─ persistContextPackArtifact(base)
     ├─ agentSessionStarted      记 contextPackId / retryIndex / parentSessionId
     ├─ backend.run(...)         spawn claude/codex；stream-json 行级实时 emit AgentEvent
     ├─ parseContextRequest      从 lastMessage / 输出文件解析围栏块
     └─ agentSessionFinished / agentTaskFinished
4. 若有 context_request → invokeSkillAttempt(idx=1, supplement pack)   // 同 step 重试 1 次
     └─ 仍缺事实 → failInvocation + throw（retry limit reached）
5. 命令类工具(build/test) 走 runWhitelistedCommandWithToolInvocation → ToolInvocation 落账
6. recordStepCheckpoint          记录该 step 的输入 / contextPackId / agentSessionId /
                                 toolInvocationIds / gateRunIds / 输出 / resumeCursor
7. Gate Engine 判定(worst())；Workflow Engine 写状态；必要时 awaitHuman 暂停审批
```

每一步都落证据；任何一步失败，平台都能从 checkpoint + session + 证据回放"发生了什么、Agent 为什么这么做"。

---

## 6. 关键不变量（代码持续强制）

1. **Workflow Engine 是唯一状态写者**，状态迁移避免读改写之间 await。
2. **Gate Engine 是唯一 pass/warn/fail 判定者**，Agent note 只展示不影响状态。
3. **Agent / backend 不能直接写平台状态**，Runner 只经事件 ingress 回写。
4. **Build/Test 必须来自真实命令**，带 digest；不接受 LLM 自报。
5. **轨迹/工具/检查点/图状态都是 read/evidence ledger**，绝不能成为第二个状态写者。
6. **Tool invocation 账本只增强审计**，不绕过白名单 / gate / approval。
7. **Multi-agent handoff 不能绕过主 workflow 与 human gate**，结果回主 graph 由 gate 决定采用。
8. **Eval 优先 deterministic + fake backend**，基础回归不依赖外部模型 CLI。
9. **Completion Report 必须基于持久化证据生成**，拒绝自证完成。

---

## 7. 路线图 vs 现状对照

对照 `2026-06-27-agent-orchestration-and-harness-improvement-plan.md` 的 7 个 Phase（该方案写于改进规划时点）：

| Phase | 主题 | 现状 | 代码证据 |
|---|---|---|---|
| Phase 0 | 协议冻结（shared types） | ✅ 完成 | `types/{agent-session,tool-invocation,step-checkpoint,graph-runtime,handoff}.ts` 齐全 |
| Phase 1 | Trajectory Ledger | ✅ 落地 | `AgentSession` + `recordAgentSessionStarted/Finished` + `invokeSkill` 全程记录 |
| Phase 2 | Typed Tool Registry MVP | ✅ 落地（接入运行路径） | `runWhitelistedCommandWithToolInvocation` → `recordToolInvocation`，4 类 kind + digest |
| Phase 3 | Context Request 同步重试 | ✅ 落地 | `invoke-skill.ts:97-132` 有界重试（上限 1 次，backendCalls 2） |
| Phase 4 | Memory Lifecycle | 🟡 演进中 | `KnowledgeArtifact` 有 status/version/subtype/metadata + usage/review signal；完整 semantic/episodic/procedural 分层与 decay/review queue 仍在路上 |
| Phase 5 | Bounded Multi-agent Handoff | 🟡 已落 stage 形态 | `recordHandoff` 已记录 implementation→review 交接；更广的 critic/debug/security 子任务编排可继续扩展 |
| Phase 6 | Harness/Eval 成熟度 | ✅ 落地 | 5 类 scenario + fake backend + `eval/scenarios-red` |
| §6.1 | Durable Agent Run Graph | 🟡 地基可用 | resume + checkpoint + 已完成节点守卫已落；branch/join 拓扑预留（当前线性链） |

> 结论：改进方案里"如果只能先做三件事"（Trajectory Ledger、Context Same-step Retry、Eval Expansion）**已全部完成**；Typed Tool Registry 与 Graph Runtime 地基也已就位。下一步的主要增量在 Memory Lifecycle 的分层与 Graph 的 branch/join 真分叉。

---

## 8. 代码地图（按支柱索引）

| 关注点 | 主要文件 |
|---|---|
| 唯一状态写者 | `apps/api/src/workflow-engine.ts` |
| 唯一门禁判定 | `apps/api/src/gate-engine.ts` |
| 图运行时 / resume | `apps/api/src/graph-runtime.ts`、`packages/shared/src/flows/graph-adapter.ts`、`apps/runner/src/orchestrator/graph-scheduler.ts` |
| 步骤检查点 | `apps/api/src/step-checkpoints.ts`、`packages/shared/src/types/step-checkpoint.ts` |
| 真实 CLI 驯化 | `apps/runner/src/agents/{claude-code,codex,cli-common}.ts`、`*-parser.ts`、`agent-backend-preflight.ts`、`backend-selection.ts` |
| 统一调用边界 | `apps/runner/src/orchestrator/invoke-skill.ts` |
| 阶段实现 / 命令 / handoff 落账 | `apps/runner/src/orchestrator/steps.ts`、`stage-handoff.ts` |
| 上下文工程 | `apps/runner/src/context/{builder,retriever,request,renderer}.ts`、`types/context.ts` |
| 命令证据 + digest | `apps/runner/src/command-runner.ts` |
| 轨迹 / 工具账本类型 | `packages/shared/src/types/{agent-session,tool-invocation,handoff}.ts` |
| 证据汇编 / 报告 | `apps/api/src/reports.ts`、`context-governance.ts` |
| Flow 单一事实来源 | `packages/shared/src/flows/registry.ts` |
| Coordinator 分诊 | `packages/shared/src/coordinator/`、`apps/runner/src/agents/coordinator/` |
| Eval Harness | `scripts/eval-harness.ts`、`eval/scenarios/`、`eval/scenarios-red/` |
| 契约 spec | `.trellis/spec/runner/backend/{agent-backend-runtime,eval-harness,flow-registry,coordinator-clarification}.md`、`.trellis/spec/shared/backend/{context-injection-protocol,evidence-verifier-protocol}.md` |

---

## 9. 已知边界与下一步

- **本地可信模式**：无完整鉴权 / 多租户隔离；项目凭证与本地 runner 控制按本机开发工具看待。
- **SQLite + 单 API 进程**为默认假设；多实例 / 分布式 Runner 需要额外锁与事件一致性。
- **Build/Test 历史默认 Java/Maven**；custom command 已支持但多语言 BuildRun/TestRun 语义未完整。
- **Graph 仍是线性链**：branch/join 真分叉、retry/timeout/compensation policy 是图运行时的下一增量。
- **Memory 仍偏"项目知识 + 当前 run context"**：semantic/episodic/procedural 分层、decay/staleness、promotion review queue 是记忆层的下一增量。
- **ContextPack 是启发式预算系统**：能记录依据与治理指标，但不是完备代码索引或静态分析。

---

## 10. 一段话总结

这个工作台对 Harness 工程的实践，核心不是"让模型更聪明"，而是**把控制权牢牢留在平台**：唯一状态写者 + 唯一门禁判定者把 Agent 关进受控边界；真实 CLI 驯化层用参数、hook 隔离、preflight、stream-json 解析把黑盒 CLI 变成可预期的事件源；统一调用边界 + ContextPack + 同步重试把"上下文"做成可观察、可补充、可审计的运行时；轨迹/工具/检查点/图四本账把"Agent 怎么得出结果"变成可回放证据；Evidence Gate + Completion Report 关掉自证后门；deterministic Eval Harness 让这一切可以无外部模型稳定回归。**模型输出只是众多事件之一，平台拥有状态、工具、记忆、上下文、证据与评测——这就是这里 "Harness 工程" 的全部要义。**
