# 共享类型 — `packages/shared/src/types/context.ts`

## 概述

context.ts 定义了 Context Injection Layer 的核心类型系统。所有 runner / api / shared 模块共享这些类型，确保从 builder → retriever → renderer → governance 的全链路类型安全。

---

## 核心枚举类型

### 项目成熟度

| 类型 | 值 | 含义 |
|------|-----|------|
| `ProjectMaturityStage` | greenfield / growing / legacy | 项目生命阶段 |
| `CodebaseAge` | empty / early / established / unknown | 代码库年龄 |
| `KnowledgeCoverage` | seeded / partial / recovered / confirmed | 知识覆盖程度 |
| `EvidenceDensity` | low / medium / high | 证据密度 |
| `Volatility` | high / medium / low | 知识波动性 |
| `ProjectPrimaryNeed` | bootstrap / calibrate / recover | 主要需求 |

### 知识分类

| 类型 | 值 | 含义 |
|------|-----|------|
| `KnowledgeClass` | seed / recovered / confirmed | 知识可信级别 |
| `ContextTrustLevel` | source / accepted_knowledge / summary / inference | 上下文信任层级 |
| `ContextFreshness` | current / possibly_stale / historical | 时效性 |

### 上下文包含模式

| 类型 | 值 | 含义 |
|------|-----|------|
| `ContextInclusionMode` | full / summary / snippet / metadata_only / retrieval_hint | 内容包含粒度 |
| `InputInjectionMode` | full / summary / reference / omit | 输入注入粒度 |
| `ContextPackMode` | bootstrap / calibration / recovery / task_execution | 上下文包整体模式 |

### 来源类型

| 类型 | 值 | 含义 |
|------|-----|------|
| `ContextSourceType` | task_brief / workflow_metadata / project_profile / knowledge_artifact / run_artifact / current_input | 内容来源分类 |
| `ContextManifestItemType` | project_profile / seed / domain / architecture / decision / nfr / convention / task_artifact / code_probe | Manifest 条目类型 |

---

## 核心数据结构

### `ContextPack` — 上下文包（顶层容器）

```typescript
interface ContextPack {
  id: string;
  workflowRunId: WorkflowRunId;
  stepRunId: StepRunId | null;
  taskBrief: string;
  stage: WorkflowStage;
  maturityProfile: ProjectMaturityProfile;
  budget: ContextPackBudget;
  mode: ContextPackMode;
  projectSnapshot: string;
  manifest: ContextManifestItem[];
  sections: ContextSection[];
  retrievalHints: RetrievalHint[];
  calibrationSignals?: KnowledgeReviewSignal[];
  run: ContextPackRunMetadata;
  supplement?: ContextPackSupplement;
  createdAt: Iso8601;
}
```

---

### `ContextSection` — 选中的上下文段落

```typescript
interface ContextSection {
  id: string;
  title: string;
  content: string;
  sourceRefs: string[];
  reason: string;
  priority: 1 | 2 | 3;
  knowledgeClass: KnowledgeClass;
  trustLevel: ContextTrustLevel;
  freshness: ContextFreshness;
  confidence: number;
  mode: ContextInclusionMode;
  sourceType?: ContextSourceType;
  score?: number;
  selectionReasons?: string[];
  degradedFrom?: ContextInclusionMode;
  degradationReason?: string;
}
```

---

### `ContextManifestItem` — Manifest 审计条目

```typescript
interface ContextManifestItem {
  type: ContextManifestItemType;
  ref: string;
  reason: string;
  priority: 1 | 2 | 3;
  mode: ContextInclusionMode;
  knowledgeClass: KnowledgeClass;
  trustRequired?: ContextTrustRequirement;
  sourceRefs?: string[];
  trustLevel?: ContextTrustLevel;
  freshness?: ContextFreshness;
  confidence?: number;
  sourceType?: ContextSourceType;
  score?: number;
  selectionReasons?: string[];
  degradedFrom?: ContextInclusionMode;
  degradationReason?: string;
}
```

---

### `ContextRequest` — 结构化追加请求

```typescript
interface ContextRequest {
  id: string;
  workflowRunId: WorkflowRunId;
  stepRunId: StepRunId | null;
  stage: WorkflowStage;
  reason: string;
  requestedRefs: string[];
  questions: string[];
  priority: 1 | 2 | 3;
  status: ContextRequestStatus;  // open / fulfilled / dismissed
  createdAt: Iso8601;
}
```

---

### `KnowledgeReviewSignal` — 校准信号

```typescript
interface KnowledgeReviewSignal {
  id: string;
  kind: KnowledgeReviewSignalKind;  // conflict / stale / superseded / upgrade_candidate / downgrade_candidate
  severity: KnowledgeReviewSeverity; // info / warning / review_required
  message: string;
  subjectRefs: string[];
  evidenceRefs: string[];
  recommendedAction: string;
  createdAt: Iso8601;
}
```

---

### 辅助结构

| 接口 | 用途 |
|------|------|
| `ProjectMaturityProfile` | 项目成熟度画像 |
| `ContextPackBudget` | token 预算（maxTokens, reservedForReasoning, reservedForOutput） |
| `ContextPackRunMetadata` | 运行环境元数据 |
| `ContextPackSupplement` | 增量补充标记（contextRequestId, baseContextPackId, retryIndex） |
| `RetrievalHint` | 降级后的检索提示 |
| `ContextInvocationSnapshot` | 调用快照（用于 artifact envelope） |
| `ContextPackArtifactEnvelope` | 持久化包的顶层信封 |
| `SkillInputInjectionPolicy` | 每 skill 的输入注入策略 |

---

## 类型守卫

文件导出一系列 `isXxx()` 函数用于运行时类型检查：

- `isKnowledgeClass(value)`
- `isContextTrustLevel(value)`
- `isContextFreshness(value)`
- `isContextPackMode(value)`
- `isContextRequestStatus(value)`
- `isKnowledgeReviewSignalKind(value)`
- `isKnowledgeReviewSeverity(value)`

---

## 常量数组

每个枚举类型都导出对应的 `as const` 数组，用于运行时验证和序列化：

```typescript
KNOWLEDGE_CLASSES, CONTEXT_TRUST_LEVELS, CONTEXT_FRESHNESS_VALUES,
CONTEXT_PACK_MODES, CONTEXT_REQUEST_STATUSES,
KNOWLEDGE_REVIEW_SIGNAL_KINDS, KNOWLEDGE_REVIEW_SEVERITIES
```
