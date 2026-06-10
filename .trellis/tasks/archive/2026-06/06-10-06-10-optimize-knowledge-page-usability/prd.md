# 优化知识库页面可用性

## Goal

将“知识库”页面从技术占位页改成项目知识资产工作台。用户应能直接理解知识库在业务中的闭环：任务执行产生经验，人工确认后进入项目知识库，后续任务自动引用，最终提升执行质量。

## What I already know

* 当前截图显示页面只展示 `Knowledge Suggestions` 与 `Knowledge Store`，并把 `runId`、MVP 本地目录说明等技术信息放在主视觉层级。
* 用户明确要求按推荐方案推进，重点不是美化文字，而是让用户方便地确认新知识、查找旧知识、维护过期知识。
* 现有 web 是 vanilla TypeScript SPA，知识库页由 `apps/web/src/main.ts` 渲染；已有 `parseKnowledgeArtifact()` 可以解析候选建议。
* API 已有 `/knowledge-artifacts/projects/:projectId` 读取项目知识资产，页面可以消费该接口，不需要新增后端协议。

## Requirements

* 知识库页顶部技术状态合并为业务状态摘要，不再展示 Project / Branch / Runner / Agent Backend / Build Env 五个同权技术卡。
* 首屏展示知识库概览、待确认建议、已收录知识三个业务区域。
* `Knowledge Suggestions` 改为“待确认建议”，默认解释“为什么值得收录 / 对后续任务有什么帮助 / 来源任务”。
* 空状态使用用户语言，不出现 `Knowledge Candidate`、MVP、本地目录等技术占位文案。
* 已收录知识应按项目展示列表，显示类型、标题/摘要、状态、可信度、最近使用信息。
* 支持 `待确认 / 已收录 / 引用记录 / 维护` 视角，默认优先处理待确认建议；无待确认时突出已收录知识。
* runId、artifact id、uri、sourceRefs 等技术信息放到“来源详情 / 技术详情”折叠区。
* 保留现有接受、编辑、忽略、确认入库能力，不改变 workflow action 或 knowledge gate API。
* 桌面和移动端无明显横向溢出；长标题、路径、引用信息可换行或折叠。

## Acceptance Criteria

* [x] 顶部不再显示 5 个同权技术状态卡，改为“知识状态”摘要。
* [x] 页面首屏有“知识库概览 / 待确认建议 / 已收录知识”。
* [x] 待确认建议卡片包含标题、类型、说明、后续价值、来源任务和操作。
* [x] 空状态不再出现 `Knowledge Candidate`、`Knowledge Store`、MVP 本地目录说明。
* [x] 已收录知识来自 `/knowledge-artifacts/projects/:projectId`，并能显示 accepted/draft/superseded 状态。
* [x] 页面有 `待确认 / 已收录 / 引用记录 / 维护` 视角切换。
* [x] 技术标识与路径类信息进入折叠详情。
* [x] 现有接受、编辑、忽略、确认入库能力可继续使用。
* [x] 类型检查、测试和桌面/移动端截图验证通过，或记录无法验证原因。

## Verification

* `bun run typecheck` passed.
* `bun test` passed: 615 pass, 0 fail.
* `python3 ./.trellis/scripts/task.py validate 06-10-06-10-optimize-knowledge-page-usability` passed.
* API check passed: `GET /api/knowledge-artifacts/projects/uom2026` returned `{ ok: true, artifacts: [] }` in the local verification dataset.
* Headless Chrome checked `http://localhost:5173/#knowledge`:
  * `/tmp/ainp-knowledge-desktop.png`
  * `/tmp/ainp-knowledge-mobile.png`
* Browser assertions passed:
  * Topbar only shows “知识状态”.
  * Overview has 3 cards.
  * Tabs are “待确认 / 已收录 / 引用记录 / 维护”.
  * Old technical placeholder text is absent from the page body.
  * Desktop `scrollWidth=1280`, `clientWidth=1280`.
  * Mobile `scrollWidth=390`, `clientWidth=390`.

## Out of Scope

* 不新增后端接口。
* 不改变知识资产数据模型、promote 流程或 runner 产物协议。
* 不引入 React/Vue/Svelte 或新依赖。
* 不实现全文检索、批量编辑或知识内容在线富文本编辑。

## Technical Notes

* `renderKnowledgePage()`、`renderKnowledgeSuggestion()` 是主要改造点。
* 可以新增前端本地 state 加载 project knowledge artifacts。
* 继续使用 `el()`/`textContent` DOM 构建，避免 HTML 字符串注入。
* 用户自定义展开状态需要 `data-details-key` 保持轮询渲染时不丢失。
