# V2 P0-2：编号实体化（Entity Tables Bootstrap）

## Goal

把 P0-1 的 `knowledge_artifacts.entity_id`（应用层软约束）升级为 DB 层强约束的实体表。让 REQ-### / DSN-### / ADR-### / LSN-### 等编号在项目内**全局唯一可追溯**，为后续 P3-1 语义 verifier、P3-2 知识库视图、编号穿透浏览打下数据基础。

**V2 设计根据**：[`docs/2026-05-04-ai-native-platform-v2-design-notes.md`](../../../docs/2026-05-04-ai-native-platform-v2-design-notes.md) § 3.6

## What I already know

### P0-1 留下的状态（commits e9ec772 + 1cbacd4 + 1fe383c）

- `knowledge_artifacts` 表已建好（PR2），含 `entity_id TEXT NULLABLE` 列
- 10 类知识 kinds 已就位
- 已有索引：`idx_knowledge_artifacts_entity ON (project_id, entity_id)`
- `promoteAcceptedDraftToKnowledge`（PR3）已经在写 `entity_id`：
  - 优先从 markdown 文档 frontmatter 读 REQ-### / DSN-###
  - 没有则按"项目内最大序号 +1"生成
  - 同一 entity_id 多次升级 → version 累加 + 旧 accepted 行 supersede

### V2 doc § 3.6 给出的目标模型

```
requirements (id: REQ-001, project_id, status, version, current_artifact_id?)
  └─ acceptance_criteria (id: AC-001-1, parent: REQ-001)
designs (id: DSN-001, project_id, ref_req: REQ-001, status, current_artifact_id?)
  └─ mount_points (id, parent: DSN-001, kind, target_file)
implementations (id, ref_design: DSN-001, commit_sha)
test_runs (id, ref_ac: AC-001-1, status, evidence_uri)
decisions (id: ADR-001, supersedes: ADR-###)
lessons (id: LSN-001, severity, related_files[])
```

### 当前痛点（P0-2 要治的）

- 同一项目内 `entity_id='REQ-001'` 可以被插入多次（DB 不阻止）
- `knowledge_artifacts.entity_id` 是 free TEXT，找不到对应"实体"是哪条
- 跨表关系（design 引 REQ、test 引 AC）没有强约束
- UI 想做"点 AC-001-1 跳到 design 的挂载点"无 schema 支撑

## Assumptions (temporary)

- A1. SQLite 不换；继续延用 db.ts 的 idempotent migration 风格
- A2. P0-1 留下的 knowledge_artifacts 表**不动**，只在它之上加 entity 表 + FK
- A3. 现有 V1 / P0-1 全部测试零回归
- A4. Entity 表存"head pointer"语义：每条 entity 行代表一个**当前版本头**，历史版本仍在 knowledge_artifacts

## Open Questions

> ⚠️ 只列阻塞 / 偏好类，按依赖排。一次只问一个。

### ✅ Q1（已拍板）：scope = MVP 2 类

**决策**：方案 **α** — 仅做 `requirements` + `designs` entity 表，与 PR3 现有 promote 路径完全对齐。详细论证见 `Decision (ADR-lite) [Q1]`。

### ✅ Q2（已拍板）：knowledge_artifacts ↔ entity 的关系建模

**决策**：方案 **2-A** — Head pointer 表 + 历史保留在 `knowledge_artifacts`。新增 `requirements` / `designs` 瘦表，每行一个 entity，指向当前权威版本（`current_artifact_id` FK → `knowledge_artifacts.id`）；历史版本仍在 `knowledge_artifacts` 用 `(project_id, entity_id)` 索引检索；promote 路径用事务包两步写。详细论证见 `Decision (ADR-lite) [Q2]`。

### ✅ Q3（已拍板）：FK 严格度

**决策**：方案 **3-B** — 混合：`designs.ref_req` 走强 FK（`REFERENCES requirements(id) ON DELETE RESTRICT`），`requirements.current_artifact_id` / `designs.current_artifact_id` 不声明 FK（裸 TEXT 列 + 应用层事务保证）。理由：REQ↔DSN 是 V2 产品核心 traceability 链路、值得 DB 兜底；指向 knowledge_artifacts 的 head 指针在 promote 事务内部天然安全，不需第二道兜底。详细论证见 `Decision (ADR-lite) [Q3]`。

### ✅ Q4（已拍板）：现有 knowledge_artifacts 行的 backfill 策略

**决策**：方案 **4-B** — 不 backfill。Migration 只建空表，已有 `knowledge_artifacts` 行原样保留；P0-2 上线后通过 promote 路径自然累积 entity 行；spec / release notes 必须明确"升级前已有 entity_id 行不会自动出现在 entity 表"。详细论证见 `Decision (ADR-lite) [Q4]`。

### ✅ Q5（已拍板）：entity_id 生成位置

**决策**：方案 **5-A** — 全部下沉到 API。新增 `POST /knowledge-artifacts/promote` 端点接收 `{ projectId, kind, draftArtifactId, draftText, uri, size, contentType }`，API 在单事务内做完 frontmatter 解析 → max+1 fallback → nextVersion 计算 → supersede 旧 accepted → INSERT knowledge_artifact → UPSERT entity head 6 步。Runner `promoteAcceptedDraftToKnowledge` 收缩为 ~10 行 HTTP 包装。详细论证见 `Decision (ADR-lite) [Q5]`。

### 🔒 用户全局授权（2026-05-04 brainstorm 第 4 轮）

> "5-A. 后面如果有需要确认的，就按照你的推荐来。请记住这个决定，直到任务完成。"

→ 后续 implementation / check 阶段的小决策（变量命名 / 错误码 / 测试组织 / spec 文档插入位置 / commit message 形态等）默认按 AI 推荐执行；只有出现**新的实质性架构选择**（例如 schema 形态变化、跨包公共契约变更）才回头确认。

## Requirements (evolving)

### 兼容性
- R1. P0-1 留下的 `knowledge_artifacts` 表行为完全不变（兼容性）
- R2. 现有 V1 + P0-1 的 25 个新增测试 + 235 V1 测试全部仍然过

### Scope α 派生（Q1=α）
- R3. 本 task 仅做 2 张 entity 表：`requirements` + `designs`
- R4. **不做** acceptance_criteria / mount_points / implementations / test_runs / 其他 4 类知识 entity（推到后续 task）

### Head pointer 模型派生（Q2=2-A）
- R5. `requirements` 表 schema：`id TEXT NOT NULL` / `project_id TEXT NOT NULL` / `status` / `current_version INTEGER` / `current_artifact_id TEXT`（指向 `knowledge_artifacts.id`，FK 严格度见 Q3）/ `created_at` / `updated_at`；**复合主键 `PRIMARY KEY (project_id, id)`** —— entity_id 是项目内（不是全局）唯一
- R6. `designs` 表 schema：与 R5 同形 + `ref_req TEXT NOT NULL`（指向 `requirements` 的项目内 entity_id，FK 严格度由 Q3 决定）；同样复合主键 `PRIMARY KEY (project_id, id)`
- R7. ~~`(project_id, id)` 在两张 entity 表上 DB-level UNIQUE~~ → 已升级为复合 PK，全局唯一性不存在，**项目维度唯一性** 由 PK 直接兜底
- R8. **每条 entity 行表示"当前权威版本头"**——历史版本仍在 `knowledge_artifacts` 表，按 `(project_id, entity_id)` 索引检索
- R9. `knowledge_artifacts` 表 schema 零改动（PR2 落地的形状不动），entity 表的 FK 反指 knowledge_artifacts
- R10. `promoteAcceptedDraftToKnowledge` 改造为事务两步写：
  1. INSERT 新版本行进 `knowledge_artifacts`（沿用 PR3 现有逻辑）
  2. UPSERT entity 表 head 指针（`current_version` / `current_artifact_id` / `status`/`updated_at` 全部更新；不存在则 INSERT）
- R11. 两步写失败时**整体回滚**——绝不允许 entity 表指向不存在的 knowledge_artifact id
- R12. promote 失败仍走 PR3 既有的"降级日志告警、不阻断 acceptance"语义（R10/R11 在事务内部处理，对外抛错语义不变）
- R13. 新增查询接口（store 层）：`requirements.byProject(projectId)` / `requirements.get(projectId, id)` / `designs.byProject(projectId)` / `designs.get(projectId, id)`，UI / verifier 直接走这条而不是 `knowledgeArtifacts.latestByEntityId`
- R14. `latestByEntityId` 等 PR2 既有查询保持兼容不删除（兼容性兜底；后续 P3 再看是否替换）

### FK 严格度派生（Q3=3-B）
- R15. `designs` 声明**复合**强 FK：`FOREIGN KEY (project_id, ref_req) REFERENCES requirements(project_id, id) ON DELETE RESTRICT` —— 同时锁 project_id 一致性（design 不能引用别的项目的 requirement）+ ref_req 必须存在
- R16. `requirements.current_artifact_id` / `designs.current_artifact_id` **不声明 FK**——裸 `TEXT NOT NULL`，引用完整性走 promote 事务（同事务先 INSERT knowledge_artifacts、再 UPSERT entity 引用刚生成的 id）
- R17. `PRAGMA foreign_keys = ON` 已在 db.ts:16 全局打开，无需新增
- R18. spec 文档（`.trellis/spec/api/backend/database-guidelines.md`）补一段："产品核心关系（REQ↔DSN traceability）声明 FK；辅助指针（head pointer 指向不可变历史行）走应用层事务"——为后续 P0-2.5 / P3-1 设原则
- R19. 若运行时探测到 ref_req FK 违反（设计指向不存在 / 非 active 的 requirement），promote 路径必须报错回滚，不允许 silent drop

### Backfill 策略派生（Q4=4-B）
- R20. Migration 只建空 `requirements` / `designs` 表，**不扫描、不写入**任何现有 `knowledge_artifacts` 行
- R21. 已有 `knowledge_artifacts.entity_id` 行原样保留——`knowledgeArtifacts.latestByEntityId` 仍能查到（兼容）；但 `requirements.byProject(projectId)` 看不到这些"P0-2 之前"的 entity（行为是允许的）
- R22. P0-2 上线后通过正常 promote 路径自然累积 entity 行：下次 promote 同 `entity_id` → 进事务 → entity head 自动创建 → `current_version` 接续 PR3 既有 max+1 逻辑（不会跳号）
- R23. **必须**在 `.trellis/spec/api/backend/database-guidelines.md`（或同等位置）加一段说明 P0-2 升级语义边界："P0-2 上线前已有 entity_id 行不会自动出现在 entity 表；需要补全时手动触发一次 promote 即可"
- R24. **必须**在 task 完成时的 commit / PR description 里写明"无数据迁移"，避免接 PR 的人误以为漏写

### entity_id 生成位置派生（Q5=5-A）
- R25. 新增 API 端点 `POST /knowledge-artifacts/promote`（`apps/api/src/routes/knowledge-artifacts.ts`），入参 `PromoteRequest = { projectId, kind: 'requirement_draft'|'design_doc', draftArtifactId, draftText, uri, size, contentType }`
- R26. API 端实现 `promoteDraftInTransaction()`（建议放 `apps/api/src/workflow-engine.ts` 或新 `apps/api/src/promote.ts`）在 `db.transaction(() => { ... })` 内顺序执行 6 步：(1) regex 抓 `REQ-###` / `DSN-###` from `draftText` (2) max+1 fallback (3) `nextVersion = max(version)+1` 同 entity_id (4) UPDATE 旧 accepted → superseded (5) INSERT knowledge_artifact accepted 行 (6) UPSERT entity head 表
- R27. Runner `promoteAcceptedDraftToKnowledge` 收缩为 HTTP 包装：构造 `PromoteRequest` → 调 `api.promoteDraft(req)` → 失败时仍走 PR3 既有的"降级日志、不阻断 acceptance"语义；不再持有 entity_id 算法 / version 算法 / supersede 算法
- R28. PromoteDeps 接口（runner 测试用 DI）相应简化：单依赖 `promoteDraft: typeof api.promoteDraft`，原 4 个依赖（postKnowledgeArtifact / listByKind / listByEntity / setStatus）从 runner 端 PromoteDeps 移除（API 端测试自行 mock store 层）
- R29. API 单事务的事务边界包**全部 6 步 + entity head upsert**（不能拆事务）；任一步失败整体回滚；FK 违反（如 `designs.ref_req` 指向不存在 requirement）走 R19 报错回滚路径
- R30. 端点返回响应 `PromoteResponse = { knowledgeArtifactId, entityId, version, entityKind: 'requirement'|'design' }`，runner 拿到后写 log（保留 PR3 既有 log 格式："[runner] promoted requirement_draft <id> -> requirement REQ-001 v1 (id=<knArtId>)"）
- R31. 并发安全：两个 runner 并发对同一 project + 同 kind 调 promote，DB 事务串行化保证只有一个能拿到某个 `REQ-###`（hint 路径靠 entity 表 `(project_id, id)` UNIQUE 拦截，max+1 路径靠事务串行）；冲突时第二个 promote 重新进事务自动 fallback 到下一号

## Acceptance Criteria (evolving)

### 兼容性
- [x] AC-1. PR2 落地的 `knowledge_artifacts` schema 零改动（不加 / 不删 / 不改列）
- [x] AC-2. 现有 V1 + P0-1 全部测试通过（260+），零回归

### Schema (Q2=2-A 派生)
- [x] AC-3. `requirements` / `designs` 两张 migration 落地，列覆盖 R5 / R6
- [x] AC-4. `(project_id, id)` 在两张 entity 表上是复合 PRIMARY KEY（直接 enforce 项目维度唯一性，比原 R7 的 `id PK + UNIQUE(project_id, id)` 双层兜底更简洁）
- [x] AC-5. `current_artifact_id` 列存在，**不声明** FK（Q3=3-B）；引用完整性靠 promote 事务保证（AC-9 覆盖）
- [x] AC-6. `designs` 声明复合强 FK：`FOREIGN KEY (project_id, ref_req) REFERENCES requirements(project_id, id) ON DELETE RESTRICT`（升级原 R15 单列设计——同时锁 project_id 一致性 + ref_req 必须存在）
- [x] AC-6b. 端到端测试：试图 INSERT `designs` with `ref_req='REQ-NONEXIST'` → SQLite 报 FK violation
- [x] AC-6c. 端到端测试：DELETE 一个被 design 引用的 `requirements` 行 → SQLite 拒绝（RESTRICT 生效）

### Promote 路径事务化 (R10/R11 派生)
- [x] AC-7. `promoteAcceptedDraftToKnowledge` 在事务内完成"插 knowledge_artifacts + UPSERT entity"两步
- [x] AC-8. 端到端测试：第一次 promote → entity 行新建（version=1）；同 entity 第二次 promote → entity 行 head 指针前推（version=2，旧 knowledge_artifacts 行 supersede）
- [x] AC-9. 端到端测试：故意让第二步失败 → 第一步也回滚（entity 表不出现，knowledge_artifacts 也不留新行）
- [x] AC-10. PR3 现有 promote 接口签名 / 调用方代码零改动

### Store / 查询接口
- [x] AC-11. 新增 `requirements.byProject` / `requirements.get` / `designs.byProject` / `designs.get` 查询并有单测覆盖
- [x] AC-12. `knowledgeArtifacts.latestByEntityId` 等 PR2 既有接口仍可用（兼容性）

### Backfill (Q4=4-B 派生)
- [x] AC-12b. Migration 跑完后，`requirements` / `designs` 表为空，**完全不读取也不写入** `knowledge_artifacts`
- [x] AC-12c. 端到端测试：构造一条已存在的 `knowledge_artifacts` 行（kind=requirement, entity_id='REQ-001', version=2, status='accepted'），跑 migration → entity 表仍为空 → 触发新一次 `promoteAcceptedDraftToKnowledge` → entity 行自动创建，`current_version=3`（接续 max+1）
- [x] AC-12d. spec 文档更新："P0-2 升级前已有 entity_id 行不会自动出现在 entity 表"（R23）

### entity_id 生成下沉 API (Q5=5-A 派生)
- [x] AC-12e. 新增端点 `POST /knowledge-artifacts/promote`，单元测试覆盖：(a) frontmatter 抓到 entity_id (b) frontmatter 没抓到走 max+1 (c) 同 entity_id 多次 promote 累加 version (d) 旧 accepted 行被自动 superseded (e) entity head 表 upsert
- [x] AC-12f. 单事务原子性测试：故意让 entity head upsert 失败 → INSERT knowledge_artifact 也回滚（DB 回到调用前状态）
- [x] AC-12g. 并发测试：两个 promote 请求同时进入（同 project / 同 kind / frontmatter 都没 hint）→ 各自分配到不同 entity_id，无重号
- [x] AC-12h. Runner `promoteAcceptedDraftToKnowledge` 收缩为 HTTP 包装（行数 ≤ 30），原 entity_id 算法 / version 算法 / supersede 调用全部移除
- [x] AC-12i. PR3 现有 runner 端单测全部通过（mock 层从 4 依赖减到 1 依赖）；新增 API 端单测覆盖原算法

### 工程
- [x] AC-13. `tsc` 全清；lint 通过；`npm test` green

## Definition of Done

- 测试：单元 + 端到端
- 类型：tsc 全清
- Lint：通过
- 兼容：旧 feature run 端到端跑通
- 不破坏现有 PR1+PR2+PR3 行为

## Out of Scope (explicit)

- ❌ Web UI 视图（P3-2）
- ❌ 编号点击穿透浏览（P4-2）
- ❌ 语义 verifier（P3-1）
- ❌ implementations / test_runs 关联表（除非 Q1 选 γ scope 显式包含）

## Technical Notes

### 关键文件

- `apps/api/src/store/db.ts:120-139`（PR2 的 knowledge_artifacts migration，新表跟它平级）
- `apps/api/src/store/store.ts:625-740`（knowledgeArtifacts 模块作为模板）
- `apps/api/src/workflow-engine.ts`（createKnowledgeArtifact 是入口，可能需要扩 entity 写入）
- `apps/runner/src/orchestrator.ts:promoteAcceptedDraftToKnowledge`（PR3 写 entity_id 的地方）
- `packages/shared/src/types/artifact.ts`（KnowledgeArtifact 已有；entity 类型可能新增）

### 后续依赖解锁

P0-2 完成后能启动：
- P3-1 语义 verifier（基于 entity 做 traceability_gate）
- P3-2 知识库视图（按 entity 而不是 artifact 列表）
- 编号穿透浏览

---

## Decision (ADR-lite) [Q1]

**Context**：
P0-1 的 PR3 已经在 `knowledge_artifacts` 上写 entity_id（REQ-### / DSN-###），但 DB 没强约束、也没"实体头"概念。P0-2 要把这一层补上——但 V2 doc § 3.6 列了 6 类 entity + 子表 + 关联表，全做工作量过大。需要决定 P0-2 范围。

**Decision**：
采用 **Scope α** — 仅做 `requirements` 和 `designs` 两张 entity 表：
- 与 PR3 实际产生 entity 的 2 类（requirement / design）100% 对齐
- 其他 4 类知识 kinds（decision / lesson / architecture / roadmap）的 entity 表推到后续 task（建议命名 P0-2.5），等它们有 promote 驱动方时再做
- 子表（acceptance_criteria / mount_points）和关联表（implementations / test_runs）一并推后

**Consequences**：
- ✅ 立刻有数据可校验（PR3 promote 路径活跃）
- ✅ 解锁 P3-1 verifier 的 traceability_gate REQ↔DSN 链路（约 50% 已可跑）
- ✅ 改动最小、回归风险最低
- ✅ 跟"先做 3 种工作流就行"的工程纪律一致
- ❌ AC-### / decisions / lessons 仍是字符串，需后续 task 收尾
- ⚠ 后续要起新 task 处理 decisions / lessons 的 entity 化（P0-2.5）+ AC-### 子表（P0-3 或与 P3-1 并行）

---

## Decision (ADR-lite) [Q2]

**Context**：
Q1=α 选定要建 `requirements` / `designs` entity 表后，必须决定它们和已有 `knowledge_artifacts` 表的关系。已知事实（代码核过）：`knowledge_artifacts` 已有 `entity_id` 列、`(project_id, entity_id)` 索引、`latestByEntityId` 查询、`promoteAcceptedDraftToKnowledge` 累加 `version` 的逻辑——能力上相当于"扁平历史表 + entity_id 字符串聚合"。Q2 要决定到底再加一层"实体头"还是直接用偏 unique 索引把现状钉死。

**Decision**：
采用 **方案 2-A**——Head pointer 表 + 历史保留在 `knowledge_artifacts`：
- 新增 `requirements` / `designs` 瘦表，每行一个 entity，`id` 直接是 entity_id（如 `REQ-001`）当 PK
- entity 行是当前权威版本头：`current_version` / `current_artifact_id`（指向 `knowledge_artifacts.id`，FK 严格度见 Q3）/ `status` / 时间戳
- 历史版本仍在 `knowledge_artifacts`，按 `(project_id, entity_id)` 索引检索
- `knowledge_artifacts` schema 零改动
- `promoteAcceptedDraftToKnowledge` 改造为事务：(1) INSERT 新版本进 `knowledge_artifacts` (2) UPSERT entity head 指针；任一失败整体回滚
- 新增 `requirements.byProject/get` 等查询，UI / verifier 直接走 entity 表，不再依赖 `latestByEntityId` 扫描

**Consequences**：
- ✅ 跟 V2 doc § 3.6 模型严格对齐，后续不返工
- ✅ `knowledge_artifacts` schema 零改动 → PR1+PR2+PR3 已落地的 25 条测试零回归压力
- ✅ "REQ-001 现在是什么"是 O(1) SELECT，不再依赖 `latestByEntityId` 排序扫描
- ✅ entity-level 字段（owner / lifecycle / related_files）可加在 entity 表上，不污染 knowledge_artifacts
- ✅ `designs.ref_req` 可以做真 FK 指向 `requirements`，为 P3-1 traceability_gate 提供 DB 兜底
- ✅ P0-2.5（decisions/lessons entity 表）按相同形状继续叠
- ❌ Promote 路径要扩 ~30 行（事务包裹 + UPSERT entity）
- ❌ 多两张表 + 两份 CRUD（但跟 knowledge_artifacts 同形，可抽公共 helper）
- ⚠ FK 严格度（`current_artifact_id` 与 `ref_req` 是否 RESTRICT、是否允许 dangling）由 Q3 单独决定
- ⚠ 现有 `knowledge_artifacts` 已有 `entity_id` 行的 backfill（要不要回灌出 entity 行）由 Q4 单独决定

---

## Decision (ADR-lite) [Q3]

**Context**：
Q2=2-A 落定后涉及 3 条潜在 FK 关系：(a) `requirements.current_artifact_id` → `knowledge_artifacts.id` (b) `designs.current_artifact_id` → `knowledge_artifacts.id` (c) `designs.ref_req` → `requirements.id`。已知事实（代码核过）：项目 `PRAGMA foreign_keys = ON` 已在 db.ts:16 全局打开，但**当前 schema 内 0 条 `REFERENCES` 声明**——所有跨表引用（`workflow_runs.project_id` / `artifacts.workflow_run_id` 等）都走"裸 TEXT 列 + 应用层校验"。Q3 要决定 P0-2 这两张新表是否破例引入 FK 作为新惯例，以及破例破到哪。

**Decision**：
采用 **方案 3-B**——混合 FK 严格度：
- `designs.ref_req` 声明强 FK：`TEXT NOT NULL REFERENCES requirements(id) ON DELETE RESTRICT`
- `requirements.current_artifact_id` / `designs.current_artifact_id` **不声明 FK**——裸 `TEXT NOT NULL`
- 引用完整性靠 promote 事务保证：同事务先 INSERT `knowledge_artifacts`、再 UPSERT entity 引用刚生成的 id；任一失败整体回滚（R10/R11）
- 在 `.trellis/spec/api/backend/database-guidelines.md` 补一段约定："产品核心关系（REQ↔DSN traceability）声明 FK；辅助指针（head pointer 指向不可变历史行）走应用层事务"，给后续 P0-2.5 / P3-1 设原则
- 任何 ref_req 写入失败（FK violation）必须报错回滚，不允许 silent drop（R19）

**Consequences**：
- ✅ V2 doc § 3.6 traceability 链路上 DB 兜底——P3-1 verifier traceability_gate 不需自己防御 dangling REQ↔DSN
- ✅ 破例点最小：项目内仅引入 1 条 FK，且这条 FK 守的是产品核心 invariant
- ✅ knowledge_artifacts 是仅追加的不可变历史表，没有删除路径——FK RESTRICT 在这条上守不到任何额外语义，省掉
- ✅ Promote 事务内部天然保证 `current_artifact_id` 指向有效行，`tsc` 也能在 `KnowledgeArtifact.id` 类型上局部兜底
- ✅ Test fixture 删除顺序基本不变（FK 只锁 designs→requirements 这一对）
- ❌ 项目内 FK 约定从此非零→ spec 必须明确说清"哪些算 FK 入门级关系"；后续 reviewer / 新人需要读这条 spec 才不会随手加 FK
- ❌ 端到端测试要新增 2 条 FK 行为验证（AC-6b / AC-6c）
- ⚠ 后续 P0-2.5 加 decisions/lessons/architecture entity 表时，需要按"产品核心关系才上 FK"原则继续判断——预期 ADR 子表的 supersedes_id（决策替代关系）会上 FK，lessons 的 related_files 不上
- ⚠ 跨数据库迁移（如未来想换 PG）时强 FK 是利好，但要注意 SQLite ON DELETE RESTRICT 与 PG 默认 NO ACTION 的语义微差异（SQLite 内 RESTRICT 立即报错、NO ACTION 推到 commit）

---

## Decision (ADR-lite) [Q4]

**Context**：
PR2（`1cbacd4`）建表 + PR3（`1fe383c`）写 entity_id 都是 5/4 当天提交，距 P0-2 上线**最多几小时**。已知事实：
- 项目 `db.ts` 现有 migration 风格是 idempotent ALTER + 不动数据
- 没有任何数据迁移先例（247 条数据迁移检查 = 0）
- PR3 的 max+1 序号逻辑保证：P0-2 上线后下次 promote 同 entity_id 时，`current_version` 自然对齐到 max+1，**不会跳号**

需要决定 P0-2 上线时是否扫一遍 `knowledge_artifacts` 把已有 entity_id 行回灌出 entity 行。

**Decision**：
采用 **方案 4-B**——不 backfill：
- Migration 只 `CREATE TABLE`，不读取也不写入 `knowledge_artifacts`
- P0-2 上线后通过正常 promote 路径自然累积 entity 行
- 已有 `knowledge_artifacts.entity_id` 行原样保留——`latestByEntityId` 兼容查询不变；新 `requirements.byProject` 不会显示这些"前 P0-2"行
- 触发一次 promote 同 entity → 自动创建 entity head，`current_version` 接续 PR3 max+1（不跳号）
- spec / release notes 必须明确这个边界（R23 / R24）

**Consequences**：
- ✅ Migration 最简、跟项目 idempotent ALTER 惯例一致
- ✅ DROP TABLE 回滚零代价；不需要 reverse migration 脚本
- ✅ PR3 早期可能写过的脏 entity_id（自测数据）不污染新结构
- ✅ PR3 的"几乎零真实数据"现状下，4-B 的"丢失"成本接近零
- ✅ 单测 / 端到端测试不需要构造 backfill fixture
- ❌ 升级后短窗内 UI "知识库 > Requirements"列表可能漏显几条历史 entity——但都是测试数据，无业务影响
- ❌ 必须靠 spec / commit message / release notes 显式说明边界，否则下个开发者会以为遗漏
- ⚠ 如果将来需要"prod 真有大量历史数据"的 backfill，要单独起 task（建议命名 P0-2.5 或 P0-2-backfill），不在 P0-2 scope 内
- ⚠ 与 PR3 的 `entity_id` "max+1 序号"算法强耦合——若将来改 entity_id 生成策略（Q5 涉及），必须确认接续语义不被破坏

---

## Decision (ADR-lite) [Q5]

**Context**：
Q2 / R10 / R11 已强制 INSERT knowledge_artifact + UPSERT entity head 在同一 DB 事务内执行——而 runner 没有 DB 句柄、只能走 HTTP，所以这部分必然由 API 端持有。剩下的 step 1-3（frontmatter 抓 entity_id、max+1 fallback、nextVersion + supersede）当前在 PR3 的 runner 端 `promoteAcceptedDraftToKnowledge` 函数里。Q5 决定它们是否一起下沉到 API。

**Decision**：
采用 **方案 5-A**——全部下沉到 API：
- 新增 `POST /knowledge-artifacts/promote` 端点（路由文件 `apps/api/src/routes/knowledge-artifacts.ts`）
- 业务逻辑函数 `promoteDraftInTransaction()` 在 `db.transaction(() => { ... })` 内顺序执行 6 步：(1) regex 抓 entity_id (2) max+1 fallback (3) nextVersion 计算 (4) UPDATE 旧 accepted → superseded (5) INSERT knowledge_artifact (6) UPSERT entity head
- Runner 端 `promoteAcceptedDraftToKnowledge` 收缩为 ~10 行 HTTP 包装，仅保留"调用 + 失败降级 log"
- PromoteDeps 接口从 4 依赖（postKnowledgeArtifact / listByKind / listByEntity / setStatus）简化为 1 依赖（promoteDraft）

**Consequences**：
- ✅ 真单事务（race-free）：多 runner 并发同 kind 由 SQLite 写锁串行化，max+1 不会撞号；hint 路径冲突由 entity 表 `(project_id, id)` UNIQUE 拦截
- ✅ V2 doc 附录 B "Workflow Engine 唯一状态写者"原则严格落实
- ✅ 后续 P0-2.5（decisions / lessons / architecture entity）扩 entity 类时只在 API 侧加 idPrefix 映射；runner 零改动
- ✅ entity_id 算法单测从 runner 包迁到 API 包，更接近"算法在哪里就在哪里测"
- ✅ Runner 测试更轻：mock 层从 4 个依赖减到 1 个
- ❌ PR3 的 ~70 行算法要剪切粘贴到 API（机械迁移，逻辑零变化）
- ❌ Runner → API 一次 HTTP payload 包含完整 markdown body——PR3 已经在 `PromoteDraftInput.text` 字段传过 draft body，体积可控（典型 < 10 KB）
- ⚠ 端点签名 `PromoteRequest` / `PromoteResponse` 是新跨包契约，需要 `packages/shared` 加类型；类型变化要协同更新 runner / api 两侧
- ⚠ HTTP 失败（network / 5xx）时的降级语义保持 PR3 既有：log error、不阻断 acceptance gate

---

## Technical Approach（final）

### 范式拆分（按层 / 文件）

| 层 | 文件 | 改动 |
|---|---|---|
| **shared 类型** | `packages/shared/src/types/knowledge-entity.ts`（新建） | 定义 `RequirementEntity` / `DesignEntity` / `PromoteRequest` / `PromoteResponse` |
| **api: schema** | `apps/api/src/store/db.ts:142` 后 | `CREATE TABLE requirements / designs`，含 R5/R6 列 + R7 UNIQUE + R15 强 FK |
| **api: store** | `apps/api/src/store/store.ts:731` 后 | `requirements` / `designs` CRUD module，模仿 `knowledgeArtifacts`；`upsertHead()` 函数 |
| **api: 业务逻辑** | `apps/api/src/promote.ts`（新建） | `promoteDraftInTransaction(input): PromoteResponse`，6 步算法 |
| **api: route** | `apps/api/src/routes/knowledge-artifacts.ts:55` 之外 | 新增 `POST /knowledge-artifacts/promote` 路由 |
| **runner** | `apps/runner/src/orchestrator.ts:739-810` | `promoteAcceptedDraftToKnowledge` 收缩为 HTTP 包装；`PromoteDeps` 简化为 `{ promoteDraft }` |
| **runner: api-client** | `apps/runner/src/api-client.ts` | 新增 `promoteDraft(req: PromoteRequest)` 方法 |
| **spec 文档** | `.trellis/spec/api/backend/database-guidelines.md` | 加入 R18 / R23 的两条约定 |

### 实现 PR 拆分

| PR | 范围 | 阻塞关系 |
|---|---|---|
| **PR1** | `shared` 类型：`RequirementEntity` / `DesignEntity` / `PromoteRequest` / `PromoteResponse` | — |
| **PR2** | `api/store/db.ts` 加 migration（requirements + designs 表 + FK + UNIQUE）；`store.ts` 新增两张表的 CRUD module；DB 单测 | 依赖 PR1 |
| **PR3** | `api/promote.ts` 实现 `promoteDraftInTransaction()` 6 步事务；单测覆盖 AC-12e/12f/12g | 依赖 PR2 |
| **PR4** | `api/routes/knowledge-artifacts.ts` 加 `POST /promote` 路由 + integration 测试 | 依赖 PR3 |
| **PR5** | `runner/orchestrator.ts` 收缩 promote hook 为 HTTP 包装；`api-client.ts` 加 `promoteDraft()`；runner 端单测调整 | 依赖 PR4 |
| **PR6** | `.trellis/spec/api/backend/database-guidelines.md` 文档更新（R18 / R23 / 升级语义边界）；release notes 草稿 | 任意时序，建议放最后 |

每 PR 独立 commit；PR2-PR5 任何中间环节 main 分支都能跑（旧 runner 走 PR3 的 promote 路径仍工作；entity 表暂时空着不被读）。

### 风险登记

- **R-Risk-1**：API 单事务里如果 INSERT knowledge_artifact 后某条 SQL 失败，bun:sqlite 的 `db.transaction(() => {...})` 必须确保整体 ROLLBACK——单测要显式断言 AC-12f
- **R-Risk-2**：FK 违反 `designs.ref_req` 时 SQLite 报错的具体消息（包含 "FOREIGN KEY constraint failed"）需要在错误处理里识别并转译为业务错误码
- **R-Risk-3**：Runner 端调用契约变化但兼容性靠 PR3 的 `PromoteDraftInput` 接口名保留（参数填充逻辑变了但接口名 / 调用点不变）
- **R-Risk-4**：Migration 加 FK 在已有数据上的兼容性——R20 已锁"不动现有 knowledge_artifacts"，FK 只在 designs / requirements 内部，不会与现有 schema 冲突
