# 优化 Claude Code 执行日志实时输出

## Goal

优化 Web UI 中 Claude Code 执行日志的实时展示，让用户看到的 live log 更接近“人可读的执行过程”，减少当前每行过短、前缀重复、阅读断裂的问题，同时保留后台真实事件流用于排障和回放。

## What I already know

* 用户反馈：Claude Code 执行日志里很多内容每一行都很短，想确认 UI 输出是否等同于后台实际执行情况，并希望优化实时输出。
* 当前 Web UI 日志面板在 `apps/web/src/main.ts` 的 `renderAgentStreamPanel` / `renderStreamEventLines` 渲染。
* 当前每个 Agent Stream 事件都会被拆成一个或多个 `.stream-line`，每行带 `[sequence backend type]` 前缀。
* Runner 的 Claude Code 后端在 `apps/runner/src/agents/claude-code.ts` 调用 `claude --print --output-format stream-json --include-partial-messages`，按 stdout JSON line 实时消费并发送事件。
* Claude Code parser 在 `apps/runner/src/agents/claude-code-parser.ts` 中把 `stream_event` 映射为 `assistant`，并把 `content_block_delta/text_delta` 直接渲染成 `[claude…] <delta>`；因此 token / 小片段级 delta 会在 UI 中显示成很多短行。
* 结论：当前 UI 是真实后台事件流的逐事件投影，但不是 Claude Code 终端最终排版的一比一显示。短行主要来自 `--include-partial-messages` 的 partial delta 粒度和前端逐事件逐行渲染。

## Assumptions (temporary)

* 用户已选择默认“可读聚合模式”：连续 Claude assistant 文本 delta 应合并成更自然的段落/块。
* 后台应继续保留完整事件 payload 和 sequence，避免为了美观牺牲可追溯性。
* 优化优先放在 Web UI 展示层，必要时小幅调整 parser 的 human-readable text，但不改变 API 存储的原始 payload。

## Open Questions

* 已确认：默认采用可读聚合模式。

## Product Decision

* 默认展示：可读聚合模式。
* 连续 Claude assistant 文本增量应合并为同一个可读输出块。
* 工具调用、工具结果、stderr、result、system/meta 等非连续正文事件仍保持独立边界。
* 本任务不强制加入 Raw Events 开关；但实现应避免破坏未来增加 raw/debug 模式的可能性。

## Requirements (evolving)

* 日志面板默认采用可读聚合模式，减少连续 assistant partial delta 造成的短行噪音。
* 日志仍需保持 live tail：新事件到达后无需刷新即可看到输出增长。
* tool_use / tool_result / stderr / result 等关键事件应保留清晰边界。
* 历史回放与 SSE 重连仍需按 sequence 去重，不丢事件。
* 不应破坏现有 backend-specific 标题、状态显示和 reconnect 行为。

## Acceptance Criteria (evolving)

* [x] 产品偏好已确认：默认采用可读聚合模式。
* [ ] 连续 Claude assistant text delta 默认在 UI 中合并为更长的可读块或段落，而不是每个 delta 一行。
* [ ] 用户仍能看到工具调用、工具结果、stderr、最终 result 等事件的边界和状态。
* [ ] 保留 raw/debug 能力：至少可以从事件 prefix、payload 回放或可切换视图确认原始事件序列。
* [ ] SSE live append、历史回放、`sinceSeq` 去重行为不回退。
* [ ] 相关 parser / stream rendering 测试覆盖新增行为。

## Definition of Done (team quality bar)

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes
* Rollout/rollback considered if risky

## Out of Scope (explicit)

* 不改 Claude Code CLI 的真实执行协议。
* 不丢弃或压缩 API 存储的原始 stream payload。
* 不把日志面板改成完整终端模拟器，除非后续确认这是明确目标。

## Technical Notes

* Relevant files inspected:
  * `apps/web/src/main.ts` — stream panel rendering, SSE attach/append/dedupe.
  * `apps/web/index.html` — `.stream-body`, `.stream-line`, `.stream-prefix` styles.
  * `apps/runner/src/agents/claude-code.ts` — Claude CLI spawn and stdout/stderr stream consumption.
  * `apps/runner/src/agents/claude-code-parser.ts` — stream-json → human-readable text mapping.
  * `.trellis/spec/web/frontend/agent-backend-ui.md` — live execution log contract.
* Current implementation is faithful at event level: each stored/broadcast event maps to visible rows. The readability problem is presentation granularity, not evidence fabrication.


## Scope Extension: 放大查看 / 录屏模式

用户反馈截图显示 Claude Code 执行日志位于右侧窄栏，录屏时只占右下角小区域，不方便观看。已确认按推荐方案执行。

### Product Decision

* 保留右侧日志卡片作为概览。
* 在日志标题区域增加“放大”入口，打开大尺寸 overlay / modal 日志视图。
* 放大视图面向录屏观看：更大区域、更大字号、减少周边干扰。
* 放大视图复用当前 live stream cache 与可读聚合 renderer，不改变 Runner / API stream 协议。
* 本轮 MVP 不强制实现 Raw/Readable 切换、下载日志、复杂过滤；保留未来扩展空间。

### Requirements

* 日志卡片标题区提供明显的放大/关闭入口。
* 放大视图应覆盖主要屏幕区域，日志 body 接近全屏高度，适合录屏。
* 放大视图必须继续实时更新，复用同一 run 的 SSE 事件缓存。
* 放大视图默认使用可读聚合模式。
* 放大视图需保留 backend-specific 标题、live/error/disconnected 状态、run id 与 event count。
* 关闭放大视图后，原右侧日志卡片仍正常工作且保持 auto-tail 行为。
* 连续 hook/system 噪音可通过现有可读聚合或样式弱化改善；如果本轮实现折叠成本较高，可作为后续优化，不阻塞 MVP。

### Acceptance Criteria

* [ ] 用户可以从 Claude Code 执行日志卡片打开大尺寸查看模式。
* [ ] 大尺寸查看模式占据主要 viewport，日志内容明显大于右侧窄栏展示。
* [ ] 大尺寸查看模式与原面板显示同一实时事件流；新事件到达后两处视图一致更新。
* [ ] 关闭大尺寸查看模式不会断开 SSE，也不会清空已缓存事件。
* [ ] 新 UI 状态和渲染逻辑有测试覆盖或通过现有 stream-rendering 测试间接保护。

## Diagnostic Note (2026-05-07，从姐妹任务 `05-06-claude-code-live-log` 注入)

实地走查 `wreq_d7451fb4063c` 的 live log 后确认了具体的"噪音类型"细分。本任务在实现可读聚合时建议把事件分两层处理：

**主区（默认展示）**
* `assistant` 完整文本（合并所有 partial deltas，token 级 delta 不再独立成行）
* `assistant.tool_use` 摘要（如 `[tool→ Read] {file_path:...}`）
* `user.tool_result` 摘要（如 `[tool← ok] ...`）
* `result` 终事件（含 cost / duration）
* `stderr`

**折叠区（默认收起，"原始事件"开关展开）**
* `[meta:*]`（runner 自己埋的 started / finished）
* `[system] status` 心跳 / hook lifecycle
* **`isSynthetic: true` 的 user message**（典型来源：Stop hook feedback 失败回灌；这种事件**不是用户行为**，混在主流里会让人误以为是真用户输入）
* `--include-partial-messages` 的 `content_block_delta.text_delta` / `input_json_delta`（保留在折叠区作为高保真证据，但不在主区刷屏）

判定锚点（落到 parser 或前端 reducer）：
* 是否 `partial delta` → 看 `payload.type === 'stream_event'` + `payload.event.type === 'content_block_delta'`（参见 `apps/runner/src/agents/claude-code-parser.ts:136-164`）
* 是否 `synthetic user` → 看 `payload.message.isSynthetic === true` 或 `payload.isSynthetic === true`
* 是否 `meta` → `parser.ts:200-205 renderMeta` 已有 `[meta:*]` 前缀，可直接当 marker
* 是否 `system status` → `payload.subtype === 'status'`

实现时注意 `~/.claude/CLAUDE.md` 项目记忆约束："Claude Code CLI 调用必须实时流式 — 用 stream-json 行级解析，console + UI 同等延迟，禁止 buffer"。聚合逻辑要做到**无延迟 flush**：partial delta 一到就 append 到主区当前 assistant 段尾，而不是攒批后再渲染。

姐妹任务 `05-06-claude-code-live-log` 修复了 Stop hook 死循环（`--setting-sources project,local`）和 context_pack prompt 跑偏，落地后这条 PRD 的 acceptance 验证会简单很多——主区不会再被 1900+ 个 partial delta + 反复 `Stop hook feedback` 淹没。建议本任务在那个修复 merge 之后再开工。
