# Research: P1-1 该做什么 / 不该做什么

- **Query**: 给一份「P1-1 应该做什么 / 不该做什么」的建议，按改动成本和收益排序。若原始范围过大应当拆分，明确说出拆法。
- **Scope**: internal（综合本目录其余 5 份调研）
- **Date**: 2026-08-09

## 结论先行：原始范围过大，建议拆成三个任务

原始 P1-1（`comparison.md:109-129`）打包了四件事：

1. node 声明 required input digests / expected outputs
2. StepCheckpoint 记录实际消费 artifact id + sha256
3. upstream 变化 → downstream stale 传播
4. AC row 绑定 criterion-specific 证据，替换文本启发式

其中 **1 和 4 是两个独立的大工程**，塞进一个任务会重演前三个 P0 栽过的坑（声明的字段没有执行方）。

建议拆法：

| 任务 | 范围 | 成本 | 收益 |
|---|---|---|---|
| **P1-1a** | digest 消费侧接通 + 失效检测有后果 | 低 | 高 |
| **P1-1b** | AC 证据特异性（替换文本启发式） | 中高 | 高 |
| **P1-1c** | node inputSelectors/outputNames 通电 | 中 | 中（且依赖 1a） |

以下按「先做什么」排序。

---

## 应该做（按性价比降序）

### 1. 合并 `isCommandOnlyText` / `commandOnlyVerifierText` 两份重复判定 ⭐ 最高性价比

**证据**：`apps/api/src/gate-engine.ts:498-509` 与 `apps/runner/src/orchestrator/steps.ts:869-880` **逐字符相同**，只有函数名不同（已用 diff 验证）。

**为什么先做**：这是「单一判定原则」的直接违反，且是纯粹的技术债 —— 修它不改变任何行为，风险接近零。做法：提到 `packages/shared`，两侧 import。

**成本**：< 1 小时。**收益**：消除一个跨包漂移源。

注意一个既有的不对称需要显式决策：gate 侧判的是 `text + verificationMethod` 拼接，runner 侧只判 `verificationMethod`（见 [ac-proof-heuristics.md](./ac-proof-heuristics.md)）。合并时必须选一个，并写清理由 —— 这个选择会改变判定结果。

### 2. 给已有的 digest mismatch 接上执行方 ⭐ 核心价值点

**证据**：`verifyFileSha256`（`packages/shared/src/node/digest.ts:16-20`）**已经在每次读 artifact 时重算并比对**，产出 `verified: true | false | null`。但 API 侧零消费 —— `grep "verified" apps/api/src` 只命中正则字面量和注释。唯一消费方是 web 的一个文案 pill（`page-task-detail.ts:2830-2834`）。

**做什么**：

- 在 gate-engine 加一条规则读 `verified === false`（或把现有 `evidence.artifact_digests_present` 从「digest 在不在」扩展到「digest 对不对」，注意它当前是 `warn` 不是 `fail`，`gate-engine.ts:1231-1240`）
- 判定逻辑放 `packages/shared` 的纯函数，写侧读侧共用

**为什么高收益**：这是 comparison.md 说的「解决人工改稿后的旧证据污染」的**直接命中点**，而且检测部分**已经免费了**。

**成本**：低。**收益**：高。

### 3. 让 `retryStage()` 不再遗留旧证据

**证据**：`apps/api/src/workflow-engine.ts:635-678` 只重置 `StepRun.status/completedAt` 和 `WorkflowRun.currentStage/status/updatedAt`，**完全不碰** artifact / GateRun / StepCheckpoint / GraphNodeRun（已验证）。更麻烦的是 `mergeStepCheckpoint` 用 `mergeStrings` 合并去重（`step-checkpoints.ts:55-56`），retry 后新旧两轮的 artifact id **混在同一个 checkpoint 里**。

**为什么值得做**：这是「run 内证据失效」最常见的真实触发场景，且与 digest 无关（是另一条独立的失效路径）。

**成本**：中（要定义清楚哪些证据该作废、哪些该保留）。**收益**：高。

**注意**：`resumeGraphNode()`（`apps/api/src/graph-runtime.ts:25-104`）是并行的第二条「重来」路径，只改 `retryStage` 会留下不一致。

### 4. 给 AC 绑定特异性证据（建议独立成 P1-1b）

**证据**：`businessAcceptanceEvidenceRefs`（`steps.ts:832-844`）把 requirement.md / design.md / diff / review.md 这**同样 4 个 artifact 绑给每一条 AC**，claim 里的 `${id}` 制造特异性假象。结果是 `hasEvidence` 对区分 AC 强弱**毫无作用** —— 只要 run 走到 review 阶段，所有 AC 同时为真。

配合 `businessAcceptanceStatus`（`steps.ts:817-830`）**不读任何执行结果**，最松路径是：design.md 表格第 4 列写一句 ≥8 个非命令字符的话 → 该 AC 判 passed。全程无人验证功能是否被实现（完整链条见 [ac-proof-heuristics.md](./ac-proof-heuristics.md)）。

**为什么独立成任务**：要做对，需要先定义「什么算 criterion-specific 证据」—— 是 test case 名映射、diff hunk 定位，还是新增一类 per-AC command run？这是**需求设计问题不是实现问题**，塞进 P1-1 会导致边做边定义。

**成本**：中高。**收益**：高。

---

## 不该做

### 1. 不要给 `GraphNodeStatus` 加 `'stale'`

**理由**：`GRAPH_NODE_STATUSES`（`graph-runtime.ts:19-30`）被四个分区常量（38-63）和 `deriveGraphRunStatus`（297-309）共享，注释明确说这个划分保证 "scheduling and read-model semantics cannot drift apart"。加一个值波及全部下游。

更本质的理由：**stale 与 passed 不互斥**。一个 node 可以「当初确实跑过了，但证据现在失效了」，而 comparison.md:121 原文要求「保留旧证据但不继续放行」。塞进同一个枚举会丢掉「它当初过了」这个信息。

**替代**：用正交字段（`GraphNodeRun.staleReason: string | null` 或 metadata 键），零 DB 迁移。

### 2. 不要复用 `ContextFreshness`

**理由**：它是知识召回的时间衰减过滤器（`retriever.ts:358-363` 打分、`router.ts:223` 过滤、`builder.ts:595-599` 决定引入模式），作用对象是 project-scoped 的 `KnowledgeArtifact`，而且那类 artifact **本来就允许被编辑**（`artifact.ts:19-20`），编辑不是失效。完整对比见 [context-freshness-boundary.md](./context-freshness-boundary.md)。

`MemoryStatus` 里的 `'stale'`（`artifact.ts:166`）同样不对，那是 memory decay 语境。

**替代**：直接用已有的 `DigestVerification.verified` 三态。

### 3. 不要收编也不要删除 `ExecutionContract.expectedOutputs`

**调研推翻了「无人读」这个前提。** 它的执行方是 CI 断言 —— `apps/runner/test/skill-execution-contract.test.ts:28-35` 对**全部** SKILLS 跑 `executionContractOutputConflicts`，任何漂移都会让构建红。

P0-3 在 `execution-contract.ts:236-246` 的注释里**已经显式回答过**「为什么不加运行时检查」：缺 required output 在 07-26 被刻意分类为 operational pause，加第二个运行时检查会让同一现象有两种分类。

强行收编会同时违反「不制造第二套真相」和 07-26 的分类纪律。删除则是净损失。详见 [expected-outputs-disposition.md](./expected-outputs-disposition.md)。

**建议**：只在 spec 补一句「执行方是 CI 而非运行时」，防止下一个人重复得出错误结论。

### 4. 不要在 P1-1 填充 `inputSelectors` / `outputNames`

**理由**：这两个字段（`graph-runtime.ts:137-138`）当前全仓零消费，所有生产写入点都是 `[]`（`graph-adapter.ts:27-28`、`graph-fixtures.ts:63-64`）。填充它们而不同时建读侧，等于把「声明了没人读」的债从 1 处变成 3 处 —— **正是前三个 P0 反复栽的坑**。

若要做，应等 1a 的 digest 消费链路建成后，作为 P1-1c 独立推进，且必须先有读侧设计。

### 5. 不要建文件监听 / 后台扫描

**理由**：当前没有这类基础设施。而 digest 校验是**读时惰性**的（`artifact-content.ts:36`），gate 评估时批量校验本 run 的 file artifact 即可覆盖绝大多数场景，零新增写入方、零后台任务。

---

## 开工前必须澄清的两点

1. **「upstream 变化」的定义**：是指 artifact 文件被人工编辑（靠 digest 检测），还是指 upstream node 重跑产生了新 artifact（靠 checkpoint 版本检测）？两者机制完全不同。任何 spec 里都没找到这个定义。
2. **`step_checkpoints` 的 artifact 反查成本**：`inputArtifactIds` / `outputArtifactIds` 若以 JSON 列存储，artifact → checkpoint 反查需要全表扫或建新索引表。这是唯一必须新增的查询能力，成本差异较大，给准工时前必须先确认存储形态（本次未验证，见 [stale-propagation-blast-radius.md](./stale-propagation-blast-radius.md) 的 Caveats）。

## 顺带发现的疑似债（不属于 P1-1，但值得记一笔）

`businessAcceptanceStatus`（`steps.ts:817-830`）只返回 `'missing'` 或 `'passed'`，**从不返回 `'at_risk'` / `'failed'`**。但 gate 侧 `evaluateBusinessAcceptanceMatrix`（`gate-engine.ts:1599-1601`）有完整的 `at_risk` 分支，规则 `acceptance.business_matrix_criteria_proven` 还会因此判 `warn`（`gate-engine.ts:850-851`）。

即：**读侧准备好了一个写侧永远写不出的值**。疑似又一处「声明了没有执行方」，建议单独确认。
