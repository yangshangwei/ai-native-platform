# Agent Runtime 与 Harness 红黄绿测试计划

> 日期：2026-06-27  
> 来源：由 `2026-06-27-agent-orchestration-and-harness-improvement-plan.md` 拆分。  
> 性质：测试策略，定义红灯负例、黄灯降级和绿灯正例。

## 1. 测试原则

- 红灯：必须阻断、失败或拒绝采用。
- 黄灯：允许继续，但必须产生 warning / review signal / degraded status。
- 绿灯：满足证据链，允许进入下一阶段。
- 基础回归优先 deterministic / fake backend，不依赖真实 Claude Code 或 Codex。

## 2. 覆盖矩阵

| 能力 | 红灯 | 黄灯 | 绿灯 |
|---|---|---|---|
| Trajectory Ledger | 新 run Agent 成功但无 session | 旧 run 无 session | 每次 invocation 有 session |
| Context Retry | 重复 request 无限循环 | supplement 缺足够事实 | supplement 后同 step 成功 |
| Tool Registry | 未授权 command 执行 | custom test 无结构化报告 | whitelisted command 有 invocation + digest |
| Memory Lifecycle | stale/conflict memory full 注入 | possibly_stale 只 summary | accepted/current memory 被选中 |
| Handoff | child agent 直接改 run status | child 输出未被 adopt | handoff 输出进入 gate/report |
| Eval Harness | scenario 失败但 exit 0 | scenario 无 expectations | JSON/HTML 报告且失败 exit 1 |
| Evidence Gate | pass gate 无证据 | 旧 artifact 无 digest | compile/test 有 digest evidence |

## 3. Trajectory Ledger

红灯：

- Fake backend 返回成功结果，但 Runner 未写 AgentSession。
- 失败 invocation 被误标 success。

黄灯：

- 历史 run 没有 AgentSession 时，API 返回空列表并标记 legacy / unavailable，不崩溃。

绿灯：

- requirement/design/implementation 任一 agent step 成功后可查询 AgentSession。
- session 关联 AgentTask、AgentResult、ContextPack、output artifact。
- retry session 通过 parentSessionId 指回 base session。

## 4. Context Request Same-step Retry

红灯：

- fake backend 连续输出相同 `context_request` 超过 retry limit，Runner 停止 retry。
- context_request 只请求 `.env`、private key 或其他敏感路径，过滤后不 retry。

黄灯：

- request 合法但 supplement 找不到足够上下文，输出 blocked / human-needed 摘要，不伪造事实。

绿灯：

- 第一次 fake backend 输出 context_request，第二次收到 supplement 后输出 artifact。
- 两个 AgentSession 都存在，第二个 parentSessionId 指向第一个。
- supplement ContextPack 有 request id、base pack id、retry index。

## 5. Tool Registry

红灯：

- 请求执行非白名单 command，command 不执行，ToolInvocation 为 denied 或没有 CommandRun。
- ToolInvocation 声称 command 成功但缺 CommandRun / digest evidence，Evidence Gate fail。

黄灯：

- custom test command exit 0，但无 surefire 报告，test gate warn，ToolInvocation 仍记录 command evidence。

绿灯：

- compile/test command exit 0 且有 digest-backed CommandRun。
- ToolInvocation success，Compile/Test Gate pass，Evidence Gate pass。
- diff capture ToolInvocation 指向 diff artifact 和 changed-files。

## 6. Memory Lifecycle

红灯：

- `reviewStatus=conflict` 的 accepted KnowledgeArtifact 被 full authoritative 注入。
- 跨项目 KnowledgeArtifact 出现在 ContextManifest。

黄灯：

- `freshness=possibly_stale` 的 memory 只作为 summary / evidence，不作为 source-level authoritative fact。

绿灯：

- accepted/current/confirmed memory 与任务关键词匹配时进入 ContextManifest。
- manifest 记录 sourceRefs、trustLevel、freshness、score。
- usage metadata 更新 hitCount / lastUsedAt。

## 7. Handoff

红灯：

- child reviewer 直接把 WorkflowRun 标记 passed/failed。
- handoff 缺 input artifact refs 或 expected output schema。

黄灯：

- child 输出 artifact 缺 adoption decision，只进入 report，不影响 gate status，并标记 needs_review。

绿灯：

- implementation 后触发 independent review。
- Handoff record、child AgentSession、review artifact 都存在。
- Gate Engine 仍决定最终状态。

## 8. Eval Harness

红灯：

- scenario check 失败但 `bun run eval` exit 0。
- `agent_backend_fixture` 依赖真实 Claude/Codex CLI。

黄灯：

- scenario 没有 expectations，报告 warning，不计入强回归。

绿灯：

- `context_pack_fixture`、`agent_backend_fixture`、`workflow_fixture` 都有 passing variant。
- JSON/HTML 报告写入 `.ainp/evals`。
- failed > 0 时 exit 1。

## 9. Evidence / Report

红灯：

- Completion Report 只引用 Agent summary，没有 artifact/gate/command evidence。
- CommandRun log 文件被篡改，digestVerified=false，Evidence Gate fail 或 report 标红。

黄灯：

- 旧 artifact 没有 digest 字段，读接口显示 missing digest，不崩溃。

绿灯：

- 完整 workflow 有 diff、compile/test command、gate、approval、completion report。
- Evidence Gate pass。
- Completion Report 引用证据链。
- context governance 可解释 context 使用。

## 10. 最小命令

文档阶段：

```bash
python3 ./.trellis/scripts/task.py validate .trellis/tasks/06-27-technical-architecture-doc
git diff --check
bun run typecheck
```

实现阶段：

```bash
bun test packages/shared/test
bun test apps/api/test apps/runner/test
bun run eval
bun run typecheck
```

## 11. 通过标准

- 红灯测试证明错误路径会失败或阻断。
- 黄灯测试证明系统降级但可观察。
- 绿灯测试证明正常路径有完整证据链。
- Eval 报告能定位失败 scenario、variant、check 和 evidence。
