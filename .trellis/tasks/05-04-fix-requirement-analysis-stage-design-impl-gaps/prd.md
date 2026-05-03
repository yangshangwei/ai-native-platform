# Fix requirement-analysis stage design–impl gaps

## Goal

把"需求分析阶段"（cs-req 注入 + Coordinator 对话式接入）的设计 spec 与当前实现之间的 P0/P1 差距全部修齐，让 `docs/user/requirement-workflow.md` 描述的体验和 `docs/2026-05-03-requirements-phase-adaptation-plan.md` 列的 Phase A/B 在仓库里**完整可信**。

## What I already know

### Phase A 已完整落地（基线 OK）
- `apps/runner/src/skills/index.ts:43-103` — `skill.requirement_draft` v0.2.0，cs-req 四段 + pitch + REQ-### 硬规则
- `apps/api/src/gate-engine.ts:255-348` — `runRequirementGate` 已加 4 条新规则（pitch_present / four_sections_present / user_stories_min_2 / boundary_present）
- `apps/runner/src/agents/native.ts:257-296` — NativeBackend 模板按四段产出
- `apps/api/test/requirement-gate-cs-req.test.ts` 测试存在
- 同时 design 阶段也额外做了 cs-feat-design 注入（plan 之外的 bonus）

### Phase B 大部分落地，但有 3 处 P0 + 3 处 P1 差距
- shared types (`coordinator.ts`, `request-message.ts`)、API 路由、DB 迁移、watch.ts hook、Coordinator rules + LLM fallback 全部实现
- Web UI 有完整 chat thread + polling + 草稿恢复
- 但下面 6 处仍与设计 spec 有偏差，user 要求"请全部修复"。

## Gaps to fix

### P0-1：LLM fallback 单后端（codex 缺失）
- **Spec**：Plan B4 要求"codex 优先，claude 作为备选"
- **现状**：`apps/runner/src/agents/coordinator/llm-fallback.ts:23,49` 只 import 并检查 `claudeCliAvailable`；项目 backend = codex 的用户落到 `pause_for_human/llm.unavailable`
- **要修**：增加 codex 一次性调用通道，按"项目偏好优先 → 另一个 backend 兜底 → 都不可用才 pause"挑选

### P0-2：新建任务仍是单次表单（非"先聊后建"）
- **Spec**：Plan B8 + `requirement-workflow.md` 要求"对话式接入"，第一条 user message 才创建 WorkflowRequest
- **现状**：`apps/web/src/main.ts:2989-3011` 先 `POST /workflow-requests` 再 `POST /messages`（两笔分离请求）
- **风险**：Coordinator 判 abort 时 request 已入库；同时与 P0-3 竞态相关
- **要修**：合并到一笔 API 调用（API 同时建 request + 首条 message），保留现有表单 UI 但去掉两步分离

### P0-3：首条 message 与 request 创建之间的竞态
- **Spec**：Coordinator triage 必须看到完整 user 意图
- **现状**：`apps/runner/src/cmd/watch.ts:81-102` 用 `messages.at(-1) ?? req.title` 兜底；快速 polling 下首次 triage 可能拿到空 messages 列表
- **要修**：和 P0-2 同时解决——API 在事务内同写 request + first message，runner 不再依赖 best-effort 顺序

### P1-4：`requirement-workflow.md` 流程图缺 Coordinator 阶段
- **Spec**：流程图（19-31 行）从"新建任务请求 → Runner 认领 → Context Pack"，没有体现 pre-run 的 Coordinator 对话分诊
- **现状**：UI 已实现 `pending ↔ awaiting_clarification`，但 user-guide 没更新
- **要修**：在流程图前面补 "Coordinator 对话分诊" 一格 + 文档章节说明 awaiting_clarification

### P1-5：表单 type 字段语义被 Coordinator 静默覆盖
- **Spec**：`requirement-workflow.md:35` 要用户填 type
- **现状**：表单选 type 后，`orchestrator.ts:61` 实际用 `opts.runType ?? 'feature'`，Coordinator 决策覆盖了用户输入；用户毫无察觉
- **要修**：选择以下之一（**待用户决策**）：
  - A. 把 form type 改成"用户提示"，UI 在 task 详情上显示 "用户标记: feature / Coordinator 判定: bugfix" 两条
  - B. 直接去掉 form type 字段，由 Coordinator 全权决定
  - C. 保留 type 为"权威"——用户选 bugfix 时 Coordinator 不能改成 feature
  - 推荐 **A**：保留用户语义信号，让 Coordinator 与之并存（透明度最高）

### P1-7：status PATCH 没有状态转换白名单
- **Spec**：状态机有约束，不能从 web 把 `completed` 直接覆盖回 `pending`
- **现状**：`apps/api/src/routes/workflow-request-chat.ts:69-78` 只校验 enum 合法，不校验 from→to 合法性
- **要修**：加白名单——只允许 `pending↔awaiting_clarification`、`pending→cancelled` 这种 web 端能合法触发的转换

> P1-6（adaptation plan 没标 cs-feat-design 注入）只是文档纸面工作；P2 #8/#9/#10 plan 已声明 out-of-scope，本任务不动。

## Out of Scope (explicit)

- 不做 `skill.implementation` / `skill.review` 的 cs-* 注入（plan 列为 P1+）
- 不做 hook / requiredGates / inputs/outputs 的 runtime config 化（PR3+ 工作）
- 不引入 Tool Policy 沙箱级强制（项目 directive 明确避开）
- 不重构 web UI 为 chat-only 录入（保留现有表单 + chat panel 的复合形态）

## Open Questions

### Q1（P0-2 修复路径）— ✅ 已决：A
扩展现有 `POST /workflow-requests` body，加可选 `firstMessage: { role, content }` 字段，handler 在同一事务里建 request + insert message。Web 端单次调用，向后兼容老 CLI 调用方。

### Q2（P1-5 form type 语义）— ✅ 已决：A
保留为"用户提示"，与 Coordinator 判定并存展示。表单照常让用户选 type；task 详情页同时显示 `用户标记: feature` 与 `Coordinator 判定: bugfix`（不一致时高亮）。Coordinator 仍是最终路由权威。

### Q3（P0-1 backend 优先级）— ✅ 已决：A
项目偏好优先。`defaultTriage` 经 `request.projectId` 读 `project.agentBackend`，先尝试该 backend；不可用时切换到另一个；两个都不可用才 `pause_for_human`。与 PR2 的项目级 backend 选择语义一致。

## Decision (ADR-lite)

**Context**：需求分析阶段（Phase A cs-req 注入 + Phase B Coordinator 对话式接入）已大部分落地，但 LLM fallback 单后端、首条 message 与 request 创建竞态、UI 文档与设计 spec 偏差等 6 处差距未闭环。

**Decisions**：
1. **API 单次原子写入**（Q1=A）：扩展 `POST /workflow-requests` 接受可选 `firstMessage`，handler 在事务内同时写 request + message，去除 web 端两步竞态。
2. **Form type 用户提示并存**（Q2=A）：保留表单 type 字段为用户输入，UI 同步展示用户标记 + Coordinator 判定，Coordinator 仍是路由权威。
3. **项目 backend 优先**（Q3=A）：Coordinator LLM fallback 按项目偏好挑 CLI，另一个作为兜底，都不可用才 pause。

**Consequences**：
- 改动仅触及 web/api/runner 边界 + 文档；不动 Workflow Engine 状态机、不动 9 阶段流水线、不动 NativeBackend e2e 路径
- 向后兼容：`POST /workflow-requests` 不带 `firstMessage` 时行为不变（CLI register 路径保留）
- 用户语义信号（form type）从此被持久记录而非静默丢失，运维上能看出 Coordinator 何时纠正用户分类

## Requirements (evolving)

- **R1** Coordinator LLM fallback 同时支持 codex 与 claude_code，按 Q3 决策的优先级挑选
- **R2** 新建 WorkflowRequest 时 request + first user message 一笔事务写入（Q1 决策的实现路径）
- **R3** Web 端 `submitWorkflowRequest` 改成单次 API 调用，移除 race
- **R4** `docs/user/requirement-workflow.md` 流程图前置 "Coordinator 对话分诊"，并新增章节说明 `awaiting_clarification` 体验
- **R5** Form type 字段按 Q2 决策处理（推荐 A：保留 + 透明并存展示）
- **R6** `PATCH /workflow-requests/:id/status` 加状态转换白名单
- **R7** 所有改动有对应 vitest 覆盖（atomic POST / fallback backend 选择 / status 白名单 / coordinator decision routeCase=feature_clear 时 NativeBackend orchestrator 拿到正确 runType）

## Acceptance Criteria

- [ ] AC-1 codex 与 claude_code CLI 都可用时，Coordinator 走项目偏好的 backend，且单元测试覆盖三种组合（仅 claude / 仅 codex / 都可用按项目偏好）
- [ ] AC-2 web 单次表单提交 → 单一 API 调用 → API 在事务内创建 request + first message；Vitest 覆盖该路径
- [ ] AC-3 `bun run runner -- watch --once`（mock 数据）观察到 Coordinator 永远拿到 first user message 而非 title 兜底
- [ ] AC-4 `requirement-workflow.md` 流程图含 Coordinator 阶段；新增 `## 对话分诊与 awaiting_clarification` 章节
- [ ] AC-5 form 提交后 task 详情页可看到 "用户标记 vs Coordinator 判定" 两个标签
- [ ] AC-6 `PATCH /workflow-requests/:id/status` 拒绝非法转换（如 completed → pending）；测试覆盖
- [ ] AC-7 `bun test && bun run typecheck` 全绿；既有 e2e (`scripts/e2e.ts`) 不退化

## Definition of Done

- 所有 AC 通过
- `bun test` 全部测试 + 既有 e2e 绿
- `bun run typecheck` 绿
- `docs/user/requirement-workflow.md` 更新
- 一份 fix-note 总结提交记录与 plan 字段对照（adaptation plan 末尾追加一段，标注 P0-1/P0-2/P0-3/P1-4/P1-5/P1-7 已闭环）

## Technical Approach (preliminary)

### 切片为 4 个原子 PR

**PR1 — API 原子建 request + first message + status 白名单**
- `apps/api/src/routes/workflow-requests.ts` 接受 `firstMessage` 可选字段
- `workflow-request-chat.ts` PATCH 加状态白名单
- 新增 vitest

**PR2 — Web 端单次调用 + form type 用户提示渲染**
- `apps/web/src/main.ts` `submitWorkflowRequest` 改造
- task 详情页加 "用户标记 vs Coordinator 判定" 双标签
- 移除竞态分支

**PR3 — Runner LLM fallback codex 通道**
- `apps/runner/src/agents/coordinator/llm-fallback.ts` 引入 `runCodexOneShot` 与 backend 选择策略
- `agents/codex.ts` 暴露 `codexCliAvailable`
- 单元测试覆盖三种组合
- watch.ts 把 `request.projectId` 上下文传给 triage

**PR4 — 文档 + fix-note**
- `docs/user/requirement-workflow.md` 流程图与新增章节
- `docs/2026-05-03-requirements-phase-adaptation-plan.md` 末尾追加 closure 记录

### Decision pending

- Q1 / Q2 / Q3（见上） — 待用户拍板

## Technical Notes

- `apps/runner/src/agents/codex.ts` 已存在；需要看是否有 `codexCliAvailable` 等价物
- `apps/api/src/store/store.ts` 的 `workflowRequests.updateStatus` 可作为白名单 hook 点
- `apps/web/src/main.ts` 第 154-160 已声明 status enum 含 awaiting_clarification —— 复用即可
- e2e (`scripts/e2e.ts`) 走 NativeBackend，不依赖 codex/claude；Coordinator 改动不要破坏 NativeBackend 路径
