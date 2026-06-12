# Research: 一轮架构优化遗留债务核查（第二轮审计输入）

- **Query**: 核对一轮研究报告中登记但未实施的 10 项债务的现状、价值重估与建议
- **Scope**: internal
- **Date**: 2026-06-12
- **一轮报告**: `.trellis/tasks/archive/2026-06/06-11-architecture-review-and-refactor-for-simplicity-and-extensibility/research/`（api/runner/web/shared 四份）

---

## 逐项核查

### 1. context/builder.ts 拆分（runner 报告 R6）

**现状：完全未动，仍是 1025 行。**

- `apps/runner/src/context/builder.ts` 当前 1025 行（一轮登记时同为 1025，零变化）。
- R6 设想的四块职责仍混在一个文件里：
  - maturity：`buildProjectMaturityProfile`（:347-421）+ `modeFor`（:422-441）
  - candidates：`candidate()`（:442）、`candidatesForKnowledgeArtifacts`（:494）、`candidatesForInputArtifacts`（:606）
  - signals：`collectCalibrationSignals` 群（:665-774）+ `signalKindForReviewStatus`（:804）
  - 主装配 `buildContextPack`（:99-249 一带）
- 安全网仍在：`apps/runner/test/context-builder.test.ts` 全是公开函数级断言。

**价值重估：略升。** 一轮把 orchestrator.ts 去闭包拆成了 `orchestrator/steps.ts` 等模块后，builder.ts 成为 runner 内最后一个千行多职责文件；且 context 治理（calibration signals、knowledge review）是近期活跃改动区，拆分能直接降低后续改动的回归面。

**建议：做。** 纯函数搬移、导出面不变，风险低中，可独立成任务，不依赖其他项。

---

### 2. runner spawn 收集器统一（shared 报告 §2.6）

**现状：部分收敛，骨架仍有 7 处。**

当前 `spawn(` 调用点：

| 文件:行 | 说明 |
|---|---|
| `apps/runner/src/sh.ts:21` | 通用 sh 包装（54 行） |
| `apps/runner/src/command-runner.ts:49` | 白名单命令执行（150 行） |
| `apps/runner/src/agents/cli-common.ts:63` | `exitsZero` 探活（一轮后新增的公共层） |
| `apps/runner/src/agents/claude-code.ts:235` | 流式后端（一轮时 2 处，已减为 1） |
| `apps/runner/src/agents/codex.ts:180` | 流式后端（一轮时 2 处，已减为 1） |
| `apps/runner/src/agents/coordinator/llm-fallback.ts:433,490` | spawnCandidate 双份 |

一轮已落的收敛：`cli-common.ts`（181 行）抽出了 `consumeLines`、`cliAvailable`、`createAgentEventEmitter` 等共享件，claude-code/codex 各减一处 spawn。但「spawn→收集 stdout/stderr→timer kill→settle once」骨架本身仍未抽出，llm-fallback.ts:433/490 两份近似实现原样保留。

**价值重估：降低。** 一轮当时评中高风险，现在剩余重复面比当时小（6+ → 实质 4 类骨架），且各处 env 构造/流式 vs 缓冲差异是真实分叉。注意约束仍在：shared 禁 `node:child_process`，收敛只能放 runner 内或 `@ainp/shared/node` 子路径（一轮 dedupe-preflight 任务已开了 node 子路径先例）。

**建议：缩小范围做。** 不追求大一统；只把 llm-fallback.ts 两份 `spawnCandidate` 与 cli-common 的执行壳合并（同文件内重复最刺眼），sh.ts/command-runner.ts 保持现状。可合并进任何 runner agents 方向的任务。

---

### 3. gate-engine requirement/design gate 规则表化（api 报告 #5 残留）

**现状：已半表化，比一轮登记时好。**

- `apps/api/src/gate-engine.ts` 当前 1077 行。
- `runRequirementGate`（:271-364）/`runDesignGate`（:391-486）现结构：前置一段命令式正则判定（:279-295、:394-412），随后是声明式 `RuleResult[]` 字面量数组，统一走 `textRule()` helper（:233-246）+ `record()` 落库；另有 `runArtifactPresenceGate`（:248-268）这类通用 gate 已数据驱动。
- 未做的部分：规则未抽成「ruleId → predicate」数据表，requirement/design 各自维护内联正则；新增一条规则仍要改两段代码。

**价值重估：明显降低。** 一轮的函数合并 + textRule 已消化了大部分重复；剩余「彻底表化」收益主要是美学。除非近期要支持用户自定义 gate 规则（spec 中无此计划），否则是过度设计。

**建议：不做。** 维持现状；若未来出现第三个 markdown 结构 gate 再表化。

---

### 4. SSE tail 两份拷贝（api 报告 #7）

**现状：原样存在,逐行同构。**

- `apps/api/src/routes/workflow-requests.ts:223-300` 与 `apps/api/src/routes/workflow-runs.ts:399-476`：`subscribe`（agent-stream-bus）+ `lastSeq` 去重 + history 回放 + 队列 flush + 5s ping 的状态机两份,连注释（"dedupe across history/live race"、"Tight ping interval (5s)"）都逐字相同。
- 唯二差异：channel kind（`'request'` vs `'run'`）与 history 取数（`store.agentEvents.byRequest` vs `byWorkflow`）。
- 测试侧：`apps/api/test/agent-events-channels.test.ts:216-258` 已覆盖 `sinceSeq` 过滤与 `agent-stream?sinceSeq=-1`，重构有安全网。

**价值重估：上升。** 一轮后 SSE 通道从 run 单通道变成 run+request 双通道，未来 coordinator/knowledge 若再加流式通道就是第三份拷贝。参数化点已收敛到两个（channel + history fetcher），抽取成本低于一轮评估。

**建议：做。** 抽 `sseTailRoute({ channel, fetchHistory })` 到 `routes/helpers.ts` 或 `agent-stream-bus.ts`，两路由各剩 ~10 行。

---

### 5. projects.ts 拆 git-source.ts（api 报告 #11）

**现状：未动。`git-source.ts` 不存在。**

- `apps/api/src/routes/projects.ts` 当前 705 行，git 相关仍内联：`git()` 子进程封装（:597，文件内唯一 `spawn`）、ls-remote 探测（:356）、`validateCredentialInput`（:561 一带）、`credentialedUrl` 凭证 URL 拼装（:682-692）、`sanitizeGitError` 凭证脱敏（:703-704）。
- `apps/api/test/projects-route.test.ts` 存在，覆盖路由层。

**价值重估：基本不变，略升。** 705 行在 api routes 中仍是最大路由文件；且 `credentialedUrl`/`sanitizeGitError` 是安全敏感代码（凭证泄露面），埋在路由文件里不利于单测。runner 侧 `worktree-remote-source.test.ts` 表明 git 源逻辑跨端存在，未来源类型扩展（如一轮报告提到的第二种 source kind）会再碰这块。

**建议：做（低优先级）。** 纯搬移 `git()/credentialedUrl/sanitizeGitError/validateCredentialInput` 到 `apps/api/src/git-source.ts` 并补凭证脱敏单测；可与第 7 项测试补齐合并成一个任务。

---

### 6. store.ts MapLike 双参 set 遗留签名（一轮 A1「可保留」项）

**现状：还在，且已有显式 TODO。**

- `apps/api/src/store/store.ts:35-39`：`interface MapLike` 的 `set(id: string, value: T)`，TODO 注释自述「~57 call sites across src + tests 迁移到单参 set(value) 后删除」。实现处 `:340` `set(_id, req)` 忽略首参。

**价值重估：不变（低）。** 纯机械 churn，无行为风险但也无杠杆；57 个调用点的 diff 噪音大于收益。

**建议：不做（维持一轮判断）。** 留 TODO 即可；若未来做 store.ts（1824 行，全仓第二大）拆分时顺手清理。

---

### 7. api 缺测试区域（api 报告登记）

**现状：四项中两项已闭环，两项仍空白。**

| 区域 | 现状 |
|---|---|
| `router.ts` recommend | **已覆盖**：`apps/api/test/router.test.ts:54`（`router.recommend()` 单测）+ `router-route.test.ts:44-99`（`POST /router/recommend` 契约 4 例） |
| `routes/runners.ts` | **实质消解**：文件已缩为 6 行（单个 `GET /` 转发 `store.runners.list()`），无独立测试价值 |
| `routes/runner-control.ts` | **仍零测试**：168 行（含状态聚合逻辑），`apps/api/test/` 下无对应文件 |
| SSE 断线重连 | **半覆盖**：api 侧 `agent-events-channels.test.ts:216-258` 覆盖 sinceSeq 续传；web 侧 `apps/web/src/stream.ts:297-329` 的 EventSource 重连（onerror → "reconnecting…"）在 `apps/web/test/` 中 grep `reconnect|sinceSeq` 零命中 |

**价值重估：缩小但仍有效。** 剩余缺口集中在 runner-control（168 行有逻辑）与 web 重连路径。

**建议：做（小任务）。** runner-control 路由测试 + web stream.ts 重连/续传测试，约半天粒度；可与第 4 项 SSE 抽取同任务（重构前先补测）。

---

### 8. wire 契约层下沉（T2.4 notes R4 登记）

**现状：登记的影子全部仍在,零下沉。**

- 登记处：`.trellis/tasks/archive/2026-06/06-12-derive-web-dtos-from-shared-types-to-stop-silent-drift/notes.md` §R4-A（api 私有形状影子清单，表中 11 行条目）。
- 抽查确认仍存在：`projection.ts:272 ApprovalDto`、`:285 WorkflowActionDto`、`types.ts:127 RunnerDto`、`:253 RunnerControlStatusDto`（双端手工对齐，api 源分别在 store.ts / routes/runner-control.ts）。
- sidecar 文档契约：`ainp.requirement.v1` 等 schema 字符串三端各写一份——`apps/api/src/reports.ts`、`apps/runner/src/agents/native.ts`、`apps/web/src/projection.ts`（+三份对应测试），无共享类型化 schema。
- notes.md 还登记了两个待澄清点：`CommandRunDto.stage` 的 Weaken（CommandStage vs WorkflowStage 零交集，page-task-detail.ts:869 历史比较）和 web 独有文档解析形状需先做「sidecar schema 契约下沉」。

**价值重估：上升。** T2.4 已把「shared 有源」的影子全部派生收紧,剩下的恰是漂移风险最高的部分（api 私有 + sidecar 三端手抄 schemaVersion）。这是 T2.4 显式留给「下一个专门任务」的续篇,前置调研已做完（清单、证据链俱在 notes.md）。

**建议：做，且优先级最高。** 拆两步：(a) api 私有 wire 形状下沉 `packages/shared`（11 条影子逐条消灭）；(b) sidecar 契约（ainp.requirement.v1/design.v1/completion 系列）类型化为 shared schema,三端共用。顺带可裁决 `CommandRunDto.stage` 待澄清点。

---

### 9. index.html 内联 CSS（web 报告 #11）

**现状：一字未动。**

- `apps/web/index.html` 仍为 764 行，`<style>` 块 :7-758（约 750 行内联 CSS），与一轮报告登记的数字完全一致。

**价值重估：不变（低中）。** TS 拆分已完成（main.ts 7396 → 101 行 + 21 个模块），CSS 是最后一块单体。无行为风险，但 764 行 HTML 里 98% 是样式，影响样式定位效率；且页面模块化后「按页面拆 CSS 文件」有了天然对应关系。

**建议：做（机械任务）。** 搬到 `src/styles/*.css` 由 Vite 引入即可；适合作为低风险填充任务，不与其他项耦合。

---

### 10a. reports.ts 残余坏味道（api，现 973 行）

**现状：persistReportPair 已抽出（:22-73），时间戳直写已清零（`new Date().toISOString()` 0 处，一轮 §2.7 登记 6 处——已修）。剩余结构：**

- 四个 `generate*` 巨型函数各自装配「markdown 正文 + sidecar JSON」：`generateCompletionReport`（:74-330，~256 行）、`generateKnowledgeCandidate`（:331-446）、`generateRetroReport`（:447-649，~200 行）、`generateRetroEvalScenarioDraft`（:650-744）。坏味道是函数体内 markdown 模板字符串拼接与数据收集混在一起，而非函数间重复。
- 后半段独立子域：knowledge suggestion 机器（`collectKnowledgeReviewSignals` :745、`buildKnowledgeSuggestions` :794-920、normalize/guard 群 :921-977），与报告生成弱耦合,是天然拆分缝。

**价值重估：中。** 比一轮时好（pair 持久化、时间戳已治理）；剩余是「长函数」而非「重复」，回归面小。

**建议：缩小做。** 只把 knowledge suggestion 子域（:745-977，~230 行）拆为 `knowledge-suggestions.ts`；四个 generate* 模板函数不强拆（模板内聚，拆了反而碎）。

### 10b. web render 全树重渲性能模型

**现状：确认为全树重建模型。**

- `apps/web/src/render-core.ts:41-70` `render()`：每次状态变更 `clear(root)` 后整棵重建 `hooks.renderShell()`，为此维护了五套 capture/restore 补偿机制——details 展开态、视口滚动、容器滚动（`data-scroll-key`）、coordinator 回复输入框焦点/IME（composing 时整帧 defer）、new-task 表单焦点。
- 这是结构性模型而非 bug：补偿机制本身（177 行）就是该模型的持续税。SSE 高频事件流场景（stream.ts 每事件触发 render）下税最重。

**价值重估：登记为「已知模型」，暂不改。** 页面拆分后各 page-*.ts 已是独立 render 函数，未来若引入局部渲染（按 route 只重建当前页）改造面已收窄到 render-core + shell；但这属于行为有感知风险的架构改造,不是「行为不变」重构。

**建议：不在本轮做；** 仅当出现实际卡顿证据（长事件流页面）时立项,届时优先「按页局部重渲」而非引入框架。

---

## 当前全仓 Top15 大文件（wc -l，排除 .d.ts/test）

| # | 行数 | 文件 | 热点属性 |
|---|---|---|---|
| 1 | 1933 | `apps/web/src/page-task-detail.ts` | **新热点**（main.ts 拆分产物中最大块,超过原任何单文件除 main.ts） |
| 2 | 1824 | `apps/api/src/store/store.ts` | 旧热点（一轮已知,未拆） |
| 3 | 1106 | `apps/api/src/workflow-engine.ts` | 旧热点 |
| 4 | 1077 | `apps/api/src/gate-engine.ts` | 旧热点（一轮 #5 已治理过,结构尚可） |
| 5 | 1027 | `apps/web/src/projection.ts` | 旧热点（T2.4 后承载 DTO 层,与第 8 项相关） |
| 6 | 1025 | `apps/runner/src/context/builder.ts` | 旧热点（R6 零进展,见第 1 项） |
| 7 | 973 | `apps/api/src/reports.ts` | 旧热点（小幅改善,见第 10a 项） |
| 8 | 863 | `apps/web/src/page-projects.ts` | **新热点**（拆分产物） |
| 9 | 838 | `apps/runner/src/orchestrator/steps.ts` | **新热点**（orchestrator 去闭包产物） |
| 10 | 807 | `apps/web/src/page-new-task.ts` | **新热点**（拆分产物） |
| 11 | 705 | `apps/api/src/routes/projects.ts` | 旧热点（#11 未做,见第 5 项） |
| 12 | 661 | `apps/web/src/page-knowledge.ts` | **新热点**（拆分产物） |
| 13 | 648 | `apps/web/src/page-settings.ts` | **新热点**（拆分产物） |
| 14 | 619 | `apps/api/src/store/db.ts` | **新热点**（显式版本化迁移任务后膨胀） |
| 15 | 593 | `apps/runner/src/agents/coordinator/llm-fallback.ts` | 旧热点（§2.6,见第 2 项） |

新热点判读：web 六个 page-* 文件是 main.ts（原 7396 行）拆分的直接产物——总量未减但已按页隔离，其中 page-task-detail.ts 1933 行是唯一值得再拆的（接近原则上限的两倍）；steps.ts/db.ts 是一轮重构的预期产物，结构健康，暂不视为债务。

---

## 建议优先级汇总

| 优先级 | 项 | 方向 |
|---|---|---|
| P0 | 8. wire 契约下沉（api 影子 + sidecar schema） | 漂移风险最高,前置调研已完备 |
| P1 | 4+7. SSE tail 抽取 + runner-control/web 重连补测 | 先补测后重构,同一任务 |
| P1 | 1. builder.ts 四模块拆分 | 独立任务,纯搬移 |
| P2 | 5. projects.ts → git-source.ts | 含凭证安全测试 |
| P2 | 9. index.html CSS 外置 | 机械低风险填充 |
| P2 | 10a. reports.ts knowledge-suggestions 拆出 | 缩小范围 |
| P3 | 2. llm-fallback spawnCandidate 合并到 cli-common | 缩小范围 |
| 不做 | 3. gate gate 规则表化 / 6. MapLike set / 10b. 全树重渲 | 收益不足或非行为不变 |
