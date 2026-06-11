# Research: packages/shared 与 apps 间横切重复分析

- **Query**: 分析 packages/shared 现状与 api/runner/web 之间的横切重复，为简洁性/可扩展性重构提供依据
- **Scope**: internal
- **Date**: 2026-06-11

---

## 1. packages/shared 现状

### 1.1 结构与体量（src 共 3316 行 + 独立 test/ 目录 9 个测试文件）

| 目录 | 内容 | 体量 | 主要消费方 |
|---|---|---|---|
| `types/` | 17 个类型文件（artifact.ts 467 行最大，workflow.ts 223，context.ts 230，knowledge-entity.ts 176） | ~1813 行 | 三端皆用 |
| `utils/` | id.ts(31)、whitelist.ts(20)、surefire.ts(77)、redaction.ts(18)、agent-backend-cli.ts(150)、agent-backend-preflight.ts(274)、context-policy.ts(75) | ~645 行 | api+runner 为主；web 用 surefire/id |
| `config/` | registry.ts(368)、defaults.ts(293)、template.ts(23)——coordinator 关键词/提示词默认值与配置键注册表 | ~684 行 | api(routes/config.ts, routes/coordinator.ts)、runner(config-client.ts) |
| `coordinator/` | rules-core.ts(174) 纯规则分类 `classifyByRulesCore` | 174 行 | api/routes/coordinator.ts + runner/agents/coordinator/rules.ts |
| `flows/` | registry.ts 规范 FLOW_REGISTRY（W2-4 从 runner 迁来，runner 留 re-export shim） | — | api/router.ts、runner/orchestrator.ts、web/projection.ts |

### 1.2 引用情况（grep `@ainp/shared`）

- 导入文件数：api 22 个、runner 28 个、web 仅 3 个（projection.ts / main.ts / stream-rendering.ts）。
- 最高频符号：`newId`(15)、`Project`(15)、`nowIso`(14)、`KnowledgeArtifact`(7)、`Artifact`(7)、`SkillSpec`(6)。
- 消费全部走 barrel（`packages/shared/src/index.ts` 全量 re-export，34 行），无 deep import——符合 spec 要求（见 §4.3）。
- 消费方式为**源码直引**：shared 的 package.json `main/exports` 直接指向 `./src/index.ts`，无构建产物；各 app tsconfig 用 `paths` 映射到同一份源码并把 `../../packages/shared/src/**/*` 纳入 include。

### 1.3 关键架构约束（决定什么能下沉）

`.trellis/spec/shared/backend/directory-structure.md` 明文规定 shared 的纪律：
**No I/O、No side effects、No environment access**——禁止 `node:fs`、`node:child_process`、`bun:sqlite`、`process.env` 直读、`console.*`、`fetch()`（仅允许 `globalThis` 探测兜底，见 agent-backend-cli.ts:143-146 模式）。
这解释了现存"半下沉"形态：preflight 的**纯逻辑**（分类、解析、候选 bin 解析）已在 `packages/shared/src/utils/agent-backend-preflight.ts`，但 **spawn 执行壳**被迫留在 app 层并因此复制了两份（见 §2.1）。

---

## 2. 跨包重复证据（文件:行号对照）

### 2.1 agent-backend-preflight.ts：api 与 runner 几乎逐行相同（最大单点重复）

`apps/api/src/agent-backend-preflight.ts`（134 行） vs `apps/runner/src/agent-backend-preflight.ts`（129 行）：

| 内容 | api | runner | 差异 |
|---|---|---|---|
| 常量 3 个超时值 | 16-18 | 15-17 | 完全相同 |
| `preflightAgentBackend` | 20-43 | 19-38 | **唯一实质差异**：api 入参允许 `null/undefined` 并走 `notConfiguredAgentBackendPreflight()`（api:21-23）；runner 要求非空 |
| `SuccessfulCliRun/FailedCliRun` 接口 | 45-55 | 40-50 | 完全相同 |
| `runFirstSuccessfulCli` | 57-79 | 52-74 | 完全相同 |
| `runCli`（spawn 包装，~50 行） | 81-129 | 76-124 | 逐字符相同 |
| `preflightTimeoutMs`（读 `AINP_AGENT_PREFLIGHT_TIMEOUT_MS`） | 131-134 | 126-129 | 完全相同 |

两份文件都只从 `@ainp/shared` 导入纯逻辑，复制的是 I/O 壳。**测试覆盖**：纯逻辑有 `packages/shared/test/agent-backend.test.ts`、`agent-backend-cli.test.ts`；I/O 壳仅 runner 侧被 `apps/runner/test/backend-selection.test.ts` 间接引用，**api 侧副本无任何直接测试**。

### 2.2 digest.ts：sha256Buffer 双份定义

- `apps/api/src/digest.ts:8-10` 与 `apps/runner/src/digest.ts:3-5`：`sha256Buffer` 逐字符相同。
- 分叉部分：api 另有 `sha256File`(12-14)、`verifyFileSha256`(16-20) + `DigestVerification` 类型（依赖 `node:fs`，被 artifact-content.ts:5、workflow-engine.ts:51 消费）；runner 另有 `sha256CombinedStreams`(7-14)（被 command-runner.ts:12 消费）。
- 注意漂移风险：`CommandRun.combinedSha256` 的"stream separator"约定（`packages/shared/src/types/command.ts:24-48` 注释）由 runner 的 `sha256CombinedStreams` 单方实现，api 若要校验只能再抄一份。
- 测试覆盖：grep 仅 `apps/runner/test/backend-selection.test.ts` 涉及，**两侧 digest 均无专门单测**。

### 2.3 KNOWN_FLOW_IDS：硬编码字面量双份（含同一份数据三处表达）

- `apps/api/src/routes/workflow-runs.ts:33` 与 `apps/runner/src/index.ts:10`：同一字面量数组 `['feature.standard', 'feature.fastforward', 'issue.standard', 'refactor.standard']`。
- 这份数据本质上就是 `FLOW_REGISTRY` 的 key 集合（`packages/shared/src/flows/registry.ts`）。shared 的 registry 文件头注释（第 27-31 行）甚至把"新增 flow 时必须同步更新两处 KNOWN_FLOW_IDS，否则 API 返回 400 / CLI exit 2"列为已知的 7 步手工流程之一——即项目自己已记录了这处重复的扩展成本。

### 2.4 JSON 解析容错：三份独立实现

| 位置 | 形态 |
|---|---|
| `packages/shared/src/utils/agent-backend-preflight.ts:181-195` | `parseJsonLine` + `parseJsonObject`（私有，未导出） |
| `apps/web/src/projection.ts:904` | `parseJsonObject(text?: string\|null)` |
| `apps/runner/src/context/request.ts:191` | `safeJsonParse(text): unknown\|null` |

全仓 `JSON.parse` 出现 58 处（apps），多数裸 try/catch。

### 2.5 错误格式化：`err instanceof Error ? err.message : String(err)` 49 处、跨 16+ 文件、无共享 helper

样例：`apps/api/src/routes/projects.ts:101`、`apps/runner/src/orchestrator.ts:296/1129/1162/1323/1378/1389/1697`、`apps/web/src/main.ts`、`apps/api/src/store/store.ts` 等。shared 中 grep `instanceof Error` 为 0——该 helper 尚不存在。

### 2.6 spawn 收集器模式：runner 内部 4+ 份近似实现（app 内部重复，亦与 §2.1 同构）

- `apps/runner/src/sh.ts:21`（通用 sh 包装，注释自述"thin wrapper"）
- `apps/runner/src/command-runner.ts:43`（白名单命令执行，产出 CommandRun）
- `apps/runner/src/agents/coordinator/llm-fallback.ts:439,496`（`spawnCandidate`：buildAgentBackendCliSpawn + stdout/stderr 收集 + 超时 kill，与 preflight `runCli` 同构）
- `apps/runner/src/agents/claude-code.ts:255,513`、`codex.ts:200,258`（流式解析，结构更复杂但同样手写 timer/kill/collect）

共性骨架（spawn→收集 stdout/stderr→timer kill→settle once）至少出现 6 次；差异在 env 构造与流式/缓冲两种消费方式。注意 shared 禁 `node:child_process`，这类收敛只能放 app 层或新建 node-only 共享包（见 §5 风险）。

### 2.7 时间戳：`new Date().toISOString()` 直写 15 处绕过 `nowIso()`

shared 已有 `nowIso()`（utils/id.ts:16-18，被 import 14 次），但 `apps/api/src/reports.ts:220/228/370/378/589/669`、`promote.ts:195`、`routes/runner-control.ts:79/98`、`store/store.ts:336`、`apps/runner/src/profile.ts:134`、`orchestrator.ts:554/1691`、`agents/native.ts:132/484` 仍直接调用。id 生成无此问题（`randomUUID` 在 app src 零直用，均走 `newId`）。

---

## 3. 类型层质量

### 3.1 shared 内部

- `artifact.ts`（467 行）是 types/ 下最大文件，但**未发现内部重复**：32 个 export 分层清晰（kind 联合→守卫→knowledge metadata 规范化函数→verifier schema→实体接口）。它的问题是"types 文件含大量运行时逻辑"（normalizeKnowledgeContextMetadata 等 ~150 行函数），与 spec 所称 "types/ = Zero-runtime type definitions"（directory-structure.md 顶部注释）已有出入——是"漂移"而非重复。
- `AgentBackendKind`('native'|'codex'|'claude_code') 与 `ProjectAgentBackendKind`('codex'|'claude_code') 同在 `types/agent.ts:15-17`，是刻意的子集关系，非漂移。

### 3.2 app 层影子类型

- **web 是重灾区**：`apps/web/src/projection.ts:150-259` 手写 11 个 `*Dto` 接口，逐字段影子 shared 实体并**弱化类型**：
  - `WorkflowRunDto`(150) vs `WorkflowRun`(workflow.ts:130)——`status: string` 弱化了状态联合；
  - `CommandRunDto`(171) vs `CommandRun`(command.ts:24)——字段名完全同名（stdoutSha256/combinedSha256 等），id 从品牌类型退化为 string，且缺 `timedOut/truncated/stdoutBytes`；
  - `ArtifactDto`(197) vs `Artifact`(artifact.ts:413)——`kind: string` 弱化 `ArtifactKind`；
  - `GateRunDto`(188) vs `GateRun`(gate.ts:36)；另有 RequirementDoc/DesignDoc/CompletionReportDoc 等 API 响应形状（446-525）只存在于 web，api 侧序列化处无对应共享契约。
- **api 的 store Row 接口**（`apps/api/src/store/store.ts:85-1299`，ProjectRow/WorkflowRunRow/ArtifactRow 等 20 个）是 DB 行↔实体的映射层，属合理分层而非影子；但 `store.ts:1288 WorkflowAction` 是 api 私有实体，web 又抄了 `WorkflowActionDto`(projection.ts:216)，两端形状靠手工对齐。
- runner 的 api-client.ts 无本地接口定义（直接用 shared 类型），是三端中最干净的。

---

## 4. 工程一致性

### 4.1 tsconfig

四个包均 extends `tsconfig.base.json`、均 `noEmit: true`，一致性好。已知差异（均有理由）：web 多 `lib: DOM`；shared 无 `types: ["bun"]`（符合"不依赖运行时"纪律）；三个 app 都重复 `paths` + include shared 源码的样板（无根 references/共享片段，新增包需复制这 4 行）。仓库根**无 tsconfig.json**（只有 base）。

### 4.2 测试组织

统一为包级 `test/` 目录（shared 9 个、api 30 个、runner 26 个、web 7 个），无 `*.test.ts` 散落 src，组织一致。覆盖不均：§2.1/§2.2 所列重复文件中，api 侧两份副本均无直接测试。

### 4.3 导出方式

shared 用全量 barrel（index.ts 34 行 `export *`），spec 明文要求"Every public symbol must be re-exported here…never deep imports"（directory-structure.md "index.ts — the barrel"节），消费侧 grep 确认无 deep import。app 之间互不依赖（runner→api 仅走 HTTP），符合 flows/registry.ts:8-10 注释声明的 "apps shouldn't depend on each other"。

### 4.4 相关 spec（重构建议必须对齐）

- `.trellis/spec/shared/backend/directory-structure.md` — shared 纪律（no I/O/env/console/fetch）、types/utils/config/flows 的归属规则、barrel 规则。**现行有效，是下沉判断的硬约束。**
- `.trellis/spec/runner/backend/flow-registry.md` — flow 注册的 7 步流程（含双份 KNOWN_FLOW_IDS 的同步义务）。
- `.trellis/spec/api/backend/error-handling.md` — api 错误双通道（HTTP + audit row）模式。
- `.trellis/spec/guides/code-reuse-thinking-guide.md`、`cross-layer-thinking-guide.md` — 项目自有的复用/跨层思考指南（guides/index.md 将"创建新 utility 前先搜索"列为 CRITICAL 规则）。
- shared/api/runner 的 index.md 中 database/error-handling/logging/quality 多标注 "To fill"，仅 agent-backend-contract、context-injection-protocol、evidence-verifier-protocol、directory-structure 等为 Current。

---

## 5. 可安全下沉/收敛清单（按收益/风险排序）

| # | 项目 | 动作 | 收益 | 风险 | 测试现状 |
|---|---|---|---|---|---|
| 1 | `KNOWN_FLOW_IDS` 双份字面量（api/routes/workflow-runs.ts:33, runner/index.ts:10） | 在 shared/flows/registry.ts 导出 `Object.keys(FLOW_REGISTRY)` 派生的常量 + `isFlowId` 守卫；纯数据，零 I/O，完全符合 shared 纪律 | 高：消除 flow 扩展 7 步流程中最易漏的一步（registry 注释自证） | 低 | `packages/shared/test/flow-registry.test.ts` 已存在可扩展；两处消费各有路由/CLI 测试 |
| 2 | `sha256Buffer`（api/digest.ts:8, runner/digest.ts:3） | 若允许 WebCrypto 化可入 shared；否则收敛进一个 node 共享层。`sha256CombinedStreams` 的分隔符约定至少应在 shared 留契约常量/文档 | 中高：digest 是 evidence-verifier 协议的根基，漂移代价大 | 低-中：`node:crypto` 触犯 shared 禁令，需选址决策（见下） | 两侧均无专门单测，下沉时应补 |
| 3 | preflight 执行壳 `runCli`/`runFirstSuccessfulCli`/`preflightTimeoutMs`（api:45-134 ≡ runner:40-129） | 收敛为单份；因依赖 `node:child_process` 不能进现 shared，需要 `packages/node-shared`（或类似 server-only 包）或由 runner 暴露——后者违反 "apps 互不依赖"，前者是唯一合规路径 | 高：~110 行逐字符重复，且唯一行为差异（null→notConfigured）可用一行适配保留 | 中：引入新包/新分层是架构决策；api 侧副本无测试，迁移需先补 | 纯逻辑已有 shared 测试；I/O 壳仅 runner 间接覆盖 |
| 4 | 错误格式化 helper（49 处 `instanceof Error ? .message : String`） | shared/utils 增加 `errorMessage(err): string`（纯函数，合规），增量替换 | 中：消除最高频微样板 | 低：纯函数、行为等价替换 | 无需独立测试负担，一个单测即可 |
| 5 | JSON 容错解析（shared preflight 私有版:189、web projection.ts:904、runner context/request.ts:191） | 把 shared 内已有的 `parseJsonObject` 从私有提升导出，另两处改引 | 中：三份语义略异（object-only vs unknown）统一后减少边界差异 | 低-中：需核对调用点对 null/非对象的处理差异 | shared 侧可顺势补测试 |
| 6 | `nowIso()` 直写绕过（15 处，见 §2.7） | 机械替换为已有 `nowIso()` | 低-中：一致性 + 未来可注入时钟 | 极低 | `packages/shared/test/id.test.ts` 已覆盖 |
| 7 | web 影子 DTO（projection.ts:150-259 11 个接口） | 让 web 复用 shared 实体类型（或在 shared 增加 API wire 契约层），先从字段同名的 CommandRun/Artifact/GateRun 开始 | 高（长线）：消除 api↔web 手工对齐 | 中-高：DTO 故意弱化（string 化）以容忍 legacy fixture（projection.ts:156-161 注释），直接替换会暴露真实类型缺口；web/main.ts 7396 行单文件放大改动面 | web 有 7 个测试文件，projection 有部分覆盖 |
| 8 | runner 内 spawn 收集器同构（sh.ts/command-runner/llm-fallback/claude-code/codex，6+ 处） | 在 runner 内部先收敛一个 `collectChildProcess` 原语（不动 shared） | 中：减少 timer/kill/settle 样板与不一致（SIGKILL vs SIGTERM 等差异需逐个确认是否故意） | 中-高：各处 env 构造、流式 vs 缓冲、grace 逻辑（claude-code.ts:264-285）差异属行为性，盲目统一有回归风险 | runner 测试较全（codex-backend/claude-code-backend/claude-code-backend-grace 等） |

## Caveats / Not Found

- 未发现 api/runner 各自"影子" shared 类型的实质漂移（影子问题集中在 web）；runner api-client 直接消费 shared 类型。
- `config/defaults.ts` 的 `*_DEFAULT` 常量通过 registry 间接消费，直接 grep `DEFAULTS` 无果属正常（按键名注册）。
- fetch 包装：未发现跨包重复的通用 fetch wrapper（web main.ts:423 有 API_BASE fetch、runner config-client.ts:62 一处局部函数），不构成显著重复。
- SSE：服务端统一用 hono `streamSSE`（workflow-requests.ts:232、workflow-runs.ts:435），web 用原生 EventSource（main.ts:7316），无手写 SSE 编码重复。
- 本报告未运行测试，覆盖情况基于 grep 测试文件引用关系判断。
