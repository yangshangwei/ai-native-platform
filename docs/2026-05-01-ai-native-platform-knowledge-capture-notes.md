# AI Native 云开发平台：Knowledge Capture 与长期记忆设计记录

日期：2026-05-01

## 8. Knowledge Capture Pipeline

建议流程：

```text
Workflow completed
  ↓
Completion Report generated
  ↓
Knowledge Agent 分析 report + artifacts
  ↓
生成 Knowledge Candidates
  ↓
Dedup / Similarity Check
  ↓
Human Review
  ↓
Accepted items 写入 Knowledge Store
  ↓
进入未来 Context Pack 检索
```

## 9. Knowledge Candidate 类型

### Decision

长期约束 / 架构选择。

```yaml
type: decision
title: 后端是权限判断权威
status: active
scope: project
rationale: 前端权限判断容易被绕过，后端必须作为唯一可信源
source_workflow: WF-123
evidence:
  - design: DESIGN-123
  - review: REVIEW-456
```

### Learning / Pitfall

踩坑经验。

```yaml
type: learning
track: pitfall
title: workspaceId 和 teamId 容易混用
problem: 权限查询中混用 workspaceId / teamId 导致越权风险
solution: 新增权限查询必须显式区分 workspace scope 和 team scope
source_workflow: WF-124
```

### Trick / Pattern

可复用实现模式。

```yaml
type: trick
title: 新增异步导出任务的标准接入方式
problem: 多个模块都需要大文件导出
recipe:
  - 注册 ExportJob
  - 使用 ExportButton
  - 结果写入 object storage
source_workflow: WF-125
```

### Architecture Update

系统现状变化。

```yaml
type: architecture_update
target_doc: architecture/permission.md
summary: 新增 RoleAssignment 聚合，权限判断进入 backend middleware
source_workflow: WF-126
```

### Explore Record

一次代码探索结论。

```yaml
type: explore
question: 当前导出功能如何实现？
answer: 小文件同步导出，大文件尚未统一抽象
evidence:
  - file: src/export/sync.ts
  - file: src/reports/export.ts
```

## 10. Knowledge 是否需要人确认

建议默认生成候选，不自动写入长期知识库。

原因：

```text
- Knowledge 会影响未来 Agent 行为
- 错误知识会长期污染项目
- decision 尤其不能由 AI 自动拍板
```

流程：

```text
Knowledge Agent 生成 candidates
  ↓
脚本校验 schema / evidence
  ↓
人选择：Accept / Edit and Accept / Reject / Mark as temporary
```

低风险 learning 可半自动，但 decision 必须人确认。

## 11. Knowledge Store 设计

可以存数据库，同时导出 Markdown。

字段：

```text
id
projectId
type
title
status: active / deprecated / superseded / rejected
content
tags
sourceWorkflowId
evidenceRefs
createdBy: agent / human
approvedBy
createdAt
updatedAt
```

状态流转：

```text
draft → proposed → approved → active → deprecated / superseded
```

未来 Context Pack 默认只检索：

```text
status = active
```

## 12. 如何进入未来 Agent 记忆

未来每次生成 Context Pack 时：

```text
Requirement / Design / Bug 关键词
  ↓
Knowledge Store
  ↓
取相关 active items
  ↓
放入 Context Pack
```

Context Pack 中可分层展示：

```text
相关 decision：必须遵守
相关 pitfall：避免再踩
相关 trick：可复用做法
相关 explore：已有代码理解
```

每条都带 evidence 和 source workflow。

## 13. Knowledge Gate

Completion 结束前跑 Knowledge Gate。

规则：

```text
- 如果 workflow 有新架构能力，必须生成 architecture update candidate
- 如果 bug root cause 明确，必须生成 learning candidate
- 如果引入可复用模式，必须生成 trick candidate
- 如果做出长期取舍，必须生成 decision candidate
- 每个 candidate 必须引用 source workflow 和 evidence
- decision candidate 必须 human approval 才能 active
```

Gate 要求生成候选，不一定要求必须接受。

## 14. UI 设计

Workflow 完成页建议有三个区域。

### Completion Report

```text
需求 / 设计 / 实现 / 测试 / Gate / 风险 / 结论
```

### Traceability Matrix

```text
SC-001 | Design 2.1 | File A/B | TEST-001 | Pass
SC-002 | Design 3.4 | File C   | TEST-002 | Pass
SC-003 | Design 4.1 | Human    | Manual   | Approved
```

### Knowledge Suggestions

卡片：

```text
[Decision] 后端是权限判断权威
[Learning] workspaceId/teamId 混用风险
[Trick] 新增导出任务标准接入方式
```

操作：

```text
Accept
Edit
Reject
Mark temporary
```

## 15. Report 和 Knowledge 的版本关系

Completion Report 是 workflow 当时的审计记录，建议不可变或 append-only。

Knowledge Item 可以更新：

```text
active → superseded
active → deprecated
```

旧 decision 不删除，而是标记 superseded。

## 16. 与 CodeStable 的关系

CodeStable 里类似：

```text
features/{feature}/acceptance.md
issues/{issue}/fix-note.md
compound/
architecture/
requirements/
```

平台映射：

```text
Completion Report ≈ acceptance.md / fix-note.md 的增强版
Knowledge Items ≈ compound 里的 learning / trick / decision / explore
Architecture Update ≈ feature acceptance 后回写 architecture
```

但平台应有结构化数据和 evidence refs，不只依赖 Markdown。

## 17. 推荐收尾流程

```text
Implementation / Fix 完成
  ↓
Build / Test / Gate 通过
  ↓
Completion Report Agent 起草报告
  ↓
Completion Report Gate 校验报告证据完整
  ↓
Human 最终验收
  ↓
Knowledge Agent 生成沉淀候选
  ↓
Knowledge Gate 校验候选 schema / evidence
  ↓
Human 接受 / 编辑 / 拒绝
  ↓
Accepted Knowledge 进入未来 Context Pack
```

## 18. 最终结论

> Completion Report 让这次工作可追溯；Knowledge Capture 让未来工作更聪明。

> 报告是审计记录，知识是长期记忆；二者都要有 evidence，不能让 Agent 自说自话。
