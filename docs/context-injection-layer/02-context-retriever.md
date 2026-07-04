# 评分 & 预算选择 — `apps/runner/src/context/retriever.ts`

## 概述

Retriever 实现"评分 → 去重 → 排序 → 预算裁剪 → 降级"的选择流水线，将 Builder 构造的候选项列表筛选为最终注入 prompt 的 `SelectedContextCandidate[]`。

---

## 主要导出

| 函数/类型 | 职责 |
|-----------|------|
| `scoreContextCandidate(input)` | 对单个候选项计算多维评分 |
| `selectContextCandidates(input)` | 全流水线：score → filter → dedup → sort → budget-cut → degrade |
| `estimateTokens(text)` | 简单字符→token 估算（`ceil(len/4)`） |

---

## 评分模型 (`ContextScoreComponents`)

每个候选项的 total score 是以下维度之和：

| 维度 | 计算方式 | 最大值 |
|------|----------|--------|
| `stage` | 根据当前 WorkflowStage 和 candidate 属性查表 | 30 |
| `sourceType` | task_brief=30, workflow_metadata=26, run_artifact=24, current_input=20, knowledge_artifact=18, project_profile=16 | 30 |
| `knowledgeClass` | confirmed=18, seed=12, recovered=8 | 18 |
| `trustLevel` | source=18, accepted_knowledge=16, summary=8, inference=2 | 18 |
| `recency` | freshness分(current=12, possibly_stale=6, historical=0) + createdAt 年龄分(≤7d=8, ≤30d=4, ≤365d=1, >1y=0) | 20 |
| `keywordOverlap` | min(匹配关键词数, 8) × 4 | 32 |
| `confidence` | round(candidate.confidence × 10) | 10 |
| `required` | required=true → 100, 否则 0 | 100 |

**理论最大分 ≈ 258**（required=true 的 task_brief 在 review stage）

---

## Stage Score 查表

```
context_pack  → project_profile/knowledge_artifact = 20, 其他 8
requirement   → project_profile/knowledge_artifact = 18, 其他 10
design        → 含 'requirement'/knowledge_artifact = 24, 其他 12
implementation→ 含 design/analysis/plan/report = 28, knowledge_artifact = 18, 其他 12
build_test    → 含 diff/test/build/implementation = 28, 其他 10
review        → 含 diff/build/test/implementation/design/analysis = 30, 其他 12
completion/knowledge → run_artifact = 26, 其他 12
report/analyze       → task_brief/project_profile = 20, 其他 12
scan/plan            → project_profile/knowledge_artifact = 22, 其他 12
init                 → 0
```

---

## 选择流水线

```
candidates
  │
  ├─ map → scoreContextCandidate()
  ├─ filter → required || total ≥ SCORE_SELECTION_FLOOR(20)
  ├─ dedupeScoredCandidates() → 按 content 指纹或 sourceRefs 去重，保留高分者
  ├─ sort → compareScoredCandidates() 多键排序
  └─ for each (sorted):
       chooseInclusion(candidate, remainingBudget)
         → 尝试 full → summary → retrieval_hint（根据 token 预算逐级降级）
         → 记录 degradedFrom / degradationReason
```

---

## 排序规则 (`compareScoredCandidates`)

1. total score 降序
2. priority 升序（1 > 2 > 3）
3. sourceType score 降序
4. createdAt 降序（新优先）
5. id 字典序（稳定性保证）

---

## 预算降级策略 (`chooseInclusion`)

```
baseMode = candidate.baseMode ?? 'full'

if baseMode == 'metadata_only':
  直接返回 metadata_only

if baseMode == 'summary':
  尝试 summary → 超预算则降到 retrieval_hint

if baseMode == 'full':
  尝试 full → 超预算降 summary → 超预算降 retrieval_hint

required=true 的候选项不受预算约束（即使超出也保留原模式）
```

---

## 去重策略 (`candidateFingerprint`)

- 有内容：`content:` + 归一化后的 content lowercase
- 无内容：`refs:` + sorted sourceRefs join 或 fallback 到 id

相同 fingerprint 保留 score 更高的。

---

## 关键词匹配

```typescript
taskBrief → tokenize → 与 candidate(id+title+content+sourceRefs) 的 token set 求交集
tokenize: 小写 → split 非字母数字 → 去掉长度<3 和 stopwords
STOPWORDS: the, and, for, with, this, that, from, into, must, should, would, could,
           about, current, context, implement, implementation
```

---

## Token 估算

```typescript
APPROX_CHARS_PER_TOKEN = 4
estimateTokens(text) = max(1, ceil(text.length / 4))
```

---

## 可用 Budget 计算

```typescript
contextTokenBudget(budget) = max(1, maxTokens - reservedForReasoning - reservedForOutput)
```

默认 = 12000 - 2000 - 2000 = **8000 tokens** 可用于 context sections。
