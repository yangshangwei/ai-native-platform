# AC 状态判定的真实形状（主线程实地核查，2026-08-09）

核查动机：P1-1 移交清单声称「web 已在做 R3 想做的事，存在第三套判定，UI 与 runner 会对同一 AC 给出不同结论」。
逐处读代码后**该描述不成立**，任务形状因此改变。本文件记录核查到的事实，PRD 基于此写。

## 四处判定及其生效条件

| # | 判定 | 位置 | 输入 | 生效条件 |
|---|---|---|---|---|
| 1 | `businessAcceptanceStatus` | `apps/runner/src/orchestrator/steps.ts:818-830` | 纯 markdown 文本 + verifier media | **恒定**，写进 matrix |
| 2 | `evaluateBusinessAcceptanceMatrix` | `apps/api/src/gate-engine.ts:1628-1655` | 采信 matrix 的 `businessStatus` | **恒定**，gate 判定 |
| 3 | `acceptanceMatrixChecklist` | `apps/web/src/page-task-detail.ts:2192-2249` | 透传 matrix 的 `businessStatus` | 有 matrix artifact 且内容已加载 |
| 4 | `buildAcceptanceChecklist` | `apps/web/src/projection.ts:1472-1504` | compile/test gate + 真实通过的测试 | **仅 fallback**（`?? ` 右侧） |

调用点：`page-task-detail.ts:2059` 与 `:2524`，两处都是 `acceptanceMatrixChecklist(detail) ?? buildAcceptanceChecklist(...)`。

## 修正点一：web 不是第三套并行判定，而是透传 + 兜底

正常路径下 #3 生效，它只做 `businessStatus` 的字段搬运（`acceptanceRowStatus`，`page-task-detail.ts:2251-2268`），
不引入任何本地判据。所以「UI 与 runner 给出不同结论」不会发生。

matrix artifact 的 `kind` 是 `'other'`（`steps.ts:757`），而 `'other'` 在 `previewKinds` 白名单里
（`apps/web/src/data-loading.ts:145-157`），所以 artifact 一存在就会被预取。#4 的实际触发条件只有两个：

- verifier 阶段没跑（`steps.ts:700`：`!uiVerifierRequired && !hasBusinessCriteria` 直接 return，不产 matrix）
- artifact 内容请求失败（`data-loading.ts:185-186` catch 里 set null）

## 修正点二：真正的问题不是「判定分歧」，是「唯一看执行证据的判定被降级成兜底」

#4 是四处里**唯一**读执行结果的：

```
covered && compileGate=pass && testGate=pass && hasPassingTests  → passed
covered || compileGate=pass || testGate=pass                     → at_risk
否则                                                              → missing
```

（`projection.ts:1493-1502`；`hasPassingTests` = `detail.tests.some(t => t.total > 0 && t.failed === 0 && t.errors === 0)`）

而恒定生效的 #1/#2/#3 全部只看 markdown 文本。#1 的完整判据（`steps.ts:825-829`）：

```
!text || !verificationMethod || isCommandOnlyText(verificationMethod) → missing
uiVerifierRequired && !mediaSatisfied                                  → missing
否则                                                                    → passed
```

**结论**：`at_risk` 悬空与「AC 不看执行证据」是同一个成因的两个表现 —— 会算 `at_risk`
的那套逻辑（#4）恰好也是唯一有执行证据的那套，而它被放在了 `??` 右侧。
P1-1 移交清单的落点（`at_risk` 上收到 gate）方向正确，但理由需要更正。

## 修正点三：`at_risk` 在 gate 侧已有消费方，不是纯悬空

`gate-engine.ts:1643-1646` 有 `risk` 分支，`:862-874` 让 `atRisk.length > 0` 产出 gate `warn`
（规则 `acceptance.business_matrix_criteria_proven`）。测试 `apps/api/test/gate-engine.test.ts:866`
已固定 `['at_risk', 'warn']` 映射。

所以链路是通的，缺的只是**生产端**：`businessAcceptanceStatus` 只返回 `missing`/`passed`。
`failed` 同样无产出方（grep 全仓库，仅类型定义与 parse 白名单出现）。

这也说明 R4 的「二选一：给它产出路径或从类型移除」里，移除是错的 —— gate 侧的 warn 分支与其测试都在，
移除会连带删掉一条已验证的降级语义。正确解法只剩「给它产出路径」，且产出方必须能看到执行证据。

## 修正点四：`RunCtx` 确实拿不到执行证据（P1-1 这条判断成立）

`apps/runner/src/orchestrator/types.ts` 的 `RunCtx` 无 build / test / gate 结果字段。
runner 在 verifier 阶段只有 `c.inputs`（文本）与 `c.inputArtifactIds`。

所以 runner 只能判 `passed`/`missing` 是**正确的分工**，不是缺陷。`at_risk` 的产出方只能是 api gate ——
它有 `store.testRuns` / `store.buildRuns` / 历史 gate。

## `ExecutionContract.expectedOutputs` 现状

- 类型：`packages/shared/src/types/execution-contract.ts:42`
- 唯一消费者：`executionContractOutputConflicts`（同文件 `:247-263`）
- 该函数的调用方：**只有测试**（`packages/shared/test/execution-contract.test.ts`、
  `apps/runner/test/skill-execution-contract.test.ts`），src 里零调用（已 grep 验证）

生产端有写入（`apps/runner/src/skills/index.ts:294,381`），但写完无人读。
函数自身的 doc comment 已诚实写明它只防「两处声明漂移」，不做运行时检查。

判断：这是**一致性校验缺个执行点**，不是死字段。修法应当是把 `executionContractOutputConflicts`
接到 skill 注册/启动路径上（让声明漂移在开发期就爆），而不是删字段。

## 供 PRD 使用的落点清单

1. `businessAcceptanceStatus` 保持只产 `passed`/`missing`（分工正确，不改）
2. api gate 新增执行证据判据，把文档级 `passed` 降级为 `at_risk`（消费已有的 warn 分支）
3. `failed` 的产出路径需一并决定（当前同样悬空）
4. web `buildAcceptanceChecklist` 的执行证据判据上收到 gate 后，web 侧改为纯透传
5. `AcceptanceChecklistItem['status']`（`projection.ts:1219` 内联字面量）与 shared
   `AcceptanceBusinessStatus`（`artifact.ts:310`）合并
6. `executionContractOutputConflicts` 接上真实调用方
