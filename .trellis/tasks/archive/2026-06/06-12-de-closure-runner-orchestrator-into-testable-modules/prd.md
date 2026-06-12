# PRD: runner orchestrator 去闭包化（路线图 T3.1）

## 背景

研究依据：`.trellis/tasks/archive/2026-06/06-11-architecture-review-and-refactor-for-simplicity-and-extensibility/research/runner-architecture.md` §1（职责分解）、§1.3（拆分方案）、§4（测试覆盖映射）。
`apps/runner/src/orchestrator.ts`（当前 1817 行，行号相对报告快照有漂移）的 `cmdOrchestrate` 是约 1100 行的单一函数，内部 ~14 个内嵌闭包共享捕获 `ctx`/`project`/`run`/`inputs`/`inputArtifactIds`/`ok` 等可变量——**内嵌函数零单测**（研究报告 §4 标注的最大风险点也是最大收益点）。文件底部已有被验证的范本：`enforceSensitiveChangeCheckpoint`、`promoteAcceptedDraftToKnowledge` 都是"顶层导出 + deps 注入 + 专测"。本任务把该模式推广到整个编排器。

## 硬性约束

- **行为保持**：所有 stage 的执行顺序、artifact/事件/gate/审批行为逐字段不变。flow-registry.test.ts 锁定 stage 集合；spec `.trellis/spec/runner/backend/flow-registry.md` 的不变式（单点 dispatch、`ctx.ok` boxed boolean、executeXxx 不闭包捕获 run 级状态、禁 `?? 'feature.standard'` 回退）全部保持。
- spec `flow-registry.md` "Bad" 条目明令：**不得**拆掉 `dispatchStep` 单点路由；每个 stage 仍必须流经 dispatchStep。
- 每迁出一个函数必须可独立编译 + 全量测试绿，分小步推进。

## 范围

### 第一阶段：去闭包（核心）
1. 把 `cmdOrchestrate` 内嵌的闭包函数逐个提升为模块顶层函数：`runContextPack`、`runStage`、`invokeSkill`、`captureContextRequest`、`ensureContextFoundation`、`awaitApproval` 及其余 executeXxx 尚在闭包捕获外层变量的部分。
2. 共享可变状态全部经 `RunCtx` 显式传参（RunCtx 已存在且 executeXxx 已接收 `c: RunCtx`；主要工作是消除 `inputs`/`inputArtifactIds` 等裸闭包别名——统一经 `c.` 访问）。外部协作者（api client、backend、skills）经参数或一个 `deps` 对象注入，推广 enforceSensitiveChangeCheckpoint 的既有 deps 模式。
3. `cmdOrchestrate` 收缩为生命周期骨架：建 run → worktree → flow 切片 → for 循环 dispatch → finally 收尾。

### 第二阶段：分文件（按研究报告 §1.3，目标结构可微调但须平铺清晰）
```
orchestrator.ts        # cmdOrchestrate 骨架 + dispatchStep（保持单点路由）+ re-export 兼容面
orchestrator/steps.ts  # executeXxx 各阶段实现
orchestrator/invoke-skill.ts   # invokeSkill + captureContextRequest + ensureContextFoundation
orchestrator/approval.ts       # awaitApproval / waitForApprovalDecision / postRejectionFeedback
orchestrator/verifier-media.ts # 纯函数群（已导出已测试，纯搬移）
```
现有 import 面（index.ts、cmd/watch.ts、测试 6 个文件直接 import orchestrator 导出）通过 orchestrator.ts re-export 保持不破。

### 第三阶段：补测试（去闭包的意义所在）
为新提升的函数补**注入式单测**（模式参照 apps/runner/test/sensitive-checkpoint.test.ts / promote-to-knowledge.test.ts）：至少覆盖
- `runStage`：gate 通过/失败/审批拒绝三条路径
- `invokeSkill`：正常产出与 context_request 捕获路径
- `dispatchStep`：每个 stage 路由到正确实现（用 spy deps）
- `executeAgentMarkdownStage`（首轮重构已合并的四合一函数）

## 不做

- executeBuildTest 的 Maven 硬编码（T3.2，行为变化）
- context/builder.ts 拆分（独立项）
- 任何 stage 语义调整

## 验收标准

1. `bun run typecheck`、`bun x --bun vitest run` 全绿（632 + 新增 ≥8 个单测）
2. flow-registry.test.ts 等既有 runner 测试零改动（行为锁）
3. `scripts/smoke.ts`（native backend 冒烟）跑通一次端到端 run（如环境可行；不可行则在汇报中说明并以测试为准）
4. cmdOrchestrate 主体 ≤ 250 行；闭包捕获 run 级可变状态的内嵌函数清零
