# AI Native 云开发平台：按业务流程整合版

本文把 `docs/` 中关于 CodeStable、AI Native 平台、多 Agent、Workflow、Gate、配置、Build、Report、Knowledge 的讨论，整理成一条可用于 PRD、技术设计和开发拆解的业务流程主线。

## 1. 平台定位
平台不是简单的“Web 版 CodeStable”，而是 AI Native 软件生命周期平台。

它要解决的是：

1. 让 AI 在需求、设计、开发、测试、验收、复盘中持续协作。
2. 让关键流程有确定性的 Workflow、Hook、Gate 和审计记录。
3. 让 Agent 输出被脚本、真实命令、人类审批和 evidence 约束。
4. 让每次交付沉淀为项目经验，反哺下一次开发。

核心公式：

```text
软 Skill / Prompt 指导行为
硬 Workflow / Gate 约束流程
真实命令 / 脚本验证结果
Human Approval 判断关键业务取舍
Knowledge Capture 沉淀长期记忆
```

## 2. CodeStable 的借鉴边界
CodeStable 的价值在于 workflow 思想：

- `cs/SKILL.md` 做统一入口。
- 多个 skill 拆分需求、设计、实现、验收、issue、learn、trick 等场景。
- Markdown instruction pack 让 Agent 行为更稳定。
- 项目经验文档沉淀长期上下文。

平台可以导入 CodeStable 作为 instruction pack / workflow preset，但不要深耦合它：

- Hook、Gate、Workflow、Artifact、Approval、Trace 必须由平台实现。
- Claude Code、Codex、Native Agent 都只是执行后端。
- Skill 是指导资产，不是控制面制度。

## 3. 总体业务流程
```text
项目接入 / 初始化
  ↓
Context Pack：工程背景、已有实现、历史决策、历史 bug
  ↓
需求梳理：Requirement Draft + Requirement Gate + Human Confirm
  ↓
方案设计：Design + Design Gate + Human Approval
  ↓
开发实现：Implementation Agent + Diff Scope Gate + Sensitive Change Gate
  ↓
Java / Maven Sandbox Build：Compile Gate + Test Gate
  ↓
审查验收：Review + Acceptance Gate + Human Acceptance
  ↓
Completion Report：审计、溯源、交付说明
  ↓
Knowledge Capture：经验候选、确认、入库
  ↓
未来需求阶段复用 Accepted Knowledge 与 Context Pack
```

## 4. 阶段一：项目接入 / 初始化
目标：低门槛接入已有项目，但不牺牲后续质量。

关键动作：

1. 识别项目类型、语言、框架、构建工具。
2. 建立 `ProjectProfile`。
3. 扫描目录结构、README、已有文档、测试目录、构建脚本。
4. Java MVP 识别 `pom.xml`、`mvnw`、`.mvn/`、JDK 版本。
5. 生成初始 `ContextPack` seed。
6. 选择默认 Workflow Blueprint、AgentSpec、Gate、Hook、Tool Policy。

原则：初始化只做“薄地图”，不要一次性读懂全部项目；后续在每次需求中逐步补全。

## 5. 阶段二：Context Pack
目标：让需求阶段能感知工程背景，而不是凭空写需求。

Context Pack 至少包含：

- 相关模块、文件、已有实现。
- 历史决策、约束、已知 bug、坑和风险。
- 相关测试、构建方式、运行方式。
- evidence refs：文件、commit、日志、报告、历史记录。

推荐策略：

```text
薄初始化 + 需求阶段按需检索 + 验收后回写
```

不要只依赖 LLM 总结。Context Pack 必须带 evidence，否则后续需求、设计、验收无法追溯。

## 6. 阶段三：需求梳理
目标：把用户原始想法变成结构化、可设计、可验收的需求。

流程：

1. 用户输入业务想法或问题。
2. Context Agent 生成相关 Context Pack。
3. Requirement Agent 生成 Requirement Draft。
4. Requirement Gate 用脚本检查结构完整性。
5. Agent 辅助识别歧义、风险、缺失验收标准。
6. 用户确认关键需求、范围和优先级。

Requirement Gate 检查：

- 需求 ID、背景、目标、非目标、用户场景。
- 验收标准是否明确。
- 是否有关联 Context Pack evidence。
- 是否能建立 traceability seed。

边界：LLM 可以指出“不清楚”，不能代替用户确认业务范围；没有通过 Requirement Gate，不进入设计阶段。

## 7. 阶段四：方案设计
目标：确保设计明确回应需求，并能指导开发和测试。

流程：

1. Design Agent 基于 Requirement + Context Pack 生成方案。
2. Design Gate 检查需求覆盖关系。
3. Architect / Review Agent 做语义审查。
4. 人审批关键方案、技术取舍和风险接受。

Design 至少包含：

- 需求覆盖矩阵。
- 模块边界、接口/API、数据结构、状态流转。
- 兼容性影响、风险、替代方案。
- 测试策略、回滚或降级方案。

Design Gate 检查：每条需求是否被覆盖、每条验收标准是否有测试思路、方案是否基于现有工程事实、风险是否记录。

## 8. 阶段五：开发实现
目标：让 Agent 写代码，但不让 Agent 自己宣布完成。

流程：

1. Workflow Engine 下发 Implementation Step。
2. Coordinator Agent 选择 Specialist Agent 或 AgentBackend。
3. Implementation Agent 基于锁定的 Requirement、Design、Context Pack 修改代码。
4. Agent 输出 diff、变更说明、关联需求 ID。
5. Diff Scope Gate 检查修改范围。
6. Sensitive Change Gate 检查高风险变更。

边界：

- Workflow Engine 是唯一状态写入者。
- Coordinator Agent 只输出结构化建议，不能直接改状态。
- Implementation Agent 只负责产出候选变更。
- AgentBackend 只是执行载体，可以是 Claude Code、Codex 或 Native Runner。

Implementation Gate 检查：diff 是否关联需求和设计项、是否越界、是否引入新依赖/权限/配置、是否触碰敏感路径、是否有测试或测试说明。

## 9. 阶段六：Java / Maven 编译测试

当前 MVP 先只管 Java + Maven。

目标：用真实命令和测试报告证明代码可构建、可测试。

流程：

1. Build Service 创建 sandbox。
2. checkout 当前代码和变更。
3. 挂载 Maven cache 和必要 secret，例如 `settings.xml`。
4. 优先使用 `./mvnw`，否则使用系统 `mvn`。
5. 执行 compile/test command。
6. 收集日志、exit code、Surefire / Failsafe report。
7. 生成 BuildRun / TestRun / GateRun。

推荐命令：

```bash
./mvnw -B -DskipTests compile
./mvnw -B test
```

Build Gate 只认真实执行结果：exit code、日志摘要、测试报告解析、timeout/resource limit、artifact 引用。

失败时 Debug Agent 可以分析日志，Implementation Agent 可以修复；但是否通过只能由 BuildRun / TestRun / GateRun 决定。

## 10. 阶段七：审查与验收

目标：确认最终结果满足需求、设计、测试和风险要求。

流程：

1. Review Agent 审查实现偏差、可维护性和风险。
2. Acceptance Gate 检查 traceability。
3. 人确认业务验收和风险接受。
4. Workflow Engine 决定推进、暂停、回退或要求修复。

Acceptance Gate 检查链路：

```text
Requirement → Design → Diff → Test → Evidence → Approval
```

验收不能只显示“通过”，必须记录覆盖了哪些需求、哪些测试证明了覆盖、哪些风险已接受、哪些问题仍未解决。

## 11. 阶段八：Completion Report

目标：每次需求完成、bug 修复、测试完成后，都有可审计的交付报告。

Report 面向人和审计，必须引用事实源，不是 LLM 自述。

Report 应包含：

- 需求背景、范围、非范围。
- 设计摘要和关键变更。
- 构建和测试结果。
- GateRun 结果和人工审批记录。
- 风险、已知限制、后续建议。

事实来源：Requirement、Context Pack、Design、Git diff、BuildRun、TestRun、GateRun、Human Approval。

## 12. 阶段九：Knowledge Capture

目标：把交付中的有效经验沉淀为未来可复用的项目记忆。

Knowledge Candidate 类型：

- Decision：重要技术决策。
- Learning / Pitfall：踩坑和规避方式。
- Trick / Pattern：可复用实现模式。
- Architecture Update：架构事实更新。
- Explore Record：探索路径和结论。

入库原则：默认生成候选，不自动写入长期知识库；必须有 evidence refs、适用范围、失效条件；Decision 类知识必须人确认；Accepted Knowledge 进入未来 Context Pack。

## 13. 配置系统

平台需要两类配置。

### 13.1 Lifecycle / Workflow 配置

描述软件生命周期怎么跑：Workflow Template、Step Template、AgentSpec、Prompt Template、Skill / Instruction Pack、Tool Policy、Hook Spec、Gate / Rule Spec、Artifact Schema。

要求：UI 化编辑、版本化、发布/回滚、Eval 验证、每次运行锁定 resolved config snapshot。

### 13.2 Platform Runtime 配置

支撑平台运行：LLM endpoint、API key secret ref、Agent backend selection、sandbox、queue、storage、observability。

AgentSpec 不应写死 Claude Code 或 Codex，而应声明能力需求，由 Runtime Resolver 选择合适 backend。

## 14. 关键角色边界

Workflow Engine 负责确定性流程：状态机、StepRun、GateRun、Retry、Pause、Rollback、审批状态、审计日志。它回答：“是否允许这样走？”

Coordinator Agent 负责智能调度：解释状态、选择下一步建议、判断该找哪个 Specialist Agent、在不确定时升级。它回答：“现在最好怎么走？”

Coordinator 不能直接跳过 Gate、修改状态、批准 Human Gate。

Specialist Agents 包括：Context、Requirement、Design、Implementation、Test、Review、Debug、Knowledge。

Gate Engine 负责执行脚本化规则并产出结构化结果；Agent 可以解释失败原因，但不能宣布 Gate 通过。

## 15. 脚本、Agent、人类确认的分工

脚本适合判断：schema 完整性、traceability 是否存在、diff 是否越界、编译测试是否真实通过、evidence 是否存在、approval 是否记录。

Agent 适合判断：需求歧义、设计合理性、实现偏差、日志和 bug 根因、知识候选总结。

人类适合判断：业务范围、技术取舍、风险接受、需求和方案批准、merge/release、长期决策入库。

## 16. MVP 建议

第一版建议按以下顺序落地：

1. WorkflowRun / StepRun / Artifact / Audit 基础模型。
2. Runtime Blueprint 配置系统。
3. Local Runner + Trusted Local Worktree Mode。
4. Context Pack + Requirement / Design 流程。
5. Gate Engine + 基础规则。
6. Java / Maven 本地 compile/test + Compile/Test Gate。
7. Completion Report。
8. Knowledge Candidate + 人工确认入库。
9. AgentBackend：先 Native Runner，再适配 Codex / Claude Code。

Worktree MVP 是可信本地开发模式，不是强安全沙箱；通过 `ExecutionEnvironment` 预留 Sandbox 扩展。

## 17. PRD / 设计 / 开发防漏清单
写 PRD 时覆盖：项目接入、Context Pack、Requirement / Design / Implementation / Test / Acceptance、Workflow/Coordinator 边界、Hook/Gate/Rule Engine、Java Maven Build Gate、UI 配置、Report、Knowledge。

写技术设计时明确：Web UI、Config Service、Runtime Resolver、Workflow Engine、Agent Orchestrator、Gate Engine、Sandbox Runner / Build Service、Artifact Store、Knowledge Store、Audit Log。

开发完成前证明：GateRun 有记录、BuildRun/TestRun 有真实命令输出、Report 引用事实源、人工审批有记录、Knowledge Candidate 有 evidence、下一次 Context Pack 能复用已确认知识。

## 18. 最终原则

1. 平台编排软件生命周期，不只是编排 Agent。
2. Workflow Engine 与 Coordinator Agent 不可互相替代。
3. Agent 可以建议，不能越权推进状态。
4. 脚本和真实命令优先于 LLM 声称。
5. 人只参与关键业务判断，不参与重复机械检查。
6. 配置必须 UI 化、版本化、可回滚、运行时可追溯。
7. 每次交付必须有 Completion Report。
8. 每次有效经验都应沉淀为 Knowledge Candidate。
9. CodeStable 是思想来源，不是平台控制面依赖。
