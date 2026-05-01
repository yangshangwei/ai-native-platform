# AI Native 云开发平台：脚本、Agent、人类确认的职责矩阵

日期：2026-05-01

## 1. 目标

平台应尽可能通过脚本校验，避免大模型自卖自夸，例如声称“我完成了”“我实现对了”“测试通过了”。

核心原则：

> 能脚本校验的，一律脚本校验；不能脚本完全判断的，让大模型生成结构化分析 / 草稿 / 建议，再由人或独立 Gate 确认。

不要让执行任务的 Agent 自己宣布通过。

## 2. 三类判断

### A. 脚本可严格校验

特点：输入明确、规则明确、结果可复跑、能给 pass / fail。

适合脚本：

```text
- YAML / JSON schema 是否有效
- 需求字段是否齐全
- success criteria 是否都有 ID
- design 是否引用 requirement
- design 是否覆盖所有 success criteria
- diff 是否越过 allowed files
- 测试命令是否真实执行并通过
- build / lint / typecheck 是否通过
- 是否改了敏感路径
- 是否新增 dependency
- acceptance 是否有 evidence
```

### B. 大模型辅助判断，但必须结构化输出 + 可校验

特点：需要语义理解，但可强制输出结构，可检查证据链。

适合 Agent：

```text
- 需求是否足够清楚
- 设计是否合理
- 根因分析是否有证据
- 测试策略是否覆盖关键风险
- 代码实现是否偏离设计
- 是否过度设计
- 是否违背历史 decision
```

Agent 不能只说“合理”，必须输出：结论、覆盖项、证据、风险、不确定点、建议动作。

### C. 必须人确认

涉及业务取舍、风险偏好、产品方向，必须人拍板。

```text
- 需求是否符合业务目标
- 成功标准是否被用户接受
- 设计方案 A/B 取舍
- 是否缩 scope
- 是否接受某个风险
- 是否允许高风险改动
- 是否上线 / merge
- 是否把某条经验沉淀为长期决策
```

## 3. 需求阶段职责

### 脚本校验：Requirement Gate

```text
- requirement artifact 存在
- schema 有效
- title / problem / target_user 存在
- success_criteria 至少 1 条
- 每条 success_criteria 有唯一 ID
- 每条 success_criteria 有可验证类型：automated_test / human_verification / metric / log_evidence
- non_goals 存在
- assumptions 或 unanswered_questions 存在
- blocking unanswered_questions 数量为 0 才能进入 design
```

启发式 warn：

```text
- success criteria 不应只写“更好”“优化”“友好”“合理”
- 每条 criterion 不宜过长
- criterion 不应混多个目标
```

### 大模型处理

Requirement Agent：

```text
- 根据用户输入和 Context Pack 生成需求草稿
- 识别缺失信息
- 提出 3-5 个关键问题
- 把模糊表述改成可验证 success criteria
```

### 人确认

```text
- 需求是否真是要做的事
- 成功标准是否合理
- non-goals 是否接受
- blocking questions 的答案
```

## 4. Context Pack 阶段职责

### 脚本校验：Context Pack Gate

```text
- context_pack artifact 存在
- 至少包含 N 条 evidence refs
- 每条 evidence ref 有 kind / uri / summary
- 引用的文件路径存在
- 引用的 commit / log / trace 可访问
- 相关性分数或来源类型符合规则
- 不允许只有 LLM 总结、没有证据链接
```

### 大模型处理

Context Agent：

```text
- 查代码、文档、历史 bug、decision
- 总结与当前需求相关的背景
- 标记风险和不确定点
```

### 人确认

通常不需要确认全部 context，但以下情况需要问人：

```text
- 找到互相冲突的历史约束
- 找不到关键模块
- 需要访问缺失权限的日志 / repo / 环境
```

## 5. 设计阶段职责

### 脚本校验：Design Gate

```text
- design artifact schema 有效
- design 引用 requirement ID
- design.implements 覆盖所有 success_criteria
- 每个 criterion 在 coverage matrix 中出现
- 每个 design decision 有 rationale
- 每个 external interface 有 input / output / error behavior
- 每个 non-goal 没有出现在 scope
- touch_points / allowed_files 存在
- test_strategy 存在
```

### 大模型处理

Design Agent：

```text
- 基于 requirement + context pack 生成方案
- 设计接口契约
- 识别影响范围
- 生成推进策略
- 生成测试策略
```

Review Agent：

```text
- 判断设计是否过度复杂
- 判断是否违背已有架构
- 判断是否遗漏关键边界
```

Review 结果必须结构化并带 evidence。

### 人确认

```text
- 选择方案
- 接受 tradeoff
- approve design
- 是否允许 scope 调整
```

## 6. 实现阶段职责

### 脚本校验：Implementation Gate

```text
- design 已 approved
- checklist 存在
- implementation task 引用 checklist step
- git diff 文件都在 allowed_files / touch_points 内
- changed files 都能映射到 checklist step
- 没有未批准 dependency 变化
- 没有未批准 migration
- 没有未批准 sensitive path 变化
- 没有修改锁文件，除非 dependency change 被批准
- 没有删除测试或跳过测试，除非记录理由并人工批准
- patch 能 clean apply
- repo 状态干净
- 没有生成文件污染
- 没有 secret / token 泄漏
```

### 大模型处理

Implementation Agent：

```text
- 按 approved design 修改代码
- 生成实现摘要
- 遇到方案外情况上报
```

Review Agent：

```text
- 语义审查代码是否符合设计
- 查明显逻辑漏洞
- 查过度设计
```

### 人确认

```text
- scope 变更
- 高风险文件变化
- dependency / migration
- 方案外改动
```

---

续篇：`2026-05-01-ai-native-platform-gate-responsibility-matrix-continued.md`。
