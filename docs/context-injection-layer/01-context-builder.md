# 上下文组装 — `apps/runner/src/context/builder.ts`

## 概述

Builder 是 Context Injection Layer 的核心组装器，负责将项目知识、运行时制品、工作流元数据等多源上下文组装为一个结构化的 `ContextPack`，供下游 Renderer 渲染进 agent prompt。

---

## 主要导出

| 函数 | 职责 |
|------|------|
| `buildContextPack(input)` | 一次性组装完整 ContextPack（base pack） |
| `buildIncrementalContextPack(input)` | 处理 agent 发出的 `ContextRequest` 后组装补充 pack（supplement） |
| `buildProjectMaturityProfile(input)` | 从 profile/knowledge/runHistory 推断项目成熟度 |
| `sanitizeContextRequestForContextInjection(request, patterns)` | 对 ContextRequest 做敏感路径清洗 |
| `contextSelectionAudit(pack)` | 将 pack 转换为可审计的 JSON 结构 |

---

## `buildContextPack` 流程

```
输入 BuildContextPackInput
  ├─ project, run, stage, stepRunId
  ├─ workspacePath, branch, taskBrief
  ├─ projectProfile, projectProfileMarkdown
  ├─ acceptedKnowledgeMarkdown
  ├─ knowledgeArtifacts[]
  ├─ runHistory[]
  ├─ inputArtifacts[]
  ├─ budget (partial)
  └─ sensitivePathPatterns[]
```

### 步骤

1. **预算规范化** — `normalizeBudget()` 填充默认值（12000 / 2000 / 2000 tokens）
2. **敏感路径过滤** — 用 `normalizeSensitivePathPatterns` 统一 pattern，过滤 knowledgeArtifacts 和 inputArtifacts 中命中敏感路径的条目
3. **成熟度分析** — `buildProjectMaturityProfile()` 输出 `ProjectMaturityProfile`（stage/codebaseAge/knowledgeCoverage/evidenceDensity/volatility/primaryNeed）
4. **校准信号构建** — `buildKnowledgeReviewSignals()` 检测 stale/conflict/superseded 等知识冲突
5. **模式决定** — `modeFor(maturityProfile, stage, calibrationSignals)` → bootstrap / calibration / recovery / task_execution
6. **候选项构造** — 固定注入 task_brief + workflow_run，条件注入 project_profile / accepted_knowledge / knowledgeArtifacts / inputArtifacts
7. **评分 & 选择** — 调用 `selectContextCandidates()`（见 retriever.ts）
8. **Retrieval Hints 生成** — 对 projectSnapshot 缺失、acceptedKnowledge 缺失、以及被降级为 retrieval_hint 的 section 分别生成提示
9. **打包** — 组装最终 `ContextPack` 对象

---

## `buildIncrementalContextPack` 流程

agent 在执行中发出 `context_request` 时触发：

1. 对 request 做敏感路径清洗
2. 将 request 序列化为 inputArtifact
3. 用 `requestBrief` 替换 taskBrief（原始 + incremental context 描述）
4. 限制 supplement budget 上限为 6000 tokens
5. 调用 `buildContextPack` 重新组装
6. 将 contextRequest 的 retrievalHints 合并进新 pack

---

## `buildProjectMaturityProfile` 决策逻辑

| 维度 | 决策依据 |
|------|----------|
| `stage` | established + 无 confirmed/seed → `legacy`；有 confirmed/recovered/runHistory → `growing`；否则 `greenfield` |
| `codebaseAge` | treeCount=0 → `empty`；>20 或 testCount>8 → `established`；否则 `early` |
| `knowledgeCoverage` | 有 confirmed → `confirmed`；有 recovered → `recovered`；有 seed → `seeded`；否则 `partial` |
| `evidenceDensity` | tree>20/test>8/artifacts>8/runs>3/knowledge>5 → `high`；有任何证据 → `medium`；否则 `low` |
| `volatility` | confirmed + high density → `low`；有证据 → `medium`；否则 `high` |
| `primaryNeed` | legacy → `recover`；有 confirmed/recovered → `calibrate`；否则 `bootstrap` |

---

## `buildKnowledgeReviewSignals` — 知识校准信号

生成最多 `MAX_CALIBRATION_SIGNALS = 12` 条信号：

1. **Stale 检测** — confirmed 但 freshness 不是 current 的 artifact
2. **ReviewStatus 映射** — metadata 中 reviewStatus/knowledgeReviewStatus/calibrationStatus 字段映射到 conflict/stale/superseded/upgrade/downgrade
3. **跨 class 冲突** — 相同 key 但 fingerprint 不同的 seed/recovered/confirmed 共存
4. **Code-fact 冲突** — inputArtifacts 中的 `fact:` 行与 confirmed knowledge 的 fact 值不一致

---

## 模式路由 (`modeFor`)

```typescript
context_pack stage       → bootstrap
calibrationSignals 非空  → calibration (仅 design/implementation/review/plan/analyze)
primaryNeed = recover    → recovery
primaryNeed = calibrate  → calibration
其他                     → task_execution
```

---

## 默认预算常量

```typescript
const DEFAULT_BUDGET = {
  maxTokens: 12_000,
  reservedForReasoning: 2_000,
  reservedForOutput: 2_000,
};
```

Supplement pack 进一步限制为 `maxTokens=6000, reasoning=1000, output=1000`。
