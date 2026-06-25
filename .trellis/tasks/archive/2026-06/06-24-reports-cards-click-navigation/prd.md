# 交付报告页面数字卡片添加点击跳转功能

## Goal

让用户能够点击交付报告页面"交付概览"、"风险队列"、"执行进度"面板中的数字卡片，直接跳转到对应筛选状态的报告列表，提升导航效率。

## What I already know

* 报告页面位于 `apps/web/src/page-reports.ts`
* 页面顶部有三个卡片区域（`renderReportsOverview`）：
  - "交付概览"：包含"可验收"和"需处理"数字
  - "风险队列"：包含"失败"数字
  - "执行进度"：包含"执行中"数字
* 这些数字使用 `metric()` 函数渲染（来自 `dom.ts`）
* 页面已有标签页切换功能（`renderReportTabs`），支持筛选视图：
  - `all` - 全部报告
  - `attention` - 需处理
  - `acceptable` - 可验收
  - `running` - 执行中
* 切换视图使用 `setReportsView()` 函数

## User Decisions

* **跳转目标 (已确认)**：
  1. "可验收" → 切换到 `acceptable` 标签
  2. "需处理" → 切换到 `attention` 标签
  3. "失败" → 切换到 `attention` 标签（失败属于需处理子集）
  4. "执行中" → 切换到 `running` 标签

## Requirements

* 数字卡片支持点击交互
* 点击后自动切换到对应的报告筛选标签：
  - "可验收" → `acceptable` 标签
  - "需处理" → `attention` 标签
  - "失败" → `attention` 标签
  - "执行中" → `running` 标签
* 页面滚动到报告列表区域（可选，根据实现难度）
* 添加视觉反馈（hover 效果、光标变化）

## Acceptance Criteria

* [x] 点击"可验收"数字切换到"可验收"标签并显示筛选结果
* [x] 点击"需处理"数字切换到"需处理"标签并显示筛选结果
* [x] 点击"失败"数字切换到"需处理"标签并显示筛选结果
* [x] 点击"执行中"数字切换到"执行中"标签并显示筛选结果
* [x] 数字 hover 时有视觉反馈（颜色变化或下划线）
* [x] 光标显示为 pointer

## Definition of Done (team quality bar)

* 功能正常运行，所有数字点击跳转正确
* CSS 样式符合现有设计规范
* 代码风格与项目保持一致
* 在浏览器中实际测试通过

## Technical Approach

### Implementation Strategy

**Two-part modification**:

1. **Modify `metric()` function** (`dom.ts:138-147`)
   - Add optional `onClick` callback parameter
   - Attach click handler to the returned metric card element
   - Add clickable styling when onClick is provided
   
2. **Update `renderReportsOverview()` calls** (`page-reports.ts:119-152`)
   - Pass onClick handlers to `metric()` calls:
     - "可验收" → `() => setReportsView('acceptable')`
     - "需处理" → `() => setReportsView('attention')`
     - "失败" → `() => setReportsView('attention')`
     - "执行中" → `() => setReportsView('running')`

### CSS Enhancement

Add clickable styles for `.metric-value` in CSS:
- Add `cursor: pointer` when clickable
- Add hover effect (color change or underline)
- Keep styling subtle and consistent with existing metrics

### Files to modify

1. `apps/web/src/dom.ts` - add onClick parameter to `metric()`
2. `apps/web/src/page-reports.ts` - pass onClick handlers in `renderReportsOverview()`
3. CSS file (if needed) - add hover styles for clickable metric values

## Decision (ADR-lite)

**Context**: Need to make metric numbers clickable without breaking existing usages across the app

**Decision**: Add optional `onClick` parameter to `metric()` function, similar to how we enhanced `metricCardV2()`

**Consequences**: 
- ✅ Backward compatible (onClick is optional)
- ✅ Simple, minimal code change
- ✅ Consistent with the pattern we just used for workbench cards
- ✅ Other pages using `metric()` won't be affected

## Out of Scope (explicit)

* 不修改卡片的基础样式和布局
* 不添加其他页面的数字点击功能
* 不创建新的筛选标签

## Technical Notes

* Files inspected:
  - `apps/web/src/page-reports.ts:119-152` - renderReportsOverview 函数
  - `apps/web/src/page-reports.ts:91-94` - setReportsView 函数
  - `apps/web/src/dom.ts` - metric 函数
* 报告页面使用 `reportsActiveView` 状态管理当前激活的标签
* 需要检查 `metric()` 函数是否支持 onClick 参数
