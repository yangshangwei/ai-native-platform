# AI Native 云开发平台：UI 设计讨论记录收尾篇

本文承接 UI 设计讨论，记录渐进披露、MVP 页面、视觉风格、关键交互和最终 UI 方向。

## 15. 渐进披露

平台能力复杂，必须分层展示。

### 第一层：业务视图

给普通用户：

```text
我要做什么？
现在进展如何？
需要我确认什么？
结果能不能交付？
```

### 第二层：工程视图

给技术负责人：

```text
改了哪些文件？
跑了哪些测试？
哪些 Gate 过了？
风险在哪里？
```

### 第三层：平台视图

给平台管理员：

```text
用了哪个 Agent？
用了哪个 Skill 版本？
哪个 Workflow Template？
哪个 Runner？
哪个 LLM Provider？
```

默认显示第一层，按需展开第二、第三层。

## 16. 第一版 MVP 页面

第一版建议只做 6 个核心页面：

1. 项目接入页：连接仓库、连接 Local Runner、识别技术栈、生成 Project Profile。
2. 工作台首页：当前项目任务、待我确认、运行中的 Agent、失败的 Gate、最近完成的 Report。
3. 新建任务页：输入需求 / bug，选择任务类型、项目、分支，开始分析。
4. 任务详情页：生命周期阶段、当前 Artifact、Gate / Evidence / Approval、Agent 活动。
5. 报告页：Completion Report、Build/Test/Gate evidence、Knowledge suggestions。
6. 配置页：Runner、Build Profile、Agent Backend、Skill Version、Gate Rule Set。

## 17. 视觉风格建议

产品应该给用户的感觉：

```text
可信
清晰
可控
有证据
不炫技
```

不建议做成：

- 纯聊天机器人。
- 大量炫酷 Agent 动画。
- 满屏技术术语。
- 类似监控系统一样复杂。
- 类似 IDE 一样重。

建议风格：

```text
Enterprise SaaS + Developer Tool
```

布局建议：

- 左侧导航。
- 中间主工作区。
- 右侧 evidence / approval 面板。
- 卡片式阶段状态。
- 清晰的 pass / warn / fail 状态。
- 少贴长日志。
- 每个失败都要有下一步按钮。

## 18. 关键交互：只在关键点打扰用户

用户不应该一直盯着 AI 工作。

平台应把人工交互压缩到几个关键点：

```text
1. 确认需求
2. 批准设计
3. 批准高风险变更
4. 接受测试不足或风险
5. 最终验收
6. 确认知识入库
```

首页应有重要模块：

```text
待我处理
```

示例：

```text
待我处理

1. 订单导出功能：需要确认异步导出方案
2. 支付 bug 修复：需要批准修改权限校验逻辑
3. 库存重构：Test Gate 失败，是否让 Debug Agent 继续？
4. 用户画像任务：有 3 条 Knowledge 候选待确认
```

## 19. 最终 UI 方向

这个平台不应是：

```text
Chat UI
IDE UI
Agent 配置 UI
```

而应是：

```text
AI 软件交付工作台
```

用户从一个业务目标开始，平台逐步把它变成：

```text
Context
Requirement
Design
Implementation
Build/Test
Review
Report
Knowledge
```

每一步都有：

```text
Artifact
Gate
Evidence
Approval
Next Action
```

最终原则：

> 默认给用户一个极简“任务工作台”；复杂的 Agent、Skill、Gate、Runner、Prompt 全部藏到可展开的工程视图和配置中心里。用户只需要知道：现在做到哪一步、为什么卡住、需要我确认什么、结果有什么证据。
