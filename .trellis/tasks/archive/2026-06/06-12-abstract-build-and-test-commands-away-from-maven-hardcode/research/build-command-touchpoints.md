# Research: 构建/测试命令脱 Maven 硬编码 —— 全链路触点摸底

- **Query**: T3.2 构建命令作为项目注册可选字段（build.compileCommand / build.testCommand），缺省回退 Maven，仍受白名单约束
- **Scope**: internal（runner / shared / api / web / 测试 / gate）
- **Date**: 2026-06-12

---

## 1. Runner 侧硬编码现状

### 1.1 executeBuildTest（核心改造点）

文件：`apps/runner/src/orchestrator/steps.ts`

| 行号 | 现状 |
|---|---|
| steps.ts:210 | `const mvn = existsSync(join(c.workspace.path, 'mvnw')) ? './mvnw' : 'mvn'` —— mvnw/mvn 探测 |
| steps.ts:211-212 | `compileCommand = \`${mvn} -B -DskipTests compile\``、`testCommand = \`${mvn} -B test\`` —— 命令构造唯一来源 |
| steps.ts:213-217 | `stepStarted({ stage: 'build_test', name: testCommand })` —— 命令串进 step 名（仅展示，UI 无解析依赖） |
| steps.ts:220-236 | compile 阶段 `runWhitelistedCommand({ command: compileCommand, stage: 'compile', ... })`，失败即 step failed + throw |
| steps.ts:238-249 | test 阶段同上，`stage: 'test'` |
| steps.ts:251-254 | `deps.collectReports(c.workspace.path, .../maven-reports)` —— surefire 收集（见 1.4） |
| steps.ts:255-263 | `api.mavenBuild({ jdkVersion: c.tools.jdk, mavenCommand: \`${compileCommand} && ${testCommand}\`, compileCommandRunId, testCommandRunId, reports })` —— `&&` 只是记录用拼串，**不执行** |
| steps.ts:267-272 | 成败判定 = `compileGate.status === 'pass' && testGate.status === 'pass'` |

**T3.1 后可注入性（已具备）**：`StepDeps`（steps.ts:66-97）已把 `api`、`runWhitelistedCommand`（:87）、`collectReports`（:88）全部收入注入面，`DEFAULT_STEP_DEPS`（steps.ts:99-117）为默认实现。`executeBuildTest(c, deps)` 可全 stub 单测。

**project 在 RunCtx 中**：`c.project` 即完整 `Project`（orchestrator.ts:95 `api.getProject(opts.project)` → orchestrator.ts:138 注入 ctx）。**新字段到达 executeBuildTest 零额外管道**。`c.tools` 来自 heartbeat（orchestrator.ts:92-93），类型 `{ jdk: string|null; maven: string|null }`（orchestrator/types.ts:75）。

### 1.2 命令执行与白名单

- `apps/runner/src/command-runner.ts:27-30`：`runWhitelistedCommand` 入口第一行 `if (!isWhitelisted(input.command)) throw` —— **runner 端硬闸**，不在白名单直接异常。
- `command-runner.ts:40-47`：`input.command.split(/\s+/)` 后 `spawn(program, args)`，**无 shell**。⚠️ 自定义命令不能含 `&&`、`|`、`;`、引号、env 前缀等 shell 语法，这是配置命令的格式约束，应在 API 注册侧校验并提示。
- `packages/shared/src/utils/whitelist.ts:6-15`：`COMMAND_WHITELIST` 为 8 条**全字面 regex 精确匹配**（git status/diff/diff --name-only/rev-parse HEAD + `./mvnw|mvn -B -DskipTests compile` + `./mvnw|mvn -B test`）；`isWhitelisted`（:17-20）trim 后 `some(re.test)`。
- 注释（whitelist.ts:1-5）声明设计意图：白名单外命令需"显式人工批准"才能放行（机制尚未实现）。
- **加新命令的合规路径**：a) 静态追加 `COMMAND_WHITELIST` pattern（现状唯一路径）；b) 本任务方向——给 `isWhitelisted` 增加第二参数（项目级附加 exact-string 允许项），由项目注册信息携带、API 注册时校验格式 + runner 执行时仍强校验。同步测试：`packages/shared/test/whitelist.test.ts:5-12`。
- 白名单从 `@ainp/shared` 根导出（command-runner.ts:4-11 import）。

### 1.3 tools 字段（jdk/maven）的产生与消费

- 产生：`apps/runner/src/versions.ts:10-17` `detectToolVersions()` 并发探测 jdk（:19-26，`java -version`）、maven（:28-33，`mvn --version`）、git（:35-40）；任一缺失返回 null。
- 上报：`apps/runner/src/heartbeat.ts:12-24` `sendHeartbeat()` → `api.heartbeat({ jdkVersion, mavenVersion, gitVersion })`，兼做 doctor 检查。
- 消费：
  - `steps.ts:258` `jdkVersion: c.tools.jdk` → BuildRun.jdkVersion（API 侧落 `'unknown'` 兜底，workflow-engine.ts:878）。
  - web 设置页展示：`apps/web/src/page-projects.ts:545-547`（JDK/Maven/Git field，缺失显示 `—`）。
  - **非 Java/Maven 项目 tools.maven=null 仅展示性影响，无 gate 依赖** —— jdkVersion 上报链可原样保留（目标"不变"成立）。

### 1.4 surefire 收集链（非 Maven 项目的关键风险点）

- `apps/runner/src/reports.ts:21-26` `collectMavenReports(workspacePath)` 固定走 `target/surefire-reports` 与 `target/failsafe-reports`（:43 `join(workspacePath, 'target', dir)`），文件名约定 `TEST-*.xml`（:46-48），解析用 `parseSurefireSummary`（`packages/shared/src/utils/surefire.ts`）。
- 目录不存在 → `collectOne` 返回 null（reports.ts:44）→ steps.ts:751-778 `collectReports` 产出空数组 → `MavenBuildEvent.reports = []`。
- **消费链（reports=[] 的后果）**：
  1. `apps/api/src/routes/runner-events.ts:293-297` `POST /runner/events/maven-build` → `recordMavenBuild`。
  2. `apps/api/src/workflow-engine.ts:824-892`：reports 为空 → 不建 surefire_report Artifact、不建 TestRun；BuildRun 仍正常落库（status 由 testCommandRun 决定，:862-867）。
  3. `apps/api/src/gate-engine.ts:154-160` `runTestGate`：`surefireAggregate === null` → 规则 `test.surefire_present` **直接 fail** → test_gate fail → steps.ts:267-272 整个 build_test step fail。
- **结论：非 Maven 项目即使测试命令 exit 0，现行 test_gate 也必 fail。** 自定义 testCommand 的降级语义必须在本任务定调（建议见 §6 风险点）。
- web 端展示性消费：`apps/web/src/page-task-detail.ts:1303` 过滤 `surefire_report/failsafe_report` 渲染测试报告区块；`projection.ts:437`、`data-loading.ts:146-147` 同类映射。无报告时区块为空，可接受。

---

## 2. 项目实体链路（shared type → api route → store → db → runner）

### 2.1 Project 类型

`packages/shared/src/types/project.ts:10-43`：现有字段 id/name/localPath/sourceKind/sourceUrl/sourceAuthKind/sourceUsername/sourceCredential/status/archivedAt/agentBackend/language/buildTool/defaultBranch/sourceBranches/registeredAt。
- `ProjectBuildTool = 'maven' | 'unknown'`（:5）—— 已预留 unknown，但全链路无人消费 buildTool 做分支。
- 新字段建议平铺可选（匹配现有风格）：`buildCompileCommand?: string | null`、`buildTestCommand?: string | null`。

### 2.2 API 路由（apps/api/src/routes/projects.ts）

| 触点 | 行号 | 说明 |
|---|---|---|
| `RegisterProjectBody` | projects.ts:23-37 | body 接口，新增两个可选字段 |
| `POST /projects` | projects.ts:119-148 | `buildTool: body.buildTool ?? 'maven'`（:139）；注意 `normalizeRegisterBody`（:351-410）**不处理** language/buildTool，直接 body 透传——新命令字段归一化（trim、空串→null、shell 语法拒绝）建议进 normalize 或独立 helper |
| `PUT /projects/:id` | projects.ts:222-274 | 更新合并（:266 buildTool 同款 `??` 回退），新字段需同样合并语义（显式空串=清除 vs 缺省=保留，要定义） |
| `publicProject` | projects.ts:472-486 | spread `rest` 透传——新字段自动出现在 list/get 响应；只剥 sourceCredential |

### 2.3 Store 映射

`apps/api/src/store/store.ts`：`ProjectRow`（:119-136，snake_case 列）+ `rowToProject`（:138-157）+ `projectsTable.toRow`（:159-180）。新列三处都要加（如 `build_compile_command` / `build_test_command`，null 容忍）。

### 2.4 DB 迁移纪律

`apps/api/src/store/db.ts`：
- 纪律声明：db.ts:17-19 + `.trellis/spec/api/backend/database.md` —— "新 schema 变更 MUST 追加为新 MIGRATIONS 条目，禁止 probe-style ALTER"；**version 1 baseline 已冻结**（spec：frozen baseline DDL as of 2026-06），新列**不要动 BASELINE_DDL（db.ts:74-92）**，只加迁移。
- `MIGRATIONS` 列表 db.ts:387-510，**当前最高 version=21**。两列即 `addColumn(22, 'projects', 'build_compile_command', 'build_compile_command TEXT')`、`addColumn(23, ..., 'build_test_command TEXT')`（addColumn helper db.ts:55-67 自带 isApplied 探测，legacy/fresh 双向收敛）。
- 守护测试：`apps/api/test/db-migrations.test.ts`（db.ts:384 注释指明其验证 legacy DB 与 fresh DB schema 收敛）——加迁移后必须仍通过。

### 2.5 Runner 获取 project

`apps/runner/src/api-client.ts:55`：`getProject(idOrName)` → `GET /projects/:id?includeSecret=1`，返回类型直接是 shared 的 `Project` —— **shared 类型加字段后 api-client 零改动**。orchestrator.ts:95 取得后注入 RunCtx（:138）。

---

## 3. Web 侧

- `apps/web/src/types.ts:30-47`：`ProjectDto` 手抄版（非复用 shared Project），需同步加两个可选字段。
- `apps/web/src/page-projects.ts` 表单挂点：
  - 表单骨架 :86-127（`renderSourceFields()` :220-238 渲染来源相关 input；执行工具下拉 :254-271；默认分支 :476）。新增两个可选命令输入框可挂在执行工具/默认分支同级（`el('label', { class: 'input-block', ... })` 模式，input `oninput` 写回 `projectSourceForm.*`，参考 :286-301 的 source input 模式）。
  - form state：`projectSourceForm`（文件头注释 :4-12，state family 本文件持有）——加两个 string 字段。
  - 提交 payload：`projectSourcePayload()` :752-771 —— 追加字段（空串→不发或 null）。
  - 编辑预填：`editProject()` :717-742 —— 回填两个字段。
  - 详情展示（可选）：项目详情卡 :611-623 `field(...)` 模式。
- `apps/web/src/projection.ts`：与 Project 实体无映射关系（搜索仅 :433/:437 stage→artifactKind 映射、projectId 字段），**ProjectDto 不在 projection.ts，在 types.ts**；projection 无需改。

---

## 4. 测试现状

| 面 | 现状 | 需要的动作 |
|---|---|---|
| executeBuildTest | **无直接单测**。仅 `apps/runner/test/orchestrator-dispatch.test.ts:26-27,58` 以 mock 验证 build_test 阶段会调 `executeBuildTest` | 新增 steps 级单测（StepDeps 全 stub）：默认 Maven 回退、项目自定义命令、白名单拒绝、surefire 缺失降级 |
| 白名单 | `packages/shared/test/whitelist.test.ts:5-12`（含负例） | 扩展项目级附加命令 case |
| projects 路由 | `apps/api/test/projects-route.test.ts`（:91 本地注册、:121/:153 兼容字段、:339 远程注册、:461-479 PUT 更新） | 补注册/更新带 build 命令字段、缺省不写、非法（含 shell 操作符）拒绝 |
| entity-tables | `apps/api/test/entity-tables.test.ts` **不涉 projects 列**（只测 requirement/design/knowledge 实体表），大概率无需改 | 确认即可 |
| db 迁移 | `apps/api/test/db-migrations.test.ts` 验证双路径 schema 收敛 | 加迁移后必须通过（一般自动覆盖） |
| gate | `apps/api/test/gate-engine.test.ts` | 若调整 test_gate 降级语义需同步 |

---

## 5. Gate 链路：compile_gate / test_gate 消费字段核对

- `runCompileGate`（gate-engine.ts:~60-112）：消费 `buildRun.commandRunIds` → 查 commandRuns，取 `stage === 'compile'` 的 CommandRun，规则只看 `exitCode`（:92-96）与 `timedOut`（:97-102）。**不解析命令文本**（命令串只进 evidence claim 展示，:88-90）。
- `runTestGate`（gate-engine.ts:116-201）：`stage === 'test'` 的 CommandRun exitCode/timedOut（:140-151）+ `surefireAggregate` 的 failed/errors/skipped 计数（:154-192）。
- acceptance 依赖：gate-engine.ts:493 取 latest `test_gate`；:552-556 规则 `acceptance.test_gate_passed`；:661 review-stage 联动 compile_gate/test_gate。
- `BuildRun`（packages/shared/src/types/build.ts:11-25）：`language: 'java'`、`buildTool: 'maven'`、`jdkVersion: string`、`mavenCommand: string` —— 字面量 union 偏窄但 recordMavenBuild 硬编码写入（workflow-engine.ts:876-877），命令可配置化**不要求**改这些字段（mavenCommand 照填实际命令串，语义略名不副实但零破坏）。`TestRun`（build.ts:27-37）`framework` 仅 maven-surefire/failsafe。
- **结论：gate 规则只依赖 exitCode/timedOut/聚合计数，命令可配置化后 BuildRun/TestRun/GateRun 字段均可不变（目标达成）；唯一行为分叉是 §1.4 的 surefire_present。**
- 展示性消费：`apps/api/src/reports.ts:129,347` 完成报告里渲染 `b.mavenCommand` / `jdkVersion`（纯文本，无解析）。

---

## 6. 最小改动面清单（shared → api → runner → web）

| # | 文件 | 改动性质 | 风险 |
|---|---|---|---|
| 1 | `packages/shared/src/types/project.ts` | Project 加 `buildCompileCommand?` / `buildTestCommand?`（string\|null 可选） | 低；全链路可选字段零破坏 |
| 2 | `packages/shared/src/utils/whitelist.ts` + `test/whitelist.test.ts` | `isWhitelisted(command, extraAllow?)` 支持项目级 exact-string 附加项（或导出校验 helper 给 API 复用） | 中：**安全面**。附加项必须 exact-match 且拒绝 shell 元字符（`&&`、`;`、`\|`、`>`、反引号等），因 command-runner.ts:40 `split(/\s+/)` 无 shell |
| 3 | `apps/api/src/store/db.ts` | MIGRATIONS 追加 version 22/23 `addColumn('projects', 'build_compile_command'/'build_test_command', TEXT)`；**不动 BASELINE_DDL** | 低；遵守 database.md 纪律，db-migrations.test 守护 |
| 4 | `apps/api/src/store/store.ts` | ProjectRow（:119）+ rowToProject（:138）+ toRow（:162）三处加映射 | 低 |
| 5 | `apps/api/src/routes/projects.ts` | RegisterProjectBody（:23）+ POST（:119）+ PUT（:222）归一化与合并；注册时校验命令格式/白名单兼容并 400 | 中：PUT 合并语义（空串清除 vs 缺省保留）要定义；normalizeRegisterBody 现不碰 buildTool 类字段，注意一致风格 |
| 6 | `apps/api/test/projects-route.test.ts` | 新字段注册/更新/校验拒绝 case | 低 |
| 7 | `apps/runner/src/orchestrator/steps.ts` executeBuildTest（:210-212） | 命令来源改为 `c.project.buildCompileCommand ?? Maven探测默认`；jdkVersion/mavenBuild 调用形状不变 | 低（T3.1 注入面已就绪）；新增 steps 单测 |
| 8 | （决策点）`apps/api/src/gate-engine.ts` runTestGate（:154-160）或 runner collectReports | **surefire 降级语义**：自定义 testCommand + 无 surefire 报告时，建议 `test.surefire_present` 由 fail 降为 warn（仅当 test CommandRun exit 0），Maven 默认路径保持 fail 不变 | 高（语义变化需在 PRD 拍板）：不降级则非 Maven 项目永远过不了 build_test；降级则证据强度下降——建议条件降级并在 gate message 标注 "no structured test report (custom command)" |
| 9 | `apps/web/src/types.ts` ProjectDto（:30） | 加两个可选字段 | 低 |
| 10 | `apps/web/src/page-projects.ts` | form state + 两个 input（挂 :254-271 执行工具区附近）+ projectSourcePayload（:752）+ editProject 预填（:717）+ 详情展示（:611，可选） | 低 |

**不需要改**：`apps/runner/src/api-client.ts`（类型随 shared）、`command-runner.ts`（闸门逻辑不变）、`versions.ts`/`heartbeat.ts`（tools 展示性，保留）、`MavenBuildEvent`/`BuildRun`/`TestRun` 字段、web `projection.ts`。

## Caveats / Not Found

- "白名单外命令经人工批准放行"（whitelist.ts:3-4 注释）的运行时机制不存在，纯注释意图。
- 自动探测构建工具（按 pom.xml/package.json 等）确认无任何现存实现，符合"本任务不做自动探测"。
- `command-runner` 无 shell + 空白切分意味着配置命令也不支持带引号参数（如 `-Dtest="Foo Bar"`），建议文档化为已知限制。
