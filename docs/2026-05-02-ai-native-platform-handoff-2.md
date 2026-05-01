# AI Native Platform：第二轮交接文档（MVP 已打通，进入 Sprint 3）

本文承接 `2026-05-01-ai-native-platform-handoff.md`，记录第一+第二轮（Phase 1 / Wave A+B+C）已落地的能力、验证手段、已知问题与下一步推进计划。新窗口直接读这一篇就能接上。

## 1. 当前状态：MVP 9 阶段闭环可跑通

九阶段 `init → context_pack → requirement → design → implementation → build_test → review → completion → knowledge` 已经端到端跑通。所有产物（Artifact、CommandRun、BuildRun/TestRun、GateRun、Approval、AuditLog）落 SQLite，可被 Web UI、Completion Report、Knowledge Candidate 引用。

LLM 接入是后续工作。当前 `NativeBackend` 产出的需求/设计/实现/评审产物是模板桩，但骨架可直接替换为 Codex / Claude Code / Anthropic SDK 后端。

## 2. 仓库结构

```
ai-native-platform/
  apps/api/        Hono on Bun + SQLite + Workflow Engine + Gate Engine + Reports
    src/server.ts                      入口
    src/workflow-engine.ts             唯一状态写入者
    src/gate-engine.ts                 Compile/Test/DiffScope/Sensitive/Manual gates
    src/reports.ts                     Completion Report + Knowledge Candidate 生成器
    src/store/{db,store}.ts            SQLite migrations + 仓库类
    src/routes/{projects,workflow-runs,runner-events,approvals,runners}.ts
  apps/runner/     Local Runner CLI
    src/index.ts                       CLI 分发：health/doctor/register/run/orchestrate
    src/orchestrator.ts                9 阶段编排器
    src/agents/native.ts               NativeBackend 桩（待替换为真 LLM）
    src/skills/index.ts                Canonical SkillSpec
    src/worktree.ts                    TrustedLocalWorktreeEnvironment
    src/command-runner.ts              白名单 + 超时 + 日志截断 + CommandRun 装配
    src/{api-client,heartbeat,reports,versions,sh,config}.ts
    src/cmd/{register,run,doctor}.ts
  apps/web/        极简 Web UI（Bun.serve + 原生 TS，三栏布局 + approve 按钮）
    index.html, src/main.ts, serve.ts
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
  vitest.config.ts
```

源码 65 文件 / ~5600 LOC（不含 docs / node_modules / target）。

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
| AgentBackend 接口 + NativeBackend 桩（产出 requirement/design/review markdown，implementation 给 Calculator.java 加注释） | `apps/runner/src/agents/native.ts` | 完整（**待换真 LLM**） |
| Canonical SkillSpec（requirement/design/implementation/review 各一） | `apps/runner/src/skills/index.ts` | 完整（**待支持 Codex/Claude 后端 Adapter**） |
| 9 阶段 Orchestrator（runner-led，API 是状态权威；运行时停在每个 human gate 等 `/approvals`） | `apps/runner/src/orchestrator.ts` | 完整 |
| Completion Report 自动从 SQLite 拼装 markdown，引用每个 gate/artifact/command | `apps/api/src/reports.ts` 的 `generateCompletionReport` | 完整 |
| Knowledge Candidate 生成 + 由 Knowledge Gate 决定入库 | `generateKnowledgeCandidate` + `runManualGate` | 完整候选环节，**反哺下次 Context Pack 还没做** |
| Web UI 三栏：阶段时间轴 / 详情 + 步骤 + 构建 / 证据 + 批准按钮 | `apps/web/{index.html,src/main.ts,serve.ts}` | 占位实现 |
| Vitest 单测：whitelist / surefire / id+slugify | `packages/shared/test/*` | 11/11 pass |
| 端到端 smoke：`scripts/{smoke,e2e}.ts` | 双脚本 | 两个 PASS |

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

### 6.1 Web UI auto-approval 神秘 bug（高优先级）

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

**修复方向**：
- 给按钮加 `type="button"`、`tabindex="-1"`，并在 onclick 内做防抖（2 秒内同 gate 只允许一次 POST）
- 在 API 端做幂等：同一个 `(workflowRunId, gateId)` 已有 approved 记录时，第二次 POST 返回 200 idempotent 而不是再插一条
- 复现 + 抓 Playwright 协议日志看是不是 a11y 触发

### 6.2 实现阶段没有 Compile Gate 单独跑

`recordMavenBuild` 只接受 `testCommandRunId`；当前 orchestrator 跳过了独立的 `mvn -B -DskipTests compile`，所以 `compile_gate` 没有触发。功能上 mvn test 自带 compile，所以测试通过等同于 compile 通过；但 gate 矩阵里 compile_gate 行没有数据。要么补一个 compile 步骤，要么把 compile_gate 标记为"由 test_gate 蕴含"。

### 6.3 Tool Policy 未强制

SkillSpec 里有 `toolPolicy.allowedCommands` / `writableGlobs` / `networkAllowed`，但 NativeBackend 没真的检查。换 LLM 后端时必须由 BackendAdapter 强制 enforce。

### 6.4 Knowledge Candidate 没有反哺

知识候选生成 + 入库已通，但**下次 Context Pack 还没去检索 accepted knowledge**。形成闭环要等 Sprint 3 做 Context Pack 时一起补。

### 6.5 hooks 全是写死的

文档要求 `hook spec` 配置化（before/after/file-diff 三类）。目前 orchestrator 里的固定动作不构成 hook 系统。短期不阻塞，长期需要做。

### 6.6 单元测试覆盖薄

只测了 whitelist / surefire / id；workflow-engine、gate-engine、reports、orchestrator 都没单测。e2e 是唯一的回归网。

## 7. 文档对照（按 `business-flow-integrated.md` 9 阶段 + 横切）

### 阶段对照
| # | 阶段 | 状态 | 主要缺口 |
|---|---|---|---|
| 1 | 项目接入 | CLI register 走通 | UI 接入页、自动技术栈识别 |
| 2 | **Context Pack** | **完全没做** | 三层模型（薄地图 / 需求期定向 / 验收回写）整套 |
| 3 | 需求 | 桩 | 真 LLM + Context Pack 喂入 |
| 4 | 设计 | 桩 | 真 LLM + 需求覆盖矩阵规则 |
| 5 | 实现 | 桩 | 真 LLM、Tool Policy 强制 |
| 6 | 编译测试 | ✅ 真命令 | 单独 compile 步、Surefire 完整 testcase 解析 |
| 7 | 审查验收 | 桩 + 人工 | Acceptance Gate 真做 R→D→Diff→Test traceability |
| 8 | Completion Report | ✅ | — |
| 9 | Knowledge Capture | 候选已通 | 反哺下次 Context Pack |

### 横切对照
| 横切能力 | 文档要求 | 现状 |
|---|---|---|
| 配置系统 | 9 类 YAML/UI 编辑 + 版本 + 运行快照 | SkillSpec 写死，其它没有 |
| Coordinator Agent | 调度脑、不能改状态 | 没有，runner 串行硬跑 |
| Hook 系统 | before/after/diff 声明式 | 内嵌在 orchestrator |
| Skill Resolver / Adapter | Canonical → Resolved → Backend | Canonical 有；Resolver/Adapter 没有 |
| AgentBackend | Native + Codex + Claude | 只有 NativeBackend |
| 多 Agent 分工 | 9 类 specialist | 一个 NativeBackend 包办 |
| UI 6 MVP 页 | 接入/工作台/新建任务/任务详情/报告/配置 | 只有任务详情 |
| AI Review Gate | 模型判断设计合理性等 | 只有 deterministic + manual |

## 8. 推荐 Sprint 3：第一次真 AI 交付

**目标**：把 NativeBackend 桩换成真 LLM，并把 Context Pack 接上，让每个 Agent 调用都带工程证据。其它（多 Agent 拆分、配置系统、UI 全套页面、Hook 系统）先放着。

### 4 个 deliverable（按推荐顺序）

**A. Context Pack**（最优先，是 LLM 输出质量的地基）
- 接入项目时生成"薄地图"：扫 README、`pom.xml`、`src/main/java` 顶层包、test 目录 → `project_profile.md` artifact + 持久化到 `~/.ai-native/projects/{projectId}/profile.md`
- 需求阶段先跑 Context Agent（一个新 SkillSpec），按用户输入查相关代码 / 文件 / accepted knowledge → 生成 `context_pack.md` 含 `evidenceRefs`
- 让 Context Pack 成为 Requirement / Design / Implementation 三阶段的 input
- 验收后回写：把"稳定结论"写到 `~/.ai-native/projects/{projectId}/knowledge/`，下次 Context Pack 自动检索

**B. AnthropicBackend**（替换 NativeBackend）
- 新文件 `apps/runner/src/agents/anthropic.ts` 实现 `AgentBackend` 接口
- 用 `@anthropic-ai/sdk`、Claude Sonnet 4.6、prompt cache、tool use（`read_file` / `search_code` / `edit_file` 三个）
- SkillSpec.instructions 当 system prompt；Context Pack + 上一阶段 artifact 当 user message
- 通过 `AINP_AGENT_BACKEND=anthropic` 环境切；缺 `ANTHROPIC_API_KEY` 自动 fallback 到 NativeBackend
- 实现产物：能让 LLM 真去读 worktree 文件、改 Java 代码、过 mvn test

**C. 薄 Coordinator Agent**
- 每个 stage 切换前调一次 Coordinator
- 输入：当前 stage、上一份 artifact、最近 gate 结果
- 输出结构化 JSON：`proceed | retry | pause_for_human | route_to_agent`
- MVP 只支持 proceed / pause_for_human，但路径打通（为 sprint 4 的 test_gate fail → debug agent 留接口）

**D. UI 拓宽到 4 页**
- 项目接入页：列出已注册项目 + 注册新项目（POST /projects）
- 工作台首页："待我处理"列表（status=awaiting_human 的所有 run，直接 approve）
- 新建任务页：选项目 + 输入 title + POST 创建 run，跳转任务详情
- 任务详情页（已有，补 Context Pack 显示）

### 估时

| Deliverable | 估时（直觉） |
|---|---|
| A. Context Pack | 0.5–1 天 |
| B. AnthropicBackend + Skill prompt 调优 | 0.5 天 |
| C. 薄 Coordinator | 0.3 天 |
| D. 4 页 UI | 0.5–1 天 |
| 联调 + e2e 升级（含 LLM mock 模式） | 0.5 天 |
| **合计** | **2–3 天** |

### 不在 Sprint 3 的（明确推迟）

- 完整配置系统（YAML 编辑器 / 版本 / 回滚）— 等到有 ≥2 个 workflow template 时再做
- Hook 声明式系统 — 当前 orchestrator 里的固定动作够用
- 6 类 specialist Agent 拆分 — 一个 Implementation Agent 跑遍所有阶段，靠 SkillSpec 切 prompt 即可
- Test/Debug Agent 自动修 — 失败先 pause_for_human
- Tool Policy 真强制隔离 — 命令白名单已经够 MVP
- Docker / K8s 沙箱 — 文档明确推迟
- 多租户 / 权限 — 还没必要
- AI Review Gate — 设计合理性判断；先不做

## 9. 新窗口起手指引

1. 读这一篇 + 原 `2026-05-01-ai-native-platform-handoff.md`（产品定位、原则、目录建议）
2. 跑一次验证：`bun install && bun test && bun run typecheck`
3. 跑端到端：`AINP_DB_PATH=/tmp/x.sqlite bun run apps/api/src/server.ts &; sleep 1; AINP_DB_PATH=/tmp/x.sqlite bun run scripts/e2e.ts`
4. 决定 Sprint 3 的起手活：建议先做 **Context Pack**（A），它是 B/C/D 的输入；或先排查 **6.1 Web auto-approval bug**（如果要做演示就必须先修）
5. 修 bug 时优先做 **API 端 approval 幂等** + **按钮加 `type=button` + 2 秒防抖**

## 10. 守则提醒（不会变）

1. Workflow Engine 是唯一状态写入者：路由 / runner-events 调它，其它一律不能直接写库
2. Agent 不能宣布 Gate 通过：每个 GateRun 由 `gate-engine.ts` 决定；agent 可写 `agentNote`，但绝不影响 status
3. Build/Test 必须来自真实命令：runner spawn 真 mvn，TestRun 来自解析 Surefire XML
4. Worktree 是 Trusted Local Mode：仅工作区隔离，不隔离命令/网络/资源
5. 每次交付必须有 Completion Report
6. 经验先 Knowledge Candidate，由 Knowledge Gate（人工）决定是否入库

## 11. 如果只能记一句话

> 平台骨架（状态机 + Gate + Worktree + 报告 + 知识候选）已经全部就位，UI 也有可演示的三栏。下一步把 NativeBackend 桩换成真 LLM 并补上 Context Pack，平台就能第一次真做 AI 交付。
