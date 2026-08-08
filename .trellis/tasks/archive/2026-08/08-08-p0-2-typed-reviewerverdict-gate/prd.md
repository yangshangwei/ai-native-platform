# P0-2 Typed ReviewerVerdict：结构化裁决 + Gate 可行动信息

## Goal

把 review 从「一篇自由 Markdown」变成带 blocker、remediation、evidence、provenance 的结构化裁决，并把 Gate 已有但没露出来的 `RuleResult.message` / evidence 送到用户做决策的地方。GateEngine 仍是唯一状态判定者 —— verdict 是证据和意见，不是状态。

来源：`.trellis/tasks/archive/2026-08/07-30-umadev/research/comparison.md` 的 P0-2 建议。

## What I already know

已核对的事实（AINP @ `dbb6f2c`，2026-08-08 复核）：

* `apps/runner/src/skills/index.ts:280-294` — `skill.review` 只声明 `outputs: [{ name: 'review.md', kind: 'artifact' }]`，指令是「写一段简短 review（verdict、risks、follow-ups）」，无任何结构约束。`toolPolicy.writableGlobs` 已经是 `[]`（但未被 sandbox 执行 —— 那是 P0-3 的范围）。
* `packages/shared/src/types/agent.ts:80-89` — `AgentResult` 只有 `status / summary / outputArtifactIds`，`summary` 注释写明 "never used to advance state"。
* `apps/api/src/gate-engine.ts:1282-1286` — `isAcceptanceReviewArtifact()` 是**排除法**：`subStage !== 'verifier' && !isVerifierAcMatrixArtifact && !isVerifierMediaArtifact`。任何 `kind='other'` 的非 verifier artifact 都会被当成 review。
* `apps/api/src/gate-engine.ts:655-658` — `runAcceptanceTraceabilityGate` 用 `byKind(runId,'other').filter(isAcceptanceReviewArtifact).at(-1)` 取 review。
* `apps/runner/src/orchestrator/steps.ts:836` — `review.md` 被当作**每一条 AC 的通用 evidence** 绑进 `businessAcceptanceEvidenceRefs`。所以 review 已深度参与 gate 判定，但内容不可机读。
* `packages/shared/src/types/gate.ts:30-35` — `RuleResult` 已有 `ruleId / status / message / evidenceRefs`，注释写明 "The Gate Engine produces these, Agents may not."
* `apps/web/src/page-task-detail.ts:1617-1637` — `renderRuleList()` 只渲染 `ruleLabel(rule.ruleId)` + `pill(rule.status)`。**`rule.message` 和 `rule.evidenceRefs` 从未显示。**
* `packages/shared/src/types/artifact.ts:658-662` — `EvidenceRef` = `{ artifactId, claim }`。
* `packages/shared/src/utils/operational-error.ts:17-27` — `OPERATIONAL_ERROR_REASONS` 三个成员，注释明确写「gate failures、compile/test failures、diff-scope violations **绝不能**包成这个类型」。
* `apps/api/src/workflow-engine.ts:570-633` — operational failure 让 run/request 进 `paused` 并保留恢复边界。

## Assumptions (temporary)

* Reviewer 输出 verdict 后，旧的 `review.md` 仍然保留（人类可读），verdict 是**并列**的结构化产物，不是替代品。
* 本任务不改 reviewer 的 sandbox 权限（P0-3）、不做自动返工（P1-2）。
* remediation 本轮只要求「被结构化记录并显示」，消费方（手动 retry 的 ContextPack）留给 P1-2。

## Open Questions

无阻塞项。三个设计分叉已按下述默认决策处理，理由见 ADR。

## Requirements

### R1 — `ReviewerVerdict` schema（shared）

新增 `packages/shared/src/types/review-verdict.ts`，schema version 常量 `ainp.review_verdict.v1`：

```ts
export const REVIEW_VERDICT_SCHEMA_VERSION = 'ainp.review_verdict.v1';

export const REVIEW_VERDICT_STATUSES = ['pass', 'fail', 'unavailable'] as const;
export const REVIEW_VERDICT_ROLES = ['reviewer', 'verifier', 'debugger'] as const;
export const REVIEW_BLOCKER_SEVERITIES = ['blocker', 'major', 'minor'] as const;

export interface ReviewBlocker {
  id: string;                    // 稳定标识，供 remediation 引用与去重
  severity: ReviewBlockerSeverity;
  summary: string;               // 一句话说明缺陷
  location: string | null;       // file:line 或模块名，无法定位时 null
  evidenceRefs: EvidenceRef[];   // 复用既有 EvidenceRef
}

export interface ReviewRemediation {
  blockerId: string;             // 必须匹配某个 ReviewBlocker.id
  action: string;                // 具体怎么修
  rationale: string | null;
}

export interface ReviewProvenance {
  agentSessionId: string | null;
  backend: string | null;        // 'claude_code' | 'codex' | ...
  skillId: string | null;
  producedAt: Iso8601;
}

export interface ReviewerVerdict {
  schemaVersion: typeof REVIEW_VERDICT_SCHEMA_VERSION;
  role: ReviewVerdictRole;
  status: ReviewVerdictStatus;
  summary: string;
  blocking: ReviewBlocker[];
  remediation: ReviewRemediation[];
  advisory: string[];            // 非阻塞建议
  evidenceRefs: EvidenceRef[];   // 整体裁决依据
  provenance: ReviewProvenance;
  unavailableReason: string | null;  // status='unavailable' 时必填
}
```

配套导出 `isReviewVerdictStatus` / `isReviewVerdictRole` / `isReviewBlockerSeverity` 守卫，并按 shared 的 barrel 纪律在 `index.ts` 补 `export *`。

### R2 — 严格解析（runner），失败即失败

* `skill.review` 增加必需 output `review-verdict.json`，指令改为要求同时产出人类可读的 `review.md` 与机读 verdict。
* 新增 `parseReviewerVerdict(text): { ok: true; verdict } | { ok: false; error }`，规则**严格**：
  * `schemaVersion` 不匹配 → 失败
  * `status` / `role` / `severity` 不在枚举内 → 失败
  * `status='fail'` 但 `blocking` 为空 → 失败（自相矛盾）
  * `status='pass'` 但存在 `severity='blocker'` 的条目 → 失败
  * `status='unavailable'` 但 `unavailableReason` 为空 → 失败
  * 任一 `remediation.blockerId` 不匹配任何 `blocking[].id` → 失败
  * `evidenceRefs[].artifactId` 引用不存在的 artifact → 失败
* 解析失败按现有 `OperationalError('backend_protocol', …)` 路径处理 —— 这正是该 reason 注释里「required outputs missing/unparseable」的场景。

### R3 — `unavailable` 映射到 operational pause

* `OPERATIONAL_ERROR_REASONS` 新增成员 `reviewer_unavailable`（ADR-1 说明为何不复用现有三者）。
* Runner 解析到 `status='unavailable'` 的合法 verdict 时，抛 `OperationalError('reviewer_unavailable', verdict.unavailableReason)`，走既有 pause 路径。
* **不**产生 gate fail，**不**计入产品返工。
* UI 的暂停原因展示需要认得这个新 reason（`page-task-detail.ts:2756-2824` 附近）。

### R4 — 收紧 review artifact 识别

* `isAcceptanceReviewArtifact()` 从排除法改为**正向**识别：只接受带明确 verdict schema 标记的 artifact（metadata 上的 `schemaVersion === REVIEW_VERDICT_SCHEMA_VERSION`，或 outputName 精确匹配）。
* 兼容既有 run：无 verdict 的历史 review artifact 仍按旧规则识别，但**必须**记录为降级路径（gate rule message 里说明「legacy free-text review」），不能静默等同。
* `runAcceptanceTraceabilityGate` 消费 verdict 时：GateEngine 只校验 **schema 合法性、evidence 是否存在、策略是否满足**。Agent 的 `status` 是输入信号，**不能**直接成为 `GateRun.status`（ADR-2）。

### R5 — Gate 可行动信息进入决策面

* `renderRuleList()` 显示 `rule.message`（当前完全丢弃）。
* 失败侧栏（`page-task-detail.ts:2827-2895`，当前只拼规则名）显示首个 blocker + 对应 remediation + evidence 链接。
* verdict 存在时，acceptance 区展示 blocking / remediation / advisory 三段；不存在时保持现状，不显示空壳。
* 沿用既有 `el()` / `pill()` / `renderDetails()` 风格。

### R6 — 测试

* shared：`parseReviewerVerdict` 覆盖 R2 的**每一条**拒绝规则 + 一条完整成功用例。
* shared：三个类型守卫的接受/拒绝。
* api：`isAcceptanceReviewArtifact` 正向识别 + legacy 降级路径。
* api：GateEngine 拿到 `status='fail'` 的 verdict 时**不**直接置 GateRun 为 fail，而是走自己的规则判定（ADR-2 的回归防线）。
* runner：`unavailable` verdict → `OperationalError('reviewer_unavailable')`。
* web：`renderRuleList` 显示 message；失败侧栏显示 blocker + remediation。

## Acceptance Criteria

* [ ] `ReviewerVerdict` 类型与守卫在 shared 导出，barrel 已补。
* [ ] 严格解析拒绝 R2 列出的全部非法形态，每条有对应测试。
* [ ] `status='unavailable'` 走 operational pause，不产生 gate fail。
* [ ] `isAcceptanceReviewArtifact` 不再把任意 `other` artifact 当 review；legacy 路径有显式降级标记。
* [ ] Agent 的 verdict status 无法直接决定 `GateRun.status`，有回归测试。
* [ ] Gate 决策面显示 `rule.message`；有 verdict 时显示 blocker + remediation + evidence。
* [ ] `npm run typecheck` + `npm test` 全绿（无 lint 配置，见下）。

## Definition of Done

* 质量门 = `npm run typecheck` + `npm test`，贴出实际输出。本仓库**没有** lint 配置。
* 测试必须在 bun runtime 下跑：`npm test`（= `bun x --bun vitest run`）或 `bun test`。`npx vitest` 会因 `bun:sqlite` 把整个 suite 报成 skipped。
* 未让 Agent 绕过 GateEngine。
* 未新建第二套 evidence / retry / plan 真相。

## Out of Scope

* 不改 reviewer 的 sandbox / 工具权限（P0-3）。
* 不做 remediation 的自动消费或自动返工（P1-2）。
* 不新增 artifact DB kind（ADR-3）。
* 不重建 acceptance coverage 子系统 —— `VerifierAcMatrix` 已存在且能用。
* 不改 criterion-specific evidence 的启发式判定（P1-1）。

## Technical Approach

1. **shared**：类型 + 守卫 + 纯解析函数（无 I/O，符合 shared purity 纪律）。
2. **runner**：skill 声明新 output → 解析 → 合法则落 artifact，`unavailable` 则抛 OperationalError。
3. **api**：正向识别 + GateEngine 把 verdict 当**输入证据**评估。
4. **web**：类型接入 → 渲染 message / blocker / remediation。

## Decision (ADR-lite)

### ADR-1：新增 `reviewer_unavailable`，不复用现有三个 reason

**Context**：`unavailable` 需要映射到 operational pause，但现有三个 reason 语义都不贴切 —— 它们描述「平台跑不起来 backend」，而 unavailable 是「backend 跑起来了、reviewer 明确声明自己无法给出裁决」。

**Decision**：`OPERATIONAL_ERROR_REASONS` 新增 `reviewer_unavailable`。

**Rationale**：硬塞进 `backend_protocol` 会让运维看到误导性原因（以为 CLI 挂了）。而 `unavailable` 确实不是业务失败 —— 现有注释禁止把 gate failure 包进 OperationalError，unavailable 不是 gate failure，它是「裁决未产生」。复用 pause 机制符合「不建第二套生命周期」的判断标准。

**Consequences**：union 成员扩展需要走 spec 里记载的 ripple 检查（`shared/backend/quality-guidelines.md` § Anti-patterns 1）：api 持久化、UI 暂停原因展示、任何 reason 的穷尽匹配都要更新。R3 已覆盖 UI。

### ADR-2：verdict status 是输入信号，不是 GateRun 状态

**Context**：最省事的做法是 `verdict.status === 'fail' → GateRun.status = 'fail'`。

**Decision**：禁止。GateEngine 拿 verdict 当证据，按自己的规则产出 `RuleResult`，再合成 `GateRun.status`。

**Rationale**：`gate.ts:29` 的注释「The Gate Engine produces these, Agents may not」是既有架构不变量，也是研究文档「不建议照搬」清单的第 3 条。让模型的 accepts 直接等于 gate pass 会把审批降级成橡皮图章。

**Consequences**：需要一条回归测试专门钉死这个边界（R6）。

### ADR-3：verdict 落在既有 artifact 上，不新增 DB kind

**Context**：可以给 verdict 新增一个 `ArtifactKind`。

**Decision**：本轮不加。verdict 作为 `kind='other'` 的 artifact，靠 metadata 上的 `schemaVersion` 正向识别。

**Rationale**：`shared/backend/quality-guidelines.md` § Anti-patterns 1 明确记载：新增 union 成员要 ripple 到 store mapping、migrations、过滤路由、orchestrator、UI 和路由守卫的字面量列表。P0-2 的目标是让 review 可机读，不是扩 artifact 分类学。`schemaVersion` 标记同样能实现 R4 的正向识别。

**Consequences**：如果后续 verdict 需要独立的查询/索引路径，再单独提案加 kind。

## Technical Notes

* `deriveGraphRunStatus` 的教训适用于这里：verdict 的解析与校验应当是一个 shared 纯函数，runner（写）和 api（校验）调用同一份，避免两侧对「什么是合法 verdict」产生分歧。
* 读取 `metadata` 上的字段时，key 必须从真实写入方抄 —— 见 `.trellis/spec/guides/index.md` § When Reading a Field Another Module Wrote（P0-1 踩过：读 `failureReason`、实际写 `error`）。
* `review.md` 仍是 `businessAcceptanceEvidenceRefs` 的通用 evidence（`steps.ts:836`）。本任务不改这个绑定，但 verdict 落地后，P1-1 可以把它换成 criterion-specific 证据。

## 实施中发现的问题

### 1. 用户可见回归：「查看 Review 原文」渲染 verdict JSON（已修）

`renderAcceptancePanel` 用 `artifactText(detail, 'other')` 取「最新的 kind='other'」。本任务给 `skill.review` 增加了第二个 output，且 `review.md` 声明在 `review-verdict.json` **之前**，所以 verdict 恒为更新的那个 —— 原本展示 markdown 的 `<pre>` 开始渲染 JSON。

没有任何东西报错，面板依然有内容，只是内容错了。改用 `artifactTextBy(detail, 'other', a => a.metadata?.output === REVIEW_MARKDOWN_OUTPUT_NAME)`，并补了回归测试。该测试做过变异验证：把选取还原成 latest-of-kind 后，只有目标用例失败，其余 11 个不受影响。

教训已写进 `.trellis/spec/guides/index.md` § When a Stage Starts Producing a Second Artifact of the Same Kind。

### 2. `npm run typecheck` 不检查测试文件（既有状况，未改）

四个包的 `tsconfig.json` 的 `include` 都是 `src/**/*`（web 另加 `serve.ts`），`test/**` 完全不在编译单元里。所以测试里的类型错误对质量门不可见 —— 既有用例里 `WorkflowRequestDto.status = 'awaiting_human'` 这个不在 union 中的值一直没被发现。

含义：**fixture 不是「契约成立」的类型级证据**。已写进 `.trellis/spec/api/backend/quality-guidelines.md`。本任务不改 tsconfig —— 打开 test 的类型检查大概率会暴露一批既有错误，属于独立的清理任务。

### 3. advisory 折叠区计数恒为 (1)（未修，已记录）

`renderDetails('建议（非阻塞）', [ul])` 传入的是一个 `<ul>` 包装元素，所以 summary 的计数永远是 1，与建议条数无关。测试按真实行为断言 `(1)` 并额外断言 `li` 数量，注释标明这是 wart。

未修的理由：修它要动 `renderDetails` 的签名或调用约定，会波及其他调用方，超出 P0-2 范围。
