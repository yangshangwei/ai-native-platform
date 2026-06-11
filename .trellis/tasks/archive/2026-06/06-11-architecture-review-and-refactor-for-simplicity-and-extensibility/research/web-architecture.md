# Research: apps/web 架构分析（为简洁性/可扩展性重构提供依据）

- **Query**: 从架构角度分析 apps/web（无框架 TypeScript SPA），为"纯搬移、不改逻辑"的拆分重构提供依据
- **Scope**: internal
- **Date**: 2026-06-11

## 0. 总览

| 文件 | 行数 | 性质 | 测试 |
|---|---|---|---|
| `apps/web/src/main.ts` | 7396 | DOM + 状态 + fetch + SSE + 路由，全部混在一起 | **零测试** |
| `apps/web/src/projection.ts` | 922 | 纯函数：API DTO → 视图模型/解析 | `test/projection.test.ts`、`sidecar-projection.test.ts`、`structured-projection.test.ts` |
| `apps/web/src/settings-projection.ts` | 308 | 纯函数：设置页视图模型（文件头注释明示 "No DOM access, no global state"） | `test/settings-projection.test.ts` |
| `apps/web/src/stream-rendering.ts` | 353 | 纯函数：SSE 事件 → 显示行/通道缓存操作 | `test/stream-rendering.test.ts` |
| `apps/web/src/coordinator-clarification.ts` | 179 | 纯函数：澄清问题文本解析/回复拼装 | `test/coordinator-clarification.test.ts` |
| `apps/web/serve.ts` | 110 | Bun 静态 + /api 代理 + 按需 `Bun.build` 打包 .ts | `test/serve.test.ts` |
| `apps/web/index.html` | 764 | 入口 + 750 行内联 CSS（7–758），`<script type="module" src="/src/main.ts">`（762） |  |

构建方式（`apps/web/package.json`）：无构建产物。`dev = bun run serve.ts`；`typecheck = tsc -p tsconfig.json --noEmit`。serve.ts 对每个被请求的 `.ts` 现场 `Bun.build({ target:'browser' })`（serve.ts:28–43、93–97），目的是解析 `@ainp/shared` workspace 依赖。测试由仓库根 `bun x --bun vitest run` 跑（根 package.json:20）。

**关键事实：测试只 import 五个已拆出的纯模块 + serve.ts，`main.ts` 没有任何测试。** 因此拆分策略必须是"纯搬移、不改逻辑"，安全网 = typecheck + 既有纯模块测试 + 手动冒烟。

## 1. main.ts 职责地图（行段 → 职责 → 依赖的全局状态）

| 行段 | 职责 | 依赖的全局可变状态 |
|---|---|---|
| 1–52 | import 五个本地模块 + `@ainp/shared` | — |
| 54–348 | 类型/DTO 定义（Page、StatusKind、ProjectDto、RunnerDto、WorkflowRequestDto、ContextGovernanceDto、ConfigEntryDto 等约 30 个 interface/type） | —（纯类型） |
| 350–420 | **全局可变状态声明区**（见 §2） | 本体 |
| 422–429 | `api()` fetch 封装 | 无（仅 API_BASE 常量） |
| 431–505 | DOM 工具：`el`/`icon`/`clear`/`fmtTime`/`shortId`/`pill`/`metric` | 无 |
| 506–777 | 领域文案 helper（`requestTypeLabel`/`reviewGateCopy`/`gateDisplayLabel`…）+ 状态选择器（`selectedProject`/`latestRunner`/`activeTaskRequest`/`agentBackend*`） | `data`、`activeRunId`、`activeTaskRequestId`、`agentBackendPreflight` |
| 778–803 | hash 路由：`setHash`/`parseHash` | `activePage`、`activeRunId`、`activeTaskRequestId` |
| 805–961 | 数据加载层：`loadData`/`loadRunDetail`/`ensureContextGovernance`/`primeArtifactPreviews`/`ensureCommandLogs`/`ensureArtifactContent`/`loadKnowledgeArtifacts` | `data`、`lastError`、`projectsLoadError`、`loadingDetailFor`、各 cache Map |
| 963–1097 | `render()` 根重建 + **渲染稳定性机制**：scroll/details/焦点 capture-restore、IME 推迟 | `scrollPositionState`、`viewportScrollPosition`、`detailsOpenState`、`coordinatorReplyComposing`、`knowledgeEditComposing`、`isReplacingAppRootForRender` |
| 1099–1357 | 外壳：`renderShell`/`renderSidebar`/`renderTopbar`/页面分发 `renderCurrentPage`（1333 switch on `activePage`） | `activePage`、`data`、`lastError` |
| 1359–1695 | **工作台页**（workbench）：行动面板、概览、任务列表、环境面板 | `data`、`activeTaskRequestId` |
| 1696–3370 | **任务详情页**（最大块）：hero、lifecycle、stage panels、context governance、文档/实现/构建/验收面板、审批面板、证据、artifact 内联查看器、重试动作、agent stream 嵌板、`promptRejectReason` 弹窗 | `data.activeDetail`、`artifactContent`、`openArtifactViewers`、`commandLogs`、`contextGovernanceByRun`、`approvalInFlight`、`retryInFlight`(2631，声明散落在文件中部)、stream 状态 |
| 3372–4232 | **项目页**：onboarding 表单、source 检测、本地目录选择器、auth 字段、project card、删除/归档/编辑/分支刷新、agent backend preflight | `projectSourceForm`、`localDirectoryPicker`、`projectActionInFlight`、`projectBranchRefreshInFlight`、`agentBackendPreflight(+InFlight)`、`lastError` |
| 4233–4881 | **新建任务页**：`renderNewTaskPage`（4333–4805，**单函数 472 行**）、`submitWorkflowRequest`、`ensureProjectAgentBackendReady` | `newTaskFormDraft`、`newTaskTitleFocus`、`projectsLoadError`、`data` |
| 4882–5530 | **Coordinator 会话式澄清**（Phase B）：chat 状态、IME composition 处理、轮询、问题卡片、选项按钮、stream 订阅 | `coordinatorChats`、`coordinatorPolling`、`coordinatorReplyDrafts`、`coordinatorOptionSelections`、`coordinatorAutoReplyBlocks`、`coordinatorReplyFocus/Composing/RenderDeferred` |
| 5532–5746 | **报告页**：tabs、overview、行渲染、活动详情 | `reportsActiveView`、`data` |
| 5748–6269 | **知识页**：建议项、编辑器（含 IME）、artifact 卡片、四个子视图 | `knowledgeArtifactsState`、`knowledgeDecisions/Edits/Editing/EditDrafts`、`knowledgeActiveView`、`knowledgeEditComposing/RenderDeferred` |
| 6271–6911 | **设置页**（Runtime Config）：加载/保存/重置 override、历史、编辑器渲染 | `settingsConfig`（6316，自包含） |
| 6913–7047 | **mutation 动作**：`submitApproval`/`submitAcceptanceDecision`/`submitRequirementAction`/`submitKnowledgeAction` | `approvalInFlight`、`approvalLastSubmittedAt`、`lastError` |
| 7049–7368 | **SSE agent stream 控制器**：EventSource 生命周期（`attachStream` 7297）、事件缓存、视图模型、原地 DOM patch（`refreshStreamViewsForChannel` 7250 不走全量 render） | `streamES`、`streamChannel`、`expandedStreamRunId`、`streamEventsByChannel`、`streamConnection` |
| 7370–7396 | **bootstrap**：hashchange/beforeunload/keydown 监听、`parseHash()`、首次 `loadData`、**全局 3 秒 `setInterval` 轮询**（7388–7396） | 几乎全部 |

## 2. 全局可变状态清单（拆分的最大约束）

集中声明区（main.ts:350–420）+ 三处散落声明（2631、4904–4964、6316、7064–7073）。

**服务器数据（单一来源）**
- `data: AppData`（350–358）：health/projects/runners/requests/runs/activeDetail/runnerControl —— 被所有页面读取，是最大的横切依赖

**路由/导航**
- `activePage`(360)、`activeRunId`(361)、`activeTaskRequestId`(362) —— `let`，被 parseHash/setHash/各页面写

**加载/错误**
- `loadingDetailFor`(363)、`runnerStartInFlight`(364)、`lastError`(365)、`projectsLoadError`(366)

**任务详情缓存**：`artifactContent`(367)、`openArtifactViewers`(368)、`commandLogs`(372)、`contextGovernanceByRun`(373)、`contextGovernanceInFlight`(374)、`detailsOpenState`(375)

**渲染稳定性（自包含，只被 963–1097 块使用）**：`scrollPositionState`(369)、`viewportScrollPosition`(371)、`isReplacingAppRootForRender`(4952)

**知识页**：`knowledgeArtifactsState`(376)、`knowledgeDecisions`(383)、`knowledgeEdits`(384)、`knowledgeEditing`(385)、`knowledgeEditDrafts`(386)、`knowledgeActiveView`(387)、`knowledgeEditComposing`(388)、`knowledgeEditRenderDeferred`(389)

**报告页**：`reportsActiveView`(390)

**审批/重试**：`approvalInFlight`(391)、`approvalLastSubmittedAt`(392)、`retryInFlight`(**2631，声明在文件中部而非状态区**)

**项目页**：`projectActionInFlight`(393)、`projectBranchRefreshInFlight`(394)、`agentBackendPreflight`(395)、`agentBackendPreflightInFlight`(396)、`localDirectoryPicker`(400)、`projectSourceForm`(407)

**Runner 自启**：`runnerAutoStartAttemptedForRequest`(397)

**Coordinator**：`coordinatorChats`(4904)、`coordinatorPolling`(4905)、`coordinatorReplyDrafts`(4906)、`coordinatorOptionSelections`(4907)、`coordinatorAutoReplyBlocks`(4908)、`coordinatorReplyFocus`(4911)、`coordinatorReplyComposing`(4963)、`coordinatorReplyRenderDeferred`(4964)

**新建任务草稿**：`newTaskFormDraft`(4924)、`newTaskTitleFocus`(4946)

**设置页**：`settingsConfig`(6316，自包含对象)

**SSE stream**：`streamES`(7064)、`streamChannel`(7065)、`expandedStreamRunId`(7066)、`streamEventsByChannel`(7067)、`streamConnection`(7068)

**约束分析**：
1. 约 17 个裸 `let`（activePage、lastError、knowledgeActiveView、streamES 等）被多个职责区读写。ES module 的 `export let` 是只读 live binding（导入方不能赋值），所以拆分时这些 `let` 必须改为"对象属性"（如 `ui.activePage`）或留在 state 模块内提供 setter —— 这是唯一一处"不得不轻微改写"的地方，其余均可纯搬移（`const Map/Set/对象` 导出后可直接 mutate，无此问题）。
2. `render()` / `loadData()` 被各页面事件处理器调用（`render();` 出现 63 次，`loadData` 调用 24 次）→ 拆出的页面模块与 app 核心存在双向依赖，需要 state/核心模块下沉、页面模块单向 import（render/loadData 放在被 import 的核心模块即可，不需要回调注入）。
3. 渲染稳定性机制（IME 推迟、焦点/滚动/disclosure 恢复）是 `.trellis/spec/web/frontend/state-management.md` 明文规定的契约，render() 在 969–976 特判 `coordinatorReplyComposing`/`knowledgeEditComposing` —— 拆分时这两个 composition 标记与 render 的耦合必须原样保留。

## 3. 现有拆分模式（新拆分应遵循/扩展）

已拆出的四个模块是同一模式：**纯数据变换，零 DOM、零 fetch、零全局状态，vitest 直接可测**（settings-projection.ts:1–12 的头注释是该模式的自我描述）。main.ts 保留 DOM + 状态 + fetch。`.trellis/spec/web/frontend/directory-structure.md` 明确要求：
- 不引入框架；不搞 components/containers/pages 深层目录；
- 若拆 main.ts，**按 feature/概念分组（workbench、task-detail、settings），与 `Page` 联合类型对齐**；
- fetch 不进 projection（projection 保持纯）。

因此新拆分需要两类模块：① 继续沉淀纯逻辑到 projection 系列（可测）；② 新增"页面/功能域模块"（含 DOM + 事件 + 各自私有状态），从共享核心 import `state`/`api`/`dom`/`render`。

## 4. 推荐拆分方案（纯搬移优先、按耦合从低到高）

目标文件结构（与 Page 联合对齐，平铺不嵌套）：

```
src/
├── main.ts            # 仅 bootstrap：监听器 + parseHash + 首次 load + 轮询（≈30 行，现 7370–7396）
├── types.ts           # 54–348 的 DTO/interface（纯类型）
├── api.ts             # api() + API_BASE（422–429）
├── dom.ts             # el/icon/clear/pill/metric/field/button/fmtTime/shortId…（431–505、659–670、4127–4143）
├── state.ts           # data + 路由/错误状态 + 选择器（350–420、672–777）；裸 let 收敛为对象属性或 setter
├── router.ts          # setHash/parseHash（778–803）+ renderCurrentPage 分发
├── data-loading.ts    # loadData/loadRunDetail/ensure*（805–961）
├── render-core.ts     # render() + capture/restore 机制（963–1097）
├── stream.ts          # SSE 控制器（7049–7368）
├── page-workbench.ts  # 1359–1695
├── page-task-detail.ts# 1696–3370 + actions（6913–7047）
├── page-projects.ts   # 3372–4232
├── page-new-task.ts   # 4233–4881
├── coordinator-chat.ts# 4882–5530
├── page-reports.ts    # 5532–5746
├── page-knowledge.ts  # 5748–6269
├── page-settings.ts   # 6271–6911
└── (既有四个纯模块不动)
```

**迁移顺序**（每步独立可验证，从零状态依赖开始）：

| 步骤 | 内容 | 风险点 |
|---|---|---|
| 1 | `types.ts`：搬 54–348 纯类型 | 无状态，最安全 |
| 2 | `api.ts` + `dom.ts`：搬纯函数 | 无状态 |
| 3 | `state.ts`：搬 350–420 + 选择器；裸 `let` → 对象属性（唯一非纯搬移步，单独成一个 commit） | 全文替换 `activePage` → `ui.activePage` 之类，量大但机械 |
| 4 | `render-core.ts` + `router.ts` + `data-loading.ts` | render 对 composition 标记的特判需保留 |
| 5 | `page-settings.ts`（settingsConfig 自包含，对外只依赖 data.projects） | 最独立的页面 |
| 6 | `page-reports.ts`、`page-knowledge.ts` | reportsActiveView/knowledge* 状态随之搬走 |
| 7 | `stream.ts`（状态 7064–7073 自包含；对外依赖 activePage/activeTaskRequest/render） | 注意 `refreshStreamViewsForChannel` 的原地 DOM patch 路径 |
| 8 | `page-projects.ts`、`page-new-task.ts` + `coordinator-chat.ts` | IME/焦点契约；newTaskFormDraft 捕获在 render-core 被调用 |
| 9 | `page-task-detail.ts`（最大、依赖最广，最后拆） | retryInFlight(2631) 一并归位到状态区 |

**每步验证**：
1. `cd apps/web && bun run typecheck`（tsc --noEmit）
2. 仓库根 `bun x --bun vitest run`（守住既有纯模块 + serve 测试）
3. 手动冒烟：`bun run dev` → 打开 `http://localhost:5173/#workbench`、`#task`、`#projects`、`#new-task`、`#reports`、`#knowledge`、`#settings` 各页；重点冒烟点：任务详情页 3 秒轮询下展开 `<details>` 不回弹、Coordinator 回复框中文输入法不丢字、agent stream 显示 live、新建任务表单草稿在轮询下保留。serve.ts 按需打包意味着拆成多文件**不影响部署**（入口仍是 `/src/main.ts`，Bun.build 会把 import 一起打进 bundle）。

## 5. 其他坏味道（证据：文件:行号）

1. **零测试巨石**：main.ts 7396 行无任何测试；`test/` 下 6 个测试文件只 import 已拆纯模块和 serve.ts。
2. **单函数 472 行**：`renderNewTaskPage`（main.ts:4333–4805），中间无任何顶层函数边界（awk 验证 4333–4805 区间只有这一个函数声明）。
3. **错误信息提取重复 22 次**：`err instanceof Error ? err.message : String(err)` 在 main.ts:813、838、854、955、2662、2683、3647、3895、4031、4055、4182、4214、4583、4860、5131、6342、6425、6445、6948、6984、7010、7043 —— 可收敛为 `errorMessage(err)` 工具。
4. **"in-flight Set + try/finally + render()" 防重入脚手架重复 7+ 处**：`contextGovernanceInFlight`(374)、`approvalInFlight`(391)、`projectActionInFlight`(393)、`projectBranchRefreshInFlight`(394)、`agentBackendPreflightInFlight`(396)、`retryInFlight`(2631)、`coordinatorPolling`(4905)；`submitApproval`(6913)/`submitAcceptanceDecision`(6955)/`submitRequirementAction`(6991)/`submitKnowledgeAction`(7016) 四个函数结构几乎逐行相同。
5. **IME composition 推迟机制两份拷贝**：coordinator 回复框（4963–4964 + 5413）与知识编辑器（388–389 + 5823），render() 各特判一次（969–976）。
6. **Tab 栏构建三份拷贝**：reports（5623–5631 `reports-tabs`）、knowledge（6221–6242 `knowledge-tabs`）、settings（6726–6727 `config-tabs`），同构的 `tabs.map(...)` 模式。
7. **DTO 与 projection 类型平行重复**：main.ts 的 `ConfigEntryDto/ConfigOverrideDto/ConfigAuditDto`（6273–6300）与 settings-projection.ts 的 `ProjectionConfigEntry/Override/Audit`（16–42）形状几乎一致。
8. **状态声明散落**：`retryInFlight` 在 2631、coordinator 状态在 4904–4964、`settingsConfig` 在 6316、stream 状态在 7064–7073，未与 350–420 状态区集中。
9. **全局 3 秒轮询整树重渲**（7388–7396）：正确性完全押在 capture/restore 机制上 —— 这不是要改的逻辑，但解释了为什么拆分必须保形不保改。
10. **serve.ts 每请求现场 Bun.build 无缓存**（serve.ts:28–43）：dev-only，影响小；`safeJoin`(22–26) 与 SPA fallback(84–88) 行为正确。
11. **750 行内联 CSS**（index.html:7–758）：样式无模块化，但与本次 TS 拆分正交。
12. **`el()` 调用 835 次、`class: 'panel'` 组合 10 次**：已有 `panelHeader`(2386)/`renderDetails`(3045) 等局部抽象，但面板骨架仍靠手工拼。

## 相关 Spec

- `.trellis/spec/web/frontend/directory-structure.md` —— 明文支持"按 feature/概念拆 main.ts"，禁止框架与深层目录
- `.trellis/spec/web/frontend/state-management.md` —— 草稿/IME/disclosure 三大渲染契约，拆分必须保形
- `.trellis/spec/web/frontend/component-guidelines.md`、`type-safety.md`、`quality-guidelines.md`（未逐条展开，重构实施前应读）

## Caveats / Not Found

- 行段边界按顶层声明 outline 划定，个别 helper 跨段服务多页（如 506–777 的文案 helper 同时被 workbench/task/reports 使用），拆分时归入 `state.ts`/`dom.ts` 或各页面就近复制声明需逐个判断。
- 未运行运行时验证（未起服务），冒烟点清单来自代码与 spec 推断。
- `export let` 只读 live binding 的约束意味着第 3 步无法做到字面"纯搬移"，必须机械重命名为对象属性；建议该步单独 commit 并全量手动冒烟。
