# 移除交付报告页面的平台分布图表

## Goal

移除交付报告页面中的平台分布饼图部分，简化页面内容，聚焦核心交付指标。

## What I already know

* 平台分布图表位于 `apps/web/src/page-reports.ts:283-304`
* 函数名为 `renderPlatformDistributionChart()`
* 该图表在 `renderReportsPage()` 中被调用（第104行）
* 图表使用 Chart.js 渲染饼图，显示"按执行平台统计已完成任务"
* 相关依赖函数：`getPlatformDistribution()` (在 `charts.ts` 中)

## Requirements

* 从 `renderReportsPage()` 中移除 `renderPlatformDistributionChart()` 调用
* 删除 `renderPlatformDistributionChart()` 函数定义
* 检查是否需要清理相关的 Chart.js 或 `getPlatformDistribution()` 依赖

## Acceptance Criteria

* [ ] 交付报告页面不再显示平台分布图表
* [ ] `renderPlatformDistributionChart()` 函数已删除
* [ ] TypeScript 类型检查通过（`npx tsc --noEmit`）
* [ ] 页面在浏览器中正常渲染，无控制台错误

## Definition of Done

* 代码已修改并通过类型检查
* 在浏览器中验证交付报告页面正常显示（无图表部分）
* 无遗留的未使用函数或导入

## Out of Scope

* 不删除 Chart.js 依赖（可能用于其他图表）
* 不修改 `getPlatformDistribution()` 函数（可能被其他地方使用）
* 不调整其他页面布局

## Technical Approach

**简单直接的删除操作：**

1. 在 `renderReportsPage()` 中移除 `renderPlatformDistributionChart()` 调用
2. 删除 `renderPlatformDistributionChart()` 函数定义（283-304行）
3. 运行类型检查确认无错误
4. 浏览器验证页面渲染

## Technical Notes

* Files to modify:
  - `apps/web/src/page-reports.ts` (移除调用 + 删除函数定义)
* 该功能是独立的UI组件，移除不影响核心交付报告功能
