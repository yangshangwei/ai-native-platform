# PRD: 优化任务详情页失败状态交互入口 + 执行日志性能优化

## 问题描述

### 问题 1: 失败状态无操作入口（已修复）
用户在任务详情页看到"需要处理"标签和"构建测试出现失败"提示，但页面上**找不到任何可点击的按钮或明确的操作入口**来查看失败原因或重试。

### 问题 2: 执行日志导致页面卡顿（**高优先级**）
用户反馈：
1. "日志里面输出了很多 tool 相关的日志，这部分能不能优化一下？其实我不太关注这些 tool 的调用"
2. "日志输入多了之后，整个界面就卡住了，点不动"

**根因**：
- `renderStreamBodyChildren` 对所有日志行调用 `map(renderStreamDisplayLine)`，创建大量 DOM 节点
- 没有行数限制，长时间运行的任务可能产生数千行日志
- 每次更新都 `replaceChildren` 整个日志区域，触发大量重排和重绘
- 工具调用（tool-input、tool-result）占据大量日志输出，但用户不关心

## 目标

1. ✅ **让用户在看到"需要处理"状态时，立即能找到对应的操作入口**（已完成）
2. **让执行日志在数千行时仍然流畅，不卡顿界面**
3. **简化工具调用的显示，隐藏用户不关心的技术细节**

## 解决方案

### 方案 1: 失败状态操作入口（已实现 ✅）

#### 1.1 在"下一步"面板显示失败处理指引
当没有 pending gate 且当前阶段失败时，`renderTaskNextActionPanel` 显示：
- **失败原因摘要**（从 gate / command / build 中提取）
- **"查看失败详情"按钮**：滚动到当前阶段面板
- **"重试该阶段"按钮**：调用重试 API

#### 1.2 在失败阶段卡片添加视觉高亮和点击交互
在 `renderLifecycle` 中：
- 失败的 stage-card 添加更粗边框、外发光、hover 动画
- 显示 "⚠️ 点击查看详情" 提示文字
- 添加 click handler 滚动到当前阶段面板

### 方案 2: 执行日志性能优化（已实现 ✅）

#### 2.1 限制渲染行数
在 `renderStreamBodyChildren` 中：
- 只渲染最近 500 行日志
- 超过 500 行时显示提示：`（为避免卡顿，已隐藏前 N 行日志）`
- 避免创建数千个 DOM 节点

#### 2.2 增强 compact 模式过滤
在 `shouldFilterEventInCompactMode` 中：
- **完全隐藏工具调用事件**：`[tool→`、`[tool-input`、`[tool-result`
- 过滤 token 统计、session_id、stop_reason 等内部元数据
- 只保留用户关心的 AI 输出内容（`[claude]`、`[codex]`）

## 验收标准

### AC-1: "需要处理"状态下有明确的操作入口 ✅
**Given** 任务处于失败状态（构建测试失败）  
**When** 用户查看任务详情页  
**Then** 右侧"下一步"面板显示失败原因和"查看失败详情"/"重试"按钮

### AC-2: 失败阶段卡片可点击 ✅
**Given** 某个阶段处于失败状态  
**When** 用户查看"任务进度"面板  
**Then** 失败的阶段卡片有视觉高亮（红色边框、外发光、hover 动画）  
**And** 显示"⚠️ 点击查看详情"提示  
**And** 点击后滚动到该阶段的详细面板

### AC-3: 执行日志不会导致页面卡顿 ✅
**Given** 任务执行产生了 1000+ 行日志  
**When** 用户查看执行日志面板  
**Then** 页面保持流畅响应  
**And** 只显示最近 500 行日志  
**And** 显示提示信息"（为避免卡顿，已隐藏前 N 行日志）"

### AC-4: compact 模式隐藏工具调用细节 ✅
**Given** 用户使用 compact 模式（默认）  
**When** 查看执行日志  
**Then** 不显示 `[tool→`、`[tool-input`、`[tool-result` 等工具调用事件  
**And** 只显示 AI 的思考和输出内容（`[claude]`、`[codex]`）

## 非目标

- ❌ 不修改 gate 重试逻辑的后端实现
- ❌ 不重构整个任务详情页布局
- ❌ 不添加新的失败类型或错误分类

## 影响文件

### 已修改 ✅

- `apps/web/src/page-task-detail.ts`
  - 新增 `renderFailedStageActionPanel` 函数 - 失败状态下的操作面板
  - 修改 `renderTaskNextActionPanel` - 检测失败状态并调用新面板
  - 修改 `renderLifecycle` - 失败阶段卡片添加点击事件和提示文字
  - 导入 `STAGE_TO_GATE` 用于查找失败的 gate

- `apps/web/src/stream.ts`
  - 修改 `renderStreamBodyChildren` - 限制最多渲染 500 行日志
  - 超过限制时显示提示信息

- `apps/web/src/stream-rendering.ts`
  - 增强 `shouldFilterEventInCompactMode` - 完全过滤工具调用事件

- `apps/web/index.html`
  - 增强 `.stage-card.failed` 样式 - 更粗边框、外发光、hover 动画
  - 添加 `transition` 和 `cursor: pointer` 样式

## 技术细节

### 滚动到阶段面板的实现

```typescript
function scrollToCurrentStagePanel(): void {
  const panel = document.querySelector('.current-stage-panel');
  if (panel) {
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
```

### 提取失败原因摘要

从以下来源提取：
1. `detail.gates` 中最新的 failed gate 的 ruleResults
2. `detail.builds` 中 status === 'failed' 的构建
3. `detail.commands` 中 exitCode !== 0 的命令

## 测试策略

- **手动测试**：创建一个构建失败的任务，验证三个 AC
- **视觉回归测试**：截图对比失败状态页面的前后变化
- **无构建测试**：这是纯前端 UI 改进，不影响后端逻辑

## 参考

- 用户反馈截图（显示"需要处理"但无操作入口）
- 现有重试逻辑：`renderStageRetryActions` 函数（仅在 gate failed 时显示）
