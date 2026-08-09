# P1-2b 有界自动返工：确定性失败的一次自愈

## Goal

P1-2 让人工重试能读到上次的修复意见。本任务让**确定性失败**不必等人点击。

范围极窄：只在能证明「重试有意义」时自动重试一次，其余全部保持现状。写错这个触发器就是无限烧预算，所以每一条边界都必须是拒绝优先。

来源：`.trellis/tasks/archive/2026-08/07-30-umadev/research/comparison.md` P1-2 段第 2-5 步 + P1-2 移交清单。

## What I already know（已核实，AINP @ `2f63cfb`）

* `apps/api/src/workflow-engine.ts:635-678` — `retryStage(workflowRunId, stage, actor)` 重置目标 step 为 `pending`、run 回 `running`，写 `stage.retry` 审计。**唯一调用方是 HTTP 路由**（`routes/workflow-runs.ts:321`），全部人工触发。
* `apps/api/src/routes/runner-events.ts:551-555` — `/workflow-completed` 是运行结束的唯一收口，`completeWorkflowRun(runId, ok)`。
* 同文件 `562-591` — `/workflow-paused` 独立处理 operational failure（backend unavailable / timeout / protocol / reviewer_unavailable），走 `pauseWorkflowRun`。
* **关键结构事实**：这两条路径互斥。自动返工挂在 `/workflow-completed` 上，operational pause **天然不会**触发它 —— 不需要额外判断就满足「outage 不消耗返工预算」。
* `packages/shared/src/types/workflow.ts` — `WorkflowRun` **没有** attempt 字段。计数需要新建。
* `packages/shared/src/types/gate.ts:14,19` — `sensitive_change_gate` / `knowledge_gate` 存在，是「永不自动循环」清单里的两项。
* P1-2 已交付：`collectPriorFeedback` 在 resume 路径收集 `Approval.comment` 与失败 verdict 的 remediation，注入 ContextPack。**自动重试复用同一条路径，无需新建上下文传递。**

## Requirements

### R1 — attempt 计数

* `WorkflowRun` 增加自动返工计数字段，与人工 retry **分开计数** —— 人工重试不消耗自动预算，自动重试也不该限制人工。
* 计数按 `(run, stage)` 维度，不是全局：implementation 用掉预算不该影响 review。
* union / 类型扩展按 spec 的 ripple 清单检查（含内联字面量 grep）。

### R2 — 无进展指纹

自动重试前必须能回答「上次和这次有区别吗」。没有区别就停。

* 指纹取自**失败的判据本身**：失败的 gate rule id 集合 + 触发失败的 CommandRun exit code。
* 指纹相同 → 拒绝重试并记录原因。这比单纯计次更早止损：同样的错误重复两次就没必要跑第三次。
* 指纹存储在 run 上，与 attempt 计数同处。

### R3 — 允许自动重试的条件（全部满足才触发）

拒绝优先。任一不满足即不重试：

1. 失败来自 `/workflow-completed`（`ok: false`），**不是** `/workflow-paused`。
2. 失败的 gate **不在**禁止清单：`sensitive_change_gate`、`knowledge_gate`、以及任何有人工 approval 记录的 gate。
3. 该 `(run, stage)` 的自动返工计数 < 上限（默认 1，见 ADR-2）。
4. 无进展指纹与上次不同。
5. 存在可消费的 remediation 或 rejection 意见 —— **没有修复线索的重试就是重掷骰子**。

### R4 — 触发器实现

* 挂在 `/workflow-completed` 的失败分支。
* 调用既有 `retryStage`，`actor` 用可识别的自动标记（如 `auto-rework`），使审计能区分来源。
* 计数与指纹在触发时写入，**先写后触发** —— 崩溃时宁可少重试一次，不可无限重试。

### R5 — 测试

* 五个条件各有一条「不满足则不触发」的测试。
* 满足全部条件时触发一次、且第二次因计数用尽而不触发。
* 指纹相同 → 即使计数未用尽也不触发。
* operational pause 路径完全不经过触发器。
* 人工 retry 不消耗自动预算（反之亦然）。

## Acceptance Criteria

* [ ] 自动返工计数与人工 retry 分离，按 `(run, stage)` 维度。
* [ ] 无进展指纹相同则拒绝重试。
* [ ] R3 五个条件全部有拒绝测试。
* [ ] 敏感变更 / 知识 gate / 已有人工审批的 gate 永不自动重试。
* [ ] operational pause 不触发自动返工。
* [ ] 审计能区分自动与人工重试。
* [ ] `npm run typecheck` + `npm test` 全绿。

## Definition of Done

* 质量门 = `npm run typecheck` + `npm test`（无 lint 配置），贴实际输出。
* 测试在 bun runtime 下跑。
* 按 spec 做变异验证：**至少验证「移除某个拒绝条件后测试会红」**，证明每条边界都真的在守。
* 不新增无消费方的声明。

## Out of Scope

* 不做多阶段 repair 子图（implementation → build_test → review 串联）。本轮只重试**失败的那一个 stage**。
* 不做自动返工的 UI 展示（审计里可见即可）。
* 不改 `retryStage` 本身的重置语义。
* 不做跨 run 的失败模式学习。

## Decision (ADR-lite)

### ADR-1：挂在 `/workflow-completed`，不新建触发通道

**Context**：也可以让 runner 在本地判断失败后自行重试。

**Decision**：挂在 API 的失败收口。

**Rationale**：runner 侧重试意味着状态机有两个真相（runner 内部循环 + API 的 run 状态）。API 侧触发复用既有 `retryStage`，run 状态、审计、worktree 生命周期全部走同一条路。而且 `/workflow-completed` 与 `/workflow-paused` 的天然互斥，让「outage 不消耗返工预算」不需要额外判断 —— 结构本身就保证了。

**Consequences**：重试是一次完整的 stage 重跑，不是 agent 进程内的重试。成本更高但语义干净。

### ADR-2：默认上限 1 次，不是 2 次

**Context**：研究文档写的是「默认最多 2 次」。

**Decision**：默认 **1 次**。

**Rationale**：研究文档的 2 次是在「有完整 repair 子图」的前提下说的。本轮只重跑单个 stage，且 R3 条件 5 要求必须有修复线索 —— 在有明确 remediation 的情况下还失败两次，第三次成功的概率不足以支撑成本。上限是配置项，证明 1 次不够再调，比反过来安全。

**Consequences**：某些需要两轮才能收敛的场景会落到人工。可接受 —— 人工重试现在能读到 remediation（P1-2），不是从零开始。

### ADR-3：没有修复线索就不重试

**Context**：R3 条件 5 是我加的，不在研究文档原文里。

**Decision**：保留，且作为硬条件。

**Rationale**：自动重试的全部价值在于「这次会不一样」。若没有 remediation 也没有 rejection 意见，agent 拿到的上下文与上次完全相同 —— 那不是重试，是把同一个骰子再掷一次，只是花了双倍的钱。这条同时让触发器与 P1-2 形成闭环：P1-2 提供线索，本任务消费线索。

**Consequences**：reviewer 产出 verdict 但无 remediation 时不会自动重试。这是对的 —— 那种情况下平台并不知道该改什么。

## 实施结果：R1–R5 全部完成，且 PRD 漏了一环

### 我核实过的（不采信自述）

| 项 | 结果 |
|---|---|
| `npm run typecheck` | exit 0，四个 workspace |
| `npm test` | 128 files / 1492 tests 全过（较上轮 +47） |
| 抽验变异「移除 no_progress 拒绝」 | 精确红 2 条（shared 纯判定 1 + api 端到端 1），其余 41 不受影响 |

### PRD 的 R4 若照字面实现，会交付一个「重试即毁掉待修复工作」的触发器

R4 我只写了「触发器调 `retryStage`」。但 `retryStage` 只重置状态，**没有执行者** —— 既有唯一调用方是 HTTP 路由，由人去点。

而 runner 在 `finalizeOrchestration` 里紧接着 `env.cleanup(workspace)`，该方法在 `worktree.ts:122` 执行 `git branch -D`（已核实）。所以被自动重置的 run 会变成僵尸：状态 `running`，工作区和分支都已删除。**下一次尝试从源分支重启，失败那次的全部改动丢失** —— 一个本该修复缺陷的机制，第一步是销毁待修复的代码。

子代理补了 runner 执行侧（授权时保留 worktree、`OrchestrateResult.autoReworkStage` 回传、watch 循环复用同一 run 重入）。这是必要的范围扩展，不是加戏。

**教训**：「让 X 自动发生」的任务，除了触发条件，必须核实 X 的执行路径是否存在。人工触发的动作往往依赖调用者的后续行为（这里是「人不会在点重试后删掉工作区」），自动触发把那个隐含前提暴露成缺陷。

### 判据上收到 shared，而不是在 api 侧重写一份

R3 条件 5（有无可行动线索）的提取器在 runner，触发器在 api，跨包不能互相 import。第一版是在 api 侧写等价判断加注释「必须与 runner 保持一致」—— 那正是 spec §「Counting the judgements」警告的形状。

改为把**判据本身**上收到 `packages/shared/src/types/prior-feedback.ts`，两侧都调它。危险方向是**判定方比提取方宽松**：那会授权一次付费重试，而 ContextPack 里其实没有新东西。变异 17 证明绑定生效 —— 改共享判据一处，shared 与 runner 同时红。

变异 18 只红 1 条，暴露既有缺口：两侧测试都没有「通过的 verdict 却携带 remediation」这一形状。共享测试补上后，一处测试同时防住两个消费方。

### 一条测试的断言方向被现实修正

原想测「只有人工 rejection comment → 应授权」，实际红了：`recordApproval` 会写一条 `stepRunId` 为 null 的失败 manual gate，按 run 级失败计入，先被 `human_decided_gate` 拒。

这是**正确行为** —— 未解决的人工打回本就该等人，不该自动重试。改成测真正可达的形状：打回已修复（gate 转 pass），comment 作为线索留在 run 上，之后 build_test 失败时授权。

### 顺带修了一个既有测试缺陷

`db-migrations.test.ts` 的 partial-table 用例把迁移 1–30 记为已应用却从不建基线表，任何后续对基线表的 ALTER 都会因无关原因炸在那里 —— 迁移 35 正好撞上。改为先跑真正的 v1 baseline。
