# AI Native 云开发平台：多 Agent、Hook/Gate 与执行后端讨论记录

日期：2026-05-01

## 1. 基本判断

如果要做成 AI Native 软件生命周期平台，只靠 soft prompt / skill 约束不够。

CodeStable 这类 skill 适合做方法论原型，但 Web 平台要进入工程生产级，需要升级成：

> 状态机驱动 + 多 Agent 分工 + Hook 强约束 + 门禁验证 + 协调 Agent 决策。

关键点：

> 多 Agent 不是核心，Workflow State Machine 才是核心。Agent 是执行节点，Hook 是强制规则，Gate 是质量检测，Coordinator 是调度脑。

不要做成“很多 Agent 互相聊天”，而要做成“流程系统调度专业 Agent 完成受控任务”。

## 2. 推荐总体架构

```text
Workflow Engine 是主控
Coordinator Agent 是副驾驶
Specialist Agents 是工人
Hooks 是硬规则
Gates 是质量关卡
Artifacts 是事实源
Human 是关键决策者
```

执行形态：

```text
用户需求
  ↓
Workflow Engine 创建流程实例
  ↓
Coordinator Agent 判断下一步
  ↓
Specialist Agent 执行具体任务
  ↓
Hook 强制补上下文 / 跑校验 / 记录产物
  ↓
Gate 判断是否可进入下一阶段
  ↓
失败则回退 / 重试 / 升级给人
```

核心原则：

> 不要让 Agent 自己记得流程；让平台控制流程。

## 3. 为什么不能一个 Agent 全包

一个 Agent 从需求、设计、开发、测试一路干到底会有问题。

### 角色污染

实现者容易证明自己的方案是对的。它做完实现后再自己验收，容易变成：

```text
“我按我理解的需求实现了，所以验收通过。”
```

更合理的是：

```text
验收 Agent 按原始需求和 approved design 检查实现是否偏离。
```

### 上下文漂移

长流程容易发生：

```text
需求 A
  ↓
设计 A'
  ↓
实现 A''
  ↓
测试只测了 A''
```

测试通过不代表仍满足原始需求。

### 缺少反方视角

设计者、实现者、测试者、审查者应该互相制衡。

最少要有：

```text
Design Agent
Implementation Agent
Test / Review Agent
Coordinator Agent
```

## 4. 多 Agent 角色划分

### Coordinator Agent

职责：

```text
- 判断当前 workflow 阶段
- 判断下一步推进、暂停、回退、重试还是升级给人
- 选择 Specialist Agent
- 聚合多个 Agent 的结论
- 发现冲突时裁决或请求人决策
```

它不直接写代码、不直接写最终设计。

### Requirement Agent

职责：

```text
- 把用户原始需求变成结构化需求
- 结合 Context Pack 问关键问题
- 明确目标、非目标、成功标准
- 输出 Requirement Artifact
```

### Context / Exploration Agent

职责：

```text
- 查代码
- 查历史文档
- 查架构
- 查历史 bug
- 查日志
- 生成 Context Pack
```

它不做产品判断，只收集证据。

### Design / Architecture Agent

职责：

```text
- 基于 Requirement + Context Pack 出方案
- 定义接口契约
- 识别影响范围
- 写推进策略
- 输出 Design Artifact
```

不直接写代码。

### Implementation Agent

职责：

```text
- 按 approved design 修改代码
- 不改 design 外范围
- 每步提交 diff / patch
- 遇到方案外情况停止并上报
```

### Test Agent

职责：

```text
- 根据需求和 design 生成测试策略
- 补测试
- 跑测试
- 判断测试是否覆盖关键不变量
```

### Review Agent

职责：

```text
- 审查 diff 是否符合 design
- 查范围外改动
- 查可维护性问题
- 查安全风险
- 查是否缺测试
```

### Debug Agent

职责：

```text
- 分析失败测试 / 日志 / 生产错误
- 做根因分析
- 给修复方案
```

### Knowledge Agent

职责：

```text
- 从完成的 workflow 中提炼经验
- 判断是否沉淀 decision / learning / trick
- 更新项目知识库
```

## 5. Hook 的职责

Hook 不应该主要靠 LLM，而应尽量是确定性动作。

### 阶段进入 Hook

典型动作：design 前生成 Context Pack 并检索历史 decision / bug；implementation 前检查 design approved、checklist、隔离分支；acceptance 前跑 test / lint / typecheck、生成 diff summary。

### 阶段退出 Hook

典型动作：design 退出时校验 schema、提取 checklist、等待审批；implementation 退出时记录 diff、跑基础验证、生成摘要；bugfix 退出时生成 fix-note。

### 文件 / Diff Hook

典型规则：design 外文件变更阻断；删除测试要求解释；依赖、migration、auth/payment/permission 变更触发人工或安全 gate。

## 6. Gate 的分类

Gate 是“能不能进入下一阶段”的判断器。

### Deterministic Gate

程序化判断：tests / typecheck / build 是否通过，design 是否 approved，artifact schema 是否有效，是否存在 forbidden file changed。

### AI Review Gate

模型判断：实现是否符合 design，测试是否覆盖关键成功标准，是否过度设计，是否违背历史 decision。

### Human Gate

人类拍板：需求确认、方案确认、高风险修复、生产发布、重要架构决策。

---

续篇：`2026-05-01-ai-native-platform-controlled-flows-notes.md`。

---

相关：`2026-05-01-ai-native-platform-quality-gates-notes.md`。

---

相关：`2026-05-01-ai-native-platform-runtime-configuration-notes.md`。
