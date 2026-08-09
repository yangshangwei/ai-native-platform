# P1-1 EvidenceContract + artifact freshness：给已有的失效信号接上执行方

## Goal

调研推翻了原始设想。P1-1 不需要发明 digest 机制或 freshness 传播 —— 平台**每次读 artifact 时都已经在重算 sha256 并比对**，只是那个 mismatch 信号除了 UI 上一个红色 pill 之外无人消费。同时，AC 的"已验证"判定完全建立在文档文本上，与任何执行结果无关。

本任务做两件事：给已有的 digest mismatch 信号接上 gate 执行方；把 AC proof 从"文档写了"推进到"有执行证据"。

来源：`.trellis/tasks/archive/2026-08/07-30-umadev/research/comparison.md` P1-1 段 + 本任务 `research/` 两份调研。

## What I already know

### 已验证（本任务调研，含文件行号）

**digest 机制已完整存在，缺的是后果：**

* `apps/api/src/workflow-engine.ts:862-896` — `createArtifact` 是唯一落库入口，对 `file://` 算 sha256，非 file URI 为 `null`。
* `packages/shared/src/node/digest.ts:16-20` — `verifyFileSha256` 产出三态 `verified: true | false | null`。
* `apps/api/src/artifact-content.ts:22-24,36` — **每次读 artifact 内容都会重算并比对**。这是生产路径，不是死代码。
* `apps/web/src/page-task-detail.ts:2830-2834` — `verified === false` 的**唯一**消费方是一个显示 "sha256 mismatch" 的 pill。
* `apps/api/src` 内**零消费** `DigestVerification.verified`（已 grep 验证）。
* `gate-engine.ts:1171-1173,1231-1240,1461-1463` — 三处 digest 相关判定**全是存在性检查**，没有一处比较 expected vs actual。且 `evidence.artifact_digests_present` 的 status 是 `warn` 不是 `fail`。
* `packages/shared/src/types/artifact.ts:647-648` — `sha256?: string | null`，注释诚实写明 "Null for non-file or legacy artifacts"。`mem://` 类 artifact（rejection_feedback、project capability）无 digest，但都不在证据链上。

**AC proof 完全不看执行结果：**

* `apps/runner/src/orchestrator/steps.ts:817-830` — `businessAcceptanceStatus` 只读 markdown 文本，**不读 test gate / CommandRun / diff 内容 / exit code**。
* `steps.ts:790-815` — `verificationMethod` 来自 design.md 表格的第 4 个单元格（硬编码列序 `cells[3] ?? cells.at(-1)`）。
* `steps.ts:832-844` — `businessAcceptanceEvidenceRefs` 给**每一条** AC 绑定完全相同的 4 个 artifact（requirement.md / design.md / diff / review.md）。claim 字符串里的 `${id}` 制造特异性假象，实际是整个 run 的同一份 diff。
* `gate-engine.ts:1584-1611` — gate 侧三个合取项里，`hasEvidence` 因上一条而**几乎恒真**，`passedStatus` 完全采信 runner 的文本判定。
* 最松通过路径（调研已验证完整链条）：在 design.md 写一行够长的表格文字 → AC 判 passed。**全程无一行代码验证功能是否被实现。**

**两处违反既有纪律的事实：**

* `gate-engine.ts:498-509` 的 `isCommandOnlyText` 与 `steps.ts:869-880` 的 `commandOnlyVerifierText` **逐字符相同**（已 diff 验证，唯一差异是函数名）。跨包复制粘贴，任一侧改动会让写侧读侧对"什么算命令"产生分歧。
* `AcceptanceBusinessStatus` 的 `at_risk`：gate 侧有分支（`gate-engine.ts:1599-1601`）、runner 侧 `steps.ts:736` 读它，但 `businessAcceptanceStatus` **只返回 `'missing'` 或 `'passed'`**，从不产出 `at_risk`。第三处"声明了没有执行方"。

### 既有可复用形状

* `ToolResultRef`（`packages/shared/src/types/tool-invocation.ts:39-42`）= `{ kind, id, digest?, claim }`，且 `steps.ts:272,351` 已在实用 `digest: diffArtifact.sha256 ?? null`。**"artifact 引用带 digest" 的形状已存在**，不需要发明第二套。
* `StepCheckpoint.inputArtifactIds` / `outputArtifactIds` **已通电**（`apps/api/src/step-checkpoints.ts:55,86`，`checkpointAgentTask` 从 AgentTask 继承并 merge 去重）。记的是 artifact **id**，缺的是"id + 当时的 sha256"配对。

## Assumptions (temporary)

* 本轮不做跨 run 的 freshness 传播，只做 run 内的证据可信度。
* `mem://` artifact 无 digest 是可接受的 —— 它们不在证据链上。
* 不改 design.md 的表格列序约定（那会破坏既有 run 的解析）。

## Open Questions

无阻塞项。三个设计分叉见 ADR。

## Requirements

### R1 — digest mismatch 接上 gate 执行方

* `readArtifactContent` 已返回 `DigestVerification`，但 `reports.ts:443,646` 和 `context-governance.ts:277` **丢弃了 `.digest` 只取 `.text`**。让这些消费点保留校验结果。
* `evidence_gate` 增加规则：证据链上的 artifact 出现 `verified === false` → **fail**（不是 warn）。理由：内容与落库 digest 不符意味着证据已被篡改或损坏，这比"缺 digest"严重得多，而后者当前才只是 warn。
* `verified === null`（无 expected，即 `mem://` 或 legacy）→ 维持现状不新增惩罚，但 rule message 要能区分三态。
* 规则的 evidence 必须指出**是哪个 artifact** mismatch，不能只说"有证据不一致"。

### R2 — 消灭 `isCommandOnlyText` 的第二份拷贝

* 判定下沉到 `packages/shared`，api 与 runner 共用同一份纯函数。
* 这是 `deriveGraphRunStatus` / `parseReviewerVerdict` 已建立的纪律的第三次应用。
* 下沉时**不改变判定行为** —— 本轮只消除分歧风险，阈值调整属另一件事。要有测试固定「下沉前后行为一致」。

### R3 — AC proof 接上执行证据

目标不是推翻现有启发式，而是**加一条真实约束**：

* AC 的 evidenceRefs 除了通用四件套，必须能关联到至少一个**该 run 内真实发生过的执行**：CommandRun（含 exit code）、TestRun、或 verifier media。
* 新增 gate 规则区分两种 pass：
  * **文档级 pass**（现状）：有 text + verificationMethod 且非 command-only。
  * **执行级 pass**：额外具备指向具体 CommandRun / TestRun 的证据。
* 本轮**不**把文档级 pass 直接判 fail（会让所有既有 run 回归），而是让两者在 gate rule message 与 UI 上**可区分**，并记录覆盖比例（多少条 AC 达到执行级）。
* 这是 ADR-2 的核心：先让差异可见，再谈收紧。

### R4 — `at_risk` 悬空处理

* `businessAcceptanceStatus` 从不返回 `at_risk`，但 gate 与 runner 都有读它的分支。
* 二选一并说明理由：让它有真实产出路径（例如"有执行证据但 exit code 非零"），或从类型中移除。
* **不允许**保持现状（声明了没有执行方，正是前三个任务反复批评的模式）。

### R5 — 测试

* shared：下沉后的 command-only 判定，覆盖 R2 要求的"行为不变"。
* api：digest mismatch → gate fail，且 evidence 指名 artifact；`verified === null` 不误伤。
* api：文档级 pass 与执行级 pass 的区分，覆盖比例计算。
* runner：`at_risk` 按 R4 的选择，要么有产出测试，要么确认类型已移除。
* fixture 的 digest 值必须来自真实 `sha256File` 计算，不能编造 —— 见 `.trellis/spec/guides/index.md`。

## Acceptance Criteria

* [ ] artifact 内容与落库 digest 不符时 `evidence_gate` fail，evidence 指出具体 artifact。
* [ ] `verified === null` 不产生新的失败。
* [ ] `isCommandOnlyText` 只剩一份实现，api 与 runner 共用，行为不变有测试。
* [ ] gate 能区分文档级 pass 与执行级 pass，并给出覆盖比例。
* [ ] 既有 run 不因本任务批量回归（文档级 pass 仍可通过）。
* [ ] `at_risk` 要么有真实产出路径，要么被移除。
* [ ] `npm run typecheck` + `npm test` 全绿。

## Definition of Done

* 质量门 = `npm run typecheck` + `npm test`（本仓库无 lint 配置），贴实际输出。
* 测试在 bun runtime 下跑；`npx vitest` 会把 suite 报成 skipped。
* `typecheck` **不覆盖 test 文件**（tsconfig include 只有 `src/**/*`）。
* 未制造第二套 evidence / digest / 判定真相。

## Out of Scope

* 不做跨 run 的 upstream→downstream stale 传播（成本高且收益依赖多 run 场景，留作后续）。
* 不改 design.md 表格列序约定。
* 不调整 command-only 的阈值（`< 8`）—— 下沉与调参分开。
* 不做自动返工（P1-2）。
* 不统一持久化边界（P1-3）。
* 不收编 `ExecutionContract.expectedOutputs` —— 见 ADR-3。

## Technical Approach

1. **shared**：下沉 command-only 判定为纯函数（R2）。
2. **api**：让丢弃 `.digest` 的消费点保留它；`evidence_gate` 新增 mismatch 规则（R1）；AC proof 分级（R3）。
3. **runner**：改用 shared 的判定；处理 `at_risk`（R4）。

## Decision (ADR-lite)

### ADR-1：digest mismatch 判 fail，不是 warn

**Context**：现有 `evidence.artifact_digests_present`（缺 digest）是 `warn`。新规则跟随还是更严？

**Decision**：mismatch 判 `fail`。

**Rationale**：两者语义差别很大。"缺 digest" 是平台没算（legacy / `mem://`），是我们自己的覆盖问题；"digest 不符" 是内容与记录不一致，意味着证据在落库后被改动过。后者让整条证据链失去意义，不能只是提醒。

**Consequences**：若有 artifact 被合法地原地重写（目前未发现此类路径），会开始 fail。R5 要求测试覆盖 `verified === null` 不误伤，正是为了限定爆炸半径。

### ADR-2：AC proof 分级可见，不直接收紧

**Context**：最彻底的做法是"没有执行证据就判 fail"。

**Decision**：本轮只让文档级与执行级**可区分**并统计覆盖比例，不改变通过与否。

**Rationale**：直接收紧会让所有既有 run 和所有非代码类 AC（"文档已更新"、"配置已调整"）批量 fail。研究文档的判断标准写明"对 fast path 可以降级"。先让差异可见是可逆的一步，收紧是不可逆的一步 —— 且收紧前需要真实数据判断执行级覆盖率能到多少。

**Consequences**：本轮不解决"文档写了但代码没做"的根本问题，只让它可被看见。真正收紧需要下一个任务，且应当基于本轮统计出的覆盖率数据。

### ADR-3：不收编 `expectedOutputs`

**Context**：P0-3 留下 `ExecutionContract.expectedOutputs` 无执行方，当时说 P1-1 应当收编或删除。

**Decision**：本轮**不动**它。

**Rationale**：P1-1 的重心已被调研改写为"digest 信号 + AC proof 分级"，与 output 存在性检查不是同一件事。而且 skill outputs 的 `required: true` 已在 `steps.ts:1129` 走 operational pause 兜底，收编会产生第二套判定。硬塞进来会让本任务失焦。

**Consequences**：`expectedOutputs` 继续悬空。**这是本轮明确接受的债**，应当在 P2 或独立清理任务中与 `at_risk`（R4 处理）一并做类型层清理。不能无限期拖延 —— 它与本任务批评的模式是同一类。

## Technical Notes

* `CommandRun` 的三个 digest 走另一套写入路径（`command-runner.ts:155-157`，对 buffer 而非文件算），与 artifact sha256 是并行两套但语义一致，`readFileUriContent` 对两者复用同一个 `verifyFileSha256`。R1 应覆盖两者。
* `artifact-content.ts:48-59` 有 root 白名单，沙箱外的 artifact 读取先失败、digest 校验根本不会发生。若做全量扫描要注意这个边界。
* `verificationMethodForCriterion` 取 `cells[3]` 是硬编码列序，动这块前先查 spec 里 design.md 模板是否强制列序。
* 调研未统计现网 DB 里 `sha256 IS NULL` 的实际比例。R1 上线前若能跑一次库统计更稳妥。

## 调研补遗（主线程补齐，调研代理因 API 故障未覆盖）

调研代理落盘两份文件后因上游 API 错误中断，B/D 两问已完整覆盖（即上面引用的两份 research）。C 与 F 由主线程补查：

### C — `ContextFreshness` 确属另一件事，不可复用

`packages/shared/src/types/context.ts:22`：

```ts
export type ContextFreshness = 'current' | 'possibly_stale' | 'historical';
```

这是**知识召回的时效性**语义（这条知识现在还适不适用），消费方是 `router.ts:223`（`historical` 不参与召回）和 `reports.ts`。

与本任务关心的「run 内 artifact 内容与落库 digest 不符」是不同维度：前者问"这条知识过时了吗"，后者问"这份证据被改过吗"。一份 digest 完全匹配的 artifact 也可以承载 `historical` 的知识。**不复用该枚举是正确的**，混用会让两种语义互相污染。

### F — `retryStage` 不触碰证据，印证了「不做跨 run 传播」的范围判断

`apps/api/src/workflow-engine.ts:623-660`：重试只把目标 step 状态重置为 `pending`（第 28 行）或新建一条 `pending` step（第 37 行），**不触碰任何 artifact、evidence 或 gate 结果**。

含义：真正的 upstream→downstream 失效传播需要在这里引入一整套新语义（哪些 artifact 因这次重试而失效、下游哪些 node 的证据要标 stale、历史证据如何保留但不放行）。这远超本轮收益，Out of Scope 的判断成立。

本轮做的 R1（digest mismatch 判 fail）是这条路线上**成本最低、收益最直接**的第一步：它不需要传播语义，只需要让已经在算的比对结果有后果。

## 实施结果：R1/R2 完成，R3/R4 因新事实改变解法而移出本轮

### 已完成

**R1 — digest mismatch 接上执行方**（`evidence.artifact_digests_match`）

新规则消费的正是那个一直在算、却只到 UI pill 为止的比对结果。三态处理：
- `mismatch` → **fail**，message 与 evidenceRefs 都点名具体 artifact
- `match` → pass
- `unverifiable`（无 digest / 非 file:// / 文件已清理 / 超出 artifact root 白名单）→ pass，绝不惩罚平台自身的覆盖缺口

`verifyArtifactDigestState` 全程不抛异常 —— gate 不能因为某个 artifact 被清理而崩溃。

**变异验证**（两次，各自只击中对应测试，其余 33 条不受影响）：
1. 规则恒 pass → 只有「mismatch 判 fail」测试红
2. `unverifiable` 改判 mismatch → 只有「文件读不到不算篡改」测试红

**R2 — 消灭第二份 `isCommandOnlyText`**

下沉到 `packages/shared/src/utils/acceptance-text.ts`，api 与 runner 共用。行为为 verbatim lift（已 diff 验证原两份逐字符相同）。6 条测试固定行为，含 7/8 字符边界钉死 `< 8` 阈值，确保后续调参必须是显式决定。

### R3/R4 移出本轮的理由（新发现推翻了原解法）

**`at_risk` 不是完全悬空 —— 存在两套同名不同源的判定。**

| 类型 | 位置 | `at_risk` 产出 | 判据 |
|---|---|---|---|
| `AcceptanceBusinessStatus` | `packages/shared/src/types/artifact.ts:310` | **无产出方**（`businessAcceptanceStatus` 只返回 `missing`/`passed`） | 纯 markdown 文本 |
| `AcceptanceChecklistItem['status']` | `apps/web/src/projection.ts:1219`（内联字面量） | **有产出**（`projection.ts:1495-1499`） | compile gate + test gate + 真实通过的测试 |

调研结论对前者成立，但它漏了后者。而后者的判定**比 runner 那套严格得多** —— 它要求 `compileGate=pass && testGate=pass && hasPassingTests` 才给 `passed`，否则降级 `at_risk` 并附 "Evidence is partial; confirm risk before completion."

**这意味着 web 已经在做 R3 想做的事**（把 AC 状态关联到执行证据），只是：
1. 它在客户端做，不进 gate 判定
2. 它的状态集合是内联字面量，与 shared 的 `AcceptanceBusinessStatus` 语义重叠但无类型关联

**解法因此反转**：`at_risk` 本就不该由 runner 产出。`RunCtx`（`apps/runner/src/orchestrator/types.ts:93-117`）里没有 build / test / gate 结果 —— runner 在 verifier 阶段**看不到执行证据**，它只有文本，所以它只能判 `passed`/`missing`，这是正确的分工。

正确的归属是：**runner 报告文档级状态，api gate 基于执行证据决定是否降级为 `at_risk`**，web 的现有派生逻辑上收到 gate 侧成为单一判定。

这同时解决 R3（执行级 vs 文档级分级）和 R4（`at_risk` 产出路径），但它是一次跨三层的设计变更，不该塞进本轮尾部。已完成的 R1/R2 是独立且完整的，先落袋。

### 移交给后续任务的完整清单

1. `at_risk` 判定上收到 api gate，web 的 `buildAcceptanceChecklist` 改为消费 gate 结果而非本地重算 —— 消除第三套判定。
2. R3 的执行级/文档级分级与覆盖率统计（ADR-2 的分级可见）。
3. `AcceptanceChecklistItem['status']` 内联字面量与 shared `AcceptanceBusinessStatus` 合并。
4. `ExecutionContract.expectedOutputs`（P0-3 遗留，ADR-3 记录）—— 与上述一并做类型层清理。

前三项其实是同一件事的三个面，应当作为一个任务一起做。
