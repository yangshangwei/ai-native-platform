# AI Native 云开发平台：Runtime Configuration 继承、版本、运行时与 UI

日期：2026-05-01

## 12. 配置继承和覆盖

需要多层配置：

```text
Platform Default
  ↓
Organization Preset
  ↓
Project Config
  ↓
Workflow Run Override
```

限制：

```text
- blocker 级规则不能被普通项目随便关闭
- 关闭规则必须有审批和原因
- 所有 override 必须记录
```

## 13. 配置版本和发布

配置要像代码一样发布。

生命周期：

```text
draft → review → active → deprecated → archived
```

每次 workflow run 锁定版本：

```json
{
  "workflowTemplate": "feature-development@1.2.0",
  "agents": {
    "design-agent": "2.1.0",
    "implementation-agent": "1.4.3"
  },
  "gates": {
    "design-alignment-gate": "1.3.0"
  }
}
```

## 14. 配置测试 / Eval

每个 Agent prompt、Gate rule、Workflow template 都需要测试。

Agent Prompt Eval：

```text
- 输入固定 context pack
- 预期输出 requirement / design / review
- 检查 schema
- 检查 evidence
- 检查是否问了关键问题
```

Gate Rule Test：

```text
给 fixture artifacts，预期 pass / fail。
```

Workflow Simulation：

```text
模拟 feature workflow，检查状态推进、gate fail 阻断、human approval 生效。
```

## 15. Web UI 配置页面

建议配置页面：

```text
Workflow Builder：Step → Agent → Hook → Gate → Human Gate
Agent Studio：角色、prompt、model、tools、input/output、failure policy
Gate Rule Manager：规则类型、severity、阶段、blocker、覆盖、fixture
Prompt Versioning：diff、rollback、A/B test、eval score、发布记录
Run Inspector：某次运行实际使用的 agent / prompt / gate / hook 版本
```

## 16. Runtime Config Resolution

用户创建 workflow 时：

```text
1. 选择 workflow template
2. 解析 org / project overrides
3. 锁定所有配置版本
4. 创建 workflow run
5. 每个 step 执行时解析 AgentSpec
6. 注入 prompt + context + tool policy
7. 运行 Agent
8. 执行 Hook / Gate
9. 记录配置版本和结果
```

这一步叫 Runtime Config Resolution，非常关键。

## 17. MVP 配置系统

第一版先做：

```text
1. Workflow Template YAML
2. AgentSpec YAML
3. Prompt Markdown
4. ToolPolicy YAML
5. Gate Rule YAML
6. Artifact Schema JSON
7. Version 字段
8. Run 时记录 resolved config snapshot
```

先用 Git-backed config，不急着做复杂 UI。

示例目录：

```text
.platform/
├── workflows/
├── agents/
├── prompts/
├── gates/
├── tools/
└── schemas/
```

## 18. 最终抽象

可以命名为：

```text
Runtime Blueprint
```

一个 Blueprint 定义：

> 这个项目如何让 AI 做需求、设计、开发、测试、验收和沉淀。

Blueprint 包含：

```text
Workflow Templates
Agent Specs
Prompts
Tool Policies
Hooks
Gates
Artifact Schemas
Human Gates
Override Policy
```

## 19. 总结

这不是“prompt 可配置”，而是：

> AI 软件生命周期运行时的配置系统。

它要回答：

```text
哪个流程？哪个阶段？哪个 Agent？什么 prompt？拿什么上下文？能用什么工具？产出什么结构？跑哪些 hook？过哪些 gate？失败后怎么办？谁能 override？用的是哪个版本？
```

一句话：

> Prompt 是内容，AgentSpec 是角色，Workflow 是流程，Hook/Gate 是制度，Config System 是把它们组合成可运行平台的蓝图。
