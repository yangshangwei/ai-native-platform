# V2 W2-2a：issue.standard flow 通道

## Goal

扩展 W2-1 落地的 `FLOW_REGISTRY`，加入第三条 flow `issue.standard`——服务 V2 § 4.2 列出的 3 种第一阶段工作流之一（feature / **issue** / refactor）的 issue 通道。Stages 形状 `report → analyze → implementation → build_test → review → completion`（6 步），仅新增 2 个 `WorkflowStage`（`report` / `analyze`）；`fix` 复用 `implementation`（语义同为"agent → diff artifact"，不同 prompt 是 `skillId` 维度，由 W2-4 才生效）。

W2-2a 是 W2-3 后第二个 thin extension 验证点：W2-3 验证了 **feature 内部 variant** 的扩展性，W2-2a 验证 **跨工作类型** 的扩展性——不同 stage 序列、不同 SkillSpec、不同 acceptance 语义下，W2-1 的 thin 抽象是否仍成立。

W2-2b（refactor.standard）后续单起 task。

**Wave 2 上下文**：[`.trellis/tasks/archive/2026-05/05-04-v2-wave2-workflow-polymorphism/prd.md`](../archive/2026-05/05-04-v2-wave2-workflow-polymorphism/prd.md) W2-2 摘要（本 task 是其拆分的第一半）。

**W2-1 上下文**：[`.trellis/tasks/archive/2026-05/05-04-v2-w2-1-flow-registry-bootstrap/prd.md`](../archive/2026-05/05-04-v2-w2-1-flow-registry-bootstrap/prd.md) 4 ADRs（Q1=α thin / Q2 backfill / Q3 createWorkflowRunInput.flowId? / Q4 双轨测试）。

**W2-3 上下文**：[`.trellis/tasks/archive/2026-05/05-05-v2-w2-3-fastforward-channel/prd.md`](../archive/2026-05/05-05-v2-w2-3-fastforward-channel/prd.md) — fastforward 实战节奏（~3 PR / 1 周）。

**spec 文档**：[`.trellis/spec/runner/backend/flow-registry.md`](../../spec/runner/backend/flow-registry.md)（W2-3 PR3 已更新）。

## What I already know

### W2-1 + W2-3 已落地的硬约束（直接 inherit）

- **FlowId**：`<work_kind>.<variant>` — W2-2a 加 `'issue.standard'`
- **FLOW_REGISTRY** (`apps/runner/src/flows/registry.ts`)：`Readonly<Record<FlowId, FlowDef>>`，扩 union 后必须注册条目，否则 tsc 漏注册告警
- **trust-boundary 双 KNOWN_FLOW_IDS**：`apps/api/src/routes/workflow-runs.ts:23` + `apps/runner/src/index.ts:10`，必须同步加 `'issue.standard'`
- **dispatchStep**：`default: _exhaustive: never` 守 WorkflowStage 漏 case；新 stage = 新 case + 新 `executeXxx`
- **StageStep `kind` / `skillId`** 仍是 placeholder（W2-1 ADR Q1=α）；W2-4 才生效
- **WorkflowRun.flowId** NOT NULL DEFAULT 'feature.standard'；不读 NULL 的 fallback 是契约违反

### V2 设计来源

- **V2 doc § 4.2**：第一阶段 3 种工作流 — feature / **issue (report→analyze→fix)** / refactor (scan→design→apply)；其他 escape hatch
- **V2 doc § 1.3**：V1 流程僵化（"改个分号也走 9 步"）短板；fastforward + issue-specific flow 是 V2 修复路径
- **Wave 2 roadmap**：`<work_kind>.<variant>` 命名；issue 加 `report` / `analyze` / `fix` 等候选 stage（"fix" 由本 brainstorm 拍板复用 `implementation`）

### 现有代码（grep 后实地核实）

| 关注点 | 现状 | 启示 |
|---|---|---|
| WorkflowRunType | `'feature' \| 'bugfix' \| 'smoke'`；`'bugfix'` **已上线**：Coordinator 在 `apps/runner/src/agents/coordinator/rules.ts:104-105` 把 bug 类输入路由成 `runType: 'bugfix'`，UI / fixture / 7 处 test 已用 | **不能删** `'bugfix'`；W2-2a 复用作 issue.standard 的 kind |
| acceptance_gate | `apps/api/src/gate-engine.ts:454-504` runAcceptanceTraceabilityGate 5 条 rule，`requirement_present` / `design_present` 在 issue.standard 上必 fail | **必须改** —— stage-history-aware 路径（Q3 ADR） |
| findSkillForStage | `apps/runner/src/skills/index.ts:224` 单一 stage→SkillSpec lookup；SKILLS 数组现 5 条 | **不动 lookup**，仅扩 SKILLS 数组（Q4 ADR） |
| mustSkill | `apps/runner/src/orchestrator.ts:669-673` 类型 hard-coded 4 stage | 类型签名扩 + 加 'report' / 'analyze' |
| promoteAcceptedDraftToKnowledge | `apps/api/src/promote.ts:68-69` 硬编码只走 `requirement_draft → requirement` / `design_doc → design` | **不动** —— issue.standard 不跑 requirement/design step → draftsToPromote 自然空 → for 循环空转（Q5 ADR） |
| ArtifactKind / KnowledgeArtifactKind | per-run 12 类（含 `'other'`），knowledge 10 类 | **不扩** —— issue analysis 留 per-run kind='other'（Q5 ADR） |

## Assumptions (confirmed)

- **A1**. issue.standard 的 FlowDef.kind = `'bugfix'`（不扩 WorkflowRunType；spec 文档显式说明命名映射）
- **A2**. 不引入新 KnowledgeArtifactKind / 不动 `promoteAcceptedDraftToKnowledge`（analysis_doc / report 留 per-run kind='other'）
- **A3**. issue.standard 不跑 `context_pack` / `requirement` / `design` / `knowledge` step（仅 6 步：`report` → `analyze` → `implementation` → `build_test` → `review` → `completion`）
- **A4**. SkillSpec instructions 用 placeholder 简化版（足够 LLM 输出 schema-correct artifact）；prompt 精雕留 follow-up
- **A5**. `skill.implementation.inputs[design.md].required: true → false` 不影响 feature.standard 行为（feature 仍跑 design step → 写入 inputs.design.md）
- **A6**. acceptance_gate stage-history-aware 改造同时修复 W2-3 PRD R-Risk-2（fastforward 跑不过 acceptance_gate）— fastforward 也没跑 requirement/design step → 同样跳过两条 rule
- **A7**. 不激活 StageStep.kind / skillId 字段消费（保 W2-1 ADR Q1=α；W2-4 才动）
- **A8**. 不动 Coordinator routing（`routeCase: 'bugfix'` / `runType: 'bugfix'` 输出契约保留；'bugfix' → 'issue.standard' 的 flow 映射是 W2-4 路由器的事）

## Open Questions（全部已拍板）

> 5 道 Q 全部一次性拍定（user 在 brainstorm 阶段授权"后续按推荐执行"）。

### ✅ Q0：W2-2 拆分策略

**决策**：方案 **A** — 拆 W2-2a (issue.standard) + W2-2b (refactor.standard) 两个独立 child task。本 task 仅做 issue.standard。详见 ADR Q0。

### ✅ Q1：issue.standard 的 stage 序列

**决策**：方案 **A** — `report → analyze → implementation → build_test → review → completion`，6 步。仅新增 2 个 WorkflowStage 值：`report`、`analyze`。`fix` 复用 `implementation`（不同 prompt 由 `skillId` 维度区分，W2-4 激活）。详见 ADR Q1。

### ✅ Q2：WorkflowRunType 对接

**决策**：方案 **A** — issue.standard 的 FlowDef.kind = `'bugfix'`，**不扩** WorkflowRunType。零既有代码改动；spec 文档兜底命名映射。详见 ADR Q2。

### ✅ Q3：acceptance_gate 在 issue.standard 上的行为

**决策**：方案 **C** — gate-engine `runAcceptanceTraceabilityGate` 改 stage-history-aware：检查 `store.stepRuns.byWorkflow(runId)` 是否跑过 `stage='requirement'` / `stage='design'` 的 step；没跑 → 对应 rule 返回 `pass` with note `'not applicable: stage not in this flow'`；跑了但 artifact 缺失 → 保留原硬 fail。同时修 W2-3 R-Risk-2。详见 ADR Q3。

### ✅ Q4：SkillSpec 落法

**决策**：方案 **B** — 加 2 条 placeholder SkillSpec（`skill.issue_report` stage='report' / `skill.issue_analyze` stage='analyze'），instructions = 简化 placeholder 足够 LLM 输出 schema-correct artifact；`skill.implementation.inputs[design.md].required: true → false`，instructions 加 "If design is absent, use analysis_doc / report as primary reference"。`findSkillForStage` 不动。详见 ADR Q4。

### ✅ Q5：knowledge promotion 边界

**决策**：方案 **A** — 不扩 KnowledgeArtifactKind；issue.standard 的 analysis / report 留 per-run kind='other'；不动 `promoteAcceptedDraftToKnowledge`。详见 ADR Q5。

## Requirements

### 兼容性

- **R1**. V1 / W2-1 / W2-3 行为零回归（feature.standard 8 步 / feature.fastforward 4 步路径完全不变）
- **R2**. acceptance_gate stage-history-aware 改造**顺带修复** W2-3 R-Risk-2：fastforward 端到端 happy path（无 requirement/design 但有 diff/review/test_gate）现在能跑通

### shared 类型 (Q1)

- **R3**. `WorkflowStage` enum 加 `'report'` / `'analyze'`：完整列表变为 `'init' | 'context_pack' | 'requirement' | 'design' | 'implementation' | 'build_test' | 'review' | 'completion' | 'knowledge' | 'report' | 'analyze'`
- **R4**. `FlowId` 字面量联合扩为 `'feature.standard' | 'feature.fastforward' | 'issue.standard'`
- **R5**. `WorkflowRunType` **不变**（保 `'feature' | 'bugfix' | 'smoke'`）

### runner registry (Q1, Q2)

- **R6**. `FLOW_REGISTRY` 加 `'issue.standard'` 条目，结构与现 entries 一致：`{ id, kind: 'bugfix', description, stages: readonly StageStep[] }`
- **R7**. `issue.standard.stages` 严格顺序：`['report', 'analyze', 'implementation', 'build_test', 'review', 'completion']`（6 步）
- **R8**. `issue.standard` StageStep.kind 分类：`report`/`analyze`/`implementation`/`review` = `'agent'`；`build_test`/`completion` = `'engine'`（沿用 W2-1 PR2 的 kind 哲学）
- **R9**. `issue.standard` StageStep.skillId 占位：`report='cs-issue-report'` / `analyze='cs-issue-analyze'` / `implementation='cs-issue-fix'` / `review='cs-feat-accept'`（注：本 task 仍是 placeholder，dispatchStep 不消费；W2-4 激活）

### orchestrator dispatchStep (Q1)

- **R10**. `dispatchStep` switch 增加 `case 'report'` / `case 'analyze'`，分别调用新 `executeReport(c)` / `executeAnalyze(c)` 命名函数
- **R11**. `executeReport(c: RunCtx)`：`mustSkill('report')` → `invokeSkill` → `postArtifact(kind: 'other', name: 'report.md')` → `finishAgentSuccess` → `stepFinished('passed')`
- **R12**. `executeAnalyze(c: RunCtx)`：`mustSkill('analyze')` → `invokeSkill` → `postArtifact(kind: 'other', name: 'analysis_doc.md')` → `finishAgentSuccess` → `stepFinished('passed')`
- **R13**. `mustSkill` 类型签名扩为接受 `'requirement' | 'design' | 'implementation' | 'review' | 'report' | 'analyze'`
- **R14**. `executeReport` / `executeAnalyze` 共享 `RunCtx`（不引新 ctx 类型）；按 W2-1 PR3 的"行内 inner function"风格

### SkillSpec (Q4)

- **R15**. SKILLS 数组加 `skill.issue_report`：
  - `id: 'skill.issue_report'`, `version: '0.1.0'`, `stage: 'report'`
  - `inputs`: `[{ name: 'user_request', kind: 'text', required: true }]`
  - `outputs`: `[{ name: 'report.md', kind: 'artifact', required: true }]`
  - `instructions`: placeholder（含 frontmatter 要求 `doc_type: report` + REPT-### + 4 sections: 现象/复现步骤/期望 vs 实际/影响范围；HARD RULE: 不猜根因）
  - `requiredGates: []`, `compatibleBackends: ALL`
- **R16**. SKILLS 数组加 `skill.issue_analyze`：
  - `id: 'skill.issue_analyze'`, `version: '0.1.0'`, `stage: 'analyze'`
  - `inputs`: `[{ name: 'report.md', kind: 'artifact', required: true }]`
  - `outputs`: `[{ name: 'analysis_doc.md', kind: 'artifact', required: true }]`
  - `instructions`: placeholder（含 frontmatter `doc_type: analysis` + ANL-### + sections: 根因/2-3 个修复方案/推荐方案/风险；HARD RULE: 每条断言 cite `src/...:NN`）
  - `requiredGates: []`, `compatibleBackends: ALL`
- **R17**. 修改 `skill.implementation`：
  - `inputs[design.md].required: true → false`
  - `instructions` 末尾加一句："If `design.md` is absent (e.g. issue.standard flow), use `analysis_doc.md` (or `report.md` as last resort) as primary reference; stay within paths surfaced in those docs."
- **R18**. `findSkillForStage` 不动（按 stage 单一 lookup 仍 work；issue / feature 共享 `implementation` SkillSpec）

### gate-engine (Q3)

- **R19**. `runAcceptanceTraceabilityGate` (`apps/api/src/gate-engine.ts:454`) 改 stage-history-aware：
  - 增加 `const stagesRun = new Set(store.stepRuns.byWorkflow(workflowRunId).map(s => s.stage))`
  - `acceptance.requirement_present` rule：`if (!stagesRun.has('requirement')) → status='pass', message='not applicable: requirement stage not in this flow'`；否则原 logic（`status: requirement ? 'pass' : 'fail'`）
  - `acceptance.design_present` rule：同上但对 `'design'` stage
  - `acceptance.diff_present` / `review_present` / `test_gate_passed` rule **不变**（对 issue.standard 仍要求；issue.standard 跑 implementation→ diff，跑 review → review artifact，跑 build_test → test_gate）
- **R20**. 既有 acceptance_gate 行为零回归 — feature.standard fixture（跑过 requirement/design step）按原逻辑（artifact present → pass / artifact missing → fail）

### entry contract

- **R21**. `apps/api/src/routes/workflow-runs.ts:23` `KNOWN_FLOW_IDS` 加 `'issue.standard'`
- **R22**. `apps/runner/src/index.ts:10` `KNOWN_FLOW_IDS` 加 `'issue.standard'`

### 测试

- **R23**. shared / runner / api / web 4/4 包 typecheck pass
- **R24**. 全套测试零回归（W2-3 baseline 365）+ 新增 ≥ 6 条覆盖：
  - (a) issue.standard stages 顺序断言（reference array `['report','analyze','implementation','build_test','review','completion']`，flow-registry.test.ts）
  - (b) `FLOW_REGISTRY['issue.standard'].kind === 'bugfix'`
  - (c) FlowId union 含 'issue.standard'（type smoke）
  - (d) gate-engine stage-history-aware：feature 行为不变（≥ 1 fixture 含 requirement/design step + artifact → pass；含 step 但缺 artifact → fail）
  - (e) gate-engine stage-history-aware：issue 形状（无 requirement/design step）→ requirement_present + design_present rule pass with N/A note；其他 rule 按真实状态
  - (f) route 透传：`POST /workflow-runs body.flowId='issue.standard'` → 创建 run.flowId === 'issue.standard'
  - (g) CLI 透传：`runner orchestrate --flow-id issue.standard` 透传到 api 层
- **R25**. mustSkill 拒绝未知 stage（`mustSkill('init')` throw with stage name in message）

### 文档

- **R26**. `.trellis/spec/runner/backend/flow-registry.md` 追加 `issue.standard` section，覆盖：
  - stages 形状（6 步） + StageStep.kind/skillId 占位说明
  - Q2 的 `FlowDef.kind = 'bugfix'` 命名映射 + 与 Coordinator 的对接路径
  - Q3 stage-history-aware acceptance gate 语义（顺带覆盖 fastforward 修复说明）
  - Q4 SkillSpec placeholder 说明（issue_report / issue_analyze instructions 是简化 placeholder；prompt-tuning follow-up）
  - Q5 不扩 knowledge promotion 的设计取舍（analysis 留 per-run）

## Acceptance Criteria

### 兼容性

- [ ] **AC-1**. typecheck 4/4 包 PASS
- [ ] **AC-2**. 全套测试零回归（baseline 365；新增 ≥ 6 条）
- [ ] **AC-3**. V1 / feature.standard / feature.fastforward 行为路径不变（任何不显式传 `flowId='issue.standard'` 的调用方仍走默认路径）

### 类型 / 数据 (Q1, Q2)

- [ ] **AC-4**. `WorkflowStage` enum 包含 `'report'` 和 `'analyze'`
- [ ] **AC-5**. `FlowId` 字面量联合包含 `'issue.standard'`
- [ ] **AC-6**. `FLOW_REGISTRY['issue.standard'].stages.length === 6`
- [ ] **AC-7**. `FLOW_REGISTRY['issue.standard'].stages.map(s => s.stage)` 严格等于 `['report', 'analyze', 'implementation', 'build_test', 'review', 'completion']`
- [ ] **AC-8**. `FLOW_REGISTRY['issue.standard'].kind === 'bugfix'`
- [ ] **AC-9**. `FLOW_REGISTRY['feature.standard']` 8 步 + `FLOW_REGISTRY['feature.fastforward']` 4 步 不变（reference array 仍 pin）

### dispatchStep / executeXxx (Q1)

- [ ] **AC-10**. `dispatchStep` switch 含 `case 'report'` / `case 'analyze'`；`_exhaustive: never` 默认分支保留 typecheck 安全
- [ ] **AC-11**. `executeReport` 写 `report.md` artifact（kind='other'），`executeAnalyze` 写 `analysis_doc.md` artifact（kind='other'）
- [ ] **AC-12**. `mustSkill('report')` / `mustSkill('analyze')` 返回非 undefined SkillSpec

### gate-engine (Q3)

- [ ] **AC-13**. fixture: feature.standard 形状（跑过 requirement+design step + 完整 artifact）→ acceptance_gate.status === 'pass'（原行为）
- [ ] **AC-14**. fixture: feature.standard 形状（跑过 requirement step 但 artifact 缺失）→ acceptance_gate.status === 'fail'（**回归保护**）
- [ ] **AC-15**. fixture: issue.standard 形状（无 requirement/design step；有 diff/review/test_gate）→ acceptance_gate.status === 'pass'，requirement_present + design_present rule 是 'pass' with N/A note
- [ ] **AC-16**. fixture: fastforward 形状（无 requirement/design step + 有 diff/review/test_gate）→ acceptance_gate.status === 'pass'（**W2-3 R-Risk-2 实证修复**）

### SkillSpec (Q4)

- [ ] **AC-17**. SKILLS 数组含 `stage: 'report'` 和 `stage: 'analyze'` 各一条
- [ ] **AC-18**. `skill.implementation.inputs.find(x => x.name === 'design.md').required === false`
- [ ] **AC-19**. `skill.implementation.instructions` 包含 "if design is absent" 的 graceful 处理一句

### 入口契约

- [ ] **AC-20**. `POST /workflow-runs body.flowId='issue.standard'` → 创建的 `run.flowId === 'issue.standard'`，DB workflow_runs.flow_id 写入相同
- [ ] **AC-21**. `runner orchestrate --flow-id issue.standard` → cmdOrchestrate 透传到 api.createWorkflowRun
- [ ] **AC-22**. `POST /workflow-runs body` 不带 flowId → `run.flowId === 'feature.standard'`（缺省路径不动）
- [ ] **AC-23**. `POST /workflow-runs body.flowId='unknown.x'` → HTTP 400（KNOWN_FLOW_IDS 守门）

### 工程

- [ ] **AC-24**. `bun test` green；`bun run --filter '*' typecheck` green
- [ ] **AC-25**. spec 文档 `.trellis/spec/runner/backend/flow-registry.md` 追加 issue.standard section

## Definition of Done

- 单元 + integration 测试全过
- typecheck 4/4 全清
- 不破坏 W2-1 / W2-3 / V2 Wave 1 / V1 行为
- spec 文档同步
- placeholder SkillSpec instructions 足够 LLM 输出 schema-correct artifact（不要求 prompt 精雕；留 follow-up）

## Out of Scope (explicit)

- ❌ refactor.standard flow（W2-2b）
- ❌ 智能路由器（W2-4 — issue.standard 只能由 user 显式传 `flowId='issue.standard'` 触发）
- ❌ 激活 StageStep.kind / skillId 路由（findSkillForStage 仍按 stage 单一 lookup；W2-4 才动）
- ❌ KnowledgeArtifactKind 扩展（issue analysis / report 留 per-run kind='other'）
- ❌ `'bugfix'` → `'issue'` 名义重命名（跨 task 的 V1→V2 术语清洗，本 task 不动）
- ❌ cs-issue-* prompt 精雕（本 task 用 placeholder；prompt-tuning follow-up）
- ❌ Web UI 选 issue.standard 入口（浏览器验证留 supervised 会话）
- ❌ 自动检测 "用户描述像 bug" 并选 issue.standard（W2-4）
- ❌ Coordinator 输出 routing 改动（routeCase / runType 'bugfix' 输出契约保留）

## Technical Approach

### PR 拆分

| PR | 范围 | 阻塞 |
|---|---|---|
| **PR1** | shared 类型扩（WorkflowStage 加 report/analyze；FlowId 加 issue.standard）+ FLOW_REGISTRY 加 issue.standard 条目 + dispatchStep 加 case + executeReport/executeAnalyze 实现 + mustSkill 扩 + SKILLS 加 2 条 placeholder + skill.implementation 改 inputs/instructions + flow-registry.test.ts 加 issue.standard reference array | — |
| **PR2** | gate-engine `runAcceptanceTraceabilityGate` stage-history-aware 改造 + 新 fixture 三条（feature pass / feature regression-fail / issue skip / fastforward skip） | PR1 |
| **PR3** | 双 KNOWN_FLOW_IDS 加 'issue.standard'（route + CLI）+ 路由 / CLI 透传测试 + spec 文档追加 issue.standard section | PR1 / PR2 任意时序 |

3 PR / 估 1 周（与 W2-3 节奏对齐）。

### Race / Risk

- **R-Risk-1**：dispatchStep 加 'report'/'analyze' case 后 `_exhaustive: never` 守 enum 漏补 → typecheck 立刻撞，早发现
- **R-Risk-2**：gate-engine stage-history-aware 改造可能影响 feature.standard 既有 fixture — AC-13/AC-14 严格保护，必加 regression test
- **R-Risk-3**：placeholder SkillSpec instructions 输出质量 — 实际 issue 跑出来 LLM artifact 可能粗糙；本 task 不验证质量，只验证 schema/dispatch；W2-2a 后跟 prompt-tuning follow-up
- **R-Risk-4**：'bugfix' 命名歧义（type='bugfix' vs flowId='issue.standard'）— spec 文档兜底；W2-4 路由器决定 type→flowId 映射策略
- **R-Risk-5**：`skill.implementation.inputs[design.md].required: false` 是契约弱化 — feature.standard 行为不变（design 仍由 design step 写入），但 SkillSpec schema 变松；spec 文档解释

---

## Decision (ADR-lite) [Q0]

**Context**：Wave 2 roadmap 把 W2-2 估为 2 周 / 5+ PR 单 task。但 W2-3 实战证明单 flow extension ≈ 1 周 / 3 PR；2 条独立 flow 合并稀释扩展性证明信号。

**Decision**：拆 W2-2a (issue.standard) + W2-2b (refactor.standard) 两个独立 child task。本 task 仅做 issue.standard。

**Consequences**：
- ✅ 每条 flow 独立验证 W2-1 thin 抽象的扩展性
- ✅ PR 数与 W2-3 节奏对齐（~3 PR / 1 周）
- ✅ WorkflowStage enum 在 W2-2a 一次到位（PR1 加 'report' / 'analyze'）；W2-2b 只加 refactor 自己需要的（'scan' 等）
- ❌ Wave 2 总 task 数从 4 涨到 5（roadmap 估算的"2 周做 W2-2"折变 2 个 1 周 child）
- ⚠ W2-2b 起 task 时建议 brainstorm 在本 W2-2a PRD 基础上 inherit Q0-Q5 决策

---

## Decision (ADR-lite) [Q1]

**Context**：V2 § 4.2 给 issue 形状是 "report → analyze → fix"。"fix" 该是新 stage 还是复用 implementation；是否需要单独 'verify' stage（"did the fix actually fix"）；端到端最少几步。

**Decision**：方案 **A** — `report → analyze → implementation → build_test → review → completion`，6 步。仅新增 'report' / 'analyze' 两个 WorkflowStage。

**Consequences**：
- ✅ 最小 enum 扩展（每加一个 WorkflowStage = dispatchStep case + executeXxx + 测试覆盖）
- ✅ 'fix' 的语义 = 'implementation'（"agent → diff artifact"）一致；不同 prompt 由 skillId 维度区分（W2-4 激活）
- ✅ 'verify' 与 build_test + acceptance_gate 重叠，不必引入
- ✅ 与 W2-3 fastforward 同模式（复用 implementation / build_test / review / completion）；refactor.standard 同样可以套（仅加 'scan'）
- ❌ 'implementation' 在 issue 场景拿 cs-feat-impl 风格 prompt — 用 SkillSpec instructions 兜底（Q4 微调）
- ⚠ dispatchStep 的 _exhaustive 守 enum 漏补，typecheck 立刻撞

---

## Decision (ADR-lite) [Q2]

**Context**：Coordinator (`apps/runner/src/agents/coordinator/rules.ts:104-105`) 已经把 bug 类输入路由成 `runType: 'bugfix'`，UI / fixture / 7 处测试已上线。三选：复用 'bugfix' / 加 'issue' 保 'bugfix' 兼容 / 加 'issue' 全面 rename 删 'bugfix'。

**Decision**：方案 **A** — issue.standard 的 FlowDef.kind = `'bugfix'`，**不扩** WorkflowRunType。零既有代码改动。

**Consequences**：
- ✅ 保 W2-3 thin extension 节奏（零既有代码改）
- ✅ Coordinator 已就位的 'bugfix' 路由直接对接 W2-4 path：`type='bugfix' → flowId='issue.standard'` 是 W2-4 路由器加一行映射的事
- ❌ DB 行同时含 type='bugfix' + flowId='issue.standard'，命名歧义债务（spec 兜底）
- ⚠ 未来如 V2 想真正把术语统一为 'issue'，单起一个 task 做（含 DB row backfill / coordinator API contract change）；本 task 不动

---

## Decision (ADR-lite) [Q3]

**Context**：`runAcceptanceTraceabilityGate` 的 5 条 rule 中 `requirement_present` / `design_present` 在 issue.standard 上必 fail（issue 无对应 artifact）。三选：runner 端 `executeAcceptance` flowId-aware / api 端 gate-engine flowId-aware / api 端 gate-engine stage-history-aware。

**Decision**：方案 **C** — gate-engine `runAcceptanceTraceabilityGate` 改 stage-history-aware：检查 `store.stepRuns.byWorkflow(runId)` 是否跑过 `stage='requirement'` / `stage='design'` 的 step；没跑 → 对应 rule pass with N/A note；跑了但 artifact 缺失 → 保留原硬 fail。

**Consequences**：
- ✅ gate-engine 完全不知道 FlowId / FLOW_REGISTRY（保单一职责，无跨包知识耦合）
- ✅ feature.standard 行为零回归（跑过 requirement/design step → 原硬 fail 行为；AC-13/AC-14 守）
- ✅ W2-3 R-Risk-2（fastforward 跑不过 acceptance gate）顺带修复 — fastforward 也没跑 requirement/design → 跳过 rule（AC-16）
- ✅ 行为正确性：traceability rule 的本质是"承诺产 X 的 run 必须真产了 X"，没承诺产的 run 不该 fail
- ❌ stepRuns 历史查询每次 acceptance gate 加一次 store 调用（已在 store 内，无新依赖；性能 O(rows-of-current-run)）
- ⚠ 测试 fixture 需扩：feature.standard 现存 fixture 跑过 requirement/design step，issue.standard / fastforward fixture 需新增（无 requirement/design step）

---

## Decision (ADR-lite) [Q4]

**Context**：`findSkillForStage` 单一 stage→SkillSpec lookup；issue.standard 加 'report'/'analyze' 必须有对应 SkillSpec；'implementation' 在 issue 场景需要 graceful 处理无 design.md。激活 (flowId, stage) 二元路由是 W2-4 边界。

**Decision**：方案 **B** — 加 2 条 placeholder SkillSpec (skill.issue_report stage='report' / skill.issue_analyze stage='analyze')，instructions = 简化 placeholder；`skill.implementation.inputs[design.md].required: true → false`，instructions 加 "If design is absent, use analysis_doc / report as primary reference"。`findSkillForStage` 不动。

**Consequences**：
- ✅ 不激活 skillId 路由（保 W2-1 ADR Q1=α；W2-4 才动）
- ✅ implementation 在 issue 场景能跑（input schema 不再 require design.md）
- ✅ feature.standard 不动（design 仍由 design step 写入 inputs.design.md）
- ❌ placeholder instructions 不会精雕 → issue 流程 LLM 输出质量取决于 placeholder 质量
- ⚠ `skill.implementation.inputs.design.required = false` 是契约弱化 — 不影响 feature 行为；spec 文档解释；prompt-tuning 留 follow-up

---

## Decision (ADR-lite) [Q5]

**Context**：issue.standard 产 analysis_doc / report 等 markdown artifact。是否扩 KnowledgeArtifactKind 把它们持久化进 knowledge layer？是否动 `promoteAcceptedDraftToKnowledge`？

**Decision**：方案 **A** — 不扩 KnowledgeArtifactKind；issue analysis / report 留 per-run artifact (kind='other')；不动 `promoteAcceptedDraftToKnowledge`。draftsToPromote 在 issue.standard 上自然空（issue 不跑 requirement/design step），acceptance promotion 循环空转。

**Consequences**：
- ✅ 工程范围最小 — 不动 promote 路径节省 1 PR
- ✅ V2 KnowledgeArtifactKind 不膨胀 — 10 类已饱和，加新 kind 应有充分理由
- ✅ issue 一次性的"修这个 bug 的 analysis"语义不复用，不该作为 project knowledge
- ❌ issue 流程后期如出现"bug pattern"复用需求（这类 bug 反复出现），需用 `lesson:pitfall` subtype 间接表达 — V2 已支持
- ⚠ 跨 task 一致性 — W2-2b refactor.standard 同样推荐不扩 knowledge kind（refactor_plan 留 per-run）

---

## Technical Notes

### 关键文件

| 文件 | 改动 |
|---|---|
| `packages/shared/src/types/workflow.ts:3-12` | WorkflowStage enum 加 `'report'` / `'analyze'` |
| `packages/shared/src/types/workflow.ts:61` | FlowId union 加 `'issue.standard'` |
| `apps/runner/src/flows/registry.ts` | 加 ISSUE_STANDARD FlowDef + 注册到 FLOW_REGISTRY |
| `apps/runner/test/flow-registry.test.ts` | 加 issue.standard reference array 断言（pinned 6 步顺序） |
| `apps/runner/src/orchestrator.ts:195-233` | dispatchStep switch 加 `case 'report'` / `case 'analyze'` |
| `apps/runner/src/orchestrator.ts:240-` | 加 `executeReport(c)` / `executeAnalyze(c)` 命名函数（沿用 W2-1 PR3 inner-function 风格） |
| `apps/runner/src/orchestrator.ts:669-673` | `mustSkill` 类型签名扩 |
| `apps/runner/src/skills/index.ts:14-212` | SKILLS 加 2 条 placeholder（issue_report / issue_analyze） + 改 implementation inputs.design.required + 改 implementation instructions |
| `apps/api/src/gate-engine.ts:454-504` | `runAcceptanceTraceabilityGate` 改 stage-history-aware |
| `apps/api/test/*.test.ts` | acceptance_gate 新 fixture（feature pass/regression-fail / issue skip / fastforward skip） |
| `apps/api/src/routes/workflow-runs.ts:23` | KNOWN_FLOW_IDS 加 `'issue.standard'` |
| `apps/runner/src/index.ts:10` | KNOWN_FLOW_IDS 加 `'issue.standard'` |
| `.trellis/spec/runner/backend/flow-registry.md` | 追加 issue.standard section |

### V2 doc / Wave 2 / W2-1 / W2-3 引用

- `docs/2026-05-04-ai-native-platform-v2-design-notes.md` § 1.3 V1 流程僵化 / § 2.1 哲学 1 工作类型多态 / § 4.2 第一阶段 3 种工作流
- W2-1 spec：`.trellis/spec/runner/backend/flow-registry.md`（5.5 "Adding a new flow" 流程）
- W2-3 PRD R-Risk-2：fastforward acceptance_gate 跑不过 known issue → Q3 stage-history-aware 修复
- Wave 2 roadmap：`.trellis/tasks/archive/2026-05/05-04-v2-wave2-workflow-polymorphism/prd.md` Q4 命名约定
