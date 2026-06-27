# Agent Runtime 与 Harness 研发任务拆解

> 日期：2026-06-27  
> 来源：由 `2026-06-27-agent-orchestration-and-harness-improvement-plan.md` 拆分。  
> 性质：详细研发任务清单，用于 Trellis task / issue 拆分。

## 0. 执行原则

- 先加账本和读模型，再改编排行为。
- 先做 fake backend / deterministic eval，再接真实模型。
- 先纳入 Runner-owned tools，再适配 backend 原生 tool call。
- Workflow Engine / Gate Engine 继续保持权威边界。
- 每个任务必须至少有一个红灯负例和一个绿灯正例。

## 1. Epic A - Agent Session / Trajectory Ledger

| ID | 任务 | 主要文件 | 验收 |
|---|---|---|---|
| A1 | 定义 `AgentSession`、`AgentSessionStatus`、`AgentSessionLink`，支持普通 invocation、retry invocation、handoff child invocation。 | `packages/shared/src/types/agent.ts` 或新 shared type 文件；shared export；shared tests | 类型能表达 parentSessionId、retryIndex、contextPackId、skillVersion；`bun test packages/shared/test` 通过。 |
| A2 | 新增 API 存储和读模型，按 workflowRunId 查询 session 列表。 | `apps/api/src/store/db.ts`、`apps/api/src/store/store.ts`、workflow-runs route 或新 route | 旧数据库迁移不破坏；缺 AgentSession 的旧 run 返回空列表。 |
| A3 | Runner 在 `invokeSkill()` 创建 session，成功/失败路径更新 status，并关联 AgentTask / AgentResult / ContextPack。 | `apps/runner/src/orchestrator/invoke-skill.ts`、`apps/runner/src/api-client.ts`、API runner events | 成功 step 有 success session；失败 step 有 failed session；session 能查 contextPackId。 |

红灯测试：

- 新 run 的 AgentTask 成功但没有 AgentSession，完整性检查失败。
- 失败 invocation 被误标 success，session status 检查失败。

绿灯测试：

- requirement/design/implementation 任一 agent step 产生可查询 AgentSession。
- retry session 能通过 parentSessionId 指回 base session。

## 2. Epic B - Typed Tool Registry MVP

| ID | 任务 | 主要文件 | 验收 |
|---|---|---|---|
| B1 | 定义 ToolSpec / ToolInvocation 类型、status、sideEffect、permission tier、argument digest。 | shared types、shared guards | 未知 tool / status 在 trust boundary 被拒绝或忽略。 |
| B2 | `runWhitelistedCommand()` 生成 ToolInvocation，指向 CommandRun id 和 digest。 | `apps/runner/src/command-runner.ts`、`apps/runner/src/orchestrator/steps.ts`、API command ingress | compile/test command 都可追到 ToolInvocation；command whitelist 仍是硬门禁。 |
| B3 | implementation diff / changed-files 捕获为 `runner.git_diff_capture`。 | `apps/runner/src/orchestrator/steps.ts`、AgentBackend output capture path | diff artifact 和 changed files path 可从 ToolInvocation 追溯。 |
| B4 | API/Web 提供 workflow run tool invocations 读模型和折叠展示。 | API routes/read model、`apps/web/src/page-task-detail.ts` | Web 可看到 command/diff 工具调用状态、耗时和证据引用。 |

红灯测试：

- 非白名单 command 被请求时不执行，ToolInvocation 为 denied 或没有 CommandRun。
- ToolInvocation 声称成功但缺 CommandRun / digest evidence，Evidence Gate fail。

绿灯测试：

- compile/test command exit 0，ToolInvocation success，Compile/Test/Evidence Gate pass。
- diff capture ToolInvocation 指向 diff artifact 和 changed-files。

## 3. Epic C - Context Request Same-step Retry

| ID | 任务 | 主要文件 | 验收 |
|---|---|---|---|
| C1 | 定义 retry policy 和 supplement retry metadata。 | context shared type、context builder | supplement pack 能表达 base pack、request id、retry index。 |
| C2 | `captureContextRequest()` 后在同一 skill 内 bounded retry，第二次 invocation 使用 parentSessionId。 | `apps/runner/src/orchestrator/invoke-skill.ts`、context builder supplement | fake backend 第一次输出 context_request，第二次成功；两次 invocation 都有 session。 |
| C3 | 防循环和失败路径：重复 request 不无限 retry，敏感路径过滤后不 retry。 | context request parser、invoke-skill retry loop | 重复 context_request 触发红灯；敏感路径 request 被过滤并记录 warning。 |

红灯测试：

- fake backend 连续输出同一 context_request 超过 retry limit，Runner 停止 retry。
- context_request 只请求 `.env` / private key，过滤后不 retry。

绿灯测试：

- 第一次 invocation 输出 context_request，第二次收到 supplement 后产出目标 artifact。
- retry chain 能在 trajectory 中查到 base/supplement/session 关系。

## 4. Epic D - Memory Lifecycle

| ID | 任务 | 主要文件 | 验收 |
|---|---|---|---|
| D1 | 定义 semantic / episodic / procedural memory metadata normalizer。 | `packages/shared/src/types/knowledge-entity.ts`、shared utils | 缺字段历史 knowledge 有安全默认值。 |
| D2 | Context selection 使用 lifecycle：stale/conflict/superseded 不作为 authoritative context。 | `apps/runner/src/context/builder.ts`、`apps/runner/src/context/retriever.ts` | stale memory 不能 full 注入；current accepted memory 可被 manifest 选中。 |
| D3 | Review Queue 草案：calibration signal / retro finding 只生成 review candidate，不自动 accepted。 | API knowledge routes、reports/retro、context governance | conflict signal 产生 review item，但不修改 accepted knowledge。 |

红灯测试：

- `reviewStatus=conflict` 的 accepted KnowledgeArtifact 被 full 注入，测试失败。
- 跨项目 KnowledgeArtifact 出现在 manifest，测试失败。

绿灯测试：

- accepted/current/confirmed memory 与任务匹配时进入 ContextManifest。
- usage metadata 更新 hitCount / lastUsedAt。

## 5. Epic E - Bounded Multi-agent Handoff

| ID | 任务 | 主要文件 | 验收 |
|---|---|---|---|
| E1 | 定义 Handoff record，记录 from/to role、reason、input refs、expected output、status。 | shared handoff type、API store/read route | Handoff 可关联 parent AgentSession 和 child AgentSession。 |
| E2 | implementation 后支持 independent reviewer handoff，输出 review artifact。 | Runner review orchestration、AgentSession、report read model | reviewer 发现问题只进入 report/gate evidence；Gate Engine 仍决定 pass/fail。 |
| E3 | build/test fail 后支持 debugger handoff，输出 root cause / fix recommendation artifact。 | Runner failure path、debug skill、report sidecar | debugger 不直接改代码，除非主 workflow 显式进入修复 step。 |

红灯测试：

- child reviewer 直接改 WorkflowRun status，API 拒绝或测试失败。
- handoff 缺 input artifact refs 或 expected output schema，创建失败。

绿灯测试：

- independent review handoff 产生 child AgentSession、review artifact 和 report evidence。
- debugger handoff 输出分析 artifact，但不绕过主 workflow。

## 6. Epic F - Eval Harness Expansion

| ID | 任务 | 主要文件 | 验收 |
|---|---|---|---|
| F1 | 新增 `context_pack_fixture`，固定 project profile、knowledge、input artifacts，断言 manifest/sourceRefs/degradation。 | `scripts/eval-harness.ts`、`eval/scenarios/*` | stale knowledge 不入 authoritative context；budget 降级稳定。 |
| F2 | 新增 `agent_backend_fixture`，fake backend 输出 artifact / context_request，回归 invokeSkill、retry loop、AgentSession。 | eval harness、runner test fixture | 无外部 CLI 也能测 Agent runtime。 |
| F3 | 新增 `workflow_fixture`，回放 StepRun、GateRun、CommandRun、Artifact，断言 Evidence Gate、Completion Report、Retro。 | eval harness、API fixtures | tampered digest 红灯；完整证据链绿灯。 |
| F4 | 扩展 Eval 报告，JSON/HTML 展示 scenario kind、variant、checks、evidence，失败时 exit 1。 | `scripts/eval-harness.ts` | `bun run eval` 输出可读报告并在失败时 exit 1。 |

红灯测试：

- scenario check 失败但 `bun run eval` exit 0，测试失败。
- `agent_backend_fixture` 依赖真实 Claude/Codex CLI，测试失败。

绿灯测试：

- router/context/agent/workflow 四类 scenario 均有 passing variant。
- JSON/HTML 报告能定位 scenario、variant、check 和 evidence。

## 7. 推荐执行顺序

1. A1-A3：先拿到 AgentSession 主线。
2. F2：立刻用 fake backend 锁住 AgentSession 行为。
3. C1-C3：实现 context same-step retry。
4. F1/F3/F4：扩展 eval 覆盖。
5. B1-B4：工具调用账本。
6. D1-D3：记忆生命周期。
7. E1-E3：bounded handoff。

## 8. 每个任务的完成标准

- 有 shared type 或接口说明。
- 有 API / Runner / Web 边界说明。
- 有红灯和绿灯测试。
- 有迁移/兼容说明。
- 有 docs/spec 更新。
- `bun run typecheck` 通过。
