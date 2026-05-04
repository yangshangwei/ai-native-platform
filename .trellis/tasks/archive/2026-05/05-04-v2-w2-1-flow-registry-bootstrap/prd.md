# V2 W2-1：FLOW_REGISTRY bootstrap + feature.standard 抽取

## Goal

把 V1 当前 `runWorkflow()` 内**硬编码的 9 阶段顺序**提取为 `FLOW_REGISTRY[FlowId].stages` 这种**可扩展的可声明数据结构**。本 task 走 **thin 方案**：FLOW_REGISTRY 只承载 stage 列表 + 元数据；runWorkflow() 内部 dispatch 形态完全保留（runContextPack / runStage 帮手 / 行内块都不动），只是改成"先按 stages 列表迭代再原样走 dispatch"。`workflow_runs` 表加 `flow_id` 列承载实际跑的 flow，默认 `'feature.standard'`，零 V1 行为回归。

本 task 是 V2 Wave 2 关键路径起点（W2-3 / W2-2 / W2-4 都依赖它落地）。

**Roadmap 上下文**：[`.trellis/tasks/archive/2026-05/05-04-v2-wave2-workflow-polymorphism/prd.md`](../archive/2026-05/05-04-v2-wave2-workflow-polymorphism/prd.md) 锁定的共享约定（FlowId 格式 / FlowDef 字段 / 路径），本 task 承袭。

**V2 设计根据**：[`docs/2026-05-04-ai-native-platform-v2-design-notes.md`](../../../docs/2026-05-04-ai-native-platform-v2-design-notes.md) § 2.1 哲学 1（工作类型多态） + § 5 Wave 2 第 1 项。

## What I already know

### 当前 runWorkflow() 实际 dispatch 形态（实地查过 orchestrator.ts:80-310）

不是纯 switch，是**混合 dispatch**：

| Stage | 当前 dispatch 形式 | 备注 |
|---|---|---|
| 0. context_pack | 独立函数 `runContextPack()` | 含 collect knowledge / 生成 / 落 artifact |
| 1. requirement | `runStage('requirement', 'requirement_draft', 'requirement_gate')` | 通用 agent-with-gate 帮手 |
| 2. design | `runStage('design', 'design_doc', 'design_gate')` | 同上 |
| 3. implementation | **行内块**（line 108-179） | invokeSkill + diff artifact + diff_scope_gate + sensitive_change_gate + sensitive checkpoint |
| 4. build_test | runner 直接 mvn (engine 类) | 行内 |
| 5. review | `runStage('review', ...)` | agent + gate |
| 6. acceptance | `await api.awaitHuman({ stage: 'review' })` | 行内 |
| 7. completion | `api.stageTransition({ stage: 'completion' })` | 行内 |
| 8. knowledge | `api.stageTransition` + `awaitHuman` + `persistKnowledgeCandidate` | 行内 |

→ 9 阶段的实际逻辑量级**严重不均衡**。thin 方案故意保留这种异质性。

### Wave 2 Roadmap 已锁定的硬约束（来自 archived 上级 PRD）

承袭这些（R4 ~ R15 from roadmap）：
- `FLOW_REGISTRY: Record<FlowId, FlowDef>` 在 `apps/runner/src/flows/registry.ts`
- `FlowDef` 字段：`id` / `kind: WorkflowRunType` / `stages: StageStep[]` / `description: string`
- `StageStep` 字段：`stage: WorkflowStage` / `kind: 'agent' | 'gate' | 'human' | 'engine'` / 可选 `skillId: string`
- FlowId 格式 `<work_kind>.<variant>` —— 本 task 只新增 `feature.standard`
- workflow_runs 表加 `flow_id TEXT` 列，默认 `'feature.standard'`
- WorkflowStage / WorkflowRunType enum 不收窄（保 V1 兼容）

### 数据库 schema 现状（实地查过）

- `workflow_runs` 表已有 `type TEXT NOT NULL`（值 = WorkflowRunType）
- 没有 flow_id 列
- 项目 db.ts 的 migration 风格：append `CREATE TABLE IF NOT EXISTS` + 用 `columnNames(table)` 守卫的 idempotent ALTER（见 db.ts:285-330）

## Assumptions (confirmed)

- A1. SQLite + bun:sqlite 不换；现有 `workflow_runs` schema 不破坏（新加 nullable `flow_id` 列）
- A2. `WorkflowRunType` enum 不变；本 task 仅引入 `FlowId` 字符串字段
- A3. `WorkflowStage` enum 不变（已是 9 个 V1 stage 的并集，新 flow 在 W2-2 时再扩）
- A4. 行为零回归：跑一次 V1 feature run 应该和重构前一字不差
- A5. 不引入新 stage executor 抽象层（每个 stage 的 body 留在 runWorkflow 当前位置；FLOW_REGISTRY 只描述"按什么顺序跑哪些 stage"）

## Open Questions（全部已拍板）

> 全部 4 道 Q 在 brainstorm 第一轮一次性按推荐拍板。

### ✅ Q1（已拍板）：refactor 深度
**决策**：方案 **α（thin）** — FLOW_REGISTRY 只承载 stages 列表 + 元数据；runWorkflow 内部按 `for (const step of flow.stages)` 迭代但每步走原有 if-else 分发（runContextPack / runStage / 行内块都不动）。`StageStep.kind` / `skillId` 字段第一版"形同虚设"——W2-3 才实际生效，spec 文档要明说。详见 ADR Q1。

### ✅ Q2（已拍板）：workflow_runs.flow_id migration 策略
**决策**：**显式 backfill** — 新加 `flow_id TEXT` 列后立刻跑 `UPDATE workflow_runs SET flow_id = 'feature.standard' WHERE flow_id IS NULL` 一次（idempotent，可重复运行）。新插入行通过 column DEFAULT `'feature.standard'` 自动填充。**不**保留 NULL 状态，**不**让 orchestrator 走"NULL → 默认值"的 runtime 兜底（防御性 fallback 容易隐藏 bug）。详见 ADR Q2。

### ✅ Q3（已拍板）：入口契约——createWorkflow* 怎么传 flowId
**决策**：在 `createWorkflowRunInput` 入参加可选字段 `flowId?: FlowId`，缺省时 default `'feature.standard'`；写入 `workflow_runs.flow_id` 列；runWorkflow() 从 `WorkflowRun.flowId` 读取。本 task 不改任何调用方（API route / runner trigger 都用默认值）；W2-3 起用户从 UI 选 fastforward 时就由 route 显式传 `flowId='feature.fastforward'`。详见 ADR Q3。

### ✅ Q4（已拍板）：V1 行为零回归测试策略
**决策**：**双轨**——
- **类型层 + 数据校验**：写一条单测断言 `FLOW_REGISTRY['feature.standard'].stages.map(s => s.stage)` 严格等于 V1 历史 9 阶段顺序的 const array（编译期 + 运行期都验证顺序）。
- **既有 333 测试套件回归**：跑全套 + workflow-engine integration 测试。任何 V1 行为变化都会撞既有测试。
- **不**引入"snapshot run before/after diff"重型测试——成本太高，不匹配 thin 方案。
详见 ADR Q4。

## Requirements

### 兼容性
- R1. V1 feature run 行为零回归（同输入跑出同结果）
- R2. V2 Wave 1 已落地的 promote / dual-write / entity tables 行为不变
- R3. WorkflowStage / WorkflowRunType enum 不变

### Wave 2 Roadmap 约定（从 roadmap PRD 承袭）
- R4. `FLOW_REGISTRY` 在 `apps/runner/src/flows/registry.ts`，TS 对象字面量
- R5. `FlowDef` 字段：`id: FlowId` / `kind: WorkflowRunType` / `stages: StageStep[]` / `description: string`
- R6. `StageStep` 字段：`stage: WorkflowStage` / `kind: 'agent' | 'gate' | 'human' | 'engine'` / 可选 `skillId: string`
- R7. `runWorkflow()` 重构为按 FlowId 查 FLOW_REGISTRY 后顺序执行
- R8. `workflow_runs` 加 `flow_id TEXT NOT NULL DEFAULT 'feature.standard'` 列（idempotent ALTER + 显式 UPDATE backfill）

### W2-1 specific（Q1=α / Q2 / Q3 / Q4 派生）
- R9. **FlowId 类型** 在 `packages/shared/src/types/workflow.ts` 定义为字符串字面量联合（`'feature.standard'` 第一版唯一值；`FlowId = string` fallback 不可——必须 typed）
- R10. **FlowDef / StageStep** 类型同位置定义（与 WorkflowStage / WorkflowRunType 同文件）
- R11. **FLOW_REGISTRY 唯一项** = `feature.standard`，stages 9 步严格对应 V1 当前顺序：`init` 不在内（`init` 是 status 而非真实 stage——只有 currentStage 字段用），实际有 effect 的 9 步：`context_pack` / `requirement` / `design` / `implementation` / `build_test` / `review` / `completion` / `knowledge` —— 注意：当前代码 `acceptance` 用的是 `awaitHuman({stage: 'review'})` 而不是 `'acceptance'` stage（V1 有 7 stages in enum + 2 隐含的 acceptance/knowledge gate；本 task 不改这些 enum）
- R12. **`runWorkflow()` 内部循环** 形如：`for (const step of flow.stages) await dispatchStep(step, ctx)`；`dispatchStep` 内部按 `step.stage` switch，调用现有 `runContextPack()` / `runStage(step.stage, ...)` / 行内块（行内块抽出为命名函数 `executeImplementation` / `executeBuildTest` / `executeAcceptance` / `executeCompletion` / `executeKnowledgePromotion` —— 这是 thin 方案唯一的"提取"动作，用于满足循环结构）
- R13. **行内块抽出函数签名一致**：每个 `executeXxx(ctx: RunCtx)` 接同一个 `RunCtx` 接口（含 `run` / `workspace` / `inputs` / `inputArtifactIds` / `runArtifactsDir` / `draftsToPromote` / `opts` 等当前函数闭包中的状态）—— `RunCtx` 是新引入的 type，但**不**对外暴露（仅 orchestrator 内部使用）
- R14. **shared 类型** 不导出 `RunCtx`（runner 内部 implementation detail）
- R15. **flow_id 入口契约**：`createWorkflowRunInput` 加可选 `flowId?: FlowId`；缺省 = `'feature.standard'`；workflow_engine 写入 `workflow_runs.flow_id`；runner 读 `run.flowId` 找 FLOW_REGISTRY
- R16. **migration 落地**：`apps/api/src/store/db.ts` MIGRATIONS 数组加 `ALTER TABLE workflow_runs ADD COLUMN flow_id TEXT NOT NULL DEFAULT 'feature.standard'`（用 `columnNames` 守卫）；migration 跑完后立刻 `UPDATE workflow_runs SET flow_id = 'feature.standard' WHERE flow_id = ''`（覆盖任何空字符串）—— DEFAULT 子句已经覆盖新插入；UPDATE 是双保险
- R17. **WorkflowRun TS 类型** 加 `flowId: FlowId` 字段
- R18. **rowToWorkflowRun mapper** 加 flow_id 映射
- R19. **测试**：单测断言 FLOW_REGISTRY['feature.standard'].stages 顺序与 V1 历史一致；workflow-engine integration 全过；新增端到端 happy path 跑一次 createWorkflowRun + assert WorkflowRun.flowId === 'feature.standard'

## Acceptance Criteria

### 兼容性
- [ ] AC-1. 现有 333 条测试全过；typecheck 4/4 包 PASS
- [ ] AC-2. 跑一次 V1 feature run（mock backend）端到端跑通，所有 stage 顺序与 V1 一致
- [ ] AC-3. V2 Wave 1 promote / dual-write 测试零回归（promote.test.ts / promote-route.test.ts / promote-file.test.ts / entity-tables.test.ts 全过）

### Schema (Q2)
- [ ] AC-4. workflow_runs 表加 flow_id TEXT NOT NULL DEFAULT 'feature.standard' 列
- [ ] AC-5. 现有 workflow_runs 行（即使为空）跑 migration 后 flow_id 全为 'feature.standard'
- [ ] AC-6. 新插入行通过 DEFAULT 自动填充 flow_id='feature.standard'

### 类型 / 数据 (Q1=α 派生)
- [ ] AC-7. shared 导出 `FlowId` / `FlowDef` / `StageStep` 类型 + JSDoc
- [ ] AC-8. `apps/runner/src/flows/registry.ts` 导出 `FLOW_REGISTRY` 含且仅含 `feature.standard` 一项
- [ ] AC-9. `feature.standard.stages` 长度 = 9，stage 顺序严格匹配 V1（context_pack → requirement → design → implementation → build_test → review → completion → knowledge —— 实际 V1 有 8 个 effect stages，"acceptance" 是 review 内的人工 gate；具体顺序在 implement 时确认 + 注释）
- [ ] AC-10. 单测：`stages.map(s => s.stage)` 严格等于 const reference array
- [ ] AC-11. WorkflowRun 类型有 flowId 字段；rowToWorkflowRun 正确映射

### 入口契约 (Q3)
- [ ] AC-12. createWorkflowRunInput 入参加 flowId?: FlowId 可选字段
- [ ] AC-13. 缺省 flowId 时 workflow_runs.flow_id = 'feature.standard'
- [ ] AC-14. 现有 createWorkflowRun 调用方（API routes / runner triggers）零改动

### 行为 (Q1=α)
- [ ] AC-15. runWorkflow() 顶层从 9 个硬编码调用改成 for-of 迭代 FLOW_REGISTRY[run.flowId].stages
- [ ] AC-16. 5 个行内块（implementation / build_test / acceptance / completion / knowledge）抽出为 executeXxx(ctx) 命名函数；signature 一致；行为 byte-for-byte 不变
- [ ] AC-17. dispatchStep(step, ctx) 单点路由：内部 switch step.stage 调用 runContextPack / runStage / executeXxx

### 工程
- [ ] AC-18. lint 通过；npm test green
- [ ] AC-19. spec 文档更新：`.trellis/spec/runner/backend/...` 加一节 "FLOW_REGISTRY"，说明 thin 方案语义 + W2-3 起 kind/skillId 字段才生效

## Definition of Done

- 测试：单元 + 端到端（V1 行为回归）
- 类型：tsc 全清
- Lint：通过
- 兼容：旧 feature run 端到端跑通
- 文档：spec 加一节"flow registry"
- 不破坏 P0-1 / P0-2 / P1-1 既有行为

## Out of Scope (explicit)

- ❌ feature.fastforward flow（W2-3）
- ❌ issue.standard / refactor.standard flow（W2-2）
- ❌ 智能路由器（W2-4）
- ❌ 扩 WorkflowStage enum（新 stage 由 W2-2 加）
- ❌ 扩 WorkflowRunType enum（W2-2/W2-4 再说）
- ❌ FLOW_REGISTRY 从 YAML / JSON 配置文件加载（roadmap Q2 已锁 TS 字面量）
- ❌ stage executor 通用化（β/γ 方案；W2-2/W2-4 再考虑）
- ❌ FlowId enum 表 / DB 校验（保持 free TEXT；W2-4 路由器再加约束）
- ❌ Web UI flow 选择器（P3-2 周边）

## Technical Approach

### PR 拆分

| PR | 范围 | 阻塞 |
|---|---|---|
| **PR1** | shared 类型：`FlowId` / `FlowDef` / `StageStep` + JSDoc + 单测 (类型 smoke) | — |
| **PR2** | `apps/runner/src/flows/registry.ts` 含 `feature.standard` FlowDef + 单测（stages 顺序断言）| PR1 |
| **PR3** | runWorkflow 重构：行内块抽出 5 个 executeXxx + dispatchStep + for-of 顶层；workflow_runs migration + flow_id 列；WorkflowRun.flowId 字段 + rowToWorkflowRun mapper；createWorkflowRunInput.flowId? + workflow-engine 写入；端到端集成测试 | PR2 |
| **PR4** | spec 文档：`.trellis/spec/runner/backend/...` 加 "FLOW_REGISTRY" 章节 | 任意时序 |

### Race / Risk
- R-Risk-1：行内块抽函数时漏掉某个闭包变量 → V1 行为偏差 → AC-3 既有测试套件兜底
- R-Risk-2：FlowId 类型在 shared 但 FLOW_REGISTRY 在 runner，定义点分散 → 用 `import type { FlowId } from '@ainp/shared'` 严格遵守
- R-Risk-3：migration 在已有数据库上跑 ALTER ADD COLUMN NOT NULL DEFAULT — bun:sqlite 支持 (V2 P0-2 / P1-1 都这么干)；UPDATE backfill 是 idempotent

---

## Decision (ADR-lite) [Q1]

**Context**：runWorkflow() 当前是混合 dispatch（runContextPack / runStage 帮手 / 行内块），9 阶段逻辑量级严重不均衡。Wave 2 W2-1 的核心动作是"提取 stage 列表"，但有 thin / moderate / deep 三档可能的 refactor 深度。

**Decision**：采用 **方案 α（thin）**：
- FLOW_REGISTRY 只承载 stages 列表 + StageStep 元数据
- runWorkflow() 顶层改成 for-of 迭代 + dispatchStep(step, ctx)
- dispatchStep 内部按 step.stage switch，调用现有 runContextPack / runStage 帮手或新抽的 executeXxx 命名函数
- StageStep 的 `kind` / `skillId` 字段定义齐但**第一版形同虚设**——W2-3 起才真正读取
- spec 文档明说这种"占位"语义，避免后续维护者困惑

**Consequences**：
- ✅ 1 周工程量与 roadmap 估算严格匹配
- ✅ V1 行为零回归最容易验证（行内逻辑一字不动）
- ✅ FLOW_REGISTRY 数据形态完整，给 W2-3/W2-2 留好接口
- ❌ 第一版 StageStep 的 kind/skillId 字段没用——靠 spec 文档兜底说明
- ⚠ 行内块抽函数（executeXxx）是唯一的"提取"动作，要小心不漏闭包变量

---

## Decision (ADR-lite) [Q2]

**Context**：workflow_runs 加 flow_id 列时，对**现有数据**的处理有 3 种 alpha：(a) 显式 backfill 'feature.standard'；(b) 留 NULL，runtime 走 fallback；(c) 新行 DEFAULT，老行 NULL。

**Decision**：**显式 backfill (a)**：
- ALTER TABLE workflow_runs ADD COLUMN flow_id TEXT NOT NULL DEFAULT 'feature.standard'
- migration 紧跟一句 UPDATE: `UPDATE workflow_runs SET flow_id = 'feature.standard' WHERE flow_id = ''`（DEFAULT 已覆盖新插入；UPDATE 是双保险）
- runtime 不接受 NULL flow_id —— 任何 fallback 都是 bug

**Consequences**：
- ✅ DB 数据干净一致；orchestrator 不需要 fallback 逻辑
- ✅ 防御性 NULL → default fallback 容易隐藏后续 bug，本方案直接消除这种状态
- ✅ migration 是 idempotent (NOT NULL DEFAULT + 后续 UPDATE 都可重复跑)
- ❌ 老数据隐式被打成 'feature.standard'——但这本来就是它们当时实际跑的 flow（V1 唯一一种），无歧义
- ⚠ 加 NOT NULL 列对 SQLite 历史数据需 DEFAULT 子句（已用）

---

## Decision (ADR-lite) [Q3]

**Context**：runWorkflow 怎么知道当前 run 应该跑哪条 flow？两条候选：(a) WorkflowRun 行带 flowId 字段；(b) createWorkflow 入参传，runner 内存里持有。

**Decision**：**a + 入参可选**：
- WorkflowRun TypeScript 类型加 `flowId: FlowId`
- workflow_runs 表 flow_id 列承载（Q2 已定）
- createWorkflowRunInput 加可选字段 `flowId?: FlowId`
- 缺省时 workflow-engine 写入 'feature.standard'
- runner runWorkflow() 从 `run.flowId` 字段读，找 FLOW_REGISTRY 查表
- W2-3 起用户从 UI 选 fastforward → API route 显式传 `flowId='feature.fastforward'` → 自动落 DB

**Consequences**：
- ✅ 单一真相源（DB）；runner 不维护内存状态
- ✅ 现有 createWorkflowRun 调用方零改动（缺省字段）
- ✅ W2-3 接入只需要 route 入参 + UI 选项，runner 不动
- ✅ 审计 / 重启场景 flowId 始终在 DB 里，不丢
- ❌ 添加字段需要更新 4 处：shared 类型 / row mapper / workflow-engine 写入 / runWorkflow 读取——但每处都很小

---

## Decision (ADR-lite) [Q4]

**Context**：W2-1 是结构性重构，"V1 行为零回归"是硬约束。需要决定怎么验证。

**Decision**：**双轨**：
- **类型 / 数据层**：单测断言 `FLOW_REGISTRY['feature.standard'].stages.map(s => s.stage)` 严格等于 const reference array（V1 历史顺序）。这条捕捉"列表写错"的低层 bug。
- **既有测试套件**：跑全套 333+ 单测 / integration test。运行结果不变就说明 dispatch 逻辑没漏抽闭包变量。新增 1 条 happy path 端到端测试 createWorkflowRun + assert flowId === 'feature.standard'。
- **不**引入 snapshot run before/after diff —— 重型测试成本与收益不匹配。

**Consequences**：
- ✅ 检查粒度：reference list 测试守"顺序变了"；既有套件守"行为变了"
- ✅ 与项目现有测试惯例一致（package-level + integration）
- ✅ 工程量 1 天内（不需要建 mock V1 baseline）
- ❌ 如果某个 stage 内部闭包逻辑确实漏了某个 ctx 字段，需要既有套件能撞到——风险点：现有套件是否覆盖每个 stage 的关键路径
- ⚠ 缓解：行内块抽函数时严格 1:1 复制 + diff review，不做"顺手简化"

---

## Technical Notes

### 关键文件

- `packages/shared/src/types/workflow.ts:3-22` — WorkflowStage / WorkflowRunType / WorkflowRun
- `apps/runner/src/orchestrator.ts:80-310` — runWorkflow() 9 阶段当前形态
- `apps/runner/src/orchestrator.ts:runStage / runContextPack` — 已有 stage 帮手
- `apps/api/src/store/db.ts:37-50` — workflow_runs 表 schema
- `apps/api/src/store/db.ts:285-330` — 现有 idempotent ALTER 模板
- `apps/api/src/store/store.ts:rowToWorkflowRun` — Row → 类型映射
- `apps/api/src/workflow-engine.ts:createWorkflow*` — 创建 run 入口

### V2 doc / Wave 2 roadmap 引用

- `docs/2026-05-04-ai-native-platform-v2-design-notes.md` § 2.1 哲学 1 / § 5 Wave 2
- `.trellis/tasks/archive/2026-05/05-04-v2-wave2-workflow-polymorphism/prd.md` Q1-Q4 ADRs（共享约定）
