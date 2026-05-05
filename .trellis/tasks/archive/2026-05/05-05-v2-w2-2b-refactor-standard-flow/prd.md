# V2 W2-2b：refactor.standard flow 通道

## Goal

扩展 W2-1 + W2-3 + W2-2a 落地的 `FLOW_REGISTRY`，加入第四条 flow `refactor.standard`——服务 V2 § 4.2 列出的 3 种第一阶段工作流的最后一条（feature / issue / **refactor**）。Stages 形状 `scan → plan → implementation → build_test → review → completion`（6 步），新增 2 个 `WorkflowStage`（`scan` / `plan`）+ 1 个 `WorkflowRunType`（`refactor`）；`apply` 复用 `implementation`（语义同为 "agent → diff artifact"）。

W2-2b 是 W2-2a 的姊妹 task —— 同一拆分（W2-2 = W2-2a issue + W2-2b refactor），在 W2-2a 验证"跨工作类型扩展"的基础上再加一条。验证 thin 抽象在第三个 work-kind 上仍成立，并把 V2 § 4.2 第一阶段 3 工作流凑齐。

W2-2b 完成后 Wave 2 就剩 W2-4 智能路由器。

**Wave 2 上下文**：[`.trellis/tasks/archive/2026-05/05-04-v2-wave2-workflow-polymorphism/prd.md`](../archive/2026-05/05-04-v2-wave2-workflow-polymorphism/prd.md) W2-2 摘要（本 task 是其拆分的第二半）。

**W2-2a 上下文**：[`.trellis/tasks/archive/2026-05/05-05-v2-w2-2a-issue-standard-flow/prd.md`](../archive/2026-05/05-05-v2-w2-2a-issue-standard-flow/prd.md) — 6 ADRs，W2-2b inherit Q0 / Q3 / Q4 / Q5。

**spec 文档**：[`.trellis/spec/runner/backend/flow-registry.md`](../../spec/runner/backend/flow-registry.md)（W2-2a PR3 已更新，含 3 条 flow 对比）。

## What I already know

### W2-1 + W2-3 + W2-2a 已落地的硬约束（直接 inherit）

- **FlowId**：`<work_kind>.<variant>` — W2-2b 加 `'refactor.standard'`
- **FLOW_REGISTRY** (`apps/runner/src/flows/registry.ts`)：`Readonly<Record<FlowId, FlowDef>>`，扩 union 后必须注册条目，否则 tsc 漏注册告警
- **trust-boundary 双 KNOWN_FLOW_IDS**：`apps/api/src/routes/workflow-runs.ts:23` + `apps/runner/src/index.ts:10`，必须同步加 `'refactor.standard'`
- **dispatchStep**：`default: _exhaustive: never` 守 WorkflowStage 漏 case；新 stage = 新 case + 新 `executeXxx`
- **StageStep `kind` / `skillId`** 仍是 placeholder（W2-1 ADR Q1=α）；W2-4 才生效
- **WorkflowRun.flowId** NOT NULL DEFAULT 'feature.standard'；不读 NULL 的 fallback 是契约违反
- **acceptance_gate** 已 stage-history-aware（W2-2a PR2）：refactor.standard 没 requirement / design step → 自动跳过 N/A rule，零代码改动

### V2 设计来源

- **V2 doc § 4.2**：第一阶段 3 种工作流 — feature / issue / **refactor (scan→design→apply)**；本 task 的 'plan' 实现 V2 doc 的中间"design"步，但在 WorkflowStage 层面命名为 'plan' 以与现有 'design'（feature 专属）解耦
- **V2 doc § 1.3**：V1 流程僵化短板；W2-2b 完成后 Wave 2 三种工作类型齐
- **W2-2a Q1 ADR (A)**：'fix' 复用 'implementation'；同模式 W2-2b 的 'apply' 复用 'implementation'
- **W2-2a Q3 ADR (C)**：gate-engine stage-history-aware 模式由 W2-2a PR2 落地，refactor.standard 自动适配

### 现有代码（grep 后实地核实）

| 关注点 | 现状 | 启示 |
|---|---|---|
| WorkflowRunType | `'feature' \| 'bugfix' \| 'smoke'` | **必须加** `'refactor'` —— Coordinator 没产生 'refactor' 信号；硬复用 'feature'/'bugfix' 会人为制造 W2-4 路由的歧义债 |
| WorkflowRunType 字面量 mirror | shared master + 3 处字面量 mirror（runner/api-client.ts:58,74 + web/main.ts:158）+ web select 显示（main.ts:2858） | 加 'refactor' 改 4 处文件（5 行） |
| acceptance_gate stage-history-aware | W2-2a PR2 已落 | refactor.standard 自动适配，零改动 |
| design_gate | 现有 10+ 条 rule 含 REQ-### / AC-### 检查（feature 专属） | 不复用 'design' WorkflowStage（避开 design_gate refactor）；用新 'plan' stage 不挂 design_gate |
| findSkillForStage | 单一 stage→SkillSpec lookup | 不动 lookup，仅扩 SKILLS 数组（同 W2-2a Q4） |
| mustSkill | W2-2a 已扩到 6 个 stage | 再加 'scan' / 'plan' = 8 stage |
| promote 路径 | 只走 requirement_draft / design_doc | refactor.standard 不跑 requirement / design step → draftsToPromote 自然空，零改动 |

## Assumptions (confirmed)

- **A1**. refactor.standard 的 FlowDef.kind = `'refactor'`（扩 WorkflowRunType；3 处字面量 mirror 同步）
- **A2**. refactor.standard 不引入新 KnowledgeArtifactKind / 不动 `promoteAcceptedDraftToKnowledge`（scan_doc / refactor_plan 留 per-run kind='other'）
- **A3**. refactor.standard 不跑 `context_pack` / `requirement` / `design` / `knowledge` step（仅 6 步：`scan` → `plan` → `implementation` → `build_test` → `review` → `completion`）
- **A4**. SkillSpec instructions 用 placeholder 简化版（沿用 W2-2a Q4=B 模式）；prompt 精雕留 follow-up
- **A5**. 'plan' WorkflowStage 与 'design' 解耦：refactor 走 'plan' 不走 'design'，因此不触发 design_gate（design_gate 的 REQ-### / AC-### rule 在 refactor 上不适用，但 W2-2b 不去改 design_gate）
- **A6**. acceptance_gate 在 refactor.standard 上已自动适配（W2-2a PR2 stage-history-aware；no requirement / design step → N/A rule）
- **A7**. 不激活 StageStep.kind / skillId 字段消费（保 W2-1 ADR Q1=α；W2-4 才动）
- **A8**. Coordinator 不感知 refactor（routeCase 不扩 'refactor'）—— W2-4 路由器再决定 user description → flowId 映射逻辑

## Open Questions（全部已拍板）

> 2 道 W2-2b-specific Q 一次性拍板（其余 ADR 由 W2-2a inherit）。

### ✅ Q1：refactor.standard 的 stage 序列

**决策**：方案 **B** — `scan → plan → implementation → build_test → review → completion`（6 步）。新增 2 个 WorkflowStage：`scan`、`plan`。`apply` 复用 `implementation`（不同 prompt 由 skillId 维度区分；W2-4 激活）。**不**复用 'design' WorkflowStage（避开 design_gate refactor，scope 更小）。详见 ADR Q1。

### ✅ Q2：FlowDef.kind / WorkflowRunType 对接

**决策**：方案 **A** — 加 `'refactor'` 进 WorkflowRunType。FlowDef.kind = 'refactor'。3 处字面量 mirror（shared master + runner api-client × 2 + web main.ts type literal × 1）+ web UI select 选项扩展。详见 ADR Q2。

### ✅ Q0 / Q3 / Q4 / Q5 (inherited from W2-2a)

- **Q0**（split）：W2-2b = refactor.standard 单独 task ✓
- **Q3**（acceptance_gate）：stage-history-aware 在 W2-2a PR2 已落 ✓
- **Q4**（SkillSpec）：placeholder 模式，加 `cs-refactor-scan` / `cs-refactor-design` 占位 + 改 `skill.implementation` instructions 引 refactor_plan ✓
- **Q5**（knowledge）：不扩，scan_doc / refactor_plan 留 per-run kind='other' ✓

## Requirements

### 兼容性

- **R1**. V1 / W2-1 / W2-3 / W2-2a 行为零回归（feature.standard 8 步 / feature.fastforward 4 步 / issue.standard 6 步路径完全不变）
- **R2**. acceptance_gate stage-history-aware 在 refactor.standard 上自动适配（W2-2a PR2 已实现的 N/A rule 同样处理 refactor.standard，零代码改动）

### shared 类型 (Q1, Q2)

- **R3**. `WorkflowStage` enum 加 `'scan'` / `'plan'`：完整列表变为 `'init' | 'context_pack' | 'requirement' | 'design' | 'implementation' | 'build_test' | 'review' | 'completion' | 'knowledge' | 'report' | 'analyze' | 'scan' | 'plan'`
- **R4**. `FlowId` 字面量联合扩为 `'feature.standard' | 'feature.fastforward' | 'issue.standard' | 'refactor.standard'`
- **R5**. `WorkflowRunType` 加 `'refactor'`：`'feature' | 'bugfix' | 'smoke' | 'refactor'`
- **R6**. `AgentTaskKind` 加 `'scan'` / `'plan'`（沿用 W2-2a 同模式让 taskKindForSkill 不走 default 'noop' 分支）

### runner registry (Q1, Q2)

- **R7**. `FLOW_REGISTRY` 加 `'refactor.standard'` 条目，结构与现 entries 一致：`{ id, kind: 'refactor', description, stages: readonly StageStep[] }`
- **R8**. `refactor.standard.stages` 严格顺序：`['scan', 'plan', 'implementation', 'build_test', 'review', 'completion']`（6 步）
- **R9**. `refactor.standard` StageStep.kind 分类：`scan`/`plan`/`implementation`/`review` = `'agent'`；`build_test`/`completion` = `'engine'`
- **R10**. `refactor.standard` StageStep.skillId 占位：`scan='cs-refactor-scan'` / `plan='cs-refactor-design'` / `implementation='cs-refactor-apply'` / `review='cs-feat-accept'`（注：本 task 仍是 placeholder，dispatchStep 不消费；W2-4 激活）

### orchestrator dispatchStep (Q1)

- **R11**. `dispatchStep` switch 增加 `case 'scan'` / `case 'plan'`，分别调用新 `executeScan(c)` / `executePlan(c)` 命名函数
- **R12**. `executeScan(c: RunCtx)`：`mustSkill('scan')` → `invokeSkill` → `postArtifact(kind: 'other', name: 'scan_doc.md')` → `finishAgentSuccess` → `stepFinished('passed')`
- **R13**. `executePlan(c: RunCtx)`：`mustSkill('plan')` → `invokeSkill` → `postArtifact(kind: 'other', name: 'refactor_plan.md')` → `finishAgentSuccess` → `stepFinished('passed')`
- **R14**. `mustSkill` 类型签名扩为接受 `'requirement' | 'design' | 'implementation' | 'review' | 'report' | 'analyze' | 'scan' | 'plan'`
- **R15**. `executeScan` / `executePlan` 共享 `RunCtx`（不引新 ctx 类型）；按 W2-1 PR3 / W2-2a PR1 inner-fn 风格

### SkillSpec (Q4 inherited)

- **R16**. SKILLS 数组加 `skill.refactor_scan`：
  - `id: 'skill.refactor_scan'`, `version: '0.1.0'`, `stage: 'scan'`
  - `inputs`: `[{ name: 'user_request', kind: 'text', required: true }]`
  - `outputs`: `[{ name: 'scan_doc.md', kind: 'artifact', required: true }]`
  - `instructions`: placeholder（含 frontmatter `doc_type: scan` + SCAN-### + sections: 切入点 / 候选改造点 / 优先级 / 建议范围；HARD RULE: 不写实现细节）
- **R17**. SKILLS 数组加 `skill.refactor_design`：
  - `id: 'skill.refactor_design'`, `version: '0.1.0'`, `stage: 'plan'`
  - `inputs`: `[{ name: 'scan_doc.md', kind: 'artifact', required: true }]`
  - `outputs`: `[{ name: 'refactor_plan.md', kind: 'artifact', required: true }]`
  - `instructions`: placeholder（含 frontmatter `doc_type: refactor_plan` + RFP-### + sections: 现状 / 变化 / 推进策略 / 风险；HARD RULE: 行为不变；每条断言 cite `src/...:NN`）
- **R18**. 修改 `skill.implementation` instructions：在末尾继续追加 "If `refactor_plan.md` is present (refactor.standard flow), use it as primary reference; preserve behaviour — do NOT introduce visible changes."（不动 inputs.design.required—— W2-2a 已设为 false）

### entry contract

- **R19**. `apps/api/src/routes/workflow-runs.ts:23` `KNOWN_FLOW_IDS` 加 `'refactor.standard'`
- **R20**. `apps/runner/src/index.ts:10` `KNOWN_FLOW_IDS` 加 `'refactor.standard'`
- **R21**. `apps/runner/src/index.ts` CLI usage string 加 `refactor.standard` 选项

### WorkflowRunType 字面量 mirror (Q2)

- **R22**. `apps/runner/src/api-client.ts:58, 74` `type?: 'smoke' | 'feature' | 'bugfix';` 字面量扩 `| 'refactor'`
- **R23**. `apps/web/src/main.ts:158` UI 类型字面量扩 `| 'refactor'`
- **R24**. `apps/web/src/main.ts:2858` typeSelect option 列表加 `'refactor'`（视情况；用户改 UI 不需校验，但加上以保持 UI 与 type enum 同步）

### 测试

- **R25**. shared / runner / api / web 4/4 包 typecheck pass
- **R26**. 全套测试零回归（W2-2a baseline 379）+ 新增 ≥ 5 条覆盖：
  - (a) refactor.standard stages 顺序断言（reference array `['scan','plan','implementation','build_test','review','completion']`，flow-registry.test.ts）
  - (b) `FLOW_REGISTRY['refactor.standard'].kind === 'refactor'`
  - (c) FlowId union + WorkflowRunType union smoke
  - (d) route 透传：`POST /workflow-runs body.flowId='refactor.standard' + type='refactor'` → 创建 run.flowId === 'refactor.standard' / type === 'refactor'
  - (e) gate-engine fixture：refactor.standard 形状（无 requirement/design step + 有 diff/review/test_gate）→ acceptance_gate.status === 'pass'（W2-2a stage-history-aware 自动覆盖；建议加 1 条断言确认）
- **R27**. `mustSkill` 拒绝未知 stage（regression: 'init' 仍 throw）

### 文档

- **R28**. `.trellis/spec/runner/backend/flow-registry.md` 追加 `refactor.standard` section，覆盖：
  - stages 形状（6 步） + StageStep.kind/skillId 占位说明
  - Q2 的 `FlowDef.kind = 'refactor'` 命名 + WorkflowRunType 扩展说明
  - 'plan' WorkflowStage 与 'design' 解耦的设计取舍（避开 design_gate refactor）
  - acceptance_gate 自动适配说明（W2-2a stage-history-aware 实证扩展性）
  - § 5 加 Good case for refactor.standard
  - § 6 References 加 W2-2b PRD

## Acceptance Criteria

### 兼容性

- [ ] **AC-1**. typecheck 4/4 包 PASS
- [ ] **AC-2**. 全套测试零回归（baseline 379；新增 ≥ 5 条）
- [ ] **AC-3**. V1 / feature.standard / feature.fastforward / issue.standard 行为路径不变（任何不显式传 `flowId='refactor.standard'` 的调用方仍走默认或既存路径）

### 类型 / 数据 (Q1, Q2)

- [ ] **AC-4**. `WorkflowStage` enum 包含 `'scan'` 和 `'plan'`
- [ ] **AC-5**. `FlowId` 字面量联合包含 `'refactor.standard'`
- [ ] **AC-6**. `WorkflowRunType` 包含 `'refactor'`
- [ ] **AC-7**. `AgentTaskKind` 包含 `'scan'` 和 `'plan'`
- [ ] **AC-8**. `FLOW_REGISTRY['refactor.standard'].stages.length === 6`
- [ ] **AC-9**. `FLOW_REGISTRY['refactor.standard'].stages.map(s => s.stage)` 严格等于 `['scan', 'plan', 'implementation', 'build_test', 'review', 'completion']`
- [ ] **AC-10**. `FLOW_REGISTRY['refactor.standard'].kind === 'refactor'`
- [ ] **AC-11**. `FLOW_REGISTRY['feature.standard']` / `FLOW_REGISTRY['feature.fastforward']` / `FLOW_REGISTRY['issue.standard']` stages 不变（reference array 仍 pin）

### dispatchStep / executeXxx (Q1)

- [ ] **AC-12**. `dispatchStep` switch 含 `case 'scan'` / `case 'plan'`；`_exhaustive: never` 默认分支保留 typecheck 安全
- [ ] **AC-13**. `executeScan` 写 `scan_doc.md` artifact（kind='other'），`executePlan` 写 `refactor_plan.md` artifact（kind='other'）
- [ ] **AC-14**. `mustSkill('scan')` / `mustSkill('plan')` 返回非 undefined SkillSpec

### gate-engine 自动适配 (Q3 inherited)

- [ ] **AC-15**. fixture: refactor.standard 形状（无 requirement/design step；有 diff/review/test_gate）→ `runAcceptanceTraceabilityGate`.status === 'pass'，requirement_present + design_present rule 是 'pass' with N/A note（W2-2a stage-history-aware 实证扩展）

### SkillSpec (Q4 inherited)

- [ ] **AC-16**. SKILLS 数组含 `stage: 'scan'` 和 `stage: 'plan'` 各一条
- [ ] **AC-17**. `skill.implementation.instructions` 包含 "If refactor_plan.md is present" 的 graceful 处理一句

### 入口契约

- [ ] **AC-18**. `POST /workflow-runs body.flowId='refactor.standard' type='refactor'` → 创建的 `run.flowId === 'refactor.standard'` 且 `run.type === 'refactor'`
- [ ] **AC-19**. `runner orchestrate --flow-id refactor.standard` → cmdOrchestrate 透传到 api.createWorkflowRun
- [ ] **AC-20**. `POST /workflow-runs body.flowId='unknown.x'` → HTTP 400 错误消息含 `'refactor.standard'`（KNOWN_FLOW_IDS 守门）
- [ ] **AC-21**. `POST /workflow-runs body type='refactor'` 不带 flowId → 接受 type='refactor' + run.flowId 默认 'feature.standard'（type 与 flow 字段解耦；W2-4 路由器才解决联动）

### 工程

- [ ] **AC-22**. `bun test` green；`bun run --filter '*' typecheck` green
- [ ] **AC-23**. spec 文档 `.trellis/spec/runner/backend/flow-registry.md` 追加 refactor.standard section + § 5 Good case + § 6 reference

## Definition of Done

- 单元 + integration 测试全过
- typecheck 4/4 全清
- 不破坏 W2-1 / W2-3 / W2-2a / V2 Wave 1 / V1 行为
- spec 文档同步
- placeholder SkillSpec instructions 足够 LLM 输出 schema-correct artifact

## Out of Scope (explicit)

- ❌ 智能路由器（W2-4 — refactor.standard 只能由 user 显式传 `flowId='refactor.standard'` 触发）
- ❌ 激活 StageStep.kind / skillId 路由（findSkillForStage 仍按 stage 单一 lookup；W2-4 才动）
- ❌ KnowledgeArtifactKind 扩展（refactor 产物留 per-run kind='other'）
- ❌ Coordinator 加 'refactor' RouteCase（跨 task 的 V1→V2 升级，单独起 task）
- ❌ design_gate 的 stage-history-aware 化（W2-2b 选 'plan' WorkflowStage 是为了避开 design_gate；如未来需要 reuse 'design' 单起 follow-up）
- ❌ cs-refactor-* prompt 精雕（本 task 用 placeholder；prompt-tuning follow-up）
- ❌ Web UI 选 refactor.standard 入口的可用性验证（浏览器验证留 supervised 会话；本 task 只更新 select 字面量，不验证视觉）
- ❌ Coordinator 自动检测 "用户描述像 refactor" 选 refactor.standard（W2-4）

## Technical Approach

### PR 拆分

| PR | 范围 | 阻塞 |
|---|---|---|
| **PR1** | shared 类型扩（WorkflowStage += scan/plan；FlowId += refactor.standard；WorkflowRunType += refactor；AgentTaskKind += scan/plan）+ FLOW_REGISTRY 加 refactor.standard 条目 + dispatchStep 加 case + executeScan/executePlan 实现 + mustSkill 扩 + taskKindForSkill 扩 + SKILLS 加 2 条 placeholder + skill.implementation instructions 微调 + flow-registry.test.ts 加 refactor.standard reference array | — |
| **PR2** | WorkflowRunType 字面量 mirror 同步（runner api-client + web main.ts UI type + select option）+ 双 KNOWN_FLOW_IDS 加 refactor.standard（route + CLI）+ CLI usage string + 路由 / type 透传测试 + spec 文档追加 refactor.standard section + acceptance fixture（refactor 形状） | PR1 |

2 PR / 估 ~3-4 天（比 W2-2a 少 1 PR，因 gate-engine 工作 W2-2a PR2 已完成）。

### Race / Risk

- **R-Risk-1**：dispatchStep 加 'scan'/'plan' case 后 `_exhaustive: never` 守 enum 漏补 → typecheck 立刻撞，早发现
- **R-Risk-2**：WorkflowRunType 字面量 mirror 漏改某处 → typecheck 在 narrowing 失败时撞；测试 fixture 用具体字面量也会撞
- **R-Risk-3**：placeholder SkillSpec instructions 输出质量 — 实际 refactor 跑出来 LLM artifact 可能粗糙；本 task 不验证质量，只验证 schema/dispatch；W2-2b 后跟 prompt-tuning follow-up
- **R-Risk-4**：'plan' WorkflowStage 命名与未来某处可能冲突 — 现 grep 'plan' 在 codebase 里多处出现但都是字符串字面量 / 注释 / 变量名，不会和 enum 冲突；规避了 'design' 复用导致的 design_gate 重写
- **R-Risk-5**：UI 端加 'refactor' option 但 UI 测试覆盖薄 — 用户从 UI 选 'refactor' 后能否端到端跑通要 supervised session 验证；本 task 不验证视觉

---

## Decision (ADR-lite) [Q1]

**Context**：V2 § 4.2 给 refactor 形状是 `scan → design → apply`。"design" 该新加 stage 还是复用现有 'design'；"apply" 该新加 stage 还是复用 'implementation'；如复用 'design' 是否需要把 design_gate 也改 stage-history-aware（同 W2-2a Q3 模式）。

**Decision**：方案 **B** — `scan → plan → implementation → build_test → review → completion`，6 步。新增 'scan' / 'plan' 两个 WorkflowStage；不复用 'design'；'apply' 复用 'implementation'。

**Consequences**：
- ✅ 与 W2-2a issue.standard 形状对称（2 新 agent stage + 4 复用后端）
- ✅ 不动 design_gate（避开 W2-2a Q3 类似的二次 stage-history-aware 重写）—— W2-2b PR 数从可能的 3 降为 2
- ✅ 'plan' 命名隔离 feature 'design' 的 REQ-### tracing 假设 — refactor plan 不需要 cite REQ
- ✅ skillId 仍可用 'cs-refactor-design' 保留 CodeStable 用户层术语（W2-4 才消费）
- ❌ 新加 'plan' WorkflowStage 而非完全复用 'design' — enum 多 1 项；但与 'scan' 同等量级开销，可以接受
- ⚠ 未来如 V2 想合并 feature 和 refactor 的 design 阶段（同一个 'design' WorkflowStage），需要把 design_gate 改成 stage-history-aware；本 task 不动

---

## Decision (ADR-lite) [Q2]

**Context**：refactor.standard 的 FlowDef.kind 应该是什么 WorkflowRunType？现 enum 是 `'feature' | 'bugfix' | 'smoke'`；refactor 不属任一。Coordinator 也没产生 'refactor' 信号。

**Decision**：方案 **A** — 加 `'refactor'` 进 WorkflowRunType，FlowDef.kind = 'refactor'。3 处字面量 mirror（shared master + runner api-client × 2 + web main.ts UI type × 1）+ web UI select option 扩展。

**Consequences**：
- ✅ V2 § 4.2 哲学一致 — refactor 是与 feature / issue 并列的第一阶段 3 工作流之一，一等公民
- ✅ FlowId 'refactor.standard' / WorkflowRunType 'refactor' 命名对称（vs W2-2a 的 'bugfix' / 'issue.standard' 命名歧义）
- ✅ W2-4 路由器到时候 type→flowId 映射干净（'refactor' → 'refactor.standard'）
- ❌ 4 处文件 5 行字面量改动（vs W2-2a Q2 零代码改）；但每处都是 1 行 union 扩展，类型 narrowing 守
- ⚠ W2-2a Q2 的 "复用 'bugfix'" 决策与本决策语义对照：W2-2a 复用是因为 Coordinator 已产 'bugfix'（保兼容），W2-2b 不复用是因为没有上游信号（不复用反而更干净）；这种"看上下文决定"是合理的工程权衡，不算 inconsistency
- ⚠ Coordinator 未来若要支持 refactor 路由，需扩 RouteCase / 升级 rules.ts —— 出 task scope，留单独 task

---

## Decision (ADR-lite) [Q0/Q3/Q4/Q5 inherited]

**Context**：W2-2a brainstorm 已经一次性拍板 Q0(split) / Q3(acceptance gate) / Q4(SkillSpec) / Q5(knowledge promotion) 的全局策略。W2-2b 作为 W2-2a 的姊妹 task，没有重新拍板的理由。

**Decision**：本 task 完全 inherit W2-2a 的 Q0 / Q3 / Q4 / Q5 ADRs。

**Consequences**：
- ✅ Brainstorm 节奏快 — 只需拍 Q1 / Q2 两道决策
- ✅ 跨 task 决策一致性强 — issue.standard 与 refactor.standard 形状哲学对齐（2 新 agent stage + 4 复用后端）
- ✅ acceptance_gate stage-history-aware 在 W2-2b 自动适配（PR2 验证）
- ✅ SkillSpec placeholder 模式 + skill.implementation instructions 累加微调 — W2-2a 已写好 implementation 在 issue 场景的 fallback，本 task 在末尾再加 refactor 场景一句
- ⚠ 如未来发现 inherit 决策在某条 flow 上不适用（如 acceptance_gate 对 refactor 行为有问题），单起 follow-up 修；不破坏 inherit 原则

---

## Technical Notes

### 关键文件

| 文件 | 改动 |
|---|---|
| `packages/shared/src/types/workflow.ts` | WorkflowStage enum 加 `'scan'` / `'plan'`；FlowId union 加 `'refactor.standard'`；WorkflowRunType 加 `'refactor'` |
| `packages/shared/src/types/agent.ts` | AgentTaskKind 加 `'scan'` / `'plan'` |
| `apps/runner/src/flows/registry.ts` | 加 REFACTOR_STANDARD FlowDef + 注册到 FLOW_REGISTRY |
| `apps/runner/test/flow-registry.test.ts` | 加 refactor.standard reference array 断言（pinned 6 步顺序） |
| `apps/runner/src/orchestrator.ts` | dispatchStep 加 `case 'scan'` / `case 'plan'`；加 `executeScan(c)` / `executePlan(c)` 命名函数；`mustSkill` 扩；`taskKindForSkill` 扩 |
| `apps/runner/src/skills/index.ts` | SKILLS 加 2 条 placeholder（refactor_scan / refactor_design）+ 改 implementation instructions 末尾追加 refactor_plan reference |
| `apps/runner/src/api-client.ts` | type literal mirror 加 'refactor' (× 2) |
| `apps/runner/src/index.ts` | KNOWN_FLOW_IDS 加 'refactor.standard'；CLI usage string 扩 |
| `apps/web/src/main.ts` | type literal mirror 加 'refactor'；typeSelect option 加 'refactor' |
| `apps/api/src/routes/workflow-runs.ts` | KNOWN_FLOW_IDS 加 'refactor.standard' |
| `apps/api/test/workflow-runs-route.test.ts` | 加 refactor.standard 透传测试 + 更新 unknown flowId reject 错误消息断言 |
| `apps/api/test/gate-engine.test.ts` | 加 refactor.standard 形状的 acceptance fixture（验证 W2-2a stage-history-aware 自动适配） |
| `.trellis/spec/runner/backend/flow-registry.md` | 追加 refactor.standard section + § 5 Good case + § 6 reference |

### V2 doc / Wave 2 / W2-2a 引用

- `docs/2026-05-04-ai-native-platform-v2-design-notes.md` § 1.3 V1 流程僵化 / § 2.1 哲学 1 工作类型多态 / § 4.2 第一阶段 3 种工作流
- W2-2a PRD：`.trellis/tasks/archive/2026-05/05-05-v2-w2-2a-issue-standard-flow/prd.md` — Q0-Q5 ADRs；本 task inherit Q0/Q3/Q4/Q5
- W2-1 spec：`.trellis/spec/runner/backend/flow-registry.md`（5.5 "Adding a new flow" 流程；W2-2a PR3 已扩 issue.standard）
- Wave 2 roadmap：`.trellis/tasks/archive/2026-05/05-04-v2-wave2-workflow-polymorphism/prd.md` Q4 命名约定
