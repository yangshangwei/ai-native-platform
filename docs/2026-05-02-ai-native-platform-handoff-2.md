# AI Native Platform：第二轮交接文档（MVP 已打通，Sprint 3 需重选真 AI Backend）

本文承接 `2026-05-01-ai-native-platform-handoff.md`，记录第一+第二轮（Phase 1 / Wave A+B+C）已落地的能力、验证手段、已知问题与下一步推进计划。新窗口直接读这一篇就能接上。

## 1. 当前状态：MVP 9 阶段闭环可跑通，CodexBackend 初版已接入

九阶段 `init → context_pack → requirement → design → implementation → build_test → review → completion → knowledge` 已经端到端跑通。所有产物（Artifact、CommandRun、BuildRun/TestRun、GateRun、Approval、AuditLog）落 SQLite，可被 Web UI、Completion Report、Knowledge Candidate 引用。

当前实现不是“只有 NativeBackend 桩”了：

- `NativeBackend` 仍是默认可复现基线：需求/设计/评审为模板产物，implementation 做低风险 Java 注释变更。
- `Context Pack` 初版已接入编排：生成 `project_profile`，按用户请求搜索源码证据，并读取已确认 knowledge。
- `ClaudeCodeBackend` streaming 初版已在工作区：可调用本地 `claude` CLI，解析 `stream-json`，通过 API 持久化并用 SSE 推到 Web UI。
- `CodexBackend` 初版已实现：`AINP_AGENT_BACKEND=codex` 会调用本地 `codex exec --json`，不可用时明确 fallback 到 NativeBackend。

当前第一条“真 AI Backend”主线已按文档叙事先接 **CodexBackend**；Claude Code streaming 仍保留为可选 backend。

## 2. 仓库结构

```
ai-native-platform/
  apps/api/        Hono on Bun + SQLite + Workflow Engine + Gate Engine + Reports
    src/server.ts                      入口
    src/agent-stream-bus.ts            Agent stream SSE 的内存 pub/sub
    src/workflow-engine.ts             唯一状态写入者
    src/gate-engine.ts                 Compile/Test/DiffScope/Sensitive/Manual gates
    src/reports.ts                     Completion Report + Knowledge Candidate 生成器
    src/store/{db,store}.ts            SQLite migrations + 仓库类
    src/routes/{projects,workflow-requests,workflow-runs,artifacts,runner-events,approvals,runners}.ts
  apps/runner/     Local Runner CLI
    src/index.ts                       CLI 分发：health/doctor/register/run/orchestrate/watch
    src/orchestrator.ts                9 阶段编排器
    src/agents/native.ts               NativeBackend 桩（待替换为真 LLM）
    src/agents/claude-code.ts          Claude Code CLI backend + 实时 stream-json 转发
    src/agents/claude-code-parser.ts   Claude stream-json 纯解析器
    src/profile.ts                     Project Profile / Context Pack 输入
    src/knowledge.ts                   Knowledge Candidate promoted 后反哺 Context Pack
    src/skills/index.ts                Canonical SkillSpec
    src/worktree.ts                    TrustedLocalWorktreeEnvironment
    src/command-runner.ts              白名单 + 超时 + 日志截断 + CommandRun 装配
    src/{api-client,heartbeat,reports,versions,sh,config}.ts
    src/cmd/{register,run,doctor,watch}.ts
  apps/web/        5173 Delivery Workbench（Bun.serve + 原生 TS，无前端框架）
    index.html, src/{main,projection}.ts, serve.ts
  packages/shared/ 跨包共享
    src/types/{ids,project,workflow,artifact,command,gate,build,agent,
               execution-environment,skill}.ts
    src/utils/{id,whitelist,surefire}.ts
    test/{whitelist,surefire,id}.test.ts
  examples/java-maven-sample/
    pom.xml + Calculator.java + 3 个 JUnit 测试（独立 git 仓库）
  scripts/
    smoke.ts   小闭环验证：register → mvn test → CommandRun 落库
    e2e.ts     九阶段端到端 + 自动 approve 4 个人工门禁 + 全量断言
    smoke-claude-code.ts  单阶段 Claude Code streaming 验证
  vitest.config.ts
```

源码规模已随 Context Pack 与 Claude streaming 增长；不要再依赖旧的“65 文件 / ~5600 LOC”估算。

## 3. 已落地的核心能力清单

| 能力 | 落地位置 | 状态 |
|---|---|---|
| WorkflowRun / StepRun / CommandRun / GateRun / Artifact / BuildRun / TestRun / AgentTask / AgentResult / Approval / AuditLog 模型 | `packages/shared/src/types/*` + `apps/api/src/store/*` | 完整 |
| SQLite 持久化（默认 `~/.ai-native/ainp.sqlite`，可 `AINP_DB_PATH` 覆盖） | `apps/api/src/store/db.ts` | 完整 |
| Workflow Engine 唯一状态写入 | `apps/api/src/workflow-engine.ts` | 完整 |
| Trusted Local Worktree（路径 `~/.ai-native/worktrees/{projectId}/{runId}/workspace`，分支 `ai/{runId}-{slug}`） | `apps/runner/src/worktree.ts` | 完整 |
| 命令白名单（mvn/git 子集）+ 5min timeout + 8MB 日志截断 + CommandRun 落库 | `apps/runner/src/command-runner.ts` + `packages/shared/src/utils/whitelist.ts` | 完整 |
| Surefire / Failsafe XML 解析 → BuildRun + TestRun | `packages/shared/src/utils/surefire.ts` + `apps/runner/src/reports.ts` + `workflow-engine.ts` 的 `recordMavenBuild` | 完整 |
| Gate Engine：compile / test / diff_scope / sensitive_change / manual / artifact_presence | `apps/api/src/gate-engine.ts` | 完整 |
| Manual gates 走 `/approvals` | `apps/api/src/routes/approvals.ts` | 完整 |
| Runner heartbeat（每次 invoke 上报 jdk/maven/git 版本） | `apps/runner/src/heartbeat.ts` + `versions.ts` + API 的 `/runner/events/heartbeat` | 完整 |
| AgentBackend 接口 + NativeBackend 桩（产出 requirement/design/review markdown，implementation 给 Calculator.java 加注释） | `apps/runner/src/agents/native.ts` | 完整（默认基线） |
| Claude Code CLI streaming backend | `apps/runner/src/agents/claude-code.ts` + `claude-code-parser.ts` + `agent_events` + Web SSE | 初版完成，需真机/账号验证与更多 e2e |
| CodexBackend | `apps/runner/src/agents/codex.ts` + `codex-parser.ts` + `scripts/smoke-codex.ts` | 初版完成；已验证 unavailable fallback |
| Context Pack 初版：project profile、源码关键词证据、accepted knowledge 注入 | `apps/runner/src/profile.ts` + `knowledge.ts` + `NativeBackend` context_pack | 初版完成 |
| Canonical SkillSpec（context_pack/requirement/design/implementation/review） | `apps/runner/src/skills/index.ts` | 写死版本，待 Resolver/Adapter |
| 9 阶段 Orchestrator（runner-led，API 是状态权威；运行时停在每个 human gate 等 `/approvals`） | `apps/runner/src/orchestrator.ts` | 完整；已补 AgentTask/Result 审计和独立 compile gate |
| Completion Report 自动从 SQLite 拼装 markdown，引用每个 gate/artifact/command | `apps/api/src/reports.ts` 的 `generateCompletionReport` | 完整 |
| Knowledge Candidate 生成 + 由 Knowledge Gate 决定入库 | `generateKnowledgeCandidate` + `persistKnowledgeCandidate` + `collectAcceptedKnowledge` | 初版闭环已通 |
| Web UI Delivery Workbench：项目接入 / 新建任务队列 / 工作台首页 / 生命周期看板 / 结构化 Requirement / Design / Acceptance / 证据 drill-down / 报告详情 / Knowledge 候选 / 配置 | `apps/web/{index.html,src/main.ts,src/projection.ts,serve.ts}` | 初版完成 |
| Workflow Request Queue：UI 创建任务，runner watch 认领、执行、回写结果 | `apps/api/src/routes/workflow-requests.ts` + `apps/runner/src/cmd/watch.ts` | 初版完成 |
| Artifact Content API：UI 可读取本地 file artifact 文本预览 | `apps/api/src/routes/artifacts.ts` + `apps/api/src/artifact-content.ts` | 初版完成 |
| CommandRun Logs API：Build/Test UI 可读取 stdout/stderr 日志 | `apps/api/src/routes/command-runs.ts` | 初版完成 |
| Vitest 单测：whitelist / surefire / id+slugify / profile / knowledge / Claude parser | `packages/shared/test/*` + `apps/runner/test/*` | 33/33 pass（2026-05-02 复核） |
| 端到端 smoke：`scripts/{smoke,e2e}.ts` | 双脚本 | PASS（2026-05-02 临时 DB 复核） |

## 4. 一键复现命令

```bash
bun install
bun test
bun run typecheck

# 一键端到端验证（自动 approve 4 个人工门禁，无需手动）
AINP_DB_PATH=/tmp/x.sqlite bun run apps/api/src/server.ts &
sleep 1
AINP_DB_PATH=/tmp/x.sqlite bun run scripts/e2e.ts

# 浏览器流程
bun run dev:api &      # :8787
bun run dev:web &      # :5173
bun run runner -- orchestrate --project java-sample --title "test feature"
# 浏览器打开 http://127.0.0.1:5173/，逐个点 Approve
```

## 5. 环境与外部依赖

- **Bun 1.3.11+**（用了 `bun:sqlite`、`Bun.serve`、`Bun.Transpiler`）
- **JDK 8**（本机是 zulu-8，sample 的 `pom.xml` 已锁定 1.8 source/target）
- **Maven 3.9+**（系统 mvn 即可）
- **Git 2.x**（worktree 必需）
- 默认数据路径：
  - SQLite：`~/.ai-native/ainp.sqlite`（`AINP_DB_PATH` 覆盖）
  - Worktree：`~/.ai-native/worktrees/{projectId}/{runId}/workspace`
  - Artifacts：`~/.ai-native/artifacts/{runId}/...`（`AINP_ARTIFACTS_DIR`）
  - Reports：`~/.ai-native/reports/{runId}/...`（`AINP_REPORTS_DIR`）
- 默认端口：API `:8787`（`AINP_API_PORT` / `AINP_API_HOST`），Web `:5173`（`AINP_WEB_PORT`）

## 6. 已知问题 / 待查疑案

### 6.1 Web UI auto-approval 神秘 bug（已做第一层缓解，仍建议真浏览器复核）

**现象**：使用 Playwright MCP `browser_navigate` 打开 `:5173/` 后，浏览器在没有人工点击的情况下，30 秒内连续 POST 了 6 次 `/approvals`（requirement_gate 1 次、design_gate 2 次、acceptance_gate 2 次、knowledge_gate 1 次），actor=web。导致 demo orchestrate 自己跑完了。

**已排除**：
- e2e 不会污染（filter by workflowRunId）
- 转译后的 onclick 写法正常（只是赋值，没有 invoke）
- 没有 `<form>`、没有 `type="submit"` 的隐式提交

**未排除假设**：
- A. Playwright MCP 的 `browser_navigate` 默认伴随 a11y snapshot；某些 a11y 模式可能"激活"按钮
- B. 浏览器 service worker / 缓存的旧脚本在并发跑
- C. `setInterval(showRun, 2000)` 的某次 re-render 触发了潜在 click（极不可能但还没排除）

**复现步骤**：
1. 启动 API + web；
2. `runner orchestrate --project java-sample --title "demo"` 让它停在 requirement_gate；
3. `playwright browser_navigate 'http://127.0.0.1:5173/'`，**完全不点击**；
4. 等 1 分钟，看 `/approvals?workflowRunId=...` 是否有 actor=web 的记录。

**已落地**：
- 按钮加 `type="button"`、`tabindex="-1"`，并在 onclick 内做防抖/禁用。
- API 端 `recordApproval` 对同一个 `(workflowRunId, gateId, decision)` 做幂等 replay，不再重复插入 approval/gate。

**仍建议**：按上述复现步骤用 Playwright MCP / 真浏览器各跑一次，确认没有环境特定自动点击。

### 6.2 Compile Gate 已单独跑

orchestrator 现在会先跑 `mvn -B -DskipTests compile`（或 `./mvnw -B -DskipTests compile`），再跑 `mvn -B test`；`recordMavenBuild` 会生成 `compile_gate` + `test_gate`。

### 6.3 Tool Policy 未强制

这是已接受的产品约束，不再作为近期缺口追。SkillSpec 里的 `toolPolicy.allowedCommands` / `writableGlobs` / `networkAllowed` 用作 prompt / adapter 提示和审计线索；当前不追求沙箱级强制，也不要求隔离命令、网络、用户目录或资源。平台质量边界放在 worktree diff、真实本机 compile/test、GateRun 和人工审批。

### 6.4 Context Pack 仍是初版

已能生成 `project_profile`、搜索 Java/Kotlin 源码关键词、读取 accepted knowledge；但还没有需求期定向探索、语义检索、证据 schema、验收后结构化回写和 UI 展示。

### 6.5 hooks 全是写死的

文档要求 `hook spec` 配置化（before/after/file-diff 三类）。目前 orchestrator 里的固定动作不构成 hook 系统。短期不阻塞，长期需要做。

### 6.6 单元测试覆盖薄

已补 profile / knowledge / Claude parser 测试，但 workflow-engine、gate-engine、reports、orchestrator 仍没单测。e2e 仍是主要回归网。

### 6.7 Backend 方向已先收敛到 CodexBackend 初版

CodexBackend 已作为第一条目标主线接入；Claude Code streaming 保留为备选/对照实现。下一步风险是两条 backend 的 prompt/adapter 逻辑会重复，建议抽 `BackendPromptBuilder`。

## 7. 文档对照（按 `business-flow-integrated.md` 9 阶段 + 横切）

### 阶段对照
| # | 阶段 | 状态 | 主要缺口 |
|---|---|---|---|
| 1 | 项目接入 | CLI register 走通 | UI 接入页、自动技术栈识别 |
| 2 | Context Pack | 初版已通 | 需求期定向探索、证据 schema、语义检索、UI 展示 |
| 3 | 需求 | 桩 + 结构 Gate 初版 | 真 LLM + 更严格 schema |
| 4 | 设计 | 桩 + 覆盖/测试/风险 Gate 初版 | 真 LLM + 更完整需求覆盖矩阵 |
| 5 | 实现 | 桩 / Codex / Claude 可选 | 真 AI demo 加固、diff/traceability/UI；不追求沙箱级 Tool Policy 强制 |
| 6 | 编译测试 | ✅ 真命令 | Surefire 完整 testcase 解析 |
| 7 | 审查验收 | traceability Gate 初版 + 人工 | 更细 R→D→Diff→Test 覆盖矩阵 |
| 8 | Completion Report | ✅ | — |
| 9 | Knowledge Capture | 候选 + promoted 文件反哺已通 | 结构化 Knowledge Store、失效条件、检索排序 |

### 横切对照
| 横切能力 | 文档要求 | 现状 |
|---|---|---|
| 配置系统 | 9 类 YAML/UI 编辑 + 版本 + 运行快照 | SkillSpec 写死，其它没有 |
| Coordinator Agent | 调度脑、不能改状态 | 没有，runner 串行硬跑 |
| Hook 系统 | before/after/diff 声明式 | 内嵌在 orchestrator |
| Skill Resolver / Adapter | Canonical → Resolved → Backend | Canonical 有；Resolver/Adapter 没有 |
| AgentBackend | Native + Codex + Claude | Native 默认；Codex 初版；Claude Code streaming 初版 |
| 多 Agent 分工 | 9 类 specialist | 一个 NativeBackend 包办 |
| UI 6 MVP 页 | 接入/工作台/新建任务/任务详情/报告/配置 | 5173 初版已覆盖入口；Knowledge Capture 专页仍待做 |
| AI Review Gate | 模型判断设计合理性等 | 只有 deterministic + manual |

## 8. 下一步建议：加固 CodexBackend 与 Gate 语义

**当前状态**：P0/P1/P2 初版已推进。下一步不要再开第三条 Anthropic SDK 主线，先把 CodexBackend 从“可调用”打磨到“可演示”。执行环境主线已拍板为本地编译环境 + Git worktree，不追求沙箱级强制。

### 8.1 三个候选方向

| 方向 | 优点 | 代价 / 风险 | 适合作为 Sprint 3 吗 |
|---|---|---|---|
| **CodexBackend** | 符合“Codex 是目标 backend”叙事；可验证平台不绑定 Claude | 需要从零实现 CLI/API adapter、stream parser、权限映射、smoke | 如果当前产品目标是 Codex，选它 |
| **ClaudeCodeBackend** | 代码已初版；实时 streaming 和 Web SSE 已接上；最快变成真 AI demo | 会让第一条真 AI 主线从 Codex 转向 Claude Code；需明确 docs 口径 | 如果目标是最快演示，选它 |
| **Anthropic SDK Backend** | API 级可控，便于自定义 tools 和审计 | 要新增 SDK 依赖、tool runtime、成本/重试/限流；与 Claude CLI 方向重复 | 除非明确要云 API，不建议先选 |

### 8.2 推荐决策

CodexBackend 初版交付项已完成：

1. `apps/runner/src/agents/codex.ts` 实现 `AgentBackend`。
2. 支持 `AINP_AGENT_BACKEND=codex`，不可用时明确 fallback 到 NativeBackend。
3. 复用现有 SkillSpec + Context Pack 输入。
4. 非 implementation 阶段写 artifact 到 `ctx.artifactsDir`；implementation 后由 runner 收集 `git diff`。
5. 增加 `scripts/smoke-codex.ts` 和 parser 单测。
6. AgentTask / AgentResult 已写入 SQLite 并出现在 run detail。

下一步建议：真机跑 `bun run smoke:codex`，再把 Codex / Claude 共用 prompt assembly 抽出来，避免后续双份逻辑漂移。

### 8.3 仍建议推迟

- 完整配置系统（YAML 编辑器 / 版本 / 回滚）— 等到有 ≥2 个 workflow template 时再做
- Hook 声明式系统 — 当前 orchestrator 里的固定动作够用
- 6 类 specialist Agent 拆分 — 一个 Implementation Agent 跑遍所有阶段，靠 SkillSpec 切 prompt 即可
- Test/Debug Agent 自动修 — 失败先 pause_for_human
- Tool Policy 真强制隔离 — 已明确不是当前目标
- Docker / K8s / microVM 沙箱 — 当前不需要；只作为未来可选 ExecutionEnvironment
- 多租户 / 权限 — 还没必要
- AI Review Gate — 设计合理性判断；先不做

## 9. 新窗口起手指引

1. 读这一篇 + 原 `2026-05-01-ai-native-platform-handoff.md`（产品定位、原则、目录建议）
2. 跑一次验证：`bun install && bun test && bun run typecheck`
3. 跑端到端：`AINP_DB_PATH=/tmp/x.sqlite bun run apps/api/src/server.ts &; sleep 1; AINP_DB_PATH=/tmp/x.sqlite bun run scripts/e2e.ts`
4. 真机跑 `bun run smoke:codex`，确认本地 Codex 登录、权限与 JSONL stream 正常。
5. 如果要演示，先用浏览器复核 approval 防抖/幂等是否消除 auto-approval。

## 10. 守则提醒（不会变）

1. Workflow Engine 是唯一状态写入者：路由 / runner-events 调它，其它一律不能直接写库
2. Agent 不能宣布 Gate 通过：每个 GateRun 由 `gate-engine.ts` 决定；agent 可写 `agentNote`，但绝不影响 status
3. Build/Test 必须来自真实命令：runner spawn 真 mvn，TestRun 来自解析 Surefire XML
4. Worktree 是 Trusted Local Mode：使用本机 JDK/Maven/Git 编译测试；仅隔离工作区，不隔离命令/网络/资源；不追求沙箱级强制
5. 每次交付必须有 Completion Report
6. 经验先 Knowledge Candidate，由 Knowledge Gate（人工）决定是否入库

## 11. 如果只能记一句话

> 平台骨架（状态机 + Gate + Worktree + Context Pack 初版 + CodexBackend 初版 + Claude streaming 初版 + 报告 + 知识候选）已经就位；执行环境主线是本地编译环境 + Git worktree，不做沙箱级强制；5173 UI 已从 debug 三栏升级为 Delivery Workbench 初版；下一步是用真实 Codex 账号跑 smoke，并加固 traceability / Knowledge UI。


## 12. 2026-05-02 UI 结构化推进补充

- P0：任务详情已从 markdown 预览升级为轻量 parser 驱动的 Requirement 卡片、Design 覆盖矩阵、Acceptance checklist，并增加工作台首页 bucket。
- P1：报告页可读取 completion_report artifact；Build/Test 可读取 command stdout/stderr 和 test report；Implementation 显示 changed files + AC traceability；Knowledge 候选支持接受/编辑/忽略；Sensitive Change warn 会显示人工 checkpoint。
- P2：项目接入页增加 runner/toolchain/project profile 预览；配置页增加只读 workflow/backend/gate/skill 概览；新增 Knowledge 页面入口；补响应式与可访问性样式。
