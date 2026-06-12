# PRD: 构建/测试命令脱 Maven 硬编码（路线图 T3.2）

## 背景与设计决策

研究依据：本任务 research/build-command-touchpoints.md（实施前必读，触点行号齐全）。
设计已定：构建命令是**项目固有属性**，作为项目注册信息的可选字段，不进 runtime config，不做自动探测。

## 需求

### R1 项目字段（shared → api → web）
- `Project` 增加 `buildCompileCommand?: string | null`、`buildTestCommand?: string | null`（平铺可选，匹配现有风格）。
- db：MIGRATIONS 追加 version 22/23（addColumn projects 两列 TEXT）；**不动 BASELINE_DDL**（database.md 纪律）。
- store：ProjectRow / rowToProject / toRow 三处映射。
- api 路由：注册与更新接受两字段。**合并语义**：PUT 时字段缺省=保留现值；显式 null 或空串=清除；非空字符串=设置（校验后）。
- web：ProjectDto 同步；onboarding/编辑表单加两个可选输入框（挂执行工具区附近，沿现有 input-block 模式）；payload 与编辑预填同步。

### R2 命令校验与白名单（安全面，最高优先）
- 注册/更新时 API 校验：trim 后非空才接受；**拒绝 shell 元字符**（`&&` `||` `;` `|` `>` `<` 反引号 `$(` 引号）——因 command-runner 无 shell、空白切分执行，这些写法不会按预期工作且有注入风险；非法返回 400 带原因。
- `isWhitelisted(command, extraAllow?: readonly string[])`：第二参数为项目级 exact-match 附加项（trim 后全字符串相等，不是正则/前缀）。runner 执行时把项目的两条命令作为 extraAllow 传入——**闸门仍在 runner，API 校验只是前置防呆**。
- shared/test/whitelist.test.ts 扩展正负 case。

### R3 executeBuildTest 改造（runner）
- 命令来源：`c.project.buildCompileCommand ?? 现有 mvnw/mvn 探测默认`、`buildTestCommand ?? 默认`。
- 其余形状不变：stepStarted 名称、stage: 'compile'/'test'、api.mavenBuild 调用字段（mavenCommand 照填实际命令串）、jdkVersion 上报、collectReports 照跑（自定义命令项目通常收不到报告 → 空数组，已有降级路径）。

### R4 test_gate 条件降级（api，唯一语义变化）
- `runTestGate` 的 `test.surefire_present` 规则：当 **(a)** 该 run 所属项目配置了自定义 `buildTestCommand` **且 (b)** test CommandRun exitCode === 0 时，无 surefire 聚合 → 规则结果 `warn`，message 标注 `no structured test report (custom test command)`；其余情形（Maven 默认路径）维持 fail 不变。
- gate-engine 需要拿到 project 的 build 字段判定 (a)——按 gate-engine 现有取数模式从 store 读 project（注意 gate-engine 不得反向依赖 workflow-engine）。
- gate-engine.test.ts 补三个 case：自定义命令+exit0+无报告=warn；自定义命令+exit≠0=fail 不变；默认 Maven+无报告=fail 不变。

### R5 测试
- runner：executeBuildTest 首批直接单测（StepDeps 全 stub）：默认 Maven 回退、自定义命令注入 extraAllow、（白名单拒绝路径由 command-runner 现有行为兜底，stub 层断言传参即可）。
- api：projects-route 注册/更新/非法拒绝/清除语义；db-migrations 守护测试自动覆盖新迁移。

## 不做
- 自动探测构建工具；带引号参数支持（文档化为已知限制，写入 spec）；白名单"人工批准放行"机制；BuildRun/TestRun 字面量字段调整。

## spec 更新
- `.trellis/spec/api/backend/`（或 runner 侧合适位置）记录：build 命令字段契约、校验规则、白名单 extraAllow 语义、test_gate 条件降级语义、无 shell/空白切分的命令格式限制。

## 验收标准
1. `bun run typecheck`、`bun x --bun vitest run` 全绿（701 + 新增）
2. 默认行为零破坏：未配置字段的项目走 Maven 路径，所有既有测试零改动通过
3. R4 三个 gate case 测试通过
4. 注册非法命令（含 `&&` 等）返回 400 的路由测试
5. smoke（native backend）端到端仍通过
