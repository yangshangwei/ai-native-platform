# P1-1 ADR-2 原文与移交清单核对（主线程提取，2026-08-09）

> 背景：research-adr2 子代理两次因 API 连接中断失败且无落盘，源文件仅 237 行，改由主线程直接提取。
> 源：`.trellis/tasks/archive/2026-08/08-09-p1-1-evidencecontract-artifact-freshness-node/prd.md`（下称 P1-1 prd）

## 一、原文要求

### ADR-2：AC proof 分级可见，不直接收紧（P1-1 prd:137-145）

原文要点（近逐字）：

- **Context**：最彻底的做法是「没有执行证据就判 fail」。
- **Decision**：本轮只让文档级与执行级**可区分**并统计覆盖比例，**不改变通过与否**。
- **Rationale**：直接收紧会让所有既有 run 和所有非代码类 AC（「文档已更新」「配置已调整」）批量 fail。
  「先让差异可见是可逆的一步，收紧是不可逆的一步 —— 且收紧前需要真实数据判断执行级覆盖率能到多少。」
- **Consequences**：本轮不解决「文档写了但代码没做」的根本问题，只让它可被看见。
  **真正收紧需要下一个任务，且应当基于本轮统计出的覆盖率数据。**

### R3 原始描述：AC proof 接上执行证据（P1-1 prd:69-77）

- AC 的 evidenceRefs 除通用四件套外，须能关联到至少一个**该 run 内真实发生过的执行**：
  CommandRun（含 exit code）、TestRun、或 verifier media。
- 新增 gate 规则区分两种 pass：
  - **文档级 pass**（现状）：有 text + verificationMethod 且非 command-only。
  - **执行级 pass**：额外具备指向具体 CommandRun / TestRun 的证据。
- 本轮**不**把文档级 pass 直接判 fail（会让既有 run 批量回归），而是让两者在
  **gate rule message 与 UI 上可区分**，并**记录覆盖比例**（多少条 AC 达到执行级）。
- 「这是 ADR-2 的核心：先让差异可见，再谈收紧。」

### R4 原始描述：`at_risk` 悬空处理（P1-1 prd:79-83）

- `businessAcceptanceStatus` 从不返回 `at_risk`，但 gate 与 runner 都有读它的分支。
- 二选一并说明理由：给真实产出路径（例句：「有执行证据但 exit code 非零」），或从类型移除。
- **不允许保持现状**（声明了没有执行方）。

### ADR-3 对 `expectedOutputs` 的边界（P1-1 prd:147-155）

- P1-1 明确不收编 `ExecutionContract.expectedOutputs`，理由：skill outputs 的 `required: true`
  已在 `steps.ts:1129` 走 operational pause 兜底，**运行时收编会产生第二套判定**。
- Consequences 写明：这是明确接受的债，应与 `at_risk` 清理一并做**类型层**清理。
- ⚠️ 对本任务的含义：接线 `executionContractOutputConflicts` 是**开发期声明一致性校验**，
  与 ADR-3 否决的「运行时输出存在性检查」不是一件事，不冲突；实现时不得做成运行时第二套判定。

### 移交清单（P1-1 prd:230-237，实施尾部新增）

1. `at_risk` 判定上收到 api gate，web 的 `buildAcceptanceChecklist` 改为消费 gate 结果而非本地重算 ——「消除第三套判定」
2. R3 的执行级/文档级分级与覆盖率统计（ADR-2 的分级可见）
3. `AcceptanceChecklistItem['status']` 内联字面量与 shared `AcceptanceBusinessStatus` 合并
4. `ExecutionContract.expectedOutputs`（P0-3 遗留，ADR-3 记录）—— 一并做类型层清理

原文强调：「前三项其实是同一件事的三个面，应当作为一个任务一起做。」

## 二、已被 current-shape.md 修正的论断

| P1-1 论断（出处） | 实地核查结论（current-shape.md） |
|---|---|
| 「web 已经在做 R3 想做的事」「存在第三套判定」（prd:211-228） | **不成立**。正常路径是 `acceptanceMatrixChecklist` 纯透传；`buildAcceptanceChecklist` 仅在 matrix 缺失/加载失败时兜底。UI 与 runner 不会对同一 AC 给出不同结论。真问题是**唯一看执行证据的判定被放在兜底位** |
| R4「或从类型移除」仍是可选项（prd:82） | **移除是错解**。gate 侧 risk 分支（gate-engine.ts:1643-1646）+ warn 规则 `acceptance.business_matrix_criteria_proven`（:862-874）+ 测试锚点 gate-engine.test.ts:866 固定 `['at_risk','warn']` 都已存在，移除会连带删掉已验证的降级语义。只剩「给产出路径」一条路 |
| `at_risk` gate 分支在 gate-engine.ts:1599-1601（prd:36） | 行号已漂移，现为 :1643-1646（文件此后有改动，实施时以最新为准） |

仍然成立的论断：

- `RunCtx` 无 build/test/gate 字段，runner 只能判 `passed`/`missing`，是正确分工（prd:224 与 current-shape.md 修正点四一致）
- 正确归属：「runner 报告文档级状态，api gate 基于执行证据决定是否降级为 `at_risk`」（prd:226）
- `failed` 同样无产出方（current-shape.md 补充：仅类型定义与 parse 白名单出现；P1-1 未处理）

## 三、对本任务 PRD 的直接输入

1. **分级语义直接沿用 ADR-2**：文档级 pass（matrix `businessStatus === 'passed'`，纯文本判定）vs
   执行级 pass（叠加真实执行证据）。本任务把「可区分」落为 gate 产出 `at_risk`（文档级但证据不足）——
   这正是 ADR-2 说的「先可见」，且消费的是已存在的 warn 分支，不改变 gate 总体 pass/fail 结论。
2. **覆盖率统计是 ADR-2 的硬要求**：gate 须统计「多少条 AC 达到执行级」，落在 rule message /
   rule evidence 里（具体字段以 gate-evidence-access.md 研究为准）。后续收紧任务依赖这份数据。
3. **执行证据的候选口径**（R3 原文）：CommandRun（exit code）、TestRun、verifier media 三类。
   本任务 MVP 判据从 store 已有数据取（compile/test gate + 真实通过的测试，对齐 web 兜底逻辑的判据），
   per-criterion 关联视 gate-evidence-access.md 结论决定是否纳入。
4. **R4 只剩一条路**：给 `at_risk` 产出路径（api gate 降级判定），不移除类型。
5. **`failed` 是本任务新决策点**（P1-1 未覆盖）：R3 原文的例句「有执行证据但 exit code 非零」
   提示了 `failed` 的自然判据方向（执行证据明确失败），但需在 PRD 以 ADR-lite 单独决策。
6. **ExecutionContract 接线的红线**：只做开发期声明一致性校验（registration 路径），
   不做运行时输出检查（ADR-3 已否决，避免与 steps.ts:1129 operational pause 形成第二套判定）。
7. **「消除第三套判定」的表述要更正**为「把唯一看执行证据的判定从兜底位上收为权威判定」——
   动机不变（单一判定方），理由已修正。
