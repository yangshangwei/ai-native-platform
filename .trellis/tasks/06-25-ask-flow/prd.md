# 新增只读问答（ask）类型，避免常规提问误跑完整 flow

## 目标

当前所有进入 `/workflow-requests` 的请求都被分类为 `feature/bugfix/smoke/refactor` 四选一，触发完整的改代码 flow（brainstorm → design → implement → review...）。但用户常有**纯提问诉求**——询问代码实现、报错排查、架构解释——这些不应开分支、改文件、跑完整流程。

本任务新增一个**只读问答（`ask`）类型**，让「只想得到答案」的请求走轻量只读旁路：不改文件、不开分支、不进任务列表，但保留对话历史、可回看、可在必要时升级为正式任务。

**核心价值**：避免「问个问题」被误判成 feature 跑完整 flow 的浪费；为真正的代码问答提供专属、干净的通道。

---

## 已确认的设计决策（与用户敲定）

| 维度 | 决定 | 理由 |
|------|------|------|
| **技术落点** | **B｜复用 `workflow_requests` 加 `kind='ask'` 标记** | 最大化复用现有 chat/SSE/coordinator-decisions 链路，历史可持久、可回看；代价是过滤点分散（需在任务列表查询 + 前端所有 `data.requests` 消费处统一过滤 `kind=ask`） |
| **分类来源** | **规则 + LLM 双路判定，用户手动兜底** | **规则分类器加 ask 关键词分支**（在 refactor 之前判定，匹配疑问词/疑问标点），优先级高、止血更早；LLM 兜底（改 coordinator system prompt）也能产出 ask；用户在下拉显式选作最后兜底。MVP **包含规则分支 + LLM 自判**。 |
| **数据持久化** | **要持久**（历史可回看） | 落库到 `workflow_requests` + `workflow_request_messages`，可跨会话回看对话；刷新不丢。 |
| **升级机制** | **AI 主动弹按钮 + 交回 Coordinator 重新判** | 回答里发现「这其实得动手改代码」时，AI 主动给「转为正式任务」按钮。点击后同行改 `kind=null`、`status='pending'`，Coordinator 从原始提问重新分类出 runType，runner 接管。零搬运，复用现有机制。 |
| **执行边界** | **只读为主，可升级** | 默认不写文件 / 不开分支 / 不 commit，只读代码 + 只读命令 + 回答；AI 发现该动手时主动弹升级按钮。 |
| **范围** | **仅围绕本项目的问答** | 只处理「问代码/项目」「问报错/调试」「想做但没想清（需求讨论）」三类——都需要读本仓库。**通用知识问答**（与本项目无关的问题）不特殊支持，不为它放宽「项目 / 执行器」校验。 |

---

## 需求（Requirements）

### R1 - 数据模型：`workflow_requests` 加 `kind` 标记

1. migration 给 `workflow_requests` 表加 `kind` 列（`'ask' | null`，默认 `null`），`null` = 普通任务。
2. `POST /workflow-requests` handler 接受可选 `kind: 'ask'` 参数。
3. 当 `kind='ask'` 时：
   - 创建的 request **不置 `status='pending'`**（置 `'awaiting_clarification'` 或新增 `'ask_active'` 状态），确保 runner watch loop（只查 `status='pending'`）永不 pick up。
   - `workflowRunId` 保持 `null`（ask 不创建 run）。
   - 复用现有 `workflow_request_messages` / `coordinator_decisions` / request-channel SSE 全链路。

### R2 - 任务列表过滤：`kind=ask` 不可见

**关键约束**：`kind='ask'` 的 request **不得出现在任务列表 / 工作台 / 我的待办 / 报表**中。

实现点（来自调研 `research/lightweight-ask-channel.md`）：

1. **`GET /workflow-requests` 默认查询排除 `kind='ask'`**（`apps/api/src/routes/workflow-requests.ts:41-48`）：
   ```ts
   store.workflowRequests.values().filter(r => r.kind !== 'ask')
   ```
2. **前端所有 `data.requests` 消费点统一过滤**：
   - `apps/web/src/page-workbench.ts:166` — `renderWorkbenchOverviewPanel` 的 `activeRequests` / `totalTasks`
   - `apps/web/src/state.ts:236` — `myTodos()` 过滤
   - `apps/web/src/page-reports.ts:184` — reports 里关联 request 时过滤

   建议在 `data-loading.ts` 的 `loadData` 入口处统一过滤一次：
   ```ts
   data.requests = (await api<{items: WorkflowRequestDto[]}>('/workflow-requests')).items
     .filter(r => r.kind !== 'ask');
   ```
   这样下游全局只看到非 ask 的 request，无需每个消费点单独加过滤（降低遗漏风险）。

### R3 - Coordinator LLM 自动判定 `ask`

1. **扩展 `WorkflowRunType`**（`packages/shared/src/types/workflow.ts:60`）：
   ```ts
   export type WorkflowRunType = 'feature' | 'bugfix' | 'smoke' | 'refactor' | 'ask';
   ```
2. **同步手写镜像**（调研列出的 7 处）：
   - `packages/shared/src/types/coordinator.ts:30` — `CoordinatorAction.proceed.runType`
   - `apps/api/src/routes/coordinator.ts:48` — `predictedRunType` union
   - `apps/api/src/routes/router.ts:23-28` — `KNOWN_RUN_TYPES` 数组
   - `apps/web/src/page-new-task.ts` 四处（`:64 / :236 / :359 / :367-372 / :391`）

3. **LLM system prompt 加 `ask` 分类**（`packages/shared/src/config/defaults.ts`）：
   - `COORDINATOR_SYSTEM_PROMPT_DEFAULT`（`:99-`）和 `_GRILL_ME_DEFAULT` 两处：
     - `routeCase` 枚举（`:118 / :159`）加一个新 case（如 `'ask'` 或复用 `'unclear'` 但 runType=ask）
     - `runType` 枚举（`:119 / :160`，当前仅 `feature/bugfix/smoke`）加 `'ask'`
     - 分类说明（`:102-104 / :134-136`）补充 ask 的判定规则：
       > "When the user's title is phrased as a question (含疑问词「为什么/怎么/在哪/是不是/能不能/解释」或疑问标点)，or explicitly asks for explanation/查一下/告诉我，classify as **ask** (只读问答). ask 类请求不应开分支、不改代码，只需回答。"

4. **runner 侧 triage 透传**（`apps/runner/src/agents/coordinator/llm-fallback.ts:166-167`）：
   - `runType` 已从 `decision.action === 'proceed' ? decision.runType : null` 取，只要 LLM prompt 能输出 ask，这里自动透传。

5. **规则分类器加 ask 判定分支**（`packages/shared/src/coordinator/rules-core.ts`）：
   - 在现有 6 条规则的**第 3 步**（refactor 判定之前）插入 ask 判定：
     ```
     1. too_short
     2. large_scope
     3. **ask 判定（新增）** ← 插入这里
     4. refactor
     5. bug vs feature 比值
     6. 兜底 feature
     ```
   - 判定逻辑：
     ```ts
     const askMatches = countMatches(text, askKeywords);
     const hasQuestionMark = /[?？]/.test(text);
     const hasQuestionWord = /^(为什么|怎么|如何|在哪|是不是|能不能|可以|解释|告诉我|查一下|what|why|how|where|when|can|could|is it|explain|tell me)/i.test(text);
     
     if ((askMatches >= 1 || hasQuestionMark || hasQuestionWord) && text.length > 6) {
       return {
         action: 'proceed',
         runType: 'ask',
         rulesFired: ['rule.ask_question_detected'],
         confidence: Math.min(0.9, 0.6 + askMatches * 0.1),
       };
     }
     ```
   - 优先级：ask 在 refactor 之前判定，避免「怎么重构 X」被误判成 refactor。
   - 新增 config key：
     - `coordinator.ask_keywords`（defaults.ts: `COORDINATOR_ASK_KEYWORDS_DEFAULT`）：
       ```ts
       export const COORDINATOR_ASK_KEYWORDS_DEFAULT = '为什么,怎么,如何,在哪,是不是,能不能,可以吗,解释,告诉我,查一下,what,why,how,where,when,can,could,should,is it,does it,explain,tell me,look up';
       ```
     - 在 `config/registry.ts` 注册（type/default/description/category=`intelligent_analysis`）。
   - runner wrapper（`apps/runner/src/agents/coordinator/rules.ts:56-88`）加 `getConfig('coordinator.ask_keywords')` 并透传给 core。
   - `/coordinator/preview` 也会用到这条规则（因为它调同一个 `classifyByRulesCore`），提问式标题在 preview 阶段就能被认出。

### R4 - Router / flow 映射：ask 短路，不创建 run

ask 请求**不走 workflow run / flow 体系**——它复用 request-channel chat 但不创建 run、不执行 stages。

1. **Runner watch loop 天然忽略**（`apps/runner/src/cmd/watch.ts:60/214`）：
   - watch 只查 `status='pending'`，ask 的 status 不是 pending → 永不被 pick up。

2. **Router / workflow-engine 无需改**：
   - `apps/api/src/router.ts` 的 `recommendFlowId` / `defaultFlowIdForType` 不会被 ask 触发（因为 ask 不进 watch loop）。
   - 若将来想让 ask「也能选择走某个只读 flow」（如 `ask.standard`），再改；MVP 不做。

### R5 - Web 下拉：手动选 `ask` 兜底

1. **新建任务页面下拉**（`apps/web/src/page-new-task.ts:236`）：
   ```ts
   for (const type of ['feature', 'bugfix', 'smoke', 'refactor', 'ask']) ...
   ```
2. **同步表单 draft / preview 类型**（`:64 / :359 / :367-372 / :391`）全部加 `'ask'`。

3. **preview 结果展示**（`:422-443`）：
   - 当 `coordPreview.predictedRunType === 'ask'` 时，文案改为「AI 判定: ask（只读问答）」。
   - 若规则路径返回 `null` 而用户手选了 ask，preview 卡片提示「你选择了只读问答，将不开分支、不改文件」。

### R6 - 升级为正式任务

1. **前端按钮**：
   - 在 ask 类 request 的对话 UI（`coordinator-chat.ts` / 任务详情页）加一个「转为正式任务」按钮。
   - 点击后 `PATCH /workflow-requests/:id`，body: `{ kind: null, status: 'pending' }`。

2. **API handler**（`apps/api/src/routes/workflow-requests.ts` 或新增端点）：
   - 校验 `kind === 'ask'`（只有 ask 能升级）。
   - 原子更新 `kind=null`, `status='pending'`。
   - 不改 `title` / `firstMessage` / `messages`——chat 历史原地保留。
   - runner watch loop 下次轮询会 pick up 这条 request，Coordinator 从原始 `title` 重新分类出 runType。

3. **AI 判断时机**：
   - runner 侧（`llm-fallback.ts` 的对话逻辑）在回答里检测「用户其实要改代码」的信号——如回答包含「需要修改 X 文件」「建议加个 Y」「我可以帮你实现」等。
   - 若检测到，在回答末尾追加一段 markdown：
     ```markdown
     ---
     🔧 **检测到这个问题需要改代码才能解决。** 要不要转为正式任务让我动手？
     [转为正式任务](#upgrade-to-task)
     ```
   - 前端渲染时识别 `#upgrade-to-task` 锚点，替换为真实按钮。

### R7 - 只读执行约束（MVP 可选，后续加强）

MVP 阶段 ask 的「只读」靠**约定 + runner 不执行**保证（因为不进 watch loop，runner 根本不跑它）。

后续可加强：
- ask 类 request 若误被 claim（极端情况），orchestrator 检测 `kind='ask'` 拒绝执行、报错。
- 或：为 ask 定义一个专属 `ask.standard` flow，stages 只含一个「只读问答 agent」stage，toolPolicy 白名单纯读命令（Read / Grep / Bash 的 `cat`/`ls`/`git log` 等）。

MVP **不做专属 flow**，只做「不进 watch loop = 永不执行」。

---

## 验收标准（Acceptance Criteria）

- [ ] 创建一个 `kind='ask'` 的 request，它不出现在工作台任务列表、我的待办、报表任何地方。
- [ ] 该 request 的 chat 可正常收发消息、可回看历史、刷新不丢。
- [ ] 在新建任务页手选「ask」类型，提交后创建的 request 符合上述。
- [ ] 标题像提问（「为什么 X」「怎么实现 Y」「这个报错是什么意思」）的请求，提交后 Coordinator LLM 自动判定为 ask（preview 卡片显示 `predictedRunType='ask'`），创建后进入只读问答而非 feature flow。
- [ ] ask 类 request 的对话里点「转为正式任务」按钮，request 的 `kind` 变 `null`、`status` 变 `pending`，runner 下次轮询接管它、Coordinator 重新分类、走正常 flow。Chat 历史原地保留。
- [ ] build / typecheck / 现有测试全绿。

---

## Definition of Done（团队质量标准）

- 测试：
  - API 集成测试覆盖 `POST /workflow-requests` 创建 `kind='ask'` + `GET` 默认排除 ask。
  - 前端：工作台 / myTodos / reports 渲染测试确认 ask 不可见。
  - Coordinator LLM 判定：手动验证几个提问式标题能被 preview 判为 ask。
- Lint / typecheck / CI 全绿。
- 文档：
  - 更新 `.trellis/spec/api/backend/workflow-requests.md`（新增 `kind` 字段说明）。
  - 更新 `.trellis/spec/api/backend/coordinator-preview.md`（runType 枚举加 ask）。
  - 更新 `.trellis/spec/web/frontend/new-task-form.md`（下拉选项 + 升级按钮）。
- Rollout/rollback：
  - migration 可回滚（down 脚本 drop `kind` 列）。
  - 上线后若发现 ask 泄漏进任务列表，立即在 API 查询层加强过滤（后端兜底）。

---

## Out of Scope（本期不做）

- **ask 专属 flow**（`ask.standard` + 只读 stage + toolPolicy 白名单）——MVP 靠「不进 watch loop」已足够，后续再加强执行约束。
- **通用知识问答**（与项目无关的问题）——不特殊支持；如「React 和 Vue 区别」这种纯闲聊问题，MVP 仍要求选项目 + 执行器在线，不为它放宽校验。
- ~~**规则分类器产出 ask**~~（已纳入 MVP）——规则在 refactor 之前判定 ask，优先级合理，本期就做。
- **ask 专属 hint**（如 `too_short` / `large_scope`）——ask 是 `proceed` 类不是 `pause`，不需要特殊 hint；`predictedRunType='ask'` 本身已是信号。
- **独立的「问一问」入口**（与新建任务平级的另一个页面）——MVP 复用新建任务表单，只是下拉多一个选项；独立入口等 ask 稳定后再考虑（体验优化，非功能必需）。

---

## 技术方法（Technical Approach）

### 架构：复用 workflow_requests + kind 标记 + 过滤隔离

```
┌─────────────────────────────────────────────────┐
│  新建任务表单（web）                               │
│  - type 下拉多一个 "ask"                          │
│  - Coordinator preview 能返回 predictedRunType=ask│
│  - 提交时 POST /workflow-requests { kind: 'ask' } │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│  workflow_requests 表                             │
│  + kind: 'ask' | null                            │
│  + status: 'awaiting_clarification' (非 pending) │
│  + workflowRunId: null                           │
│  → runner watch loop 只查 status='pending' → 忽略  │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│  chat / SSE / coordinator-decisions (复用现有)    │
│  - request-channel SSE 流式对话                   │
│  - workflow_request_messages 存历史              │
│  - 可回看、可跨会话                               │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│  任务列表过滤（关键约束）                          │
│  - GET /workflow-requests 查询默认排除 kind='ask' │
│  - 前端 data.requests 入口统一过滤                │
│  → 工作台 / myTodos / reports 天然看不到 ask      │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│  升级为正式任务                                    │
│  - 前端按钮 → PATCH /workflow-requests/:id       │
│    { kind: null, status: 'pending' }            │
│  - runner 下次轮询 pick up → Coordinator 重新判   │
│  → chat 历史原地保留，零搬运                       │
└─────────────────────────────────────────────────┘
```

### 关键实现点

1. **Migration**：
   ```sql
   ALTER TABLE workflow_requests ADD COLUMN kind TEXT CHECK (kind IN ('ask'));
   -- null = 普通任务，'ask' = 只读问答
   ```

2. **POST /workflow-requests handler**（`apps/api/src/routes/workflow-requests.ts:56-144`）：
   ```ts
   const { kind, ...rest } = body; // 接受可选 kind
   if (kind === 'ask') {
     // 创建时 status='awaiting_clarification'（或新增 'ask_active'），不置 pending
     await createWorkflowRequest({ ...rest, kind: 'ask', status: 'awaiting_clarification' });
   }
   ```

3. **GET /workflow-requests 过滤**（`:41-48`）：
   ```ts
   const items = store.workflowRequests.values().filter(r => r.kind !== 'ask');
   ```

4. **前端统一过滤**（`apps/web/src/data-loading.ts:79`）：
   ```ts
   data.requests = (await api<{items: WorkflowRequestDto[]}>('/workflow-requests')).items
     .filter(r => r.kind !== 'ask');
   ```

5. **Coordinator system prompt 改动**（`packages/shared/src/config/defaults.ts`）：
   - 在 routeCase / runType 枚举里加 `ask`，分类说明里补「疑问词/疑问标点 → ask」的判定规则。

6. **升级按钮**（`apps/web/src/coordinator-chat.ts` 或任务详情）：
   ```ts
   const upgradeBtn = el('button', { text: '转为正式任务', class: 'btn btn-primary' });
   upgradeBtn.onclick = async () => {
     await api(`/workflow-requests/${requestId}`, {
       method: 'PATCH',
       body: JSON.stringify({ kind: null, status: 'pending' }),
     });
     // 刷新 UI，提示「已转为正式任务，AI 正在接管」
   };
   ```

---

## 研究参考（Research References）

本 PRD 基于三份调研：

- [`research/coordinator-classification.md`](research/coordinator-classification.md) — runType 定义的 7 处镜像、规则分类器现状、LLM prompt 改动点、smoke 作为「规则不产出」的先例
- [`research/lightweight-ask-channel.md`](research/lightweight-ask-channel.md) — request→run→chat 数据流、任务列表数据来源、落点 A/B/C 利弊分析、过滤点清单
- [`research/flow-registry.md`](research/flow-registry.md) — FlowDef 结构、runType→flow 映射、最短 flow 模板（为后续可能的 `ask.standard` flow 做储备，MVP 不做）

---

## 关键文件清单（实现时需改动的文件）

| 文件 | 改动内容 |
|------|---------|
| **迁移** | |
| `apps/api/migrations/0XX-add-workflow-requests-kind.sql` | 新建：加 `kind` 列 |
| **类型定义** | |
| `packages/shared/src/types/workflow.ts:60` | `WorkflowRunType` 加 `'ask'` |
| `packages/shared/src/types/coordinator.ts:30` | `CoordinatorAction.proceed.runType` 加 `'ask'` |
| `packages/shared/src/types/workflow.ts:204+` | `WorkflowRequest` / `WorkflowRequestDto` 加 `kind?: 'ask' \| null` |
| **Coordinator** | |
| `packages/shared/src/coordinator/rules-core.ts` | 加 ask 判定分支（第 3 步，refactor 前），匹配 askKeywords/疑问标点/疑问词 |
| `packages/shared/src/config/defaults.ts` | 加 `COORDINATOR_ASK_KEYWORDS_DEFAULT` 关键词表；system prompt 两处加 ask 分类说明 |
| `packages/shared/src/config/registry.ts` | 注册 `coordinator.ask_keywords` config key |
| `apps/runner/src/agents/coordinator/rules.ts` | wrapper 加载 ask_keywords 并透传给 core |
| `apps/api/src/routes/coordinator.ts:48` | `predictedRunType` union 加 `'ask'` |
| **API** | |
| `apps/api/src/routes/workflow-requests.ts:56-144` | POST handler 接受 `kind: 'ask'`，创建时不置 pending |
| `apps/api/src/routes/workflow-requests.ts:41-48` | GET 默认查询排除 `kind='ask'` |
| `apps/api/src/routes/router.ts:23-28` | `KNOWN_RUN_TYPES` 加 `'ask'` |
| **前端** | |
| `apps/web/src/data-loading.ts:79` | 加载后统一过滤 `kind='ask'` |
| `apps/web/src/page-new-task.ts:236` | 下拉数组加 `'ask'` |
| `apps/web/src/page-new-task.ts:64/359/367-372/391` | 各类型 union 加 `'ask'` |
| `apps/web/src/coordinator-chat.ts` 或任务详情 | 加「转为正式任务」按钮（检测 `kind='ask'` 时显示） |
| **测试** | |
| `apps/api/test/coordinator-preview.test.ts` | 补 ask 用例（提问式标题 → predictedRunType='ask'） |
| `apps/api/test/workflow-requests.test.ts` | 补 kind='ask' 创建 + GET 过滤测试 |
| `apps/web/test/page-workbench.test.ts`（若有） | 确认 ask 不出现在任务列表 |
| **文档** | |
| `.trellis/spec/api/backend/workflow-requests.md` | 补 `kind` 字段说明 |
| `.trellis/spec/api/backend/coordinator-preview.md` | runType 枚举加 ask |
| `.trellis/spec/web/frontend/new-task-form.md` | 补 ask 下拉选项 + 升级按钮 |

---

## 风险与注意事项

1. **过滤点遗漏风险**（最大风险）：
   - 前端有 3+ 处直接消费 `data.requests`（workbench / myTodos / reports）。若某处未加 `kind !== 'ask'` 过滤，ask 会泄漏进任务列表。
   - **缓解**：在 `data-loading.ts` 加载入口统一过滤一次，下游全局只看到非 ask 的 request（防御性编程）。

2. **LLM 误判**：
   - 标题不明显时，LLM 可能把真正的 feature 误判成 ask，或反过来。
   - **缓解**：用户手选 ask 作兜底；若误判率高，后续补规则关键词表。

3. **升级后分类不符预期**：
   - 用户问「怎么实现 X」→ AI 判 ask → 用户看完答案点「转为正式任务」→ Coordinator 重新从「怎么实现 X」这个提问式标题分类 runType。
   - 若 Coordinator 又判回 ask（循环），需在 `PATCH` 升级时显式传 `type` hint（如 `type: 'feature'`），或让升级按钮带一个类型选择器。
   - **MVP 策略**：先不做 hint，观察实际情况；若循环频繁，升级按钮改成「转为 feature / bugfix 任务」二选一。

4. **runner 误 pick up**（极低概率）：
   - 若 migration / API 逻辑 bug 导致 ask 的 status 被误置 `pending`，runner 会接管并尝试执行。
   - **缓解**：orchestrator 入口加 `kind='ask'` 检测，拒绝执行并报错（后续加强，MVP 可不做）。
