# Test Integrity Gate（测试完整性守卫）

## Goal

补上平台核心约束 3（"Build/Test 必须来自真实命令"）的一个真实破口：命令是真的，但 Agent 可以在 implementation 阶段**弱化测试面**（删测试文件/用例、抽断言、加 @Ignore/@Disabled、改 surefire 配置）来换取 `test_gate=pass` 的绿灯。借鉴 UMA-DV `UD-QA-001`（test-integrity / anti-reward-hacking guard）：对 doer turn 前后的测试面做**确定性对比**，任何弱化判定为 blocking，新增测试永远不算违规，无基线时 fail-open。

## What I already know（仓库事实）

* implementation 阶段产出 `diff` artifact + `changed-files`，随后跑 `diff_scope_gate`（白名单 `src/`，**src/test 也在白名单内**，路径检查放行测试改动）与 `sensitive_change_gate`（pom.xml 命中仅 warn）— `apps/runner/src/orchestrator/steps.ts:299-397`。
* implementation 的改动是**未提交的工作区改动**（skill toolPolicy 只允许 `git diff` / `git diff --name-only`，无 commit），所以 doer turn 基线 = worktree `HEAD`。
* `executeBuildTest` spawn 真实命令 → `collectReports` 解析 Surefire/Failsafe XML → `api.mavenBuild` 在 API 侧跑 `compile_gate` / `test_gate`（`apps/api/src/workflow-engine.ts:1322-1343`）。`test_gate` 只验 exit code / surefire 计数 / 非全 skip，**不验测试面是否被弱化**。
* Gate 由 API 侧 gate-engine 判定，runner 通过 `POST /runner/events/run-gate` 触发，dispatch 是 `switch (body.gateId)`（`apps/api/src/routes/runner-events.ts:930-999`）。
* `GateId` 是字符串字面量 union（`packages/shared/src/types/gate.ts:10-19`）；`PerRunArtifactKind` 同（`packages/shared/src/types/artifact.ts:30-49`）。
* 纯解析工具的既有位置：`packages/shared/src/utils/surefire.ts`（surefire XML → TestRun 计数），有 vitest 测试。
* `evidence_gate` 要求每条 pass 规则挂可解析 evidenceRefs；"not applicable:" 前缀消息可豁免（`apps/api/src/gate-engine.ts:961-964`）。

## Requirements

* R1 **测试文件/用例删除即违规**：`src/test/**` 下文件被删除（含 rename 后测试消失），或保留文件中 `@Test` 方法数下降 → fail。
* R2 **断言弱化即违规**：保留的测试文件中用例数未降但断言调用位点数（`assert*` / `assertThat` / `verify` / `fail(`）下降 → fail。
* R3 **新增跳过标记即违规**：新增 `@Ignore` / `@Disabled`（含带理由变体）或被注释掉的 `@Test` 数量增加 → fail。
* R4 **测试 harness 配置弱化即违规**：`pom.xml` 中 surefire/failsafe 插件配置块或 `skipTests` / `maven.test.skip` 属性被改动，或 `mvnw` / `mvnw.cmd` / `.mvn/**` 被修改/删除 → fail。
* R5 **新增测试永不违规**：新增文件、新增用例、新增断言不触发任何规则。
* R6 **fail-open**：基线不可得（git show 失败、HEAD 不可解析）或文件不可解析 → 对应规则 `skipped`，消息以 `not applicable:` 开头，不产生 blocking finding。
* R7 违规时 run 终止路径与 `diff_scope_gate` fail 一致：step failed + `c.ok.value=false` + throw；GateRun 落库、violation 明细进 ruleResults，evidenceRefs 指向 test_surface_report + diff artifact。
* R8 所有 4 条 flow（feature.standard / fastforward / issue.standard / refactor.standard）自动获得该守卫（都含 build_test stage）。

## Acceptance Criteria

* [ ] AC-001 删除 `src/test/**` 下测试文件的 diff → `test_integrity_gate=fail`，rule `integrity.test_files_deleted` 点名文件。
* [ ] AC-002 保留文件中删 `@Test` 方法 → fail，rule `integrity.test_cases_removed` 给出 before/after 计数。
* [ ] AC-003 用例数不变但断言数下降 → fail，rule `integrity.assertions_weakened`。
* [ ] AC-004 新增 `@Disabled` / `@Ignore` / 注释掉 `@Test` → fail，rule `integrity.skip_markers_added`。
* [ ] AC-005 修改 pom.xml surefire 配置块 / `maven.test.skip` → fail，rule `integrity.harness_config_modified`；修改 pom.xml 其他部分（如加依赖）→ 该规则 pass。
* [ ] AC-006 只新增测试文件/用例/断言 → gate pass（全部规则 pass 或 skipped）。
* [ ] AC-007 基线不可得时 → 规则 skipped、gate 不 fail（fail-open），消息 `not applicable:` 前缀。
* [ ] AC-008 gate fail 时 build_test step failed、mvn 未执行（先于 compile 判定）、run 终止。
* [ ] AC-009 `test_surface_report` artifact（JSON，schemaVersion `test-surface-report/v1`）落库带 sha256，GateRun evidenceRefs 可被 `evidence_gate` 解析。
* [ ] AC-010 纯函数分析器有 vitest 覆盖（≥ 上述各判定一正一反）；`bun run test` 与 `bun run typecheck` 全绿。

## Definition of Done

* 单测 + 集成路径（run-gate route case）测试补齐，vitest 全绿、typecheck 全绿。
* `.trellis/spec` 相关 spec 若行为契约变化则更新（flow-registry.md 不变——不新增 stage；quality-guidelines 视需要）。
* README「What runs」表格补 `test_integrity_gate` 一行。

## Technical Approach

**数据流**（复用 surefire → TestRun 的既有模式：runner 产证据，engine 下判定）：

1. `executeBuildTest` 开头（spawn compile 之前）：runner 在 worktree 内计算 **test surface report**：
   - `git diff --name-status -M HEAD` 得变更清单（含 rename 对）。
   - 对每个测试相关文件：before = `git show HEAD:<path>`，after = 工作区文件；用共享纯函数计数。
   - harness 检查：pom.xml 的 before/after 各自提取 surefire/failsafe/skip 相关片段后对比；mvnw/.mvn 变更直接由 name-status 判定。
   - 产出 JSON 写入 `runArtifactsDir/build_test/test-surface-report.json`，`postArtifact(kind: 'test_surface_report')`。
2. runner `api.runGate({ gateId: 'test_integrity_gate' })` → `/run-gate` 新 case 读取该 artifact → `runTestIntegrityGate()`（gate-engine 新函数）逐规则判定。
3. fail → 与 diff_scope_gate 相同的终止路径；pass/skipped → 继续 compile/test。

**新增面**：
- `packages/shared/src/types/gate.ts`：GateId + `'test_integrity_gate'`。
- `packages/shared/src/types/artifact.ts`：PerRunArtifactKind + `'test_surface_report'`（同步 PER_RUN_KIND_SET）。
- `packages/shared/src/utils/test-surface.ts`：纯函数——`countTestSurface(javaSource)`（@Test 数、断言位点数、skip 标记数、注释掉的 @Test 数）、`extractPomTestConfig(pomXml)`（surefire/failsafe/skip 片段归一化）、`buildTestSurfaceReport(entries)`。
- `apps/runner/src/test-surface.ts`（或并入 steps.ts 辅助）：git before/after 收集 + report 组装。
- `apps/api/src/gate-engine.ts`：`runTestIntegrityGate({ workflowRunId, stepRunId, reportArtifact })`。
- `apps/api/src/routes/runner-events.ts`：`/run-gate` 新 case。
- README What-runs 表更新。

## Decision (ADR-lite)

* **独立 `test_integrity_gate` 而非 test_gate 加规则**：test_gate 语义是"真实测试跑过了没"，integrity 语义是"这个 pass 信号可不可信"；分开后各自规则集稳定，未来条款注册表（借鉴 #3）可给稳定 ID。
* **挂在 build_test 开头而非 implementation 末尾**：违规时省一次完整 mvn 编译测试；且语义上它守卫的是"即将产生的 test 信号"，与 build_test 同 step 便于 UI 归因。代价：implementation step 已标 passed 后才发现违规——可接受，GateRun 有独立落库与展示。
* **基线 = worktree HEAD**：implementation 无 commit 权限，工作区未提交改动即 doer turn 全部产出。HEAD 被意外移动的情形走 fail-open（R6）并在 report 中记录 baseHead。
* **UMA-DV 第 4 类（断言硬编码实现输出）不做**：需要运行期输出关联，best-effort 且误报率高，MVP 排除，作为候选后续。
* **Java/JUnit 4+5 only**：平台当前只支持 Java/Maven 交付；计数器放 shared 纯函数便于未来扩语言。
* **R4 范围收窄**：只判 surefire/failsafe 插件配置与 skip 属性；pom.xml 加依赖等正常演进不触发（sensitive_change_gate 已对 pom.xml 整体 warn + 人工审批兜底）。

## Out of Scope

* 断言硬编码检测（UMA-DV 判定 4）。
* 非 Java 语言测试面。
* buildTestCommand 项目配置层面的弱化（属 API config 审计，另行考虑）。
* bounded rework loop（违规后自动返工属借鉴 #6 的范围；本任务只 block）。
* Web UI 新增专属展示（GateRun 通用展示已覆盖）。

## Follow-ups（check 阶段沉淀，均超出本任务范围）

* `Assumptions.assumeTrue(false)` / 新增 `@EnabledIf*` 条件注解可静默跳测，未覆盖（合法用法误报率高，需独立条款设计）。
* `src/test/resources` 变更（fixture 篡改、junit-platform.properties）不在测试面内，可与"断言硬编码检测"一并做后续条款。
* rogue backend 自行 commit 可清空 HEAD-vs-worktree 差异绕过本 gate（同样绕过 diff_scope/sensitive gate，平台级前置问题）；后续可在 implementation 起点钉住基线 commit、build_test 校验 baseRef 一致。
* 跨文件断言迁移按 R2 per-file 语义会 fail（指定行为，人工可放行）；若误报频发再考虑聚合计数。

## Technical Notes

* 关键参考：`apps/runner/src/orchestrator/steps.ts:399-501`（executeBuildTest）、`apps/api/src/gate-engine.ts:120-222`（runTestGate 形态）、`packages/shared/src/utils/surefire.ts`（纯解析器先例）、`apps/api/src/routes/runner-events.ts:930`（dispatch）。
* 断言计数正则按"调用位点"计：`\b(assert\w*|assertThat|verify|fail)\s*\(`，JUnit4/5 + Mockito 常用面。注释行内的匹配不计入断言，但注释中 `@Test` 增量计入 R3（判"注释掉测试"）。
* rename 处理：`-M` 检测，R 状态视为 modified 对（old path before vs new path after），避免"改名即违规"误报。
* UMA-DV 原文条款已存 `/tmp/umadev-spec-UMADEV_HOST_SPEC_V1.md:205-237`（会话外部资料，不入库）。
