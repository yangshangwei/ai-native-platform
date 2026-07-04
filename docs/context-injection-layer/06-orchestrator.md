# 编排生命周期 — `apps/runner/src/orchestrator.ts`

## 概述

Orchestrator 是 runner 的顶层骨架，驱动从工作流创建 → worktree 准备 → stage 逐步执行 → 完成清理的完整生命周期。V2 引入了 Graph Scheduler 做 DAG 化执行，但当前 feature.standard 流程仍为线性链。

---

## 主要导出

| 函数 | 职责 |
|------|------|
| `cmdOrchestrate(opts)` | 完整编排入口 |
| `dispatchStep(step, ctx, deps)` | 单点 stage 路由器 |
| `sliceStagesFromStartStage(params)` | 从 startStage 切片 flow stages |
| `agentUserRequestForOrchestrate(opts)` | 从 opts 提取 user request |

---

## `cmdOrchestrate` 生命周期

```
1. sendHeartbeat() → 获取 runner tools 和 id
2. api.getProject(opts.project) → 项目元数据
3. selectAgentBackend(project) → 选择 LLM 后端
4. 创建或恢复 WorkflowRun
5. TrustedLocalWorktreeEnvironment.prepare(run) → 准备 worktree
6. api.workspacePrepared()
7. loadContextPolicy() → maxTokens / reservedFor* / sensitivePathPatterns
8. 构建 RunCtx（全局上下文对象）
9. 查找 FLOW_REGISTRY[run.flowId] → 获取 stages 列表
10. sliceStagesFromStartStage() → 确定要执行的 stages
11. flowToGraphDefinition(flow) → 将 flow 转换为 GraphDefinition
12. api.graphRunStarted() → 创建或恢复 graph run
13. WHILE (未完成的 graph nodes < allowed nodes):
    ├─ nextRunnableGraphNode() → 找下一个可执行节点
    ├─ api.graphNodeStarted()
    ├─ dispatchStep(step, ctx) → 执行 stage
    ├─ latestStepEvidenceForStage() → 收集 step/checkpoint 证据
    └─ api.graphNodeFinished(status=passed/failed)
14. FINALLY:
    ├─ api.workflowCompleted(ok)
    └─ env.cleanup(workspace) 或保留 worktree
```

---

## `RunCtx` — 运行时上下文

```typescript
interface RunCtx {
  project: Project;
  run: WorkflowRun;
  workspace: { path, branch };
  backend: AgentBackend;
  tools: { jdk, maven };
  opts: OrchestrateOpts;
  runArtifactsDir: string;
  inputs: Record<string, string>;          // 累积的 artifact 内容
  inputArtifactIds: Record<string, string>; // 名称→artifactId 映射
  contextFoundation: {                      // 懒加载的基础数据
    projectProfileResult, acceptedKnowledge,
    knowledgeArtifacts, runHistory
  };
  contextPolicy: { budget, sensitivePathPatterns };
  contextRequestChain: ContextRequestCapture[];
  draftsToPromote: PromoteDraftInput[];
  handoffContext: {
    implementationSessionId, implementationArtifactIds
  };
  ok: { value: boolean };
}
```

---

## `dispatchStep` — Stage 路由

| Stage | 调用 |
|-------|------|
| `context_pack` | `runContextPack(ctx)` |
| `requirement` | `runStage(ctx, 'requirement', 'requirement_draft', 'requirement_gate')` |
| `design` | `runStage(ctx, 'design', 'design_doc', 'design_gate')` |
| `implementation` | `executeImplementation(ctx)` |
| `build_test` | `executeBuildTest(ctx)` |
| `review` | `runStage(ctx, 'review', 'other', null)` → `executeVerifier(ctx)` → `executeAcceptance(ctx)` |
| `completion` | `executeCompletion(ctx)` |
| `knowledge` | `executeKnowledgePromotion(ctx)` |
| `report/analyze/scan/plan` | `executeAgentMarkdownStage(stage, ctx)` |
| `init` | throw Error（非可调度 stage） |

---

## Graph Scheduler 集成

- `flowToGraphDefinition(flow)` 将 flow 转换为 `GraphDefinition`（nodes + edges）
- `graphNodeIdsForStages()` 将 stages 映射到 graph node ids
- `nextRunnableGraphNode()` 在 allowed 范围内找满足依赖的下一节点
- `latestNodeRunsByNode()` 追踪每个 node 的最新状态
- `dependencyStateForNode()` 计算上游节点状态（satisfied/blocked）

---

## `sliceStagesFromStartStage`

- startStage 为空 → 返回全部 stages
- startStage 不在 flow 中 → 抛出错误
- startStage 匹配 index N → 返回 `stages.slice(N)` 并打印跳过数

---

## Context Policy 加载

通过 `getConfig()` 读取：
- `context.policy.max_tokens`
- `context.policy.reserved_for_reasoning`
- `context.policy.reserved_for_output`
- `context.policy.sensitive_path_patterns`

---

## 错误处理

- 任何 stage 失败 → `ok.value = false` → 跳出循环
- catch 中记录 error，finally 中调用 `workflowCompleted` + cleanup
- `opts.setExitCode !== false` 时设置 `process.exitCode = 1`
