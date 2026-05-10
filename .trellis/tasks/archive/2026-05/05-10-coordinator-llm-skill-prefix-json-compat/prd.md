# 兼容 Coordinator LLM 输出中的 Skill 注入文本

## Goal

Coordinator 使用 Codex / Claude Code 做一次性 LLM 分诊时，需要兼容用户本地安装 Skill 后产生的人类可见前缀、提示、markdown 或其他非 JSON 包裹文本；保留 Skill 加载行为，但让机器协议解析更宽容，优先从输出中提取合法 Coordinator JSON，再把结果以用户友好的自然语言问题展示到前端。

## What I already know

- 用户期望 Codex / Claude Code 中安装的 Skill 继续被加载；不能通过禁用 Skill/用户配置来规避问题。
- 当前失败样例中，Codex 输出以 `Trellis SessionStart 已注入...` 开头，后面才出现 `{"action":"pause_for_...`，导致整段 `JSON.parse()` 失败。
- 当前 `apps/runner/src/agents/coordinator/llm-fallback.ts` 的 `parseDecision()` 只在去掉 code fence 后直接解析整段文本。
- 当前 fallback question `LLM 返回不是合法 JSON，能否再描述一下？` 是技术诊断，不适合直接展示给最终用户。
- 前端 `apps/web/src/main.ts` 正常渲染 `decision.questions[]`；真正需要保证的是后端写入的 `questions[]` 是面向用户的自然语言。

## Requirements

- 保留 Codex / Claude Code 的 Skill / settings 加载行为，不把禁用 Skill 作为修复方案。
- Coordinator LLM 输出 parser 要宽容：当整段不是 JSON 时，能从包含前缀/后缀文本、markdown fence、Skill session notice 的文本中提取并解析第一个合法 JSON object。
- Parser 仍要防御错误：不能把任意文本误判为合法 decision；必须校验 `action` 并走现有 `proceed` / `pause_for_human` / `abort` 分支。
- 当仍然无法解析 JSON 时，用户可见 `questions[]` 要使用自然语言澄清问题，不暴露 `JSON` / `parse` / `LLM` 等技术细节。
- 技术原因仍可保留在 `reason` / 后端细节中，方便调试。
- 覆盖 Codex plain text 和 Claude stream-json 两类输出。

## Acceptance Criteria

- [ ] Codex 输出 `Trellis SessionStart ...\n{"action":"pause_for_human",...}` 时能解析出 JSON decision。
- [ ] Codex 输出自然语言前缀 + fenced JSON + 后缀时能解析出 JSON decision。
- [ ] Claude stream-json 的 assistant text 如果包含 Skill 前缀 + JSON，仍能解析。
- [ ] 完全无 JSON 或 JSON 不完整时，仍降级为 `pause_for_human`，但 `questions[]` 是用户友好自然语言。
- [ ] `reason` 保留 parse failure 摘要用于后端细节诊断。
- [ ] 相关 coordinator LLM fallback 测试通过。
- [ ] `bun run typecheck` 与 `bun test` 通过。

## Definition of Done

- Parser 兼容有 Skill 与无 Skill 两种输出形态。
- 不新增依赖。
- 更新必要的 runtime / coordinator 规范，记录“机器协议输出可被 Skill 文本包裹，parser 要容错提取 JSON”的约定。
- 按 Lore Commit Protocol 提交工作变更；Trellis 任务归档留给 finish-work。

## Technical Approach

在 `apps/runner/src/agents/coordinator/llm-fallback.ts` 中新增纯函数式 JSON 提取逻辑：先尝试原有整段 JSON parse；失败后扫描文本，找到第一个可成功 `JSON.parse` 且形状像 Coordinator decision 的 JSON object。扫描需要支持字符串、转义字符、嵌套对象/数组，避免用简单正则误截断。解析成功后复用现有 decision normalization；解析失败才返回 fallback。

同时把 `COORDINATOR_FALLBACK_LLM_INVALID_JSON_DEFAULT` 改成用户友好的澄清问题，例如“我还需要确认一下需求范围：这是新增能力、修复现有问题，还是一次性验证/冒烟检查？”；把技术错误继续留在 `reason`。

## Decision (ADR-lite)

**Context**: 本地 Agent CLI 可能加载用户安装的 Skill，并在最终消息前注入会话提示或自然语言说明。Coordinator 需要从同一通道获得机器 JSON，但不能要求用户卸载/禁用 Skill。

**Decision**: 保留 Skill 加载，改为容错提取 JSON object；用户可见文本与后端诊断分层。

**Consequences**: Coordinator 对真实 CLI 输出更稳健；parser 稍复杂，需要测试覆盖前缀、fence、后缀、不完整 JSON、无 JSON 等边界。

## Out of Scope

- 不禁用 Codex / Claude Code Skill。
- 不改变 Coordinator 的 action schema。
- 不改前端聊天组件结构，除非实现过程中发现后端无法保证用户友好问题。
- 不重做 LLM prompt 或切换模型/provider。

## Technical Notes

- 主要文件：`apps/runner/src/agents/coordinator/llm-fallback.ts`
- 相关测试：`apps/runner/test/coordinator-llm-fallback.test.ts`
- 配置默认文案：`packages/shared/src/config/defaults.ts`
- 配置注册：`packages/shared/src/config/registry.ts`（若只改默认值，不需要新增 key/count）
- 相关规范：`.trellis/spec/runner/backend/agent-backend-runtime.md`、`.trellis/spec/runner/backend/quality-guidelines.md`、`.trellis/spec/runtime-config-layer.md`
