# Research: 失效传播的落点与改动面

- **Query**: 如果要实现「upstream artifact 变了 → 所有消费它的 node 及其 downstream 标记为 stale」，改动面有多大？涉及哪些表 / 类型 / 写入方？`retryStage()` 现在是怎么重置状态的？
- **Scope**: internal
- **Date**: 2026-08-09

## 速答

改动面**比预期小**，因为三块基础设施已经在跑：

1. **检测**已有 —— `verifyFileSha256` 每次读 artifact 都在算 mismatch（见 [artifact-sha256-coverage.md](./artifact-sha256-coverage.md)）
2. **消费记录**已有 —— `StepCheckpoint.inputArtifactIds` / `outputArtifactIds` 真实落盘
3. **拓扑**已有 —— `GraphEdgeDefinition` + `GraphNodeRun.dependencyState.upstreamNodeIds`

缺的是三样：artifact→node 的**反查索引**、**stale 这个状态本身**（`GraphNodeStatus` 里没有）、以及**触发时机**。

`retryStage()` 是最大的坑：它**只重置 StepRun 和 WorkflowRun 的状态字段，完全不碰 artifact / GateRun / StepCheckpoint / GraphNodeRun**。重跑一个 stage 之后，上一轮的全部证据原封不动留在库里，且仍然被 gate 当作有效证据读取。

## Findings

### `retryStage()` 到底重置了什么（已验证，逐行）

`apps/api/src/workflow-engine.ts:635-678`。全部写操作只有三处：

```ts
// 1. 复用最后一个同 stage 的 StepRun，或造一个新的
step.status = 'pending';
step.completedAt = null;
store.stepRuns.set(step.id, step);

// 2. run 回到 running
run.currentStage = params.stage;
run.status = 'running';
run.updatedAt = nowIso();
store.workflowRuns.set(run.id, run);

// 3. audit
audit(params.workflowRunId, 'stage.retry', { ... });
```

对 `sed -n '635,678p' | grep -E "checkpoint|artifact|gate|evidence"` 的结果是**空**（已验证）。

后果（推断，逻辑上直接成立）：

- 上一轮的 `Artifact` 全部保留，`store.artifacts.byWorkflow()` 仍会返回它们
- 上一轮的 `GateRun` 全部保留 —— gate-engine 里大量 `.at(-1)` 取最新（如 `gate-engine.ts:1175-1177` 取 latestAcceptanceGate），重跑后新 gate 会追加，但**旧 gate 仍在集合里**
- `StepCheckpoint` 因为 `mergeStepCheckpoint` 用 `mergeStrings` **合并去重**（`step-checkpoints.ts:55-56,152-154`），retry 后新一轮的 artifact id 会**追加到同一个 checkpoint**，旧 id 不会被清掉 —— 一个 checkpoint 同时含两轮的 input/output
- `retryIndex` 用 `Math.max`（`step-checkpoints.ts:61`），只增不减

唯一的调用方：`apps/api/src/routes/workflow-runs.ts:321`。

### 已有的拓扑基础

`packages/shared/src/types/graph-runtime.ts:181-203`：

```ts
export interface GraphNodeDependencyState {
  upstreamNodeIds: string[];
  satisfiedNodeIds: string[];
  blockedNodeIds: string[];
}

export interface GraphNodeRun {
  ...
  stepRunId: StepRunId | null;
  stepCheckpointId: StepCheckpointId | null;
  dependencyState: GraphNodeDependencyState;
```

`GraphNodeRun.stepCheckpointId` 已经把 node 和 checkpoint 连起来了，而 checkpoint 有 input/outputArtifactIds。所以 **artifact → checkpoint → nodeRun → downstream nodeRun** 这条链的每一环都已存在，只是没有反向索引。

### `GraphNodeStatus` 里没有 stale

`packages/shared/src/types/graph-runtime.ts:19-30`：

```ts
export const GRAPH_NODE_STATUSES = [
  'pending', 'ready', 'running', 'passed', 'failed', 'blocked', 'skipped', 'cancelled',
] as const;
```

三个分区常量（`graph-runtime.ts:38-63`）把这 8 个状态划成 terminal-success / terminal-blocking / active / resumable，注释明确说这个划分被 scheduler 和 read model 共享，"Kept here so scheduling and read-model semantics cannot drift apart"。

**加一个 `'stale'` 会波及全部四个分区常量 + `deriveGraphRunStatus`（297-309）+ 所有 exhaustive switch。** 这是本任务最大的单点风险。

替代方案（成本更低）：不加状态，而是加一个**正交的布尔/结构字段**，例如 `GraphNodeRun.metadata.evidenceStale` 或 `GraphNodeRun.staleReason: string | null`。理由：stale 与 passed/failed **不互斥** —— 一个 node 可以「跑成功了但证据已失效」，这正是要表达的语义。塞进同一个枚举会丢失「它当初确实过了」这个信息，而原始需求（comparison.md:121）明确要求「保留旧证据但不继续放行」。

### 涉及的表与类型清单

| 层 | 位置 | 需要什么 |
|---|---|---|
| DB | `apps/api/src/store/db.ts` | 若走列：`graph_node_runs` 加 `stale_reason TEXT`；走 metadata 则**零迁移**。迁移编号接在现有 `addColumn(19, ...)`（`db.ts:537`）之后 |
| 类型 | `packages/shared/src/types/graph-runtime.ts:187-203` | `GraphNodeRun` 加字段；**不建议**动 `GRAPH_NODE_STATUSES` |
| 判定 | 新增 `packages/shared/src/types/*.ts` 里一个纯函数 | 单一判定原则：`deriveEvidenceStaleness(...)`，写侧读侧共用，对标 `deriveGraphRunStatus`（`graph-runtime.ts:297-309`） |
| 反查 | `apps/api/src/store/store.ts` | `stepCheckpoints` 需要 by-artifact 查询；目前只有 `byStep`（`step-checkpoints.ts:47` 在用）。这是**唯一必须新增的查询能力** |
| 触发 | `apps/api/src/workflow-engine.ts:635-678` `retryStage` / artifact 读取路径 | 见下节 |
| 写入 | `apps/api/src/graph-runtime.ts:76-96`、`apps/api/src/routes/runner-events.ts:262,331` | 三处 `graphNodeRuns.upsert` 是仅有的 nodeRun 写入点 |
| gate | `apps/api/src/gate-engine.ts` | 新规则读 stale，或扩展 `evidence.artifact_digests_present`（1231-1240，当前是 `warn`） |
| UI | `apps/web/src/page-task-detail.ts:2814,2830-2834` | 已有 mismatch pill，扩展到 node 级 |

### 触发时机的三个候选

1. **读时惰性**（成本最低）：gate 评估时对本 run 的 file artifact 批量 `verifyFileSha256`，`verified === false` 的即为失效源。优点是零新增写入方、零后台任务；缺点是只在 gate 跑时才知道。
2. **retry 时**：在 `retryStage()` 里对该 stage 及 downstream 的 checkpoint 做一次失效标记。这解决的是「重跑后旧证据仍被采信」，与 digest 无关，是**另一个独立问题**。
3. **写时主动**（成本最高）：artifact 变更事件驱动。当前没有文件监听基础设施，需要新建，不建议。

### `inputSelectors` / `outputNames` 的现状

已验证：`GraphNodeDefinition.inputSelectors` / `outputNames`（`graph-runtime.ts:137-138`）在**全仓零消费**。所有非测试出现点都是写空数组：

- `packages/shared/src/flows/graph-adapter.ts:27-28` — `flowToGraphDefinition` 固定写 `[]`
- `packages/shared/src/flows/graph-fixtures.ts:63-64` — 同样 `[]`

唯一写了非空值的是测试 `packages/shared/test/graph-runtime.test.ts:48`（`outputNames: ['diff']`）。

含义：这两个字段是纯声明，**没有任何执行方**。P1-1 若要填充它们，必须同时给出读侧，否则只是把「声明了没人读」的债从 1 处变成 3 处。

## Caveats / Not Found

- 未验证 `store.stepCheckpoints` 现有的全部查询方法签名（只确认了 `byStep`）。新增 by-artifact 反查的实际成本需要读 `apps/api/src/store/store.ts` 的 `defineTable` 机制后才能给准数。
- 未验证 SQLite 是否已有 `step_checkpoints` 的 artifact 相关索引 —— 若 input/outputArtifactIds 是 JSON 列，反查需要全表扫或建新表，成本差异较大。**这是给出准确工时前必须补的一步。**
- 未调研 `resumeGraphNode()`（`apps/api/src/graph-runtime.ts:25-104`）与 `retryStage()` 的关系 —— 两者都是「重来」语义但走不同路径，P1-1 若只改一个会留下不一致。
- 「upstream 变化」的定义本身未在任何 spec 里找到 —— 是指 artifact 文件被人工编辑，还是指 upstream node 重跑产生了新 artifact？两者的检测机制完全不同（前者靠 digest，后者靠 checkpoint 版本）。**这是需求层面的歧义，建议 P1-1 开工前先定死。**
