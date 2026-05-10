# 优化 Coordinator 对话页沟通体验

## Goal

提升任务详情页中 Coordinator 对话区域的沟通效率和易用性，让用户能清楚知道“现在要回复什么、为什么要回复、回复后会发生什么”，同时把开发者实时输出降噪到辅助信息层。

## What I Already Know

- 用户基于截图请求从“方便和用户沟通”和“易用性”角度优化页面，并希望先拉通方案。
- 当前页面展示顺序为：任务标题、Coordinator 对话历史、Coordinator 实时输出、回复输入框。
- 截图中 Coordinator 连续追问多个问题，但问题与用户回复在视觉上没有明显分组，阅读成本较高。
- 截图中实时输出区域默认展开，占据大量首屏空间，容易抢走用户对“需要回复什么”的注意力。
- 当前实现位于 `apps/web/src/main.ts` 的 `renderCoordinatorChatPanel()`，样式主要在 `apps/web/index.html`。
- 现有 spec 要求：主聊天气泡保留给持久化的用户友好 Coordinator 消息；partial Coordinator output 放在 developer/details 区域。
- 现有代码已经保护 Coordinator 回复框的 IME 输入，后续交互改造不能破坏该行为。
- 用户已确认本轮选择 A：只做 MVP 重排，不加入选项快捷选择或完整聊天体验。

## Current UX Problems

- 行动焦点不明确：页面标题是任务名，但对话区缺少明确的“当前等待你回答”聚焦模块。
- 问题不易回复：Coordinator 的问题以自然语言段落出现，没有拆成可操作的单题卡片或快捷选项。
- 用户与 Coordinator 消息区分弱：`你` / `Coordinator` 只是文本标签，缺少左右对齐、背景、层级或时间/状态辅助。
- 实时输出过重：developer log 默认展开且视觉重量高，干扰业务沟通。
- 回复框位置偏低：用户读完问题后需要越过日志区域才能输入，沟通链路被打断。
- 多问题场景缺少进度：页面提示“2 个问题”，但用户不知道已回答哪些、当前还差什么。

## Proposed Direction

### MVP

- 将 Coordinator 对话面板拆成三层：
  - 顶部行动区：显示 `等待你回复`、问题数量、简短说明、主输入入口。
  - 中部对话区：用清晰的消息气泡/卡片呈现用户与 Coordinator 的历史沟通。
  - 底部开发者信息区：实时输出默认折叠，只保留一行摘要和展开入口。
- 对 Coordinator 当前问题做“待回答卡片”呈现：
  - 每个问题单独成块，支持 A/B/C/D 这类选项换行展示。
  - 当前所有待回答问题集中显示在回复框上方。
  - 保留自由文本输入，方便用户补充上下文。
- 输入区固定在当前待回答内容之后，不被实时输出隔开。
- 发送按钮文案改为更明确的 `提交回复`，空内容禁用。
- 状态文案更贴近用户：
  - `Coordinator 对话` → `需求澄清`
  - `需求开始执行前的分诊` → `回答后系统会继续判断任务类型和执行路径`
  - `Coordinator 实时输出` → `开发者日志`

### Nice To Have

- 支持选项 chip 快捷插入/选择，尤其适合 Coordinator 问 “A/B/C/D” 的场景。
- 回复后显示“已提交，Coordinator 重新分诊中”的过渡状态。
- 长对话只展示最近一次待回答问题，历史默认收起为 `查看历史沟通`。
- 对多问题回复提供轻量格式提示，例如 `1. ... 2. ...`，但不强制结构化。

## Requirements

- 用户打开 awaiting clarification 的任务时，首屏必须清楚看到当前需要回复的问题和输入框。
- Developer log 不应默认占据主要视觉空间；它应作为可展开诊断信息存在。
- 对话历史应能快速区分用户消息、Coordinator 消息、当前待回答问题。
- 输入草稿、焦点和 IME 输入保护必须保持现有行为。
- 不改变 Coordinator 消息 API、SSE 协议或后端分诊逻辑。
- 本轮范围限定为 MVP 重排：问题突出、输入框前置、日志默认折叠、消息视觉区分。

## Acceptance Criteria

- [x] awaiting clarification 状态下，待回答问题和回复框位于实时输出之前。
- [x] 实时输出默认折叠，summary 显示 live 状态、request/run id 摘要和事件数。
- [x] Coordinator 与用户消息有清晰视觉区分，长文本换行良好。
- [x] 含 A/B/C/D 的问题以易读的选项列表或 chip 样式展示。
- [x] 输入空内容时发送按钮禁用；输入后可提交。
- [x] 中文 IME 输入过程中，轮询 render 不会丢失组合态、草稿或光标。
- [x] 移动端下问题、输入框、按钮不重叠，按钮不挤压文本。

## Out of Scope

- 不新增验证码开关本身的业务实现。
- 不改 Coordinator 的提问策略、问题数量和后端 API。
- 不新增第三方 UI 依赖。
- 不做完整聊天系统，例如引用、编辑、撤回、附件。
- 本轮不做选项 chip 点击选择、不做历史默认收起、不做提交后复杂过渡态。

## Technical Notes

- Main render target: `apps/web/src/main.ts` `renderCoordinatorChatPanel()`.
- Related stream render: `renderCoordinatorStreamDetails()` and `renderAgentStreamBody()`.
- Style target: `apps/web/index.html`.
- Existing frontend spec: `.trellis/spec/web/frontend/agent-backend-ui.md`.
- Preserve behavior from `.trellis/spec/web/frontend/state-management.md` around user-owned drafts and polling renders.
