# PRD: web 独立页面模块拆分（路线图 T2.2）

## 背景

T2.1（commit a0d9947）已落地基础层（types/api/dom/state/router/data-loading/render-core），main.ts 余 6603 行（全部为页面渲染 + 页面私有状态）。本任务拆出**状态自包含程度最高的四块**，对应研究报告迁移顺序的步骤 5-7：
`.trellis/tasks/archive/2026-06/06-11-architecture-review-and-refactor-for-simplicity-and-extensibility/research/web-architecture.md` §4。

## 硬性约束（与 T2.1 相同）

- 纯搬移、不改逻辑；坏味道只记 notes.md。
- 遵守 `.trellis/spec/web/frontend/directory-structure.md` 与 `state-management.md`（知识页编辑器的 IME 推迟契约保形）。
- 页面模块单向依赖基础层（state/api/dom/render-core/data-loading），不得反向。

## 范围（按状态自包含度从高到低，每页一步、每步验证）

1. **page-settings.ts**：设置页（Runtime Config 加载/保存/重置/历史/编辑器），`settingsConfig` 状态对象随之搬走。研究报告认定其状态完全自包含、对外只读 data.projects——最安全的起点。
2. **page-reports.ts**：报告页（tabs/overview/行渲染/活动详情），`reportsActiveView` 随之搬走。
3. **page-knowledge.ts**：知识页（建议项/编辑器/artifact 卡片/四个子视图），knowledge* 系列状态（ArtifactsState/Decisions/Edits/Editing/EditDrafts/ActiveView/EditComposing/EditRenderDeferred）随之搬走。**注意**：render-core 对 `knowledgeEditComposing` 的 IME 特判——状态搬走后 render-core 的读取路径必须保持等价（允许经 state.ts 中转或由页面模块导出，选不引入循环 import 的方案）。
4. **stream.ts**：SSE agent stream 控制器（EventSource 生命周期、事件缓存、视图模型、`refreshStreamViewsForChannel` 原地 DOM patch），stream* 状态随之搬走。它不是页面但状态自包含，被任务详情页消费——保持 main.ts（剩余页面）→ stream.ts 单向 import。

页面分发（render-core/main.ts 中的 renderCurrentPage switch）改为 import 各页面模块的渲染入口。

## 不做

- projects / new-task / coordinator-chat / task-detail（T2.3，依赖更广）
- 任何逻辑改写、DTO 统一

## 验收标准

1. `bun run typecheck` 通过；`bun x --bun vitest run` 630 全绿
2. 冒烟（playwright，api+web dev server）：7 页渲染正常、console 零错误；重点页 #settings、#reports、#knowledge 来回切换 tab 后无异常
3. main.ts 预计再降 ~1800 行（设置 640 + 报告 215 + 知识 520 + stream 320 量级）
4. 新模块头注释说明职责与状态所有权
