# AI Native 云开发平台：Local Runner 与 Git Worktree 实现补充

本文承接 `2026-05-01-ai-native-platform-local-runner-worktree-notes.md`，记录 UI 呈现、架构扩展点、MVP 清单、风险约束和最终方案表述。

## 10. UI 呈现

任务页顶部应展示：

```text
Execution Mode: Trusted Local Worktree
Runner: Online
Workspace: ~/.ai-native/worktrees/order-service/run-123/workspace
Branch: ai/run-123-export-csv
Build: Local Maven
Security: 本地可信模式，不隔离网络和用户目录
```

可提供操作：

```text
[打开 worktree]
[查看 diff]
[运行测试]
[清理 worktree]
[切换到 Docker Sandbox（未来）]
```

高风险命令必须弹确认：

```text
Agent 请求执行未在白名单中的命令：
./scripts/reset-db.sh

风险：
- 可能修改本地数据库
- 可能删除测试数据

[拒绝]
[允许一次]
```

## 11. 架构扩展点

不要把 Runner 写死成 worktree。

统一抽象：

```ts
interface ExecutionEnvironment {
  prepare(run: WorkflowRun): Promise<WorkspaceRef>
  runCommand(command: CommandSpec): Promise<CommandRun>
  collectArtifacts(run: WorkflowRun): Promise<ArtifactRef[]>
  cleanup(run: WorkflowRun): Promise<void>
}
```

MVP 实现：

```text
TrustedLocalWorktreeEnvironment
```

未来实现：

```text
LocalDockerSandboxEnvironment
CloudKubernetesEnvironment
MicroVMEnvironment
```

AgentBackend 单独抽象：

```ts
interface AgentBackend {
  run(task: AgentTask, workspace: WorkspaceRef): Promise<AgentResult>
  cancel(taskId: string): Promise<void>
}
```

边界：

```text
ExecutionEnvironment 管 workspace 和命令环境
AgentBackend 管 AI 执行器
GateEngine 管结果判断
```

## 12. MVP 最小功能清单

Local Runner：

- 注册项目本地路径。
- 检查 git 仓库。
- 创建 / 删除 worktree。
- 运行 Codex 或 Claude Code backend。
- 执行 Maven compile/test。
- 收集 git diff。
- 收集 Surefire / Failsafe reports。
- 上传日志和结果。

Web Platform：

- 创建任务。
- 下发 AgentTask。
- 显示 worktree 状态。
- 显示 diff。
- 显示 BuildRun / TestRun。
- 显示 Gate 结果。
- 生成人工审批点。
- 生成 Completion Report。

Gate：

- Requirement Gate。
- Design Gate。
- Diff Scope Gate。
- Compile Gate。
- Test Gate。
- Acceptance Gate。

## 13. 风险与约束

必须接受的风险：

1. 本地环境不一致。
2. 安全边界弱。
3. Secret 暴露风险。
4. 命令失控风险。
5. 资源失控风险。

MVP 必须至少具备：

```text
命令白名单
超时控制
日志大小限制
进程树清理
清晰的 Trusted Local Mode 提示
审批和审计记录
```

## 14. 最终方案表述

第一版采用 `Trusted Local Worktree Mode`。

Local Runner 在用户本地为每个 WorkflowRun 创建独立 git worktree，所有 Agent 修改、Maven 编译、测试执行都发生在该 worktree 中。

该模式优先保证：

- 低门槛。
- 真实本地环境兼容。
- 快速 MVP 闭环。
- 不污染用户当前工作区。

同时平台抽象 `ExecutionEnvironment`，后续可扩展为 Docker Sandbox、Cloud Kubernetes Sandbox 或 MicroVM Sandbox。

该模式不作为强安全沙箱，仅作为可信本地开发模式，必须通过命令白名单、超时、日志限制、审批和审计降低风险。
