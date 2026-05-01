# AI Native 云开发平台：UI 设计讨论记录

本文记录 AI Native 开发平台的 UI 设计方向：如何让用户低成本使用，同时把需求、设计、开发、测试、验收、报告和知识沉淀等流程落实到产品界面中。

## 1. UI 总判断

UI 不应该围绕“Agent / Skill / Gate”这些底层技术概念来设计，而应该围绕“我要完成一个开发任务”来设计。

底层可以是多 Agent、Workflow、Hook、Gate、Skill，但用户第一眼看到的应该是：

```text
需求
方案
进度
风险
结果
需要我确认什么
```

这个产品的核心 UI 不是纯聊天框，而是：

```text
任务工作台 + 生命周期看板 + 证据面板 + 人工确认点
```

## 2. 产品形态对 UI 的影响

推荐产品形态：

```text
Web 平台 + Local Runner
```

Web 平台负责：

- 流程。
- 协作。
- 配置。
- 报告。
- 审计。
- 知识沉淀。

Local Runner 负责：

- 连接本地代码。
- 调用 Claude Code / Codex。
- 执行 Maven / shell / docker。
- 收集 diff、日志、测试报告。

因此 UI 顶部应持续展示本地环境状态：

```text
Project: order-service
Branch: feature/export-csv
Runner: online
Agent Backend: Codex local
Build Env: Java 17 / Maven
Last Sync: 1 min ago
```

如果 Runner 未连接，用户可以做需求、设计、配置，但不能进入本地开发执行阶段。

## 3. 第一原则：用户不是来配置 Agent 的

普通用户入口不应该是：

- 选择 Agent。
- 选择 Skill。
- 选择 Backend。
- 选择 Gate。
- 编辑 Prompt。

普通用户入口应该是：

```text
我要做一个新功能
我要修一个 bug
我要做一次代码审计
我要让 AI 理解这个项目
我要沉淀一次经验
```

平台在后台自动决定：

```text
Workflow Template
Agent
Skill
Gate
Runner
Build Profile
```

高级配置应该放到配置中心，而不是主流程。

## 4. 推荐信息架构

第一版建议收敛为：

```text
工作台
项目
任务
知识库
配置
```

更完整版本可以扩展为：

```text
首页 / 工作台
项目
任务
需求
设计
构建测试
报告
知识库
配置中心
```

不要第一版就把所有底层概念暴露给用户。

## 5. 核心页面：任务工作台

任务工作台是最重要的页面，推荐三栏结构：

```text
┌──────────────────────────────────────────────┐
│ 项目 / 分支 / Runner 状态 / 当前阶段           │
├───────────────┬────────────────────┬─────────┤
│ 生命周期阶段   │ 当前阶段详情         │ 证据/审批 │
│               │                    │         │
│ ✓ Context     │ Requirement Draft   │ Context │
│ ✓ Requirement │ Acceptance Criteria │ Evidence│
│ → Design      │ Open Questions      │ GateRun │
│ ○ Implement   │                    │ Approval│
│ ○ Build/Test  │                    │         │
│ ○ Review      │                    │         │
│ ○ Report      │                    │         │
└───────────────┴────────────────────┴─────────┘
```

左栏：生命周期阶段。

```text
Context Pack        Done
Requirement         Needs confirmation
Design              Pending
Implementation      Blocked
Build/Test          Not started
Acceptance          Not started
Report              Not started
Knowledge           Not started
```

中栏：当前阶段内容。

右栏：证据、Gate、风险、审批、Artifact。

右栏是平台差异化核心：用户要知道结论凭什么成立。

## 6. 新建任务页

新建任务不应该像重型 Jira 表单。

推荐第一屏：

```text
你想做什么？

[输入框]
例如：给订单列表增加 CSV 导出，支持按筛选条件导出，最多 5 万条。

任务类型：
○ 新功能
○ Bug 修复
○ 重构
○ 审计
○ 不确定，让 AI 判断

项目：
[order-service]

代码位置：
[当前分支 / 选择分支]

[开始分析]
```

点击“开始分析”后，不是直接写代码，而是进入：

```text
Context Pack → Requirement Draft
```

## 7. 需求阶段 UI

需求阶段要避免“聊天流里丢需求”，应使用结构化卡片。

示例：

```text
Requirement Draft

目标：
- 支持订单列表按当前筛选条件导出 CSV。

用户场景：
- 运营人员筛选某时间段订单后导出做线下分析。

验收标准：
- AC-001：导出结果与当前筛选条件一致。
- AC-002：最多支持 50,000 条。
- AC-003：导出过程不阻塞页面。
- AC-004：无权限用户不可导出。

非目标：
- 不支持 Excel。
- 不支持跨租户导出。

待确认：
- 是否需要异步导出？
- 文件保留多久？
```

待确认问题旁边提供：

```text
[确认] [修改] [移出范围] [让 AI 解释]
```

右侧展示 Requirement Gate：

```text
Requirement Gate
✓ 有需求 ID
✓ 有验收标准
✓ 有非目标
⚠ AC-003 缺少性能阈值
```

## 8. 设计阶段 UI

设计阶段要突出“需求覆盖”。核心组件是需求覆盖矩阵。

示例：

| 需求 | 设计覆盖 | 测试策略 | 状态 |
|---|---|---|---|
| AC-001 筛选条件一致 | ExportQueryBuilder 复用列表查询条件 | 单元测试 + 集成测试 | 已覆盖 |
| AC-002 5 万条限制 | ExportLimitValidator | 边界测试 | 已覆盖 |
| AC-003 不阻塞页面 | 异步任务 + 下载通知 | E2E 测试 | 待确认 |
| AC-004 权限控制 | ExportPermissionChecker | 权限测试 | 已覆盖 |

设计页不应只是一篇长文，而应包含：

- 设计摘要。
- 影响模块。
- 接口变化。
- 数据变化。
- 风险。
- 覆盖矩阵。
- 待审批项。

右侧展示 Design Gate：

```text
Design Gate
✓ 所有 AC 有设计覆盖
✓ 有测试策略
⚠ 异步导出方案需要人工确认
```


---

续篇：`2026-05-01-ai-native-platform-ui-design-continued.md`。
