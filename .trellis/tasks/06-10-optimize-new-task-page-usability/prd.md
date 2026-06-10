# 优化新建任务页面可用性

## Goal

将“新建任务”页面从偏工程控制台的界面，优化为面向普通使用者的任务创建入口。默认首屏聚焦“选择项目”和“说明想让 AI 做什么”，将 runner、branch、backend、build env 等技术诊断信息下沉到异常提示或高级设置中。

## What I already know

* 用户反馈：当前页面技术思维太强，展示了很多非重点技术细节，不易用。
* 当前页面顶部展示 Project、Branch、Runner、Agent Backend、Build Env 等状态卡，抢占首屏注意力。
* 当前错误提示显示为“数据刷新失败 / Failed to fetch”，缺少场景化说明和下一步操作。
* 当前表单包含 Task Title / Intent、Source Branch、Agent Backend、端到端闭环等偏技术文案。
* 用户希望按已拆解的 7 项任务推进实现。

## Assumptions (temporary)

* 优化范围限定在 web 前端的新建任务页面与相关展示逻辑，不改变 runner/API 的核心执行协议。
* 高级设置仍需保留给熟悉工程流程的用户，但默认不应干扰主任务创建路径。
* 异常状态需要保持可诊断，但应转换为用户能理解、能行动的提示。

## Open Questions

* 暂无阻塞问题；先按用户已确认的分解推进，遇到产品分歧时再收敛。

## Requirements (evolving)

* 首屏只突出创建任务所需的核心输入。
* 顶部环境状态降级为汇总状态，技术细节下沉。
* 项目加载失败、无项目、runner 离线、backend 未配置等状态要有明确原因和行动入口。
* Source Branch、Type、Flow、起始阶段、Agent Backend 等放入高级设置。
* 右侧说明从“端到端闭环”和命令行说明改为用户能理解的“创建后会发生什么”。
* 禁用态需要说明为什么不能创建任务。

## Acceptance Criteria (evolving)

* [x] 默认首屏表单核心字段聚焦项目、任务目标和可选补充说明。
* [x] 技术状态卡不再作为页面顶部主要视觉元素展示。
* [x] Project 加载失败提示靠近项目选择区域，并提供重试行动。
* [x] 高级工程字段默认折叠，不影响普通用户完成任务创建。
* [x] 右侧说明不直接展示 runner 命令，改为用户视角的步骤说明。
* [x] 无项目或依赖未就绪时，主按钮禁用原因清楚可见。
* [x] 相关前端检查通过，或明确记录未能验证的原因。

## Definition of Done (team quality bar)

* Tests added/updated where behavior is covered by existing test harness.
* Lint / typecheck / targeted tests pass where available.
* Docs/notes updated if behavior or conventions change.
* Rollout/rollback considered if risky.

## Out of Scope (explicit)

* 不重构 runner 执行协议。
* 不引入新的前端依赖。
* 不实现完整项目管理或 backend 配置向导，只优化当前新建任务入口的表达与状态路径。

## Technical Notes

* `apps/web/src/main.ts` owns the new-task page via `renderNewTaskPage()` and global shell via `renderTopbar()`.
* `apps/web/index.html` owns CSS for `.topbar`, `.context-strip`, `.form-card`, `.input-block`, `.ordered-list`, `.notice`, and related utility classes.
* Existing draft preservation for the new task textarea lives in `newTaskFormDraft` and related capture/restore hooks; changes must keep `data-new-task-title` and value hydration intact.
* Agent backend setup contract: missing backend must remain visible and must still block task creation until configured/preflight-ready.
* This task should not add a framework or dependency; use existing vanilla DOM renderer helpers.

## Verification

* `bun run typecheck` passed.
* `bun test` passed: 614 tests, 0 failures.
* Playwright screenshots captured for `http://localhost:5173/#new-task` at desktop and mobile widths; layout renders with simplified top status, default form, folded advanced settings, and user-facing right panel.
