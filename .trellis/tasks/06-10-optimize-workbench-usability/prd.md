# 优化工作台页面可用性

## Goal

将工作台页面从“系统运行大盘”优化为“我的任务收件箱”。用户进入工作台时应优先看到：现在需要我处理什么、AI 正在做什么、最近完成了什么，而不是 Project / Branch / Runner / Gate / Agent / Report 等工程细节。

## What I already know

* 用户反馈：工作台页面技术感强、信息混杂，截图中顶部技术状态和任务卡片信息层级不清。
* 已确认推荐实施顺序：先做 1+2+4+6，再做 3+5，最后做 7+8。
* 工作台首要问题包括：顶部标题受当前 run 干扰、技术状态卡抢占注意力、待处理内容不突出、任务列表像数据库视图、长 ID/分支溢出。
* 优化范围为 `apps/web` 前端工作台页面，不改变 API/runner 协议。

## Requirements

### 第一批：1 + 2 + 4 + 6

* 工作台顶部标题固定为“工作台”，不再被当前任务标题替代。
* 顶部技术状态合并为一个“执行环境”状态入口；正常时弱化，异常时提示可处理。
* 首屏主区域突出“需要我处理”，展示原因和主操作。
* 用户可见文案替换技术术语：失败 Gate、运行中 Agent、待认领任务、Report、claimed、awaiting_clarification 等。
* 长 ID、分支、报告名、任务标题在卡片/列表中不横向溢出。

### 第二批：3 + 5

* 统计区收敛成用户视角的 3 类：需要我处理、AI 正在执行、最近完成。
* 任务列表按“需要处理 / 进行中 / 已完成 / 全部任务”组织。
* 每行只保留标题、状态、项目、更新时间、主操作。

### 第三批：7 + 8

* 工程诊断信息默认下沉，异常时可展开查看细节。
* 空状态和异常状态提供下一步行动，例如“新建任务”。

## Acceptance Criteria

* [x] 工作台标题固定为“工作台”。
* [x] 顶部不再显示 5 个同权技术状态卡。
* [x] 首屏包含明确的“需要我处理”主区域。
* [x] 工作台文案不暴露 Gate/Agent/claimed/Report 等非必要术语。
* [x] 任务/报告/分支/ID 在桌面和移动端不横向溢出。
* [x] 统计卡片收敛为 3 个用户视角类别。
* [x] 任务列表按用户工作状态分组。
* [x] 无待处理内容时有空状态和“新建任务”行动。
* [x] 类型检查、测试和截图验证通过，或明确记录未能验证的原因。

## Out of Scope

* 不改变 runner/API 工作流语义。
* 不引入新前端依赖或框架。
* 不重做任务详情页。

## Technical Notes

* `apps/web/src/main.ts` owns workbench rendering: `renderWorkbenchPage()`, `renderWorkbenchOverviewPanel()`, `renderTaskListPanel()`, `renderTopbar()`.
* `apps/web/index.html` owns the related styles.
* Existing new-task page changes are not part of this task and should be preserved.

## Verification

* `bun run typecheck` passed.
* `bun test` passed: 614 tests, 0 failures.
* Playwright screenshots captured for `http://localhost:5173/#workbench` at desktop and mobile widths after implementation.
* Mobile screenshot initially exposed long-title overflow; CSS was tightened and screenshots were recaptured successfully.
