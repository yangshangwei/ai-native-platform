# AI Native 云开发平台与 CodeStable Workflow 设计讨论记录

日期：2026-05-01

## 8. 如何在 AI Native 云开发平台中融合这类 skill

不要在 Web 产品里直接暴露 `/cs-feat-design`、`/cs-issue-analyze` 这种命令。

更好的方式是：

> 把 skill 从“给 Claude Code / Codex 看的 Markdown 指令”，升级成云平台里的“可执行工作流模板 + 人机协作状态机”。

推荐架构：

```text
Web UI
  ↓
Intent Router / 工作流入口
  ↓
Workflow Engine / 状态机
  ↓
Agent Runtime / 多 Agent 执行器
  ↓
Tool Runtime / Git、Shell、Test、Browser、Logs、Deploy
  ↓
Artifact Store / 需求、方案、Issue、经验沉淀
  ↓
Project Workspace / Repo、分支、容器、环境
```

## 9. 云平台中的产品化流程

### 新功能流程

```text
需求梳理
  ↓ 人确认
方案设计
  ↓ 人确认
开发实现
  ↓ 自动测试
验收
  ↓ 人确认
知识沉淀
```

对应 CodeStable：

```text
cs-brainstorm / cs-req
  ↓
cs-feat-design
  ↓
cs-feat-impl
  ↓
cs-feat-accept
  ↓
cs-learn / cs-trick / cs-decide
```

### Bug 流程

```text
日志 / 问题输入
  ↓
问题报告
  ↓
根因分析
  ↓ 人选择修复方案
定点修复
  ↓
回归测试
  ↓
修复验收
  ↓
经验沉淀
```

对应 CodeStable：

```text
cs-audit / cs-issue-report
  ↓
cs-issue-analyze
  ↓
cs-issue-fix
  ↓
cs-learn
```

## 10. 关键产品设计：软 skill 硬状态机

CodeStable 当前是软约束：Agent 读到流程后自觉执行。

云平台应该把它硬化成状态机：

```text
intake -> design -> designReview -> implement -> test -> acceptance -> knowledgeCapture
```

关键 gating：

- 没有 design approval，不进入 implement
- 测试没过，不进入 acceptance
- 验收没完成，不允许 merge
- 发现重要经验，自动提示沉淀

## 11. 人在环设计

不要每一步都问人，只在关键环节交互。

新功能建议人工介入：

- 需求澄清
- 方案选择 / design approval
- 行为验收
- 重要经验是否沉淀

Bug 建议人工介入：

- 根因和修复方案选择
- 高风险修复确认
- 生产风险确认
- 经验沉淀草稿确认

## 12. 平台中对 skill 的抽象

不要把产品层叫 Skill，用户不一定理解。

产品层建议叫：

```text
Workflow
```

每个 Workflow 下面有多个 Step。

每个 Step 背后绑定：

- Skill instruction
- Agent role
- Tools
- Artifact schema
- Human gate
- Exit condition

例如：

```text
Workflow: 新功能开发
Step 1: 需求梳理
Step 2: 方案设计
Step 3: 实现
Step 4: 测试
Step 5: 验收
Step 6: 沉淀经验
```

## 13. MVP 建议

最小可行版本可以先做：

```text
Repo 接入
  ↓
项目初始化
  ↓
新功能 Workflow
  ↓
方案设计
  ↓
人工 approval
  ↓
代码实现
  ↓
自动测试
  ↓
PR
  ↓
验收报告
```

最小组件：

- Web UI
- GitHub repo connector
- Container workspace
- Skill registry
- Agent runner
- Artifact store
- Human approval gate
- Test runner

## 14. 后续值得继续讨论的问题

1. 如何把 `SKILL.md` 自动解析成结构化 workflow node？
2. Workflow schema 应该如何设计？
3. Artifact store 是直接用文件树，还是数据库 + 文件双写？
4. Human approval 的 UI 怎么做才不打断自动化体验？
5. Bug log / Sentry / OpenTelemetry 如何接入 issue 分析流程？
6. 多 agent 执行和单 agent 状态机如何取舍？
7. CodeStable 这种 skill 包是否需要新增 hooks / subagent metadata？

---

续篇：`2026-05-01-ai-native-platform-context-pack-notes.md`。

---

续篇：`2026-05-01-ai-native-platform-agent-architecture-notes.md`。
