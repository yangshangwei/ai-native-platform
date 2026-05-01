# AI Native 云开发平台：受控流程示例与控制系统定位

日期：2026-05-01

## 7. Coordinator Agent 的结构化决策

Coordinator 输出不应是自由文本，而应是结构化 action。

```ts
type CoordinatorDecision =
  | { action: 'proceed'; nextStep: string; reason: string }
  | { action: 'pause_for_human'; questions: string[]; reason: string }
  | { action: 'route_to_agent'; agent: string; task: string; reason: string }
  | { action: 'retry'; stepId: string; changes: string; reason: string }
  | { action: 'rollback'; targetStep: string; reason: string }
  | { action: 'abort'; reason: string }
```

示例：

```json
{
  "action": "pause_for_human",
  "reason": "权限粒度会影响数据模型和 API 设计，不能由 AI 假设",
  "questions": [
    "权限粒度是页面级、操作级还是资源级？",
    "是否允许用户自定义角色？"
  ]
}
```

## 8. 新功能流程示例

```text
用户输入需求
  ↓
[Hook] 创建 workflow run
  ↓
Coordinator 判断：feature or roadmap?
  ↓
Context Agent 生成 Context Pack
  ↓
[Gate] Context Pack 是否包含证据链接
  ↓
Requirement Agent 生成需求草稿
  ↓
[Human Gate] 用户确认需求 / 回答关键问题
  ↓
Design Agent 生成方案
  ↓
Review Agent 审查方案
  ↓
[Human Gate] 用户 approve design
  ↓
Implementation Agent 修改代码
  ↓
[Hook] 检查 diff 是否越界
  ↓
Test Agent 补测试 / 跑测试
  ↓
[Gate] tests / lint / typecheck
  ↓
Review Agent 审查实现
  ↓
Coordinator 判断是否回退修复
  ↓
Acceptance Agent 生成验收报告
  ↓
[Human Gate] 用户验收
  ↓
Knowledge Agent 沉淀经验
  ↓
PR / merge
```

## 9. Bug 流程示例

```text
错误日志 / 用户 bug 描述 / Sentry 事件
  ↓
[Hook] 收集日志、trace、最近部署、相关 commit
  ↓
Issue Agent 生成 issue report
  ↓
Debug Agent 做根因分析
  ↓
Review Agent 检查根因证据是否充分
  ↓
Coordinator 判断：
  - 证据足够 → 给修复方案
  - 证据不足 → 路由给 Exploration Agent 继续查
  - 高风险 → 暂停问人
  ↓
[Human Gate] 用户选择修复方案
  ↓
Implementation Agent 定点修复
  ↓
Test Agent 生成回归测试
  ↓
[Gate] 回归测试通过
  ↓
Review Agent 检查是否只修 bug 没顺手重构
  ↓
Knowledge Agent 写 learning
```

## 10. 控制系统定位

平台不是“更会写代码的 AI Chat”，而是：

> 把 AI 编码纳入软件生命周期控制系统的平台。

控制系统包含：

```text
状态机
角色分工
上下文包
工具权限
产物结构
自动校验
人工审批
审计记录
知识回写
```

---

续篇：`2026-05-01-ai-native-platform-agent-backend-notes.md`。

---

相关：`2026-05-01-ai-native-platform-quality-gates-notes.md`。
