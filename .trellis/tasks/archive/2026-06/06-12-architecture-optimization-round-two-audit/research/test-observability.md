# Research: 测试体系与可观测性结构性缺口审计（二轮）

- **Query**: 覆盖缺口地图 / 测试质量风险 / typecheck 盲区 / 可观测性 / CI 现状
- **Scope**: internal（含本机实测：全量 vitest 跑两遍、各包 src+test 临时 tsconfig 实测 tsc）
- **Date**: 2026-06-12

---

## 1. 覆盖缺口地图

测试文件量级核实：shared 13 / api 32 / runner 31 / web 7，共 83 个 test 文件、718 个测试（本机实测 716 通过、2 失败，失败原因见 §2.3，非代码回归）。

### 1.1 api（src 19 个模块）

api 测试以 HTTP 黑盒为主（`await import('../src/app')` + `app.request(...)`），routes/ 大多间接覆盖。零测试模块核实：

| 模块 | 行数 | 现状 |
|---|---|---|
| `apps/api/src/routes/runner-control.ts` | 168 | **零测试**（grep 全部 api test 无 `/runner/control` 请求）。含 `spawn` 子进程管理本地 runner、模块级可变状态（`child`/`recentLogs` 内存环）——是 api 里唯一管进程生命周期的路由，风险最高的空白 |
| `apps/api/src/routes/runners.ts` | 6 | **零测试**（仅 `GET /` 读 store.runners.list，风险低） |
| `apps/api/src/server.ts` | 21 | 零测试（Bun.serve 入口，黑盒走的是 app.ts，可接受） |

其余：`routes/runner-events.ts`（421 行）经 `agent-events-channels.test.ts`、`knowledge-artifacts-route.test.ts`、`report-sidecars.test.ts` 间接覆盖（`POST /runner/events/agent-stream|artifact|context-request`），但 heartbeat 上报端点 `/runner/events/heartbeat` 没有直接断言。

### 1.2 runner（测试导入映射核实）

31 个 test 覆盖了 agents/、context/、orchestrator/、flows/、sh、worktree、api-client、command-runner、config-client、cmd/watch、knowledge、profile、backend-selection、agent-backend-preflight、reports、skills。零测试模块：

- `heartbeat.ts`（一次性心跳，见 §4.4）、`versions.ts`（工具探测）、`config.ts`、`index.ts`（CLI 入口）、`cmd/run.ts`、`cmd/register.ts`、`cmd/doctor.ts`

### 1.3 web（22 个 src 模块，仅 4 个被测）

核实现状：web 7 个测试文件只 import 了 `projection.ts`、`settings-projection.ts`、`stream-rendering.ts`、`coordinator-clarification.ts` 四个 src 模块（外加根目录 `serve.ts`）。**其余 18 个模块零测试**（一轮说"16 个页面模块"，精确数字是：page-\* 共 7 个文件，加上 api/coordinator-chat/data-loading/dom/main/render-core/router/shell/state/stream/types 共 18 个无测试模块）。

不引框架前提下的可测化路径——按 DOM 耦合度分两类（grep `document.|createElement|querySelector|innerHTML` 计数）：

**(a) 本身已是 DOM-free、可直接加测试**（无需任何抽取）：
- `data-loading.ts`（279 行，0 处 DOM）——数据拉取/组装逻辑
- `state.ts`（268 行，0 处 DOM）——状态容器
- `router.ts`（46 行，0 处 DOM）——路由解析
- `types.ts`（纯类型，无需测）

**(b) page-\* 内已存在的纯函数，可沉淀进 projection 系列**。以最大的 `page-task-detail.ts`（1933 行）为例，以下函数不碰 DOM、只做"数据→文案/状态"映射，可整体搬到一个 `task-detail-projection.ts`：
- `requestTypeLabel` / `stageStateLabel` / `stageCardHint`（:113-:146）
- `reviewGateCopy` / `gateDisplayLabel`（:147-:227）
- `taskFocusSummary` / `taskProgressMetric`（:228-:272）
- `coordinatorVerdictText`（:381）、`stageMarkdownArtifactText`（:522）、`formatPercent`（:590）、`trustKind`（:705）
- `artifactForStage` / `agentTaskForStage` / `auditForStage`（:902-:933，stage 归属过滤规则——业务规则却完全无测试）
- `lifecycleSubtitle`（:966）

其余 page 模块（page-projects 863 行、page-new-task 807 行、page-knowledge 661 行、page-settings 648 行）DOM 直接引用为 0 或个位数（多走 dom.ts/render-core.ts helper），同类"label/summary/过滤"函数可照搬 projection 模式。先例已成立：`settings-projection.ts`、`projection.ts` 就是从页面沉淀出来的。

### 1.4 shared

`packages/shared/src` 的 config/coordinator/flows/node/types/utils 均有对应测试（13 个文件），无明显整目录空白。

---

## 2. 测试质量风险

### 2.1 sleep/setTimeout 依赖（时序脆弱）—— 范围很小

全仓 test 只有 4 个文件涉及（grep 核实）：

| 文件 | 用法 | 风险 |
|---|---|---|
| `apps/web/test/serve.test.ts:56,90` | 真实等待 25ms/50ms | **中**——唯一靠真实时钟等状态的测试 |
| `apps/runner/test/profile.test.ts:45` | 等 10ms | 低 |
| `packages/shared/test/node-agent-backend-preflight.test.ts:43` | `sleep 5` 子进程 + 100ms timeout | 设计内（测超时本身） |
| `apps/runner/test/approval-wait.test.ts:16` | 注入 `sleep: async () => {}` 假时钟 | 良好范式，可推广 |

### 2.2 全量耗时分布（本机实测两遍）

`bun x --bun vitest run`：**墙钟 ~15.7s**（83 文件并行 worker），tests 累计 79.3s、collect 3.1s、transform 1.2s。临时 SQLite 黑盒模式（模块顶层 `mkdtempSync` + `process.env.AINP_DB_PATH` + `await import('../src/app')`，api 27/32 个文件用此模式）本身不贵——耗时大头是**真实子进程 spawn**：

- `apps/runner/test/claude-code-backend.test.ts` 7.7s、`backend-selection.test.ts` 6.5s（每个用例 spawn 假 CLI 1.5-3s）
- `apps/api/test/projects-route.test.ts` 多个 2-3s 用例（spawn 假 codex/claude 做 preflight）
- `packages/shared/test/node-agent-backend-preflight.test.ts` 2.5s

结论：30+ 文件各自建临时库不是瓶颈；优化空间在 CLI spawn 类测试（约 5-6 个文件贡献了大半 CPU 时间）。

### 2.3 环境依赖测试（CI 阻塞项，比执行顺序更紧迫）

本机沙箱实测 2 个失败用例都依赖**开发者本机真实 `claude` 二进制与登录态/用户 settings**：

- `apps/runner/test/claude-code-backend.test.ts` > "uses an isolated HOME only when explicitly opted in"（claude exited -1）
- `apps/runner/test/coordinator-llm-fallback.test.ts` > "keeps user-level hooks when AINP_CLAUDE_LOAD_USER_SETTINGS=1"（真实 LLM 判定结果断言 `proceed`）

这两个测试在无登录态的环境（CI、沙箱）必然红。进 CI 前需要加"CLI 可用性探测 + skip"或打 env 开关。

### 2.4 执行顺序依赖

跨文件：无（vitest 默认每文件独立 worker 进程，且每文件独立临时 DB）。文件内：黑盒测试共享同一个模块级 store/DB，同文件内用例存在前后累积状态（如 projects-route 先建项目后归档），重排会坏——属可接受的既有模式，但新增用例时要知道这一约定。

---

## 3. typecheck 盲区（实测）

核实：**四个包的 tsconfig `include` 全部只有 `src/**/*`（+ shared src），没有任何包把 `test/` 纳入**——不止 web（T2.4 已知），api/runner/shared 的 test 同样在 tsc gate 之外。`package.json` 的 `typecheck` 脚本逐包跑 4 个 tsconfig。

用临时 tsconfig（include 加上 `test/**/*`）逐包实测：

| 包 | 错误数 | 增量耗时 | 错误内容 |
|---|---|---|---|
| shared | **0** | 0.6s | — |
| web | **0** | 2.4s | —（T2.4 担心的 web test 实际已是干净的） |
| api | **22** | 1.2s | `gate-engine.test.ts` 19 处 TS2532（`noUncheckedIndexedAccess` 下数组下标未判空）；`verifier-evidence-route.test.ts` 2 处同类；`workflow-request-chat.test.ts:27` 1 处 fixture 缺 `flowId`/`startStage`（**真实类型漂移**） |
| runner | **~10** | 1.4s | `watch.test.ts` 7 处 fixture 缺 `PendingRequest/ClaimedRequest` 的 `flowId`/`startStage`（**真实漂移**：V2 W2-3 加字段后测试 fixture 没跟上）；`worktree-remote-source.test.ts:32` `'context'` 不是合法 `WorkflowStage` |

成本结论：总修复量约 **32 处、集中在 5 个文件**，多为机械修（fixture 补两个字段、下标断言改 `!` 或判空）；全量 typecheck 时间增量合计约 6s。watch.test 的漂移恰好证明了盲区代价——fixture 类型已落后于真实契约还能全绿。

---

## 4. 可观测性

### 4.1 console 散布现状

| 范围 | console.* 处数 | 说明 |
|---|---|---|
| `packages/shared/src` | **0** | 禁 console 守住了 |
| `apps/web/src` | 1 | page-new-task.ts |
| `apps/api/src` | 4 | `store.ts:1759`（config-audit 镜像失败 warn）、`promote.ts:273,284`（文件写失败 error）、`server.ts:19`（启动 log） |
| `apps/runner/src` | ~77（12 个文件） | 集中在 `orchestrator/steps.ts`(27)、`cmd/run.ts`(10)、`orchestrator.ts`(8)、`invoke-skill.ts`(7)、`cmd/watch.ts`(7) |

格式一致性：已有成文规范 `.trellis/spec/runner/backend/logging-guidelines.md`（双 sink 论：console 给人看、workflow_audit/agent_events 是持久记录；`[runner]`/`[api]` 前缀；"run 内日志必须带 run id"）。实际抽样：前缀基本遵守（`[runner]`/`[api]`/`[config-audit]`），但 **runner 77 处 console 中只有约 3 处带 runId**——"带 run id"条款执行率低，多 run 交错时 console 不可区分。api/shared 各自也有 logging-guidelines.md。

### 4.2 失败路径的可追溯性

`workflow_audit` 共 22 种 kind（workflow_run.created/stage_transition/completed、step.started/finished、gate.recorded/re_evaluated、approval.\*、command.recorded、artifact.created、agent_task/agent_result.recorded、workflow_request.created/claimed/run_started/completed、stage.retry、workspace.prepared、maven_build.recorded 等）。失败覆盖良好的：run 失败走 `workflow_run.completed {ok:false}`（workflow-engine.ts:348）；runner 侧 orchestration 异常经 `cmd/watch.ts:99-105` catch 后 `completeWorkflowRequest({ok:false, error})` 落库。

**只进 console、audit 缺位的失败路径**：
- `promote.ts:273,284`——promote 后文件写失败/entity_id 不安全跳过写盘，DB 已提交、文件系统漂移，**仅 console.error**（R10/R11 注释明示是设计决定，但目前连 audit 行都没有，UI 完全不可见）
- `store.ts:1759`——config-audit 镜像失败 fail-open，仅 console.warn
- `cmd/watch.ts:165`——project lookup 失败静默吞掉（best-effort，注释明示）
- watch 循环里若 **api 本身不可达**：`complete()` 也会 throw，异常逃出 `processOnce`，落不进任何持久 sink

### 4.3 correlation / 结构化日志

无结构化日志、无独立 correlation id；事实上的关联键就是 `workflowRunId`：audit 行带 `workflowRunId` 列，agent_events 按 run/request channel id 路由（`/runner/events/agent-stream` 强制二选一 channel id，有测试）。串联程度：**持久层（audit + agent_events）按 runId 可完整串联；console 层基本串不起来**（见 4.1）。requestId→runId 的链路由 `workflow_request.run_started` audit 衔接，闭环存在。

### 4.4 runner 与 api 失联/重试可见性

- `api-client.ts` 的 `request()`：单次 fetch、失败即 throw，**无重试/退避**；唯一容错是 claim 的 409 返回 null（api-client.ts:98）
- 心跳是**一次性**的：`sendHeartbeat()` 只在 `orchestrator.ts:92`（run 开始）和 `cmd/watch.ts:207`（watch 启动）各调一次，长 run/长 watch 期间不再上报 → api 侧 `store.runners.list` 的 latestHeartbeat 会陈旧，无法区分"runner 活着在干活"和"runner 已死"
- `runner-control.ts` 的 recentLogs 是**内存环**，api 重启即失忆，且该路由零测试（§1.1）

### 4.5 最小可观测性补强建议（MVP 尺度，不引 APM）

1. **runner 侧 10 行 logger 薄封装**：`log(runId, msg)` 统一拼 `[runner] ${runId} ${msg}`，把 steps.ts/watch.ts 的裸 console 收口——零依赖，直接落实 spec 既有条款
2. **补 2 个 audit kind**：`promote.file_write_failed`、`config_audit.mirror_failed`（写库本来就在手边，每处一行 `audit(...)`），消灭"只进 console 的失败"
3. **watch 循环周期性心跳**：在 `sleep(pollMs)` 的循环里顺手 `sendHeartbeat()`（或每 N 次 poll 一次），api 侧 runners 列表即获得活性
4. **api-client 对幂等 GET 加一次简单重试**（一次 retry + 固定短退避即可），claim/complete 等写操作维持现状快失败
5. 不建议：引 pino/winston、OpenTelemetry、独立 trace id——runId 已够 MVP 串联

---

## 5. CI 现状

**仓库无任何 CI 配置**（`.github/` 目录不存在；git ls-files 无 gitlab/jenkins/circleci/drone 痕迹）。现有可直接复用的脚本：`bun run typecheck`（4 包 tsc）、`bun run test`（全量 vitest，~16s）、`bun run smoke`/`e2e`（spawn 真实 agent，不适合无凭据 CI）。

最小 CI 建议（单个 `.github/workflows/ci.yml`，一个 job）：

```
1. oven-sh/setup-bun + bun install
2. bun run typecheck          (~10s)
3. bun x --bun vitest run     (~16s；前置条件：先处理 §2.3 两个真实 claude 依赖用例——
                               加 CLI 探测 skip 或 AINP_SKIP_REAL_BACKEND_TESTS 开关)
4. (可选) native backend 的 smoke 子集作为第三道关
```

前置依赖排序：§2.3 的 2 个环境依赖用例不解决，CI 第一天就是红的；§3 的 test 纳入 typecheck 可作为同一 PR 顺手收编（32 处机械修）。

## Caveats

- 耗时数据为本机（darwin/bun）实测，CI runner 上 spawn 类测试可能更慢
- runner typecheck 错误数"~10"：watch.test.ts 报错有级联展开，独立错误位置 8 处 + worktree-remote-source 1 处
- 临时 tsconfig 写在 /tmp，未触碰仓库内任何配置文件
