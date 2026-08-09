# 统一 AC 状态判定并上收到 gate

> 状态：PRD 完成，待 start（研究全部完成，Open Questions 已决策，implement.jsonl 待更新）

## Goal

同一个「业务验收标准（AC）状态」概念，目前有四处判定逻辑，其中**唯一读执行证据**的一处
（web `buildAcceptanceChecklist`）被放在 `??` 兜底位，恒定生效的三处全部只看 markdown 文本。
本任务把执行证据判据上收到 api gate（唯一同时拥有 matrix 文本与执行证据的位置），让 gate 成为
AC 状态的单一权威判定方；web 改为纯透传；类型合并；并顺带给 `executionContractOutputConflicts`
接上真实调用方（P0-3 遗留的一致性校验缺执行点）。

## What I already know（来自 research/current-shape.md，主线程实地核查）

* 四处判定与生效条件已摸清（详见 research/current-shape.md 表格）：
  1. runner `businessAcceptanceStatus`（steps.ts:818-830）— 纯文本判定，恒定生效，只产 `passed`/`missing`
  2. api `evaluateBusinessAcceptanceMatrix`（gate-engine.ts:1628-1655）— 采信 matrix 的 `businessStatus`，恒定生效
  3. web `acceptanceMatrixChecklist`（page-task-detail.ts:2192-2249）— 纯透传，matrix artifact 加载成功时生效
  4. web `buildAcceptanceChecklist`（projection.ts:1472-1504）— **唯一看执行证据**（compile/test gate + 真实通过的测试），仅兜底生效
* 原移交清单「web 是第三套并行判定、UI 与 runner 会给出不同结论」**不成立**——#3 是透传不是重算
* 真正的问题：会算 `at_risk` 的那套逻辑恰好是唯一有执行证据的那套，而它在 `??` 右侧
* `at_risk` 在 gate 侧已有消费方（gate-engine.ts:1643-1646 risk 分支 + :862-874 warn 规则
  `acceptance.business_matrix_criteria_proven`，测试 gate-engine.test.ts:866 固定 `['at_risk','warn']`），
  缺的只是生产端
* `failed` 同样无产出方（仅类型定义与 parse 白名单出现）；因 gate 侧 warn 分支已验证，
  「从类型移除」是错解，只能给产出路径
* `RunCtx` 无 build/test/gate 字段 → runner 只能判 `passed`/`missing`，这是正确分工不是缺陷；
  `at_risk` 的产出方只能是 api gate（有 store.testRuns / store.buildRuns / 历史 gate）
* `ExecutionContract.expectedOutputs`：生产端有写入（skills/index.ts:294,381）但写完无人读；
  唯一消费者 `executionContractOutputConflicts` 在 src 零调用。这是一致性校验缺执行点，不是死字段

## Decisions (ADR-lite，基于研究结论)

### D1: `at_risk` 降级判据（Q1，来自 gate-evidence-access.md + p1-1-adr2-handover.md）

**Context**: ADR-2 要求「文档级与执行级可区分」但不直接收紧为 fail。Web 现有判据是三要素（design coverage + compile gate pass + test gate pass + 真实通过的测试），gate 当前仅检查 verifier 的 evidenceRefs。

**Decision**: Gate 叠加执行证据判据，文档级 `passed`（matrix `businessStatus === 'passed'`）在**缺乏任一执行证据要素**时降级为 `at_risk`。

**判据实现**（gate-engine.ts `evaluateBusinessAcceptanceMatrix` 增强）:
```typescript
const hasVerifierEvidence = criterion.evidenceRefs.length > 0;
const hasExecutionEvidence = 
  compileGate?.status === 'pass' 
  && testGate?.status === 'pass' 
  && hasPassingTests;

// 文档级 passed
const passedStatus = criterion.businessStatusDeclared
  ? criterion.businessStatus === 'passed'
  : criterion.status === 'pass';

// 执行级 passed = 文档级 + 执行证据
const passed = passedStatus
  && hasExecutionEvidence
  && !isCommandOnlyText(...);

// at_risk = 文档级 passed 但证据不足
const risk = passedStatus && !hasExecutionEvidence;
```

**Rationale**: 
- 对齐 ADR-2「先可见」：不把文档级 pass 改判 fail，而是产出 `at_risk` 让 gate warn
- 消费既有基础设施（gate-engine.ts:1643-1646 risk 分支 + :862-874 warn 规则已验证）
- 与 web 兜底逻辑判据一致（三要素皆备才算执行级 pass）

**Consequences**: 
- 既有 run 若只有 matrix 无执行证据，gate 从 pass 变为 warn（不是 fail，可接受）
- 覆盖率统计自动生成：`passedCount / (passedCount + atRiskCount + failedCount)`

---

### D2: `failed` 的产出判据（Q2）

**Decision**: **本任务不产出 `failed`**，仅打通 `at_risk`。`failed` 判据另立任务。

**Rationale**:
- `failed` 的自然语义是「执行证据明确失败」（compile gate fail / test gate fail / 测试有 failed > 0）
- 但当前 matrix 的 `businessStatus` 由 runner 侧纯文本判定产出，runner 只能判 `passed`/`missing`
- Gate 叠加执行证据后，若采信「compile fail → AC failed」，会与 runner 产出的 `passed` 冲突（两层判定）
- 正确解法是 **runner 侧也要看执行证据**，这需要改 `RunCtx` 传参与 verifier 调用协议，超出本任务范围
- ADR-2 的硬要求是「可区分」（`at_risk` 已满足），`failed` 是增量收紧

**Consequences**:
- 类型 `AcceptanceBusinessStatus` 保留 `'failed'` 成员（不移除，避免后续任务重新加回）
- Gate parse 白名单保留 `'failed'`
- 移交清单记录「`failed` 判据需改 runner 侧协议，单独任务」

---

### D3: Web 兜底场景 UX（Q3，来自 web-consumption.md）

**Decision**: 
- **场景 A（matrix artifact 不存在）**: 显示空状态 `"⏳ 验收报告生成中 — Acceptance gate 正在执行，稍后刷新查看完整验收矩阵"`
- **场景 B（加载/解析失败）**: 显示降级提示 `"⚠️ 无法加载验收报告 — 验收矩阵数据解析失败，请联系管理员或重新执行 acceptance_gate"`

**Implementation**:
- `buildAcceptanceChecklist` 保留为兜底函数，删除所有 gate 查询与证据推导逻辑（L1477-1502），返回统一 `status: 'missing'` + 场景特定的 `risk` 文案
- 或在 `acceptanceMatrixChecklist` 内部区分两种 null（`!artifact` vs `catch`），传 reason 给 `buildAcceptanceChecklist`

**Rationale**: 明确告知用户当前状态（生成中 vs 错误），避免误解为「无 AC」。

---

### D4: 类型合并波及面（Q4，来自 web-consumption.md）

**Decision**: `AcceptanceChecklistItem['status']` 改为引用 `AcceptanceBusinessStatus`，波及 2 个文件共 6 处。

**文件清单**:
| 文件 | 改动 |
|---|---|
| `apps/web/src/projection.ts` | L1219 类型定义 + L1493 局部变量 + 顶部新增 import |
| `apps/web/src/page-task-detail.ts` | L2255 返回类型 + L2272 参数类型 + 顶部新增 import |

**Rationale**: 
- 消除内联 union 重复定义
- 后续类型演进（如 `failed` 判据上线）只需改 shared 一处

---

### D5: ExecutionContract 接线点与失败行为（Q5，来自 execution-contract-wiring.md）

**Decision**: 
- **接线点**: `apps/runner/src/skills/index.ts:findSkillForStage` 函数体末尾（return 前）
- **失败行为**: throw Error（开发期爆）

**Implementation**:
```typescript
const conflicts = executionContractOutputConflicts(base);
if (conflicts.length > 0) {
  const details = conflicts.map(c => 
    `  - ${c.outputName}: ${c.reason}`
  ).join('\n');
  throw new Error(
    `[skill.${base.id}] ExecutionContract output conflicts:\n${details}\n` +
    `Fix: align outputs[] and executionContract.expectedOutputs in apps/runner/src/skills/index.ts`
  );
}
```

**Rationale**:
- 统一入口：所有 stage 通过 `findSkillForStage` 获取 skill，一处接线覆盖全部
- 开发期爆：声明冲突是配置错误，应立即失败而非降级为 warn
- ADR-3 合规：这是**开发期声明一致性校验**，不是**运行时输出存在性检查**，不与 operational pause 冲突

**Consequences**: 
- 现有 SKILLS 定义已对齐（测试验证），新增校验零误报
- 未来新增 skill 时，声明漂移会在首次调用时被捕获

---

### D6: ADR-2 覆盖率统计（Q6，来自 p1-1-adr2-handover.md + gate-evidence-access.md）

**Decision**: 覆盖率 = `(执行级 passed 数量) / (总 AC 数量)`，落在 gate rule message。

**Implementation**:
```typescript
// gate-engine.ts :858-876 的 message 生成
const executionLevelCount = matrixEvaluation.criteria.length 
  - matrixEvaluation.atRisk.length 
  - matrixEvaluation.failed.length;
const totalCount = matrixEvaluation.criteria.length;
const coverage = totalCount > 0 
  ? `${executionLevelCount}/${totalCount} (${Math.round(100 * executionLevelCount / totalCount)}%)`
  : 'N/A';

message: `Business acceptance: ${coverage} execution-level, ${matrixEvaluation.atRisk.length} at-risk`
```

**Rationale**: 
- ADR-2 硬要求：「记录覆盖比例，后续收紧任务依赖这份数据」
- Gate rule message 是既有传输面（UI 已渲染，无需新增字段）
- `at_risk` 数量同时体现，供人工复查

---

## Implementation Notes (from research)

### Gate 侧取数路径（gate-evidence-access.md 关键发现）

**现状**: `evaluateBusinessAcceptanceMatrix` 当前**无法访问** store，调用方 `runAcceptanceTraceabilityGate` 已获取 `testGate` 但未传递。

**改动**: 
1. 修改 `evaluateBusinessAcceptanceMatrix` 签名，接收 `context: { compileGate, testGate, hasPassingTests }`
2. 调用方（gate-engine.ts:715）传入：
   ```typescript
   const compileGate = store.gateRuns.latestForGate(workflowRunId, 'compile_gate');
   const testGate = store.gateRuns.latestForGate(workflowRunId, 'test_gate'); // 已有
   const hasPassingTests = detail.tests.some(t => t.total > 0 && t.failed === 0 && t.errors === 0);
   ```

**Caveat**: `hasPassingTests` 计算逻辑需确认数据源（store.testRuns 还是 surefire aggregate），gate-evidence-access.md 标注为待追溯。

### Web 透传方案（web-consumption.md）

**删除**: `buildAcceptanceChecklist` 的 L1477-1502（gate 查询 + 证据收集 + status 决策）

**保留**: 骨架函数返回兜底 checklist（`status: 'missing'`, `evidence: []`, `risk: '<场景提示>'`）

**传输面**: Web 已通过 `acceptanceMatrixChecklist` 读取 matrix artifact 的 `businessStatus`，gate 产出 `at_risk` 后自动透传，**无需新增字段**（gate-evidence-access.md 选项 B）。

## Requirements (final)

* R1 api gate 成为 AC 状态唯一权威判定方：在采信 matrix `businessStatus` 的基础上叠加执行证据判据，文档级 `passed` 在执行证据不足时降级为 `at_risk`（**D1 判据**）
* R2 runner `businessAcceptanceStatus` 保持只产 `passed`/`missing`（分工正确，不改判定逻辑）
* R3 web 侧 `buildAcceptanceChecklist` 的执行证据判据移除，改为纯透传 matrix 结论；兜底场景显示明确提示（**D3 UX**）
* R4 `AcceptanceChecklistItem['status']` 与 shared `AcceptanceBusinessStatus` 类型合并（**D4 波及 2 文件 6 处**）
* R5 `executionContractOutputConflicts` 接线到 `findSkillForStage`，声明漂移在开发期爆（**D5 throw Error**）
* R6 `failed` 的产出路径移交下个任务（**D2 决策：本任务不产 failed**）
* R7 覆盖率统计落在 gate rule message（**D6 口径：执行级数量 / 总数**）

## Acceptance Criteria (final)

* [ ] Gate 对「文档级 passed 但无执行证据」的 AC 产出 `at_risk`，且 `acceptance.business_matrix_criteria_proven` 规则 warn 生效（**D1 判据实现**）
* [ ] Gate rule message 显示覆盖率统计 `"X/Y (Z%) execution-level, N at-risk"`（**D6**）
* [ ] Web 两处调用点不再本地重算执行证据判据；UI 呈现与 gate 结论一致（**R3 透传**）
* [ ] Matrix artifact 不存在时显示 "⏳ 验收报告生成中"，加载失败时显示 "⚠️ 无法加载验收报告"（**D3 兜底 UX**）
* [ ] `AcceptanceChecklistItem['status']` 引用 shared `AcceptanceBusinessStatus`（**D4 类型合并**）
* [ ] `executionContractOutputConflicts` 在 `findSkillForStage` 调用，冲突时 throw Error 并指向修复位置（**D5 接线**）
* [ ] `npm run typecheck` 四包 exit 0；`npm test`（bun runtime）全绿
* [ ] 变异验证：剪断新判据（gate 侧执行证据检查 + web 侧透传）后相关测试变红（防假绿，参照 P1-2 教训）
* [ ] 新增测试：gate 判据单元测试、executionContract 接线测试、web 兜底场景测试

## Out of Scope (explicit)

* 不改 runner 侧文本判定逻辑（`businessAcceptanceStatus` 判据保持）
* **不产出 `failed` 状态**（D2 决策：需改 runner 协议，单独任务）
* 不做检索质量指标 / maskSecrets 扩充 / graph version bump（journal 列出的其余三个新任务）
* 不引入 per-criterion 测试映射之外的新证据采集机制（以现有 store 数据为准）
* 不修改 gate rule result 结构（gate-evidence-access.md 选项 A 不采纳，采纳选项 B：web 直接读 matrix artifact）

## Definition of Done (team quality bar)

* 单测/集成测试补齐（gate 判据、透传、类型合并、contract 接线各有覆盖）
* typecheck / test 全绿（bun runtime，勿用 npx vitest —— bun:sqlite 会把 suite 报成 skipped）
* spec 若有新知识按 trellis-update-spec 沉淀
* 提交按三段式（work → archive → journal）

## Out of Scope (explicit)

* 不改 runner 侧文本判定逻辑（`businessAcceptanceStatus` 判据保持）
* 不做检索质量指标 / maskSecrets 扩充 / graph version bump（journal 列出的其余三个新任务）
* 不引入 per-criterion 测试映射之外的新证据采集机制（以现有 store 数据为准）

## Technical Notes

* 关键先例：P0-2（verdict 是证据不是状态）、P1-2（RuleResult.message 消费）、P1-1（EvidenceContract R1/R2）
* 已知坑（journal session 69）：fixture key 必须抄真实写入方；同 kind 第二个 artifact 会让「取最新同类」读者静默重指向；绿色提取函数测试不证明线是通的（要做变异验证）
* bun runtime 跑测试；`bun run typecheck` 不查 test 文件

## Research References

* [`research/current-shape.md`](research/current-shape.md) — 四处判定真实形状与修正结论（✅ 完成）
* [`research/p1-1-adr2-handover.md`](research/p1-1-adr2-handover.md) — ADR-2 原文与移交清单修正（✅ 完成）
* [`research/gate-evidence-access.md`](research/gate-evidence-access.md) — gate 侧证据可及性与传输面（✅ 完成，选项 B：web 读 matrix artifact）
* [`research/web-consumption.md`](research/web-consumption.md) — web 消费路径与兜底影响面（✅ 完成，波及 2 文件 6 处）
* [`research/execution-contract-wiring.md`](research/execution-contract-wiring.md) — contract 校验接线点（✅ 完成，推荐 findSkillForStage + throw）

## Next Steps

1. ✅ 研究阶段完成（5 个研究文件全部落盘）
2. ✅ Open Questions 全部决策（6 个 ADR-lite 决策记录在案）
3. ⏭️ 更新 `implement.jsonl` 为可执行的改动清单（基于研究结论与决策）
4. ⏭️ 调用 `task.py start` 进入 in_progress 状态
5. ⏭️ 派发 trellis-implement 代理执行改动
6. ⏭️ 派发 trellis-check 代理验证质量
