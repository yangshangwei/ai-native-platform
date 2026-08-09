# P1-2 remediation 消费：让修复意见真正进入下一次尝试

## Goal

平台已经在两处产出「怎么修」的结构化意见，但**两处都没有消费方**：人工打回的 `rejection_feedback` 和 P0-2 建立的 `ReviewerVerdict.remediation`。重试时它们全部丢失，agent 从零重来。

本任务让这两类修复意见进入重试时的 ContextPack。**不做自动返工** —— 理由见 ADR-1。

来源：`.trellis/tasks/archive/2026-08/07-30-umadev/research/comparison.md` P1-2 段第 1 步。

## What I already know（已验证）

* `apps/runner/src/orchestrator/approval.ts:14-40` — `postRejectionFeedback` 把人工打回意见写成 `kind='rejection_feedback'` 的 artifact，URI 为 `mem://rejection_feedback/{runId}/{gateId}`，comment 存在 `metadata.comment`。
* 同文件 **11-12 行的注释诚实标注了缺口**：「Producer-only: a follow-up L3 task wires up the consumer (context_pack stage reads the latest `rejection_feedback` to seed prompt revision)」。**本任务就是那个 follow-up。**
* 全仓 grep `rejection_feedback` 只命中 4 个文件：类型定义、生产者、两个测试。**零生产消费方**（已验证）。
* `ReviewerVerdict.remediation`（P0-2 建立，`packages/shared/src/types/review-verdict.ts`）同样只被产出与展示，重试时不进 prompt。
* `apps/runner/src/context/builder.ts:88` — `buildContextPack` 是唯一的 ContextPack 构造点。
* `packages/shared/src/types/context.ts:24-33` — `ContextManifestItemType` 现有 9 个成员，**没有**适合承载「上一次为什么被打回」的类型。
* `mem://` artifact 没有 sha256（P1-1 已验证），所以 remediation 不进入 digest 校验链 —— 它是意见不是证据。
* `apps/api/src/workflow-engine.ts:623-660` — `retryStage` 只把 step 重置为 `pending`，不触碰任何 artifact。所以重试后 artifact 仍在库里，可被检索。

## Assumptions

* 修复意见是**输入**不是**证据**：它进 prompt 影响下一次尝试，但不进 evidence 链、不参与 gate 判定。
* 只注入「上一次尝试」的意见，不做跨多次尝试的累积（避免 prompt 无限膨胀）。
* 不改 `retryStage` 的重置语义。

## Requirements

### R1 — ContextPack 承载修复意见

* `ContextManifestItemType` 新增成员 `prior_feedback`（ADR-2 说明为何不复用 `task_artifact`）。
* 新增成员是 union 扩展，按 `.trellis/spec/shared/backend/quality-guidelines.md` § Anti-patterns 1 的 ripple 清单逐个检查消费方。**同时按新写的 § Counting the judgements 那节，grep 值和类型两次** —— 消费方可能有内联字面量 union。
* trust 级别必须低于代码与 artifact 证据：这是人或 agent 的**意见**，不是事实。

### R2 — 两类来源统一成同一形状

* `rejection_feedback`（人工打回）：取 `metadata.comment`、`metadata.gateId`、`metadata.rejectedAt`。
* `ReviewerVerdict.remediation`（agent 裁决）：取 `blockerId` 对应的 blocker summary + `action` + `rationale`。
* 两者渲染成同一段落结构，让 agent 不必区分来源就能读懂「上次哪里不行、建议怎么改」。
* **key 必须从真实写入方抄** —— `rejection_feedback` 的 comment 在 `metadata.comment`（`approval.ts:29`），不在正文；这正是 P0-1 栽过的坑。

### R3 — 只在重试时注入

* 首次尝试没有「上一次」，不得注入空段落或占位文字。
* **判据就是意见本身是否存在**，不需要额外的 retry 信号：`rejection_feedback` 只在人工打回时产生，失败 verdict 只在 review 判定后产生。首次尝试时库里没有本 run 的这两类记录，自然不注入。
* 修正：不要用 `invoke-skill.ts:128,143` 的 `retryIndex: 0/1` 作为判据 —— 那是 **context-request 补充**的重试（agent 主动索要更多上下文），与 stage 级失败重试无关。误用会让首次尝试的补充轮也被当成"重试"。

### R4 — 测试

* shared：`prior_feedback` 类型守卫与 union 完整性。
* runner：有 `rejection_feedback` 时进 manifest 且 trust 正确；有 verdict remediation 时同理；首次尝试不注入；两者同时存在时都进。
* fixture 的 metadata key 从 `approval.ts` 真实写入方抄。

## Acceptance Criteria

* [ ] `rejection_feedback` 在重试时进入 ContextPack，`approval.ts:11-12` 的「Producer-only」注释可以删除。
* [ ] `ReviewerVerdict.remediation` 同样进入。
* [ ] 首次尝试不注入任何 prior feedback。
* [ ] 修复意见的 trust 低于证据类条目。
* [ ] union 扩展的 ripple 已逐个核查（含内联字面量搜索）。
* [ ] `npm run typecheck` + `npm test` 全绿。

## Definition of Done

* 质量门 = `npm run typecheck` + `npm test`（无 lint 配置），贴实际输出。
* 测试在 bun runtime 下跑；`npx vitest` 会把 suite 报成 skipped。
* `typecheck` 不覆盖 test 文件。
* 未制造第二套 retry / evidence 真相。

## Out of Scope

* **不做自动返工**（ADR-1）。
* 不改 `retryStage` 重置语义。
* 不做跨多次尝试的意见累积。
* 不让 remediation 进入 evidence 链或 gate 判定。

## Decision (ADR-lite)

### ADR-1：本轮不做有界自动返工

**Context**：P1-2 原范围含「对 compile/test/review 确定性 blocker 构造最小 repair 子图，默认最多 2 次」。

**Decision**：本轮只做 remediation 消费，自动返工另立任务。

**Rationale**：研究文档自己的排序就是「**先**让手动修复消费 typed remediation，**再**只对 deterministic blocker 开有界循环」，且给自动返工标的是「价值中高、成本高、风险高」。风险项包括预算、幂等、no-progress 判定、敏感变更与人审边界 —— 每一条都要单独设计。

更实际的理由：**自动返工的前提是 remediation 真的被消费**。当前连手动重试都拿不到上次的修复意见，先让循环里的信息流通，再谈自动化。否则自动返工只是让 agent 更快地重复同样的错误。

**Consequences**：P1-2 只交付一半。自动返工作为独立任务，且应当在本任务上线后用真实数据评估「有多少 blocker 是确定性的」再决定阈值。

### ADR-2：新增 `prior_feedback`，不复用 `task_artifact`

**Context**：`ContextManifestItemType` 已有 `task_artifact`，rejection_feedback 技术上也是 artifact。

**Decision**：新增独立成员。

**Rationale**：trust 语义不同。`task_artifact` 是本次任务产出的**事实**（需求文档、设计、diff），而修复意见是**上一次失败的判断** —— 它可能本身就是错的（人看走眼、agent 误判）。混进同一类型会让 ContextPack 的 trust 分级失去意义，也让「这条信息该不该照做」无法区分。

**Consequences**：union 扩展的 ripple 成本。R1 已要求逐个核查。

## Technical Notes

* `mem://` artifact 无 sha256，所以 prior feedback 天然不进 P1-1 的 digest 校验链 —— 这与「意见不是证据」的定位一致，不需要额外处理。
* `approval.ts` 的注释在本任务完成后应当更新 —— 留着一句描述不存在行为的注释，正是本项目反复踩的坑。

## 实施结果：R1–R3 完成，R4 移出本轮

### 已完成并变异验证

**R1/R2 — 修复意见进 ContextPack**

`prior_feedback` manifest 类型 + `candidatesForPriorFeedback`，两个来源汇成同一形状：
- 人工打回：`Approval.comment`（reject 时路由强制非空，`workflow-runs.ts:230-235`）
- reviewer remediation：失败 verdict 的 `blocking` × `remediation` 配对，问题与修法一起送出

**R3 — 首次尝试注入零内容**

判据是「意见是否存在」而非 retry 计数：`collectPriorFeedback` 只在 resume 路径（`existingRunDetail != null`）收集，首次运行返回 `[]`。

**变异验证**：把 builder 改成忽略 `input.priorFeedback` 后
- 第一次只有提取函数的测试，649 条**全过** —— 说明 builder 那一环当时根本没被覆盖，测试是假绿
- 补了 3 条 `context-builder.test.ts` 用例后重跑同一变异，精确红 2 条，其余 91 条不受影响

这是本任务最有价值的一次发现：**提取函数有测试 ≠ 链路接通有测试**。中间那一跳（builder 是否真的消费入参）需要独立断言。

### R4 移出的理由：自动返工机制不存在，需从零建

`retryStage`（`workflow-engine.ts:635`）**唯一调用方是 HTTP 路由**（`workflow-runs.ts:321`）—— 全部由人工点击触发。仓库里没有任何自动重试路径，也没有 attempt 计数（`workflow.ts` 无 `attempt` 字段）。

所以 R4 不是"给已有循环加上界"，而是要新建三件事：
1. attempt 计数的持久化位置与 run 生命周期的关系
2. 「无进展」判据 —— 用什么指纹判断两次尝试等价（diff 哈希？失败规则集合？）
3. 自动触发器本身，以及它与 operational pause / 人工 approval 的优先级

第 3 项尤其危险：一个能自己重跑 stage 的触发器，写错就是无限烧预算。而 P1-2 已交付的 R1–R3 让**人工**重试不再从零开始 —— 这是自动返工的前提，且独立成立。

移交清单（建议单独任务，与"统一 AC 状态判定"并列）：
- attempt 计数 + 无进展指纹 + 有界自动触发
- 触发器与 `reviewer_unavailable`（P0-2 引入）的交互：outage 不该消耗返工预算
