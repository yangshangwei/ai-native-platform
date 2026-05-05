# V2 W2-3：feature.fastforward flow 通道

## Goal

扩展 W2-1 落地的 `FLOW_REGISTRY`，加入第二条 flow `feature.fastforward`——`feature.standard` 的精简子集，**跳过** `context_pack` / `requirement` / `design` / `knowledge` 四个重前置阶段，只跑 `implementation` → `build_test` → `review` → `completion` 4 步。让用户对"改个分号也走 9 步"的小改动场景显式选 fastforward 通道（V2 doc § 1.3 短板的直接修复）。

W2-3 是 V2 Wave 2 关键路径第 2 步——**W2-1 抽出的 FLOW_REGISTRY 接口的第一个真实扩展性验证点**。stages 列表是子集，单数据结构、单 dispatch 路径，没有任何新机制——若 W2-3 一周打完且零回归，证明 W2-1 的 thin 抽象选对了。

**Wave 2 上下文**：[`.trellis/tasks/archive/2026-05/05-04-v2-wave2-workflow-polymorphism/prd.md`](../archive/2026-05/05-04-v2-wave2-workflow-polymorphism/prd.md) 第 143-149 行 W2-3 摘要。

**W2-1 上下文**：[`.trellis/tasks/archive/2026-05/05-04-v2-w2-1-flow-registry-bootstrap/prd.md`](../archive/2026-05/05-04-v2-w2-1-flow-registry-bootstrap/prd.md) 4 ADRs（Q1=α thin / Q2 backfill / Q3 createWorkflowRunInput.flowId? / Q4 双轨测试）。spec 文档：[`.trellis/spec/runner/backend/flow-registry.md`](../../spec/runner/backend/flow-registry.md)。

## What I already know

### W2-1 已落地（直接 inherit，不动）

- **FlowId** (`packages/shared/src/types/workflow.ts:54`)：字符串字面量联合，目前只 `'feature.standard'`
- **FlowDef / StageStep** (同文件 79-103)：`{ id, kind: WorkflowRunType, description, stages: readonly StageStep[] }`
- **FLOW_REGISTRY** (`apps/runner/src/flows/registry.ts`)：`Readonly<Record<FlowId, FlowDef>>`，单条目 `feature.standard`
- **runWorkflow dispatch**：`for (const step of FLOW_REGISTRY[run.flowId].stages) await dispatchStep(step, ctx)`，dispatchStep 内 switch step.stage 分到 runContextPack / runStage / executeXxx
- **DB**：`workflow_runs.flow_id TEXT NOT NULL DEFAULT 'feature.standard'`
- **API**：`createWorkflowRun(params)` 接受可选 `flowId?: FlowId`，缺省 `'feature.standard'`

### V1 / W2-1 还未透传 flowId 的入口（W2-3 必须补）

- **HTTP route** `POST /workflow-runs`（`apps/api/src/routes/workflow-runs.ts:24-55`）：body 类型只含 `projectId / projectName / type / title / sourceBranch`，**不读 flowId**，直接调 `createWorkflowRun(...)` 永远缺省 `'feature.standard'`
- **runner CLI**：`apps/runner/src/cmd/run.ts:43` 调 `api.createWorkflowRun({ projectName, title })`，**没有 --flow-id 标志**
- **runner api-client** `createWorkflowRun()`（`apps/runner/src/api-client.ts:54-60`）：参数类型不含 flowId

### V2 哲学锚点

- V2 doc § 1.3 直接吐槽 V1 "改个分号也走 9 步"——fastforward 即此痛点的修复
- V2 doc § 4.2 "第一阶段先做 3 种工作流：feature / issue / refactor。其他类型做成 escape hatch"——fastforward 不算新工作类型，是 feature 的变体（FlowId `feature.fastforward` 命名暗示了这一点，符合 W2-1 ADR Q4 的 `<work_kind>.<variant>` 约定）

## Assumptions (confirmed)

- A1. fastforward **不引入新 WorkflowStage enum 值**——只是 `feature.standard` 的子集，复用现有 8 个 stage 中的 4 个
- A2. fastforward 没有 requirement/design 阶段，所以 `c.draftsToPromote` 在 executeAcceptance 时为空——`for (const draft of c.draftsToPromote)` 自然空转，不需要改 executeAcceptance 逻辑
- A3. `acceptance_gate` 引擎在 fastforward 场景（缺 traceability artifact）的行为按现行逻辑——本 task 不调整 gate；如发现行为偏差另起 follow-up
- A4. 现有 V1 / W2-1 行为零回归（默认 flowId 仍是 `feature.standard`，所有现存调用方/测试不变）
- A5. UI 入口（Web 项目首页 "Fast-forward" 按钮）**不在本 task 范围**——UI 改动需浏览器验证，留作后续 supervised 会话或 PR4

## Open Questions（全部已拍板）

> 全 4 道 Q 在 task open 时一次性按推荐拍板（user 授权 autonomous 模式 + 直接干）。决策依据见 ADR-lite 各节。

### ✅ Q1：fastforward 包含哪些 stage
**决策**：**4 步**——`implementation` → `build_test` → `review` → `completion`。详见 ADR Q1。

### ✅ Q2：FlowId union 扩展形态
**决策**：在 `packages/shared/src/types/workflow.ts` 把 `FlowId` 从 `'feature.standard'` 扩为 `'feature.standard' | 'feature.fastforward'`，单文件单点改动。详见 ADR Q2。

### ✅ Q3：HTTP route 入口契约
**决策**：扩 `POST /workflow-runs` body 类型加 `flowId?: FlowId`，转发给 `createWorkflowRun`；缺省仍 `'feature.standard'`，所有现存调用方零改动。详见 ADR Q3。

### ✅ Q4：runner CLI 入口契约
**决策**：`OrchestrateOpts` + `cmdOrchestrate` 加 `flowId?: FlowId`；CLI 加 `--flow-id <FlowId>` 标志；`api-client.createWorkflowRun` 透传。详见 ADR Q4。

## Requirements

### 兼容性
- R1. V1 / W2-1 行为零回归（缺省路径仍走 `feature.standard`）
- R2. W2-1 留下的 352 测试基线零下降
- R3. workflow_runs schema 不变（W2-1 已加 flow_id 列）

### 新功能（Q1-Q4 派生）
- R4. **shared**：`FlowId` 字面量联合扩为 `'feature.standard' | 'feature.fastforward'`
- R5. **runner registry**：`FLOW_REGISTRY` 加 `'feature.fastforward'` 条目，结构与 `feature.standard` 一致（kind: 'feature' / description / stages: readonly StageStep[]）
- R6. **fastforward stages 严格顺序**：`['implementation', 'build_test', 'review', 'completion']`（4 步）
- R7. **fastforward StageStep.kind**：implementation/review = 'agent'；build_test/completion = 'engine'（沿用 W2-1 PR2 的 kind 分类哲学）
- R8. **fastforward StageStep.skillId**：implementation: 'cs-feat-impl' / review: 'cs-feat-accept'（沿用 W2-1 PR2 的命名；kind/skillId 在 W2-3 仍是 placeholder，W2-3 不消费）
- R9. **API route**：`POST /workflow-runs` body 接受可选 `flowId?: FlowId`，转发到 `createWorkflowRun(...)`；缺省 `'feature.standard'` 不变
- R10. **runner api-client**：`api.createWorkflowRun({ projectName, title, type?, sourceBranch?, flowId? })` 把 flowId 透传到 POST body
- R11. **runner CLI**：`cmdOrchestrate` 的 `OrchestrateOpts` 加 `flowId?: FlowId`；`cmdRun` 也接 `flowId?` 透传
- R12. **runner CLI flag**：`runner run` / `runner orchestrate` 增加 `--flow-id <FlowId>` 标志（缺省 'feature.standard'）

### 测试
- R13. shared 和 runner 4/4 包 typecheck pass
- R14. 全套测试零回归（baseline 352 + 新增 ≥ 4 条覆盖 fastforward stage 顺序 + 路由透传）
- R15. fastforward 单测断言 stages 顺序严格匹配 reference array `[implementation, build_test, review, completion]`
- R16. route 单测覆盖：（a）缺省 flowId → 'feature.standard'；（b）显式 'feature.fastforward' → 透传

### 文档
- R17. `.trellis/spec/runner/backend/flow-registry.md` 追加 fastforward section（说明 stages 子集语义 + 触发器）

## Acceptance Criteria

### 兼容性
- [ ] AC-1. typecheck 4/4 包 PASS
- [ ] AC-2. 全套测试零回归（baseline 352；新增 ≥ 4 条）
- [ ] AC-3. V1 默认 flowId 路径行为不变（任何不显式传 flowId 的调用方 → workflow_runs.flow_id = 'feature.standard'）

### 类型 / 数据
- [ ] AC-4. `FlowId` 字面量联合包含 `'feature.fastforward'`
- [ ] AC-5. `FLOW_REGISTRY['feature.fastforward'].stages` 长度 = 4
- [ ] AC-6. `FLOW_REGISTRY['feature.fastforward'].stages.map(s => s.stage)` 严格等于 `['implementation', 'build_test', 'review', 'completion']`
- [ ] AC-7. `FLOW_REGISTRY['feature.fastforward'].kind === 'feature'`
- [ ] AC-8. `FLOW_REGISTRY['feature.standard']` 仍存在，stages 8 步顺序 W2-1 reference array 不变

### 入口契约
- [ ] AC-9. `POST /workflow-runs` body 显式 `flowId='feature.fastforward'` → 创建的 run 的 `run.flowId === 'feature.fastforward'`，DB workflow_runs.flow_id 列写入相同
- [ ] AC-10. `POST /workflow-runs` body 不带 flowId → `run.flowId === 'feature.standard'`（缺省路径不动）
- [ ] AC-11. runner api-client.createWorkflowRun 透传 flowId 到 HTTP body
- [ ] AC-12. runner CLI `runner run --flow-id feature.fastforward` 透传到 api 层

### 工程
- [ ] AC-13. `bun test` green；`bun run --filter '*' typecheck` green
- [ ] AC-14. spec 文档 `.trellis/spec/runner/backend/flow-registry.md` 追加 fastforward section

## Definition of Done

- 单元 + 路由 integration 测试全过
- typecheck 4/4 全清
- 不破坏 W2-1 / V2 Wave 1 / V1 行为
- spec 文档同步

## Out of Scope (explicit)

- ❌ UI 入口（Web 项目首页 "Fast-forward" 按钮）—— 浏览器验证留 supervised 会话
- ❌ 自动检测 fastforward（根据 diff 大小、commit history 启发式）——属 W2-4 智能路由器
- ❌ acceptance_gate 在缺 traceability artifact 时的行为调整 —— follow-up
- ❌ fastforward 完后不跑 knowledge stage 是否要补 prompt user 提交知识 —— 不做
- ❌ 引入新 WorkflowStage enum 值（fastforward 完全用现有 8 stage 子集）
- ❌ runner watch loop / coordinator 路径自动选 fastforward —— 由 W2-4 决定

## Technical Approach

### PR 拆分

| PR | 范围 | 阻塞 |
|---|---|---|
| **PR1** | shared `FlowId` 扩 + `FLOW_REGISTRY` 加 `feature.fastforward` + 单测断言 stages 顺序 | — |
| **PR2** | `POST /workflow-runs` 路由透传 body.flowId + runner api-client / `OrchestrateOpts` / cmdRun / cmdOrchestrate 加 `flowId?` + CLI 加 `--flow-id` 标志 + 测试 | PR1 |
| **PR3** | spec 文档 `.trellis/spec/runner/backend/flow-registry.md` 追加 fastforward section | 任意时序 |
| ~~PR4~~ | Web UI "Fast-forward" 按钮 —— **本 task 不做** | 留 supervised 会话 |

### Race / Risk

- R-Risk-1：fastforward 跑到 implementation 时缺 `inputs['project_profile.md']` / `inputs['accepted_knowledge.md']`（context_pack 没跑过）—— 实现 skill 应该 graceful 处理（`inputArtifactIds` 已经 filter 掉 undefined），但若 skill 严格要求会失败。Mitigation：本 task 不变 skill 实现；若行为不符再起 follow-up。
- R-Risk-2：executeAcceptance 调 acceptance_gate（traceability gate）；fastforward 没有 requirement/design artifact，gate 可能 fail。Mitigation：A3 假设——保留现行 gate 逻辑；fail 即用户体验问题，由后续 acceptance_gate refactor 处理。
- R-Risk-3：FlowId 扩为 union 后，`FLOW_REGISTRY` 的 `Readonly<Record<FlowId, FlowDef>>` 类型要求**必须**两条目都存在（exhaustiveness）；忘了加 fastforward 条目 → typecheck 失败 → 早发现。

---

## Decision (ADR-lite) [Q1]

**Context**：fastforward 取 standard 的哪几步是 PR 核心。三个候选剪法：
- α：只 `implementation` + `build_test`（最激进，省 review）
- β：`implementation` + `build_test` + `review` + `completion`（保 human gate + audit）
- γ：α + `acceptance` 但跳过 review agent（无意义，acceptance 折叠在 review）

**Decision**：方案 **β**——4 步：`implementation` → `build_test` → `review` → `completion`。

**Consequences**：
- ✅ 保留 review = 保留 human acceptance gate（W2-1 PR3 已把 acceptance 折叠到 review）；不让 fastforward 变成"机器人无人工审核就 push"的危险通道
- ✅ 保留 completion = 留 audit trail（哪个 run 跑了 fastforward 永远查得到）
- ✅ 跳过 context_pack：profile 生成 + knowledge load + LLM context pack skill 是 V1 最重的前置之一；fastforward 真省时间
- ✅ 跳过 requirement / design：fastforward 即 cs-feat-ff 的"快速通道"哲学，不写 PRD 不画 design
- ✅ 跳过 knowledge：小改动很少产生可复用 pattern；省 1 次 LLM + 1 次人工 gate
- ❌ R-Risk-1：implementation skill 缺 project_profile.md / accepted_knowledge.md inputs；接受降级（skill 应 graceful 处理 undefined input）
- ⚠ 若 acceptance_gate 强制 traceability 且 fastforward 没 artifact → fail；R-Risk-2 已记录，由后续 follow-up 修

---

## Decision (ADR-lite) [Q2]

**Context**：FlowId 是 string-literal union（W2-1 PR1 决定）。扩第二条 flow 时有两选：
- A. 直接在 union 添加：`type FlowId = 'feature.standard' | 'feature.fastforward'`
- B. 外提 const 数组：`const FLOW_IDS = ['feature.standard', 'feature.fastforward'] as const; type FlowId = typeof FLOW_IDS[number]`

**Decision**：方案 **A**——单 union 字面量直接扩。

**Consequences**：
- ✅ 与 W2-1 PR1 写法完全一致（无重构噪音）
- ✅ 代码 search 友好（grep 'feature.fastforward' 直接命中类型定义）
- ✅ Wave 2 后续（W2-2 加 'issue.standard' / 'refactor.standard'；W2-4 路由器）继续用同一种扩展方式
- ❌ 添加新 flow 时需手改 type；但 `FLOW_REGISTRY: Readonly<Record<FlowId, FlowDef>>` 的 exhaustiveness 自动捕捉漏注册
- ⚠ 后续若 flow 数量 > ~10，可考虑迁 B 方案；W2-3 ~ W2-4 仍 ≤ 4 条，A 够用

---

## Decision (ADR-lite) [Q3]

**Context**：HTTP route `POST /workflow-runs` 当前不读 body.flowId。三个选项：
- a. body 加 `flowId?: FlowId` 直接转发
- b. URL query 参数 `?flow=fastforward` 风格
- c. 单独 endpoint `POST /workflow-runs/fastforward`

**Decision**：方案 **a**——body field，可选，缺省 `'feature.standard'`。

**Consequences**：
- ✅ RESTful 风格一致（type / sourceBranch 等都在 body）
- ✅ 单 endpoint 处理所有 flow 变体（W2-2 加 issue.standard 时只是 body.flowId 取另一个值）
- ✅ UI 改动最小（前端只需把 flowId 加进现有 POST body）
- ✅ 现有不传 flowId 的调用方（任何老 client）零改动 —— 仍走默认
- ❌ 不能用 URL routing 做 RBAC（"只允许某些用户走 fastforward"）—— V2 MVP 不需要
- ⚠ 后续若需细粒度授权可改方案 c，但当前不需要

---

## Decision (ADR-lite) [Q4]

**Context**：runner CLI 当前 `runner run` / `runner orchestrate` 命令不接受 flow 标志。两个候选：
- A. CLI 加 `--flow-id <FlowId>` 标志，runner 透传到 api.createWorkflowRun(flowId: ...)
- B. CLI 不变，全靠 API/UI 触发；runner 只读 server 已写的 run.flowId

**Decision**：方案 **A**——CLI 也加 `--flow-id` 标志。

**Consequences**：
- ✅ runner 可以独立测试 fastforward（无需起 UI）
- ✅ CLI 用户（开发者本地跑 runner）能 manual 测 fastforward 行为
- ✅ 与 `--source-branch` / `--type` 等现有标志风格一致
- ❌ 增加一个 CLI 标志；runner OrchestrateOpts 多一个字段；runner api-client 多一个参数 —— 但每处改动很小
- ⚠ runner CLI 与 API/UI 都能选 flow，可能造成"两条入口"——但 source-of-truth 永远是 workflow_runs.flow_id 列（W2-1 已强约束），不会出现 race

---

## Technical Notes

### 关键文件
- `packages/shared/src/types/workflow.ts:54` — FlowId union 扩点
- `apps/runner/src/flows/registry.ts` — 加 feature.fastforward 条目
- `apps/runner/test/flow-registry.test.ts` — 加 feature.fastforward 断言（保留 V1 standard 测试）
- `apps/api/src/routes/workflow-runs.ts:24-55` — POST /workflow-runs body 类型 + 转发
- `apps/api/test/workflow-engine.test.ts` 或新 route 测试 — 路由透传测试
- `apps/runner/src/api-client.ts:54-60` — createWorkflowRun 透传 flowId
- `apps/runner/src/orchestrator.ts:21-32` — OrchestrateOpts 加 flowId
- `apps/runner/src/cmd/run.ts` — CLI flag + 透传
- `.trellis/spec/runner/backend/flow-registry.md` — 追加 fastforward section

### V2 doc / W2-1 引用
- V2 doc § 1.3 V1 "改个分号也走 9 步" 短板
- W2-1 spec：`.trellis/spec/runner/backend/flow-registry.md` 5.5 "Adding a new flow" 流程（本 task 是该流程的第一次执行）
