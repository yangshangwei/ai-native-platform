# Operational Unavailable State（运维不可用第四态 / operational pause）

## Goal

当前任何异常（CLI 崩溃、LLM 超时、协议解析失败）都走同一条路：`ok=false → workflowCompleted(ok=false) → run.status='failed'`，watch 再把 request 标 `failed`。**运维故障被记成业务失败**，污染审计与后续知识沉淀，且 worktree 被清理导致无法原地恢复。借鉴 UMA-DV UD-FLOW-007 第 4 条：运维不可用是 typed 状态而非业务结论——run 停在可恢复的 `paused`，不渲染完成、不自动重试、不触发源码修复；人工触发恢复且已完成 stage 不重放。

## What I already know（仓库事实）

* 失败汇聚点：`apps/runner/src/orchestrator.ts:299-313` —— catch 全部异常 → `ok.value=false`；`finally` **无条件** `api.workflowCompleted({ok})` + 默认 `env.cleanup(workspace)`；`!ok` 时 `process.exitCode=1`。
* `completeWorkflowRun(id, ok)`（`apps/api/src/workflow-engine.ts:532`）只有二值：`passed`/`failed`。
* watch（`apps/runner/src/cmd/watch.ts:98-110`）：orchestrate 正常返回按 `result.ok` 定 request `completed`/`failed`；抛错 → request `failed`。
* 恢复基建已存在：`POST /runner/control/retry-run`（spawn orchestrate `--workflow-run-id` + `--start-stage`）、`retryStage()`（step 重置 pending；仅 cancelled 拒绝）、`resumeGraphStage`、step-checkpoints。**已完成 stage 天然不重放**（start-stage 切片）。
* agent 调用链：`invoke-skill.ts` catch 后原样 rethrow（agentTask/session 已标 failed）；backend 超时在 `claude-code.ts:243-262` / `codex.ts:189-201`（hard timeout kill）；preflight 在 `apps/runner/src/agent-backend-preflight.ts`。
* `WorkflowRunStatus`（`packages/shared/src/types/workflow.ts:58`）：`pending|running|awaiting_human|passed|failed|cancelled`。`WorkflowRequestStatus`：`pending|awaiting_clarification|claimed|completed|failed|cancelled`。
* graph 节点：orchestrator catch 内 `graphNodeFinished(status:'failed', metadata.error)`；`retry-step` 路由已串 `resumeGraphStage + retryStage`。

## Requirements

* R1 **错误分类学**：shared 新增 `OperationalError`（`reason: 'backend_unavailable' | 'backend_timeout' | 'backend_protocol'` + detail），带类型守卫。业务失败（gate fail、compile/test fail、diff 越界）**不属于**该类。
* R2 **抛出点**：backend preflight 失败（CLI 缺失/未登录）→ `backend_unavailable`；hard timeout kill → `backend_timeout`；spawn 失败、CLI 退出但无可解析 result、必需 outputs 缺失（如 `implementation: missing diff outputs`）→ `backend_protocol`。
* R3 **暂停语义**：orchestrator catch 判定 `isOperationalError` → 上报新事件 `POST /runner/events/workflow-paused {workflowRunId, stage, reason, detail}` → engine `pauseWorkflowRun`：run.status=`paused`（WorkflowRunStatus 新值）、audit `workflow_run.paused`（metadata 含 reason/detail/stage/worktree HEAD）、联动 request（该 run 对应 request 若 `claimed` → `paused`，WorkflowRequestStatus 新值）。
* R4 **不销毁现场**：operational pause 时跳过 `workflowCompleted` 上报与 worktree cleanup（保留恢复现场）；orchestrate 进程 exit code 0（pause 不是进程失败）；watch 检测 paused 结果后**不再** complete request（engine 已联动）。
* R5 **不自动重试**：pause 后平台不自发起任何重试循环；恢复只能由人工从 Web 触发。
* R6 **恢复路径**：复用 `retry-run`。约束：`retryStage` 对 `paused` run 放行并转回 `running`；worktree `prepare` 对已存在的同 run worktree 幂等复用（不重建不报错）；恢复完成后 `completeWorkflowRun` 同步联动 request（`paused`→`completed`/`failed`）。
* R7 **业务失败路径零变化**：非 OperationalError 的既有行为（failed、cleanup、exitCode=1、request failed）逐字节不变。
* R8 **completeWorkflowRun 防御**：run 已 `paused` 时收到 `workflowCompleted(ok=false)`（迟到/重复事件）→ 保持 paused 不降级为 failed；`ok=true`（恢复后成功）正常放行。
* R9 **Web 呈现**：run 状态徽标新增「已暂停（运维）」+ 暂停原因展示 + 「恢复运行」按钮（调 retry-run，stage 取 run.currentStage）；request 列表新增 paused 显示。
* R10 step/graph 层不新增状态：step 记 `failed` + failureReason 前缀 `operational:`；graph node 记 `failed` + `metadata.operational=true`（复用现有 resume 语义，避免状态机扩散）。

## Acceptance Criteria

* [x] AC-001 backend hard timeout → run=`paused`、audit `workflow_run.paused` reason=`backend_timeout`、request=`paused`、worktree 目录仍存在、无 `workflow_run.completed` audit。
* [x] AC-002 preflight 失败（CLI 缺失）→ 同上，reason=`backend_unavailable`。
* [x] AC-003 必需 outputs 缺失 → reason=`backend_protocol`。
* [x] AC-004 compile 失败 / test_gate fail / diff_scope fail → run=`failed`，与改动前行为完全一致（回归测试）。
* [x] AC-005 paused run 上 `retry-run`/`retryStage` → run 回 `running`、step 重置 pending、worktree 复用（同路径不重建）；恢复后成功 → run=`passed` 且 request=`completed`。
* [x] AC-006 run=`paused` 时迟到的 `workflowCompleted(ok=false)` → 状态仍 `paused`。
* [x] AC-007 cancelled run 不能被 pause；paused run 不能被再次 pause（幂等，audit 只记一次）。
* [x] AC-008 Web run 详情显示 paused 徽标 + 原因 + 恢复按钮；点击后走 retry-run happy path（前端投影层单测或最小集成覆盖）。
* [x] AC-009 `bun run test` + `bun run typecheck` 全绿；SQLite 无 status CHECK 约束阻碍（如有需迁移一并处理）。

## Definition of Done

* 上述 AC 全部有测试（engine 单测、orchestrator 分类测试、watch 行为测试、route 测试）。
* README「API surface」补 `workflow-paused` 事件；异常处理文档段落（README 或 spec error-handling）同步。
* `.trellis/spec/api/backend/error-handling.md` / `runner/backend/error-handling.md` 若与新分类冲突则更新。

## Technical Approach

1. `packages/shared/src/utils/operational-error.ts`：`OperationalError extends Error { reason; detail }` + `isOperationalError`（用 name/marker 判定，跨包 instanceof 不可靠）+ barrel 导出。
2. 抛出点改造（runner）：preflight、claude-code/codex 超时与协议失败、steps.ts 的 missing-outputs throw 换成 OperationalError。原 Error 消息全部保留在 detail。
3. `packages/shared/src/types/workflow.ts`：两个 union 各加 `'paused'`。检查 `apps/api/src/store/db.ts` 是否有 CHECK 约束（预计 TEXT 无约束）。
4. engine：`pauseWorkflowRun({workflowRunId, stage, reason, detail, worktreeHead?})`；`completeWorkflowRun` 加 R8 防御；`retryStage` 放行 paused；`completeWorkflowRun` 联动 request（by workflowRunId、状态机 paused/claimed → completed/failed）。
5. route：`runnerEvents.post('/workflow-paused')`；api-client 加 `workflowPaused()`。
6. orchestrator.ts：catch 区分 → paused 标志；finally 按标志跳过 completed 上报与 cleanup；返回值加 `paused: boolean`；watch 对 paused 返回记 log 不 complete。
7. worktree.ts：`prepare` 幂等（已存在同 runId worktree → 直接返回现有 workspace；分支已存在 checkout 容错）。
8. web：run 状态映射、原因取最近 `workflow_run.paused` audit、恢复按钮 → `POST /runner/control/retry-run`。

## Decision (ADR-lite)

* **run/request 加 `paused`，step/graph 不加**：第四态的权威载体是 run；step/graph 复用 failed+metadata 使现有 resume/retry 机制零改造。代价：step 列表上运维故障仍显示 failed——用 failureReason 前缀区分，可接受。
* **恢复复用 retry-run 而非新端点**：已有 spawn/start-stage/step 重置全链路；新端点只会分叉语义。
* **api_unreachable 不做**：API 不可达时连 pause 事件都发不出，属 runner 本地 crash-safety 范畴（另行考虑）。
* **missing outputs 归为 operational（backend_protocol）**：无产物 ≠ 坏产物，重试是正确处置；UMA-DV 对 empty/unparseable reply 同判。误判成本低（人工恢复时可看 detail）。
* **指纹校验不做**（UMA-DV 的 QC-input fingerprint）：MVP 恢复=重跑暂停 stage，已完成 stage 由 start-stage 切片天然不重放；pause audit 记 worktree HEAD 为将来指纹校验留数据。

## Out of Scope

* 自动重试 / 退避策略（永不自动，UMA-DV 同款立场）。
* QC-input 指纹比对跳过重放。
* API 不可达时 runner 本地持久化 pause 意图。
* Coordinator/ask 流（无 run 实体）。
* 暂停超时自动转 failed。

## Technical Notes

* 关键文件：`apps/runner/src/orchestrator.ts:299-313`（finally 重构点）、`apps/api/src/workflow-engine.ts:532-543`（completeWorkflowRun）、`:560+`（retryStage）、`apps/runner/src/cmd/watch.ts:90-110`、`apps/api/src/routes/runner-control.ts:131`（retry-run）、`apps/runner/src/worktree.ts`（prepare 幂等）。
* `isOperationalError` 用 `err instanceof Error && err.name === 'OperationalError'` 或 symbol marker——runner/api 各自 bundle，勿依赖跨包 instanceof。
* UMA-DV 原文条款：UD-FLOW-007 invariant 4（Unavailable verdict / checkpoint / `/continue` 单次重试 / 指纹未变不重放）。
