# AI Native 云开发平台：脚本、Agent、人类确认职责矩阵续篇

日期：2026-05-01

## 7. 测试阶段职责

### 脚本校验：Test Gate

```text
- test plan schema 有效
- 每个 success criterion 有至少一个 test 或 human verification
- 测试文件存在
- 声明的 test command 真实执行
- exit code = 0
- stdout / stderr 被记录
- test result artifact 由 Tool Runner 生成，不由 LLM 生成
- coverage threshold 达标
- bugfix 有 regression test，除非人工批准不可自动化
```

### 大模型处理

Test Agent：

```text
- 设计测试策略
- 补测试
- 分析失败测试
- 建议修复方向
```

Test Agent 不能说“测试通过了”。测试通过只能来自 Tool Runner 的 exit code 和日志。

### 人确认

```text
- 人工验收项
- 无法自动化测试的例外
- flaky test 是否接受
```

## 8. 验收阶段职责

### 脚本校验：Acceptance Gate

```text
- acceptance report schema 有效
- 每个 success criterion 有 pass / fail / skipped
- pass 必须有 evidence
- fail 不允许 merge
- skipped 必须有人批准
- evidence 必须引用 test run / diff / screenshot / log / human confirmation
- acceptance report 引用 design 和 requirement
```

### 大模型处理

Acceptance Agent：

```text
- 汇总需求、设计、实现、测试结果
- 生成验收报告草稿
- 标出风险和未覆盖项
```

它不能自己批准验收。

### 人确认

```text
- 最终验收
- 是否接受已知风险
- 是否允许 merge / release
```

## 9. 知识沉淀阶段职责

### 脚本校验：Knowledge Gate

```text
- 如果产生 architecture decision，必须有 decision artifact
- 如果产生 bug root cause，必须建议 learning
- 如果产生可复用实现模式，必须建议 trick / pattern
- knowledge artifact schema 有效
- 每条 knowledge 有来源 workflow / evidence
```

### 大模型处理

Knowledge Agent：

```text
- 从 workflow 中提炼 learning / decision / trick
- 去重已有知识
- 生成草稿
```

### 人确认

```text
- 是否接受沉淀
- 是否把某条建议升级为长期 decision
- 是否忽略某条经验
```

## 10. 第一版最重要的脚本 Gate

### Artifact Schema Gate

校验 requirement / design / checklist / test-plan / acceptance / knowledge 的 schema。

### Traceability Gate

校验：

```text
REQ → SC → Design coverage → Impl steps → Tests → Acceptance evidence
```

链路完整。

### Diff Scope Gate

校验实际改动文件没有越过 design 声明范围。

### Sensitive Change Gate

校验 auth / permission / payment / security / migration / dependency 等敏感变化。

### Test Execution Gate

平台真实执行测试命令，记录 exit code / stdout / stderr。

### Evidence Gate

校验所有 pass / conclusion 都有 evidence ref。

### Human Approval Gate

校验该人批的地方确实有人批，且有审计记录。

## 11. GateRun 记录

每次 Gate 运行都要存：

```ts
type GateRun = {
  id: string
  workflowRunId: string
  stage: string
  gateId: string
  status: 'pass' | 'warn' | 'fail' | 'blocked'
  startedAt: string
  completedAt: string
  ruleResults: RuleResult[]
  inputArtifacts: string[]
  outputArtifacts: string[]
  logsUri?: string
}
```

每条规则：

```ts
type RuleResult = {
  ruleId: string
  status: 'pass' | 'warn' | 'fail'
  severity: 'info' | 'warn' | 'error' | 'blocker'
  message: string
  evidenceRefs: EvidenceRef[]
  remediation?: string
}
```

## 12. 规则管理建议

规则集中管理：

```text
quality/
├── rules/
│   ├── requirement.yaml
│   ├── context-pack.yaml
│   ├── design.yaml
│   ├── implementation.yaml
│   ├── test.yaml
│   ├── acceptance.yaml
│   └── knowledge.yaml
├── schemas/
└── scripts/
```

覆盖层级：

```text
platform default
  ↓
org policy
  ↓
project policy
  ↓
workflow override
```

限制：blocker 级规则不能被普通项目随便关闭；关闭规则必须有人批准和原因；所有 override 必须记录。

## 13. 当前设计落地边界

```text
Agent 负责生成和解释
Script Gate 负责校验和阻断
Coordinator 负责根据 Gate 结果路由
Human 负责关键业务决策
Workflow Engine 负责状态迁移
```

一句话：

> 大模型给出候选答案，脚本判断结构和证据是否合规，人决定业务上是否接受。

## 14. 最终职责边界

### 脚本负责

```text
结构完整性
链路完整性
真实命令执行
diff 范围
敏感变更
证据存在
审批记录
```

### 大模型负责

```text
理解需求
总结上下文
提出方案
写代码
解释失败
发现潜在风险
生成草稿
```

### 人负责

```text
业务目标
产品取舍
方案批准
风险接受
上线合并
长期决策
```

最终目标：

```text
Agent 不能自卖自夸；
脚本必须留下可复跑的校验证据；
人只在真正需要判断的地方介入。
```

---

相关：`2026-05-01-ai-native-platform-java-maven-build-gate-notes.md`。
