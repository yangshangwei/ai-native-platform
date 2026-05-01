# AI Native 云开发平台：Runtime Configuration / Blueprint 配置系统讨论记录

日期：2026-05-01

## 1. 基本定位

平台需要的不是简单的 Prompt 管理，而是一套：

> AI Native Runtime Configuration System

用于管理 Agent、Workflow、Prompt、Skill、Tool、Hook、Gate、Artifact Schema、权限、版本和发布。

它服务于完整架构：

```text
Workflow Engine 负责状态机
Coordinator Agent 负责调度决策
Specialist Agents 负责执行
Hooks 负责固定动作
Gates 负责质量门禁
Scripts 负责可复跑校验
Human 负责关键确认
```

配置系统要能表达：

> 谁在什么阶段，以什么角色，拿什么上下文，用什么工具，产出什么 artifact，经过什么 gate，失败后怎么处理。

## 2. 核心原则

### Prompt 不是一等核心，AgentSpec 才是

不要把系统设计成单纯 Prompt Library，而应设计成 Agent / Workflow / Gate / Tool / Artifact 的配置注册中心。

Prompt 只是 AgentSpec 的一部分。

### Workflow Engine 不由 prompt 控制

Workflow Engine 是平台制度层。它可以读取配置，但不能被 Agent prompt 绕过。

配置可以定义 steps、gates、hooks，但真正状态迁移、Gate 执行、Human approval 必须由平台代码保证。

### 所有可配置项都要版本化

必须记录每次 workflow run 使用了哪个版本：

```text
workflow template
agent prompt
gate rule
tool policy
artifact schema
```

否则无法复盘历史结果。

## 3. 配置系统管理对象

至少管理 9 类配置：

```text
1. Workflow Template
2. Step Template
3. Agent Spec
4. Prompt Template
5. Skill / Instruction Pack
6. Tool Policy
7. Hook Spec
8. Gate / Rule Spec
9. Artifact Schema
```

关系：

```text
Workflow Template
  ├── Step Template
  │   ├── Agent Spec
  │   ├── Prompt Template
  │   ├── Tool Policy
  │   ├── Input Artifact Schema
  │   ├── Output Artifact Schema
  │   ├── Hooks
  │   └── Gates
```

## 4. 推荐配置目录

可先采用 Git-backed config：

```text
configs/
├── workflows/
│   ├── feature-development.yaml
│   ├── bugfix.yaml
│   ├── refactor.yaml
│   └── audit.yaml
├── agents/
│   ├── coordinator.yaml
│   ├── context-agent.yaml
│   ├── requirement-agent.yaml
│   ├── design-agent.yaml
│   ├── implementation-agent.yaml
│   ├── test-agent.yaml
│   ├── review-agent.yaml
│   └── knowledge-agent.yaml
├── prompts/
├── gates/
├── hooks/
├── schemas/
└── skills/
```

Web 平台里可以存数据库，但要支持文件化导入导出。

## 5. AgentSpec 设计

Agent 不只是 prompt。

```yaml
id: design-agent
role: design
version: 1.0.0
model: { provider: anthropic, model: claude-sonnet-4.5, temperature: 0.2 }
prompt: { system: prompts/design-agent.md }
inputs: { required: [requirement, context_pack], optional: [architecture, historical_decisions] }
outputs: { artifacts: [{ type: design, schema: schemas/design.schema.json }] }
tools: { policy: read_only_codebase }
behavior: { may_modify_code: false, may_ask_human: true, must_cite_evidence: true, stop_on_uncertainty: true }
failure_policy: { on_missing_context: route_to_context_agent, on_blocking_question: pause_for_human }
```

Agent = role + prompt + model + tools + inputs + outputs + constraints + failure policy。

## 6. Coordinator Agent 配置

Coordinator 产出结构化决策，不产出业务文档。

```yaml
id: coordinator-agent
role: coordinator
version: 1.0.0
prompt: { system: prompts/coordinator.md }
inputs:
  required: [workflow_state, latest_gate_results, available_agents, artifacts_summary, human_messages]
outputs: { schema: schemas/coordinator-decision.schema.json }
allowed_actions: [proceed, pause_for_human, route_to_agent, retry, rollback, abort]
constraints: { cannot_transition_state_directly: true, cannot_mark_gate_passed: true, cannot_approve_human_gate: true }
```

Coordinator 可以建议动作，但 Workflow Engine 决定能不能执行。

## 7. Workflow Template 设计

新功能 workflow 示例：

```yaml
id: feature-development
version: 1.0.0
name: Feature Development

states:
  - intake
  - context_pack
  - requirement
  - requirement_review
  - design
  - design_review
  - implementation
  - verification
  - acceptance
  - knowledge_capture
  - completed
```

Step 示例：

```yaml
steps:
  context_pack:
    agent: context-agent
    hooks:
      before: [collect-repo-signals]
      after: [context-pack-evidence-check]
    gates:
      after: [context-pack-gate]

  implementation:
    agent: implementation-agent
    hooks:
      before: [ensure-approved-design, create-isolated-branch]
      after: [collect-git-diff, run-basic-tests]
    gates:
      after: [implementation-scope-gate, sensitive-change-gate]
```

Transition 示例：

```yaml
transitions:
  - from: context_pack
    to: requirement
    requires:
      gates_passed: [context-pack-gate]
  - from: requirement_review
    to: design
    requires:
      human_approval: requirement
```

配置定义流程，Workflow Engine 执行流程。

## 8. Hook 配置

Hook 是确定性动作，不应主要依赖 LLM。

```yaml
id: run-basic-tests
type: script
version: 1.0.0

trigger:
  stage: implementation
  timing: after

script:
  command: pnpm test
  timeout_seconds: 600

outputs:
  artifact_type: test_run

on_failure:
  block_transition: true
  route_to: debug-agent
```

Context Hook 示例：

```yaml
id: collect-repo-signals
type: context_builder
sources:
  - code_search
  - architecture_docs
  - decisions
  - historical_issues
outputs:
  artifact_type: context_pack
```

## 9. Gate 配置

Gate 是脚本化 QA 的核心。

```yaml
id: design-alignment-gate
version: 1.0.0
stage: design
type: traceability
severity: blocker

inputs:
  requirement: artifact.requirement
  design: artifact.design

rules:
  - id: all-success-criteria-covered
    type: coverage
    every: requirement.success_criteria[*].id
    must_be_in: design.coverage[*].requirement

on_fail:
  block_transition: true
  coordinator_action_hint:
    - route_to_agent: design-agent
    - pause_for_human
```

Gate 配置需要支持：severity、block / warn、input artifacts、rule type、remediation、on_fail hint。

---

续篇：`2026-05-01-ai-native-platform-tool-skill-configuration-notes.md`。

---

相关：`2026-05-01-ai-native-platform-java-maven-build-gate-notes.md`。
