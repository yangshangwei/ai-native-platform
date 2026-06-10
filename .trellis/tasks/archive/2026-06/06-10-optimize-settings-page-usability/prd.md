# 优化运行配置页面可用性

## Goal

将“运行配置”页面从面向开发者的配置表，改成清晰的运行状态与策略控制台。用户应先看到系统是否可运行、配置是否有变更、需要处理什么；只有需要排查或高级调整时，才展开 technical details。

## What I already know

* 用户反馈截图显示：顶部技术状态卡、配置表、runner/build/env 信息同时出现，页面像数据库浏览器，首屏信息层级混乱。
* 需要延续新建任务、工作台、项目接入页的优化方向：默认面向用户任务，不把工程诊断放在主视觉层级。
* 现有实现是 vanilla TypeScript SPA，设置页由 `apps/web/src/main.ts` 渲染，纯 projection 在 `apps/web/src/settings-projection.ts`。

## Requirements

* 顶部技术状态在运行配置页合并为一个“运行状态”摘要，不再显示 5 个同权技术卡。
* 首屏增加运行状态、配置变更、常用操作三块摘要，让用户先知道能不能跑、改了什么、下一步能做什么。
* 配置分类使用用户语言：任务理解、提示词、运行环境、上下文策略。
* 配置项默认展示用户可读名称、作用说明、当前值、状态、风险等级。
* 原始 key、source、schema、min/max 等技术细节放入折叠区。
* Runner / Build Env 诊断默认折叠，摘要只显示可用性。
* 保留现有保存、恢复默认、查看历史能力，不改变 API 或配置存储协议。
* 桌面和移动端无明显横向溢出；长 key、长 prompt、长路径可换行或折叠。

## Acceptance Criteria

* [x] 运行配置页顶部不再显示 Project / Branch / Runner / Agent Backend / Build Env 五个同权状态卡。
* [x] 首屏有运行状态、配置变更、常用操作摘要。
* [x] 配置 tabs 使用“任务理解 / 提示词 / 运行环境 / 上下文策略”。
* [x] 配置卡默认是面向用户的摘要，不直接暴露 raw key 作为主标题。
* [x] raw key、source、类型约束等技术信息进入详情折叠区。
* [x] Runner / 构建环境诊断默认折叠。
* [x] 现有单项保存、恢复默认、历史查看能力可继续使用。
* [x] 桌面和移动端截图无明显横向溢出。
* [x] 类型检查、测试和截图验证通过，或记录无法验证原因。

## Verification

* `bun run typecheck` passed.
* `bun test` passed: 615 tests.
* Playwright screenshots checked against `http://localhost:5183/#settings`:
  * `/tmp/ainp-settings-desktop.png`
  * `/tmp/ainp-settings-mobile.png`
* Horizontal overflow check passed:
  * desktop `scrollWidth=1280`, `clientWidth=1280`
  * mobile `scrollWidth=390`, `clientWidth=390`
* Resume verification on 2026-06-10 passed:
  * `bun run typecheck`
  * `bun test` — 615 pass, 0 fail
  * `python3 ./.trellis/scripts/task.py validate 06-10-optimize-settings-page-usability`
  * Headless Chrome checked `http://localhost:5183/#settings` with screenshots:
    * `/tmp/ainp-settings-desktop-current.png`
    * `/tmp/ainp-settings-mobile-current.png`
  * Headless Chrome assertions passed: topbar only shows “运行状态”, overview has 3 cards, tabs are “任务理解 / 提示词 / 运行环境 / 上下文策略”, runtime diagnostics and technical details are folded by default, desktop/mobile have no horizontal overflow.

## Notes

* The existing API server on `:8787` was accepting connections but `/api/*` requests hung, so visual verification used a fresh API on `:8797` and web server on `:5183`.

## Out of Scope

* 不改变配置 registry、override、audit API。
* 不引入新前端框架或依赖。
* 不重做项目接入、新建任务或工作台页面。

## Technical Notes

* `buildSettingsViewModel()` 已经提供 summary / tabs / rows，可扩展投影字段而不把配置展示逻辑全部塞进 renderer。
* `renderSettingsPage()`, `renderConfigSection()`, `renderConfigRow()` 是主要 UI 改造点。
* 需要继续使用 DOM `textContent` / `el()` 构建，避免 HTML 字符串注入。
