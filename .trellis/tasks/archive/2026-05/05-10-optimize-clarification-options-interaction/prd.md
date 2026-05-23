# 优化澄清问题选项布局与可点击回填

## Goal

让 Coordinator 的「需求澄清」问题卡片更易读、更易回复：修复选项 A 被并入问题标题的问题，并把解析出的选项做成可点击选择，点击后自动把更完整、自然的答复写入回复输入框，降低用户手动组织回答的成本。

## What I already know

* 用户认可当前页面整体视觉风格，但指出截图中「选项 A 和标题并列」：问题标题里残留了 `A. ...`，而下方只渲染出 B/C/D 选项。
* 用户希望选项可以点击选择，并自动回填到回复输入框。
* 回填不应只填选项原文；应结合问题内容生成表达更完整的文字描述。
* 用户提出可能需要区分单选和多选，并希望系统能较智能地提供交互。
* 当前前端在 `apps/web/src/main.ts` 中通过 `parseCoordinatorQuestion()` 解析 Coordinator question，并在 `renderCoordinatorQuestionCard()` 中渲染问题和选项。
* 当前 CSS 在 `apps/web/index.html` 中定义 `.coordinator-question-card`、`.coordinator-option-list`、`.coordinator-option` 等样式。
* 现有解析逻辑先尝试逐行解析 `A./B./C./D.`；当 B/C/D 是独立行、A 内联在标题行时，`lineOptions.length >= 2` 会提前返回，导致 A 留在 prompt 里。
* 当前回复框已经有草稿保存、IME composition 防抖/延迟渲染逻辑；点击选项回填必须复用该草稿机制，不能破坏中文输入体验。

## Assumptions (temporary)

* 选项来源仍主要是 Coordinator 生成的字符串问题，不引入新的后端 schema。
* MVP 可在前端解析和交互层完成，不需要改 API 数据结构。
* 单选/多选可先通过问题文本启发式判断，例如包含「多选」「可多选」「选择所有」「哪些」「包括」等关键词时视为多选；否则默认单选。
* 回填文本可以先用确定性模板生成，不调用 LLM，以保持快速、可预测、离线可用。

## Open Questions

* None — selected approach confirmed: 选中态 + 自动维护完整回复。

## Requirements

* 修复内联首个选项解析：当问题文本形如 `问题？ A. 选项A` 且后续 B/C/D 独立成行时，A 应从标题中剥离并作为第一个选项渲染。
* 选项应变为可点击控件，具备明显 hover/selected/focus 状态，并保持当前卡片视觉风格。
* 点击选项应将答案回填到现有 Coordinator 回复 textarea，并同步保存到现有草稿状态。
* 回填内容应基于问题 prompt + 所选选项生成更自然的描述，例如：`关于「这个验证码开关主要解决什么问题？」，我选择：按环境控制验证码。`
* 采用“选中态 + 自动维护完整回复”模式：点选项后按钮显示已选；回复框中自动生成/更新完整回答；多题自动组合。
* 单选题默认一次只保留该题一个选项；重复选择同题其他选项会替换该题的自动回答。
* 多选题允许同一题多个选项组合成完整回答。
* 多个问题的选择应能组合到同一个回复框里，不覆盖用户已手写的补充内容。
* 不破坏现有手动输入、提交回复、IME 输入保存、轮询刷新体验。

## Acceptance Criteria

* [ ] 截图场景中，标题不再包含 `A. 临时关闭验证码便于测试`，A/B/C/D 全部显示为选项。
* [ ] 用户点击某个选项后，回复输入框出现可提交的完整自然语言回答，而不是只出现选项短文本。
* [ ] 单选题重复点击其他选项时，该题的回填内容更新为最新选择。
* [ ] 多选题可以选择多个选项，并在回复框中表达为完整回答。
* [ ] 用户在回复框中手动补充的文本不会被无意清空。
* [ ] 键盘用户可聚焦并触发选项控件；视觉状态清晰。
* [ ] lint、typecheck、相关测试通过。

## Definition of Done (team quality bar)

* Tests added/updated where appropriate for parsing and reply-draft behavior.
* Lint / typecheck green.
* Docs/spec notes updated if a reusable UI interaction convention emerges.
* Rollback is simple: front-end-only diff can be reverted without data migration.

## Decision (ADR-lite)

**Context**: 选项只是 Coordinator question 字符串中的非结构化片段，但用户需要更快、更自然地回复澄清问题。

**Decision**: 采用“选中态 + 自动维护完整回复”交互。前端解析问题/选项后，为每题维护选择状态；点击选项同步更新 textarea 中的自动回答块，并复用现有草稿保存机制。

**Consequences**: 用户获得类似表单的清晰选中状态，同时仍可编辑最终回复。该方案不改后端 schema，但前端需要对自动生成回答和用户手写补充做稳定分隔，避免覆盖用户补充文本。

## Out of Scope (explicit)

* 不改 Coordinator 后端 prompt/schema 来输出结构化选项。
* 不引入新的 AI/LLM 调用来生成回填文案。
* 不重做整个需求澄清页面视觉系统。
* 不改变工作流请求状态机或消息提交 API。

## Technical Notes

* Likely touched files:
  * `apps/web/src/main.ts` — parsing、选项渲染、点击回填、草稿同步。
  * `apps/web/index.html` — option button/selected/focus 样式。
  * `apps/web/test/*` or new frontend test — parser/interaction coverage if existing test setup supports it.
* Relevant spec context to curate later:
  * `.trellis/spec/web/frontend/index.md`
  * `.trellis/spec/guides/index.md`
* Existing implementation detail:
  * `parseCoordinatorQuestion()` has two paths: line-based option parsing, then inline marker parsing. The line-based early return causes A-inline/B-D-lines mixed format bug.
  * `renderCoordinatorActionPanel()` currently renders static option list and owns `replyArea`/`sendBtn`, so click handlers likely need access to request id / reply area / draft updater.
  * Existing `setCoordinatorReplyDraft(requestId, replyArea.value)` should be used after programmatic fill.
