# AI Native 云开发平台：具体 Quality Gate 规则与实现讨论记录

日期：2026-05-01

## 10. Requirement Gate

脚本不能直接判断“需求是否真的清楚”，但可以检查清晰需求所需结构。

规则：

```text
- 必须有 problem statement
- 必须有 target user
- 必须有 success criteria
- 每条 success criteria 必须可验证
- 必须有 non-goals
- 必须有 assumptions 或 unanswered_questions
- unanswered question 必须标记 blocking / non-blocking
```

可验证性启发规则：

```yaml
id: success-criteria-verifiable
stage: requirement
type: heuristic
severity: warn
check:
  field: success_criteria[*].text
  disallow_phrases:
    - 更好
    - 优化
    - 友好
    - 尽量
    - 合理
```

## 11. Design Gate

Design Gate 检查设计是否满足需求。

规则：

```text
- design 必须引用 requirement id
- 每个 success criterion 必须出现在 design coverage matrix
- 每个 non-goal 不得出现在 design scope
- 每个重大设计决策必须有 rationale
- 每个外部接口必须有输入 / 输出 / 错误行为
- 每个风险必须有 mitigation 或 owner
```

Coverage matrix 示例：

```yaml
coverage:
  - requirement: SC-001
    design_sections: [2.1, 3.2]
    approach: Use existing ExportButton and new /api/orders/export endpoint
```

## 12. Implementation Gate

Implementation Gate 检查开发是否与需求和设计对齐。

规则：

```text
- diff 文件必须在 design declared touch points 内
- checklist steps 必须全部 done 或 explicitly skipped
- 每个 changed file 必须对应一个 implementation step
- 不允许新增 dependency，除非 design 声明并人工批准
- 不允许改安全敏感文件，除非触发 security gate
- commit / patch summary 必须引用 checklist step id
```

关键脚本：

```text
diff-scope-check
```

输入：

```text
design.allowed_files
git.diff.files
sensitive_paths
```

输出：

```text
pass / fail
```

## 13. Test Gate

Test Gate 检查测试是否与需求一致。

规则：

```text
- 每个 success criterion 至少有一个 test 或 human verification
- 测试文件必须引用 criterion id
- 所有声明的 test command 必须真实执行并通过
- 如果 criterion 只能人工验收，必须有 human gate
- bugfix 必须有 regression test，除非人确认不可自动化
```

Test plan 示例：

```yaml
tests:
  - id: TEST-001
    covers: [SC-001]
    type: unit
    command: pnpm test orders-export
    file: tests/orders-export.test.ts
```

## 14. 防止大模型伪造结果

关键原则：

> Agent 不能自己声明 test passed。平台必须真实执行命令并记录结果。

Test result artifact 必须由 Tool Runner 写入，不由 LLM 写。

```ts
type TestRun = {
  command: string
  exitCode: number
  stdoutUri: string
  stderrUri: string
  startedAt: string
  completedAt: string
  status: 'passed' | 'failed'
}
```

LLM 可以解释测试失败，但不能伪造测试通过。

## 15. Gate 执行时机

推荐执行点：

```text
before_requirement_approval
before_design_approval
before_implementation_start
after_implementation
before_test_acceptance
before_merge
after_completion
```

对应 Gate：

```text
Requirement Quality Gate
Design Alignment Gate
Implementation Scope Gate
Test Coverage Gate
Acceptance Evidence Gate
Release Readiness Gate
Knowledge Capture Gate
```

## 16. Gate 与 Agent 的关系

Agent 可以触发 Gate，但不能跳过 Gate。

```text
Agent completes step
  ↓
Platform runs Gate
  ↓
Gate pass → proceed
Gate warn → proceed or require acknowledgement
Gate fail → route back to Agent or human
Gate blocker → stop
```

Coordinator 看到 gate failure 后可以：

```text
- route_to_agent: 让 Design Agent 补 design
- pause_for_human: 让人决定是否移出 scope
- rollback: 回到 requirement
- abort
```

## 17. MVP 规则集

第一版先做 6 个 gate。

### Requirement Gate

```text
- 有目标用户
- 有 problem
- 有 success criteria
- 有 non-goals
- 无 blocking unanswered questions
```

### Design Gate

```text
- 引用 requirement
- 覆盖所有 success criteria
- 有 touch points / allowed files
- 有 test strategy
```

### Implementation Gate

```text
- diff 不越界
- changed files 对应 checklist steps
- 没有未批准 dependency / migration / sensitive path 变化
```

### Test Gate

```text
- 每个 success criterion 有 test 或 human verification
- test command 真实运行并通过
```

### Acceptance Gate

```text
- 每个 success criterion 有 pass/fail 结果
- pass 必须有 evidence
- fail 不允许 merge
```

### Knowledge Gate

```text
- 如果产生 decision / pitfall / reusable pattern，必须生成 knowledge suggestion
- 人可选择接受 / 跳过
```

## 18. TypeScript 实现建议

目录：

```text
packages/gates/
  src/
    runner.ts
    registry.ts
    rules/
      schema-rule.ts
      traceability-rule.ts
      evidence-rule.ts
      diff-scope-rule.ts
      test-result-rule.ts
```

Rule 接口：

```ts
interface GateRule {
  id: string
  stage: WorkflowStage
  severity: Severity
  run(ctx: GateContext): Promise<GateCheckResult>
}
```

Gate Context：

```ts
type GateContext = {
  project: Project
  workflow: WorkflowRun
  artifacts: ArtifactIndex
  git: GitSnapshot
  testRuns: TestRun[]
  evidence: EvidenceIndex
}
```

## 19. 设计原则

1. LLM 产出草稿，脚本验证结构和证据。
2. LLM 可以解释失败，不能宣布通过。
3. 所有关键判断必须有 traceability。
4. Gate 结果必须结构化、可审计、可复跑。
5. 规则集中管理，项目可覆盖。
6. 越接近 merge，脚本权重越高。
7. 语义质量无法完全脚本化，但可以脚本化“必须给出证据和覆盖关系”。

最终目标：

> 让 AI 开发从“我觉得完成了”变成“每个需求项都有设计覆盖、实现证据、测试结果和验收记录”。