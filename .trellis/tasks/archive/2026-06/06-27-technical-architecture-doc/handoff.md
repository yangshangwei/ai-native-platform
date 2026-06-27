# Handoff: 技术架构与 Agent Runtime 文档任务

> 生成时间：2026-06-27  
> 当前分支：`feat/context-injection-layer-mvp`  
> 当前任务：`.trellis/tasks/06-27-technical-architecture-doc`

## 1. 当前结论

这个 Trellis 文档任务的用户目标已经完成：已基于当前代码事实输出当前技术架构、上下文管理、Agent 编排与 Harness 改进方案，并把改进方案拆成可执行的需求、架构、研发任务和红黄绿测试文档。

新会话不要从零重新分析。优先读取下面 7 份文档和最近 3 个提交。

## 2. 已交付文档

当前架构与上下文：

- `docs/2026-06-27-current-technical-architecture.md`
- `docs/2026-06-27-context-management-architecture.md`

Agent Runtime / Harness：

- `docs/2026-06-27-agent-orchestration-and-harness-improvement-plan.md`
- `docs/2026-06-27-agent-runtime-requirements.md`
- `docs/2026-06-27-agent-runtime-architecture-design.md`
- `docs/2026-06-27-agent-runtime-development-tasks.md`
- `docs/2026-06-27-agent-runtime-red-green-test-plan.md`

索引：

- `docs/README.md`

## 3. 已提交记录

最近与本任务相关的提交：

- `758e8ef Capture current platform architecture for durable onboarding`
  - 新增当前技术架构文档、上下文管理文档，并更新 docs 索引。
- `8989873 Clarify the next agent runtime architecture`
  - 新增 Agent 编排与 Harness 改进方案。
- `4e1fb8f Split the agent runtime plan into execution documents`
  - 将改进方案拆成需求、架构设计、研发任务、红黄绿测试计划。

## 4. 验证结果

本任务文档变更已验证：

```bash
python3 ./.trellis/scripts/task.py validate .trellis/tasks/06-27-technical-architecture-doc
git diff --check
bun run typecheck
```

验证均已通过。所有变更都是文档/任务说明层，不改业务运行行为。

## 5. 当前工作区注意事项

当前工作区仍有与本任务无关的 Trellis dirty 文件：

```text
 D .trellis/tasks/06-26-align-my-todos-layout/check.jsonl
 D .trellis/tasks/06-26-align-my-todos-layout/implement.jsonl
 D .trellis/tasks/06-26-align-my-todos-layout/prd.md
 D .trellis/tasks/06-26-align-my-todos-layout/task.json
?? .trellis/tasks/06-26-ask-flow-lightweight-ui/
?? .trellis/tasks/06-27-context-flow-panel/
?? .trellis/tasks/archive/2026-06/06-26-align-my-todos-layout/
```

这些不是本轮文档任务产生的改动。新会话不要 revert、删除或纳入本任务提交，除非用户明确要求处理对应任务。

## 6. 下一步建议

### 6.1 先收尾当前文档任务

如果用户只是要完成这轮文档工作，新会话应先执行 Trellis finish 流程，归档 `.trellis/tasks/06-27-technical-architecture-doc`。当前任务 PRD 的验收项已经全部勾选。

建议新会话先做：

1. `git status --short`
2. 确认只剩上面列出的无关 dirty Trellis 文件。
3. 运行 `/trellis:finish-work` 或项目当前可用的 finish-work 等价命令。

### 6.2 再启动实现任务

如果用户希望“继续推进”到实际研发，建议不要继续塞在技术架构文档任务里。应根据 `docs/2026-06-27-agent-runtime-development-tasks.md` 新建实现任务。

推荐第一个实现任务：

```text
06-27-agent-session-trajectory-ledger
```

原因：

- Trajectory Ledger 是 context retry、typed tool registry、handoff、eval replay 的共同基础。
- 不先落 AgentSession，后续工具调用、多智能体和 harness 都缺少统一挂载点。

建议第一阶段只做 Epic A：

- A1 Shared 类型草案。
- A2 API 存储与读模型。
- A3 Runner 写入 AgentSession。

对应红绿灯测试见：

- `docs/2026-06-27-agent-runtime-red-green-test-plan.md`

## 7. 关键边界

后续实现时必须保持：

- Workflow Engine 仍是唯一状态写者。
- Gate Engine 仍是唯一 pass / warn / fail 判定者。
- Agent / backend 不能直接写平台状态。
- Memory 自动沉淀不能直接变 accepted knowledge。
- ToolInvocation 只能增强审计，不能绕过 whitelist / approval。
- Handoff 不能绕过主 workflow 和 human gate。
- Eval harness 基础回归必须优先 deterministic / fake backend。

## 8. 推荐阅读顺序

新会话继续前建议按这个顺序读：

1. `.trellis/tasks/06-27-technical-architecture-doc/prd.md`
2. 本 handoff。
3. `docs/2026-06-27-agent-runtime-requirements.md`
4. `docs/2026-06-27-agent-runtime-architecture-design.md`
5. `docs/2026-06-27-agent-runtime-development-tasks.md`
6. `docs/2026-06-27-agent-runtime-red-green-test-plan.md`
7. 实现前按 Trellis spec 读取对应 package spec。

## 9. 新会话第一句话建议

如果要归档当前文档任务：

```text
继续当前 handoff，先完成 technical-architecture-doc 的 finish-work 归档，不要处理无关 dirty Trellis 文件。
```

如果要进入实现：

```text
继续当前 handoff，基于 Agent Runtime 文档新建并启动 06-27-agent-session-trajectory-ledger，实现 Epic A，不要处理无关 dirty Trellis 文件。
```
