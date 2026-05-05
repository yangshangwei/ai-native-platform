# V2 W2-4：smart-router（智能路由诊断器）

## Goal

V2 第二根架构主轴落地。在 W2-1 (FLOW_REGISTRY) + W2-3 (fastforward) + W2-2a (issue.standard) + W2-2b (refactor.standard) 4 条 flow 在册后，让用户**不再需要显式选 flow** —— 系统接收用户描述 + 仓库现状（已有 PRD？已有 design？相关 knowledge？），输出**建议 FlowId + 建议起点 stage + 关联知识列表 + 预估时间 / token**，由 user 显式 confirm 或自动接受。

落 V2 doc § 3.2 哲学 2「Routing over Prescribing」+ § 1.3 V1 流程僵化短板（"完全空白 / 已有 PRD / 已有 design / 改动很小"应走不同路径）。

W2-4 是 V2 Wave 2 终点；完成后 V2 § 4.2 "feature / issue / refactor 第一阶段 3 工作流" 全部具备智能入口，Wave 3（长会话 / 语义 verifier / acceptance 回写）才能实质启动。

**Wave 2 上下文**：[`.trellis/tasks/archive/2026-05/05-04-v2-wave2-workflow-polymorphism/prd.md`](../archive/2026-05/05-04-v2-wave2-workflow-polymorphism/prd.md) W2-4 摘要。

**前置依赖**（已 archived）：
- W2-1：[`.trellis/tasks/archive/2026-05/05-04-v2-w2-1-flow-registry-bootstrap/prd.md`](../archive/2026-05/05-04-v2-w2-1-flow-registry-bootstrap/prd.md)
- W2-3：[`.trellis/tasks/archive/2026-05/05-05-v2-w2-3-fastforward-channel/prd.md`](../archive/2026-05/05-05-v2-w2-3-fastforward-channel/prd.md)
- W2-2a：[`.trellis/tasks/archive/2026-05/05-05-v2-w2-2a-issue-standard-flow/prd.md`](../archive/2026-05/05-05-v2-w2-2a-issue-standard-flow/prd.md)
- W2-2b：[`.trellis/tasks/archive/2026-05/05-05-v2-w2-2b-refactor-standard-flow/prd.md`](../archive/2026-05/05-05-v2-w2-2b-refactor-standard-flow/prd.md)

**spec 文档**：[`.trellis/spec/runner/backend/flow-registry.md`](../../spec/runner/backend/flow-registry.md)（W2-2b 已扩 4 条 flow 完整对比）。

## What I already know

### W2-1 ~ W2-2b 已落地的硬约束（直接 inherit）

- **FLOW_REGISTRY 4 条 flow 在册**：`feature.standard` / `feature.fastforward` / `issue.standard` / `refactor.standard`
- **WorkflowRunType**：`'feature' | 'bugfix' | 'smoke' | 'refactor'`（W2-2b 加 'refactor'）
- **WorkflowStage**：13 个值（init + V1 8 个 + W2-2a 2 个 + W2-2b 2 个）
- **StageStep `kind` / `skillId` placeholder**：W2-1 ADR Q1=α 留的，W2-4 不激活（保 placeholder 一致）
- **acceptance_gate stage-history-aware**：W2-2a PR2 已落，自动适配多 flow
- **WorkflowRun.flowId** NOT NULL DEFAULT 'feature.standard'（W2-1 PR3）
- **trust-boundary 双 KNOWN_FLOW_IDS**：4 条 flow 都已纳入

### Coordinator 现状（实地查过）

`apps/runner/src/agents/coordinator/{rules,llm-fallback,index}.ts`：
- 输入：`userRequest` + `messageHistory` + `preferredBackend`
- 处理：rules-first（confidence ≥ 0.65 跳 LLM）+ llm-fallback
- 输出：`CoordinatorAction` —— `{ action: 'proceed', routeCase, runType, reason }` / `pause_for_human` / `abort`
- 4 个 RouteCase: `feature_clear` / `feature_brainstorm` / `roadmap_needed` / `bugfix` / `unclear`
- runType: `'feature' | 'bugfix' | 'smoke'`（**未含 'refactor'**——CoordinatorAction 字面量未跟 W2-2b 同步，本 task 顺手补）
- **Coordinator 不输出 flowId** —— 这是 W2-4 要补的核心 gap

### routing 路径

1. `defaultTriage(req)` (`apps/runner/src/cmd/watch.ts:86`) 调 Coordinator
2. `cmdOrchestrate({ runType })` 调 `api.createWorkflowRun({ projectName, title, type, sourceBranch, flowId? })`
3. `createWorkflowRun()` (`apps/api/src/workflow-engine.ts:60`) 缺 flowId 时默认 `'feature.standard'`
4. **Gap**：步骤 3 的"默认 'feature.standard'"是写死的；W2-4 让它变成"调 router 推荐"

### V2 § 3.2 路由器契约（设计来源）

- 路由器**输入**：用户描述 / 仓库现状（已有 PRD / 已有 design / 改动估计）/ 历史模式 / 知识库匹配
- 路由器**输出**：建议起点 stage（带理由）/ 建议 flow / 关联知识列表（自动喂进后续 prompt）/ 预估时间 + token
- "流程是根据现状动态拼出来的，不是按 enum 预设的"
- V1 4 case：完全空白 → 完整流程；已有 PRD → 跳 brainstorm；已有 design → 直接 impl；改动很小 → fastforward

### Wave 2 roadmap W2-4 摘要

> scope：(1) 接收用户描述 (2) 扫描仓库现状（已有 PRD？已有 design？改动估计？） (3) 匹配相关知识库 (4) 输出建议 FlowId + 建议起点 stage + 关联知识列表 + 预估时间。第一版用规则引擎（**不必上 LLM**），后续可叠 LLM。
> 估算：2 周
> 交付物：~4 PR（router 模块 + UI 入口卡 + 历史模式存储 + 集成 / 测试）

## Assumptions (confirmed)

- **A1**. 第一版用规则引擎（rules only），LLM fallback 留 Wave 3 follow-up
- **A2**. router 模块 server-side（`apps/api/src/router.ts`）—— 与 KnowledgeArtifact / StepRun / Project 等数据同位置，零 DB roundtrip；同时 expose `POST /router/recommend` endpoint 给 UI dry-run 预览
- **A3**. `createWorkflowRun()` 缺 flowId 时**自动调 router 填**；user 显式 body.flowId 仍 win（向前兼容；W2-1 ADR Q3 契约保留）
- **A4**. router 输出（flowId / startStage / knowledge_refs / estimates）落 DB：flowId 落 `workflow_runs.flow_id`（已存在）；startStage 落新 column `workflow_runs.start_stage`（新加）；knowledge_refs 通过 context_pack 的 `accepted_knowledge.md` 机制注入（无需新 schema）；estimates 仅在 router output 里返回（不持久化，UI / log 用即可）
- **A5**. `runWorkflow()` 加 from-stage 切入逻辑：`for (const step of flow.stages.slice(fromIdx))`，fromIdx 从 `run.startStage` 计算；skipped stages 的输入由 router 注入的 knowledge 替代（**不**重写 stage skill 逻辑；已 skipped → 跑后续 stage 时 inputs 中相应键缺失，由现有 SkillSpec graceful 处理 —— W2-2a/W2-2b 已建立此模式）
- **A6**. router rule engine V1 决策因子：(a) coordinator runType (b) text length / small-change keywords (c) projectId 下 KnowledgeArtifact 表的 status='accepted' REQ-### / DSN-### 计数 + 关键字匹配 (d) project_profile 是否存在 / 新鲜度
- **A7**. estimates 用静态常数（per StageStepKind 平均 time / tokens），V1 不依赖历史；history-based learning 留 Wave 3
- **A8**. CoordinatorAction.runType 字面量补 'refactor'（W2-2b 漏了的小修复，本 task 顺手补；零行为影响）
- **A9**. 不动 Coordinator 主体（rules.ts / llm-fallback.ts）—— router 是 Coordinator 的下游消费者
- **A10**. `POST /router/recommend` 是**纯函数 endpoint**（不创建 workflow_run，不写 DB），仅返回推荐结果；UI 决定后续是否实际 POST /workflow-runs

## Open Questions（全部已拍板）

> 5 道 Q 一次性拍板。

### ✅ Q1：W2-4 V1 输出多少？
**决策**：方案 **C** —— V1 输出 `flowId + startStage + relevant_knowledge[] + estimates(time + tokens)`。完整 V2 § 3.2 路由器契约。详见 ADR Q1。

### ✅ Q2：router 模块定位
**决策**：方案 **C** —— 新模块 `apps/api/src/router.ts`（server-side）；同时 expose `POST /router/recommend` endpoint 给 UI dry-run。`createWorkflowRun()` 内部调用 router 自动填 flowId / startStage。详见 ADR Q2。

### ✅ Q3：start_stage 语义
**决策**：方案 **B** —— `workflow_runs` 加 `start_stage TEXT` nullable column；`WorkflowRun.startStage` 字段；`runWorkflow()` 在 for-of 前 `slice(fromIdx)` 切入；skipped stages 的输入靠 router 输出的 knowledge 经 context_pack 的 accepted_knowledge.md 机制供给。详见 ADR Q3。

### ✅ Q4：触发模式
**决策**：方案 **A** —— Auto-pick；`createWorkflowRun()` 缺 flowId 时 router 自动填；user 显式 body.flowId 仍 win；UI 通过独立 `POST /router/recommend` dry-run 预览。详见 ADR Q4。

### ✅ Q5：V1 LLM extension
**决策**：方案 **A** —— Rules only。LLM fallback 留 Wave 3 follow-up。详见 ADR Q5。

## Requirements

### 兼容性
- **R1**. V1 / W2-1 / W2-3 / W2-2a / W2-2b 行为零回归（4 条既有 flow path 完全不变；既有显式 body.flowId 调用方仍 win）
- **R2**. `createWorkflowRun()` 在显式传 flowId 的所有调用方零改动（W2-3 / W2-2a / W2-2b 既有调用方）

### shared 类型 / DB schema
- **R3**. `WorkflowRun.startStage: WorkflowStage | null` 字段加进 `packages/shared/src/types/workflow.ts`
- **R4**. `workflow_runs` 表加 `start_stage TEXT` nullable column（idempotent ALTER + columnNames 守卫，沿用 W2-1 PR3 模式）
- **R5**. `rowToWorkflowRun()` 读取 start_stage 列
- **R6**. `CoordinatorAction.proceed.runType` 字面量补 `'refactor'`（小修补 W2-2b 漏掉的）

### Router 类型 + 模块
- **R7**. shared 加 `RouterRecommendation` 类型：
  ```ts
  interface RouterRecommendation {
    flowId: FlowId;
    startStage: WorkflowStage | null; // null = 从 flow 起点开始
    relevantKnowledge: ArtifactId[];  // 推荐注入的 knowledge_artifact ids
    estimates: { timeSec: number; tokens: number };
    reason: string;     // 为什么这么推荐（debugging + UI 显示）
    rulesFired: string[]; // 命中的 rule id 列表（与 Coordinator rulesFired 一致风格）
    confidence: number;   // 0..1（与 Coordinator confidence 一致风格；MVP 可全 1.0）
  }
  ```
- **R8**. shared 加 `RouterInput` 类型：
  ```ts
  interface RouterInput {
    projectId: ProjectId;
    title: string;          // 用户描述（=workflow_request.title 或 body.title）
    runType: WorkflowRunType; // Coordinator 的 runType（提示信号）
    messageHistory?: { role: 'user' | 'coordinator'; content: string }[]; // 可选历史
  }
  ```
- **R9**. `apps/api/src/router.ts` 实现 `recommend(input: RouterInput): RouterRecommendation` 纯函数

### Router rule engine（V1 规则集）
- **R10**. **flowId 决策规则**（按优先级 short-circuit）：
  1. `runType === 'bugfix'` → flowId='issue.standard'
  2. `runType === 'refactor'` → flowId='refactor.standard'
  3. `runType === 'smoke'` → flowId='feature.standard'（smoke 不动）
  4. `runType === 'feature'` + small-change signal（title.length < 60 OR 命中 `small_change_keywords` 列表如 `['typo', 'rename', '改个', '小修', 'fix typo']`）→ flowId='feature.fastforward'
  5. 否则 → flowId='feature.standard'
- **R11**. **startStage 决策规则**（在 flowId 选定后）：
  1. flowId='feature.fastforward' / 'issue.standard' / 'refactor.standard' → startStage=null（这些 flow 短，从头跑；fastforward 已经是子集）
  2. flowId='feature.standard'：
     - 如 project 下有 status='accepted' 且 title-keyword 匹配的 `KnowledgeArtifactKind='design'` 实体 → startStage='implementation'
     - 否则如有匹配的 `KnowledgeArtifactKind='requirement'` → startStage='design'
     - 否则如 `project_profile` 已存在且 `<7天` → startStage='requirement'（跳 context_pack）
     - 否则 → startStage=null（从 context_pack 头跑）
- **R12**. **relevantKnowledge 决策**：query `store.knowledgeArtifacts.byProject(projectId).filter(a => a.status === 'accepted')`；按 title 关键字 vs `entityId / metadata.title` 模糊匹配；返回 top-N（N=5）的 `id` 列表
- **R13**. **estimates 决策**：用静态常数 per StageStepKind：
  - `agent` stage: 90 sec / 8000 tokens
  - `engine` stage: 30 sec / 0 tokens（mvn / completion 没 LLM）
  - 总和 = sum over `flow.stages.slice(fromIdx)`（即 startStage 之后的 stages）
- **R14**. **rulesFired** 列出本次决策命中的 rule id（如 `'flow.bugfix_to_issue'` / `'startStage.has_accepted_design'` / `'estimates.static'`）—— 与 Coordinator 一致风格

### Endpoint
- **R15**. `POST /router/recommend` body: `RouterInput` → 200 `RouterRecommendation`；纯计算，不写 DB
- **R16**. 加 `apps/api/src/routes/router.ts`（新文件）；挂载到 `app.ts`

### createWorkflowRun 集成
- **R17**. `createWorkflowRun(params)` 当 `params.flowId === undefined` 时：
  1. 调 `recommend({ projectId, title, runType, messageHistory: undefined })` → `rec`
  2. params.flowId = rec.flowId
  3. 同时设 `workflow_runs.start_stage = rec.startStage`（null OK）
  4. 把 `rec.relevantKnowledge`（artifact ids）记到 audit log（`workflow_run.created` payload 加 `routerRecommendation` 字段）以便 runner 后续读取
- **R18**. user 显式 `params.flowId !== undefined` 时**完全跳过 router**（保 W2-1 ADR Q3 契约 + 向前兼容）

### Runner orchestrator 支持 startStage
- **R19**. `runWorkflow()`（cmdOrchestrate）读 `run.startStage`；非 null 时 `const fromIdx = flow.stages.findIndex(s => s.stage === run.startStage); if (fromIdx === -1) throw 'unknown startStage in flow'; for (const step of flow.stages.slice(fromIdx))`；null 时 fromIdx=0
- **R20**. orchestrator 在迭代前 log: `[runner] starting from stage X (skipping N earlier stages)`

### Knowledge injection
- **R21**. `runContextPack()` 现 collect `accepted_knowledge`（已存在 `collectAcceptedKnowledge(projectId)`）—— W2-4 在此基础上加 `relevantKnowledge` 优先级（router 推荐的 ids 排前 / 标星）；MVP 第一版可不动 collect 函数，relevantKnowledge 仅作 audit 信号；Wave 3 再深度集成

### CoordinatorAction 修补
- **R22**. `packages/shared/src/types/coordinator.ts:29` `runType: 'feature' | 'bugfix' | 'smoke'` 扩为 `'feature' | 'bugfix' | 'smoke' | 'refactor'`（W2-2b 漏掉的 mirror）

### Web UI 入口卡
- **R23**. UI POST /workflow-runs 之前可调 `POST /router/recommend` 拿推荐；展示 flowId + startStage + estimates + reason 给 user；user click "use" / "override" / "cancel"
- **R24**. user "use" → POST /workflow-runs body.flowId = rec.flowId, body.startStage = rec.startStage（startStage 通过 body 传也支持 —— route 层加可选字段）
- **R25**. user "override" → 提供 flowId 下拉（4 条 flow）+ startStage 下拉
- **R26**. UI 改最小化：在现有 task 创建 form 上方加一卡（fetch /recommend on title input blur 即可）

### Audit log
- **R27**. `workflow_run.created` audit payload 加 `routerRecommendation: { flowId, startStage, rulesFired }`（debugging + 后续 retro analysis）

### 测试
- **R28**. shared / runner / api / web 4/4 包 typecheck pass
- **R29**. router unit tests（router.test.ts in apps/api/test）覆盖：
  - (a) bugfix runType → issue.standard
  - (b) refactor runType → refactor.standard
  - (c) feature short title → feature.fastforward
  - (d) feature long title → feature.standard
  - (e) project 有 accepted DSN → startStage='implementation'
  - (f) project 有 accepted REQ 无 DSN → startStage='design'
  - (g) project 无 knowledge → startStage=null
  - (h) estimates 累加正确
- **R30**. route /router/recommend integration test（200 with valid input；400 with missing projectId）
- **R31**. createWorkflowRun integration test：(a) 缺 flowId → router 自动填 + start_stage 写 DB；(b) 显式 flowId → router 跳过；(c) 显式 flowId + start_stage 透传
- **R32**. orchestrator startStage 测试：reference flow.stages.slice 行为（不需端到端跑 LLM）
- **R33**. 全套测试零回归（baseline 391）+ 新增 ≥ 12 条

### 文档
- **R34**. `.trellis/spec/runner/backend/flow-registry.md` 加 § "Smart Router (W2-4)" 描述：
  - 触发条件（缺 flowId 时）
  - rule engine 决策树
  - startStage 语义（runWorkflow 切入逻辑）
  - audit 字段
  - 与 Coordinator 的边界（runType 来自 Coordinator；router 决定 flowId / startStage / knowledge / estimates）
- **R35**. 加新 spec 文档 `.trellis/spec/api/backend/smart-router.md` 描述 router 模块本身（input/output/rules/extensibility）

## Acceptance Criteria

### 兼容性
- [ ] **AC-1**. typecheck 4/4 包 PASS
- [ ] **AC-2**. 全套测试零回归（baseline 391；新增 ≥ 12 条）
- [ ] **AC-3**. user 显式 `body.flowId` 调用方零改动（W2-3 / W2-2a / W2-2b 测试不变）

### Schema
- [ ] **AC-4**. `workflow_runs` 表加 `start_stage TEXT` nullable column（idempotent migration）
- [ ] **AC-5**. `WorkflowRun.startStage: WorkflowStage | null` 字段；`rowToWorkflowRun` 正确映射
- [ ] **AC-6**. `CoordinatorAction.proceed.runType` 字面量含 'refactor'

### Router 模块
- [ ] **AC-7**. `recommend(input)` 单测覆盖 R29 8 条 case 全过
- [ ] **AC-8**. flowId 决策按 R10 优先级 short-circuit；rules.ts 风格的 rulesFired 输出
- [ ] **AC-9**. startStage 决策按 R11 优先级；只对 feature.standard 有非 null 输出
- [ ] **AC-10**. relevantKnowledge 返回 top-5 accepted KnowledgeArtifact ids（按关键字模糊匹配）
- [ ] **AC-11**. estimates 静态常数累加，对应 startStage 之后的 stages

### Endpoint
- [ ] **AC-12**. `POST /router/recommend` body 合法 → 200 + RouterRecommendation；body 缺 projectId → 400

### createWorkflowRun 集成
- [ ] **AC-13**. body 缺 flowId → run.flowId = router 推荐值；run.startStage = router 推荐值；audit log 含 routerRecommendation
- [ ] **AC-14**. body 显式 flowId='feature.fastforward' → run.flowId='feature.fastforward'；run.startStage=null；router 完全跳过
- [ ] **AC-15**. body 显式 flowId + startStage → 两个值都透传到 DB；router 跳过

### Runner orchestrator
- [ ] **AC-16**. run.startStage=null → 从 flow.stages[0] 开始（既有行为）
- [ ] **AC-17**. run.startStage='design' + flow=feature.standard → 跳过 context_pack / requirement，直接从 design 开始
- [ ] **AC-18**. run.startStage 不在 flow.stages 中 → 抛错 `unknown startStage in flow`

### UI
- [ ] **AC-19**. 创建 task form 加一个 "智能推荐" 卡（fetch /router/recommend on title blur）；显示 flowId / startStage / estimates / reason
- [ ] **AC-20**. user "use" → POST workflow-runs body.flowId / startStage 用推荐值
- [ ] **AC-21**. user "override" → 4 条 flowId 下拉 + startStage 下拉

### 工程
- [ ] **AC-22**. `bun test` green；`bun run --filter '*' typecheck` green
- [ ] **AC-23**. spec 文档 `.trellis/spec/runner/backend/flow-registry.md` 加 § Smart Router；新加 `.trellis/spec/api/backend/smart-router.md`

## Definition of Done

- 单元 + integration 测试全过
- typecheck 4/4 全清
- 不破坏 W2-1 / W2-3 / W2-2a / W2-2b / V2 Wave 1 / V1 行为
- 4 PR 拆分 ship + spec 文档同步
- UI 入口卡能展示推荐 + 用户能 use/override；视觉验证留 supervised session

## Out of Scope (explicit)

- ❌ LLM fallback for router (Wave 3 — V1 rules-only per roadmap)
- ❌ History-based learning（"同类请求过去用了哪条 flow"）—— Wave 3 后续
- ❌ Estimates calibration from past runs —— Wave 3
- ❌ Coordinator routeCase 加 'refactor' —— 跨 task 的 Coordinator 升级，本 task 不动
- ❌ skillId 路由激活（W2-1 ADR Q1=α 仍是 placeholder）
- ❌ KnowledgeArtifactKind 扩展（router 不写 knowledge）
- ❌ 中途插入 stage（router 只能选起点跳过前缀，不能动态加 stage）
- ❌ 多人 routing 协作（不同用户对同 task 的 router 输出冲突解决）
- ❌ Router 决定**反向**重写 FlowDef.stages（router 选 flow 但不重新排 stages）

## Technical Approach

### PR 拆分

| PR | 范围 | 阻塞 |
|---|---|---|
| **PR1** | shared 类型（RouterInput / RouterRecommendation；CoordinatorAction.runType += 'refactor'）+ apps/api/src/router.ts (recommend 纯函数) + 单测覆盖 R29 8 条 + spec 文档 `.trellis/spec/api/backend/smart-router.md` | — |
| **PR2** | shared `WorkflowRun.startStage` 字段 + workflow_runs.start_stage migration + rowToWorkflowRun + runWorkflow from-stage 切入 + orchestrator 测试 | PR1 |
| **PR3** | apps/api/src/routes/router.ts 加 `POST /router/recommend` endpoint + integration test + createWorkflowRun 自动填 flowId/startStage 集成 + audit routerRecommendation + AC-12/13/14/15 测试 | PR2 |
| **PR4** | Web UI 入口卡（智能推荐 fetch + 显示 + use/override） + spec 文档 `flow-registry.md` 加 § Smart Router + 端到端 UI 调用回归（手动浏览器验证留 supervised） | PR3 |

4 PR / 估 ~2 周（与 roadmap 估算一致）。

### Race / Risk

- **R-Risk-1**：startStage 跳过 stages 后下游 SkillSpec 输入缺失 — 现有 SkillSpec input.required 已多为 false（W2-2a/W2-2b 已 relax）；fastforward 实证 graceful。但 feature.standard 跳到 'design' 时 inputs.requirement.md 缺失会让 design skill confusing；spec 写明这是 router-induced state，design skill 应 fall back to relevantKnowledge 注入的 accepted REQ 而不是 fail
- **R-Risk-2**：rule engine 关键字匹配过于简陋（V1 string includes，无 stemming / 同义词）→ flowId 选错（如 "重构 X 的 bug" 可能选错）。Mitigation：rules 优先级 + Coordinator runType 作为强 prior（rules.ts 已经做了 keyword 分类）；user 可 override
- **R-Risk-3**：estimates 静态常数与实际偏差大 — UI 显示有 disclaimer "estimated"；不影响决策正确性，仅影响 UX 准确度；Wave 3 history calibrate
- **R-Risk-4**：UI 在 title input blur 调 /recommend 可能慢（DB query + rule eval）— V1 内存 / SQLite 都很快；prod 上线前 measure；缓存按 (projectId, title) 短期 cache
- **R-Risk-5**：CoordinatorAction.runType 改 union 后 mirror 漏改 — typecheck 守门（已有 W2-2b 的 mirror 经验，应该撞得到）
- **R-Risk-6**：workflow_runs.start_stage 加列对 SQLite 历史数据安全 — nullable + DEFAULT NULL，与 W2-1 PR3 flow_id 加列同模式

---

## Decision (ADR-lite) [Q1]

**Context**：W2-4 V1 输出多少？最小 MVP 只输 flowId（解决"自动选 fastforward / issue.standard / refactor.standard"），但失去 V2 § 3.2 "建议起点 stage / 关联知识 / 估算" 核心价值。Roadmap 估 ~4 PR / 2 周对应完整 V2 § 3.2 形态。

**Decision**：方案 **C** — V1 输出 `flowId + startStage + relevantKnowledge[] + estimates(time, tokens)`。

**Consequences**：
- ✅ 完整落 V2 § 3.2 4 case：完全空白 → 完整流程；已有 PRD → 跳 brainstorm；已有 design → 直接 impl；改动很小 → fastforward
- ✅ 与 roadmap 估算一致（~4 PR / 2 周）
- ✅ estimates 廉价（静态常数 V1）但提供 UX 反馈
- ✅ relevantKnowledge 复用现有 KnowledgeArtifact 表 + accepted_knowledge.md 注入机制（W2-1 已建立）
- ❌ startStage 要改 orchestrator runWorkflow（W2-1 PR3 触及）— 改动局部，from-stage 切入逻辑简单
- ⚠ history-based learning 留 Wave 3（D 方案）

---

## Decision (ADR-lite) [Q2]

**Context**：router 模块住哪？三选：扩 Coordinator (runner) / 新模块 runner side / 新模块 api side + endpoint。

**Decision**：方案 **C** — `apps/api/src/router.ts` server-side 模块；同时 `POST /router/recommend` endpoint expose 给 UI dry-run。

**Consequences**：
- ✅ 零 DB roundtrip（router 直接 store.knowledgeArtifacts.byProject(...) 等）
- ✅ UI preview 有独立 endpoint，纯计算无副作用
- ✅ createWorkflowRun 内部调用 router 是局部增强（缺 flowId 时 router 填，否则跳过）
- ✅ Coordinator 不动 — 关注点分离，router 是 Coordinator 下游消费者
- ❌ 多一个 endpoint；UI 端要新增 fetch
- ⚠ router 跨包测试：单测放 apps/api/test/router.test.ts，集成测在 workflow-engine.test.ts / workflow-runs-route.test.ts

---

## Decision (ADR-lite) [Q3]

**Context**：router 输出 startStage 后，orchestrator 怎么实现"从指定 stage 切入跳过前缀"？

**Decision**：方案 **B** — DB column + WorkflowRun field + runWorkflow `slice(fromIdx)`：
- workflow_runs.start_stage TEXT nullable（idempotent ALTER）
- WorkflowRun.startStage: WorkflowStage | null
- runWorkflow: `const fromIdx = run.startStage ? flow.stages.findIndex(s => s.stage === run.startStage) : 0; for (const step of flow.stages.slice(fromIdx)) await dispatchStep(step, ctx);`
- skipped stages 的 inputs 缺失 → 现有 SkillSpec graceful 处理（W2-2a/W2-2b 已经 relax inputs.required；fastforward 实证）

**Consequences**：
- ✅ 与 flowId plumbing 同模式（DB column + reload-safe + 不读 NULL fallback）
- ✅ orchestrator 改动局部（一行 slice + findIndex 校验）
- ✅ 与 fastforward 哲学一致（FlowDef 决定全部 stages，run.startStage 只切 prefix）
- ❌ skipped stages 的 inputs 缺失需要 skill 端 graceful — 现状是 W2-2a/W2-2b relax 后能跑，但 prompt 输出质量在缺 inputs 时降级
- ⚠ 未来 router 想"跳中间 stage"或"动态插入 stage"需要破这个 slice-only 约束 — 那是 Wave 3 的 dynamic FlowDef 工作

---

## Decision (ADR-lite) [Q4]

**Context**：router 推荐如何触发？三选：auto-pick / UI 必须 confirm / 混合。

**Decision**：方案 **A** — Auto-pick + 可选 UI preview：
- `createWorkflowRun()` 缺 flowId → router 自动填 flowId / startStage；audit log 记录推荐结果；user 显式 body.flowId 仍 win
- UI 通过 `POST /router/recommend` dry-run preview（用户主动 review）；user 可 use 推荐 / override

**Consequences**：
- ✅ 默认即可用（向前兼容；既有 client 不需改 — 缺省路径仍能跑，只是 flowId 现在由 router 推荐而非硬编码 'feature.standard'）
- ✅ UI preview 是增强不是 mandatory — 对 CLI / 程序化调用方友好
- ✅ /router/recommend 与 /workflow-runs 解耦 — router 是查询，workflow-runs 是写入
- ❌ 默认行为变化：原来缺 flowId 默认 'feature.standard'，现在按 router rules 推荐（如 bugfix runType → issue.standard）— **行为变化但更智能**；spec 文档兜底
- ⚠ 任何依赖"缺 flowId = feature.standard 兜底"的测试会受影响；migration check：grep 现有测试 fixture

---

## Decision (ADR-lite) [Q5]

**Context**：router 引擎 V1 用规则引擎还是 LLM？

**Decision**：方案 **A** — Rules only。LLM fallback 留 Wave 3。

**Consequences**：
- ✅ 与 roadmap explicit "第一版用规则引擎（不必上 LLM）" 一致
- ✅ 决策快、可预测、零 token 烧
- ✅ 与 Coordinator rules-first 模式同构
- ❌ 关键字匹配粗糙；user 可 override
- ⚠ 后续可叠 LLM fallback（同 Coordinator 模式）— 但 V1 不做

---

## Technical Notes

### 关键文件

| 文件 | 改动 |
|---|---|
| `packages/shared/src/types/workflow.ts` | WorkflowRun.startStage 字段 |
| `packages/shared/src/types/coordinator.ts` | CoordinatorAction.runType += 'refactor' |
| `packages/shared/src/types/router.ts` | 新文件：RouterInput / RouterRecommendation |
| `apps/api/src/router.ts` | 新文件：recommend(input) 纯函数 + rule engine |
| `apps/api/src/routes/router.ts` | 新文件：POST /router/recommend endpoint |
| `apps/api/src/app.ts` | 挂载 /router 路由 |
| `apps/api/src/store/db.ts` | workflow_runs.start_stage 加列 migration |
| `apps/api/src/store/store.ts` | rowToWorkflowRun 读 start_stage |
| `apps/api/src/workflow-engine.ts` | createWorkflowRun 缺 flowId → 调 router 自动填；start_stage 透传 |
| `apps/runner/src/orchestrator.ts` | runWorkflow from-stage 切入：`flow.stages.slice(fromIdx)` |
| `apps/api/test/router.test.ts` | 新文件：recommend 单测 8 条 |
| `apps/api/test/router-route.test.ts` | 新文件：endpoint integration test |
| `apps/api/test/workflow-engine.test.ts` | createWorkflowRun 集成测试（auto-pick / explicit override） |
| `apps/web/src/main.ts` | 智能推荐入口卡 |
| `.trellis/spec/runner/backend/flow-registry.md` | § Smart Router 章节追加 |
| `.trellis/spec/api/backend/smart-router.md` | 新文件：router 模块 spec |

### V2 doc / Wave 2 引用

- V2 doc § 1.3 V1 流程僵化 / § 3.2 Routing over Prescribing / § 4.2 第一阶段 3 工作流（feature/issue/refactor）
- Wave 2 roadmap：`.trellis/tasks/archive/2026-05/05-04-v2-wave2-workflow-polymorphism/prd.md` W2-4 摘要
- W2-2a / W2-2b PRDs：inheritance pattern + relevant_knowledge / acceptance gate stage-history-aware 等基础已就位
- Coordinator 模块：`apps/runner/src/agents/coordinator/` 是 router 的上游意图分类器，不动
