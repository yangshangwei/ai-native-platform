# 新建任务页：智能路由驱动的默认体验（隐藏 Type，前置 Router 推荐）

## Goal

把「新建任务」页从「用户先选 Type 才能提交」改造成「用户只描述目标，AI 自动判类型 + 实时推荐 flow」。让 Coordinator + Smart Router 真正成为默认路径，Type / Flow 降级为「高级覆盖」选项。同时补齐 Coordinator 当前的 refactor 路径盲点，让自动化不留 dead-end。

## What I already know（auto-context 已落实）

### 现有实现关键事实

- **Router preview 已经接入**新建任务页（`apps/web/src/main.ts:2871-2942`，V2 W2-4 / PR4 落地的）。触发条件：title onBlur + 400ms debounce；缓存 key `(projectId, runType, title)`；渲染 `panelHeader('智能推荐') + flowId + startStage + ~分钟 + ~tokens + rulesFired`。**所以这个任务的核心不是「加 preview」，而是「让 preview 不再依赖 typeSelect.value」。**
- **现在 preview 的 runType 来源**：`main.ts:2891` 直接读 `typeSelect.value`。typeSelect onchange 也会重置 cache 重新调一次（`main.ts:2938-2941`）。
- **submit 路径**：`main.ts:3069-3076` 提交 `POST /workflow-requests`，body 含 `projectId / type / title / branch`。**server-side `apps/api/src/routes/workflow-requests.ts:82` 默认 `type: body.type ?? 'feature'`** —— 隐藏 Type 后省略字段是安全的，server 不会 reject。
- **WorkflowRequest.type 是 hint，不是 final runType**：Coordinator 跑完会写 `coordinator_decisions.runType`，可能与 `request.type` 不一致。`main.ts:3284` 已经有 mismatch detector（`decision.runType !== request.type` 时 metric 渲染为 warn）。这条设计语义就是「用户提示 + AI 复核」。
- **Coordinator rules 当前只产生 feature/bugfix**（`apps/runner/src/agents/coordinator/rules.ts`）：grep 整个 coordinator 目录，**没有任何代码会输出 `runType: 'refactor'` 或 `'smoke'`**。LLM fallback 理论上可以，但没有规则保证。这就是 dead-end 的具体证据。
- **Smart Router 4 类 runType 都能正确处理**（`apps/api/src/router.ts:85-110`）；瓶颈不在 router，在 Coordinator 上游。
- **没有 `/coordinator/preview` 端点**：今天 Coordinator 只在 Runner 认领后才跑；UI 拿不到「runType 预测」就没法做诚实的 router preview。

### 强约束（来自项目规约）

- **`apps/web/` 是 vanilla TS SPA**，没有 React/Vue/JSX；renderer function 模式 = `function render(parent, state)`（`.trellis/spec/web/frontend/component-guidelines.md`）。
- **idempotent + deterministic** rendering；DOM 不是状态源（`component-guidelines.md`）。
- **wholesale HTML replacement 会丢 focus**（component-guidelines.md L121）——advanced disclosure toggle 时不能整段重建表单，`element.value =` 局部更新优先。
- **API 写入入口三类不变**：`/runner/events/* + /approvals + /promote + /config`，本任务不动这些。
- **唯一写者契约不动**：本任务任何改动都不能让 Web 直接写 DB / 状态。
- **vitest 是测试栈**（`package.json` test 命令）。

### 已有同类机制可复用

- `panelHeader / el / api` helper 已在 `main.ts` 现成；
- `RecoResponse` 类型已在 main.ts:2882 定义；
- Coordinator rules 是 config-driven（`getConfig('coordinator.bug_keywords')`），加 refactor 规则要么复用 config 模式要么先硬编码后续做 config 化。

## Expansion Sweep（diverge 阶段）

### 1. Future evolution（1-3 个月可能演进的）

- **Coordinator LLM fallback** 已经存在（`llm-fallback.ts`），未来 router preview 可能把 LLM 一并接进来 → preview 应该有 confidence 指标，让用户知道是 rules 高置信还是 LLM 兜底。
- **Smart Router LLM fallback**（V2 §7.2 W3 todo）：runType 推断不出来时调 LLM；preview 卡片要为 confidence 字段留位置。
- **History-based learning**（V2 §7.2 W3 todo）：「你们队伍这种标题历史上 90% 走 fastforward」——preview 卡片需要支持「历史命中」的 hint 渲染。

### 2. Related scenarios（应该保持一致的相邻流）

- **Coordinator chat 澄清**：如果 preview 显示「runType: bugfix」但用户实际想做 feature，应能在描述里写清楚后再次 preview，**而不是被迫展开高级覆盖**。preview 卡片应是 advisory，不是 blocking。
- **任务详情页**已有的 `request.type vs decision.runType mismatch warn 标记`（main.ts:3284）：本次 UI 改造后 mismatch 频率应该**降低**（因为 request.type 不再被人乱设），可作为成功指标之一。
- **Reports 页 / Knowledge 页**：preview 时显示的 `relevantKnowledge` ids 应可点穿透到知识库（router.ts:142 已经返回 ids，UI 当前没渲染） —— 顺手补一下还是另开任务？

### 3. Failure & edge cases

- **极短 title**（< 6 字）：Coordinator rules 会触发 `rule.too_short` → `pause_for_human`。preview 阶段应**预告**这一行为（"AI 觉得描述太短，可能会反问你"）。
- **大需求关键词**（"做一个系统 / SSO / 完整的 ..."）：Coordinator rules 会 `pause_for_human` 要求分解。preview 应**预告**「将进入分解澄清流程」。
- **API 不可用** preview 失败：当前已有 try/catch 渲染 fail（main.ts:2923-2927）；提交路径**应继续可用**（不阻塞 submit）。
- **多语言混合**（"重构 the auth module" / "fix this bug 顺带优化下"）：refactor 关键词列表中英都要覆盖。
- **频繁改 title**：现有 400ms debounce 已合理，不动。
- **从已知任务复制 title**（用户从历史任务粘贴）：preview cache key 包含 title，命中即走，无副作用。
- **回滚**：纯增量（隐藏 + 加 endpoint + 加规则），revert 三个 commit 即可，无 DB 迁移。

## Decision (ADR-lite) — locked to scope C on 2026-05-06

**Context**：Router preview 已经在新建任务页存在但绑死 `typeSelect.value`；隐藏 Type 后 preview 对 bug/refactor 描述会说谎；Coordinator 当前根本不会产生 `refactor` runType——`runType==='refactor'` 路径今天只能从 UI 显式选才能触达。

**Decision**：选 C（UI + Coordinator Preview Endpoint + 加 refactor 规则），跨 web + api + runner + shared 四个 package 一次做完。

**Consequences**：
- ✅ preview 诚实地反映 AI 的判断，包括 bug / refactor / smoke。
- ✅ cs-refactor flow 在自然 UX 下首次可达（不再被 UI 锁住）。
- ✅ mismatch detector 命中率应下降（因为 request.type 不再是用户「随便点」的结果）。
- ⚠️ 工作量 ~2 天；测试面跨 4 package。
- ⚠️ Coordinator preview endpoint 是新 API（增量、向后兼容、零破坏）。

**驳回的方案**：
- A（UI-only Lite）：preview 失去对 30%+ 任务的诚实性，refactor 仍 dead-end。
- B（UI + Coordinator Preview，但不加 refactor 规则）：refactor dead-end 不解决，下次还得回来打补丁。

## Open Questions

（None — scope locked to C on 2026-05-06；implementation 阶段如果踩到边角问题再回来 update PRD。）

## Implementation Deviations（2026-05-06 落地时记录）

实际写代码时发现的与 Requirements 章节的偏差，记录在这里以便后续 review：

1. **Flow / Start Stage override UI 暂未落地**。原 Requirements 写「高级覆盖 disclosure 内含 Type / Flow / startStage 三个下拉」，实际只放了 Type。原因：`POST /workflow-requests` 当前 body 不接受 `flowId / startStage` 字段（只接受 `type`），WorkflowRequest schema 也没有这两列。把它们 plumb 进去需要：(a) 加 schema column + DB migration；(b) `apps/api/src/routes/workflow-requests.ts` body 解析；(c) runner watch 在 createWorkflowRun 调用时把这两个值带过去。这超出本任务的「UI 重构 + Coordinator preview endpoint」范围，列入下一个 task：`new-task-form-flow-startstage-override`。
2. **`RouteCase` union 加了 `'refactor_clear'` 值**。`packages/shared/src/types/coordinator.ts` 的 RouteCase 原本没有 refactor 对应的 case，refactor 规则需要它做 `routeCase` 字段。这是 metadata 字段的最小扩展，不违反「不新增 runType / flowId / WorkflowStage」红线（这三个都在 workflow.ts 里，没动）。
3. **`COORDINATOR_REFACTOR_KEYWORDS_DEFAULT` 词表**：实际落地的中英覆盖列表是 `['重构', 'refactor', '优化', '拆分', '抽离', '重写', '简化', '清理', 'cleanup', 'restructure', 'extract', 'simplify']`（12 项）。略多于 PRD Requirements 写的「至少包含 ['重构', 'refactor', '优化', '拆分', '抽离', 'cleanup', 'restructure', '重写', 'extract', '简化']」（10 项），加了 '清理' 和 'simplify' 提高覆盖。
4. **`CONFIG_REGISTRY_KEY_COUNT` 24 → 25**：因新加 `coordinator.refactor_keywords` key；同步更新了 `apps/api/test/config-routes.test.ts` 三处 24 → 25 断言。

## Requirements（locked, scope C）

### Web 改动 (`apps/web/src/main.ts`)

- 默认表单去掉 `Type` 下拉；表单可见字段 = `Project / Task Title / Source Branch / Agent Backend`。
- 新增「高级覆盖（Advanced Override）」disclosure，默认折叠，展开后显示：
  - `Type` 下拉（4 选 1）
  - `Flow` 下拉（4 选 1，可选不填走 router 推荐）
  - `Start Stage` 下拉（仅 `feature.standard` 时显示，可选）
- preview 卡片渲染流程升级为**两段调用**：
  1. `POST /coordinator/preview` 拿 `{ predictedRunType, confidence, rulesFired, hint? }`。
  2. 用 predictedRunType 调 `POST /router/recommend` 拿 `{ flowId, startStage, estimates, ... }`。
  3. 合并渲染：保留现有 `panelHeader('智能推荐') + flowId + startStage + ~分钟 + ~tokens` 结构；新增一行 `AI 判定: <runType> · 置信 <pct>`；hint 命中（`too_short` / `large_scope`）时渲染黄色 callout。
- 用户展开高级并选 Type 时：preview 走「单段」路径（直接 router，跳过 coordinator preview，因为 user override 优先）。
- 用户展开高级并选 Flow 时：preview 不显示 router 推荐（用户已显式覆盖）。
- submit 路径：未展开高级时 `body.type` 字段省略；展开高级时按选项传。
- 现有 mismatch detector（main.ts:3284）保持不动。

### API 改动 (`apps/api`)

- 新增 `POST /coordinator/preview`：
  - body: `{ title: string }`
  - 返回 200 + `{ predictedRunType: 'feature'|'bugfix'|'smoke'|'refactor', confidence: number, rulesFired: string[], hint?: 'too_short'|'large_scope' }`
  - 实现：直接调 `classifyByRules({ userRequest: title, messageHistory: [] })`（runner 的 rules.ts 当前是 runner-side 模块；本任务把它的核心逻辑挪到 `packages/shared` 或 `apps/api` 共享层供两端复用，避免 web→runner 直连）。
  - **不调 LLM**；纯 rules-fast-path；零 token 成本；无 DB 写。
  - 错误处理遵循 `apps/api/src/routes/` 既有模式（4xx for input, 500 for unexpected）。
- 新增端点路由文件 `apps/api/src/routes/coordinator.ts`（参照 `routes/router.ts` 的写法）。
- 不动 `POST /workflow-requests` / `POST /workflow-runs` / `POST /router/recommend`。

### Runner / Shared 改动

- `apps/runner/src/agents/coordinator/rules.ts`：
  - 新增 refactor 分支：在 bug-vs-feature 判定**之前**加 refactor 检测（因为重构关键词不天然是 bug 也不是 feature）。
  - 命中条件：refactor_keywords 命中 ≥ 1 个 + 文本长度 > 8（同 large_scope 阈值，避免「重构」单字误中）。
  - 输出：`{ action: 'proceed', routeCase: 'refactor_clear', runType: 'refactor', reason, confidence: 0.6 + hits*0.08 (cap 0.9) }`。
  - rule id: `rule.refactor_keywords_dominant`。
- `packages/shared/src/config/defaults.ts`：
  - 加 `coordinator.refactor_keywords` 默认表，至少覆盖：`['重构', 'refactor', '优化', '拆分', '抽离', 'cleanup', 'restructure', '重写', 'extract', '简化']`（中英混合）。
- `classifyByRules` 函数 / 相关类型如果当前在 runner 内部，本任务**移到 `packages/shared/src/coordinator/rules.ts`** 让 api 也能用——这是关键 cross-layer 重构，需仔细处理 import path 和 config 注入（`getConfig` 当前是 runner 模块，shared 不能直接调）。
  - **二选一实施**：
    - 选项 X：把 rules 算法纯函数化（输入 keywords + text，无 IO），shared 持有；api / runner 各自喂 keywords。
    - 选项 Y：在 api 单独再写一份 rules-only classifier（duplication），不改 runner。
  - **倾向 X**（避免 duplication，符合 cross-layer 思想）；implement 阶段若发现 X 牵扯过广再降级 Y。

### 测试

- `apps/api/test/coordinator-preview.test.ts`：
  - 短 title (`< 6 字`) → hint='too_short'。
  - 大需求 (`"做一个完整的 SSO 系统"`) → hint='large_scope'。
  - bug 关键词 → predictedRunType='bugfix'。
  - feature 关键词 → predictedRunType='feature'。
  - refactor 关键词 → predictedRunType='refactor'。
- `apps/runner/test/coordinator-rules.test.ts`：
  - 现有 bug/feature 测试不退化。
  - 新增 refactor 关键词覆盖：「重构 user 模块」/「refactor auth flow」/「优化 query 性能」/「拆分 service」/「extract helper」均 → runType='refactor'。
  - 「重构」单字（< 8 字）不命中，走 ambiguous fallback。
- `apps/web/` 不引入 e2e 框架（保持现状），但人工 smoke 列表见 §Acceptance Criteria。

### 文档 / Spec

- `.trellis/spec/web/frontend/` 加一节「task creation form: router-driven defaults + advanced override」记录约定（renderer / disclosure 模式）。
- `docs/2026-05-06-ui-end-to-end-operations.md` 关于「新建任务」的小节同步刷新；如截图过时附「截图待更新」。
- 视情况新增 `.trellis/spec/api/backend/coordinator-preview.md`（参照 smart-router.md 的格式）。

## Acceptance Criteria (evolving)

- [ ] 新建任务页默认看不到 Type 下拉
- [ ] title onBlur 后能看到 router 推荐卡片，含 flow / 阶段数 / 预估时长 / 预估 tokens / 规则解释（保留现有渲染）
- [ ]（B/C）preview 卡片含 `AI 判定: <runType>` 字段；too_short / large_scope hint 命中时有黄色提示
- [ ] 「高级覆盖」disclosure 默认折叠；展开后能选 Type / Flow / startStage 并覆盖 router 推荐
- [ ] 不展开高级提交的请求，audit_log 含 `routerRecommendation` 字段非空（验证 Router 接管）
- [ ]（C）coordinator/rules.ts 单测：标题含「重构 / refactor / 优化 / 拆分 / 抽离 / cleanup / restructure」时 runType==='refactor'
- [ ] e2e 烟囱：fastforward 路径（短 title + 关键词命中）从新建到 build_test 全自动通过，不需要碰 Type
- [ ] vitest / tsc --noEmit / lint 全绿
- [ ] mismatch detector（main.ts:3284）逻辑保持工作（Coordinator 仍可独立判定并 surface）

## Definition of Done

- 单元测试 + 集成测试覆盖（preview 两段调用 / coordinator 规则）
- typecheck (`bun run typecheck` 等价命令) 全绿
- vitest 在 web / runner / api / shared（C 含 shared）全绿
- `.trellis/spec/web/frontend/` 加一节「task creation form: router-driven defaults + advanced override」记录约定（避免下次 onboarding 困惑）
- `docs/2026-05-06-ui-end-to-end-operations.md` 关于「新建任务」的小节同步刷新；如截图过时附「截图待更新」
- 回滚方案：纯增量改动，3 个 commit 一组（web / api / runner-coordinator），revert 即回退；零 DB 迁移；零 API 破坏性变更。

## Out of Scope (explicit)

- **不改 API 既有契约**：`POST /workflow-requests` / `POST /workflow-runs` / `POST /router/recommend` 都保持 backward-compatible（参数仍可选，新参数仅添加不删除）。
- **不动 Smart Router 规则本身**（仍 4 runType + 4 flow）。
- **不引入新 runType / flowId / WorkflowStage**。
- **不动 Workflow Engine 写入路径**（唯一写者契约不变）。
- **不做 Smart Router 的 LLM fallback**（V2 §7.2 W3 独立 task）。
- **不做 history-based router learning**（同上）。
- **不做 Coordinator LLM-powered preview**（preview 只跑 rules，否则浪费 token）。
- **不补 `relevantKnowledge` 在 preview 卡片里点击穿透知识库**（顺手好做但范围爬升，单独 task）。

## Technical Notes

### 关键文件 + 行锚点

| 主题 | 文件 | 行 | 备注 |
|---|---|---|---|
| 新建任务页 renderer | `apps/web/src/main.ts` | 2846-3057 | `renderNewTaskPage()` |
| typeSelect 定义 | `apps/web/src/main.ts` | 2857-2858 | 隐藏目标 |
| Router preview 调用 | `apps/web/src/main.ts` | 2871-2942 | 已存在，需重构 |
| Submit body 构造 | `apps/web/src/main.ts` | 3069-3076 | 隐藏 Type 后 type 字段省略 |
| typeSelect onchange | `apps/web/src/main.ts` | 2938-2941 | 高级覆盖里继续保留这个监听 |
| mismatch detector | `apps/web/src/main.ts` | 3284 | 保持现有行为 |
| workflow-requests POST | `apps/api/src/routes/workflow-requests.ts` | 82 | server default 'feature' 已存在 |
| workflow-runs POST | `apps/api/src/routes/workflow-runs.ts` | 82 | runType ?? 'smoke' (注意是 smoke 不是 feature) |
| Smart Router recommend | `apps/api/src/router.ts` | 67-83 | 输出 shape，preview 复用 |
| Coordinator rules | `apps/runner/src/agents/coordinator/rules.ts` | 全文 151 行 | 加 refactor 分支位置：109-136 之前 |
| Coordinator config 默认 | `packages/shared/src/config/defaults.ts` | （未读，需查找） | refactor_keywords 加这里 |
| FlowRegistry SoT | `packages/shared/src/flows/registry.ts` | 193 | 不动 |

### 设计取舍记录（待 Q1 拍板后归档）

- preview 是 advisory not blocking——任何路径下 user 都能直接 submit。
- 高级覆盖的存在是为了 Coordinator dead-end 兜底（refactor / smoke）以及调试 / 演示场景。
- mismatch detector 是「事后审计」，不是「事前阻断」——不会在新建页 popup 警告，避免 UX 干扰。

## Research References

本任务是 UI 重构 + 既有功能整合，不需要外部 research。既有 docs 已覆盖：

- `docs/2026-05-06-end-to-end-business-flow.md` §5-§6（Coordinator + Smart Router）
- `docs/2026-05-06-technical-architecture-design.md` §6（Smart Router 决策表）
- `docs/2026-05-06-architecture-pillars-detail.md` §1-§2（Flow + Stage 详解）
- `docs/2026-05-06-ui-end-to-end-operations.md`（UI 现状）
- `.trellis/spec/web/frontend/component-guidelines.md`（renderer 约定）
- `.trellis/spec/runner/backend/flow-registry.md`（Flow registry 约定）
