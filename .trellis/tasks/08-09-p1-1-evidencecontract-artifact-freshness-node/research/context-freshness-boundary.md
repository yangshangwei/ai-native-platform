# Research: ContextFreshness 与 run 内 artifact 失效的边界

- **Query**: `ContextFreshness` / `isContextFreshness` 目前只服务知识 artifact 的召回（`apps/api/src/router.ts:223`、`reports.ts`）。确认它与「run 内 artifact 失效」是不是完全不同的两件事 —— 如果是，P1-1 不能复用这个枚举，需要说明为什么。
- **Scope**: internal
- **Date**: 2026-08-09

## 速答

**是两件事。** 不能复用，理由：

1. `ContextFreshness` 是**召回过滤器**，三个值 `'current' | 'possibly_stale' | 'historical'` 对应「多久没验证过」，只在构造 ContextPack 时用，**不进 artifact 表，只在 knowledge_artifacts.metadata 和 ContextManifest 里**。
2. P1-1 要的是 artifact 级别的「这个文件的内容是不是和 run 开始时一致」，语义是 **当前 file digest 与落库 sha256 的比对结果**（布尔），不是时间衰减。
3. 已有 `MemoryStatus = 'candidate' | 'current' | 'stale' | 'superseded' | 'rejected'`（`artifact.ts:166`），其中 `'stale'` **也不是 P1-1 要的东西** —— 它在知识实体的生命周期管理语境（memory decay），不在 run 内证据链。

P1-1 应当用 `DigestVerification.verified` 已有的三态（true / false / null），不应发明第四个 freshness 枚举。

## Findings

### ContextFreshness 的定义与职责边界

`packages/shared/src/types/context.ts:22`：

```ts
export type ContextFreshness = 'current' | 'possibly_stale' | 'historical';
```

消费侧（已验证全路径）：

| 文件 | 行 | 用途 | 语义 |
|---|---|---|---|
| `apps/api/src/router.ts` | 223 | `if (metadata.freshness === 'historical') return false;` | **召回时过滤**：不让 historical 知识进上下文 |
| `apps/runner/src/context/builder.ts` | 595-599 | `knowledgeBaseMode(freshness, ...)` | `freshness === 'current' ? 'full' : 'summary'` —— 决定引入模式（全文 vs 摘要） |
| `apps/runner/src/context/retriever.ts` | 358-363 | `const freshness = candidate.freshness === 'current' ? 12 : ...` | **打分**：current 得 12 分，possibly_stale 得 6 分，historical 得 0 分 |

无任一处读它来决定「某个 artifact 是否还能当 evidence」。

### ContextFreshness 的写入侧

`apps/runner/src/context/builder.ts` 内默认值分配（已验证）：

- `129,145` → 固定写 `'current'`（project profile / requirement / design）
- `169` → 固定写 `'possibly_stale'`（architecture doc）
- `203,487,559,589` → 从 `KnowledgeArtifact.metadata.freshness` 读取传递
- `580,746,2869` → 固定写 `'historical'` / `'current'`

全是**召回前**决定的，与某个 run 的执行过程无关。

### knowledge_artifacts 表对 freshness 的处理

`packages/shared/src/types/artifact.ts:244-248`：

```ts
export interface KnowledgeContextMetadata {
  knowledgeClass?: KnowledgeClass;
  trustLevel?: ContextTrustLevel;
  freshness?: ContextFreshness;
  sourceRefs?: string[];
```

这是 `knowledge_artifacts.metadata_json` 里的自由字段，**不是表级列**。类型注释（artifact.ts:241-243）明确写：

> Context-injection classification fields stored in the existing
> `knowledge_artifacts.metadata_json` blob. These deliberately live in
> metadata first so Seed / Recovered / Confirmed can ship without a DB
> migration

`artifact.ts:360-386` 的 `defaultKnowledgeContextMetadataForStatus` 把 lifecycle status 映射成 freshness：

- `accepted` → `'possibly_stale'`
- `superseded` → `'historical'`
- `draft` → `'possibly_stale'`

含义：**freshness 反映的是知识实体作为源的可信度下降**，不是文件内容被改了。

### 为什么不能复用

对比表：

| 维度 | `ContextFreshness` | P1-1 的「失效」语义 |
|---|---|---|
| 作用对象 | `KnowledgeArtifact`（project-scoped, long-lived） | `Artifact`（per-run, one-shot evidence） |
| 判定依据 | lifecycle status / 最后验证时间 / human review | 当前文件 sha256 vs 落库 sha256 |
| 时间模型 | 渐变（current → possibly_stale → historical） | 突变（文件一改就不再是原证据） |
| 语义焦点 | 「这份知识还能不能信」 | 「这个证据还是不是当初那个证据」 |
| 存储位置 | `knowledge_artifacts.metadata.freshness` | **P1-1 需要在 artifacts 表或 step_checkpoints 表增列/结构，不能只存 metadata** |
| 消费方 | context builder / retriever（召回打分） | gate rule / node scheduler（证据失效 → 下游 stale） |

`ContextFreshness` 的 `'historical'` 不等于「文件被改了」，它等于「这份知识太老了，可能已经与当前代码不符」—— 即使文件从未被改过，只要 `lastValidatedAt` 超过某阈值（见 `artifact.ts:255`），freshness 照样会衰减。

反过来，P1-1 关心的「文件 hash 不匹配」在 ContextFreshness 模型里根本没有对应位置 —— 因为 knowledge artifact 是**允许被编辑的**（`artifact.ts:19-20` 的注释明确写 "editable, versioned"），编辑就是合法操作，不是「失效」。

### 已有的 `MemoryStatus` 也不对

`packages/shared/src/types/artifact.ts:166`：

```ts
export const MEMORY_STATUSES = ['candidate', 'current', 'stale', 'superseded', 'rejected'] as const;
```

这是 memory decay 机制（`artifact.ts:169-176` 的 `MemoryDecayPolicy`），语义：

- `stale` = "code churn detected, need re-validation"（`artifact.ts:156,227`）
- `superseded` = "a newer version was accepted"

P1-1 不是在做 memory decay。

### P1-1 应该用什么

**直接用 `DigestVerification.verified: boolean | null`**（`packages/shared/src/node/digest.ts:4-6`），这个已经是三态：

- `true` → 文件内容与落库 sha256 一致（可信证据）
- `false` → **mismatch**（证据失效）
- `null` → 没有 expected digest 或非 file URI（无法判定）

gate 规则读 `readArtifactContent(artifact).digest.verified`，遇到 `false` 就判证据失效，同时标记所有消费该 artifact 的 downstream node 为 stale。这不需要新的枚举，只需要新的消费逻辑。

## Caveats / Not Found

- 未验证 `MemoryDecayPolicy` 的 `code_churn` 分支是否已有执行方（`artifact.ts:174`）。如果已经在跑，可能与 P1-1 产生语义重叠，需协调。
- 未调研 `knowledge_artifacts` 表是否有 digest 列或相关机制 —— 本次只覆盖 per-run `artifacts` 表。
