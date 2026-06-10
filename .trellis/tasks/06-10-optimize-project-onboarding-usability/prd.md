# 优化项目接入页面可用性

## Goal

将“项目接入”页面从配置后台改成清晰的接入流程。用户应能按顺序完成：选择项目来源、设置默认项、配置 AI 执行方式，并清楚知道何时可以接入项目、已有项目是否可用。

## What I already know

* 用户反馈：项目接入页面展示了过多技术细节，右侧项目卡片 Path / Repo URL / Managed 信息压迫视觉。
* 方案已确认：先做文案替换和顶部状态降噪，再重组左侧表单为三步向导，然后重做检测状态和主按钮，最后优化右侧项目卡。
* 需要与新建任务页、工作台页保持一致：默认面向用户任务，不把工程诊断放在主视觉层级。

## Requirements

* 顶部技术状态在项目接入页合并为“接入状态”，显示有多少项目可用/需要配置。
* 将 `Agent Backend` 等技术文案改成用户语言：`AI 执行方式`、`执行工具`、`待配置`、`未检测`、`检测连接`。
* 左侧表单按 3 步组织：选择来源、设置默认项、配置 AI 执行方式。
* 检测状态改为结果卡，明确未检测、检测通过、检测失败和下一步。
* 主按钮根据状态表达行动或阻塞原因。
* 右侧已接入项目卡默认显示摘要：项目名、来源、默认分支、执行方式状态、可用性。
* 路径、Repo URL、Managed 路径等长文本放入详情折叠区，避免默认视图挤压。
* 长文本在桌面和移动端不横向溢出。

## Acceptance Criteria

* [x] 项目接入页顶部不再显示 5 个同权技术状态卡。
* [x] 左侧表单呈现为 3 个明确步骤。
* [x] 主要文案使用“AI 执行方式 / 执行工具 / 检测连接”等用户语言。
* [x] 检测状态是结果卡，并提供下一步。
* [x] 主按钮禁用或可点时都有清晰语义和阻塞原因。
* [x] 右侧项目卡默认是摘要视图，长路径进入详情折叠区。
* [x] 桌面和移动端截图无明显横向溢出。
* [x] 类型检查、测试和截图验证通过，或记录无法验证原因。

## Verification

* `bun run typecheck` passed.
* `bun test` passed: 614 tests.
* Playwright screenshots checked:
  * `/tmp/ainp-projects-desktop.png`
  * `/tmp/ainp-projects-mobile.png`

## Out of Scope

* 不改变项目接入 API、runner 协议或后端存储。
* 不引入新前端依赖或框架。
* 不重做设置页或任务详情页。

## Technical Notes

* `apps/web/src/main.ts` owns project onboarding rendering: `renderProjectsPage()`, `renderProjectForm()`, `renderAgentBackendPanel()`, project cards.
* `apps/web/index.html` owns project card and form styles.
