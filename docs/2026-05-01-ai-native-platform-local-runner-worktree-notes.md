# AI Native 云开发平台：Local Runner 与 Git Worktree MVP 方案
本文记录开发阶段执行环境的 MVP 决策：优先采用 Local Runner + Git worktree 的本地可信模式，后续预留 Docker / Cloud Sandbox 扩展。
## 1. 决策结论
第一版采用：
```text
Trusted Local Worktree Mode
```
含义：
- Local Runner 运行在用户本地机器。
- 每个 WorkflowRun 创建一个独立 git worktree。
- Agent 在该 worktree 中修改代码。
- Maven compile/test 使用本机 Java / Maven 环境执行。
- 平台记录 diff、命令、日志、测试报告、GateRun。
这个方案适合 MVP，因为它：
- 门槛低，不要求用户先配置 Docker / K8s。
- 更贴近真实本地开发环境。
- 兼容本地 Maven settings、公司内网、本地证书。
- 不污染用户当前 IDE 工作区。
- 易于快速跑通 AI Native 生命周期闭环。
但它不是强安全沙箱。
## 2. Worktree 解决什么，不解决什么
Git worktree 解决：
```text
代码工作区隔离
分支隔离
diff 可追踪
可回滚
不污染用户当前目录
支持并行任务
```
Git worktree 不解决：
```text
命令执行安全
网络隔离
secret 隔离
资源隔离
恶意脚本防护
```
因此它应被明确标记为：
```text
可信本地开发模式
```
不能包装成“安全沙箱”。
## 3. MVP 架构

```text
Web Platform
  ↓
Local Runner
  ↓
Git Worktree Workspace
  ↓
Agent Backend
  ├── Codex
  ├── Claude Code
  └── Native Agent
  ↓
Local Command Runner
  ├── ./mvnw compile
  ├── ./mvnw test
  └── git diff/status
```

Web Platform 负责：

- Workflow。
- AgentTask。
- Skill。
- Gate。
- Artifact。
- Report。
- Knowledge。
- Approval。
- Audit。

Local Runner 负责：

- 注册本地项目。
- 创建 worktree。
- 调用 AgentBackend。
- 执行本地命令。
- 收集 diff、日志、测试报告。
- 回传结果。
- 清理 worktree。

## 4. 项目注册

用户在 Web 平台添加项目，并由 Local Runner 绑定本地路径。

示例配置：

```yaml
projectId: order-service
repoPath: /Users/you/code/order-service
defaultBranch: main
buildTool: maven
jdk: 17
agentBackend: codex
executionMode: trusted-local-worktree
```

Runner 校验：

```bash
git rev-parse --show-toplevel
git status --short
git remote -v
./mvnw -v || mvn -v
```

## 5. 每个任务一个 worktree

目录建议：

```text
~/.ai-native/worktrees/{projectId}/{runId}/workspace
```

分支命名：

```text
ai/{runId}-{slug}
```

示例：

```text
ai/run-123-export-csv
```

创建逻辑：

```bash
git fetch
git worktree add \
  ~/.ai-native/worktrees/order-service/run-123/workspace \
  -b ai/run-123-export-csv \
  origin/main
```

如果基于当前分支：

```bash
git worktree add \
  ~/.ai-native/worktrees/order-service/run-123/workspace \
  -b ai/run-123-export-csv \
  HEAD
```

必须记录：

```yaml
baseBranch: main
baseCommit: abc123
worktreePath: ~/.ai-native/worktrees/order-service/run-123/workspace
agentBranch: ai/run-123-export-csv
```

## 6. AgentBackend 调用

平台下发 `AgentTask`，Runner 在 worktree 中调用对应 AgentBackend。

示例：

```yaml
taskId: task-789
runId: run-123
stage: implementation
agent: ImplementationAgent
backend: codex
workspace: ~/.ai-native/worktrees/order-service/run-123/workspace
resolvedSkills:
  - implementation-java-maven@1.0.0
  - diff-discipline@1.0.0
inputs:
  - requirement
  - design
  - context_pack
```

Runner 可适配：

```text
CodexBackend
ClaudeCodeBackend
NativeAgentBackend
```

Skill 注入仍走平台标准：

```text
SkillSpec → ResolvedSkillBundle → BackendAdapter → Prompt / Runtime Skill
```

## 7. 本地命令执行

即使是本地可信模式，也不要开放任意 shell。

第一版命令白名单：

```text
git status
git diff
git diff --name-only
./mvnw -B -DskipTests compile
./mvnw -B test
mvn -B -DskipTests compile
mvn -B test
```

所有命令必须记录为 `CommandRun`：

```yaml
commandRunId: cmd-123
cwd: ~/.ai-native/worktrees/order-service/run-123/workspace
command: ./mvnw -B test
startedAt: 2026-05-01T10:00:00Z
finishedAt: 2026-05-01T10:02:00Z
exitCode: 0
durationMs: 120000
stdoutRef: artifact://logs/cmd-123-stdout.log
stderrRef: artifact://logs/cmd-123-stderr.log
```

本地命令也必须有：

- timeout。
- max log size。
- process tree kill。
- 并发限制。

## 8. 结果收集

Runner 回传：

- git diff。
- changed files。
- build logs。
- Surefire / Failsafe reports。
- test summary。
- command exit codes。
- agent output。

平台生成：

```text
Artifact
BuildRun
TestRun
GateRun
Completion Report
Knowledge Candidate
```

## 9. Workflow 中的位置

开发阶段流程：

```text
Implementation Step
  ↓
Runner.prepare()
  ↓
创建 worktree
  ↓
AgentBackend.run()
  ↓
收集 diff
  ↓
Diff Scope Gate
  ↓
CommandRunner.run(compile)
  ↓
Compile Gate
  ↓
CommandRunner.run(test)
  ↓
Test Gate
  ↓
Review / Acceptance
```

失败时：

```text
Test Gate failed
  ↓
Debug Agent 分析 CommandRun 日志
  ↓
Implementation Agent 修复
  ↓
重新 compile/test
```

---

续篇：`2026-05-01-ai-native-platform-local-runner-worktree-implementation.md`。
