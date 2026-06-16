# Research: 需求澄清(Coordinator Clarification) 配置系统与提示词构造现状

- **Query**: 为 "让澄清提问风格可配置、新增 grill-me 风格" 改造任务做现状调研，按 7 点定位配置 schema、默认值、加载/覆盖机制、LLM 提示词构造、单题 vs 批量、可扩展点、前端对接。
- **Scope**: internal
- **Date**: 2026-06-16

## 总体架构速览

澄清逻辑分两层，再叠加一个集中式 runtime config 层：

- **规则快路径**（纯函数）：`packages/shared/src/coordinator/rules-core.ts` —— 关键词/正则/置信度打分。API 与 runner 共用。
- **LLM 兜底**：`apps/runner/src/agents/coordinator/llm-fallback.ts` —— 规则置信度低于阈值时 spawn `claude`/`codex` CLI 做一次性分诊。
- **Config 层**：`packages/shared/src/config/{registry,defaults,template}.ts`（schema + 默认值），`apps/runner/src/config-client.ts`（runner 端读取/合并），`apps/api/src/routes/config.ts`（覆盖值的读写 + 审计）。

调用链：`watch.defaultTriage` → `coordinator/index.ts:triageRequest` → 先 `rules.ts:classifyByRules`(读 config + 委托 rules-core)，置信度 < 阈值则 `llm-fallback.ts:classifyByLlm`。

---

## 1. 配置 schema / 类型定义

**Schema 注册表**：`packages/shared/src/config/registry.ts`

- 类型定义 `ConfigEntry` 在 `registry.ts:49-62`：`type`(`'number'|'string'|'string_array'`，见 `registry.ts:47`)、`default`、`description`、`category`、`min`/`max`、`multiline`、`source`。
- 全部 key 集中在 `CONFIG_REGISTRY` 对象 `registry.ts:64-303`，`satisfies Record<string, ConfigEntry>`。key 类型 `ConfigKey = keyof typeof CONFIG_REGISTRY`（`registry.ts:305`）。
- 总数硬编码 29（15 coordinator + 5 skill_prompts + 5 runtime + 4 context_policy），`CONFIG_REGISTRY_KEY_COUNT` `registry.ts:311`，被测试断言。

**coordinator 相关字段全清单**（均 `category: 'coordinator'`，共 15 个）：

| Key | type | registry 行 | 用途 |
|---|---|---|---|
| `coordinator.confidence_threshold` | number(0..1) | `registry.ts:67-75` | 规则置信度 ≥ 此值跳过 LLM 兜底 |
| `coordinator.bug_keywords` | string_array | `registry.ts:76-82` | bug 关键词 |
| `coordinator.feature_keywords` | string_array | `registry.ts:83-89` | feature 关键词 |
| `coordinator.large_scope_keywords` | string_array | `registry.ts:90-96` | 大范围关键词 |
| `coordinator.large_scope_regex` | string | `registry.ts:97-103` | "X系统/Y体系" 正则字面量 |
| `coordinator.refactor_keywords` | string_array | `registry.ts:104-110` | 重构关键词 |
| `coordinator.system_prompt` | string(multiline) | `registry.ts:111-118` | **LLM 兜底分诊 system prompt（输出 schema 钉死在 prompt 里）** |
| `coordinator.fallback.too_short_questions` | string_array | `registry.ts:119-125` | 请求过短时反问的两句 |
| `coordinator.fallback.large_scope_template` | string | `registry.ts:126-132` | 大范围第一句（含 `${trigger}` 占位符） |
| `coordinator.fallback.large_scope_followup` | string | `registry.ts:133-139` | 大范围第二句 |
| `coordinator.fallback.llm_unavailable` | string | `registry.ts:140-146` | CLI 不存在兜底问题 |
| `coordinator.fallback.llm_invocation_failed` | string | `registry.ts:147-153` | CLI 调用失败兜底问题 |
| `coordinator.fallback.llm_empty` | string | `registry.ts:154-160` | LLM 空返回兜底问题 |
| `coordinator.fallback.llm_invalid_json` | string | `registry.ts:161-167` | LLM 非法 JSON 兜底问题 |
| `coordinator.fallback.llm_unknown_action` | string | `registry.ts:168-174` | LLM 未知 action 兜底问题 |

> 注：`runner.coordinator.oneshot_timeout_ms`（`registry.ts:221-229`）归类在 `runtime`，但实际供 coordinator LLM 兜底使用（`llm-fallback.ts:212`）。

`ConfigType` 仅三种（`number / string / string_array`），**没有** enum/select 类型——若要做 "风格下拉选择" 需评估是否新增类型或复用 string。

---

## 2. 默认配置值

全部默认值在 `packages/shared/src/config/defaults.ts`（注释强调 "byte-for-byte 从 runner 转写，shared 不能 import apps/runner"）。registry 通过顶部 import 引用这些常量（`registry.ts:14-44`）。

coordinator 关键默认值位置：

- `COORDINATOR_CONFIDENCE_THRESHOLD_DEFAULT = 0.65` —— `defaults.ts:86`
- 关键词数组 —— `defaults.ts:13-81`（bug/feature/large_scope/refactor）
- `large_scope_regex` = `'(\\S+?\\s*系统|\\S+?\\s*体系)'` —— `defaults.ts:65`
- `too_short_questions` —— `defaults.ts:122-125`
- `large_scope_template`（含 `${trigger}`）/`large_scope_followup` —— `defaults.ts:128-133`
- 五个 `llm_*` 兜底中文文案 —— `defaults.ts:136-152`
- `RUNNER_COORDINATOR_ONESHOT_TIMEOUT_MS_DEFAULT = 30_000` —— `defaults.ts:249`

**`COORDINATOR_SYSTEM_PROMPT_DEFAULT` 完整文本**（`defaults.ts:90-117`，原 hardcode 位置 `coordinator/prompt.ts`）：

```
You are the Coordinator Agent for an AI-native software delivery platform.

Your ONLY job: triage the user's incoming request into ONE of these route cases.

1. feature_clear — clear, well-scoped new capability. The user said WHAT, FOR WHOM, and how to verify success.
2. feature_brainstorm — small feature but missing 1-2 of: target users / success criteria / scope. Ask AT MOST 2 clarifying questions, each with 2-4 concrete options if possible.
3. bugfix — describes broken existing behavior (报错 / 异常 / 不对 / 预期 vs 实际).
4. roadmap_needed — large request that decomposes into multiple features (e.g. "权限系统", "通知中心"). Ask the user to identify 2-3 top sub-capabilities and a minimal closed loop.
5. unclear — too vague to classify; ask for more context.

Hard rules:
- You are NOT writing requirements. You are NOT proposing implementation. You are ONLY triaging.
- If the user came with a solution in mind, FIRST ask what problem it solves before accepting the framing.
- Be a thinking partner, not a recorder. Don't echo the user's words back.
- If you ask questions, ask AT MOST 2.

OUTPUT FORMAT — emit ONE JSON object exactly matching this schema, with NO prose, NO markdown fences, NO preamble:

{
  "action": "proceed" | "pause_for_human" | "abort",
  "routeCase": "feature_clear" | "feature_brainstorm" | "bugfix" | "roadmap_needed" | "unclear",
  "runType": "feature" | "bugfix" | "smoke",
  "reason": "<one short line>",
  "questions": ["<q1>", "<q2>"]
}

If action != "pause_for_human", "questions" MUST be an empty array.
```

> 关键观察：**"提问数量上限"(AT MOST 2) 与 "输出 JSON schema(questions 数组)" 都写死在这一段 system prompt 文本里**，不是独立代码常量。改 grill-me 风格主要就是改这段文本 + 放宽数量约束。

---

## 3. 配置加载/覆盖机制

**读取入口（runner 端）**：`apps/runner/src/config-client.ts` 的 `getConfig<K>(key)`（`config-client.ts:106-124`）。

合并/优先级逻辑：
1. 从 API `GET /config/overrides` 拉取所有 override，按 TTL 缓存（默认 1500ms，`config-client.ts:54-60`；`RUNNER_CONFIG_CACHE_TTL_MS_DEFAULT = 1500` `defaults.ts:261`）。
2. 命中 override 且 `validateConfigValue` 通过 → 用 override（`config-client.ts:110-115`）。
3. override 类型/范围非法 → 警告一次，回退到 `CONFIG_REGISTRY[key].default`（`config-client.ts:116-123`）。
4. API 不可达 → stale-while-revalidate，沿用上次缓存；从未成功过则用编译期默认（`config-client.ts:82-103`）。

**覆盖值存储与写入（API 端）**：`apps/api/src/routes/config.ts`
- `GET /config/registry` 返回 schema（`config.ts:26-31`）。
- `GET /config/overrides` 返回当前所有 override（`config.ts:33-35`）。
- `PUT /config/overrides/:key` 写 override + 审计，写入前 `validateConfigValue` 校验（`config.ts:37-75`）。
- `DELETE /config/overrides/:key` 重置为默认 + 审计（`config.ts:77-99`）。
- 存储在 `store.configOverrides`（DB 行 `OverrideRow`，`config-client.ts:31-37`）。

**覆盖作用域**：**仅 `global`**。`PUT` 写入时 `scope: 'global'` 写死（`config.ts:57`）。`config-client.ts:17-19` 注释明确 "Per-project / per-run scope NOT covered (only global)"。**没有**环境变量覆盖、**没有** per-project 配置文件、**没有** defineConfig/loadConfig 这类文件式配置。

**用户实际改配置的方式**：通过 Web 设置页（`apps/web/src/page-settings.ts`，默认 tab `'coordinator'` 见 `page-settings.ts:68`）调用 `PUT /config/overrides/:key` 写入 DB override，runner 在 ≤1.5s 内通过 `getConfig` 热加载。**不是改文件**。要改默认值本身（影响所有未 override 的环境）则需改 `packages/shared/src/config/defaults.ts` 并发 PR（`registry.ts:6` 注释："Adding/removing a key REQUIRES a code PR; the UI never creates new keys"）。

---

## 4. LLM 回退提问的完整提示词构造

文件：`apps/runner/src/agents/coordinator/llm-fallback.ts` + `coordinator/prompt.ts`。

**System prompt**：直接 `getConfig('coordinator.system_prompt')` 取得（`llm-fallback.ts:211`），即第 2 点那段默认文本（或 override）。不做任何拼接。

**User prompt**：`buildUserPrompt(input.userRequest, input.messageHistory)`（`llm-fallback.ts:213`），定义在 `coordinator/prompt.ts:14-28`：

```ts
export function buildUserPrompt(userRequest, history): string {
  const lines = [`User request: ${userRequest}`, ''];
  if (history.length > 0) {
    lines.push('Conversation so far (most recent last):');
    for (const m of history) lines.push(`  [${m.role}] ${m.content}`);
    lines.push('');
  }
  lines.push('Triage now. Output JSON only.');
  return lines.join('\n');
}
```

→ **messageHistory 全量平铺注入 user prompt**（`[user]/[coordinator]` 前缀，最近的在最后），没有截断/摘要。

**CLI 投递差异**：
- Claude：`--append-system-prompt <system>` + 把 user prompt 作为位置参数，`--output-format stream-json`（`llm-fallback.ts:291-304`）。
- Codex：`system + "\n\n" + user` 拼成 stdin 喂给 `codex exec -`，结果读 `--output-last-message` sidecar 文件（`llm-fallback.ts:331-364`）。

**要求 LLM 输出的 JSON 结构**：schema 钉死在 system prompt 文本内（见第 2 点），`questions: string[]` 字段就来自那里。解析在 `coordinator/decision.ts`：
- `extractDecisionObject` 容错抽取 JSON（剥 markdown fence、扫描花括号候选）`decision.ts:151-164`。
- `parseDecision` 把 `action==='pause_for_human'` 的 `questions` 过滤成 `string[]`（`decision.ts:199-208`）；空/非法/未知 action 各自降级到对应 `fallback.*` 兜底问题（`decision.ts:174-220`）。
- 兜底问题文案由 `loadFallbackQuestions()` 从 5 个 `coordinator.fallback.llm_*` config 并行取得（`llm-fallback.ts:56-65`）。

---

## 5. 单题 vs 批量生成

**当前是一次性批量返回一组问题**：

- LLM 一次返回 `questions: string[]`（schema 见第 2 点），上限由 prompt 文本 "ask AT MOST 2" 约束，无代码层强制。
- 解析后 `decision.questions` 是数组，watch 一次性把每个 question 作为独立 coordinator 消息 post 到 chat thread（`watch.ts:188-195`），然后状态置 `awaiting_clarification`。
- **没有任何 "基于上一轮回答只生成下一个问题" 的循环机制**。一轮 triage = 一次 LLM 调用 = 一组问题。

**重新分诊(re-triage) 如何利用历史**：
- 前端用户回复后 → `POST .../messages` 追加 user 消息 + `PATCH .../status` 把状态打回 `pending`（`coordinator-chat.ts:236-256` 的 `sendCoordinatorReply`）。
- runner watch 重新捡起 pending 请求 → `defaultTriage` 重新 `listRequestMessages`，把**全部历史**塞进 `messageHistory`（`watch.ts:151-174`），`userRequest` 取最近一条 user 消息（`watch.ts:155-157`）。
- 即整个 triage **无状态、每轮从零跑**，靠把全量对话历史重新喂给 LLM 来 "记住" 上下文。没有 "决策树游标 / 已问问题指针 / 待深挖分支" 这类服务端状态。

**改成 "逐题决策树深挖" 需要动的地方**（评估用，非建议）：
- 数量约束：`coordinator.system_prompt` 文本里的 "AT MOST 2" + JSON schema 的 `questions` 数组语义。
- 输出契约：若要 "一次只出一个问题"，需改 system prompt 让 LLM 每轮只返回 1 个 question；`parseDecision` 当前对数组长度无限制，天然兼容单元素数组。
- 终止条件：当前 LLM 自行决定 `proceed` vs `pause_for_human`，逐题深挖靠 "继续 pause + 历史增长" 自然推进，无需新增循环代码——但**没有显式 "已问 N 题 / 最多问 M 题" 的服务端计数器**，需要新增（否则可能无限追问）。
- 历史利用已就绪（全量回灌），re-triage 路径不用大改。

---

## 6. 现有可扩展点

**几乎没有 "风格/persona/strategy" 抽象。** 现状：

- 提示词**通过 config 层可替换**（`coordinator.system_prompt` 是 string + multiline，可在设置页整段改写），但这是 "替换整段文本"，**不是 "选择风格模板"**。
- **唯一的模板机制**是 `packages/shared/src/config/template.ts` 的 `applyTemplate`，只做 `${var}` 字面量替换，目前仅服务 `large_scope_template` 的 `${trigger}`（`rules-core.ts:99`）。**不是** persona/strategy 框架。
- 没有任何 `style` / `persona` / `tone` / `questioning_strategy` 的枚举、开关、分支或 strategy 对象。grep 全 coordinator + config 目录无命中（仅匹配到无关的 `large_scope_template` 字样）。
- `ConfigType` 无 enum/select 类型（`registry.ts:47`），现有 UI 只能渲染 number/string/string_array。
- routeCase / runType 是固定枚举集（`decision.ts:62-70` 的 `KNOWN_ROUTE_CASES`/`KNOWN_RUN_TYPES`），与 "提问风格" 正交。

→ 要做 grill-me 风格，最自然的最小切口是：**新增一个 config key（如 `coordinator.questioning_style` 或 `coordinator.grill_me_system_prompt`）+ 在 `llm-fallback.ts:211` 取 system prompt 处按风格选择不同的 prompt**。雏形级抽象都不存在，需从 config registry 起新建。

---

## 7. 前端对接

文件：`apps/web/src/coordinator-chat.ts`（逐题 UI 在 `renderCoordinatorActionPanel` `coordinator-chat.ts:345-554`，T06-15 已改成 step-by-step）。

**强依赖 "问题总数已知"**：
- `totalQuestions = questions.length`（`coordinator-chat.ts:361`），来自 `pause_for_human` decision 的 `questions` 数组（`coordinator-chat.ts:281-284` 的 `coordinatorPendingQuestions`）。
- 分母 `问题 {currentIndex+1}/{totalQuestions}` 显式渲染（`coordinator-chat.ts:497`）。
- "最后一题" 判断 `isLastQuestion = currentIndex === totalQuestions - 1`（`coordinator-chat.ts:376`）决定按钮是 "下一个 →" 还是 "提交回复"（`coordinator-chat.ts:549`）。
- `submitAllAnswers` 一次性把所有题答案拼成 `Q1..A1 / Q2..A2` 文本提交（`coordinator-chat.ts:259-267`）——**假设所有题已知且一并回答**。
- 越界保护 `currentIndex >= totalQuestions` 重置索引（`coordinator-chat.ts:364-368`）。
- 收到新 questions 数组时重置题目游标 `resetQuestionState`（`coordinator-chat.ts:199-211`，比较 `JSON.stringify(previousQuestions)`）。

**改成动态/未知总数逐题深挖需要适配的点**：
- 分母 `{totalQuestions}`（`coordinator-chat.ts:497`）——未知总数时不能显示 "x/N"，需改成 "第 N 题" 或进度条移除。
- `isLastQuestion` 逻辑（`coordinator-chat.ts:376`）——逐题深挖时 "是否最后一题" 由服务端是否 `proceed` 决定，前端无法预判；"提交回复" 按钮语义要从 "提交全部" 改成 "回答本题并继续"。
- `submitAllAnswers` 批量拼装（`coordinator-chat.ts:259-267`）——逐题模式应改成单题提交后等服务端返回下一题（实际上现有 `sendCoordinatorReply` 单条提交 + 打回 pending + 轮询的机制天然支持，`coordinator-chat.ts:236-256`）。
- 轮询/重置逻辑（`coordinator-chat.ts:199-230`）：逐题模式下每轮新问题会触发 `resetQuestionState`，配合 `questions.length===1` 基本可复用；但 "已答历史问题" 的展示目前靠 chat thread（`coordinator-chat.ts:570-584` 的 `thread`），可沿用。

> 后端逐题（questions 长度恒为 1）+ 前端把 "x/N" 改成单题展示，是改动量最小的组合：`renderCoordinatorActionPanel` 在 `questions.length===1` 时基本退化为单题卡片，只需去掉分母与 next/submit 二分逻辑。

---

## Related Specs

- `.trellis/spec/api/backend/smart-router.md` —— coordinator 作为上游意图分类器的边界定义（`coordinator.ts:22` 引用）。
- 设置页规格相关：`apps/web/src/page-settings.ts` / `settings-projection.ts`（config 覆盖 UI），未深入读取。

## Caveats / Not Found

- **未读取** `page-settings.ts` 全文，仅确认默认 tab 为 `coordinator`；config 编辑 UI 是否对 multiline string 有特殊渲染、是否支持新类型，需要时再查 `page-settings.ts` + `settings-projection.ts`。
- **未找到** 任何风格/persona/strategy 抽象（grep 全空），结论 "需从零新建" 是基于 coordinator + config 两个目录的穷举搜索。
- `ConfigType` 仅 number/string/string_array，无 enum/select——若 grill-me 想做成 "下拉选风格" 需评估新增类型对 UI/校验的影响（`registry.ts:47`、`validateConfigValue` `registry.ts:331-363`）。
- 服务端 triage 无 "已问题数" 计数器；逐题深挖若不加上限有无限追问风险（见第 5 点）。
- 测试文件（`apps/web/test/page-knowledge.test.ts` 等）未纳入本次调研范围。
