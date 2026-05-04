# V2 P0-1：artifact_kind 枚举扩展 + DB schema 演进

## Goal

把 `ArtifactKind` 枚举从 V1 的 12 类扩展到 V2 所需的 ~14+ 类，让"知识类产物"（decision / lesson / pattern / architecture / roadmap / dev_guide / api_doc / explore）成为系统一等公民，为后续 V2 双写 pipeline、知识库视图、语义 verifier、acceptance 回写提案打下数据基础。

**V2 设计根据**：[`docs/2026-05-04-ai-native-platform-v2-design-notes.md`](../../../docs/2026-05-04-ai-native-platform-v2-design-notes.md) § 3.4

## What I already know

### V1 现状（从 repo 摸到的事实）

**类型定义**：`packages/shared/src/types/artifact.ts:3-15` 现有 12 类
```ts
type ArtifactKind =
  | 'project_profile' | 'context_pack' | 'requirement_draft'
  | 'design_doc' | 'traceability' | 'diff'
  | 'command_log' | 'surefire_report' | 'failsafe_report'
  | 'completion_report' | 'knowledge_candidate' | 'other';
```

**DB schema**：`apps/api/src/store/db.ts:109-119`
```sql
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,             -- 仅 TS 类型约束，DB 层是自由 TEXT
  uri TEXT NOT NULL,
  workflow_run_id TEXT NOT NULL,  -- 强绑定到一次 run
  step_run_id TEXT,
  size INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL     -- 自由 JSON，V2 typed metadata 可叠加
);
```

**关键查询**：`apps/api/src/store/store.ts:611` 的 `byKind(workflowRunId, kind)` 是现有按 kind 过滤的唯一接口。

**使用点**：
- runner: `apps/runner/src/orchestrator.ts`、`api-client.ts`
- api: `apps/api/src/workflow-engine.ts`、`routes/artifacts.ts`、`routes/runner-events.ts`
- web: 没有直接 import `ArtifactKind`（推测 UI 是 raw string 渲染）

### V1 设计的潜在张力

V1 的 12 类**生命周期不统一**，混了三种东西：
1. **per-run 自动产物**（diff / command_log / surefire_report / failsafe_report）— 一次性、不编辑
2. **per-run 文档产物**（requirement_draft / design_doc / completion_report / context_pack / project_profile）— 一次性、可能要编辑
3. **跨 run 知识产物**（knowledge_candidate）— 长期存活、跨 run 引用、会编辑

V2 要新加的 8+ 类（decision / lesson / pattern / architecture / roadmap / dev_guide / api_doc / explore）**全部属于第 3 类**。这暴露出一个根本设计选择（见 Open Questions Q1）。

## Assumptions (temporary)

- A1. SQLite + Bun 留着不换（项目内存约束："Local Runner + Git worktree + host JDK/Maven/Git"）
- A2. 文件是真相源、DB 是镜像（V2 doc § 3.1 已定）
- A3. V1 现有 12 类**保持兼容**，不破坏现存 run 的 artifact 行
- A4. V2 新增类的 metadata schema 也走 frontmatter + JSON 的双轨（TS 类型 + sqlite metadata_json）

## Open Questions

> ⚠️ 只列**阻塞 / 偏好**类问题，按依赖关系排序。一次只问一个。

### ✅ Q1（已拍板）：知识类产物的存储模型

**决策**：方案 B — 新建 `knowledge_artifacts` 表与 `artifacts` 并行。

详细论证见下方 `Decision (ADR-lite) [Q1]`。

### Q2（待答，下一题）：混血类型（requirement_draft / design_doc）的草稿—entity 二象性

V1 这两类同时承担两个角色：每次 run 都产一份**草稿**，但人工 gate 接受后应该**升格成项目级 entity**（REQ-### / DSN-###）供后续 run 引用。方案 B 选定后，这个二象性必须显式建模：

**方案 2-α：同一行**（draft 和 entity 共用一行 artifact，accept 后改 status）
- ✅ 行少、关联少
- ❌ 一行同时承担"per-run 一次性证据"和"项目级长期知识"两种语义，回到方案 A 的语义混乱
- ❌ 第二次 run 又改 REQ 时怎么办？覆盖原行？新加一行？逻辑复杂

**方案 2-β：两行 + 升级关系**（推荐）
- 草稿仍叫 `requirement_draft` / `design_doc`，留 `artifacts` 表
- accepted 的 entity 形态新建一行进 `knowledge_artifacts`，kind 是 `requirement` / `design`（去掉 _draft 后缀）
- entity 行通过 `derived_from_artifact_id` FK 反指草稿
- 后续 run 修改 REQ-001 时，新建草稿 → accept 后再升级（产生 entity 的新版本）

✅ 优点：语义最干净；与 P0-2（编号实体化）天然对接；P3-3 acceptance 回写提案有明确写入目标
❌ 代价：runner 流程要改（acceptance gate 通过后多一步"升级"动作）—— 但 V2 doc § 4.3 本来就要做这件事

**方案 2-γ：暂不处理 entity 行**（P0-1 只扩 kind，draft → entity 升级推到 P0-2）
- ✅ P0-1 scope 最小
- ❌ knowledge_artifacts 表先建空着没意义
- ❌ P0-2 还得回过头来补"升级"逻辑

### ✅ Q2（已拍板）：混血类型的草稿—entity 二象性

**决策**：方案 **2-β** — 两行 + 升级关系。详细论证见下方 `Decision (ADR-lite) [Q2]`。

### ✅ Q3（已拍板）：kind 命名表 + 命名风格

**决策**：方案 **3-α** — snake_case + 10 类粗粒度，子类型通过 `metadata.subtype` 表达。详细论证见下方 `Decision (ADR-lite) [Q3]`。

### ✅ Q4（已拍板）：metadata schema 是否上 typed

**决策**：方案 **4-β** — core typed + extension freeform。详细论证见下方 `Decision (ADR-lite) [Q4]`。

### ✅ Q5（已拍板）：V1 旧数据迁移

**决策**：P0-1 不迁移 V1 现有 `project_profile` / `knowledge_candidate`，留 `artifacts` 表不动。理由：保 V1 兼容、控本 task scope。后续 P3 阶段视需要再考虑迁移。详细论证见下方 `Decision (ADR-lite) [Q5]`。

## Requirements (evolving)

### 兼容性（V1 不破）
- R1. V1 现有 12 类的所有用法保持兼容，现存 `artifacts` 行不需要数据迁移
- R2. 现存 V1 行为完全不变（旧 feature run 端到端跑通，所有 artifact 仍正常写入）

### 类型与 schema（Q1=B 派生）
- R3. `artifacts` 表保留**纯 per-run 产物**语义；扩 `ArtifactKind` 时只加新增的"per-run kind"
- R4. **新建 `knowledge_artifacts` 表** 承接长期、跨 run、可编辑的知识类产物（具体 schema 见 Technical Notes）
- R5. 两张表共享：`id` / `kind` / `uri` / `size` / `content_type` / `metadata_json` / `created_at`
- R6. `knowledge_artifacts` 独有：`project_id` (FK)、`entity_id` (REQ-### / ADR-### 等，应用层约束，P0-1 不做 FK)、`status`、`version`、`derived_from_artifact_id` (升级关系，待 Q2 决策)
- R7. `workflow_run_id` 在 `artifacts` 表保持 NOT NULL（语义干净）；`knowledge_artifacts` 表无此列（项目级）

### API / 查询
- R8. `api.postArtifact()` 调用方根据 kind 自动路由到正确表（per-run kind → artifacts，知识 kind → knowledge_artifacts），调用方无感
- R9. 新增 `api.postKnowledgeArtifact()` 或扩展现有方法（具体由 implementation 决定）
- R10. `byKind(workflowRunId, kind)` 在 per-run kind 上行为不变；查知识 kind 用新接口（如 `byKindForProject(projectId, kind)`）
- R11. SSE / agent_events / 现有 stream 行为不变

### UI 兜底
- R12. Web UI artifact 列表对新 kind 至少有兜底渲染（不报错），colors/icons 后续 P3-2 补
- R13. 不在本 task 加新视图（Architecture / Lessons 等独立页是 P3-2）

### 升级 hook（Q2=2-β 派生）
- R14. acceptance gate 通过后，对 `requirement_draft` / `design_doc` 触发 `promoteToKnowledge()`，在 `knowledge_artifacts` 新建对应 entity 行
- R15. entity 行 `kind` 是去掉 `_draft` / `_doc` 后缀的形态：`requirement` / `design`
- R16. entity 行通过 `derived_from_artifact_id` FK 反指草稿；同一 entity_id 的多次升级以 `version` 累加（v1 / v2 / ...）
- R17. P0-1 范围内 `entity_id`（REQ-### / DSN-###）由应用层产生 + 软校验唯一性；强 FK 约束在 P0-2 做
- R18. 升级失败不阻断 acceptance（降级日志告警），保证 V1 acceptance 行为兼容

### kind 命名表（Q3=3-α 派生）
- R19. 命名风格保持 V1 的 snake_case，不引入新风格
- R20. `KnowledgeArtifactKind` union 包含 10 类：`requirement` / `design` / `architecture` / `roadmap` / `decision` / `lesson` / `pattern` / `explore` / `dev_guide` / `api_doc`
- R21. `PerRunArtifactKind` union 等于 V1 现有 12 类，本 task 不新增
- R22. 子类型通过 `metadata.subtype` 字段表达；P0-1 内为可选 string，应用层定义合法值集合（参考下方 Technical Notes 子类表）
- R23. V1 现有 `project_profile` / `knowledge_candidate` 两类**不迁移**，仍留 `artifacts` 表（数据迁移决策推到 Q5/P3）

### metadata schema（Q4=4-β 派生）
- R24. 定义 `KnowledgeMetadataCore` 接口：`{ subtype?: string; status: 'draft'|'accepted'|'superseded'; version: number; entityId?: string; derivedFromArtifactId?: string }`
- R25. `KnowledgeArtifactMetadata = KnowledgeMetadataCore & Record<string, unknown>` — core typed + extension freeform
- R26. `PerRunArtifactMetadata = Record<string, unknown>` — 维持 V1 现状不变
- R27. TS 字段 camelCase / DB 列名 snake_case，跟 V1 既有约定一致
- R28. 提供 `KNOWLEDGE_SUBTYPES: Record<KnowledgeArtifactKind, readonly string[]>` 常量，应用层在 `postKnowledgeArtifact()` 入口校验 `subtype` 是否合法

### 兼容性边界（Q5=不迁移 派生）
- R29. V1 旧数据零迁移：`project_profile` / `knowledge_candidate` 行保持现状，DB 不动、查询不变、UI 不动

## Acceptance Criteria (evolving)

### 兼容性
- [ ] AC-1. V1 已有 12 类的全部 TS / DB / API / UI 行为不变（回归测试覆盖）
- [ ] AC-2. 旧 feature run 端到端跑通，artifacts 表行为零回归

### 类型扩展
- [ ] AC-3. `ArtifactKind` 拆为两个 union：`PerRunArtifactKind`（V1 现有 + 新增 per-run）+ `KnowledgeArtifactKind`（V2 新增知识类）
- [ ] AC-4. 联合类型 `ArtifactKind = PerRunArtifactKind | KnowledgeArtifactKind` 保持向后兼容

### DB
- [ ] AC-5. `knowledge_artifacts` 表通过 migration 创建，列覆盖 R4-R7
- [ ] AC-6. 应用层校验：写入 per-run kind 进 `knowledge_artifacts` 报错；反之亦然

### API + 端到端
- [ ] AC-7. 至少 1 个新增 per-run kind 的端到端写入 + 查询测试通过
- [ ] AC-8. 至少 1 个新增 knowledge kind 的端到端写入 + 项目级查询测试通过
- [ ] AC-9. `api.postArtifact()` 老调用方代码不需要改

### 升级 hook（Q2=2-β）
- [ ] AC-11. acceptance gate 通过后 `requirement_draft` 自动升级出 `requirement` entity 行（端到端测试）
- [ ] AC-12. 同一 entity_id 多次升级版本号正确累加（v1 → v2）
- [ ] AC-13. 升级失败时 acceptance 行为不受影响（fault-injection 测试）

### Metadata schema（Q4=4-β）
- [ ] AC-14. `KnowledgeMetadataCore` 接口定义并导出，被 `knowledge_artifacts` 写入路径强制使用
- [ ] AC-15. `KNOWLEDGE_SUBTYPES` 常量定义；`postKnowledgeArtifact()` 写入非法 subtype 报错
- [ ] AC-16. core 字段（status / version 等）类型错误在 `tsc` 层面报红

### 工程
- [ ] AC-10. `npm test` green；`tsc` 无 error；lint 通过

## Definition of Done

- 测试：单元测试 + 至少 1 条端到端 happy path
- 类型：`tsc` 无 error
- Lint：项目现有 eslint/prettier 规则通过
- 文档：在 `docs/` 加一份"V2 ArtifactKind 命名表"作为参考
- 兼容：V1 行为完全不变（验收方法：跑一次旧 feature run，全部 artifact 仍正常写入）
- 不破坏：现有 7 个 active task 的 PR 不需要回归改动

## Out of Scope (explicit)

- ❌ 编号实体化（REQ-### / ADR-### 强约束）— 这是 P0-2 的工作
- ❌ 双写 pipeline（DB ↔ 文件双向同步）— 这是 P1-1
- ❌ 知识库视图 UI（Architecture / Lessons 等独立页）— 这是 P3-2
- ❌ 语义 verifier — 这是 P3-1
- ❌ V1 历史 `knowledge_candidate` 数据迁移到 V2 细分 kind — 推迟到 P3 阶段（如 Q4 决策需要）

## Technical Notes

### V1 现有 12 类 × 生命周期分类（Q1 决策依据）

| # | kind | per-run? | 会编辑? | 生命周期 | V2 归属 |
|---|---|---|---|---|---|
| 1 | `project_profile` | ❌ 跨 run 复用 | 偶尔 | 项目级长期 | **knowledge_artifacts**（架构地图前身） |
| 2 | `context_pack` | ✅ | ❌ | 一次性 | **artifacts**（per-run） |
| 3 | `requirement_draft` | ✅ | 人工 gate 改 | 草稿 → entity 升级 | **混血**（草稿在 artifacts；entity 在 knowledge_artifacts，待 Q2） |
| 4 | `design_doc` | ✅ | 人工 gate 改 | 草稿 → entity 升级 | **混血**（同上） |
| 5 | `traceability` | ✅ | ❌ | 一次性 | **artifacts**（V2 后期被 entity 表替代） |
| 6 | `diff` | ✅ | ❌ | 一次性 | **artifacts** |
| 7 | `command_log` | ✅ | ❌ | 一次性 | **artifacts** |
| 8 | `surefire_report` | ✅ | ❌ | 一次性 | **artifacts** |
| 9 | `failsafe_report` | ✅ | ❌ | 一次性 | **artifacts** |
| 10 | `completion_report` | ✅ | ❌ | 一次性 | **artifacts** |
| 11 | `knowledge_candidate` | ✅ 但意图跨 run 复用 | 人工批准/拒绝 | run 内产生，accepted 应升级 | **knowledge_artifacts**（V2 要拆细到 decision/lesson 等） |
| 12 | `other` | 通常 ✅ | 不限 | 不限 | **artifacts**（兜底保留） |

→ A 类 8 项 + 兜底（`other`）= **9 项进 artifacts**
→ B 类 2 项 = **混血，等 Q2 决策**
→ C 类 2 项 = **`project_profile` + `knowledge_candidate` 进 knowledge_artifacts**

### V2 新增知识 kind（Q3 拍板：10 类，snake_case）

进 `knowledge_artifacts`：

| kind | 含义 | 子类型（metadata.subtype 合法值） |
|---|---|---|
| `requirement` | 已接受的需求 entity（REQ-###） | — |
| `design` | 已接受的设计 entity（DSN-###） | — |
| `architecture` | 系统现状地图 | — |
| `roadmap` | 计划 | `feature` / `milestone` / `vision` |
| `decision` | ADR | `tech_stack` / `architecture` / `constraint` / `convention` |
| `lesson` | 踩坑 + 经验 | `pitfall` / `knowledge` |
| `pattern` | 复用模式 | `pattern` / `library` / `technique` |
| `explore` | 调研存档 | `question` / `module_overview` / `spike` |
| `dev_guide` | 开发者指南 | — |
| `api_doc` | 公开 API 参考 | — |

### 关键文件

- `packages/shared/src/types/artifact.ts` — 类型定义入口
- `apps/api/src/store/db.ts:109-119` — `artifacts` table schema
- `apps/api/src/store/db.ts:265-302` — 演进式 ALTER TABLE 迁移模式（V2 沿用）
- `apps/api/src/store/store.ts:558-621` — artifacts CRUD + `byKind()` 查询
- `apps/api/src/routes/artifacts.ts` — REST endpoints
- `apps/api/src/workflow-engine.ts` — `postArtifact` 主写入路径
- `apps/runner/src/orchestrator.ts:117-126,418-428` — runner 调 postArtifact 的两个主要点

### V2 doc 引用

- § 3.1 双写架构（DB + 文件）
- § 3.4 结构化产物体系（10+ 类对照表）
- § 3.6 实体化的编号系统（与 P0-1 解耦的 P0-2 范围）
- 附录 A：V1 → V2 mapping cheat sheet

### 后续 task 依赖

P0-1 完成后阻塞解除：
- P0-2（编号实体化）可全速推进——已有 `knowledge_artifacts` 父表承接，P0-2 在其之上加 entity_id FK 强约束
- P1-1（双写 pipeline）可启动设计——双写策略可分别在两张表上独立验证

---

## Decision (ADR-lite) [Q1]

**Context**：
V2 要新加 8+ 类知识产物（decision/lesson/pattern/architecture/roadmap/dev_guide/api_doc/explore），它们的生命周期与 V1 现有 12 类的 per-run 产物截然不同——长期、跨 run、可编辑、有项目级编号。需要决定它们和现有 `artifacts` 表的关系。

**Decision**：
采用**方案 B**——新建 `knowledge_artifacts` 表与 `artifacts` 并行：
- `artifacts` 表保留纯 per-run 产物语义（必填 `workflow_run_id`）
- `knowledge_artifacts` 表承接长期、跨 run、可编辑的知识类（必填 `project_id`，无 `workflow_run_id`）
- 两表共享列：id / kind / uri / size / content_type / metadata_json / created_at
- 应用层校验：kind 写错表则报错

**Consequences**：
- ✅ 语义边界清晰，per-run 审计 vs 项目级知识不混
- ✅ 后续 P0-2 编号实体化在 `knowledge_artifacts` 之上加 entity_id FK 即可，不需要回头改 `artifacts`
- ✅ P1-1 双写策略可在两表上分别独立验证
- ✅ P3-1 语义 verifier 只针对 `knowledge_artifacts` 做 entity 校验，`artifacts` 维持现状
- ❌ 跨表查询场景需要 union（影响有限，UI 列表场景少）
- ❌ 双写实现要双轨（成本可接受）
- ⚠ 混血类型（requirement_draft / design_doc）的处理见 Q2，可能需要额外的"草稿→entity 升级"流程

---

## Decision (ADR-lite) [Q2]

**Context**：
方案 B 落定后，`requirement_draft` 和 `design_doc` 这两个混血类型必须显式建模"per-run 草稿"vs"项目级 entity"的二象性。否则 `knowledge_artifacts` 表对它们就是死表，acceptance gate 也不知道要做什么。

**Decision**：
采用**方案 2-β**——两行 + 升级关系：
- 草稿仍叫 `requirement_draft` / `design_doc`，落 `artifacts` 表（不变）
- acceptance gate 通过后触发 `promoteToKnowledge()` hook，新建 entity 行进 `knowledge_artifacts`，kind 是 `requirement` / `design`
- entity 行通过 `derived_from_artifact_id` FK 反指原草稿
- 同一 `entity_id` 多次升级累加 `version`（v1 → v2）
- P0-1 范围内 `entity_id` 由应用层产生 + 软校验唯一性；强 FK 约束推到 P0-2

**Consequences**：
- ✅ 语义最干净：草稿是 run 内一次性证据，entity 是项目级长期知识
- ✅ `knowledge_artifacts` 表从一上线就有真实数据，不是死表
- ✅ P3-3 acceptance 回写提案有明确写入目标
- ✅ 第二次 run 改 REQ-001 → 新草稿 → accept 升级 v2，旧版本仍可追溯
- ❌ runner / acceptance gate 流程要改（多一步升级动作）
- ❌ 本 task scope 从 1 周扩到 ~1.5 周
- ⚠ `entity_id` 在 P0-1 是软约束，跨 run 唯一性靠应用层（生成器函数）保证；P0-2 才升级为 DB 强约束
- ⚠ 升级失败必须降级处理（日志告警），不能 break acceptance gate（V1 兼容性）

---

## Decision (ADR-lite) [Q3]

**Context**：
方案 B + 2-β 落定后，要确定 `knowledge_artifacts` 表里到底放哪些 kind、命名风格、以及 CodeStable 启发的子类型（如 lesson 的 pitfall vs knowledge）放在 kind 还是 metadata。

**Decision**：
采用**方案 3-α**——snake_case + 10 类粗粒度 + metadata.subtype 表达细分：
- 命名风格保持 V1 的 snake_case，零重构成本
- `KnowledgeArtifactKind` 包含 10 类一等公民：`requirement` / `design` / `architecture` / `roadmap` / `decision` / `lesson` / `pattern` / `explore` / `dev_guide` / `api_doc`
- 细分子类（如 `lesson` 的 `pitfall` / `knowledge`）通过 `metadata.subtype` 表达
- V1 现有 `project_profile` / `knowledge_candidate` 不迁移，留 `artifacts` 表不动（推到 P3 阶段处理）

**Consequences**：
- ✅ 风格一致，无新增重构
- ✅ 演进友好：metadata.subtype 是 freeform JSON，新加细分子类不需要 schema migration
- ✅ UI 路由按 kind 分页够用；filter by subtype 是后续 polish
- ✅ 与 V2 doc § 3.4 列表对齐（10 类 + V1 留下的 12 类）
- ❌ 跨子类查询稍微绕（但 P0-1 没有这种 UI 需求）
- ⚠ subtype 合法值在应用层定义（不进 DB），后续 P0-2 可考虑加 enum 表
- ⚠ V1 的 `project_profile` 长期看应该归到 `architecture`，但 P0-1 不动它——遗留债务记录在 Q5 范围

---

## Decision (ADR-lite) [Q4]

**Context**：
方案 B + 2-β + 3-α 落定后，要决定 metadata 字段是 V1 风格的全 freeform、还是为新加的 status/version/subtype 等核心字段加上 TS 类型保护。

**Decision**：
采用**方案 4-β**——core typed + extension freeform：
- 定义 `KnowledgeMetadataCore` 接口，强类型保护核心字段（status / version / subtype / entityId / derivedFromArtifactId）
- 整体 metadata 类型 = core & `Record<string, unknown>`，允许自由扩展
- per-run artifact metadata 维持 V1 风格的 freeform，零改动
- TS 字段 camelCase、DB 列名 snake_case
- subtype 合法值通过应用层常量 `KNOWLEDGE_SUBTYPES` 管控

**Consequences**：
- ✅ status / version / entityId 这种"业务关键字段"有编译期保护，避免 typo bug
- ✅ per-kind 业务字段（lesson.severity / decision.supersedesId）走 freeform，演进无阻力
- ✅ P0-1 scope 不爆——只定 core schema，10 kind 的细化 metadata 推到 P3
- ✅ DB / TS 一致：core 字段稳定；extension 字段自由
- ❌ 调用方写 extension 时 IDE 不能完整补全
- ⚠ 后续 P3-1 verifier 实现时若需要细化某 kind 的 schema，要补 typed metadata（不在本 task 范围）

---

## Decision (ADR-lite) [Q5]

**Context**：
V1 现有 `project_profile` 和 `knowledge_candidate` 在新模型下"在概念上属于 knowledge_artifacts"，但本 task 是否要做数据迁移？

**Decision**：
**P0-1 不做任何 V1 旧数据迁移**：
- 现存 `project_profile` / `knowledge_candidate` 行保持留在 `artifacts` 表
- 行为完全不变（runner 写入路径、UI 渲染、查询接口都跟 V1 一致）
- 这两类长期归属（应该归到 `architecture` / `decision` 等）的迁移决策推到 P3 阶段

**Consequences**：
- ✅ V1 兼容性绝对保证（DoD 关键 KPI）
- ✅ 本 task scope 控制住，不被迁移逻辑挤占
- ✅ 可以独立测试 P0-1 的新增能力，不被旧数据脏 case 干扰
- ❌ 短期内"知识"语义在两表都有（artifacts 里的 project_profile + knowledge_artifacts 里的 architecture），UI 列表需要兜底
- ⚠ 遗留债：P3 阶段需要单独 task 处理"V1 旧数据 → V2 新模型"的迁移路径
- ⚠ V1 行 metadata 没有 status/version 字段，迁移时要补默认值（P3 处理）
