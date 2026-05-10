# 保留 Coordinator 回复框 IME 输入

## 目标

让用户在 `回复 Coordinator…` 文本框里用中文（或其他 IME）输入时，任务详情页的后台轮询不再中断当前正在进行的合成（composition），使拼音、假名、注音等输入能正常完成。

## 背景

* 任务详情页 `apps/web/src/main.ts` 的 `renderCoordinatorChatPanel` 渲染 Coordinator 聊天面板。
* 当 WorkflowRequest 处于 `awaiting_clarification` 时：
  * `loadCoordinatorChat` 每 1500ms 轮询一次。
  * 全局 `loadData` 每 3000ms 再拉一次。
  * 两者都会调用 `render()`，`render()` 会 `clear(root)` 然后重建整棵 DOM。
* 上一次修复（archived `05-03-fix-coordinator-reply-input-reset`，提交 `aae1235`）已经保留：
  * 草稿文本（`coordinatorReplyDrafts: Map<requestId, string>`）
  * 焦点 + 光标选区（`coordinatorReplyFocus`）
  * 渲染期间的 blur guard（`isReplacingAppRootForRender`）
* **未覆盖的场景**：当 textarea 仍处于 IME composition（`isComposing=true`，字符尚未 commit 到 `value`）时触发 `render()`，老节点被移除导致合成中止。已按下但还没选字的拼音丢失，光标跳回，用户感觉"总是被刷新打断，没法正常完成输入"。

## 已知状态

* 受影响文件：`apps/web/src/main.ts`
* 相关 symbol：`render`、`captureCoordinatorReplyComposerState`、`restoreCoordinatorReplyComposerFocus`、`renderCoordinatorChatPanel`、`loadCoordinatorChat`、`isReplacingAppRootForRender`
* 约束：无新依赖；`apps/web/` 是手写 DOM SPA，遵循 `.trellis/spec/web/frontend/state-management.md` 的「Preserve user-owned drafts across polling renders」约定。

## 需求

* 当用户正在 Coordinator 回复框里做 IME composition 时，`render()` 不得销毁承载该 composition 的 textarea 节点。
* 推迟的刷新在 composition 结束后必须至少跑一次，保证用户看到的数据不会"落后太久"。
* 非 composition 状态下 `render()` 的行为（草稿、焦点、选区保留）保持不变。
* 其他页面的 `render()`（非 Coordinator 回复场景）不受影响。
* 没有在输入的时候，轮询行为、间隔、语义保持不变。

## 验收标准

* [ ] 当用户在 `回复 Coordinator…` 里按中文拼音未选字时，触发 `loadCoordinatorChat` 或 3s 页面轮询的 `render()` 调用不会清除正在合成的拼音，光标不跳走。
* [ ] composition 结束（`compositionend`）后，如果在合成期间曾有被推迟的 render，页面会自动补一次 render 以反映最新状态。
* [ ] 没有 composition 时，现有草稿 / 焦点 / 选区保留行为与改动前一致。
* [ ] 发送回复、请求离开 `awaiting_clarification`、切换任务详情页时，pending 的 defer flag 被正确清除，不会遗留状态。
* [ ] `bun run typecheck` 通过。
* [ ] `bunx --bun vitest run` 通过，或失败均为与本改动无关并被记录。

## Definition of Done

* 改动仅限 `apps/web/src/main.ts`（必要时可再碰 projection / 小工具，但不引入新依赖或新文件，除非类型/大小确需拆分）。
* 无新 npm 依赖。
* 用中文和英文 IME 在真实浏览器里手测一次：打字 → 等轮询 → 继续打字 → 选字 → 发送，整个流程不丢字。

## 技术方案

1. 在 `renderCoordinatorChatPanel` 构造 `replyArea` 时，为它挂上 `compositionstart` / `compositionend` / `compositionupdate` 监听。
2. 用一个模块级 `coordinatorReplyComposing: { requestId: string } | null` 跟踪当前正在合成的 textarea。
3. 改造 `render()` 的入口：
   * 如果 `coordinatorReplyComposing` 非空，说明 textarea 正在合成 —— 不做 root rebuild；置一个 `renderPendingDuringComposition = true` 旗标后提前返回。
   * `compositionend` 触发时，如果 `renderPendingDuringComposition` 为真，调度一次 `render()`（放在 microtask/`queueMicrotask` 或 `setTimeout(..., 0)` 里，避免和事件派发同帧）。
4. 在清理路径（`clearCoordinatorReplyComposerState`、发送成功、请求离开 `awaiting_clarification`、切页）里一并清 `coordinatorReplyComposing` 和 `renderPendingDuringComposition`。
5. 保留现有 draft / focus 恢复逻辑不变。

## Decision (ADR-lite)

**Context**: 轮询每 1.5–3 秒重建 DOM；IME composition 是短暂但不可中断的浏览器状态。

**Decision**: 让 `render()` 在 composition 期间短路；composition 结束后补一次 render。不修改轮询间隔，也不重写渲染架构。

**Rejected**:
* 把 textarea 移出 `render()` 重建范围（需要引入 diff/持久节点机制，和现有全量重建架构冲突，改动面过大）。
* composition 期间禁用整个任务详情页的轮询（会让所有后台状态停更，用户体验差）。
* 改成受控组件 + MutationObserver（同样需要重写 DOM 架构）。

**Consequences**: 刷新在 composition 期间短暂 pause（最坏数秒，取决于用户选字节奏）；composition 一结束立刻补刷新。改动面窄，可回退。

## Out of Scope

* Coordinator 后端逻辑或消息 schema。
* 重写 app-wide 渲染架构、引入框架或状态管理库。
* 修改轮询间隔。
* 非 Coordinator 回复场景的其他 textarea / input。

## Technical Notes

* 相关规范：
  * `.trellis/spec/web/frontend/index.md`
  * `.trellis/spec/web/frontend/state-management.md`（草稿/焦点保留约定）
  * `.trellis/spec/web/frontend/component-guidelines.md`
  * `.trellis/spec/web/frontend/quality-guidelines.md`
  * `.trellis/spec/web/frontend/type-safety.md`
  * `.trellis/spec/guides/index.md`
* 参考资料：MDN `compositionstart` / `compositionend` / `InputEvent.isComposing`。
