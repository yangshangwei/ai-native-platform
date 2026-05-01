# AI Native 云开发平台：脚本化 Quality Gate 与 QA Rule Engine 讨论记录

日期：2026-05-01

## 1. 基本目标

平台不能依赖大模型自称“完成了”“实现了”“测试通过了”。关键生命周期环节需要脚本化校验。

目标是把：

```text
AI 自称完成
```

升级为：

```text
机器可验证的生命周期合规性
```

建议把这层做成平台独立系统：

> Quality Gate / Audit Rule Engine

它不属于某一个 Agent，也不由某个 Agent 临时决定，而是平台级基础设施。

## 2. 哪些能脚本验证，哪些不能

可以严格脚本验证：

```text
- 有没有需求文档
- 需求有没有成功标准
- design 有没有引用 requirement
- design 有没有非目标
- 实现有没有改 design 声明范围外的文件
- 测试有没有跑
- 测试结果是否通过
- acceptance 是否逐条引用 design checklist
```

不能完全脚本判断的语义质量：

```text
- 需求是否真的清楚
- 设计是否真的优雅
- 测试是否覆盖真实业务风险
```

但可以脚本验证“可审计结构”：

```text
- 必须有 evidence
- 必须有 coverage matrix
- 必须有 traceability link
- 必须回答关键字段
- 必须引用代码 / 测试 / 日志证据
```

## 3. Traceability Matrix 是核心

要校验需求、设计、开发、测试是否对齐，必须建立可追踪链。

Requirement 示例：

```yaml
id: REQ-001
title: 用户可以导出订单 CSV
success_criteria:
  - id: SC-001
    text: 用户可从订单列表导出当前筛选结果
  - id: SC-002
    text: CSV 金额字段必须显示为元，保留两位小数
  - id: SC-003
    text: 超过 5000 条记录时走异步导出
```

Design 必须引用：

```yaml
implements:
  - SC-001
  - SC-002
  - SC-003
```

Implementation checklist 必须引用：

```yaml
steps:
  - id: IMPL-001
    covers: [SC-001]
    files:
      - src/features/orders/export.ts
```

Test plan 必须引用：

```yaml
tests:
  - id: TEST-001
    covers: [SC-001, SC-002]
    command: pnpm test orders-export
    files:
      - tests/orders-export.test.ts
```

Acceptance 必须引用：

```yaml
acceptance:
  - criterion: SC-001
    status: pass
    evidence:
      - test: TEST-001
      - file: src/features/orders/export.ts
```

脚本就能检查：

```text
每个 SC 是否被 design 覆盖？
每个 SC 是否有 implementation step？
每个 SC 是否有 test？
每个 SC 是否有 acceptance evidence？
```

## 4. Gate Engine 的位置

Gate Engine 运行在 workflow 阶段边界。

```text
Requirement Draft
  ↓ requirement_quality_gate
Design Draft
  ↓ design_alignment_gate
Implementation Diff
  ↓ implementation_scope_gate
Test Result
  ↓ test_coverage_gate
Acceptance Report
  ↓ acceptance_traceability_gate
Merge
  ↓ release_readiness_gate
```

Agent 不能绕过 Gate。

## 5. Gate 规则类型

### Schema Rules

验证结构完整性。

```text
requirement 必须有：
- title
- problem
- user_story
- success_criteria[]
- non_goals[]
- assumptions[]
```

适合 JSON Schema / YAML Schema。

### Traceability Rules

验证链路对齐。

```text
- 每个 success criterion 必须被 design 覆盖
- 每个 design decision 必须有 rationale
- 每个 checklist step 必须引用至少一个 criterion
- 每个 criterion 必须至少有一个 test 或人工验收项
```

### Evidence Rules

验证结论是否有证据。

```text
- acceptance pass 必须引用 test result / diff / screenshot / log
- bug root cause 必须引用代码位置或日志证据
- design 里的现有系统行为必须引用代码或文档
```

### Runtime Rules

验证真实执行结果。

```text
- lint passed
- typecheck passed
- unit tests passed
- build passed
- migration dry-run passed
- e2e passed
- coverage threshold met
```

## 6. Rule Registry

规则需要统一管理。

建议结构：

```text
quality/
├── rules/
│   ├── requirement.yaml
│   ├── design.yaml
│   ├── implementation.yaml
│   ├── test.yaml
│   ├── acceptance.yaml
│   └── release.yaml
├── schemas/
│   ├── requirement.schema.json
│   ├── design.schema.json
│   ├── test-plan.schema.json
│   └── acceptance.schema.json
└── scripts/
    ├── gate-runner.ts
    ├── traceability-check.ts
    ├── diff-scope-check.ts
    └── test-result-check.ts
```

规则优先级：

```text
workflow override > project > org > platform default
```

## 7. Rule DSL 建议

不要一开始做复杂 DSL。先用 YAML + 内置 rule types。

示例规则：

```yaml
- id: design-alignment
  type: traceability
  every: requirement.success_criteria[*].id
  must_be_in: design.implements[*]
- id: implementation-scope
  type: diff_scope
  allowed_files_from: design.allowed_files
  actual_files_from: git.diff.files
- id: acceptance-evidence-required
  type: evidence
  every: acceptance.items[*]
  require_any: [evidence.tests, evidence.screenshots, evidence.logs, evidence.human_confirmation]
```

## 8. Gate Runner 输出格式

Gate 必须输出结构化结果。

```ts
type GateResult = { gateId: string; status: 'pass' | 'warn' | 'fail'; stage: string; summary: string; checks: GateCheckResult[] }
type GateCheckResult = { ruleId: string; status: 'pass' | 'warn' | 'fail'; severity: 'info' | 'warn' | 'error' | 'blocker'; message: string; evidenceRefs?: EvidenceRef[]; remediation?: string }
```

失败示例应包含：缺失的 requirement / criterion ID、失败原因、证据引用、remediation 建议。

## 9. Gate UI 展示

不要只显示失败，要显示可操作原因。

示例：

```text
Gate: Design Alignment / Failed
- SC-003 没有被 design 覆盖：Requirement 要求 >5000 条异步导出，Design 未提及。建议补设计或人工确认移出范围。
```

用户可选择：让 AI 修复 design、人工确认移出 scope、终止 workflow。

---

续篇：`2026-05-01-ai-native-platform-quality-gate-rules-notes.md`。

---

相关：`2026-05-01-ai-native-platform-gate-responsibility-matrix-notes.md`。

---

相关：`2026-05-01-ai-native-platform-runtime-configuration-notes.md`。

---

相关：`2026-05-01-ai-native-platform-java-maven-build-gate-notes.md`。

---

相关：`2026-05-01-ai-native-platform-completion-report-knowledge-capture-notes.md`。
