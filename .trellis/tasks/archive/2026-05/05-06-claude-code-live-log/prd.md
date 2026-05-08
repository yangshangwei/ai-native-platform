# 修复 Claude Code 上下文准备死循环并改进 live log 可读性

## Goal

彻底修复 `context_pack` 阶段在用户全局 Stop hook 找不到 transcript 时陷入的 message_stop ↔ Stop-hook-fail ↔ synthetic-user-message 死循环（10 分钟硬超时被 SIGTERM，exit 143），并顺手收紧 prompt 和 UI 日志展示，让上下文准备又快、又对、又能看懂。

## What I already know

### Bug 现场 (本会话现场实测)

* `wreq_d7451fb4063c` / `run_a5e9a2160a…` 在 22:16:39 起、22:26:45 死，整 10 分钟 = `claude-code.ts:57 DEFAULT_TIMEOUT_MS`。
* `[meta:finished] {exitCode:143, timedOut:true, resultSeen:false, graceShutdown:false}` —— 模型从未达到 `result` 事件就被 SIGTERM。
* 死循环模式（事件 2859 起反复）：
    ```
    message_stop → Stop hook 调 bun-runner.js worker-service.cjs hook claude-code summarize
                 → Hook error: Transcript path missing or file does not exist:
                   /Users/artisan/.claude/projects/-Users-artisan--ai-native-worktrees-…/40af23d0-….jsonl
                 → Claude Code 把错误回灌为 synthetic user (isSynthetic:true)
                 → 模型再答 "Done." → message_stop → 又触发 hook → ...
    ```
* 顺带毛病：模型在前期 ~1900 个事件里把 `context_pack` 当作实现任务做（"建议变量名 disableLoginCode"、"`<a-form-model-item prop=\"code\">`"），不是只产出 `context_pack.md` 摘要。
* UI 噪音：partial delta（每几个 token 一行）+ `[meta:*]` + `[system] status` + isSynthetic user 全部展平在主流上，淹没主线。

### 核心代码定位

| 关注点 | 文件:行 |
|---|---|
| Claude CLI spawn + 参数 | `apps/runner/src/agents/claude-code.ts:155-211 invokeCli` |
| 现有 HOME 隔离开关（重武器，会丢登录） | `apps/runner/src/agents/claude-code.ts:196-203` (`AINP_CLAUDE_HOME_ISOLATION`) |
| 硬超时 / grace 退出 | `apps/runner/src/agents/claude-code.ts:213-240` |
| Prompt 构造（`produce_file` 模式） | `apps/runner/src/agents/claude-code.ts:307-385 buildPrompts` |
| context_pack tool 白名单 | `apps/runner/src/agents/claude-code.ts:388-401 computeAllowedTools` |
| stream-json 解析（产 7 类事件） | `apps/runner/src/agents/claude-code-parser.ts:21-205` |
| UI live log 渲染 + SSE | `apps/web/src/main.ts:4323-4448` (`appendStreamEvent` / `attachStream`) |
| UI 事件→display lines | `apps/web/src/main.ts` `buildStreamDisplayLines` / `renderStreamDisplayLine` (位置 4360, 4388) |
| 现有 UI 优化任务（重叠 item 3） | `.trellis/tasks/05-06-optimize-claude-code-live-log-output/prd.md` |

### Claude Code CLI 现成 knob (从 `claude --help` 实测)

* **`--setting-sources <user,project,local>`** —— 传子集即可不加载 user-level settings；OAuth/keychain 不在 settings.json，**不受影响**。✅ 首选
* `--bare` —— 不只跳 hooks，连 keychain 也跳，**会让我们丢 OAuth**。❌
* `--settings <file-or-json>` —— 是**叠加**而非替换 source；单独用不能屏蔽 user-level hooks。
* `--include-hook-events` —— 反向，输出 hook 生命周期事件，diagnostics 用，本任务不需要。
* `CLAUDE_DISABLE_HOOKS` / `CLAUDE_NO_HOOKS` 等 env var —— **不存在**（CLI 里查无）。

## Assumptions (temporary)

* `--setting-sources project,local`（甚至 `local` 单独）能够让子进程不加载 `~/.claude/settings.json` 里的 hooks，从而打破死循环 —— **需研究子代理交叉验证 + 实测验证**。
* 现有 `--add-dir` `--allowed-tools` `--disallowed-tools` 等 flags 不受 `--setting-sources` 影响（它们是 CLI flag，不是 settings.json 字段）。
* Coordinator 调用 Claude（在 `coordinator/llm-fallback.ts`）走的是同一个 spawn 路径，应一并享受到修复。

## Open Questions

* (resolved) ~~范围切分~~ → **方案 A**：本任务只做 item 1+2 (runner reliability)；item 3 (UI 聚合) 留给现有 planning 任务 `05-06-optimize-claude-code-live-log-output`，把本次诊断的事件三分类（`[meta:*]` / `[system] status` / isSynthetic user）作为输入注入它。
* (resolved) ~~Hook 屏蔽颗粒度~~ → 默认 `--setting-sources project,local`，**附带 env var `AINP_CLAUDE_LOAD_USER_SETTINGS=1`** 作为调试逃生口（用户在排查 hook 行为时能临时拉回 user-level settings）。这样既默认安全又留观察窗口。

## Requirements (evolving)

### R1 (item 1) — 阻断 user-level Stop hook 死循环

* 在 `claude-code.ts:invokeCli` 调用 `--setting-sources` 让子进程不加载 user-level settings.json。
* 不破坏 OAuth/keychain 登录态、不破坏 isolated HOME 开关、不破坏 coordinator/llm-fallback 已有逻辑。
* 加一条 emit/log 让用户能在日志里看到 "user settings skipped" 的事实。

### R2 (item 2) — 收紧 context_pack prompt

* 在 `buildPrompts` 的 `produce_file` 分支里，针对 `stage === 'context_pack'` 增加显式禁令：
    * 不做实现规划、不建议变量名、不做"如何修改 X"的方案性分析。
    * 只列：项目目录结构关键路径 / 已有可复用资料 / 后续阶段会用到的事实。
    * 强制产出体量上限（如 ≤2KB markdown）以兜底超长输出。

### R3 → 已切出（方案 A）

UI 三档展示工作交给 `.trellis/tasks/05-06-optimize-claude-code-live-log-output/`，本任务**不**涉及 `apps/web/`。我会在该任务的 prd.md "Open Questions" 末尾追加一条："本次诊断的事件分类（`[meta:*]` / `[system] status` / isSynthetic user / partial delta）应作为聚合默认折叠区的判定依据"作为输入。

## Acceptance Criteria (evolving)

* [ ] 跑一个 uom2026 的 captcha-switch 任务，`context_pack` 阶段在 < 3 分钟内成功产出 `context_pack.md`，事件流里没有任何 `Stop hook feedback` / `Transcript path missing` 出现。
* [ ] meta:finished 事件 `resultSeen=true`、`exitCode=0`、`timedOut=false`。
* [ ] OAuth 仍然有效：Claude `--print` 调用不报 `Anthropic auth required` 之类的错（验证：跑一个 happy-path 任务到 requirement 阶段不报错）。
* [ ] 单测：`claude-code.test.ts` 添加用例验证默认 spawn 参数包含 `--setting-sources project,local`，且不含 `--bare`。
* [ ] 单测：`AINP_CLAUDE_LOAD_USER_SETTINGS=1` 时 spawn 参数**不**包含 `--setting-sources`（让 user-level 重新加载）。
* [ ] 单测：`buildPrompts` 在 `stage='context_pack'` 时返回的 system prompt 包含明确的"不要做实现规划"约束（grep 字符串 + 合理上限提示）。

## Definition of Done

* Tests added/updated (vitest + 必要时 e2e snapshot)
* Lint / typecheck / CI green
* `.trellis/tasks/05-06-claude-code-live-log/fix-note.md` 写收尾笔记
* 如选 Q1 选项 a，关闭 / 标 superseded 现有 `05-06-optimize-claude-code-live-log-output` 的相关项；选项 b 则 archive 那条
* `agent-backend-ui.md` spec 同步（如果 UI 行为变更）
* 不引入 isolated HOME / `--bare` 这种重武器作为默认

## Out of Scope (explicit)

* 修改用户全局 `~/.claude/settings.json` —— 这是用户域，runner 不应碰。
* 改 Claude CLI 自身行为 / 提交上游补丁。
* 把 live log 改成完整终端模拟器。
* 改 stream-json 协议或 API 存储的原始 payload。

## Technical Approach (preliminary)

```ts
// apps/runner/src/agents/claude-code.ts:163-177
const args = [
  '--print',
  '--output-format', 'stream-json',
  '--verbose',
  '--include-partial-messages',
  '--no-session-persistence',
  // NEW: skip user-level settings.json so user-global hooks (Stop hook etc.)
  // don't fire inside runner-driven sessions. Keychain/OAuth still work.
  // Escape hatch: AINP_CLAUDE_LOAD_USER_SETTINGS=1 keeps user settings on for diagnostics.
  ...(process.env.AINP_CLAUDE_LOAD_USER_SETTINGS === '1'
    ? []
    : ['--setting-sources', 'project,local']),
  // ...
];
```

```ts
// apps/runner/src/agents/claude-code.ts:336 buildPrompts (produce_file)
if (skill.stage === 'context_pack') {
  sysLines.push(
    'CONTEXT-PACK CONSTRAINTS:',
    '- Your job is ONLY to summarize reusable repo facts for downstream stages.',
    '- DO NOT plan how to change the code, propose variable names, or list edit sites.',
    '- Keep the output concise (≤ 2KB). Brief bullet points beat long prose.',
    '',
  );
}
```

UI 三档展示交给现有 planning 任务，本任务**不动 `apps/web/`**。

## Decision (ADR-lite)

待 Open Questions 解答后回填。

## Research References

* `claude --help` 实测 (本会话内) — `--setting-sources <user,project,local>` / `--bare` / `--settings <file-or-json>` / `--include-hook-events` 的语义直接来自 CLI 自带帮助，是最权威 source；不再单独建 research 文件。
* `apps/runner/src/agents/claude-code.ts:193-202` 现有 `AINP_CLAUDE_HOME_ISOLATION` 注释佐证：isolated HOME 会丢 OAuth/keychain。

## Technical Notes

* Live diagnostic 来自本会话 Chrome DevTools MCP 实地走查 `wreq_d7451fb4063c`：完整因果链已写在上文 "Bug 现场"。
* 现有 `AINP_CLAUDE_HOME_ISOLATION` 注释 (`claude-code.ts:193-202`) 警告 isolated HOME 会丢 OAuth/keychain，这印证了为什么不该把它当默认。
* `~/.claude/CLAUDE.md` 项目记忆里写明："Claude Code CLI 调用必须实时流式 — 用 `claude --output-format stream-json` 行级解析，console + UI 同等延迟，禁止 buffer" —— R3 设计要尊重这条（聚合可以做但不能引入 buffer 延迟）。
