# 研究：Coordinator 分类逻辑 + /coordinator/preview，新增 `ask` 只读问答分类需要触碰的点

> 目标：搞清 runner/api 侧 Coordinator 如何从标题分类出 runType（feature/bugfix/smoke/refactor），以及 `/coordinator/preview` 实现，从而列出新增 `ask`（只读问答）分类要改哪些地方。仅调研，不改代码。

---

## 1. runType union 类型定义（单一真相源 + 各处镜像）

| 位置 | 内容 | 性质 |
|------|------|------|
| `packages/shared/src/types/workflow.ts:60` | `export type WorkflowRunType = 'feature' \| 'bugfix' \| 'smoke' \| 'refactor';` | **唯一权威定义**，全仓库引用它 |
| `packages/shared/src/types/coordinator.ts:30` | `CoordinatorAction.proceed.runType: 'feature' \| 'bugfix' \| 'smoke' \| 'refactor'` | **手写镜像**（未用 `WorkflowRunType` 别名），需同步 |
| `apps/api/src/routes/coordinator.ts:48` | `predictedRunType: 'feature' \| 'bugfix' \| 'smoke' \| 'refactor' \| null` | preview 响应类型，手写镜像，需同步 |
| `apps/web/src/page-new-task.ts:64` | `type: '' \| 'feature' \| 'bugfix' \| 'smoke' \| 'refactor'` | 表单 draft 类型 |
| `apps/web/src/page-new-task.ts:359` | preview 响应类型镜像 | 需同步 |
| `apps/web/src/page-new-task.ts:367-372` | `userOverrideType` 类型 | 需同步 |
| `apps/web/src/page-new-task.ts:391` | `runTypeForRouter` 类型 | 需同步 |
| `apps/api/src/routes/router.ts:23-28` | `KNOWN_RUN_TYPES` 运行期数组（校验用）| 需同步 |

> 注意：`coordinator.ts` 与 `coordinator.ts` (preview) 的 union 是**字面量手抄**而非引用 `WorkflowRunType`，新增 `ask` 时这两处不会被类型系统自动带出，要手动改。

---

## 2. 规则分类器实现（runType 从标题怎么来）

### 2.1 纯函数核心（API 与 runner 共用）
`packages/shared/src/coordinator/rules-core.ts`
- `classifyByRulesCore(input): ClassifyCoreOutput`（`:68-163`）—— 纯函数，无 IO，所有关键词/正则/兜底文案由参数传入。
- 决策顺序（注释在 `:14-32`，代码在 `:68-163`）：
  1. `text.length < 6` → `pause_for_human`，`rule.too_short`，confidence 0.85（`:72-83`）
  2. 大范围关键词命中 OR `X系统/Y体系` 正则命中，且 `length > 8` → `pause_for_human`，`rule.large_scope_detected`，confidence 0.75（`:91-107`）
  3. refactor 关键词 ≥1 且 `length > 8` → `proceed` runType=`refactor`，`rule.refactor_keywords_dominant`，confidence `min(0.9, 0.6 + n*0.08)`（`:110-122`）—— **必须先于 bug/feature 比值判断**
  4. `bug.count - feature.count >= 2` → `proceed` runType=`bugfix`，`rule.bug_keywords_dominant`，confidence `min(0.95, 0.6 + n*0.08)`（`:124-137`）
  5. `feature.count - bug.count >= 2` 且 `length > 20` → `proceed` runType=`feature`，`rule.feature_keywords_dominant`，confidence `min(0.9, 0.55 + n*0.08)`（`:138-150`）
  6. 兜底 → `proceed` runType=`feature`，`rule.ambiguous`，confidence 0.4（`:152-162`）—— runner 侧低于阈值会触发 LLM 兜底
- `countMatches`（`:59-66`）：大小写不敏感子串命中计数。
- **rulesFired 字符串来源**：就是上面各分支 push 的 `'rule.too_short' / 'rule.large_scope_detected' / 'rule.refactor_keywords_dominant' / 'rule.bug_keywords_dominant' / 'rule.feature_keywords_dominant' / 'rule.ambiguous'`，没有独立规则名表，硬编码在各分支。
- `ClassifyHint` 类型（`:57`）：`'too_short' \| 'large_scope' \| null`。
- `deriveHint(rulesFired)`（`:170-174`）：too_short → `'too_short'`；large_scope → `'large_scope'`；否则 `null`。**目前没有 ask 对应的 hint**。

> **关键观察**：核心分类器**没有 smoke 分支**——`smoke` 只能由 LLM 兜底产出或用户在表单显式选择，规则路径永不输出 smoke。新增 `ask` 同理需要决定走规则分支还是仅靠 LLM/显式选择。

### 2.2 runner 侧 async wrapper
`apps/runner/src/agents/coordinator/rules.ts`
- `classifyByRules(input)`（`:56-88`）：用 `getConfig()` 拉 8 个 config key（关键词表 + 正则 + 兜底文案），`new RegExp(...)` 编译后委托 `classifyByRulesCore`。
- config key：`coordinator.bug_keywords / feature_keywords / refactor_keywords / large_scope_keywords / large_scope_regex / fallback.too_short_questions / fallback.large_scope_template / fallback.large_scope_followup`（`:67-74`）。

### 2.3 LLM 兜底
`apps/runner/src/agents/coordinator/llm-fallback.ts`
- `:166-167`：`runType: decision.action === 'proceed' ? decision.runType : null`（仅透传，类型受 `CoordinatorAction` 约束）。
- system prompt 在 `packages/shared/src/config/defaults.ts`（`COORDINATOR_SYSTEM_PROMPT_DEFAULT` / `_GRILL_ME_DEFAULT`）里钉死输出 schema：
  - `:118-119` 和 `:159-160`：`"routeCase": "feature_clear" | "feature_brainstorm" | "bugfix" | "roadmap_needed" | "unclear"`，`"runType": "feature" | "bugfix" | "smoke"`（**注意 prompt 里 runType 枚举只有 3 个，连 refactor 都没列**，新增 ask 若想让 LLM 产出需改 prompt）。
  - routeCase 分类说明在 `:102-104` / `:134-136`。

---

## 3. 关键词/正则默认值（rulesFired 命中源）
`packages/shared/src/config/defaults.ts`
- `COORDINATOR_BUG_KEYWORDS_DEFAULT`（`:13-30`）：bug/错误/异常/报错/崩溃/失败/crash/error/无法/不能/不工作/不对/应该/预期/实际…
- `COORDINATOR_FEATURE_KEYWORDS_DEFAULT`（`:33-48`）：增加/新增/加个/添加/实现/做一个/支持/add/implement/support/希望/验收标准/acceptance
- `COORDINATOR_LARGE_SCOPE_KEYWORDS_DEFAULT`（`:51-62`）：完整的/一整套/整个/sso/权限系统/通知系统/用户系统/认证体系/审计体系
- `COORDINATOR_LARGE_SCOPE_REGEX_DEFAULT`（`:65`）：`'(\\S+?\\s*系统|\\S+?\\s*体系)'`
- `COORDINATOR_REFACTOR_KEYWORDS_DEFAULT`（`:68-81`）：重构/refactor/优化/拆分/抽离/重写/简化/清理/cleanup/restructure/extract/simplify
- **没有 ask/问答关键词表**。

config registry 注册：`packages/shared/src/config/registry.ts:79-113`（每个 keyword key 的 type/default/description/category=`intelligent_analysis`）。

---

## 4. `/coordinator/preview` 端点实现
`apps/api/src/routes/coordinator.ts`
- `export const coordinator = new Hono();`（`:36`）。
- `POST /preview` handler（`:56-101`）：
  - 入参校验：`title` 必须是非空 string（`:59-64`，否则 400）。
  - 用 `CONFIG_REGISTRY[...].default`（**只读默认值，不应用运行期 override**，MVP 限制见 `:27-33` 注释）调 `classifyByRulesCore`（`:66-88`）。
  - 响应 `CoordinatorPreviewResponse`（`:42-54`）：`predictedRunType`（proceed 时取 `decision.runType`，否则 null，`:90-92`）、`confidence`、`rulesFired`、`hint = deriveHint(rulesFired)`。
- 纯只读，无 DB 写、无 LLM。挂载点：需确认 `coordinator` router 在 app 里 `.route('/coordinator', coordinator)`（在 api 入口处，按 Hono 约定）。
- 测试：`apps/api/test/coordinator-preview.test.ts`。
- spec：`.trellis/spec/api/backend/coordinator-preview.md`。

---

## 5. runType → flowId 路由（下游消费 runType 的地方）

### 5.1 API router 推荐
`apps/api/src/router.ts`
- `recommendFlowId`（`function recommendFlowId`）：`bugfix→issue.standard`、`refactor→refactor.standard`、`smoke→feature.standard`、`feature`(短/小改关键词)→`feature.fastforward`、否则 `feature.standard`。
- 决策规则注释 `:20-26`。**新增 ask 需在此加一条分支**（ask → 某个新 flow 或短路）。

### 5.2 workflow-engine 默认 flow
`apps/api/src/workflow-engine.ts:141-145` `defaultFlowIdForType(type)`：`bugfix→issue.standard`、`refactor→refactor.standard`、否则 `feature.standard`。**新增 ask 需加分支或它会落到 feature.standard**。

### 5.3 FlowId union + FLOW_REGISTRY
- `packages/shared/src/types/workflow.ts:111` `FlowId = 'feature.standard' | 'feature.fastforward' | 'issue.standard' | 'refactor.standard'`。
- `FlowDef.kind: WorkflowRunType`（`workflow.ts:155`）—— 每个 flow 绑定一个 runType。
- `packages/shared/src/flows/registry.ts`：现有 4 个 flow 定义（feature.standard `:57`、feature.fastforward `:90`、issue.standard `:125` kind=bugfix、refactor.standard `:165` kind=refactor），typed 为 `Readonly<Record<FlowId, FlowDef>>` 有 exhaustiveness 检查。
- 若 ask 要走 workflow 流程则需新增一个 `ask.*` flow（含 FlowId union 扩展 + registry 条目 + stages）。**但** `lightweight-ask-channel.md` 研究倾向「不在任务列表留 workflow_request」——即 ask 可能**不走 flow registry**，则这块可不动。

---

## 6. web 侧 type 下拉
`apps/web/src/page-new-task.ts`
- `:229` `typeSelect = el('select', ...)`。
- `:235` 第一项 `(让 AI 自动判定)` value=''。
- `:236` `for (const type of ['feature', 'bugfix', 'smoke', 'refactor']) ...` —— **下拉选项硬编码数组，新增 ask 要在此加 `'ask'`**。
- `:367-372` `userOverrideType` 类型联合、`:391` `runTypeForRouter`、`:359` preview 响应类型、`:64` draft.type —— 全部需同步加 `'ask'`。
- preview 结果展示在 `:422-443`（AI 判定文案 + hint 警示），ask 若有专属 hint 需在此加分支。

---

## 7. 新增 `ask`（只读问答）分类需要触碰的点 · 清单

> 分两种落点假设，结合 `lightweight-ask-channel.md` 的「不在任务列表留 workflow_request」倾向，**优先级最高的是先定 ask 是否进入 WorkflowRunType / flow 体系**。下列为「若把 ask 纳入 runType 枚举」的完整改动面。

### 必改（类型/枚举同步，否则编译或运行期校验失败）
1. `packages/shared/src/types/workflow.ts:60` —— `WorkflowRunType` 加 `'ask'`（**权威源**）。一旦改这里，所有 `WorkflowRunType` 别名引用处（router.ts、workflow-engine.ts、context.ts、orchestrator/types.ts、watch.ts、workflow-runs.ts、workflow-requests.ts、router.ts type）会要求处理。
2. `packages/shared/src/types/coordinator.ts:30` —— `CoordinatorAction.proceed.runType` 手写 union 加 `'ask'`（不是别名，必须手改）。
3. `apps/api/src/routes/coordinator.ts:48` —— `predictedRunType` union 加 `'ask'`。
4. `apps/api/src/routes/router.ts:23-28` —— `KNOWN_RUN_TYPES` 数组加 `'ask'`（否则 `/router/recommend` 校验拒绝）。
5. `apps/api/src/router.ts` `recommendFlowId` —— 加 ask 分支（决定 ask 映射到哪个 flow，或短路）。
6. `apps/api/src/workflow-engine.ts:141` `defaultFlowIdForType` —— 加 ask 分支，否则 ask 落到 feature.standard。
7. web `apps/web/src/page-new-task.ts:236` 下拉数组加 `'ask'`；同步 `:64 / :359 / :367-372 / :391` 各 union。

### 规则分类（让规则路径能产出 ask，可选——也可只靠显式选择/LLM）
8. `packages/shared/src/coordinator/rules-core.ts` —— 新增 ask 判定分支（需先定关键词/正则与优先级；注意 smoke 就是「规则不产出、仅 LLM/显式」的先例，ask 可照此处理而不动核心）。若加分支需：
   - 新增 `askKeywords` 入参（`ClassifyCoreInput`）+ 命中分支 + `rule.ask_*` rulesFired。
9. `packages/shared/src/config/defaults.ts` —— 新增 `COORDINATOR_ASK_KEYWORDS_DEFAULT`（如「为什么/怎么实现/在哪/解释/查一下/是不是/能不能告诉我」等只读疑问词）。
10. `packages/shared/src/config/registry.ts` —— 注册 `coordinator.ask_keywords`（type/default/description/category）。
11. `apps/runner/src/agents/coordinator/rules.ts:56-88` —— wrapper 加 `getConfig('coordinator.ask_keywords')` 并透传给 core。

### hint（可选，若要给 UI 专属提示）
12. `rules-core.ts:57` `ClassifyHint` 加 `'ask'`；`deriveHint`（`:170-174`）加 `rule.ask_*` → `'ask'`。
13. web `page-new-task.ts:362` hint 类型 + `:428-442` 展示分支加 ask 文案。

### LLM 兜底（若希望 LLM 也能判 ask）
14. `packages/shared/src/config/defaults.ts` 两处 system prompt（`COORDINATOR_SYSTEM_PROMPT_DEFAULT` `:99-` 与 `_GRILL_ME_DEFAULT`）：
    - routeCase 枚举（`:118 / :159`）+ runType 枚举（`:119 / :160`，当前仅 feature/bugfix/smoke）加 ask；分类说明（`:102-104 / :134-136`）补 ask 描述。
    - 可能需新增 routeCase（如 `'ask'`）——见 §下方 RouteCase。

### flow 体系（仅当 ask 要走 workflow 流程时；与 lightweight-ask-channel 旁路方案二选一）
15. `packages/shared/src/types/workflow.ts:111` `FlowId` 加 `'ask.standard'` 之类。
16. `packages/shared/src/flows/registry.ts` 新增 flow 条目（含 stages，可能极短：单 agent 只读问答 + completion），满足 `Record<FlowId, FlowDef>` exhaustiveness。
17. `FlowDef.kind` 校验链路（kind=ask）。

### RouteCase（如走 LLM 或要表达 ask 意图）
18. `packages/shared/src/types/coordinator.ts:9-15` `RouteCase` union 当前 `feature_clear/feature_brainstorm/roadmap_needed/bugfix/refactor_clear/unclear`，**无 ask**。若 proceed 要带 ask 语义，可能需加（rules-core 的 ask 分支也要给 routeCase 赋值）。

### 测试
19. `apps/api/test/coordinator-preview.test.ts`、`apps/runner/test/coordinator-rules.test.ts`、`apps/api/test/router-route.test.ts` 等需补 ask 用例。

---

## 8. 决策点（实现前需先拍板）
- **ask 是否进入 `WorkflowRunType` 枚举？** 若进，则 §7 必改 1-7 全套；若按 `lightweight-ask-channel.md` 走旁路（不建 workflow_request），则 ask 可能根本不经 runType/flow 体系，preview/分类逻辑改动面小很多甚至不动。
- **ask 是否需要规则路径产出？** smoke 的先例说明「规则不产出、仅显式/LLM」是可接受设计，可降低改动面（跳过 §7 第 8-11、14 项）。
- **preview 是否要给 ask 一个 hint？** 若 ask 是 proceed 类（不像 too_short/large_scope 是 pause），可能不需要 hint，只需 predictedRunType 能回 ask。
