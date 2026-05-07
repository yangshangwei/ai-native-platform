# Fix Note — Claude Code 上下文准备死循环修复

**Task**: `05-06-claude-code-live-log` (B-path)
**Branch**: main (working tree)
**Date**: 2026-05-07

## What was wrong

`context_pack` stage 在 wreq_d7451fb4063c / run_a5e9a2160a 实地观察到：起于 22:16:39，死于 22:26:45，**整 10 分钟 = `claude-code.ts:57 DEFAULT_TIMEOUT_MS`** 的硬超时 SIGTERM (exit 143)。Live log 揭示死循环模式：

```
message_stop → user-level Stop hook (bun-runner.js worker-service.cjs hook claude-code summarize)
             → Hook error: Transcript path missing — runner worktree path 与用户日常 transcript 路径不同
             → Claude Code 把错误回灌为 isSynthetic:true user message
             → 模型再答 "Done." → message_stop → 又触发 hook → ...
```

`meta:finished {timedOut:true, resultSeen:false, graceShutdown:false}` 确证模型从未到达 `result` 事件，是被外部超时杀掉的。

附带毛病：context_pack 阶段模型把 user title 当成实现任务做了 ~1900 个 partial-delta 事件的实现规划（建议变量名、列编辑点、深度 reading），不是只产出 `context_pack.md` 摘要。

## Root cause

1. **主因**：Runner spawn `claude --print --output-format stream-json` 时**默认加载用户全局 `~/.claude/settings.json`**，里面挂着的 Stop hook 在 worktree 路径下找不到 transcript 文件，每次 message_stop 都失败回灌成 synthetic user，无限循环到硬超时。
2. **副因**：context_pack 的 system prompt 没有限制模型行为边界，user title 描述的是后续阶段才该做的工作，模型理解错就深度发挥。

## Fix mechanism

### 试过的方案 vs 实际采用

| 方案 | 验证结果 |
|---|---|
| `CLAUDE_DISABLE_HOOKS=1` 环境变量 | ❌ Claude CLI 无此 env var |
| `--bare` | ❌ 同时禁 keychain，丢 OAuth |
| isolated HOME | ❌ 同样丢登录态 |
| `--settings '{"hooks":{...all-empty}}'` 覆盖 | ❌ **E2E 实测仍触发 SessionStart hook** —— `--settings` 是 merge 不是 replace，对 hooks key 无屏蔽效果 |
| **`--setting-sources project,local` + 手动转发用户 env 块** ✅ | E2E 实测成功（见下） |

### 关键发现：用户 env 块需要单独转发

用户 `~/.claude/settings.json` 里有 `env` 块：
```json
{ "env": { "ANTHROPIC_AUTH_TOKEN": "...", "ANTHROPIC_BASE_URL": "https://anyrouter.top", ... } }
```
这是第三方 router 的 auth 配置（不是 OAuth），由 Claude CLI 在加载 settings.json 时注入子进程环境。

`--setting-sources project,local` 跳过整个 user-level 文件，**会同时丢 hooks 和 env**。所以必须在 runner 这边读 `settings.json` 的 env 块、手动塞进 spawn 子进程的 environment。这样既屏蔽 hooks 又保住 auth。

### 改动清单 (5 个文件)

| 文件 | 改动 |
|---|---|
| `apps/runner/src/agents/claude-code.ts` | spawn 默认加 `--setting-sources project,local` 跳 user-level settings；env var `AINP_CLAUDE_LOAD_USER_SETTINGS=1` 是调试逃生口；新增 `readUserSettingsEnv(claudeConfigDir, home)` helper 解析 `~/.claude/settings.json` 的 env 块；非 isolated HOME 模式下、`keepUserHooks=false` 时把这些 env vars 注入 childEnv（不覆盖已有）；`emitMeta(started)` payload 加 `userHooksOverridden:boolean`；`buildPrompts` produce_file 模式针对 `stage='context_pack'` 加 CONTEXT-PACK CONSTRAINTS 禁令 |
| `apps/runner/src/agents/coordinator/llm-fallback.ts` | `runClaudeOneShot` 同步加 `--setting-sources project,local`；spawnCandidate 镜像 claude-code 的 env propagation 逻辑（限定 `backend === 'claude_code'` 且未 isolated 时）；从 `../claude-code` 复用 `readUserSettingsEnv` |
| `apps/runner/test/claude-code-backend.test.ts` | +3 测试：默认参数含 `--setting-sources project,local` / opt-in 时不含 / context_pack stage 的 systemPrompt 含 `CONTEXT-PACK CONSTRAINTS` |
| `apps/runner/test/coordinator-llm-fallback.test.ts` | +2 测试：默认参数含 / opt-in 时不含；fakeClaudeCoordinatorBin augment 了 `CAPTURE_COORD_ARGS` env 来捕 args；afterEach 补 `AINP_CLAUDE_LOAD_USER_SETTINGS` 还原 |
| `.trellis/spec/runner/backend/agent-backend-runtime.md` | 写入新契约：`--setting-sources project,local` 默认、user env 块需手动转发以保留第三方 auth、`AINP_CLAUDE_LOAD_USER_SETTINGS=1` 调试 opt-in、`emitMeta:started.userHooksOverridden` 必填、`stage='context_pack'` 必含 CONTEXT-PACK CONSTRAINTS；Tests Required 区同步加测试要求 |

## Validation

### 自动化测试
- `bun x --bun vitest run apps/runner/test/claude-code-backend.test.ts apps/runner/test/coordinator-llm-fallback.test.ts` — **20/20 ✓**
- `bun run typecheck` 全包 — exit 0 ✓

### 端到端实测 (run_4c1a113d0216, project=uom2026)

| 指标 | 期望 | 实际 |
|---|---|---|
| context_pack 完成时间 | < 3 分钟 | **1 分 23 秒** ✓ |
| `meta:finished.exitCode` | 0 | **0** ✓ |
| `meta:finished.timedOut` | false | **false** ✓ |
| `meta:finished.resultSeen` | true | **true** ✓ |
| 事件流出现 `[hook→]` | 否 | **0 次出现** ✓ |
| 出现 `Stop hook feedback` 或 `Transcript path missing` | 否 | **0 次** ✓ |
| OAuth/第三方 auth | 不报 "Not logged in" | **claude-opus-4-7[1m] 正常使用** ✓ |
| context_pack.md 产出 | 非空 | **2444 字节** ✓ |
| 自动推进到 requirement stage | bonus | **2 分 02 秒通过** ✓ |
| 最终状态 | 推进或等审批 | **awaiting_human at requirement_gate**（正确） ✓ |

### 反例（修复前）作为基线

| run_id | 时长 | exitCode | timedOut | resultSeen |
|---|---|---|---|---|
| run_a5e9a2160a (用户截图所示) | 10:00.000 | 143 | true | false |
| run_4c1a113d0216 (修复后) | **1:23.527** | **0** | **false** | **true** |

## Out of scope (按方案 A)

- UI live log 三档展示（事件聚合 + 折叠区）— 已注入姐妹任务 `05-06-optimize-claude-code-live-log-output` 的 PRD `Diagnostic Note`，按它原节奏推进。
- `~/.claude/settings.json` 的 Stop hook 本身行为不改，是用户域。

## Risks / Rollback

- 默认 `--setting-sources project,local` 让 runner 不加载用户**项目无关**的 hooks/permissions/MCP/agent overrides 等。env 块是手动转发的，覆盖面只有 `env` 一项；其它字段（model 默认、includeCoAuthoredBy 等）静默丢失。已知不影响 runner 路径功能，但若用户依赖 user-level 自定义 agents 或 MCP 服务器，可临时 `AINP_CLAUDE_LOAD_USER_SETTINGS=1` 找回旧行为，同时 `meta:started.userHooksOverridden:false` 会标记。
- 回滚：`git revert` 5 文件改动；prompt 收紧的部分独立可单独回滚。

## Sister-task linkage

- 把诊断（事件 4 类：`assistant`(全文+partial)、`tool_use/tool_result`、`meta`、`system status`、isSynthetic user）作为 input 注入到 `.trellis/tasks/05-06-optimize-claude-code-live-log-output/prd.md` 末尾的 "Diagnostic Note" 段（已写）。建议**这条 fix 落地后**再开那条 UI 任务，否则 UI 测试会被噪音淹没难以验证。当前 fix 已落地，那条任务可开工。