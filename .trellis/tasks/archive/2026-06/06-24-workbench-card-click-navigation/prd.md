# 工作台概览卡片添加点击跳转功能

## Goal

让用户能够点击工作台概览面板中的三个统计卡片（"AI 正在处理"、"最近完成"、"任务总数"），直接跳转到对应的页面查看详细信息。提升用户体验和导航效率。

## What I already know

* 工作台概览面板位于 `apps/web/src/page-workbench.ts` 的 `renderWorkbenchOverviewPanel()` 函数中
* 使用 `metricCardV2()` 函数（位于 `dom.ts:153`）渲染三个统计卡片：
  - "AI 正在处理" - 显示正在进行中的任务数量
  - "最近完成" - 显示已完成的任务数量
  - "任务总数" - 显示累计创建的任务数量
* `metricCardV2()` 返回的是一个普通的 `div` 元素，当前没有点击交互能力
* 项目使用 `setHash()` 函数（来自 `router.ts`）进行页面导航

## User Decisions

* **跳转目标 (已确认)**：
  1. "AI 正在处理" → `my-todos` (我的待办页面)
  2. "最近完成" → `reports` (报告页面)
  3. "任务总数" → `reports` (报告页面)

## Requirements

* 三个统计卡片都应该支持点击交互
* 点击跳转行为：
  - "AI 正在处理" → 跳转到 `my-todos` 页面
  - "最近完成" → 跳转到 `reports` 页面
  - "任务总数" → 跳转到 `reports` 页面
* 添加视觉反馈（hover 效果、光标变化）提示用户这些卡片可点击
* 点击行为应该触发页面导航动画（通过 `setHash` 实现）

## Acceptance Criteria

* [ ] 点击"AI 正在处理"卡片跳转到 `my-todos` 页面
* [ ] 点击"最近完成"卡片跳转到 `reports` 页面
* [ ] 点击"任务总数"卡片跳转到 `reports` 页面
* [ ] 卡片 hover 时有明显的视觉反馈（背景色变化、阴影增强、轻微上移等）
* [ ] 光标悬停在卡片上时显示为 pointer
* [ ] 点击动画流畅，符合现有页面切换体验

## Definition of Done (team quality bar)

* 功能正常运行，三个卡片点击跳转正确
* CSS 样式符合现有设计规范
* 代码风格与项目保持一致
* 在浏览器中实际测试通过

## Technical Approach

### Implementation Strategy

**Two-part modification**:

1. **Modify `metricCardV2()` function** (`dom.ts:153-178`)
   - Add optional `onClick` callback parameter
   - Attach click handler to the returned card element
   - Add `cursor: pointer` style when onClick is provided
   
2. **Update `renderWorkbenchOverviewPanel()` calls** (`page-workbench.ts:179-199`)
   - Pass onClick handlers to each `metricCardV2()` call:
     - Card 1: `() => setHash('my-todos')`
     - Card 2: `() => setHash('reports')`
     - Card 3: `() => setHash('reports')`

### CSS Enhancement

Add/enhance `.metric-card-v2` hover styles in `components.css`:
- Add `cursor: pointer` when clickable
- Enhance existing hover transform/shadow
- Ensure consistent with other clickable cards (e.g., `.my-todos-item:hover`)

### Files to modify

1. `apps/web/src/dom.ts` - add onClick parameter to `metricCardV2()`
2. `apps/web/src/page-workbench.ts` - pass onClick handlers
3. `apps/web/public/components.css` - ensure hover styles exist for clickable cards

## Decision (ADR-lite)

**Context**: Need to make metric cards clickable without breaking existing usages

**Decision**: Add optional `onClick` parameter to `metricCardV2()` rather than creating a separate wrapper function

**Consequences**: 
- ✅ Backward compatible (onClick is optional)
- ✅ Simple, minimal code change
- ✅ Consistent with existing button patterns in the codebase
- ⚠️ Cards without onClick won't show pointer cursor (expected behavior)

## Out of Scope

* 不修改卡片的基础样式和布局（保持现有 Sub2API 设计风格）
* 不添加其他页面的卡片点击功能（仅限工作台概览面板）
* 不创建新的页面
* 不添加卡片点击统计或分析

## Technical Notes

* Files inspected:
  - `apps/web/src/page-workbench.ts:165-204` - renderWorkbenchOverviewPanel 函数
  - `apps/web/src/dom.ts:153-178` - metricCardV2 函数
  - `apps/web/src/router.ts` - 页面导航函数
* Router 使用 hash-based 导航（`setHash()`）
* 需要确认项目中有哪些可用的路由/页面
