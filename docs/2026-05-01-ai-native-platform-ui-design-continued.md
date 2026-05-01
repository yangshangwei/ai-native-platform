# AI Native 云开发平台：UI 设计讨论记录续篇

本文承接 `2026-05-01-ai-native-platform-ui-design-notes.md`，继续记录开发、构建测试、验收、报告、知识沉淀和配置中心相关 UI 设计。

## 9. 开发阶段 UI

开发阶段不要让用户盯终端日志，而要展示：

- Agent 正在做什么。
- 修改了哪些文件。
- 为什么改这些文件。
- 当前是否需要人介入。

示例：

```text
Implementation Agent

当前动作：
- 修改 ExportController
- 新增 ExportService
- 新增权限校验
- 新增导出任务表迁移

修改文件：
- src/main/java/.../ExportController.java
- src/main/java/.../ExportService.java
- src/test/java/.../ExportServiceTest.java

关联需求：
- AC-001
- AC-002
- AC-004
```

右侧展示：

```text
Diff Scope Gate
✓ 修改文件在设计范围内
⚠ 新增数据库 migration，需要人工确认

Sensitive Change Gate
⚠ 修改权限相关代码
[查看详情] [批准继续] [要求修改]
```

## 10. Build / Test 阶段 UI

Build / Test 页面必须明确告诉用户：不是 AI 说通过，是命令真的跑过。

示例：

```text
Build Run #123

Environment:
- Java 17
- Maven 3.9
- Docker sandbox
- Command: ./mvnw -B -DskipTests compile

Result:
✓ Compile passed
Duration: 42s
```

测试：

```text
Test Run #124

Command:
./mvnw -B test

Result:
✓ 128 tests passed
✗ 0 failed
Duration: 2m 10s

Reports:
- surefire-report.xml
- logs/build-124.txt
```

失败时提供动作：

```text
[让 Debug Agent 分析]
[查看原始日志]
[重新运行]
```

Debug 分析示例：

```text
疑似原因：
- ExportServiceTest 使用了错误的 mock user role。

建议修复：
- 在 test setup 中补充 EXPORT_ORDER 权限。

证据：
- line 128 AccessDeniedException
```

## 11. 验收阶段 UI

验收阶段给用户一个交付检查单。

```text
Acceptance Checklist

✓ 需求 AC-001 已实现，有测试覆盖
✓ 需求 AC-002 已实现，有边界测试
✓ 需求 AC-003 已实现，但性能未压测
✓ 需求 AC-004 已实现，有权限测试

风险：
- 大数据量导出性能只通过单元测试，未做真实压测。

需要你确认：
[接受当前风险并完成]
[要求补充测试]
[退回设计阶段]
[退回开发阶段]
```

## 12. Completion Report UI

报告页结构：

```text
交付摘要
需求范围
设计决策
关键改动
构建测试结果
Gate 结果
人工审批记录
风险与遗留问题
知识沉淀建议
```

每一段都能点开 evidence。

例如：

```text
“构建通过”
  → BuildRun #123
  → command
  → logs
  → reports
```

```text
“AC-004 已覆盖”
  → Requirement AC-004
  → Design section D-004
  → Diff files
  → Test ExportPermissionTest
```

## 13. Knowledge Capture UI

不要自动把所有内容都塞进知识库，应做成候选列表。

示例：

```text
Knowledge Suggestions

1. Decision
   “订单导出统一走异步任务，避免阻塞列表接口”
   Evidence: Design D-003, PR #124
   [接受] [编辑] [忽略]

2. Pitfall
   “导出权限不能复用列表查询权限，需要单独 EXPORT_ORDER”
   Evidence: DebugRun #88, Test ExportPermissionTest
   [接受] [编辑] [忽略]

3. Pattern
   “大数据量 CSV 导出使用分页游标 + streaming writer”
   Evidence: ExportService.java
   [接受] [编辑] [忽略]
```

人确认后才进入长期 Knowledge Store。

## 14. 配置中心 UI

配置中心是高级能力，不应打扰普通用户。

配置中心可以分为：

```text
Workflow Templates
Agent Specs
Skills
Gates
Hooks
Tool Policies
Runner Profiles
LLM Providers
```

普通用户只看到：

```text
当前项目使用：Java Maven 标准流程
Agent Backend：Codex Local
Build Profile：Java 17 + Maven
```

旁边提供：

```text
[高级配置]
```


---

续篇：`2026-05-01-ai-native-platform-ui-design-final.md`。
