# API 审计读模型 — `apps/api/src/context-governance.ts`

## 概述

context-governance.ts 是 API 侧的只读查询模型，将 Context Injection Layer 的全部审计数据（来自 store 中的 artifacts、agent tasks、workflow actions、handoffs）聚合为一个结构化视图，供 dashboard、审计报告、质量度量消费。

---

## 主要导出

```typescript
function buildContextGovernanceReadModel(workflowRunId: string): ContextGovernanceReadModel
```

---

## `ContextGovernanceReadModel` 顶层结构

```typescript
interface ContextGovernanceReadModel {
  schemaVersion: 'ainp.context_governance.v1';
  workflowRunId: string;
  projectId: string;
  contextPacks: ContextPackSummary[];
  manifest: ContextManifestSummaryItem[];
  sourceRefs: SourceRefSummary[];
  trustLevels: Record<string, number>;
  budgetDecisions: BudgetDecisionSummary[];
  contextRequests: ContextRequestSummary[];
  stageHandoffs: StageHandoffSummary[];
  metrics: ContextGovernanceMetrics;
}
```

---

## 数据来源

| 数据 | Store 索引 |
|------|-----------|
| artifacts | `store.artifacts.byWorkflow(runId)` |
| actions | `store.workflowActions.byWorkflow(runId)` |
| agentTasks | `store.agentTasks.byWorkflow(runId)` |
| agentResults | `store.agentResults.byWorkflow(runId)` |
| gates | `store.gateRuns.byWorkflow(runId)` |
| approvals | `store.approvals.byWorkflow(runId)` |
| handoffs | `store.handoffs.byWorkflow(runId)` |

---

## ContextPack 摘要提取 — 双来源

### 来源 1: `artifact.metadata.contextSelection`

从 kind='context_pack' 的 artifact 的 metadata 中读取 contextSelection 字段：
- contextPackId
- stage, mode, role, invocationId, retryIndex
- contextRequestId, baseContextPackId, baseContextPackArtifactId
- manifest items（from `selected` array）
- retrievalHints, calibrationSignals
- 完整 contextPack 对象（从 artifact 文件内容解析）

### 来源 2: `agent_task.prompt` 正则提取

从 agent task 的 prompt 审计文本中解析：
- `ContextPack: xxx` → contextPackId
- `ContextMode: xxx` → mode
- manifest items（从 `- ref: reason (fields)` 行解析）

---

## Manifest Item 结构

```typescript
interface ContextManifestSummaryItem {
  contextPackId: string;
  ref: string;
  reason: string;
  priority: number | null;
  mode: string | null;
  knowledgeClass: string | null;
  trustLevel: string | null;
  freshness: string | null;
  sourceType: string | null;
  sourceRefs: string[];
  score: number | null;
  selectionReasons: string[];
  degradedFrom: string | null;
  degradationReason: string | null;
}
```

---

## Source Ref 汇总

将所有 manifest items 的 sourceRefs 聚合为 `SourceRefSummary[]`:
- 按 sourceRef 分组
- 记录引用它的 contextPackIds、manifestRefs
- 收集相关 trustLevels 和 knowledgeClasses

---

## Budget Decisions

从 manifest 提取降级决策：
- ref
- mode（最终模式）
- degradedFrom（原始请求模式）
- degradationReason
- score

---

## Context Requests

从 `kind === 'context_request'` 的 workflow actions 中提取：
- request.id, status, priority, reason
- requestedRefs, questions
- sourceName, taskId
- baseContextPackId, baseContextPackArtifactId
- supplementContextPackId
- requestArtifactId, supplementArtifactId

---

## Stage Handoffs

从 handoff records 中提取含 `stageHandoff` metadata 的记录：
- fromStage, toStage
- summary, decisions, risks, openQuestions
- producedArtifacts

---

## Governance Metrics

### `impactCoverage` (RatioMetric)
- 分子：prompt 中包含 `ContextPack:` 的 agent tasks 数
- 分母：总 agent tasks 数
- 含义：有多少 agent 调用携带了上下文注入

### `evidenceTraceability` (RatioMetric)
- 分子：sourceRefs 非空的 manifest items 数
- 分母：总 manifest items 数
- 含义：选中的上下文有多少可追溯到来源

### `irrelevantContextRatio` (RatioMetric)
- 分子：priority=3 且 keywordOverlap=0 且无降级的低信号项
- 分母：总 manifest items 数
- 含义：有多少"可能不相关"的上下文被选入（越低越好）
- 排除 task_brief / workflow_run / retrieval_hint

### `contextRequestCount` (CountMetric)
- 记录的结构化 context_request 数量

### `downstreamReworkSignal` (CountMetric)
- `rejectedApprovals`: 被拒绝的审批数
- `failedGates`: 失败的 gate 数
- `failedAgentResults`: 失败的 agent result 数
- value = 三者之和
- 含义：上下文注入质量差可能导致的下游返工信号

---

## Prompt Line 解析

对于来源于 agent prompt 的 manifest items，解析格式：

```
- ref: reason (priority=X; mode=Y; sourceRefs=a,b; score=N; ...)
```

支持的字段：
- priority, mode, knowledgeClass, trustLevel, freshness
- sourceType, sourceRefs（逗号分隔）
- score, degraded（`from->to`格式）, degradationReason

---

## 设计决策

- 只读模型，不写入任何状态
- 从多个 store 索引聚合，不依赖实时计算
- 支持两种来源（artifact metadata + prompt text），保证即使部分数据缺失也能提供降级视图
- metrics 是确定性计算的代理指标（proxy），不依赖 LLM 判断
- `n/a` 值统一处理为 null
