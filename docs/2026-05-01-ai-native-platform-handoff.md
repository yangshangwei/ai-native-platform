# AI Native 原生开发平台：新仓库开发交接文档

本文用于在新仓库启动 MVP 开发。目标：做一个 **AI 软件交付工作台**，从一句话需求开始，完成需求、设计、AI 开发、本地构建测试、验收、报告和知识沉淀闭环。

## 1. MVP 定位

核心形态：`Web 平台 + Local Runner + Git worktree + Java/Maven 本地构建 + Gate + Report + Knowledge`。

第一版做：Web 工作台、Local Runner、Trusted Local Worktree Mode、Java/Maven compile/test、需求/设计/开发/构建测试/验收流程、平台 SkillSpec + Prompt 注入、Gate Engine、Completion Report、Knowledge Candidate。

第一版不做：Docker Sandbox、Kubernetes Runner、Firecracker/gVisor、多语言完整支持、IDE 插件、复杂多租户、深度 PR/CI 集成。但架构必须预留这些扩展。

## 2. 核心原则

1. 平台编排软件生命周期，不只是调 Agent。
2. Workflow Engine 是唯一状态写入者。
3. Agent 只能建议或执行，不能越权推进状态。
4. Agent 不能自己宣布 Gate 通过。
5. 构建测试以真实命令和报告为准。
6. Skill 属于平台，Codex / Claude Code 只是执行后端。
7. Worktree 是可信本地模式，不是强安全沙箱。
8. 每次交付必须有 Completion Report。
9. 经验先生成 Knowledge Candidate，经确认后入库。

## 3. 业务流程

```text
项目接入
→ Context Pack
→ Requirement Draft + Requirement Gate + Human Confirm
→ Design + Design Gate + Human Approval
→ Implementation Agent + Diff Scope Gate + Sensitive Change Gate
→ Maven Compile/Test + Compile Gate + Test Gate
→ Review + Acceptance Gate + Human Acceptance
→ Completion Report
→ Knowledge Candidate + Human Confirm
```

## 4. 推荐架构

```text
Browser UI
  ↓
Platform Backend
  ├── Workflow Engine / Runtime Resolver / Agent Orchestrator
  ├── Skill Registry / Gate Engine / Artifact Store
  └── Report Service / Knowledge Store / Audit / Approval
        ↓
Local Runner
  ├── Project Registrar / Git Worktree Manager
  ├── Agent Backend Adapter: Native / Codex / Claude Code
  └── Local Command Runner / Maven Runner / Artifact Collector
```

## 5. 新仓库目录建议

```text
ai-native-platform/
  apps/web
  apps/api
  apps/runner
  packages/shared
  packages/workflow-core
  packages/gate-core
  packages/skill-core
  packages/artifact-core
  examples/java-maven-sample
  docs/
```

如果先求速度，也可以只建 `web + api + runner + shared`。

## 6. 核心数据模型

关键实体：`Project`、`WorkflowRun`、`StepRun`、`AgentTask`、`AgentResult`、`Artifact`、`GateRun`、`RuleResult`、`CommandRun`、`BuildRun`、`TestRun`、`CompletionReport`、`KnowledgeCandidate`、`Approval`、`AuditLog`。

所有关键输出都应是 Artifact，并带 `evidenceRefs`。

`WorkflowRun` 至少包含：`id`、`projectId`、`type`、`status`、`currentStage`、`configSnapshotId`。

## 7. Local Runner + Worktree

执行模式：`Trusted Local Worktree Mode`。

每个 WorkflowRun 一个 worktree：

```text
~/.ai-native/worktrees/{projectId}/{runId}/workspace
```

分支：`ai/{runId}-{slug}`。

Runner 职责：注册本地项目路径、校验 git/Maven/JDK、创建和清理 worktree、调用 AgentBackend、执行白名单命令、收集 diff/日志/测试报告、回传 CommandRun/BuildRun/TestRun。

注意：worktree 只隔离代码工作区，不隔离命令、网络、secret、资源。

## 8. 扩展抽象

不要写死 worktree，保留执行环境接口：

```ts
interface ExecutionEnvironment {
  prepare(run: WorkflowRun): Promise<WorkspaceRef>
  runCommand(command: CommandSpec): Promise<CommandRun>
  collectArtifacts(run: WorkflowRun): Promise<ArtifactRef[]>
  cleanup(run: WorkflowRun): Promise<void>
}
```

MVP 实现：`TrustedLocalWorktreeEnvironment`。未来实现：`LocalDockerSandboxEnvironment`、`CloudKubernetesEnvironment`、`MicroVMEnvironment`。

AgentBackend 接口：`run(task, workspace)`、`cancel(taskId)`。MVP 先做 NativeBackend，再接 CodexBackend，ClaudeCodeBackend 可第二阶段。

## 9. Skill 设计

平台维护 Canonical SkillSpec，运行时适配到 AgentBackend。SkillSpec 至少包含：`id`、`version`、`stage`、`instructions`、`inputs`、`outputs`、`toolPolicy`、`requiredGates`、`compatibleBackends`。

MVP 注入方式：`SkillSpec → ResolvedSkillBundle → Prompt 注入`。

后续可生成 Claude Code / Codex 原生 Skill 目录，但平台 SkillSpec 永远是事实源。

## 10. Gate 设计

MVP Gate：Requirement Gate、Design Gate、Diff Scope Gate、Sensitive Change Gate、Compile Gate、Test Gate、Acceptance Gate、Knowledge Gate。

GateRun 至少包含：`id`、`gateId`、`workflowRunId`、`status: pass|warn|fail`、`ruleResults`、`evidenceRefs`。

原则：Agent 可以解释失败，不能宣布通过；Compile/Test Gate 只认真实命令和测试报告。

## 11. Java / Maven 构建测试

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

必须记录 CommandRun：`cwd`、`command`、`exitCode`、`startedAt`、`finishedAt`、`duration`、`stdoutRef`、`stderrRef`、`timedOut`。

必须支持：timeout、max log size、process tree kill、并发限制。

## 12. UI MVP

第一版页面：项目接入页、工作台首页、新建任务页、任务详情页、报告页、配置页。

任务详情三栏：

```text
左：生命周期阶段
中：当前阶段内容
右：Evidence / Gate / Approval
```

只在关键点打扰用户：确认需求、批准设计、批准高风险变更、接受风险、最终验收、确认知识入库。

## 13. 开发里程碑

| 周期 | 目标 |
|---|---|
| 第 1 周 | Web/API/Runner 骨架、基础模型 |
| 第 2 周 | 项目接入、Runner 心跳、Git worktree |
| 第 3 周 | Requirement / Design Artifact + Gate |
| 第 4 周 | Skill 注入、AgentTask、AgentBackend |
| 第 5 周 | Maven compile/test、BuildRun/TestRun |
| 第 6 周 | Acceptance Gate、Completion Report |
| 第 7 周 | Knowledge Candidate、配置中心 MVP |
| 第 8 周 | E2E 打磨、测试、文档、演示项目 |

## 14. 构建测试计划

后端测试：Workflow 状态流转、Runtime Resolver、Skill 解析、Gate 执行、Artifact 存储、Report 生成。

Runner 测试：Git 检测、worktree 创建/删除、命令白名单、CommandRun、timeout、日志截断、进程清理、Surefire/Failsafe 解析。

Gate 测试：每个 Gate 都要有 pass / warn / fail 用例。

E2E 必须跑通：创建任务 → 生成需求草稿 → 用户确认需求 → 生成设计 → 用户批准设计 → Runner 创建 worktree → Agent 修改 Java sample 项目 → `mvn compile` → `mvn test` → Gate 通过 → 用户验收 → Completion Report → Knowledge Candidate。

## 15. MVP 成功标准

稳定跑通：一句话需求 → 结构化需求 → 设计方案 → worktree 中 AI 改代码 → 本地 Maven 编译测试 → Gate 校验 → 人工验收 → Completion Report → Knowledge Candidate。

必须证明：Agent 没有直接推进状态；Gate 来自脚本或真实命令；Build/Test 有日志；Report 引用事实源；Knowledge 有 evidence。

## 16. 主要风险

1. 本地可信模式安全边界弱。
2. 不同开发者本地环境不一致。
3. Maven settings / secret 可能被脚本访问。
4. AgentBackend 适配不稳定。
5. Gate 规则过少时质量不足。
6. UI 暴露太多底层概念会提高门槛。

MVP 必须通过白名单、超时、审计、清晰提示降低风险。

## 17. 新仓库第一天任务

1. 建 monorepo。
2. 定义 shared types。
3. 建 API skeleton。
4. 建 Runner CLI skeleton。
5. 建 Web 任务详情页 skeleton。
6. 放入 sample Java Maven 项目。
7. 手动跑通 worktree + `mvn test`。
8. 再接入 LLM / AgentBackend。
