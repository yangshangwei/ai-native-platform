# 优化交付报告页面可用性

## Goal

将“交付报告”页面从 run 状态列表改成面向验收、复盘和风险判断的报告中心。用户应先看到当前交付整体情况、哪些任务需要处理、哪些报告可用于验收；技术细节只在需要追溯时展开。

## What I already know

* 当前截图显示：顶部仍是 Project / Branch / Runner / Agent Backend / Build Env 技术卡，主体是 `Completion Reports` 列表，按钮为 `Report / Open`，信息层级偏技术。
* 业务上，交付报告页应服务于“能否验收、哪里失败、有什么证据、下一步做什么”。
* 现有实现位于 `apps/web/src/main.ts` 的 `renderReportsPage()` / `renderReportRow()` / `renderActiveReportDetail()`。
* 已有 `parseCompletionReportArtifact()` 可以把 completion report 投影成 summary + sections，不需要改变报告产物协议。

## Requirements

* 顶部技术状态在报告页合并为一个“交付状态”摘要，不再显示 5 个同权技术卡。
* 首屏增加业务概览：可验收、需处理、执行中、报告总数。
* 报告列表改成用户语言：任务标题、项目、时间、当前状态、证据摘要、下一步动作。
* 按状态提供视角切换：全部、需处理、可验收、执行中。
* `Completion Reports`、`Report`、`Open` 等英文技术标签改为中文业务文案。
* 活跃报告详情应突出摘要和章节，run id / artifact uri 等技术信息放到折叠详情。
* 保留现有查看报告详情和打开任务能力，不改变 API 或报告产物协议。
* 桌面和移动端无明显横向溢出；长标题、branch、run id 可换行或折叠。

## Acceptance Criteria

* [x] 顶部不再显示 Project / Branch / Runner / Agent Backend / Build Env 五个同权状态卡。
* [x] 页面首屏有“交付概览”和关键指标。
* [x] 报告列表使用中文业务文案，按钮为“查看报告 / 打开任务”。
* [x] 有“全部 / 需处理 / 可验收 / 执行中”视角切换。
* [x] 每条报告卡展示状态、项目/时间、证据摘要和下一步。
* [x] 报告详情保留摘要与章节，并把技术标识放入折叠详情。
* [x] 类型检查、测试和桌面/移动端截图验证通过，或记录无法验证原因。

## Verification

* `bun run typecheck` passed.
* `bun test` passed: 615 pass, 0 fail.
* `python3 ./.trellis/scripts/task.py validate 06-10-06-10-optimize-reports-page-usability` passed.
* Headless Chrome checked `http://localhost:5173/#reports`:
  * `/tmp/ainp-reports-desktop-viewport.png`
  * `/tmp/ainp-reports-mobile-viewport.png`
  * `/tmp/ainp-reports-mobile-content.png`
* Browser assertions passed:
  * Topbar only shows “交付状态”.
  * Overview has 3 cards.
  * Tabs are “全部 / 需处理 / 可验收 / 执行中”.
  * Report cards render with “查看报告 / 打开任务”.
  * Technical details are folded by default.
  * Desktop `scrollWidth=1265`, `clientWidth=1265`.
  * Mobile `scrollWidth=390`, `clientWidth=390`.
* Note: a raw task title in the local dataset contains the English phrase “Completion Report”; this is user/data content, not a remaining UI label.

## Out of Scope

* 不新增后端接口。
* 不改变 completion_report 产物结构。
* 不实现报告导出、搜索或服务端分页。
* 不引入新前端依赖或框架。

## Technical Notes

* 主要改造 `renderReportsPage()`、`renderReportRow()`、`renderActiveReportDetail()`。
* 可新增前端本地视角 state。
* 继续使用 `el()` / `textContent` 构建 DOM，避免 HTML 字符串注入。
* 折叠面板需要 `data-details-key` 保留轮询渲染下的展开状态。
