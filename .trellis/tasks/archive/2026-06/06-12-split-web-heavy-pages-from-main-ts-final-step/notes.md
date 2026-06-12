# Notes — T2.3 main.ts 解体收官（坏味道记录，纯搬移未修复）

实施偏差（非坏味道，需说明）：

- **抽取顺序与 PRD 步骤 2/3 对调**：`submitWorkflowRequest`（new-task）调用
  `loadCoordinatorChat`（coordinator 状态家族成员），若先抽 page-new-task 会被迫
  从 main.ts 反向 import（违反单向依赖）。故先抽 coordinator-chat.ts，再抽
  page-new-task.ts。每步均独立 typecheck 通过。
- **新增 page-workbench.ts 与 shell.ts**：PRD 范围只列了四个模块，但 main.ts
  ≤250 行的验收要求意味着工作台页与外壳（sidebar/topbar/页面分发/stream 放大
  浮层）也必须迁出。page-workbench.ts 对齐 Page 联合；shell.ts 是所有页面模块
  之上的唯一汇聚层（research 报告 §4 目标结构中 1099–1357 外壳块未指定归属，
  放 router/render-core 会造成基础层反向依赖页面，故单独成模块）。

坏味道（全部保形搬移，未改逻辑）：

1. **死代码 5 个函数**（grep 全仓无调用点）：
   - `renderRunsPanel` + `renderRunListItem`（现 page-workbench.ts 尾部）
   - `renderRunHero`、`renderStagePanels`、`renderDocumentPanel`（现 page-task-detail.ts）
   纯搬移纪律下原样保留；建议后续任务删除。
2. **渲染路径内发起 fetch**：`coordinatorVerdictText`（page-task-detail.ts）与
   `renderCoordinatorChatPanel`（coordinator-chat.ts）在 render 过程中
   `void loadCoordinatorChat(...)`；`renderTaskDetailPage` 在 render 中调用
   `clearCoordinatorReplyComposerState`。渲染函数带副作用，依赖"加载完成后再
   render"的幂等性兜底。
3. **`renderTaskHero` 同值三元**（page-task-detail.ts）：`detail ? X : X` 两个分支
   字符串模板完全相同。
4. **`backendStatusText`（state.ts）含死分支**：映射 'Connected'/'Needs login' 等
   英文标签，但 `agentBackendStatusForProject` 只产出中文标签；除 '未检测'
   透传外其余分支不可达。
5. **`refreshProjectBranches` 名义上是项目动作、实际唯一消费者是 new-task 分支
   选择器**（已随 page-new-task.ts 走，连同 `projectBranchRefreshInFlight`）。
   它从页面模块直接改写 `data.projects` 条目（defaultBranch/sourceBranches），
   跨实体可变共享。
6. **审批类 mutation 脚手架三连拷贝**（research 报告坏味道 #4 的延续）：
   `submitApproval`（data-loading.ts，多页共用）与 `submitAcceptanceDecision` /
   `submitRequirementAction`（page-task-detail.ts，单页私有）结构近乎逐行相同；
   归属判定按消费方划分，重复本身留待 T2.4+ 收敛。
7. **`labeledInput`（dom.ts）无任何调用点**（T2.2 迁移后即死代码）。
8. **shell.ts 的 topbar 摘要横向读取所有页面模块状态**（settingsConfig /
   knowledgeArtifactsState / newTaskFormDraft 等）：依赖方向正确（shell 在页面
   之上），但 topbar 文案与页面内部状态强耦合，新增页面需同时改 shell。

冒烟记录（2026-06-12）：

- `bun run typecheck`（4 个 tsconfig）全过；`bun x --bun vitest run` 73 文件
  630 用例全绿。
- serve.ts 按需 Bun.build 打包 `/src/main.ts` 返回 200（~310KB），bundle 含
  renderShell / renderTaskDetailPage / coordinatorReplyComposing，多模块解析无误。
- 浏览器逐页交互冒烟已完成（方法沿用 T2.2）：7 页渲染零 fetch 失败、零 JS
  错误；新任务表单草稿跨 3 秒轮询保留、标题焦点不丢；详情页 `<details>` 展开
  >3 秒不回弹；reports 文本量差异用 HEAD 版同数据对照排除（非本次改动引入）。

Check 阶段补充验证（2026-06-12）：

- 搬移保真用行级多重集对照（HEAD main.ts + state/dom 删除行 vs 6 个新模块 +
  新 main.ts + state/dom 新增行，剥离 import/注释、归一 `export`）：零丢失、
  零重复、零改写，仅 `LocalDirectoryPickerState` / `ProjectSourceFormState`
  两个类型名从 state.ts import 移到 page-projects.ts import（符合预期）。
- bootstrap 尾段（setRenderHooks/setStreamHooks → 监听器 → parseHash →
  首次 loadData → 3 秒轮询）与 HEAD 逐字节一致；新模块均无模块级副作用，
  hooks 注入先于首次 render/loadData，时序等价。
- `bun x tsc --noUnusedLocals` 仅命中坏味道 #1 已记录的 4 个死函数，无新增
  未用 import。
