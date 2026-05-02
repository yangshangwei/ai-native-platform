# AI Native 云开发平台：Docs 业务流程总索引与落地清单

本文用于把 `docs/` 目录里已经沉淀的讨论按业务流程串起来，方便后续继续写 PRD、技术设计和开发任务时不漏关键点。

## 1. 当前文档地图

### 1.1 CodeStable 与 skill 机制

- `2026-05-01-codestable-skill-mechanics-notes.md`
  - CodeStable 是什么。
  - 作者 idea 如何从 EasySDD 演进到 CodeStable。
  - `cs/SKILL.md` 根入口如何设计。
  - `npx skills add` 的安装原理。
  - CodeStable 是否有 hooks / sub-agents。
  - `codestable/tools/` 下 Python 脚本的来源和运行环境要求。

这部分是平台的方法论来源：可以借鉴 CodeStable 的 workflow / instruction pack 思想，但不要把平台控制面耦合到 CodeStable skill。

### 1.2 总体工作流与上下文

- `2026-05-01-ai-native-platform-workflow-design-notes.md`
  - 平台不是 Web 版 CodeStable，而是 AI Native 软件生命周期平台。
  - 核心是“软 skill + 硬状态机”。
  - 平台要编排需求、设计、开发、测试、验收、经验沉淀，而不是只编排 Agent。

- `2026-05-01-ai-native-platform-context-pack-notes.md`
  - 需求阶段如何感知工程背景。
  - 推荐“薄初始化 + 按需 Context Pack + 持续回写”。
  - Context Pack 必须带 evidence refs，不能只有 LLM 总结。

### 1.3 多 Agent、Coordinator、Workflow Engine

- `2026-05-01-ai-native-platform-agent-architecture-notes.md`
  - 多 Agent 架构、Hook / Gate 作用、为什么不能一个 Agent 全包。
  - Workflow Engine 与 Coordinator Agent 的基本定位。

- `2026-05-01-ai-native-platform-controlled-flows-notes.md`
  - Coordinator Agent 如何输出结构化决策。
  - 新功能流程和 bug 流程的受控执行示例。
  - 控制系统定位：确定性流程由引擎管，智能判断由 Agent 辅助。

- `2026-05-01-ai-native-platform-agent-backend-notes.md`
  - Claude Code SubAgent / Codex / 自研 Agent 编排的取舍。
  - 推荐平台自研控制平面，Claude Code / Codex 作为可插拔 AgentBackend。
  - 先定义平台自己的 `AgentTask` / `AgentResult` contract。

### 1.4 Quality Gate 与职责边界

- `2026-05-01-ai-native-platform-quality-gates-notes.md`
  - 脚本化 Quality Gate 与 QA Rule Engine 的总体设计。
  - Traceability Matrix 是需求、设计、开发、测试对齐的核心。

- `2026-05-01-ai-native-platform-quality-gate-rules-notes.md`
  - Requirement / Design / Implementation / Test Gate 的具体规则。
  - 如何防止 LLM 伪造“已完成、已通过”。

- `2026-05-01-ai-native-platform-gate-responsibility-matrix-notes.md`
- `2026-05-01-ai-native-platform-gate-responsibility-matrix-continued.md`
  - 哪些由脚本严格校验。
  - 哪些由 Agent 分析并给 evidence。
  - 哪些必须由人确认。
  - GateRun / RuleResult 的记录建议。

### 1.5 Java / Maven Build Gate

- `2026-05-01-ai-native-platform-java-maven-build-gate-notes.md`
  - 当前阶段只管 Java + Maven。
  - 编译、测试必须在 sandbox 中执行。
  - `pom.xml` / `mvnw` / `.mvn/` 探测，JDK 选择，Maven cache，secret mount。

- `2026-05-01-ai-native-platform-java-maven-build-gate-implementation.md`
  - BuildRun / CommandRun 记录。
  - Surefire / Failsafe 报告解析。
  - Compile Gate、Test Gate 规则。
  - 构建失败后交给 Debug Agent 分析，但是否通过由脚本结果决定。

### 1.6 配置系统与平台运行配置

- `2026-05-01-ai-native-platform-runtime-configuration-notes.md`
  - Runtime Blueprint / Lifecycle Configuration。
  - AgentSpec、Prompt Template、Workflow Template、Hook、Gate、Artifact Schema 等可配置对象。

- `2026-05-01-ai-native-platform-tool-skill-configuration-notes.md`
  - Tool Policy 与 Skill / Markdown Instruction Pack 的接入。
  - Skill 是 instruction asset，不是平台制度本身。

- `2026-05-01-ai-native-platform-runtime-configuration-ops-notes.md`
  - 配置继承、版本、发布、回滚、Eval、UI 化配置。
  - 平台运行配置与 workflow/agent 配置的区别。
  - Runtime Resolver 负责把多层配置解析成运行时快照。

### 1.7 Completion Report 与 Knowledge Capture

- `2026-05-01-ai-native-platform-completion-report-knowledge-capture-notes.md`
  - 每次需求、bug、测试完成后生成 Completion Report。
  - Report 面向人和审计，必须引用事实源。

- `2026-05-01-ai-native-platform-knowledge-capture-notes.md`
  - Knowledge Candidate 类型：Decision、Learning、Pitfall、Trick、Architecture Update、Explore Record。
  - Knowledge 默认先生成候选，不能无确认自动写入长期记忆。
  - Accepted Knowledge 进入未来 Context Pack。

## 2. 按业务流程串起来

### 2.1 平台初始化 / 项目接入

目标：让一个已有项目低成本接入平台，但不牺牲后续质量。

关键动作：

1. 识别项目类型和技术栈。
2. 建立最小 Project Profile。
3. 扫描已有文档、目录结构、构建方式、测试方式。
4. 生成初始 Context Pack seed。
5. 配置默认 Workflow Blueprint、AgentSpec、Gate、Hook、Tool Policy。

对应文档：

- `2026-05-01-ai-native-platform-context-pack-notes.md`
- `2026-05-01-ai-native-platform-runtime-configuration-notes.md`
- `2026-05-01-ai-native-platform-runtime-configuration-ops-notes.md`
- `2026-05-01-ai-native-platform-java-maven-build-gate-notes.md`

### 2.2 需求阶段

目标：需求不是凭空写，而是带着工程背景、历史决策、已有实现一起写。

关键动作：

1. 用户输入原始想法。
2. Context Agent 按需生成 Context Pack。
3. Requirement Agent 产出 Requirement Draft。
4. Requirement Gate 用脚本检查结构完整性、字段完整性、验收标准、traceability seed。
5. LLM 可以辅助判断清晰度和歧义，但必须给 evidence。
6. 关键需求由人确认。

对应文档：

- `2026-05-01-ai-native-platform-context-pack-notes.md`
- `2026-05-01-ai-native-platform-quality-gates-notes.md`
- `2026-05-01-ai-native-platform-quality-gate-rules-notes.md`
- `2026-05-01-ai-native-platform-gate-responsibility-matrix-notes.md`

### 2.3 设计阶段

目标：设计必须回应需求，并解释为什么这样做。

关键动作：

1. Design Agent 基于 Requirement + Context Pack 生成方案。
2. Design Gate 检查每条需求是否被设计覆盖。
3. 检查设计是否包含接口、数据、状态迁移、兼容性、风险、测试建议。
4. Architect / Reviewer Agent 可以做语义审查。
5. 方案批准必须由人或明确授权的审批策略完成。

对应文档：

- `2026-05-01-ai-native-platform-agent-architecture-notes.md`
- `2026-05-01-ai-native-platform-controlled-flows-notes.md`
- `2026-05-01-ai-native-platform-quality-gate-rules-notes.md`
- `2026-05-01-ai-native-platform-gate-responsibility-matrix-notes.md`

### 2.4 开发阶段

目标：Agent 可以写代码，但不能自己宣布做完。

关键动作：

1. Workflow Engine 下发 Implementation Step。
2. Coordinator Agent 选择合适的 Specialist Agent 或 AgentBackend。
3. Implementation Agent 只负责产出 diff 和说明。
4. Diff Scope Gate 检查修改范围是否匹配设计。
5. Sensitive Change Gate 检查高风险文件、配置、权限、依赖变更。
6. 状态推进只能由 Workflow Engine 通过 Gate 后完成。

对应文档：

- `2026-05-01-ai-native-platform-agent-architecture-notes.md`
- `2026-05-01-ai-native-platform-agent-backend-notes.md`
- `2026-05-01-ai-native-platform-controlled-flows-notes.md`
- `2026-05-01-ai-native-platform-quality-gates-notes.md`

### 2.5 编译与测试阶段（当前 MVP：Java + Maven）

目标：用真实命令和脚本结果证明代码可编译、测试可执行。

关键动作：

1. Build Service 在 sandbox 中执行 Maven。
2. 默认探测 `mvnw`，优先使用项目内 wrapper。
3. 执行 compile gate：如 `./mvnw -B -DskipTests compile`。
4. 执行 test gate：如 `./mvnw -B test`。
5. 解析 Surefire / Failsafe 报告。
6. 失败时把日志交给 Debug Agent 分析，修复后重新跑 gate。
7. 通过与否只认 BuildRun / TestRun / parsed report。

对应文档：

- `2026-05-01-ai-native-platform-java-maven-build-gate-notes.md`
- `2026-05-01-ai-native-platform-java-maven-build-gate-implementation.md`
- `2026-05-01-ai-native-platform-quality-gate-rules-notes.md`

### 2.6 审查与验收阶段

目标：确认最终结果真的满足需求、设计、测试和风险要求。

关键动作：

1. Review Agent 做实现偏差、风险和可维护性审查。
2. Acceptance Gate 检查 traceability：需求 → 设计 → diff → 测试 → evidence。
3. 人确认业务验收、风险接受、是否交付。
4. 所有结论写入 GateRun / Approval record。

对应文档：

- `2026-05-01-ai-native-platform-gate-responsibility-matrix-continued.md`
- `2026-05-01-ai-native-platform-completion-report-knowledge-capture-notes.md`

### 2.7 完成报告与知识沉淀

目标：交付结束后留下可审计、可复用的资产。

关键动作：

1. 生成 Completion Report。
2. Report 引用 Requirement、Context Pack、Design、Git Diff、BuildRun、TestRun、GateRun、Human Approval。
3. 生成 Knowledge Candidate。
4. Knowledge Gate 检查候选是否有事实来源、是否过期、是否重复、是否有适用范围。
5. Decision 类知识必须人确认。
6. Accepted Knowledge 进入未来 Context Pack。

对应文档：

- `2026-05-01-ai-native-platform-completion-report-knowledge-capture-notes.md`
- `2026-05-01-ai-native-platform-knowledge-capture-notes.md`
- `2026-05-01-ai-native-platform-context-pack-notes.md`

## 3. 后续写 PRD 时必须覆盖的能力

1. 项目接入与 Context Pack 初始化。
2. 需求梳理、需求确认、需求 Gate。
3. 设计生成、设计审查、设计 Gate、人审批。
4. 多 Agent 协同：Coordinator、Specialist Agents、AgentBackend。
5. Workflow Engine：状态机、StepRun、GateRun、Retry、Rollback、Pause。
6. Hook：固定动作、前置检查、后置记录、通知。
7. Quality Gate / Rule Engine：脚本化校验、规则管理、执行记录。
8. Java / Maven Local Worktree Build：compile/test/report parsing。
9. UI 化配置：Agent、Prompt、Workflow、Hook、Gate、Tool Policy、平台运行配置。
10. Completion Report：审计、溯源、交付说明。
11. Knowledge Capture：项目经验沉淀、候选审核、未来检索。

## 4. 后续写技术设计时必须明确的模块

1. Web UI：流程看板、配置中心、审批页、报告页、知识库页。
2. Config Service：版本化配置、发布、回滚、实时生效。
3. Runtime Resolver：把平台、租户、项目、workflow 配置解析为运行时快照。
4. Workflow Engine：唯一状态写入者。
5. Coordinator Agent：只输出结构化建议，不直接改状态。
6. Agent Orchestrator：适配 Claude Code、Codex、Native AgentBackend。
7. Gate Engine：执行规则、产出 RuleResult / GateRun。
8. Sandbox Runner / Build Service：执行 Maven 编译测试。
9. Artifact Store：保存 Requirement、Design、Diff、BuildRun、Report 等事实源。
10. Knowledge Store：保存候选知识、已接受知识、适用范围和版本关系。
11. Audit Log：记录所有状态变化、审批、gate 结果、agent action。

## 5. 后续开发时的防漏检查清单

每个功能进入开发前，检查：

- 是否有明确 Requirement artifact。
- 是否有关联 Context Pack。
- 是否有 Design artifact。
- 是否有 Traceability Matrix。
- 是否定义了必须通过的 Gate。
- 是否明确哪些结论由脚本判断，哪些由 Agent 辅助，哪些由人确认。
- 是否明确运行时配置来自哪个版本的 snapshot。
- 是否明确 AgentBackend 只是执行载体，不是平台控制面。
- Java 项目是否能在 sandbox 中完成 compile/test。
- 是否会生成 Completion Report。
- 是否会产生 Knowledge Candidate。

每个功能完成前，检查：

- GateRun 是否全部记录。
- BuildRun / TestRun 是否有真实命令输出和解析结果。
- 人工审批是否记录。
- Report 是否引用事实源，而不是 LLM 自述。
- Knowledge 是否经过规则校验，必要时经过人确认。
- 下一次需求阶段能否从 Accepted Knowledge 和 Context Pack 中复用本次经验。

## 6. 当前最重要的产品原则

1. 平台编排的是软件生命周期，不只是 Agent。
2. Workflow Engine 和 Coordinator Agent 不可互相替代。
3. Agent 可以建议，不能越权推进状态。
4. 脚本和真实命令优先于 LLM 声称。
5. 人只参与关键业务判断，不参与重复机械检查。
6. 配置必须 UI 化、版本化、可回滚、运行时可追溯。
7. 每次交付都要留下 Report，每次有效经验都要沉淀为 Knowledge Candidate。
8. CodeStable 是思想来源和 instruction pack 参考，不是平台控制面的依赖。
