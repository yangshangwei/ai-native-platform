# Docs 索引：CodeStable 与 AI Native 云开发平台讨论沉淀

本文是 `docs/` 目录的入口索引。当前文档主要来自同一轮连续讨论，记录的是：如何借鉴 CodeStable 的 skill 思想，设计一个 Web 化、配置化、可审计的 AI Native 软件生命周期平台。

## 0. 总入口

- `2026-05-01-ai-native-platform-business-flow-integrated.md`
  - 按业务流程整合后的总文档，建议作为 PRD / 技术设计 / 开发拆解前的第一入口。

## 0.1 新仓库交接文档

- `2026-05-01-ai-native-platform-handoff.md`
  - 面向新仓库开发的交接文档，覆盖 MVP 定位、架构、模块、Local Runner/worktree、Skill/Gate、UI、开发里程碑、构建测试和第一天任务。

## 1. 推荐阅读顺序

### 1.1 先理解 CodeStable 与 skill 机制

1. `2026-05-01-codestable-skill-mechanics-notes.md`
   - CodeStable 的来源、入口 `cs/SKILL.md`、`npx skills add` 原理、hooks / sub-agents 情况、初始化脚本与 Python 运行环境。

### 1.2 再看平台总体方向

2. `2026-05-01-ai-native-platform-workflow-design-notes.md`
   - 平台不是 Web 版 CodeStable，而是 AI Native 软件生命周期平台。
   - 关键原则是“软 skill + 硬状态机”。

3. `2026-05-01-ai-native-platform-context-pack-notes.md`
   - 需求阶段如何感知工程背景。
   - 推荐“薄初始化 + 按需 Context Pack + 持续回写”。

### 1.3 看多 Agent 和执行控制

4. `2026-05-01-ai-native-platform-agent-architecture-notes.md`
   - 多 Agent、Hook、Gate、Workflow Engine、Coordinator Agent 的基本分工。

5. `2026-05-01-ai-native-platform-controlled-flows-notes.md`
   - 新功能和 bug 修复在受控流程里如何推进。

6. `2026-05-01-ai-native-platform-agent-backend-notes.md`
   - Claude Code / Codex / Native AgentBackend 的取舍。
   - 平台控制面不要绑定某一个 Agent 载体。

### 1.4 看门禁与 QA

7. `2026-05-01-ai-native-platform-quality-gates-notes.md`
   - Quality Gate / Rule Engine 的总体设计。

8. `2026-05-01-ai-native-platform-quality-gate-rules-notes.md`
   - Requirement、Design、Implementation、Test、Acceptance、Knowledge Gate 的具体规则。

9. `2026-05-01-ai-native-platform-gate-responsibility-matrix-notes.md`
10. `2026-05-01-ai-native-platform-gate-responsibility-matrix-continued.md`
   - 哪些由脚本严格校验，哪些由 Agent 分析，哪些必须由人确认。

### 1.5 看 Java / Maven 编译测试门禁

11. `2026-05-01-ai-native-platform-java-maven-build-gate-notes.md`
    - 早期 Java / Maven build gate 讨论；其中 “sandbox” 表述已被本地 worktree 决策修正。

12. `2026-05-01-ai-native-platform-java-maven-build-gate-implementation.md`
    - BuildRun、CommandRun、Surefire / Failsafe report parsing、Compile Gate、Test Gate。

12.1 `2026-05-02-ai-native-platform-local-worktree-decision.md`
   - 当前已拍板执行环境：本地编译环境 + Git worktree，不追求沙箱级强制。

### 1.6 看配置系统

13. `2026-05-01-ai-native-platform-runtime-configuration-notes.md`
    - Workflow Template、AgentSpec、Prompt Template、Hook、Gate、Artifact Schema 等配置对象。

14. `2026-05-01-ai-native-platform-tool-skill-configuration-notes.md`
    - Tool Policy 与 Skill / Markdown Instruction Pack 的接入方式。
    - 平台 Canonical Skill 与 Claude Code / Codex Runtime Skill 的区别、注入方式和 Adapter 路线。

15. `2026-05-01-ai-native-platform-runtime-configuration-ops-notes.md`
    - 配置继承、版本、发布、回滚、Eval、UI 化配置、运行时解析。

### 1.7 看交付报告与知识沉淀

16. `2026-05-01-ai-native-platform-completion-report-knowledge-capture-notes.md`
    - Completion Report 如何作为审计和溯源记录。

17. `2026-05-01-ai-native-platform-knowledge-capture-notes.md`
    - Knowledge Candidate、Knowledge Gate、长期记忆和未来 Context Pack 的关系。

### 1.8 看本地执行环境 / Worktree MVP

18. `2026-05-01-ai-native-platform-local-runner-worktree-notes.md`
    - Trusted Local Worktree Mode 的 MVP 决策、Local Runner、worktree 创建、AgentBackend 调用、本地 Maven 命令执行。

19. `2026-05-01-ai-native-platform-local-runner-worktree-implementation.md`
    - Worktree 模式的 UI 呈现、ExecutionEnvironment 扩展点、MVP 清单、风险约束和最终方案。

### 1.9 看 UI / 产品界面设计

20. `2026-05-01-ai-native-platform-ui-design-notes.md`
    - UI 总方向、Web + Local Runner 状态、信息架构、任务工作台、新建任务、需求和设计阶段 UI。

21. `2026-05-01-ai-native-platform-ui-design-continued.md`
    - 开发、Build/Test、验收、Completion Report、Knowledge Capture、配置中心 UI。

22. `2026-05-01-ai-native-platform-ui-design-final.md`
    - 渐进披露、MVP 页面、视觉风格、关键交互和最终 UI 方向。

### 1.10 看总流程索引

23. `2026-05-01-ai-native-platform-docs-process-summary.md`
    - 按业务流程汇总所有讨论，用于后续写 PRD、技术设计和开发防漏。

## 2. 业务流程主线

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
Java / Maven Local Worktree Build：Compile Gate + Test Gate
  ↓
审查验收：Review + Acceptance Gate + Human Acceptance
  ↓
Completion Report：审计、溯源、交付说明
  ↓
Knowledge Capture：经验候选、确认、入库
  ↓
未来需求阶段复用 Accepted Knowledge 与 Context Pack
```

## 3. 当前已经形成的核心结论

1. 平台要编排完整软件生命周期，不只是调 Agent。
2. CodeStable 是思想来源和 instruction pack 参考，不是平台控制面的依赖。
3. Workflow Engine 是唯一状态写入者。
4. Coordinator Agent 只做分析、路由、建议，不能跳过 Gate 或直接改状态。
5. AgentBackend 应可插拔，Claude Code / Codex / Native Runner 都只是执行载体。
6. 尽量用脚本和真实命令校验，避免 LLM 自称完成。
7. 每个 Gate 都要有结构化 GateRun / RuleResult。
8. 当前 Build MVP 只覆盖 Java + Maven，并且必须在本地 git worktree 中使用本机 JDK/Maven/Git 跑 compile/test；不追求沙箱级强制。
9. 配置需要 UI 化、版本化、可发布、可回滚、运行时可追溯。
10. 每次交付必须生成 Completion Report，并把有效经验沉淀为 Knowledge Candidate。

## 4. 已发现并处理的文档问题

- 已补充本入口索引，避免只靠文件名理解文档关系。
- 已检查所有 Markdown 文档行数，目前均不超过 `AGENTS.md` 要求的 300 行。
- 已检查代码块 fence，没有发现明显未闭合代码块。
- 已保留部分文档的连续章节编号，因为它们是同一轮讨论拆分后的续篇；阅读时按本索引顺序即可。

## 5. 后续维护规则

1. 新增文档优先更新本 `docs/README.md`。
2. 单个 Markdown 文件不要超过 300 行；接近 280 行时优先拆分。
3. 文档引用其他文档时尽量使用完整文件名。
4. 新增平台设计结论时，同时检查是否影响：Workflow、Agent、Gate、Config、Build、Report、Knowledge。
5. 不要把 CodeStable skill 当作平台控制面依赖；相关能力应抽象为 instruction pack / workflow preset / import source。
