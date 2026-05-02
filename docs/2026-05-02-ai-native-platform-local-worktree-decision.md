# 决策：开发期采用本地编译环境 + Git worktree，不追求沙箱级强制

日期：2026-05-02  
状态：active  
类型：architecture / constraint

## 决策结论

AI Native Platform 的当前开发执行模式固定为：

```text
Local Runner + Git worktree + 本机 JDK/Maven/Git 编译测试环境
```

不把 Docker/K8s/microVM/sandbox 级隔离作为当前目标，也不把 Tool Policy 做成沙箱级强制边界。平台只需要在开发期为每个 `WorkflowRun` 创建独立 git worktree，并在这个 worktree 中调用 AgentBackend、收集 diff、执行本机 compile/test 命令。

## 为什么这样选

1. **目标是贴近真实开发环境**  
   Java/Maven 项目常依赖本机 JDK、Maven cache、`settings.xml`、公司内网、证书和本地工具链。开发期使用本地环境比容器沙箱更符合实际。

2. **worktree 已满足 MVP 的隔离需求**  
   每个任务独立分支和独立工作目录，便于并行、回滚、保留/清理现场，也能避免直接污染用户当前 checkout。

3. **质量边界由 Gate 和真实命令保证**  
   是否通过由 `CommandRun`、`BuildRun`、`TestRun`、`GateRun` 和人工审批决定，不依赖 Agent 自报，也不依赖沙箱安全承诺。

4. **降低实现复杂度**  
   沙箱级强制会引入文件系统、网络、secret、cache、性能、调试体验等额外复杂度；当前阶段不需要承担这些成本。

## 明确不做

- 不要求 Docker / Kubernetes / microVM 沙箱。
- 不要求 Tool Policy 成为强安全边界。
- 不追求隔离命令、网络、用户目录、secret 或系统资源。
- 不把 Codex/Claude 后端自身的 permission/sandbox 选项视为平台安全保证；它们最多是 backend 运行提示或便利约束。

## 仍然保留的控制点

- Agent 修改必须发生在当前 workflow 的 worktree 中。
- Runner 负责捕获 `git diff` / `git diff --name-only`。
- Runner 使用本机 `./mvnw` 或 `mvn` 执行 compile/test。
- Compile/Test Gate 只认真实命令结果和测试报告。
- Diff Scope / Sensitive Change / Requirement / Design / Acceptance Gate 继续保留为质量与审计控制。
- 人工审批仍用于需求、设计、验收、知识入库等关键边界。

## 对后续开发的影响

- 文档中出现 “sandbox build/test” 时，应理解为历史表述；当前准确说法是 “local worktree build/test”。
- 未来如果要增加 Docker/K8s/microVM，只能作为可选 ExecutionEnvironment，不应阻塞当前 MVP。
- 不要把“Tool Policy 完整强制隔离”列为近期推进项；近期应优先加固本地 worktree 流程、CodexBackend 可用性、traceability 和 UI。

## 相关文档

- `README.md`
- `docs/2026-05-02-ai-native-platform-handoff-2.md`
- `docs/2026-05-01-ai-native-platform-local-runner-worktree-notes.md`
- `docs/2026-05-01-ai-native-platform-local-runner-worktree-implementation.md`
