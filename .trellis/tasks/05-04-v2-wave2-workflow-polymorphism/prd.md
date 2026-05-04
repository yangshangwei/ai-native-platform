# V2 Wave 2：工作类型多态 + 智能路由（Workflow Polymorphism）

## Goal

V2 Wave 2 是 V2 设计纲要 § 2.1（工作类型多态）+ § 3.2（智能路由入口）的落地。把 V1 "feature 流程套所有"的 9 阶段固定流水线**重塑为多 flow 体系**，让 bug / feature / refactor / audit 这些**形状不同**的工作各走各的 flow，并由智能路由器（V2 第二根架构主轴）根据用户描述 + 仓库现状动态选 flow + 选起点。

V2 doc § 5 把 Wave 2 拆为 4 个子项目：

| # | 子项目 | 体现哲学 | 估算 |
|---|---|---|---|
| **W2-1** | 降级现 9 阶段为 "feature/standard" 一种 flow | 哲学 1（工作类型多态） | 1 周 |
| **W2-2** | 加 issue + refactor 两条新 flow | 哲学 1 | 2 周 |
| **W2-3** | fastforward 通道 | 哲学 1+2 | 1 周 |
| **W2-4** | 智能路由诊断器 | 架构主轴 2 | 2 周 |

合计 ~6 周，单 task 太大。本 brainstorm 的**第一道决策**是：把整个 Wave 2 作为 roadmap 拆成 4 个 child task，还是先选一个子项目深 brainstorm。

**V2 设计根据**：[`docs/2026-05-04-ai-native-platform-v2-design-notes.md`](../../../docs/2026-05-04-ai-native-platform-v2-design-notes.md) § 2.1 哲学 1（工作类型多态性）、§ 3.2（智能路由入口）、§ 5 改造路径。

## What I already know

### V1 现状（实地查过）

**WorkflowStage 类型** (`packages/shared/src/types/workflow.ts:3-12`)：9 阶段写死的 enum
```ts
type WorkflowStage =
  | 'init' | 'context_pack' | 'requirement' | 'design'
  | 'implementation' | 'build_test' | 'review'
  | 'completion' | 'knowledge';
```

**WorkflowRunType 已存在**（`workflow.ts:22`）：`'feature' | 'bugfix' | 'smoke'` —— 字段已建好但 **orchestrator 完全不分流**：
```
apps/runner/src/orchestrator.ts:27   runType?: WorkflowRunType;
apps/runner/src/orchestrator.ts:61   type: opts.runType ?? 'feature',
```
只是写到 `workflow_runs.type` 列 + 审计日志里，**runWorkflow() 仍走同一条 9 阶段管子**，跟 type 无关。

**runWorkflow() 逻辑** (`apps/runner/src/orchestrator.ts`)：硬编码的 9 步顺序调用，每步：
1. context_pack — 单 spawn LLM
2. requirement — 单 spawn LLM
3. design — 单 spawn LLM
4. implementation — 单 spawn LLM
5. build_test — runner 直接 mvn
6. review — 单 spawn LLM
7. acceptance — 人工 gate（`api.awaitHuman`）
8. completion — API 后端生成
9. knowledge_candidate — API + 人工审批

> **关键观察**：runType 作为字段已就位，"加多 flow" 的真正工作是把 runWorkflow() 内的硬编码步骤序列**提取成可配置的 FLOW_REGISTRY**，并按 runType 分发。

### V2 § 2.1 给的方向（哲学 1）

- 修 bug、做 feature、做重构、做审计是**形状不同**的工作，不是同一条流水线的不同变体
- 每种有自己的入口、stage 序列、退出条件
- 反面教材："V1 把所有事塞进 9 阶段管子"

### V2 § 3.2 给的方向（架构主轴 2）

- 用户说"我想做 X"时，系统**先看仓库现状再决定从哪一步进入**：
  - 已有 PRD → 跳过 brainstorm
  - 已有 design → 直接 impl
  - 改动很小 → 走 fastforward
  - 完全空白 → 走完整流程
- 路由器输入：用户描述 / 仓库现状 / 历史模式 / 知识库匹配
- 路由器输出：建议起点 stage / 建议 flow / 关联知识列表 / 预估时间 + token
- 流程是**根据现状动态拼出来的**，不是按 enum 预设的

### V2 § 4.2 的工程纪律

> 第一阶段先做 3 种工作流：feature / issue / refactor。其他类型做成 escape hatch，让用户写自由 prompt。**覆盖 100% = 哪个都做不深**。

## Assumptions (confirmed)

- A1. SQLite + bun:sqlite 不换；现有 `workflow_runs` 表不破坏（type 列已存在）
- A2. `WorkflowStage` enum 不收窄（保 V1 兼容）；可以扩
- A3. Wave 2 不动 V2 Wave 1 已落地的 promote / dual-write / entity table 路径
- A4. 4 个子项目之间存在**强依赖**：路由器 (W2-4) 依赖至少有 2 条 flow（W2-1 + W2-2 之一）；fastforward (W2-3) 依赖 flow 概念存在 (W2-1)。所以 W2-1 是**关键路径起点**

## Open Questions（全部已拍板）

> 全部 4 道 Q 在 brainstorm 第一轮一次性按推荐拍板（用户授权"直接干"）。

### ✅ Q1（已拍板）：本 brainstorm 的策略
**决策**：方案 **A** — Roadmap 模式。本 task 不写代码，只拍板 Wave 2 全局结构性决策；4 个子项目作为**未来 task 的 slug + scope 摘要**记录，**不**物理创建 child task（避免 4 个 zombie 任务挤 active list）；用户在适当时机手动 `task.py create` 各 child。详见 ADR Q1。

### ✅ Q2（已拍板）：FLOW_REGISTRY 形状
**决策**：方案 **A** — TypeScript 对象字面量 `FLOW_REGISTRY: Record<FlowId, FlowDef>`，定义在 `apps/runner/src/flows/registry.ts`（新建）。每个 FlowDef 携带 `stages: StageStep[]` 有序列表，StageStep 携带 `stage: WorkflowStage` + `kind: 'agent' | 'gate' | 'human' | 'engine'` + 可选 `skillId`。`runWorkflow()` 重构为按 FlowId 查表后顺序执行 stages，不再硬编码。详见 ADR Q2。

### ✅ Q3（已拍板）：子项目顺序与依赖
**决策**：**W2-1 → W2-3 → W2-2 → W2-4**（按依赖 + 工程量 + 用户可见价值排序）。详见 ADR Q3。

### ✅ Q4（已拍板）：共享命名约定
**决策**：FlowId 格式 `<work_kind>.<variant>`（如 `feature.standard` / `feature.fastforward` / `issue.standard` / `refactor.standard`）；StageId 沿用现有 `WorkflowStage` enum，新增 stage 由各 child task 各自决定（issue 加 `report` / `analyze` / `fix_note`；refactor 加 `scan` / `apply`）；不引入版本号或时间戳。详见 ADR Q4。

## Requirements

### 兼容性
- R1. V2 Wave 1 已落地的 promote / dual-write / entity tables 行为零回归
- R2. 现有 `workflow_runs.type` 列 + `WorkflowRunType` enum 不变（只是开始真正被分流逻辑读取）
- R3. V1 默认 runType='feature' 行为完全等价（不破坏老 run）

### Wave 2 Roadmap 共同约定（Q2 / Q4 派生）
- R4. 在 `apps/runner/src/flows/registry.ts`（新建）放 `FLOW_REGISTRY: Record<FlowId, FlowDef>` —— TypeScript 对象字面量，**不**用 YAML / JSON 配置文件
- R5. `FlowDef` 至少含：`id` / `kind: WorkflowRunType` / `stages: StageStep[]` / `description: string`
- R6. `StageStep` 至少含：`stage: WorkflowStage` / `kind: 'agent' | 'gate' | 'human' | 'engine'` / 可选 `skillId: string`
- R7. `runWorkflow()` 重构为：先 `FLOW_REGISTRY[run.flowId]` 查表，然后按 `flow.stages` 顺序执行；不再硬编码 9 步
- R8. FlowId 命名格式 `<work_kind>.<variant>`：`feature.standard` / `feature.fastforward` / `issue.standard` / `refactor.standard`
- R9. WorkflowStage enum 不收窄；新增 stage（如 `report` / `analyze` / `apply` 等）由各 child task 自决，提交到 `packages/shared/src/types/workflow.ts`
- R10. 现有 `workflow_runs` schema 加 `flow_id TEXT`（默认 `'feature.standard'`）通过 idempotent ALTER；不影响 V1 数据
- R11. WorkflowRunType enum 视情况扩（`feature` / `bugfix` / `smoke` 是否够用 + 加 `issue` / `refactor` / `audit` 由 W2-2 / W2-4 阶段决定，本 roadmap 不锁死）

### Wave 2 Roadmap 推进顺序（Q3 派生）
- R12. **W2-1 必须最早做**（FLOW_REGISTRY 是 W2-2/W2-3/W2-4 的硬依赖）
- R13. **W2-3 fastforward 第二个做**（最小工程量、最直接用户价值；fastforward 本质是 `feature.fastforward` flow 定义，是 W2-1 FLOW_REGISTRY 扩展性的第一个验证点）
- R14. **W2-2 第三个做**（issue + refactor 两条 flow；2 周；exercises FLOW_REGISTRY 跨工作类型的扩展性）
- R15. **W2-4 最后做**（智能路由器；2 周；需要至少 3 条不同 flow 在册才有意义）

## Acceptance Criteria

> 本 task 是 Roadmap，无代码改动。AC 仅覆盖 PRD 落地 + 共享约定文档化。

- [x] AC-1. 4 个 ADR-lite 完整记录 4 道 Q 的拍板
- [x] AC-2. PRD "Wave 2 Roadmap (4 future tasks)" 章节列出 4 个 child task 的 slug / scope summary / 依赖图
- [x] AC-3. 共享命名约定（FlowId 格式 / StageStep 字段 / FLOW_REGISTRY 路径）写进 PRD（已被 R4-R9 覆盖）
- [ ] AC-4. spec 文档（`.trellis/spec/api/backend/...` 或 `runner/backend/...`）添加 V2 Wave 2 路径——可在 W2-1 child task 的 PR4 阶段落，本 roadmap 不强求
- [ ] AC-5. brainstorm 完成后跑 `task.py start` + 立即 archive（roadmap 任务无 implementation 阶段）

## Wave 2 Roadmap（4 future tasks，**本 task 不创建**，user 适时手动起）

### 🟢 W2-1（next）：FLOW_REGISTRY bootstrap + feature.standard 抽取

- **建议 slug**：`v2-w2-1-flow-registry-bootstrap`
- **scope**：把当前 9 阶段硬编码从 `runWorkflow()` 提取为 `FLOW_REGISTRY[feature.standard].stages`；workflow_runs 表加 `flow_id` 列；orchestrator 改成查表执行；现有 V1 行为零回归（默认 flow_id='feature.standard'）
- **估算**：1 周
- **依赖**：无（Wave 2 关键路径起点）
- **交付物**：4 PR
  - PR1 shared 类型（`FlowId` / `FlowDef` / `StageStep`）
  - PR2 `apps/runner/src/flows/registry.ts` 含 `feature.standard` 定义
  - PR3 `runWorkflow()` 重构 + workflow_runs.flow_id migration
  - PR4 spec 文档"flow registry" 章节

### 🟡 W2-3：feature.fastforward 通道

- **建议 slug**：`v2-w2-3-fastforward-channel`
- **scope**：在 FLOW_REGISTRY 加 `feature.fastforward` flow，stages 列表是 feature.standard 的子集（如只跑 implementation + build_test + acceptance，跳过 context_pack / requirement / design）；触发条件由用户在新建 task 时显式选 fastforward
- **估算**：1 周
- **依赖**：W2-1 完成
- **交付物**：~3 PR（flow def + 触发器 + UI 端点）

### 🟡 W2-2：issue + refactor 两条新 flow

- **建议 slug**：`v2-w2-2-issue-refactor-flows`
- **scope**：加 `issue.standard`（report → analyze → fix → verify）和 `refactor.standard`（scan → design → apply → verify）；两个新 flow 各自定义 stages + skillIds + gates；新增 stage（如 `report` / `analyze` / `scan` / `apply`）扩 `WorkflowStage` enum；对应 skill 文件由本 task 起草 stub 骨架
- **估算**：2 周
- **依赖**：W2-1 完成（W2-3 不强依赖，可并行）
- **交付物**：~5 PR（每个新 flow 约 2 PR + 共享 stage enum 扩展 1 PR）

### 🟡 W2-4：智能路由诊断器（V2 第二根架构主轴）

- **建议 slug**：`v2-w2-4-smart-router`
- **scope**：新建任务时不直接进 flow，而是：(1) 接收用户描述 (2) 扫描仓库现状（已有 PRD？已有 design？改动估计？）(3) 匹配相关知识库 (4) 输出建议 FlowId + 建议起点 stage + 关联知识列表 + 预估时间。第一版用规则引擎（不必上 LLM），后续可叠 LLM
- **估算**：2 周
- **依赖**：W2-1 完成 + 至少 W2-2 / W2-3 之一完成（路由要"在多 flow 间选"才有意义）
- **交付物**：~4 PR（router 模块 + UI 入口卡 + 历史模式存储 + 集成 / 测试）

### 推进顺序图

```
Wave 2 critical path:
  W2-1  →  W2-3  →  W2-2  →  W2-4
  (1w)     (1w)     (2w)     (2w)

Total: ~6 weeks across 4 child tasks.
```

## Definition of Done

- ✅ 本 PRD 4 ADRs 完整
- ✅ Wave 2 Roadmap 4 future task 摘要落地
- ✅ FLOW_REGISTRY / FlowId / StageStep 命名约定在 PRD 里有强约束
- ❌ 不写代码（roadmap 任务）
- ❌ 不物理创建 child task

## Out of Scope (explicit)

- ❌ 长会话 + checkpoint（Wave 3）
- ❌ 语义 verifier 扩 gate（Wave 3）
- ❌ acceptance 回写提案（Wave 3）
- ❌ Web UI workflow type 选择视图（Wave 4 / P3-2 周边）
- ❌ inputs 截断/摘要（Wave 3）
- ❌ 物理创建 W2-1 / W2-2 / W2-3 / W2-4 child task（user 适时手动起）
- ❌ FLOW_REGISTRY 从 YAML / JSON 配置文件加载（Q2 拍板用 TS 字面量）

## Technical Notes

### 关键文件
- `packages/shared/src/types/workflow.ts:3-22` — WorkflowStage / WorkflowRunType
- `apps/runner/src/orchestrator.ts:runWorkflow` — 当前 9 阶段硬编码
- `apps/api/src/workflow-engine.ts:createWorkflow*` — 创建 run 的入口（type 字段已就位但不分流）
- `apps/web/src/main.ts` — UI workflow type 显示（待确认是否已暴露 type 字段）

### V2 doc 引用
- § 2.1 哲学 1（工作类型多态性）
- § 3.2 智能路由入口（架构主轴 2）
- § 4.2 第一阶段先做 3 种工作流（工程纪律）
- § 5 改造路径 Wave 2 估算
- § 6 设计禁忌坑 4 "试图覆盖 100% 工作类型 = 哪个都做不深"

---

## Decision (ADR-lite) [Q1]

**Context**：
V2 Wave 2 实际是 4 个相互依赖的子项目（合计 ~6 周），单 task 装不下；但 4 个子项目之间存在共享结构性决策（FLOW_REGISTRY 形状、命名约定、推进顺序），若不一次性拍板，4 个 child task 会反复讨论同一组问题。

**Decision**：
采用 **Roadmap 模式**：
- 本 task **不写代码**
- 只拍板 Wave 2 全局结构性决策（Q2 / Q3 / Q4）
- 4 个子项目作为 **future task 的 slug + scope 摘要** 记录在 PRD
- **不**物理创建 child task（避免 4 个 planning 状态 task 挤 active list）
- user 适时手动 `task.py create <slug>` 起各 child；每个 child 自己跑完整 brainstorm

**Consequences**：
- ✅ 一次定调子，4 个 child task 直接 inherit FLOW_REGISTRY 结构 + 命名约定
- ✅ 无 zombie task 占 active 列表
- ✅ 当 user 实际开始 W2-1 时，brainstorm 直接基于本 roadmap 的硬约束起步
- ❌ 本 task 完成后没有可见代码产出——纯架构纪律
- ⚠ Roadmap 决策可能在 W2-1 实施时撞到具体问题需调整；若发生，应**回头修本 PRD** 然后给 W2-2/3/4 知会

---

## Decision (ADR-lite) [Q2]

**Context**：
9 阶段当前硬编码在 `runWorkflow()` 内。Wave 2 要把它"提取成可配置 FLOW_REGISTRY"——但具体形态有 3 个候选：
- A. TypeScript 对象字面量（项目现行风格，如 `MIGRATIONS` / `KIND_TO_ENTITY` / `KNOWLEDGE_SUBTYPES`）
- B. JSON / YAML 配置文件加载
- C. 类继承 + 装饰器风格

**Decision**：
采用 **方案 A**——TypeScript 对象字面量：
- 文件位置：`apps/runner/src/flows/registry.ts`
- 形态：`export const FLOW_REGISTRY: Record<FlowId, FlowDef> = { 'feature.standard': { ... } }`
- 类型：`FlowDef` 含 `id` / `kind: WorkflowRunType` / `stages: StageStep[]` / `description: string`；`StageStep` 含 `stage: WorkflowStage` / `kind: 'agent' | 'gate' | 'human' | 'engine'` / 可选 `skillId: string`

**Consequences**：
- ✅ 跟项目现有结构完全对齐（如 `KIND_TO_ENTITY` / `MIGRATIONS`）
- ✅ TypeScript 类型在编译期就能检查 stages / skillIds 拼写
- ✅ 演进性好：加 flow = 加一个 key；扩字段 = 改 interface 一处
- ✅ V2 doc § 6 坑 3 明确反对图形化编排——TS 字面量是"代码即配置"的最干净实现
- ❌ 用户改 flow 需要发布新版本（不像 YAML 可运行时改）——但这跟项目"runtime 不动 schema"的纪律一致
- ⚠ 第一版可能"够用"，将来如果出现"项目自定义 flow"需求再考虑加配置层

---

## Decision (ADR-lite) [Q3]

**Context**：
Wave 2 4 个子项目之间存在依赖（W2-4 需要 W2-1 + 至少一个新 flow；W2-3 与 W2-2 都需要 W2-1）。但具体顺序还有空间——可以先做哪个一周量，可以并行多个吗。

**Decision**：
推进顺序 **W2-1 → W2-3 → W2-2 → W2-4**：
1. **W2-1 first**（1 wk，关键路径起点）：FLOW_REGISTRY 不存在前其他 3 项都做不了
2. **W2-3 second**（1 wk，最小工程量）：fastforward 本质是 `feature.fastforward` flow 定义，是 FLOW_REGISTRY 扩展性的**第一个真实验证点**；同时给用户立等可见价值（"30 秒走完小改动"）
3. **W2-2 third**（2 wk）：加 issue + refactor 两条全新 flow；exercises FLOW_REGISTRY 跨工作类型的扩展性
4. **W2-4 last**（2 wk）：智能路由器需要"多个 flow 可路由"才有意义

**Consequences**：
- ✅ 每一步都是上一步扩展性的真实验证（W2-3 验证 variant 扩展性 / W2-2 验证 work_kind 扩展性 / W2-4 验证整体路由）
- ✅ 用户每 1-2 周看到一次可见进展，不是 6 周大爆炸
- ✅ W2-3 在 W2-2 之前，让用户最快感知"V2 解决了 V1 痛点"（V2 § 1.3 短板 "改个分号也走 9 步"）
- ❌ 总时间不缩短（仍 ~6 wk）；不并行
- ⚠ W2-2 (issue + refactor) 内部可能再拆为 W2-2a (issue) / W2-2b (refactor) 两个 child，由 W2-2 brainstorm 决定

---

## Decision (ADR-lite) [Q4]

**Context**：
4 个子项目都涉及 FlowId 命名 / StageStep 字段 / 文件位置。如果不在 roadmap 阶段拍板，4 个 child task 会自己定方案，然后撞名字撞不一致。

**Decision**：
共享命名约定固化在 PRD R4-R9：
- **FlowId 格式**：`<work_kind>.<variant>`，alphabetic + dot 分隔，如 `feature.standard` / `feature.fastforward` / `issue.standard` / `refactor.standard`
- **StageStep 字段**：`stage: WorkflowStage` / `kind: 'agent' | 'gate' | 'human' | 'engine'` / 可选 `skillId: string`
- **FLOW_REGISTRY 物理路径**：`apps/runner/src/flows/registry.ts`
- **WorkflowStage enum**：沿用现有 9 个不收窄；新增 stage 由 child task 提交到 `packages/shared/src/types/workflow.ts`
- **WorkflowRunType enum**：`'feature' | 'bugfix' | 'smoke'` 暂保持；W2-2 可能扩 `'issue' | 'refactor'`，但本 roadmap 不锁

**Consequences**：
- ✅ 4 个 child task 直接遵守同一套命名 / 字段，避免重复争论
- ✅ 跨 child PR 的代码可读性 / search 友好性高
- ✅ FlowId 字符串可以直接当 `workflow_runs.flow_id` 列存储（不需另起 enum 表）
- ❌ 强约束意味着每个 child 在 PR 里要 hold 住命名（不能搞 `requirement-flow` 之类）
- ⚠ 后续若 user 想自定义 flow（运行时 / 插件），命名约定可能需要扩展——但 V2 MVP 不涉及
