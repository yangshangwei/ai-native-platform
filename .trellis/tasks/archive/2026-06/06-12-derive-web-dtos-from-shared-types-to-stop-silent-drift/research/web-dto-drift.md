# Research: web 影子 DTO 漂移盘点与派生策略（T2.4）

- **Query**: web 手抄影子 DTO 全量清单、弱化原因核实、从 @ainp/shared 派生的类型运算策略、web 独有形状处理、派生后编译错预估
- **Scope**: internal
- **Date**: 2026-06-12
- **历史依据**: archive/2026-06/06-11-architecture-review-and-refactor-for-simplicity-and-extensibility/research/shared-crosscutting.md §3.2（行号已按当前代码重新核对）

---

## 0. 两个改变结论的关键事实（先读）

1. **shared 的 id 类型不是品牌类型**。`packages/shared/src/types/ids.ts:1-12` 全部是 `export type ProjectId = string` 这类普通别名，双向可赋值。旧报告所称"id 从品牌类型退化为 string"只是文档性差异——**派生时 id 字段直接 Pick 即可，零摩擦，不需要 Weaken**。若未来引入品牌 id，再启用 Weaken 模板。
2. **web 的测试根本不在 typecheck 范围内**。`apps/web/tsconfig.json:11` 的 include 只有 `["src/**/*", "serve.ts", "../../packages/shared/src/**/*"]`，根 `package.json:19` 的 `typecheck` 脚本就是 `tsc -p apps/web/tsconfig.json --noEmit`；仓库无 vitest typecheck 配置。铁证：`apps/web/test/projection.test.ts:17-38` 的第一个 fixture 缺 `RunDetail` 必填字段 `actions`（projection.ts:255），却从未报错。**因此 projection.ts:158 注释声称的"legacy fixture 容忍"对 CI 类型门禁不成立——fixture 从不被 tsc 检查，弱化的"真需求"几乎为零，只剩 IDE 体验层面**。

---

## 1. 影子 DTO 全量清单

### 1.1 apps/web/src/projection.ts（150-259 区段 11 个 + RunDetail 内联形状）

API `GET /workflow-runs/:id`（apps/api/src/routes/workflow-runs.ts:124-153）把 store 实体**原样 `c.json()`** 返回，wire 上是完整 shared/api 实体——所以下面所有"缺失字段"都是手抄缺失，不是 API 裁剪。

| 影子 DTO（文件:行） | 对应源类型（文件:行） | 弱化字段 | 缺失字段（wire 上有） | 多出字段 |
|---|---|---|---|---|
| `WorkflowRunDto` projection.ts:150-169 | shared `WorkflowRun` workflow.ts:162-202 | `status: string`（vs `WorkflowRunStatus` 6 值联合）；`flowId?`（vs 必填，DB NOT NULL DEFAULT）；`startStage?`（vs 必填可空）；`sourceBranch?`（vs 必填） | `type`、`configSnapshotId`、`updatedAt` | 无 |
| `CommandRunDto` projection.ts:171-186 | shared `CommandRun` command.ts:24-48 | `status: string`（vs `CommandStatus`）；`cwd?`（vs 必填）；`stage?: string`（vs 必填 `CommandStage`） | `timedOut`、`truncated`、`stdoutBytes`、`stderrBytes`、`finishedAt`、`workflowRunId` | 无 |
| `GateRunDto` projection.ts:188-195 | shared `GateRun` gate.ts:36-49 | `gateId: string`（vs `GateId` 9 值联合）；`ruleResults` 内联 `{ruleId; status: string; message}`（vs `RuleResult` gate.ts:29-34，status 为 `RuleStatus` 且含 `evidenceRefs`） | `workflowRunId`、`evidenceRefs`、`commandRunIds`、`agentNote` | 无 |
| `ArtifactDto` projection.ts:197-206 | shared `Artifact` artifact.ts:413-423 | `kind: string`（vs `ArtifactKind`）；`metadata?`（vs 必填） | `workflowRunId`、`stepRunId`（DTO 有但 optional，源必填可空）、`size` | 无 |
| `ApprovalDto` projection.ts:208-214 | **api 私有** `Approval` apps/api/src/store/store.ts:1395-1404 | 无（decision 联合一致） | `workflowRunId`、`gateRunId`、`comment` | 无 |
| `WorkflowActionDto` projection.ts:216-225 | **api 私有** `WorkflowAction` store.ts:1336-1345 | 无 | 无 | 无（**逐字段同形**） |
| `BuildRunDto` projection.ts:227-232 | shared `BuildRun` build.ts:11-25 | `status: string`（vs 5 值联合） | `workflowRunId`、`stepRunId`、`language`、`buildTool`、`startedAt`、`completedAt`、`commandRunIds`、`artifactIds`（共 9 字段只抄了 4 个） | 无 |
| `TestRunDto` projection.ts:234-244 | shared `TestRun` build.ts:27-37 | `framework: string`（vs `'maven-surefire'\|'maven-failsafe'`）；`id?`、`buildRunId?`、`reportArtifactIds?`（vs 必填） | 无 | 无 |
| `RunDetail` projection.ts:246-259 | API 响应（workflow-runs.ts:139-152） | 见下方内联形状 | — | — |
| `StageProjection` projection.ts:261-266 | — | **web 独有视图模型，非影子** | — | — |
| `RunProjection` projection.ts:268-297 | — | **web 独有视图模型，非影子** | — | — |
| `WorkflowRequestSummary` projection.ts:498-510 | shared `WorkflowRequest` workflow.ts:212-237 | `type: string`、`status: string`（vs 各自联合） | `flowId`、`startStage` | 无；**且与 types.ts:155 `WorkflowRequestDto` 是 web 内部双胞胎** |

`RunDetail` 内联数组元素的影子（projection.ts:248, 256-258）：

- `steps` vs shared `StepRun`（workflow.ts:247-255）：`status: string` 弱化 `StepRunStatus`；`startedAt?/completedAt?` optional（源必填可空）；缺 `workflowRunId`。
- `agentTasks` vs shared `AgentTask`（agent.ts:67-78）：`kind/backend: string` 弱化联合；`createdAt?`；缺 `prompt`、`inputArtifactIds`。
- `agentResults` vs shared `AgentResult`（agent.ts:80-89）：`status: string`；`summary?/completedAt?`；缺 `outputArtifactIds`、`startedAt`。
- `audit` vs **api 私有** `AuditEntry`（store.ts:1460-1466）：`payload?` optional（源必填）；`workflowRunId?`。

### 1.2 apps/web/src/types.ts（T2.1 拆出，按影子 / web 独有分类）

**A. shared 实体的影子（可直接派生）**：

| 影子（行） | 源类型 | 字段级 diff |
|---|---|---|
| `ProjectDto` types.ts:30-51 | shared `Project` project.ts:10-52 | 弱化 `language/buildTool: string`（vs `ProjectLanguage`/`ProjectBuildTool`）；缺 `sourceCredential`——**这是唯一语义正确的缺失**（project.ts:27 注释明示 API 响应 redact 该字段）；多出 `hasSourceCredential?: boolean`（API 序列化附加） |
| `ProjectSourceKind`/`ProjectSourceAuthKind` types.ts:54-55 | shared 同名联合 project.ts:6-7 | **逐字重抄**，0 diff |
| `ProjectAgentBackendKind`/`AgentBackendKind` types.ts:23-24 | shared agent.ts:15-17 | 字面量等价（web 用 `ProjectAgentBackendKind \| 'native'` 表达，shared 直接列三值） |
| `AgentBackendPreflightDto` types.ts:119-131 | shared `AgentBackendPreflight` agent.ts:38-50 | **逐字段同形**，0 diff（status 联合 = `AgentBackendPreflightStatus`） |
| `WorkflowRequestDto` types.ts:155-172 | shared `WorkflowRequest` workflow.ts:212-237 | 仅 `flowId?/startStage?` optional（源必填可空）；type/status 联合**逐字相同** |
| `KnowledgeArtifactDto` types.ts:25 | shared `KnowledgeArtifact` | `= KnowledgeArtifact` 直接 alias——**已是正确范本** |

**B. api 私有形状的影子（shared 无源，本任务无法"从 shared 派生"）**：

| 影子（行） | api 私有源 | diff |
|---|---|---|
| `RunnerDto` types.ts:144-153 | `RunnerRecord` store.ts:1507-1516 | 同形 |
| `ProjectDeletePreviewDto` types.ts:134-142 | `DeletePreview` routes/projects.ts:68 | 同形 |
| `SourceDetectSuccess/Failure/Result`、`ProjectBranchListResult` types.ts:57-83 | routes/projects.ts:60-66 `BranchList` 及 detect 响应（projects.ts:109-115, 194-208） | 手工对齐 |
| `HealthDto` types.ts:174-177 | app.ts:20 `/health` 内联 | 手工对齐 |
| `ArtifactContentDto` types.ts:179-185 | `ArtifactContent` artifact-content.ts:7-12 | 同形；其 `digest` 的源 `DigestVerification` 在 **@ainp/shared/node**（artifact-content.ts:5），web 的 `DigestVerificationDto`（types.ts:193-195）与之手工对齐，但 web tsconfig paths 只映射 `@ainp/shared` 主入口 |
| `CommandLogsDto` types.ts:187-191 | command-runs 路由响应 | 手工对齐 |
| `ContextGovernanceDto/ContextManifestDto/RatioMetricDto` types.ts:197-280 | `ContextGovernanceReadModel` 系列 context-governance.ts:5-105 | 基本同形；web 的 contextPacks 内联**缺** `supplement/retrievalHints/calibrationSignals/contextPack` 4 字段（context-governance.ts:25-29）；`source: string` 弱化 `'artifact.metadata'\|'agent_task.prompt'`（:20）。注意双端各自手抄了 `schemaVersion: 'ainp.context_governance.v1'` 字面量 |
| `RunnerControlStatusDto` types.ts:282-292 | `RunnerControlStatus` routes/runner-control.ts:10-20 | 同形（`lastExit.signal: string` vs `NodeJS.Signals`；`latestHeartbeat: RunnerDto` vs RunnerRecord） |

**C. web 独有视图模型 / 表单状态（非影子，不动）**：`Page`、`StatusKind`、`KnowledgeActionDecision`、`KnowledgeViewId`、`ReportViewId`（21-28）、`LocalDirectoryItem/List/PickerState`（85-101）、`ProjectSourceFormState`（103-117）、`KnowledgeArtifactsState`（294-300）、`KnowledgeSuggestionItem`（302-309）、`AppData`（311-319）。

### 1.3 apps/web/src/settings-projection.ts 的 Projection* 三件套

| 影子（行） | 源类型 | diff |
|---|---|---|
| `ProjectionConfigEntry` settings-projection.ts:16-25 | **shared** `ConfigEntry` config/registry.ts:49-62 | **逐字段同形**（`category: SettingsTabId` 与 `ConfigCategory` 字面量逐字相同，settings-projection.ts:14 vs registry.ts:46） |
| `ProjectionConfigOverride` :27-33 | api 私有 `ConfigOverride` store.ts:1661-1667 | 同形 |
| `ProjectionConfigAudit` :35-42 | api 私有 `ConfigAuditEntry` store.ts:1715-1722 | 同形 |

**额外发现（旧报告未列）**：`apps/web/src/page-settings.ts:40-66` 还有第三套 `ConfigEntryDto`/`ConfigOverrideDto`/`ConfigAuditDto`——同一形状在 web 内部抄了两遍（page-settings 一套、settings-projection 一套），加上 api/shared 源共三份。派生时应顺带让 page-settings 改用 settings-projection 的导出（或两者都 alias shared/api 源）。

---

## 2. 弱化原因核实（fixture 依赖逐条对账）

唯一明文声称 fixture 容忍的注释在 projection.ts:156-161（`flowId?` "Optional here so legacy fixtures that predate flow-awareness still typecheck"）。grep apps/web/test/ 的 fixture 实际依赖：

| 弱化/缺失点 | fixture 证据 | 判定 |
|---|---|---|
| run 缺 `flowId/startStage/sourceBranch/type/updatedAt/configSnapshotId` | projection.test.ts:18-27, 47-55, 84-93, 115-123（多个 run 字面量只有 8 字段）；:246 专门测 "falls back for missing/unknown flowId" | `flowId?/startStage?` 是**半真需求**：`stagesForRun` 的运行时回退逻辑（projection.ts:131）确实把 missing 当合法输入，且有测试钉住；但 API wire 上 flowId NOT NULL（workflow.ts:172-177），收紧后只需 fixture 补字段 + 回退测试改传 `undefined as any` 或保留参数类型为 `FlowId \| null \| undefined`（函数签名本就如此，**与 DTO 字段必填化不冲突**） |
| `CommandRunDto` 缺 `timedOut/truncated/stdoutBytes/stderrBytes/finishedAt/cwd/stage` | projection.test.ts:58 command fixture 只有 8 字段 | **手抄缺失，非弱化需求**。API 原样返回完整 `CommandRun`；api 侧 gate-engine.ts:99/148、workflow-engine.ts:865 实际消费 `timedOut`，web 拿不到纯属类型缺口 |
| `GateRunDto` 缺 `evidenceRefs/commandRunIds/agentNote`，`ruleResults` 缺 `evidenceRefs` | projection.test.ts:30, 60-61, 129 等 gate fixture 仅 5 字段、`ruleResults: []` | 手抄缺失。fixture 只依赖"可以不写"，即 optional 化或 Pick 掉皆可 |
| `BuildRunDto` 只有 4 字段 | projection.test.ts:64 | 手抄缺失（13 字段抄 4）；web 只用 status/jdkVersion/mavenCommand 渲染，**Pick 是正确表达** |
| `TestRunDto` 的 `id?/buildRunId?/reportArtifactIds?` | projection.test.ts:65 fixture 不写这三个 | fixture 便利退化；API 返回完整 `TestRun` |
| `ArtifactDto.kind: string`、`metadata?` | projection.test.ts:131-132, 188-190 的 kind 全是合法 `ArtifactKind` 字面量（'context_pack'/'design_doc'…），且 fixture 不写 metadata/size | kind 弱化**无真需求**（fixture 字面量在联合内，上下文定型可过）；`metadata?`/`size` 缺失仅为 fixture 少写字段 |
| `status: string`（run/command/step/gate 各处） | 所有 fixture 的 status 字面量（'awaiting_human'/'passed'/'failed'/'running'）全部在 shared 联合内 | 收紧**不破坏任何现有 fixture 字面量**；真正的阻碍在 src 死代码（见 §5.a） |
| settings 三件套 | settings-projection.test.ts 全部 fixture 与 shared `ConfigEntry` 同形 | 0 弱化需求 |

**结论**：结合 §0.2（test 不进 tsc），"容忍 legacy fixture" 实质上只约束 IDE 红线；所有弱化里只有两类有真实语义：① `ProjectDto` 缺 `sourceCredential`（API redact，应 `Omit` 显式表达）；② `stagesForRun`/`visibleStagesForRun` 的**参数**需要容忍 `null/undefined`（运行时回退契约，与 DTO 字段收紧正交）。其余均为手抄随意退化或缺失。

---

## 3. 派生策略建议

### 3.1 模板（放 projection.ts 顶部或新建 apps/web/src/dto.ts）

```ts
import type { WorkflowRun, CommandRun, GateRun, RuleResult, Artifact, BuildRun, TestRun,
  StepRun, AgentTask, AgentResult, WorkflowRequest, Project, AgentBackendPreflight,
  KnowledgeArtifact, ConfigEntry, ConfigCategory } from '@ainp/shared';

/** 把 K 字段显式弱化为 string（每个使用点自带"为什么弱化"注释）。 */
type Weaken<T, K extends keyof T> = Omit<T, K> & { [P in K]: string };
/** 把 K 字段从必填降为可选（fixture/历史数据容忍点逐字段声明）。 */
type Optionalize<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
```

- id 字段：shared 的 id 都是 string 别名（ids.ts），**直接 Pick，不需要任何退化处理**（§0.1）。
- 不需要额外的 `satisfies`/断言守卫——派生本身就是约束：shared 改字段名/类型，web 的 `Pick`/`Omit` 键名立即编译报错，这正是"停止静默漂移"的机制。
- 弱化分两档给实现者选：**保守档**（保留 `status: string` 等现有弱化，用 `Weaken` 显式声明，编译错≈0）与**收紧档**（status 全部用 shared 联合，需顺带清 §5.a 死代码）。建议 status 走收紧档（fixture 字面量全合法），`flowId/startStage` 走收紧档（wire 必有值）。

### 3.2 逐 DTO 派生表达式草案

**projection.ts（shared 有源的 8 个）**：

```ts
// 保守档示例（status 弱化显式声明）；收紧档去掉 Weaken 即可
export type WorkflowRunDto = Pick<WorkflowRun,
  'id' | 'projectId' | 'title' | 'currentStage' | 'flowId' | 'startStage'
  | 'sourceBranch' | 'branch' | 'workspacePath' | 'createdAt' | 'status'>;
  // 收紧档：flowId/startStage/sourceBranch 转必填（wire 必有）；若保留容忍则:
  // Optionalize<..., 'flowId' | 'startStage' | 'sourceBranch'>

export type CommandRunDto = Pick<CommandRun,
  'id' | 'stepRunId' | 'command' | 'cwd' | 'stage' | 'status' | 'exitCode'
  | 'durationMs' | 'stdoutRef' | 'stderrRef' | 'stdoutSha256' | 'stderrSha256'
  | 'combinedSha256' | 'startedAt' | 'timedOut' | 'truncated'>;
  // timedOut/truncated 是补缺口（任务背景明确：缺失而非弱化）；
  // 现有代码 cwd?/stage? 若想零改动: Optionalize<..., 'cwd' | 'stage'>

export type GateRunDto = Pick<GateRun, 'id' | 'gateId' | 'stepRunId' | 'status' | 'decidedAt'>
  & { ruleResults: Array<Pick<RuleResult, 'ruleId' | 'status' | 'message'>> };

export type ArtifactDto = Pick<Artifact,
  'id' | 'kind' | 'stepRunId' | 'uri' | 'contentType' | 'sha256' | 'createdAt'>
  & Optionalize<Pick<Artifact, 'metadata'>, 'metadata'>;

export type BuildRunDto = Pick<BuildRun, 'id' | 'status' | 'jdkVersion' | 'mavenCommand'>;

export type TestRunDto = Optionalize<
  Pick<TestRun, 'id' | 'buildRunId' | 'framework' | 'total' | 'passed'
    | 'failed' | 'errors' | 'skipped' | 'reportArtifactIds'>,
  'id' | 'buildRunId' | 'reportArtifactIds'>;

// RunDetail 内联三组
type StepDto = Optionalize<Pick<StepRun, 'id' | 'stage' | 'name' | 'status'
  | 'startedAt' | 'completedAt'>, 'startedAt' | 'completedAt'>;
type AgentTaskDto = Optionalize<Pick<AgentTask, 'id' | 'stepRunId' | 'kind'
  | 'backend' | 'createdAt'>, 'createdAt'>;
type AgentResultDto = Optionalize<Pick<AgentResult, 'id' | 'taskId' | 'status'
  | 'summary' | 'completedAt'>, 'summary' | 'completedAt'>;

// WorkflowRequestSummary：建议直接删除，统一用 types.ts 的 WorkflowRequestDto
// （buildWorkbenchOverview 的实参本来就是完整请求对象）
```

**types.ts**：

```ts
export type ProjectDto = Omit<Project, 'sourceCredential' | 'language' | 'buildTool'>
  & { language: string; buildTool: string }    // Weaken 显式声明（或收紧）
  & { hasSourceCredential?: boolean };          // API 序列化附加字段，注明出处
export type { ProjectSourceKind, ProjectSourceAuthKind,
  ProjectAgentBackendKind, AgentBackendKind } from '@ainp/shared';  // 删本地重抄
export type AgentBackendPreflightDto = AgentBackendPreflight;       // 0 diff
export type WorkflowRequestDto = Optionalize<WorkflowRequest, 'flowId' | 'startStage'>;
  // 收紧档直接 = WorkflowRequest
```

**settings-projection.ts**：

```ts
export type SettingsTabId = ConfigCategory;            // registry.ts:46
export type ProjectionConfigEntry = ConfigEntry;        // registry.ts:49，0 diff
// ProjectionConfigOverride / ProjectionConfigAudit 源在 api 私有（store.ts:1661/1715），
// 本任务保持手写但加注释指向源；并让 page-settings.ts:40-66 三胞胎改 import 这里
```

---

## 4. web 独有形状的处理建议

**建议：本任务只登记不动，不顺带派生。** 分三类说明：

1. **文档解析输出**（`RequirementDoc`/`DesignDoc`/`DesignCoverageRow`/`CompletionReportDoc`/`CompletionReportSection`/`KnowledgeSuggestion`/`AcceptanceChecklistItem`，projection.ts:446-496, 473-479）：它们是 web 端 markdown/JSON sidecar 解析器（`parseRequirementArtifact` 等）的**输出类型**，不是任何 shared 实体的影子。sidecar 生产端（api/runner 生成 `ainp.requirement.v1` 等 JSON）也没有类型化契约——要派生得先在 shared 新建 sidecar schema 类型并让三端采用，是跨 3 包的独立"契约下沉"任务，超出本任务"零运行时改动、纯 web 内类型运算"的边界。且 sidecar 已有 `schemaVersion` 字符串 + structured-projection.test.ts / sidecar-projection.test.ts 双向钉住，漂移可被测试捕获，紧迫性低。
2. **api 私有形状的影子**（§1.2.B 全部 + ApprovalDto/WorkflowActionDto/audit + Projection*Override/Audit）：源类型在 apps/api（store.ts / 各 route），而 "apps 互不依赖" 是仓库纪律（shared-crosscutting.md §4.3），web 不能 import api。本任务登记；其中 `WorkflowActionDto`、`RunnerDto`、`ApprovalDto`、`ConfigOverride/ConfigAuditEntry`、`ContextGovernance` 系列（双端手抄同一 schemaVersion）是**下一个"wire 契约下沉 shared"任务的现成候选清单**。
3. **纯视图模型**（StageProjection/RunProjection/WorkbenchOverview/ReportStats/SettingsRowVM/SettingsViewModel/AppData/表单 state 等）：web 自有领域，不存在对端，永久不动。

---

## 5. 风险点：派生后立即暴露的编译错与修复面

`bun run typecheck` 只查 src（§0.2），以下按 src / test 分列：

**a. src 内真实类型缺口（收紧 `WorkflowRunDto.status` 时）——最大风险点**：
- projection.ts:542 `reportNeedsAttention` 比较 `'awaiting_clarification'`、:546 `reportIsAcceptable` 比较 `'completed'`、:550 `reportIsRunning` 比较 `'claimed'`/`'pending'`——其中 `'awaiting_clarification'/'completed'/'claimed'` **不在** shared `WorkflowRunStatus`（workflow.ts:52-58）里，是 `WorkflowRequestStatus` 的值；grep api 证实 run 永远不会有这些状态（'completed' 只写入 workflow_requests，workflow-engine.ts:254）。收紧后这三处直接 TS2367。这是真实缺口：要么是死防御分支（删），要么说明调用方曾把 request 状态喂给 run 函数（需排查 page-reports.ts:53-74、reportStats 调用点）。约 3-6 处。
- `reportStatusLabel(status: string)`（projection.ts:553）参数独立，无影响；dom.ts:70-71 `statusKind(status: string)` 同理。

**b. src 内低风险点**：
- 收紧 `ArtifactDto.kind` 为 `ArtifactKind`：`latestArtifactOfKind(artifacts, kind: string)` 与 `artifact.kind === kind` 的比较合法，page-* 传的字面量均在联合内，预计 0 错。
- 收紧 `flowId/startStage` 必填：web 只消费 API 数据不构造 run 对象（grep 确认 src 无 WorkflowRunDto 字面量构造），预计 0 错；`stagesForRun` 参数类型本就是 `FlowId | null | undefined`，回退逻辑不受影响。
- `CommandRunDto` 补必填 `timedOut/truncated`：src 只读不写，0 错；`CommandLogsDto.commandRun = RunDetail['commands'][number]`（types.ts:188）自动跟随。
- `Artifact.metadata` 若必填化：src 访问点都做了可空处理，建议保留 `Optionalize` 以免误伤。
- `@ainp/shared/node` 的 `DigestVerification`：web tsconfig paths 未映射该子路径（tsconfig.json:7-9），本任务不要碰 `DigestVerificationDto`。

**c. test fixture 修复面（仅当顺带把 test/ 纳入 typecheck 时才生效，建议作为本任务的可选加固项）**：
- projection.test.ts（332 行）约 10 个 fixture 对象需补字段：run 补 `flowId/sourceBranch/type/updatedAt/configSnapshotId`、command 补 `cwd/stage/timedOut/truncated/...`、gate 补 `evidenceRefs/commandRunIds/agentNote`、第一个 fixture 补 `actions`（现状已缺）。估 40-80 行。
- structured-projection / sidecar-projection / settings-projection / stream-rendering 四个测试不触碰实体 DTO 字段，预计 0-小改。
- 若不纳入 typecheck，test 零改动（vitest 不查类型），但弱化注释（projection.ts:156-161）应同步改写为指向真实原因。

**总体预估**：保守档（弱化点全部用 Weaken/Optionalize 显式保留）src 编译错 ≈ 0，纯类型替换；收紧档 src 修复面集中在 projection.ts 报表三函数 + 其调用方，≤15 处。

## Caveats / Not Found

- 未运行 `tsc` 实测派生后的错误清单，§5 基于逐调用点 grep 推断。
- 未核实 page-* 16 个模块里是否有对 `run.status` 与非法字面量比较的其他散点（grep 'completed'/'claimed' 命中均在 request 维度，见 §5.a 的 page-reports 待排查项）。
- `hasSourceCredential` 的 API 序列化出处未逐行定位（routes/projects.ts 的 redact/toPublic 逻辑），派生 ProjectDto 时建议顺手确认。
