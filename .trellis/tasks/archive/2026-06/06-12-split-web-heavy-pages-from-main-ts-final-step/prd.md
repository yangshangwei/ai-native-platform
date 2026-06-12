# PRD: web 重页面拆分——main.ts 解体收官（路线图 T2.3）

## 背景

T2.1（a0d9947）拆出基础层，T2.2（1f2aec0）拆出自包含页面与 stream，main.ts 余 4695 行，
内容为四块耦合最重的页面/功能域 + bootstrap。研究报告（archive 任务 research/web-architecture.md §1/§4 步骤 8-9）
认定它们依赖最广，所以放最后。

## 硬性约束（同 T2.1/T2.2）

- 纯搬移、不改逻辑；坏味道记 notes.md。
- spec：directory-structure.md（平铺、按 Page 联合对齐）、state-management.md（**coordinator 回复框 IME 推迟契约**、表单草稿在 3 秒轮询下保留、disclosure/焦点恢复——全部保形）。
- 页面模块单向依赖基础层；新模块命名沿用 page-*.ts 惯例。

## 范围（按耦合从低到高，每步 typecheck 后再进下一步）

1. **page-projects.ts**：项目页（onboarding 表单、source 检测、本地目录选择器、auth 字段、project card、删除/归档/编辑/分支刷新、backend preflight 展示）。projectSourceForm / localDirectoryPicker / projectActionInFlight / projectBranchRefreshInFlight 状态随之搬走。
2. **page-new-task.ts**：新建任务页（含 472 行的 renderNewTaskPage、submitWorkflowRequest、智能推荐 debounce、ensureProjectAgentBackendReady）。newTaskFormDraft / newTaskTitleFocus 随之搬走；**表单草稿轮询保留契约**是冒烟重点。
3. **coordinator-chat.ts**：Coordinator 会话式澄清（chat 状态、IME composition、轮询、问题卡片、选项按钮、stream 订阅衔接）。coordinator* 全套状态随之搬走；render-core 对 coordinatorReplyComposing 的特判衔接方式参照 T2.2 处理 knowledgeEditComposing 的先例（标记留 state.ts）。
4. **page-task-detail.ts**：任务详情页（hero、lifecycle、stage panels、context governance、各种面板、审批、证据、artifact 查看器、重试、agent stream 嵌板、promptRejectReason）+ mutation 动作（submitApproval 等若 T2.2 未移完）。retryInFlight 等随之搬走。
5. 收官后 main.ts 应只剩：模块 import、renderCurrentPage 页面分发衔接（若仍在）、bootstrap（监听器 + parseHash + 首次 loadData + 3 秒轮询）。预计 ≤200 行；若分发函数在 render-core，main.ts 可能仅 ~50 行。

## 不做

- 逻辑改写、DTO 统一（T2.4）、CSS、serve.ts 代理泄漏修复（路线图 T4，已记 T2.2 notes）

## 验收标准

1. `bun run typecheck`；`bun x --bun vitest run` 630 全绿
2. 冒烟（沿用 T2.2 方法）：7 页渲染文本与基线一致；console 无新增错误；重点交互：
   - #projects 展开 onboarding 表单输入不丢
   - #new-task 表单填写后等 >3 秒轮询草稿仍在、标题焦点不丢
   - 任务详情页展开 `<details>` 等 >3 秒不回弹
3. main.ts ≤ 250 行
4. 每个新模块头注释说明职责与状态所有权
