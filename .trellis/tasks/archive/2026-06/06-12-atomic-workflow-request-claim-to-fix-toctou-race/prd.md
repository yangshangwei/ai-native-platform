# PRD: claimWorkflowRequest 原子化（修复 TOCTOU 竞态）

## 背景

路线图 T1.1（来源：archive/2026-06/06-11-architecture-review.../research/api-architecture.md §2.2）。
`apps/api/src/workflow-engine.ts` 中三个 request 状态转换函数都是"先 `store.workflowRequests.get()` 判断状态、再 `set()` 写回"的两步模式：

- `claimWorkflowRequest`（:202）— 检查 `status !== 'pending'` 后写 `claimed`
- `markWorkflowRequestRunStarted`（:219）
- `completeWorkflowRequest`（:235）

SQLite 单写有锁，但两条独立语句之间无隔离：多 runner 并发 claim 同一 request 时可能双双通过检查、双双成功，导致同一任务被两个 runner 执行。

## 目标

把"检查 + 写回"折叠为单条带状态前置条件的原子 `UPDATE ... WHERE status = ?`，用受影响行数判定成败。

## 需求

1. **claim 原子化**：`claimWorkflowRequest` 改为原子 `UPDATE workflow_requests SET ... WHERE id = ? AND status = 'pending'`；受影响行数为 0 时返回 null（与现有"不可认领返回 null"语义一致）。并发下恰好一个调用者成功。
2. **同模式修复** `markWorkflowRequestRunStarted` 与 `completeWorkflowRequest`：以各自现有的状态前置检查为准（先读代码确认每个函数当前接受哪些前置状态，把同样的条件移入 WHERE 子句，不得收紧或放宽）。
3. **分层归位**：原子 UPDATE 落在 store 层（store.ts 的 workflowRequests repo 增加方法，如 `claimIfPending(...)` 返回更新后的实体或 null），workflow-engine 保持"唯一状态写入者"角色调用它；不要在 engine 里裸写 SQL 绕过 store。
4. **非并发路径行为不变**：所有现有调用方（routes/workflow-requests.ts 的 claim/run-started/complete 端点）的响应、audit 写入、返回形状逐字段保持。
5. **新增并发回归测试**：同一 request 上并发（或顺序模拟竞态交错）两次 claim，断言恰好一个成功、另一个得 null；其余两个函数各加一个"前置状态不满足时返回 null/失败"的断言（若已有则不重复）。

## 边界

- 不动 runner 侧轮询逻辑，不改 HTTP 契约。
- 不顺手重构 workflow-engine 其他部分。
- audit 行为保持：成功路径照旧写 audit；失败路径若现状不写则维持不写。

## 验收标准

1. `bun run typecheck` 通过
2. `bun x --bun vitest run` 全绿（626+ 新增测试）
3. 新并发测试在修复前的旧实现上会失败（实施时先写测试验证其捕获能力，TDD 顺序）
4. workflow-requests 路由测试无任何断言改动
