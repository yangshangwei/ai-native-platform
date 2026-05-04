# V2 P1-1：双写架构（Dual-Write Pipeline，DB + 文件）

## Goal

把 V2 § 3.1 的"文件即真相源、DB 是索引/关系镜像"原则**第一次落地**。每次 promote requirement / design entity 时，**先**写出 markdown 文件到项目 git 仓库（`<projectRoot>/codestable/<kind-plural>/<entity-id>.md`），**后**提交 DB 事务；DB 提交失败 → best-effort 删除刚写的文件。文件 frontmatter 强约束 `entity_id` / `status` / `version` / `updated_at`，body 由 promote 写入的 markdown 原文承载。本 task 只做**写端**；读端 + git commit 自动化 + 反向同步 + 其他 8 类 entity 的覆盖均推到后续 task。

**V2 设计根据**：[`docs/2026-05-04-ai-native-platform-v2-design-notes.md`](../../../docs/2026-05-04-ai-native-platform-v2-design-notes.md) § 3.1 "双写架构（DB + 文件）" + 附录 A。

## What I already know

### 现有"文件"在系统里的真实位置（实地查过）

| 类别 | 物理路径 | 是否在项目 git 里 | 是否真相源候选 |
|---|---|---|---|
| Per-run artifacts | `~/.ai-native/artifacts/{runId}/{stage}/{name}` | ❌ runner-local | ❌（一次性证据） |
| Knowledge candidate (V1 残留) | `~/.ai-native/projects/{projectId}/knowledge/{runId}.md` | ❌ runner-local | ❌（已被 V2 P0-1 PR3 promote 路径替代） |
| Knowledge entities (REQ/DSN entity 行) | **DB 是唯一存储；`uri` 字段指 runner-local 临时 draft** | ❌ | ❌（目前 DB 即真相源） |
| 项目源码 / `pom.xml` / 测试代码 | `<projects.local_path>/...` git 仓库 | ✅ | — |

**结论**：项目 git 仓库目前**完全没有** `codestable/` / `docs/requirements/` 之类的 entity 文件结构。V2 § 3.1 的双写**完全是 greenfield**——本 task 从零设计文件布局 + 写入路径。

### V2 § 3.1 给的方向（已确立的设计原则）

- 文件是 **source of truth**，DB 是**索引 + 关系镜像**
- 写入流程：agent 写文件 → webhook/git commit → 同步进 DB
- 读取流程：UI 优先读 DB（快、可关联），点击穿透时才回退到文件原文
- 冲突解决：以文件为准，DB 重建（DB schema 演进时也走重建路径）

仓库布局约束（V2 doc 给的硬条款）：
- 路径稳定（不能动 schema 就改路径）
- 一类一目录（不要把 design 和 architecture 塞一起）
- frontmatter 强约束（编号、状态、关系字段必填）

### V2 P0-2 留下的接口（PR1-PR6 已落地）

可被本 task 复用的 hook 点：
- `apps/api/src/promote.ts:promoteDraftInTransaction()` — DB 单写当前完整实现，加文件双写最自然的点
- `apps/runner/src/orchestrator.ts:promoteAcceptedDraftToKnowledge()` — runner 触发 promote 入口（PR5 已收缩为 HTTP 包装，本 task 不动）
- `projects.local_path` 已在 DB；API 可通过 `store.projects.get(projectId).localPath` 读到（已实地确认 store.ts:88-108）
- `knowledge_artifacts.uri` 字段当前指 runner 临时 draft；改造后**新行**指项目 git 内的 entity 文件（旧行兼容性保留）
- `requirements.current_artifact_id` / `designs.current_artifact_id` 指向 head 行的 `knowledge_artifacts.id`，间接也就指向了文件路径

## Assumptions (confirmed)

- A1. SQLite + bun:sqlite 不换；现有 DB schema 零改动
- A2. 文件写入根目录是 `<projectRoot>/codestable/`（详见 ADR Q2）
- A3. 本 task 只做**写端**；读端、git commit 自动化、反向同步均不做
- A4. 文件写入由 **API 端**（同 promote 事务上下文）执行——API 与 runner 在同一 host，可直接访问 `local_path`（MVP 阶段）
- A5. **运行中的 worktree 与 promote 写文件互不干扰**：promote 写的是项目主 working tree (`projects.local_path`)，不是 runner 的 per-run worktree
- A6. P0-2 已落地的 entity 表（requirements / designs）是双写"DB 端"的天然落点

## Open Questions（全部已拍板）

> 全部 6 道 Q 在 brainstorm 第一轮一次性按推荐拍板（用户授权"按照推荐的来"）。

### ✅ Q1（已拍板）：scope
**决策**：方案 **α** — 仅 `requirement` + `design` 两类 entity，单向 DB→文件。详见 ADR Q1。

### ✅ Q2（已拍板）：文件物理布局
**决策**：`<projectRoot>/codestable/<kind-plural>/<entity-id>.md`，即 `codestable/requirements/REQ-001.md` / `codestable/designs/DSN-001.md`。详见 ADR Q2。

### ✅ Q3（已拍板）：写入触发方式
**决策**：在 `promoteDraftInTransaction` 中**先写文件、后 DB 事务**；DB 事务失败时 best-effort 删文件回滚。详见 ADR Q3。

### ✅ Q4（已拍板）：git commit 策略
**决策**：**只写文件、不自动 commit**。文件落进项目 working tree，用户决定何时 commit。git 自动化推到 P3-3 acceptance 回写提案。详见 ADR Q4。

### ✅ Q5（已拍板）：文件 ↔ DB 漂移检测
**决策**：MVP 内**不做**任何主动漂移扫描。日志层面记录 file write 失败/成功。反向同步（rebuild from files）作为后续 task。详见 ADR Q5。

### ✅ Q6（已拍板）：frontmatter schema 严格度
**决策**：**typed core + freeform extension**——core 字段（entity_id / status / version / updated_at / kind）由 API 端模板渲染、强约束；body 紧接 frontmatter 之后是从 `draftText` 复制的 markdown 原文（不解析、不重写）。`design` entity 额外加 `ref_req`。详见 ADR Q6。

## Requirements

### 兼容性
- R1. P0-1 / P0-2 落地的 `artifacts` / `knowledge_artifacts` / `requirements` / `designs` 表 schema **零改动**
- R2. PR3 单事务原子性保留（步骤 1-6 仍然是单 `db.transaction`）
- R3. 现有 296 条测试 + typecheck 全清，零回归

### 文件布局（Q2 派生）
- R4. 写入根目录：`<project.localPath>/codestable/`
- R5. 一类一目录：`codestable/requirements/` / `codestable/designs/`
- R6. 文件名：`<entity-id>.md`（如 `REQ-001.md` / `DSN-007.md`）
- R7. 缺失目录由 promote 路径**自动 mkdir -p**（首次 promote 时创建 `codestable/<kind-plural>/`）

### 写入触发（Q3 派生）
- R8. 文件写入位置：`apps/api/src/promote.ts:promoteDraftInTransaction()` 内部，作为新增的 step 0（在事务 INSERT 之前）+ step 7 finalize（事务 commit 之后）
- R9. **写入序列**：
  1. (Step 0, 事务外) 解析 `draftText`，渲染 frontmatter；写出到 `<localPath>/codestable/<kind-plural>/<entity-id>.md.tmp.<rand>`
  2. (Steps 1-6, 事务内) 现有 6 步 DB 写入（不变）
  3. (Step 7, 事务后) `rename` 临时文件到目标 `<entity-id>.md`（POSIX rename 是原子的）
- R10. **失败回滚**：
  - 事务内 DB 写入失败 → 事务自动回滚 + 删除 step 0 的 .tmp 临时文件（best-effort，失败仅记日志）
  - Step 7 rename 失败 → 已 commit 的 DB 状态保留，记 error log；不再尝试回滚 DB（避免引入"补偿事务"复杂度）
- R11. Step 7 失败的运营兜底：log 中记录 `[promote] file rename failed for <entity-id>: <reason> — DB row id=<knArtId> may diverge from filesystem`，留给后续运维 / Q5 反向同步任务

### git 行为（Q4 派生）
- R12. promote 路径**不调用 git**——不 add、不 commit、不 push
- R13. 项目 working tree 在 promote 后会处于 dirty 状态（多了 `codestable/` 下的新/改文件）；这是预期的，由用户决定何时 commit
- R14. spec 文档要明确说"双写在 working tree 留下未提交文件是正常状态"

### frontmatter & body（Q6 派生）
- R15. **Frontmatter 必填字段**（核心 typed schema，所有 kind 都有）：
  ```yaml
  entity_id: REQ-001          # 项目内唯一编号
  kind: requirement           # 'requirement' | 'design'
  status: accepted            # 'draft' | 'accepted' | 'archived'
  version: 1                  # 整数，与 DB current_version 一致
  updated_at: 2026-05-04T13:00:00Z
  knowledge_artifact_id: kart-abc123  # 指向当前 head 的 knowledge_artifacts 行
  ```
- R16. `design` entity **额外**强制 `ref_req`：
  ```yaml
  ref_req: REQ-042
  ```
- R17. body：在 `---` frontmatter 块之后空一行，紧跟 `draftText` 的**原始内容**（不解析、不重写、不去掉用户原有 frontmatter——直接 append 整段）
- R18. 如果 draftText 自身就以 `---` 开头（用户已有 frontmatter），双写**不解析也不合并**——核心 frontmatter 在前，原文保持原样紧跟（接受可能"两段 frontmatter"的视觉副作用，对 markdown 渲染无影响）
- R19. 渲染入口：新增 `apps/api/src/promote-file.ts` 模块，导出 `renderEntityMarkdown(input): string` + `writeEntityFile(input): Promise<void>`，纯函数 + IO 分层

### 安全与契约
- R20. 写入路径必须在 `<project.localPath>` 之内——拒绝 path traversal（`entity_id` 必须匹配 `^(REQ|DSN)-\d{1,6}$` 严格 regex）
- R21. 跨平台：使用 `node:path` `join`，不假设 `/`；测试覆盖 macOS（CI 实际运行环境）
- R22. 并发安全：同一 entity_id 在两 promote 间隔写入，依赖 SQLite 写锁串行化（Q3=PR3 已覆盖）；文件层面不加额外锁（rename 是 POSIX 原子操作，最后写赢）

## Acceptance Criteria

### 兼容性
- [x] AC-1. 现有 296 条测试全过，typecheck 全 PASS
- [x] AC-2. PR3 单事务原子性测试（promote.test.ts AC-12f）仍然通过
- [x] AC-3. PR4 路由错误映射（promote-route.test.ts）仍然通过

### 文件写入
- [x] AC-4. `requirement_draft` promote 后，`<localPath>/codestable/requirements/REQ-XXX.md` 存在
- [x] AC-5. `design_doc` promote 后，`<localPath>/codestable/designs/DSN-XXX.md` 存在
- [x] AC-6. 文件 frontmatter 至少包含 R15 列出的 5 个核心字段；`design` 额外有 `ref_req`（R16）
- [x] AC-7. body 紧跟 frontmatter，包含 `draftText` 原文（按 R17 / R18）

### 单事务原子性（Q3 派生）
- [x] AC-8. DB 事务失败 → 临时文件被删除（best-effort 日志可见，不残留 .tmp 文件）
- [x] AC-9. 重复 promote 同一 entity（v1 → v2）→ 同一文件被原子替换（rename），版本号在 frontmatter `version` 中前进
- [x] AC-10. Step 7 rename 模拟失败（mock fs.rename throw）→ DB 状态已 commit、log 包含 file rename failed 警告，AC 流程不被打破

### path safety / 跨平台
- [x] AC-11. entity_id 含可疑字符（如 `../REQ-001`）的请求 → 在 promote 入口被 R20 regex 拒绝（不进事务）
- [x] AC-12. 文件路径用 `node:path` join 构造，单测覆盖

### 行为副作用
- [x] AC-13. promote 路径**绝不调用** git CLI / `simple-git` / 任何 git lib（grep 验证）
- [x] AC-14. spec 文档（database-guidelines.md 或新增 dual-write 一节）补充双写约定 + 用户须知"working tree 留下未提交文件"

### 工程
- [x] AC-15. lint 通过；`npm test` green
- [x] AC-16. 新增 ≥ 8 条单测（render 纯函数 ≥ 4 + writeEntityFile IO ≥ 2 + 集成路径 ≥ 2）

## Definition of Done

- 测试：单元 + 端到端
- 类型：tsc 全清
- Lint：通过
- 兼容：旧 feature run 端到端跑通；entity 表 + promote 行为不变
- 文档：spec 加一节"双写架构落地约定"（FK 章节相同 doc，往后追加）
- 不破坏 P0-1 / P0-2 既有 PR 行为

## Out of Scope (explicit)

- ❌ **读路径双写**（UI 优先读 DB → 文件回退）—— V2 P3-2
- ❌ Architecture / Roadmap / Decision / Lesson / Pattern / Explore / DevGuide / ApiDoc 8 类的双写—— P1-1.5 / P0-2.5
- ❌ Web UI 编辑文件功能 —— P3-2
- ❌ git auto-commit / auto-push —— P3-3 acceptance 回写提案
- ❌ 文件 → DB 反向同步 / rebuild —— 后续 task
- ❌ 主动漂移扫描（cron / startup scan）—— 后续 task
- ❌ frontmatter 严格 JSON Schema 校验（YAML 由 frontmatter-yaml 库直接渲染即可，不引第三方 schema 校验）
- ❌ V1 旧数据（`knowledge_candidate` / `project_profile`）迁移到新文件结构
- ❌ 跨 platform Windows 路径处理（项目当前本机开发使用 macOS；Windows shim 是另外的 task）

## Technical Approach

### 范式拆分（按层 / 文件）

| 层 | 文件 | 改动 |
|---|---|---|
| **shared 类型** | `packages/shared/src/types/dual-write.ts`（新建）| 定义 `RenderEntityInput` / `WriteEntityFileInput` / `EntityFileFrontmatter` 接口 |
| **api: 渲染** | `apps/api/src/promote-file.ts`（新建）| `renderEntityMarkdown(input)` 纯函数（frontmatter + body） |
| **api: IO** | `apps/api/src/promote-file.ts` | `writeEntityFile({ projectLocalPath, entityKind, entityId, contents }): Promise<{ tmpPath, finalize() }>` —— 返回一个对象，调用方在事务 commit 后 `finalize()` rename，事务回滚则用 `cleanup()` 删 tmp |
| **api: 集成** | `apps/api/src/promote.ts` | promoteDraftInTransaction 加 step 0（写 tmp）/ step 7（finalize OR cleanup） |
| **api: 错误处理** | 同上 | rename 失败时记 error log，DB 不回滚 |
| **spec 文档** | `.trellis/spec/api/backend/database-guidelines.md` | 追加"双写架构落地约定"一节 |
| **测试** | `apps/api/test/promote-file.test.ts` + 扩展 `promote.test.ts` | 单测 ≥ 8 条 |

### 实现 PR 拆分

| PR | 范围 | 阻塞关系 |
|---|---|---|
| **PR1** | shared 类型 + `apps/api/src/promote-file.ts` 纯函数（renderEntityMarkdown 模板）+ 渲染单测 | — |
| **PR2** | `promote-file.ts` IO 层（writeEntityFile / cleanup / finalize）+ 跨平台 path 测试 + path safety regex | 依赖 PR1 |
| **PR3** | `promote.ts` 集成 step 0 / step 7；事务回滚 → cleanup tmp；端到端测试 | 依赖 PR2 |
| **PR4** | spec 文档更新 + AC 收尾；release notes 草稿 | 任意时序，建议放最后 |

每 PR 独立 commit；PR1-PR3 之间 main 分支都能跑（PR1+2 落地后文件函数尚未被 promote 调用，纯加法）。

### 关键代码草图

```ts
// apps/api/src/promote-file.ts

export interface EntityFileFrontmatter {
  entity_id: string;
  kind: 'requirement' | 'design';
  status: 'accepted';
  version: number;
  updated_at: string;
  knowledge_artifact_id: string;
  ref_req?: string; // design only
}

export function renderEntityMarkdown(
  fm: EntityFileFrontmatter,
  body: string,
): string { /* YAML frontmatter + '---\n\n' + body */ }

export interface PendingFileWrite {
  finalize: () => Promise<void>;  // rename tmp → final
  cleanup: () => Promise<void>;   // unlink tmp
}

export async function stageEntityFile(args: {
  projectLocalPath: string;
  entityKind: 'requirement' | 'design';
  entityId: string;
  contents: string;
}): Promise<PendingFileWrite> { /* mkdir -p + write tmp + return handles */ }
```

### promote.ts 接入点（伪代码）

```ts
// step 0: stage file BEFORE the DB transaction
const pending = await stageEntityFile({
  projectLocalPath: project.localPath,
  entityKind, entityId: pendingEntityId, contents: rendered
});

let response!: PromoteResponse;
try {
  const txn = db.transaction(() => { /* steps 1-6 unchanged */ });
  txn();
  // step 7: finalize file after DB commit
  await pending.finalize();
} catch (err) {
  await pending.cleanup().catch(() => {/* log only */});
  throw err;
}
return response;
```

注意：entityId 的"max+1 fallback"目前在 step 2（事务内）。stageEntityFile 需要 entityId 提前知道——所以 step 0 必须把"frontmatter 抓取 + max+1 fallback"前移到事务外。这就出现 race window：两并发 promote 在事务外都拿到同一个 max+1 = N，都写 tmp 文件，进事务时第二个被 (project_id, id) 复合 PK 拒。该路径下 cleanup 会清掉胜出方的对手 tmp 文件——OK。

具体：把 PR3 的 entity_id 解析步骤分裂——
- 事务外做 frontmatter 提取（pure parse）+ 临时性 max+1（best-effort guess）
- 事务内**重新**做 max+1（确权）；如果 entity_id 在 race 中被另一个 promote 占用，事务内重算的 entity_id 与事务外 stage 的 tmp 文件名**不一致**——这是边界 case

### Race window 处理（重要！）

为避免 race，stage file 时**只写 tmp 文件、不带最终名**——tmp 文件名用 `<rand>.tmp` 或 `<entityId-guess>.<rand>.tmp`。**只在 step 7 finalize 时**才知道事务内确定的最终 entityId，rename 到 `<finalEntityId>.md`。

更新代码草图：
```ts
// stageEntityFile returns { tmpPath, finalize(finalEntityId) }
const pending = await stageEntityFile({
  projectLocalPath,
  contents: rendered  // body unchanged across race; frontmatter 'entity_id' 字段在 finalize 时改写
});

const txn = db.transaction(() => { /* steps 1-6, decides final entityId */ });
txn();

await pending.finalize(finalEntityId, finalKnowledgeArtifactId);
// finalize 内部: re-render frontmatter with final IDs, write to <finalEntityId>.md, unlink tmp
```

→ 见 R-Risk-2 风险登记。

## Risk Register

- **R-Risk-1**：DB 提交后 rename 失败（disk full / 权限 / 中途断电）—— 接受这个边界 case，记 log 不回滚 DB。后续 task 实现"漂移扫描 + 补写文件"的 cron 任务（Q5 推后）
- **R-Risk-2**：并发 promote 同 kind 时事务外 entity_id guess 与事务内最终值不一致——通过 stage 写 tmp、finalize 时再 rename 到 `<finalId>.md` 避开（草图已更新）
- **R-Risk-3**：`projects.local_path` 不存在 / 不可写——`stageEntityFile` 第一步 `mkdir -p` 时报错；error 走 promote 的 try/catch；DB 事务不会启动（pre-tx fail-fast）
- **R-Risk-4**：用户在 promote 期间手动 `git checkout` 主分支——文件被覆盖到旧版本，但 DB 已 commit 新 version；下次 promote 时 frontmatter / body 重新覆盖回来（最后写赢）。可接受
- **R-Risk-5**：runner-localPath 与 API 不在同一 host 时（未来云服务部署）—— 当前 MVP 不支持；A4 已声明同 host

---

## Decision (ADR-lite) [Q1]

**Context**：V2 § 3.1 要求所有产物双写。但项目里**完全没有**任何 entity 文件结构、写入路径、或 frontmatter 模板的先例。一次性覆盖 V2 § 3.4 的 10 类知识 entity 需要先把另外 8 类的 entity 表建好（P0-2.5），工程量 3 倍以上。

**Decision**：
采用 **scope α**——仅 `requirement` + `design` 两类 entity，单向 DB→文件：
- 与 P0-2 已落地的 `requirements` + `designs` 两张 entity 表 1:1 对齐
- 触发点：`promoteDraftInTransaction()` 加文件写入 step
- 反向同步（手改文件→重建 DB）推到后续 task

**Consequences**：
- ✅ MVP 直接验证 V2 § 3.1 在最关键的 REQ↔DSN 链路上跑通
- ✅ 与 P0-2 PR3 的事务结构 1:1 对齐，加一个 hook 就行
- ✅ 工程量最小、回归风险最低
- ✅ 跟项目"先 MVP 再扩"的纪律一致
- ❌ Architecture / Roadmap / Decision / Lesson 等 8 类继续留在 DB 单写——等后续 task 补
- ⚠ 反向同步功能延迟意味着用户手改 frontmatter 暂时**不会被识别**，DB 仍是该版本的最终权威

---

## Decision (ADR-lite) [Q2]

**Context**：V2 § 3.1 要求"路径稳定 + 一类一目录 + frontmatter 强约束"，但具体目录命名留给"实施期再定"。三个候选：`codestable/`（CodeStable 启发）、`docs/`（标准文档目录）、`.ai-native/`（隐藏目录）。

**Decision**：
采用 **`<projectRoot>/codestable/<kind-plural>/<entity-id>.md`**：
- `codestable/requirements/REQ-001.md`
- `codestable/designs/DSN-001.md`
- 一类一目录、entity_id 当文件名

**Consequences**：
- ✅ 与 V2 doc 引用的 CodeStable 设计哲学命名一致，可识别度高
- ✅ 与项目已有 `docs/`（人写文档）天然分离——任何看到 `codestable/` 的人都知道这是 AI 维护的实体追踪
- ✅ git diff / IDE 文件树清晰可见，不"隐藏"管理状态
- ✅ kind-plural（requirements / designs）与 `KnowledgeArtifactKind` 单数枚举一一对应，规则可机器派生
- ❌ 给项目根目录引入新顶级目录"codestable"，可能与某些项目既有命名冲突——但概率极低
- ⚠ 后续 P1-1.5 / P0-2.5 把另外 8 类加进来时，每类都在 `codestable/` 下加一个子目录（architecture/, roadmaps/, decisions/, lessons/, ...）

---

## Decision (ADR-lite) [Q3]

**Context**：双写如何与 PR3 的 `db.transaction(...)` 集成。bun:sqlite 事务**不能**包含文件系统操作（事务体是同步的，无法 await fs.rename）。需要决定 file write 与 DB commit 的相对时序，以及失败时怎么收尾。

**Decision**：
**Stage-then-Finalize**——
- **Step 0（事务外）**：渲染 markdown 内容、写到 `<localPath>/codestable/<kind-plural>/<rand>.tmp`
- **Steps 1-6（事务内）**：PR3 既有 6 步 DB 写入（不变）
- **Step 7（事务后）**：rename tmp 文件到 `<finalEntityId>.md`（POSIX rename 原子）
- **DB 失败回滚**：事务自动 rollback；catch 块 best-effort `unlink tmp`，失败仅记日志
- **Step 7 失败**：DB 已 commit，记 error log，不再尝试反向回滚 DB（避免引入复杂的补偿事务）

**Consequences**：
- ✅ DB 仍然是单事务原子（PR3 AC-12f 测试不动）
- ✅ 文件作为真相源："文件存在 = 该 promote 已成功"语义干净
- ✅ DB 失败 → 无 .tmp 残留（best-effort）
- ✅ Race window 通过 tmp 文件名随机化 + 事务内确权 entity_id 化解（草图见 Technical Approach）
- ❌ Step 7 rename 失败的 corner case 留下 DB / FS 不一致——需要后续运维（漂移扫描）补
- ❌ 比"全在事务内"代码上稍复杂（多两段 try/catch 包裹）
- ⚠ 文件 rename 在 macOS 上是原子的（atomic on POSIX）；Windows 的 rename 在文件已存在时**不**原子，需要先 unlink target——本 MVP A4 只支持 macOS，跨 Windows 推后

---

## Decision (ADR-lite) [Q4]

**Context**：V2 § 3.1 提到"agent 写文件 → webhook/git commit → 同步进 DB"。要不要让 promote 路径自动 git commit？

**Decision**：
**只写文件、不自动 commit**：
- promote 路径**绝不**调用 git
- 文件落进 `<projects.local_path>` 的 working tree，处于 dirty 状态
- 用户决定何时 `git add codestable/ && git commit`
- spec 文档明确说明"working tree 留下未提交文件是正常状态"
- 后续 P3-3 acceptance 回写提案任务再做"AI 提交一组 entity 变更" 自动化

**Consequences**：
- ✅ 用户对自己仓库 git 历史保持完全控制
- ✅ 降低实现复杂度——不需要处理 git config、签名、远程 push 失败等
- ✅ 不会与运行中的 feature 分支抢 commit
- ✅ 日常工作流：用户在自己的 review 节点把 codestable/ 的变更和代码改动一起 commit，符合 "PR 包含 entity 文件 + 实现代码" 的 codestable 哲学
- ❌ 用户如果忘了 commit，DB 与文件可能短暂"不在 git history"——但文件本身是 SoT，DB 仍能重建
- ❌ `/trellis:finish-work` 的"working tree clean"检查可能因 `codestable/` 变化而 fail——但 trellis 已豁免 `.trellis/` 路径，类似豁免可加给 `codestable/`（如有必要）
- ⚠ 后续 P3-3 实现自动 commit 时要做选项化（per-promote / batched / off）

---

## Decision (ADR-lite) [Q5]

**Context**：双写后，文件和 DB 可能漂移（用户手改文件、外部 git rebase、磁盘损坏等）。是否在 MVP 中加主动漂移扫描？

**Decision**：
**MVP 不做漂移扫描**——
- 不加 startup scan / cron / git hook
- file write 失败时仅记 error log（R10）
- 反向同步（rebuild DB from files）作为独立后续 task

**Consequences**：
- ✅ MVP scope 控制
- ✅ V2 § 3.1 的"以文件为准、DB 重建"原则可在后续 task 单独验证
- ❌ 漂移真发生时只能靠日志事后追溯
- ❌ 用户手改 frontmatter 不会立即生效（DB 仍按 promote 时写的值）
- ⚠ 后续后续 task 入口建议：`task.py rebuild-codestable-db <project>`（一次性命令）

---

## Decision (ADR-lite) [Q6]

**Context**：frontmatter 严格度有三档——freeform YAML / typed core + freeform extension / 严格 JSON Schema 校验。

**Decision**：
**Typed core + freeform extension**（与 V2 P0-1 Q4 一致）：
- 5 个核心字段必填、由 API 端模板渲染：`entity_id` / `kind` / `status` / `version` / `updated_at` / `knowledge_artifact_id`（第 6 个 = 6 个字段）
- design 额外强制 `ref_req`
- body 紧跟 frontmatter，是 `draftText` 原文（不解析、不重写、不合并用户原有 frontmatter）
- 不引第三方 schema 校验库（YAML 由内置 stringify 渲染）

**Consequences**：
- ✅ 必填字段在编译期 + API 渲染端被强约束
- ✅ body 保留 AI 写的原文，不会"丢内容"
- ✅ 后续 verifier (P3-1) 可在 typed core 上做 traceability_gate
- ❌ 用户原本 draftText 里如果已经有 `---` frontmatter，文件会出现"两段 frontmatter"——视觉副作用但 markdown 渲染不破
- ⚠ 后续 P3-1 verifier 如果要强 schema 校验，再叠 JSON Schema / Zod 即可

---

## 后续依赖解锁

P1-1 完成后能启动：
- **P1-1.5 / P0-2.5**：把 architecture / roadmap / decision / lesson / ... 8 类 entity 也加进 codestable/
- **P3-2** 知识库视图（Web UI 点 REQ-001 → 跳到 `codestable/requirements/REQ-001.md` 文件原文）
- **P3-1** traceability_gate（基于 file frontmatter + DB 联合校验 REQ↔DSN 关联）
- **P3-3** acceptance 回写提案 / git auto-commit
- 编号穿透浏览（P4-2）
