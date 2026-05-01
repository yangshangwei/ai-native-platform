# AI Native 云开发平台：Tool Policy 与 Skill / Instruction Pack 配置

日期：2026-05-01

## 10. Tool Policy 配置

每个 Agent 不应随便用所有工具。

Implementation Agent：

```yaml
id: implementation-tools
tools:
  read_file: true
  search_code: true
  edit_file: true
  run_shell:
    allowed_commands:
      - pnpm test
      - pnpm lint
      - pnpm typecheck
  git:
    allow_diff: true
    allow_commit: false
  network:
    enabled: false
```

Coordinator：

```yaml
id: coordinator-tools
tools:
  read_artifacts: true
  inspect_gate_results: true
  dispatch_agent: true
  transition_workflow: false
```

Coordinator 可以建议 transition，但不能直接 transition。

## 11. Skill / Markdown Instruction Pack 接入

支持导入 CodeStable 这类 skill，但不要深耦合。

```yaml
id: codestable-feature-design
type: instruction_pack
source:
  kind: markdown
  path: imported/codestable/cs-feat-design/SKILL.md

maps_to:
  agent: design-agent
  workflow_step: design

usage:
  as_prompt_context: true
  as_runtime_dependency: false
```

`SKILL.md` 只是 prompt / instruction 资产，不是平台流程制度。

## 12. 平台 Skill 与 Claude Code / Codex Skill 的关系

平台里的 Skill 不应该直接等同于 Claude Code / Codex 里的 skill。

推荐分成两层：

```text
Canonical Skill
  平台标准定义，长期维护、版本化、审计、UI 配置

Runtime Skill
  为 Claude Code / Codex / Native Agent 临时生成的执行形态
```

也就是说：

```text
平台 SkillSpec = source of truth
Claude Code Skill / Codex Skill / Prompt = runtime adapter output
```

不要把平台设计成“依赖 Claude Code 或 Codex 的 skill 存储”。否则会导致：

- 难跨后端迁移。
- 难做统一审计。
- 难做版本锁定。
- 难做多租户隔离。
- 难保证运行可复现。

更好的边界是：

```text
Skill 属于平台
Agent 使用 Skill
Claude Code / Codex 只是执行 Skill 的后端之一
```

## 13. Canonical SkillSpec 建议

平台维护的 Skill 应是一种标准能力资产，不只是 Markdown prompt。

示例：

```yaml
id: java-maven-debug
name: Java Maven Debug
version: 1.0.0
stage: debug
description: 分析 Maven compile/test 失败并提出修复方案
instructions: ./instructions.md
inputs:
  - build_log
  - surefire_report
  - git_diff
outputs:
  - root_cause
  - fix_plan
  - changed_files
  - verification_commands
toolPolicy:
  allow:
    - read_file
    - search_code
    - edit_file
requiredGates:
  - compile_gate
  - test_gate
compatibleBackends:
  - native
  - codex
  - claude-code
```

SkillSpec 至少应管理：

- metadata：名称、版本、适用阶段、标签。
- instructions：核心指令。
- input / output schema。
- tool policy。
- artifact policy。
- required gates。
- examples。
- backend compatibility。
- changelog。

## 14. Skill 的运行时注入流程

Skill 不建议由 Agent 自己随便查找和加载，而应由平台解析后注入。

推荐流程：

```text
Skill Registry
  ↓
Runtime Resolver
  ↓
Resolved Skill Bundle
  ↓
Agent Orchestrator
  ↓
Backend Adapter
  ↓
Claude Code / Codex / Native Agent
```

具体含义：

1. Workflow Engine 决定当前阶段。
2. Coordinator Agent 可以建议需要哪类能力。
3. Runtime Resolver 根据 workflow、stage、project、agent、backend 解析 Skill。
4. 平台锁定本次运行使用的 Skill 版本。
5. Agent Orchestrator 生成 AgentTask。
6. Backend Adapter 把 Skill 转成目标后端可执行形式。
7. Agent 执行并产出 artifact。
8. Gate Engine 校验结果。

运行时应记录：

```yaml
resolvedSkills:
  requirement-drafting: 1.2.0
  design-review: 1.0.3
  java-maven-debug: 1.0.0
```

同一个 WorkflowRun 启动后应锁定 Skill 版本，避免运行中行为漂移。

## 15. 三种注入方式

### 方式 A：Prompt 注入

把平台 Skill 编译进 AgentTask 的 system / developer / task prompt。

优点：

- 最通用。
- Claude Code、Codex、自研 Agent 都能用。
- 不依赖后端原生 skill 机制。
- 适合作为 MVP 主路径。

缺点：

- Skill 很长时会占上下文。
- 后端原生 discovery 能力利用较少。

### 方式 B：运行时生成本地 Skill 包

在任务启动前临时生成后端能识别的目录：

```text
/tmp/agent-run/run_123/skills/
  java-maven-debug/
    SKILL.md
    skill.yaml
    examples.md
```

这个目录只是 runtime materialized artifact，不是事实源。

适合后端支持本地 skill discovery 的场景。

### 方式 C：同步到后端原生安装机制

如果某个后端支持 `skills add` 或类似机制，可以由平台发布后同步。

但这只能作为优化，不建议作为主路径，因为它通常不利于版本锁定、多租户隔离和可复现运行。

## 16. 推荐落地路线

MVP：

```text
Canonical SkillSpec → Resolved Skill Bundle → Prompt 注入
```

稳定阶段：

```text
Canonical SkillSpec → Runtime Skill Materializer → 临时 SKILL.md / instructions.md
```

成熟阶段：

```text
SkillSpec
  → PromptAdapter
  → ClaudeCodeSkillAdapter
  → CodexSkillAdapter
  → NativeAgentAdapter
```

最终原则：平台只维护一套标准 SkillSpec，所有后端差异通过 Adapter 处理。

## 17. Skill 与 Agent / Hook / Gate 的边界

Skill 不是 Agent。

```text
Agent = 角色 / 执行者
Skill = 能力 / 方法包
```

一个 Agent 可以加载多个 Skill，例如 Debug Agent 可加载：

- `java-maven-debug`
- `root-cause-analysis`
- `regression-localization`

Skill、Hook、Gate 的边界：

```text
Skill：指导 Agent 怎么做
Hook：保证某些动作一定发生
Gate：判断结果能不能过
```

因此 Skill 是软约束，Hook / Gate 是硬约束。不能指望 Skill 保证流程正确。

---

相关：`2026-05-01-ai-native-platform-runtime-configuration-ops-notes.md`。
