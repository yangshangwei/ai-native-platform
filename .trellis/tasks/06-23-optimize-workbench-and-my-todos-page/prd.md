# 优化工作台和"我的待办"页面

## Goal

将工作台页面拆分为两个独立页面：
1. **工作台** - 保持全局概览和趋势分析的职责
2. **我的待办** - 专注于个人待处理任务的执行和管理

同时优化提醒功能，让用户能够快速识别需要处理的任务。

## What I already know

### 现有工作台结构 (apps/web/src/page-workbench.ts)

当前工作台包含以下模块：
- **欢迎引导面板** - 首次使用引导
- **需要我处理面板** (renderWorkbenchActionPanel) - 显示需要用户处理的任务（awaiting_clarification / failed 状态的 request + awaiting_human 状态的 run）
- **工作台概览面板** (renderWorkbenchOverviewPanel) - 4个统计卡片（需要处理、AI正在处理、最近完成、任务总数）
- **任务执行趋势图** (renderTaskExecutionChart) - 最近7天的任务完成情况折线图
- **任务列表面板** (renderTaskListPanel) - 按状态分组：需要处理、进行中、已完成，以及一个可展开的"全部任务"
- **执行环境面板** (renderWorkbenchEnvironmentPanel) - 可折叠的执行环境详情

### 路由结构 (apps/web/src/router.ts)

现有页面：`['workbench', 'projects', 'new-task', 'reports', 'knowledge', 'settings']`

路由通过 `setHash(page, id?)` 和 `parseHash()` 处理，支持页面切换动画。

### 数据来源 (apps/web/src/state.ts 推测)

- `data.requests` - 任务请求列表 (WorkflowRequestDto[])
- `data.runs` - 工作流运行列表 (WorkflowRunDto[])
- `data.projects` - 项目列表

### 当前问题

工作台同时承担了"全局概览"和"个人待办"两种职责，导致：
- 信息混杂，用户需要在多个区域中筛选"我需要处理的"
- "需要我处理"面板和"任务列表"中的"需要处理"分组存在重复
- 没有清晰的个人任务执行入口

## What I discovered from code

### WorkflowRequest 数据结构 (packages/shared/src/types/workflow.ts:212-237)

```typescript
export interface WorkflowRequest {
  id: WorkflowRequestId;
  projectId: ProjectId;
  type: WorkflowRunType;
  title: string;
  branch: string;
  status: WorkflowRequestStatus; // 'pending' | 'awaiting_clarification' | 'claimed' | 'completed' | 'failed' | 'cancelled'
  claimedBy: string | null;      // 👈 关键字段：谁认领了这个任务
  workflowRunId: WorkflowRunId | null;
  error: string | null;
  createdAt: Iso8601;
  updatedAt: Iso8601;
  flowId: FlowId | null;
  startStage: WorkflowStage | null;
}
```

**关键发现：`claimedBy` 字段存在！**

### 当前工作台的"需要我处理"逻辑

```typescript
function isRequestUserAction(request: WorkflowRequestDto): boolean {
  return request.status === 'awaiting_clarification' || request.status === 'failed';
}
```

当前逻辑：只要状态是 `awaiting_clarification` 或 `failed`，就认为"需要我处理"，**不考虑 `claimedBy`**。

## Assumptions (temporary)

1. 提醒功能是指页面内高亮提示或导航栏徽章提醒
2. 工作台的"概览趋势"应该是只读的仪表盘视图
3. "我的待办"应该支持快速筛选和操作

## Decisions

### D1: "我的待办"定义方式 ✓

**采用方案 C：混合模式**

"我的待办"显示以下任务：
1. `claimedBy === 当前用户` 的任务（我认领的）
2. 状态为 `awaiting_clarification` 或 `failed` 且 `claimedBy === null` 的任务（未认领但需要处理的）

如果系统当前没有用户身份概念，先按方案 A 实现（显示所有需要处理的任务），为未来扩展预留接口。

### D2: 提醒功能形式 ✓

**采用选项 3：组合方式**

1. **导航栏徽章** - 在侧边栏"我的待办"菜单项上显示待办数量徽章（如红点 + 数字）
2. **工作台顶部提示条** - 有待办任务时，在工作台顶部显示醒目的提示："你有 N 个任务需要处理"，提供"查看待办"快捷按钮

## Open Questions

## Requirements

### 1. 新增"我的待办"页面

**路由**
- 新增页面路由：`#my-todos`
- 在导航栏添加"我的待办"菜单项，显示待办数量徽章

**显示逻辑（方案 C：混合模式）**
- 显示 `claimedBy === 当前用户` 的任务（我认领的）
- 显示状态为 `awaiting_clarification` 或 `failed` 且 `claimedBy === null` 的任务（未认领但需要处理的）
- 如果系统当前没有用户身份概念，显示所有需要处理的任务

**页面布局**
- 页面标题 + 待办任务数量
- 任务列表（每个任务卡片显示：标题、项目、状态、时间、操作按钮）
- 空状态友好提示："暂无待办任务"

**筛选和排序功能**
- 按状态筛选：全部 / awaiting_clarification / failed
- 按项目筛选：全部项目 / 选择特定项目
- 按时间排序：最新更新 / 最早更新
- 按优先级排序（如果未来有优先级字段）

**操作**
- 点击任务卡片 → 跳转到任务详情页
- "查看详情"按钮 → 跳转到任务详情页

### 2. 优化工作台页面（保留概览趋势）

**保留的模块**
- ✅ 工作台概览卡片（4个统计：需要处理、AI正在处理、最近完成、任务总数）
- ✅ 任务执行趋势图（最近7天折线图）
- ✅ 执行环境面板（Runner、项目、执行方式等）
- ✅ 欢迎引导面板（首次使用时显示，完成后自动隐藏）

**移除的模块**
- ❌ "需要我处理"面板 → 移到"我的待办"页面
- ❌ 任务列表面板（需要处理、进行中、已完成分组） → 移到"我的待办"页面

**新增的模块**
- ➕ 顶部提示条：有待办任务时显示"你有 N 个任务需要处理"，提供"查看待办"快捷按钮

### 3. 提醒功能优化（组合方式）

**导航栏徽章**
- 在侧边栏"我的待办"菜单项上显示待办数量徽章
- 样式：红点 + 数字（如 `🔴 3`）
- 待办数量 = 0 时隐藏徽章

**工作台顶部提示条**
- 有待办任务时，在工作台页面顶部显示醒目的提示条
- 文案："你有 N 个任务需要处理"
- 提供"查看待办"按钮，点击跳转到"我的待办"页面
- 待办数量 = 0 时隐藏提示条

## Requirements (evolving)

*已迁移到上方*

## Acceptance Criteria

* [ ] 新增"我的待办"页面，路由为 `#my-todos`
* [ ] 导航栏显示"我的待办"菜单项，带待办数量徽章
* [ ] "我的待办"页面正确显示待办任务（混合模式逻辑）
* [ ] "我的待办"页面支持按状态、项目筛选，按时间排序
* [ ] 工作台页面保留概览卡片、趋势图、执行环境面板
* [ ] 工作台页面移除"需要我处理"面板和"任务列表"面板
* [ ] 工作台页面顶部有待办时显示提示条，提供"查看待办"按钮
* [ ] 页面切换动画正常工作
* [ ] 空状态友好提示正常显示
* [ ] TypeScript 类型检查通过
* [ ] 现有功能不受影响（任务详情跳转、项目切换等）

## Out of Scope (explicit)

**明确不在此次 MVP 范围内：**
- 批量操作（批量认领、批量关闭）
- 浏览器通知（Notification API）
- 移动端专门优化（响应式布局保留，但不做移动端特殊适配）
- 任务优先级字段（如果未来有，预留排序接口）
- 任务认领功能本身（只读取 `claimedBy` 字段，不实现认领操作）
- 用户身份系统（如果当前没有，暂不实现，为未来预留接口）

## Technical Approach

### 新增文件
- `apps/web/src/page-my-todos.ts` - "我的待办"页面渲染逻辑

### 修改文件
- `apps/web/src/router.ts` - 新增 `my-todos` 路由
- `apps/web/src/types.ts` - 新增 `Page` 类型中的 `'my-todos'`
- `apps/web/src/shell.ts` - 导航栏新增"我的待办"菜单项 + 徽章
- `apps/web/src/page-workbench.ts` - 移除任务列表面板，新增顶部提示条
- `apps/web/src/state.ts` - 新增 `myTodosCount()` 工具函数计算待办数量
- `apps/web/src/main.ts` - 路由分发中新增 `my-todos` 分支

### 实现策略
1. 先实现"我的待办"页面的基础渲染（不考虑筛选排序）
2. 再实现筛选排序功能
3. 优化工作台页面（移除模块 + 新增提示条）
4. 实现导航栏徽章
5. 测试页面切换和数据加载

## Definition of Done (team quality bar)

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes
* Rollout/rollback considered if risky

## Out of Scope (explicit)

*待讨论后补充*

## Technical Notes

### 相关文件
- `apps/web/src/page-workbench.ts` - 工作台页面主体
- `apps/web/src/router.ts` - 路由系统
- `apps/web/src/state.ts` - 全局状态（需要读取以确认数据结构）
- `apps/web/src/types.ts` - 类型定义（需要读取以确认 assignee 字段）

### 技术约束
- 使用现有的 `el()` / `button()` / `pill()` 等 DOM 工具函数
- 保持现有的页面切换动画机制
- 使用现有的 `panelHeader()` / `metricCardV2()` 等组件

## Research References

*待根据技术选择进行研究*
