# reject 强制理由输入并触发模型修订重跑

## Goal

补齐 workbench UI Reject 流程的人机闭环：

- **L1**：点击 Reject 必须先弹模态，强制人工填写"拒绝理由"，提交时把理由作为 `comment` 写入既有 approval / acceptance-decision 链路。
- **L2**：runner 端在 reject 时持久化"拒绝反馈" artifact（`kind: rejection_feedback`），保留 comment 数据；下游 context_pack 阶段（由 L3 / 后续任务消费）可据此引导 LLM 在新 run 中修订重跑。
- **L3**（独立任务，不在此 PRD）：orchestrator 控制流改造——reject 不再 throw 终结 run，改为同 run 内回退 stage 自动重跑。

## What I already know

### 前端（apps/web/src/main.ts）

- 三处需改造的 Reject 入口：
  - `main.ts:1893` `sensitive_change_gate` "要求修改" → `submitApproval(runId, 'sensitive_change_gate', false)`。
  - `main.ts:1921` 通用 Reject → `submitApproval(runId, pendingGate, false)` 或 `submitAcceptanceDecision(runId, 'reject')`。
- 当前两个提交函数发送 hardcoded 英文 `comment`（`main.ts:4283`、`main.ts:4309`）。
- 已有 modal 模式可复用：`renderExpandedAgentStreamOverlay`（`main.ts:2112`），className `stream-overlay` / `stream-modal`，`role="dialog"` + `aria-modal="true"` + 点击 backdrop 关闭。

### 后端（apps/api/src）

- `POST /approvals`（`routes/approvals.ts:14`）已接受 `comment?: string | null` → `recordApproval` → `runManualGate`（`gate-engine.ts:584`）把 comment 拼进 `RuleResult.message`。
- `POST /workflow-runs/:id/acceptance-decision`（`routes/workflow-runs.ts:191`）同上。
- `reports.ts:90` 已渲染 approval comment 到 completion report。
- `createArtifact`（`workflow-engine.ts:~430`）支持新增 artifact kind，shared 类型在 `packages/shared/src` 的 `ArtifactKind` 联合中。

### Runner（apps/runner/src）

- **关键空缺**：`api-client.findApproval`（`api-client.ts:342-349`）只返回 `decision`，没返回 `comment`——也就是当前用户输入的拒绝理由根本到不了 runner 端，更别提 LLM。
- orchestrator 在三处 reject 后直接 throw（`orchestrator.ts:415-418 / 818-821 / 1041-1044`），由顶层 try/catch（`:181-184`）转为 `workflowCompleted({ ok: false })`，run 终结、不重跑——这就是 L3 留给后续任务的根因。

## Decisions

- **Q1（覆盖范围）= B**：三处 Reject 入口（sensitive_change_gate "要求修改" + 通用 Reject + acceptance gate `reject` 决策）。`accept_risk` / 所有 Approve 路径不动。
- **Q2（深度）= B (L1 + L2)**：本任务只做"理由输入 + 持久化"。L3（reject 后自动重跑、阶段回退）拆独立 P1 任务。
- **Q3（API 加固）= A**：`routes/approvals.ts` 在 `approved=false`、`routes/workflow-runs.ts` 在 `decision='reject'` 时校验 `body.comment` trim 后非空，否则 400。前端 + 后端双保险防止 curl 绕过。

## Requirements

### L1：前端模态（apps/web/src/main.ts）

- 新增 `promptRejectReason(opts: { title: string; placeholder?: string }): Promise<string | null>`：
  - 复用 `stream-overlay` / `stream-modal` 视觉与 a11y（`role="dialog"` + `aria-modal="true"` + ESC 关闭 + 首次聚焦 textarea）。
  - textarea 必填（trim 后非空），软上限 2000 字符；提交按钮在不满足时 `disabled`。
  - 取消（关闭按钮 / 点击 backdrop / ESC）resolve `null`，不发请求。
- `submitApproval(runId, gateId, approved, comment?)`、`submitAcceptanceDecision(runId, decision, comment?)` 签名扩展：approved=false / decision='reject' 时由 caller 传入用户输入的 `comment`（即 `promptRejectReason` 返回值）；其余路径维持 hardcoded 默认。
- 三处 onclick 改为 `async () => { const r = await promptRejectReason(...); if (r === null) return; submit*(... , r); }`。

### L2：runner 端持久化拒绝反馈（apps/runner/src + packages/shared/src）

- `api-client.findApproval` 返回类型由 `'approved' | 'rejected' | null` 改为 `{ decision: 'approved' | 'rejected'; comment: string | null } | null`（API 端已有 comment，仅消费侧扩展）。
- `awaitApproval` 透出 `{ approved, comment }` 或新增 `awaitApprovalDetail`；保持 reject 时 throw 的行为（属于 L3）。
- 在三处 reject throw 之前调用：
  ```ts
  await api.createArtifact({
    workflowRunId: c.run.id,
    stepRunId,
    kind: 'rejection_feedback',
    contentType: 'text/plain',
    uri: '...',  // 或 inline
    size: comment.length,
    metadata: { gateId, comment, rejectedAt: new Date().toISOString(), actor },
  });
  ```
  落地"该 run 在 X 阶段被拒，理由 Y"作为可被下次 run 上下文消费的事实。
- `packages/shared/src` 的 `ArtifactKind` 联合新增 `'rejection_feedback'`；导出同步更新。
- runner 日志保留 `xxx_gate -> rejected: <comment 前 100 字>` 一行，便于排查。

### 后端 API 加固（视 Q3）

- `routes/approvals.ts` 在 `approved === false` 时校验 `body.comment` trim 后非空，否则 `400`。
- `routes/workflow-runs.ts` acceptance-decision 在 `decision === 'reject'` 时同样校验。

## Acceptance Criteria

- [ ] 三处 Reject 按钮点击后均先弹模态；textarea 空时提交按钮禁用；取消路径不发请求、不改 run 状态。
- [ ] 提交后请求体 `comment` 字段为用户输入文本（非 hardcoded）。
- [ ] 模态满足 a11y：role/dialog、aria-modal、ESC 关闭、首次聚焦 textarea、点击 backdrop 关闭。
- [ ] 后端持久化：reject 提交成功后存在一条 `rejection_feedback` artifact，metadata 含 `gateId`、原始 `comment`、`rejectedAt`、`actor`。
- [ ] runner 日志含 `xxx_gate -> rejected: <comment>` 行。
- [ ] Approve / `accept_risk` 流程零变化（hardcoded comment 保持）。
- [ ] 后端 reject 校验（如 Q3 = yes）：approved=false 但 comment 空时返回 400。
- [ ] `npm test` / typecheck / lint 全绿；现有 sensitive_change_gate / acceptance_gate 测试不破。

## Definition of Done

- L1 / L2 各自有单元测试覆盖（modal 校验路径、findApproval 透 comment、createArtifact 调用参数）。
- a11y 自检：模态键盘可达 + 焦点陷阱（如代码库已有约定就遵循，无则新增）。
- `apps/web/src/main.ts`、`apps/runner/src/api-client.ts`、`apps/runner/src/orchestrator.ts`、`packages/shared/src` 类型 / 导出全部同步。
- 文档：在 `.trellis/spec/` 相关 PR 笔记中说明 L3 是独立任务，避免后续误解。

## Out of Scope

- **L3**：orchestrator 阶段回退 + 自动重跑（reject 不 throw、retry 上限、幂等保护）——独立 P1 任务，待此 PRD 完成后单建。
- 模态预设理由模板 / 标签下拉 / 关联证据链接 / 文件附件。
- Approve 路径强制 comment（MVP 保持 hardcoded 默认值）。
- context_pack 阶段消费 `rejection_feedback` artifact 注入 prompt（属 L3 的"消费侧"，本任务只做生产侧）。

## Technical Notes

- 复用 modal：`apps/web/src/main.ts:2112` `renderExpandedAgentStreamOverlay`，相同 className/aria 模式。
- artifact API：`createArtifact(input: CreateArtifactInput)`（`workflow-engine.ts:~430`），新增 `kind: 'rejection_feedback'` 后直接调用。
- shared 类型：`packages/shared/src` 中 `ArtifactKind` 联合 + 任何 schema/zod 配套。
- reject 三处分别在 `orchestrator.ts:415` (`acceptance_gate`)、`:818` (`requirement_gate` / `design_gate` / `acceptance_gate` via stage helper)、`:1041` (`sensitive_change_gate`)。

