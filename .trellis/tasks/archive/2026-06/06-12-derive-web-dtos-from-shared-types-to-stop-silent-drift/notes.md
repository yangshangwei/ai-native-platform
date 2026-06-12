# Notes: web 影子 DTO 从 shared 派生（T2.4）

## R2 处理路径与证据链

**结论：选择"保留逻辑一字不动 + 显式放宽比较类型"路径（PRD R2 的保守分支）。零运行时行为变化。**

涉及 5 处 `run.status` 与 WorkflowRequestStatus 值的比较：

| 位置 | 比较值 | 处理 |
|---|---|---|
| `apps/web/src/projection.ts` `reportNeedsAttention` | `'awaiting_clarification'` | 参数类型放宽为 `{ status: ReportableStatus }`，逻辑逐字保留 |
| `apps/web/src/projection.ts` `reportIsAcceptable` | `'completed'` | 同上 |
| `apps/web/src/projection.ts` `reportIsRunning` | `'claimed'` | 同上 |
| `apps/web/src/page-reports.ts` `reportNextAction` | `'awaiting_clarification'` | 参数类型放宽为 `Omit<WorkflowRunDto,'status'> & { status: ReportableStatus }`（与 projection.ts 三谓词同模式，受检放宽，无 `as` cast），逻辑逐字保留 |
| `apps/web/src/page-task-detail.ts` `taskFocusSummary`（原 :245） | `'completed'` | 局部别名 `const widenedRun: { status: ReportableStatus } = detail.run`（受检赋值，非 union 声明类型不被 CFA 收窄，无 `as` cast），逻辑逐字保留 |

`ReportableStatus = WorkflowRunStatus | WorkflowRequestStatus`（projection.ts 导出，带 R2 注释）。

**为何不删除（即便不可达证据充分）**：PRD 红线"本任务不允许任何运行时行为变化；拿不准就保留逻辑、放宽参数类型并注释"。删除依赖"API 永不产出"这一跨层断言长期成立；放宽类型则把断言留给下一个专门任务验证。

**不可达证据链（API 从不在 run 上产出这三个状态）**：

1. 类型层：`packages/shared/src/types/workflow.ts:52-58` `WorkflowRunStatus = 'pending'|'running'|'awaiting_human'|'passed'|'failed'|'cancelled'`，不含三值；它们属于 `WorkflowRequestStatus`（workflow.ts:204-210）。
2. 写入层：`apps/api/src/workflow-engine.ts` 全部 `run.status` 写点 —— :103（createWorkflowRun → `'pending'`）、:276（transitionStage → 参数 `toStatus: WorkflowRunStatus`，默认 `'running'`）、:342（`ok ? 'passed' : 'failed'`）、:397 / :447（`'running'`）。
3. `'completed'` 唯一写点在 request 维度：workflow-engine.ts:254（completeWorkflowRequest，写入 workflow_requests）。`'claimed'` 同理只出现在 request 认领（store.ts:368-381 `WHERE status = 'pending'` 的 claim 路径）。
4. 调用方核实：report* 三函数与两处页面比较的实参全部来自 `data.runs`（`GET /workflow-runs`，page-reports.ts:75-77/87、shell.ts:211、page-task-detail.ts 的 `detail.run`），从未喂入 request 对象。

**附带发现（同性质，已同路径处理）**：`page-task-detail.ts:869` `command.stage === stage.id` —— shared `CommandStage` 与 `WorkflowStage` 两联合零交集，收紧后 TS2367。按红线未改逻辑，改为在 `CommandRunDto` 上对 `stage` 字段使用 `Weaken`（projection.ts，带注释），保留历史 string 比较。这是"stage 打标 wire 契约"待澄清点，留给后续任务。

## R4 登记：不在本任务派生的形状

### A. api 私有形状的影子（源在 apps/api，web 禁 import api；"wire 契约下沉 shared"候选清单）

| web 影子 | api 私有源 |
|---|---|
| `projection.ts` `ApprovalDto` | store.ts `Approval` |
| `projection.ts` `WorkflowActionDto` | store.ts `WorkflowAction`（逐字段同形） |
| `projection.ts` `AuditEntryDto` | store.ts `AuditEntry` |
| `types.ts` `RunnerDto` | store.ts `RunnerRecord` |
| `types.ts` `ProjectDeletePreviewDto` | routes/projects.ts `DeletePreview` |
| `types.ts` `SourceDetect*` / `ProjectBranchListResult` | routes/projects.ts detect/branches 响应 |
| `types.ts` `HealthDto` | app.ts `/health` 内联 |
| `types.ts` `ArtifactContentDto` / `CommandLogsDto` | artifact-content.ts / command-runs 路由 |
| `types.ts` `ContextGovernanceDto` / `ContextManifestDto` / `RatioMetricDto` | context-governance.ts `ContextGovernanceReadModel` 系列（双端手抄同一 `schemaVersion: 'ainp.context_governance.v1'`） |
| `types.ts` `RunnerControlStatusDto` | routes/runner-control.ts `RunnerControlStatus` |
| `settings-projection.ts` `ProjectionConfigOverride` / `ProjectionConfigAudit` | store.ts `ConfigOverride` / `ConfigAuditEntry` |

### B. 明确不碰

- `types.ts` `DigestVerificationDto`：源 `DigestVerification` 在 `@ainp/shared/node`，web 禁引 node 子路径（红线测试 node-subpath-redline.test.ts）。
- web 独有文档解析形状（`RequirementDoc`/`DesignDoc`/`CompletionReportDoc`/`KnowledgeSuggestion` 等）：sidecar 解析器输出，无 shared 源；需先做"sidecar schema 契约下沉"跨包任务。
- 纯视图模型（`StageProjection`/`RunProjection`/`WorkbenchOverview`/`SettingsRowVM`/`AppData`/表单 state）：web 自有领域。

## 弱化/可选点保留清单（全部带注释，注释在类型定义处）

| 位置 | 处理 | 原因 |
|---|---|---|
| `projection.ts` `CommandRunDto` `stage` | `Weaken`（string） | page-task-detail.ts:869 历史上与 `WorkflowStage` 比较，两联合零交集；保留 string 比较保证零行为变化 |
| `projection.ts` `ArtifactDto` `metadata` | `Optionalize` | wire 必有，但 legacy fixture 省略、src 已按可空读取 |
| `projection.ts` `TestRunDto` `id`/`buildRunId`/`reportArtifactIds` | `Optionalize` | SPA 只渲染聚合计数，legacy fixture 省略 |
| `projection.ts` `StepRunDto` `startedAt`/`completedAt` | `Optionalize` | wire 必有（可空），legacy fixture 省略，src 已按可空处理 |
| `projection.ts` `AgentTaskDto` `createdAt`、`AgentResultDto` `summary`/`completedAt` | `Optionalize` | 同上 |
| `types.ts` `ProjectDto` `hasSourceCredential?` | 附加字段 | API 序列化附加（routes/projects.ts:535），替代被 redact 的 `sourceCredential`（Omit 掉，project.ts:27 注释明示） |

收紧档落地项：所有 status 联合（run/command/gate/build/step/agent）、`flowId`/`startStage`/`sourceBranch` 必填、`CommandRunDto` 补 `timedOut`/`truncated`、`ArtifactDto.kind: ArtifactKind`、`GateRunDto.gateId: GateId`、`WorkflowRequestDto = WorkflowRequest`、`AgentBackendPreflightDto = AgentBackendPreflight`、`ProjectionConfigEntry = ConfigEntry`、`SettingsTabId = ConfigCategory`。
