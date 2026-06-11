# Research: apps/api 架构分析（为简化与可扩展性重构提供依据）

- **Query**: 从架构角度深入分析 apps/api（Bun/TypeScript HTTP API），输出模块地图、坏味道清单、可安全重构建议、与 runner 的重复代码
- **Scope**: internal
- **Date**: 2026-06-11

---

## 1. 模块职责地图与依赖方向

### 1.1 规模概览（行数）

| 文件 | 行数 | 职责 |
|---|---|---|
| `src/store/store.ts` | 1758 | 22 张表的 repo 对象 + Row↔Domain 映射 |
| `src/workflow-engine.ts` | 1106 | 唯一状态写入者（run/request/step/artifact/build/approval/agent event…） |
| `src/gate-engine.ts` | 1085 | 唯一 Gate 判定者（compile/test/requirement/design/acceptance/evidence…） |
| `src/reports.ts` | 980 | 三类报告生成（completion / knowledge candidate / retro）+ eval 草稿 |
| `src/routes/projects.ts` | 653 | 项目 CRUD + git 源探测 + 凭证处理 + 分支检测 |
| `src/routes/workflow-runs.ts` | 505 | run CRUD + 各类 action 端点 + SSE 流 |
| `src/store/db.ts` | 471 | SQLite 连接 + import 副作用式迁移 |
| `src/context-governance.ts` | 451 | 上下文治理读模型 |
| `src/routes/runner-events.ts` | 442 | Runner 事件 ingress（13 个 POST 端点） |
| `src/router.ts` | 240 | Smart Router 规则引擎（纯函数 recommend） |

### 1.2 分层与依赖方向（谁依赖谁）

```
server.ts (Bun.serve, 11 行)
  └─ app.ts (52 行, Hono 路由挂载)
       └─ routes/* (14 个文件)
            ├─ workflow-engine.ts ──┬─ store/store.ts ─ store/db.ts
            │     ├─ gate-engine.ts ┤        │
            │     ├─ router.ts ─────┤        └─ @ainp/shared
            │     ├─ agent-stream-bus.ts
            │     └─ digest.ts
            ├─ gate-engine.ts ── artifact-content.ts ── digest.ts
            ├─ reports.ts ── workflow-engine.ts + context-governance.ts
            ├─ promote.ts ── workflow-engine.ts + promote-file.ts + db(直接事务)
            └─ store/store.ts（多数路由也直接读 store）
```

**结论：模块级无循环依赖**。`store → db → shared` 是底座；`gate-engine` 只依赖 `store + artifact-content`；`workflow-engine` 依赖 `gate-engine`（单向）。

### 1.3 依赖方向上的四个问题点

1. **路由层横向依赖**：`routes/workflow-requests.ts:20-25` 从 `./workflow-runs` import `KNOWN_FLOW_IDS / isFlowId / isWorkflowStage`。trust-boundary 类型守卫定义在某个路由文件里、被兄弟路由复用——守卫应下沉到 `@ainp/shared`（对应的 union 类型本来就定义在 `packages/shared/src/types/workflow.ts`）。
2. **同一守卫第三次重复**：`routes/runner-events.ts:293-312` 又手写了一份 `WORKFLOW_STAGE_VALUES + isWorkflowStageValue`，与 `routes/workflow-runs.ts:45-63` 内容完全一致。
3. **audit 写入双轨**：`workflow-engine.ts:1056-1070` 的 `audit()` 是正式入口，但 `gate-engine.ts:61-67` 为避免反向依赖 workflow-engine，直接 `store.auditLog.insert({...})` 内联了一份等价实现。说明 `audit` 应独立成模块（或挂在 store 层），而非寄生在 workflow-engine。
4. **workflow-engine 扇出过大**：它同时 import store、db（直接开事务，`workflow-engine.ts:182`）、gate-engine、agent-stream-bus、router（`recommend`，`workflow-engine.ts:60,93-95`）、digest——是事实上的"上帝模块"。
5. **db.ts 的 import 副作用**：`db.ts:325` 在模块加载时执行全部迁移；`db.ts:6` 在 import 时读 `AINP_DB_PATH`。所有测试都被迫"先设 env 再动态 `await import`"（见 `test/workflow-engine.test.ts:7-15`）。没有版本号迁移表，靠 `PRAGMA table_info` 逐列探测（`db.ts:331-471`）。

---

## 2. 代码坏味道清单（按文件，附行号证据）

### 2.1 store/store.ts —— 巨量同构样板

- **22 个实体重复同一模式**：`XxxRow` interface + `rowToXxx()` + repo 对象（set/get/has/values/byX），每个实体约 60-80 行。例如 projects（`store.ts:85-169`）、workflowRuns（`173-256`）、stepRuns（`347-405`）、commandRuns（`409-516`）……直到 configAudit（`1659-1726`）。`upsertRow/insertRow/countRows`（`63-81`）已抽象了写入，但 **读路径（prepare→get/all→map(rowToX)）和字段映射没有任何抽象**，是该文件 1758 行的主因。
- **MapLike 兼容层是历史遗留**：`store.ts:35-41` 的 `MapLike<T>` 接口 + 注释（`28-33`）说明它是为兼容早已删除的内存 Map store 而保留的 `set(id, value)` 双参签名——`set` 的第一个参数全部被忽略（`129, 214, 295, 372, 461` 的 `set(_id, p)`）。
- **back-compat 转发函数**：`store.ts:1754-1757` `projectByName / workflowRunsByProject / commandRunsByWorkflow` 只是别名转发。
- **缩进损坏**：`store.ts:1730-1733`（以及 `db.ts:52-66`）混用 tab/space。
- **JSON 列裸 parse**：`rowToGateRun`（`540-542`）、`rowToBuildRun`（`1016-1017`）等直接 `JSON.parse(...)` 无容错，而 `parseStringArrayJson`（`51-60`）又是有容错的——同一文件内两种态度。

### 2.2 workflow-engine.ts —— 多职责聚合 + 非原子读改写

- **8 类职责揉在一个文件**：run 生命周期（`70-136`）、request 队列（`140-252`）、stage/step（`254-341`）、retry/re-evaluate（`350-439`）、workflow actions（`443-561`）、artifact + knowledge artifact 校验（`563-777`）、Maven ingest（`779-919`）、heartbeat/approval/agent task/audit/agent events（`921-1106`）。
- **claimWorkflowRequest 有 TOCTOU 竞态**：`workflow-engine.ts:200-215` 先 `get` 判断 `status !== 'pending'` 再 `set`，不是原子 `UPDATE ... WHERE status='pending'`。多 runner 并发 claim 同一 request 时可能双双成功（SQLite 单写有锁，但两次独立语句之间无隔离）。`completeWorkflowRequest`（`233-252`）、`markWorkflowRequestRunStarted`（`217-231`）同模式。
- **recordMavenBuild 110 行 + 占位补丁**：`810-919`；`835` 先写 `buildRunId: '__pending__'`，`874-878` 再回填——因为 TestRun 在 BuildRun 之前构造。顺序调整即可消除。
- **knowledge metadata 归一化逻辑深奥**：`712-777` 的 `knowledgeMetadataForStatusTransition / omitStatusDerivedContextDefaults / sourceRefsEqual` 是"先减默认值再加默认值"的逆操作链，缺少单元级注释外的可读性。

### 2.3 gate-engine.ts —— 规则硬编码 + 函数级重复

- **完全相同的两个函数**：`matchRequirementSection`（`366-372`）与 `matchDesignSection`（`482-488`）逐字相同（仅函数名不同）。
- **requirement/design gate 同构**：`runRequirementGate`（`261-355`）与 `runDesignGate`（`374-476`）都是"读文本 → N 个 regex 检查 → N 个 textRule 推入数组"。规则不是数据（声明式规则表），而是手写命令式代码；新增规则=改函数体。
- **runEvidenceGate 单函数 ~180 行**：`648-827`，8 条规则的构造内联在一个数组字面量里，三元表达式嵌套三层（如 `736-745`、`807-818`）。
- **verifier 媒体角色解析散布**：`isVerifierMediaArtifact`（`955-967`）、`verifierMediaRole`（`1038-1044`）、`parseVerifierMediaRole`（`1046-1063`）、`captureToVerifierRole`（`1065-1069`）四个函数交叉兜底多种 metadata 拼写——历史兼容逻辑应集中成一张映射表。
- `uniqueCommands`（`853-862`）与 `uniqueArtifacts`（`1076-1085`）是同一个"按 id 去重"泛型函数写了两遍。

### 2.4 reports.ts —— 三份报告共享 60 行尾部样板

- 三个生成器 `generateCompletionReport`（`24-293`）、`generateKnowledgeCandidate`（`300-428`）、`generateRetroReport`（`435-655`）的尾部完全同构：`mkdir → newId('art') → writeFile(md) → JSON.stringify → writeFile(json) → audit(...) → createArtifact(md) → createArtifact(json sidecar)`，分别在 `223-292`、`373-427`、`614-654` 重复三次（连 metadata 形状都一致）。
- 局部 util `asRecord/stringArray/stringField`（`962-976`）与 `routes/workflow-runs.ts:411-413` 的 `isRecord`、runner 侧类似函数是一类 JSON 防御式提取的多处实现。
- `isReviewAction`（`947-955`）与 `routes/workflow-runs.ts:401-409` 的 `isKnowledgeReviewAction` 是同一份动作枚举写了两遍（内容一致）。

### 2.5 routes/* —— handler 样板与校验缺失

- **404 守卫重复 11 次**：`if (!store.workflowRuns.has(id)) return c.json({ error: 'not found' }, 404)` 出现在 `workflow-runs.ts:194, 216, 242, 264, 275, 295, 312, 319, 326, 418, 432`。
- **请求体零校验**：所有 POST handler 都是 `(await c.req.json()) as {...}` 类型断言 + 手写 if 链（如 `workflow-runs.ts:84-93`、`runner-events.ts:118-135`、`projects.ts:119`）。没有 schema 校验库；每个端点的错误信息格式手工拼接。
- **/run-gate switch 分发**：`runner-events.ts:358-427` 按 gateId switch 到 6 个 gate 函数；`workflow-engine.ts:409-422` 的 `reEvaluateGate` 又有一个小号 switch。新增 gate 需改 gate-engine + 这两处。
- **SSE tail 实现两份**：`workflow-runs.ts:430-505`（run 频道）与 `workflow-requests.ts`（request 频道，同样的 subscribe/queue/lastSeq/5s-ping 循环）是同一状态机的两份拷贝。
- **projects.ts 是混合体**：路由 handler（`80-281`）+ git 子进程封装 `git()`（`543-559`）+ ls-remote 解析（`586-602`）+ 凭证 URL 拼装/脱敏（`630-653`）+ 注册体归一化（`350-409`）。PUT `/:id` 的"凭证保留"三段式判断（`229-233`、`247-252`）出现两次且语义微妙。`projects.get('/:id', includeSecret=1)`（`275-281`）会返回明文凭证，无任何鉴权层。

### 2.6 db.ts

- 迁移即 import 副作用（`325`，以及 `327-471` 的探测式 ALTER），无迁移版本表；`agent_events` 重建表逻辑（`435-471`）内联在模块顶层。

---

## 3. 可安全执行的重构建议（按 收益/风险 排序）

测试基础设施说明：`apps/api/test/` 共 29 个文件；至少 16 个通过 `await import('../src/app')` 走 **完整 HTTP 层 + 临时 SQLite**（行为级黑盒），14 个直接 import store、7 个直接 import workflow-engine。这种"端到端为主"的测试形态对**保持行为的内部重构非常友好**。

| # | 建议 | 收益 | 风险 | 测试覆盖 |
|---|---|---|---|---|
| 1 | **store.ts 引入 repo 工厂**：`defineTable({ table, columns: {db_col: domainField/codec} })` 自动生成 get/values/byX/set，消除 22 份手写映射，预计 -700~900 行 | 极高 | 低（纯内部） | 好：entity-tables、coordinator-store、config-audit-mirror 直测 store；16 个 HTTP 级测试间接覆盖全部 repo |
| 2 | **下沉类型守卫到 shared**：`isFlowId/isWorkflowStage/KNOWN_*` 移入 `packages/shared`（类型同文件），删除 3 处重复（workflow-runs.ts:33-63、runner-events.ts:293-312、workflow-requests 的 import） | 高 | 低 | 好：router-route、workflow-request-routes、workflow-runs-route 测试覆盖 400 分支 |
| 3 | **routes 公共 helper**：`requireRun(c)`（404 守卫）、统一 `jsonError(c, msg, status)`；消 workflow-runs.ts 的 11 处样板 | 高 | 低 | 好：workflow-runs-route、workflow-actions 等 HTTP 测试 |
| 4 | **reports.ts 提取 `persistReportPair()`**（md+json sidecar+audit+双 createArtifact 的 60 行尾部）×3 | 中高 | 低 | 中：report-sidecars.test.ts 覆盖 sidecar 行为；retro/eval-draft 路径经 workflow-runs-route 端点测试间接覆盖 |
| 5 | **gate-engine 文本规则声明化**：requirement/design gate 改为 `[{ruleId, test(text), pass, fail}]` 规则表驱动；合并 matchRequirementSection/matchDesignSection | 中高 | 低 | 很好：gate-engine、design-gate-cs-feat-design、requirement-gate-cs-req 三个专测 |
| 6 | **audit() 独立成模块**（如 `src/audit.ts` 或挂 store），gate-engine.ts:61-67 改用之，消除双轨 | 中 | 低 | 间接（所有写路径测试都断言行为，audit 行为不变） |
| 7 | **SSE tail 提取公共函数**（run/request 两个频道复用一个 `tailAgentEvents(channel, sinceSeq)`） | 中 | 中（流式行为微妙：ping/去重/abort） | 中：agent-events-channels、agent-stream-bus 测试存在，但 SSE 断流细节未必全覆盖 |
| 8 | **拆分 workflow-engine.ts 按域成多文件**（requests/steps/artifacts/knowledge/builds/approvals/events），保留 `workflow-engine.ts` 做 re-export 以免改 30+ 处 import | 中 | 中（纯移动，但 import 面广） | 好：workflow-engine.test.ts + 大量路由测试 |
| 9 | **claimWorkflowRequest 改原子 `UPDATE ... WHERE status='pending'`**（注意：这是正确性修复，行为在并发下会变） | 中 | 中 | 弱：workflow-requests.test.ts 存在但无并发用例，需补测试 |
| 10 | **recordMavenBuild 消除 `'__pending__'` 占位**（先建 BuildRun id 再建 TestRun） | 低 | 低 | 好：workflow-engine.test.ts、报告相关测试 |
| 11 | **projects.ts 拆分**：git 探测/URL/凭证逻辑移到 `src/git-source.ts` | 中 | 中 | 中：projects-route.test.ts 存在，但 `git()` 子进程路径（detect-source、branches）依赖真实 git，单测覆盖存疑，重构前应先确认/补 mock |
| 12 | **db.ts 迁移显式化**（`initDb()` 函数 + 迁移版本表） | 中 | 中高（所有测试依赖"先设 env 再 import"的副作用时序，需同步改 29 个测试的 bootstrap） | 全量测试都会感知，建议放最后或单独任务 |

**明确缺测试的区域**（重构前需补）：`routes/runner-control.ts`（167 行，spawn runner 进程，未发现专测）、`routes/runners.ts`、`router.ts` 中 `recommend()` 仅 1 个专测（router.test.ts）、projects.ts 的远端 git 探测路径、SSE 断线重连语义。

---

## 4. 与 runner 重复的代码清单（能否下沉 packages/shared）

| 文件对 | 重复程度 | 证据 | 下沉评估 |
|---|---|---|---|
| `apps/api/src/agent-backend-preflight.ts`（134 行） vs `apps/runner/src/agent-backend-preflight.ts`（130 行） | **~96% 逐字相同** | diff 仅 2 处：api 版签名接受 `null/undefined` 并提前返回 `notConfiguredAgentBackendPreflight()`（api:20-24）；其余 `runFirstSuccessfulCli/runCli/preflightTimeoutMs` 完全一致 | **可下沉**。`packages/shared/src/utils/agent-backend-cli.ts` 已负责构建 spawn 参数（`buildAgentBackendCliSpawn`），只差执行器。把 `runCli` + `preflightAgentBackend` 下沉后引入 `node:child_process` 依赖——api(Bun)/runner(Bun/Node) 都可用；若想保持 shared 纯净，可建 `packages/shared/src/node/` 子路径导出 |
| `apps/api/src/digest.ts`（20 行） vs `apps/runner/src/digest.ts`（14 行） | `sha256Buffer` 重复；api 另有 `sha256File/verifyFileSha256`，runner 另有 `sha256CombinedStreams` | 两文件首 8 行同构 | **可下沉**，合并成 shared 一个 `digest.ts`（4 个函数，零外部依赖，最低风险的下沉候选） |
| `apps/api/src/reports.ts` vs `apps/runner/src/reports.ts` | **同名但不重复**：api 是报告生成（md/json），runner 是 surefire XML 收集（83 行） | runner/reports.ts:1-36 | 不需下沉；建议 **改名**（runner 侧 → `surefire-collect.ts`）消除同名误导 |
| spawn 包装三连 | `projects.ts:543-559` 的 `git()`、两份 preflight 的 `runCli`、`apps/runner/src/sh.ts` | 同一"spawn→收集 stdout/stderr→close resolve"模式 ×4 | 可统一为 shared 的一个 `runCommand(bin, args, opts)`，preflight 下沉时顺带完成 |
| WorkflowStage/FlowId 守卫 | api 内部 3 处（见 §2.5）；runner 侧 flows/registry 也消费 FlowId | — | 与建议 #2 合并处理 |

---

## 5. 值得保留的架构优点（重构时不要破坏）

- **三条清晰的不变式**（注释中明确声明且代码遵守）：workflow-engine 是唯一状态写入者（`workflow-engine.ts:62-68`）；gate-engine 是唯一 pass/warn/fail 判定者（`gate-engine.ts:24-31`）；`recordAgentEvent` 是 agent_events 唯一写入口、负责频道互斥与单调 sequence（`workflow-engine.ts:1074-1090`）。
- Runner 是"事件汇报者"而非状态写入者（`runner-events.ts:41-44`），ingress 端点只转发到 engine。
- 测试以 HTTP 黑盒为主 + 临时 SQLite，为行为保持型重构提供了天然安全网。

## Caveats / Not Found

- 未运行测试套件确认当前绿色基线（建议重构前先 `bun test`/`vitest` 留底）。
- `projects-route.test.ts`、`workflow-requests.test.ts` 的具体断言范围未逐行核对，覆盖度判断基于文件存在性与 grep 命中。
- `context-governance.ts`（451 行）、`promote.ts`（288 行）只看了 import 面，未逐行审：promote.ts 直接 import `db` 开事务，与 workflow-engine 同为"绕过 store 的事务持有者"，拆分 store 时需一并考虑。
