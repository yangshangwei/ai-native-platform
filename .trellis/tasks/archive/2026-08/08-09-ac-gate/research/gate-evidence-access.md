# Research: Gate Evidence Access and Transmission Surface

- **Query**: 确认 api gate 在评估 business acceptance matrix 时能否拿到执行证据，以及 per-criterion 结论如何到达 web
- **Scope**: internal (gate-engine.ts, projection.ts, artifact.ts, store.ts)
- **Date**: 2026-08-09

---

## Findings

### 1. Evidence Accessibility (store 字段清单)

**`evaluateBusinessAcceptanceMatrix` 函数的可访问字段**：

该函数位于 `apps/api/src/gate-engine.ts:1628-1655`，函数签名为：

```typescript
function evaluateBusinessAcceptanceMatrix(
  matrix: { acceptanceCriteria: ParsedVerifierCriterion[] } | null,
): { criteria: ParsedVerifierCriterion[]; failed: string[]; atRisk: string[] }
```

**当前访问限制**：
- 函数**仅接收** `matrix` 参数（从 verifier AC matrix artifact 解析而来）
- 函数**无法直接访问** `store` 对象
- 函数**无法访问**：
  - `store.testRuns`（测试运行记录）
  - `store.buildRuns`（构建运行记录）
  - `store.gateRuns`（历史 gate 结论，如 compile_gate、test_gate）
  - `store.artifacts`（其他执行证据 artifacts）

**调用上下文可访问的字段** (`runAcceptanceTraceabilityGate` at line 687-896)：
- `store.artifacts.byKind(workflowRunId, 'requirement_draft')`
- `store.artifacts.byKind(workflowRunId, 'design_doc')`
- `store.artifacts.byKind(workflowRunId, 'diff')`
- `store.gateRuns.latestForGate(workflowRunId, 'test_gate')` ← **关键：test gate 结论**
- `store.stepRuns.byWorkflow(workflowRunId)`
- Matrix artifact 及其包含的 `criterion.evidenceRefs`

**关键观察**：
- `testGate` 变量在 line 695 已获取，但**未传递**给 `evaluateBusinessAcceptanceMatrix`
- Compile gate 结论**未在此处获取**（但可通过 `store.gateRuns.latestForGate(workflowRunId, 'compile_gate')` 获取）

---

### 2. 判据实现方案

**当前判据** (line 1635-1654):

```typescript
for (const criterion of criteria) {
  const hasEvidence = criterion.evidenceRefs.length > 0;
  const passedStatus = criterion.businessStatusDeclared
    ? criterion.businessStatus === 'passed'
    : criterion.status === 'pass';
  const passed = passedStatus
    && hasEvidence
    && !isCommandOnlyText(`${criterion.text ?? ''} ${criterion.verificationMethod ?? ''}`);
  const risk = criterion.businessStatusDeclared
    && criterion.businessStatus === 'at_risk'
    && hasEvidence;
  if (passed) continue;
  if (risk) {
    atRisk.push(criterion.id);
    continue;
  }
  failed.push(criterion.id);
}
```

**当前逻辑**：
1. 检查 `evidenceRefs.length > 0`（verifier 上传的 media artifacts）
2. 检查 `businessStatus === 'passed'` 或 `status === 'pass'`
3. 排除纯命令行文本（`isCommandOnlyText` 过滤器）
4. `at_risk` = 显式声明 `businessStatus: 'at_risk'` 且有 evidence

**Web 侧期望的判据** (`apps/web/src/projection.ts:1493-1502`):

```typescript
let status: AcceptanceChecklistItem['status'] = 'missing';
let risk: string | null = null;
if (covered && compileGate?.status === 'pass' && testGate?.status === 'pass' && hasPassingTests) {
  status = 'passed';
} else if (covered || compileGate?.status === 'pass' || testGate?.status === 'pass') {
  status = 'at_risk';
  risk = 'Evidence is partial; confirm risk before completion.';
} else {
  risk = 'No implementation/test evidence found yet.';
}
```

**Web 判据的三要素**：
1. `covered` = Design coverage matrix 覆盖
2. `compileGate.status === 'pass'`
3. `testGate.status === 'pass'` + `hasPassingTests`

**差距分析**：
- Gate 当前**不检查** compile/test gate pass 状态
- Gate 当前**不检查** 实际通过的测试（`hasPassingTests`）
- Gate **仅依赖** verifier 上传的 `evidenceRefs`（media artifacts）

**建议的增强判据实现**（伪码）：

```typescript
function evaluateBusinessAcceptanceMatrix(
  matrix: { acceptanceCriteria: ParsedVerifierCriterion[] } | null,
  context: {
    compileGate: GateRun | null;
    testGate: GateRun | null;
    hasPassingTests: boolean;
  }
): { criteria: ParsedVerifierCriterion[]; failed: string[]; atRisk: string[] } {
  const criteria = matrix?.acceptanceCriteria ?? [];
  const failed: string[] = [];
  const atRisk: string[] = [];

  for (const criterion of criteria) {
    const hasVerifierEvidence = criterion.evidenceRefs.length > 0;
    const hasExecutionEvidence = 
      context.compileGate?.status === 'pass' 
      && context.testGate?.status === 'pass' 
      && context.hasPassingTests;
    
    const passedStatus = criterion.businessStatusDeclared
      ? criterion.businessStatus === 'passed'
      : criterion.status === 'pass';
    
    const passed = passedStatus
      && (hasVerifierEvidence || hasExecutionEvidence)
      && !isCommandOnlyText(`${criterion.text ?? ''} ${criterion.verificationMethod ?? ''}`);
    
    const risk = (criterion.businessStatusDeclared && criterion.businessStatus === 'at_risk')
      || (hasVerifierEvidence && !hasExecutionEvidence)
      || (!hasVerifierEvidence && hasExecutionEvidence);
    
    if (passed) continue;
    if (risk) {
      atRisk.push(criterion.id);
      continue;
    }
    failed.push(criterion.id);
  }

  return { criteria, failed, atRisk };
}
```

---

### 3. 传输面现状

**Per-criterion 结论的传输路径**：

**A. Gate 输出结构** (`apps/api/src/gate-engine.ts:858-876`):

```typescript
{
  ruleId: 'acceptance.business_matrix_criteria_proven',
  status: !matrixRequired
    ? 'pass'
    : matrixEvaluation.failed.length > 0 || matrixEvaluation.criteria.length === 0
      ? 'fail'
      : matrixEvaluation.atRisk.length > 0
        ? 'warn'
        : 'pass',
  message: /* ... */,
  evidenceRefs: matrixEvaluation.criteria.flatMap((criterion) => criterion.evidenceRefs),
}
```

**关键发现**：
- `matrixEvaluation.failed` 和 `matrixEvaluation.atRisk` 仅用于聚合 gate status（pass/warn/fail）
- **Per-criterion 的 `at_risk` 状态未传递给 web**
- `evidenceRefs` 是扁平化的所有 criterion 的 evidence（无法区分哪个 AC 对应哪个 evidence）

**B. Matrix Artifact 结构** (`packages/shared/src/types/artifact.ts:329-337`):

```typescript
export interface VerifierAcceptanceCriterionEvidence {
  id: string;
  text?: string;
  scenarioType?: AcceptanceScenarioType;
  verificationMethod?: string;
  businessStatus?: AcceptanceBusinessStatus;  // ← 'passed' | 'missing' | 'at_risk' | 'failed'
  risk?: string | null;
  riskAccepted?: boolean;
  status: VerifierStatus;  // ← 'pass' | 'fail' | 'blocked'
  evidenceRefs: VerifierEvidenceRef[];
  notes?: string;
}
```

**关键发现**：
- Matrix artifact **已有** `businessStatus` 字段（可表达 `at_risk`）
- Gate 的 `evaluateBusinessAcceptanceMatrix` **已读取**此字段
- 但 gate rule result **未将 per-criterion 状态传回 web**

**C. Web 消费路径**：

Web 通过以下方式获取 AC 状态：
1. 读取 requirement artifact 的 AC 列表
2. 读取 design coverage matrix
3. 读取 compile/test gate 结论
4. **本地计算**每个 AC 的 status（`apps/web/src/projection.ts:1485-1504`）

**当前 web 不读取**：
- Matrix artifact 的 per-criterion `businessStatus`
- Gate rule result 的 per-criterion 细节

**是否需要新增传输字段**：

**选项 A：增强 Gate Rule Result**（推荐）

在 `RuleResult` 中新增 `metadata` 字段：

```typescript
{
  ruleId: 'acceptance.business_matrix_criteria_proven',
  status: 'warn',
  message: '...',
  evidenceRefs: [...],
  metadata: {
    criteriaStatus: [
      { id: 'AC-001', status: 'passed', evidenceRefs: [...] },
      { id: 'AC-002', status: 'at_risk', evidenceRefs: [...], risk: '...' },
      { id: 'AC-003', status: 'failed', evidenceRefs: [] },
    ]
  }
}
```

**选项 B：Web 直接读 Matrix Artifact**（更简单）

Web 已经有访问 artifacts 的能力，可以：
1. 定位 verifier AC matrix artifact（通过 `metadata.schemaVersion` 或 `reportKind`）
2. 解析其中的 `acceptanceCriteria` 数组
3. 读取每个 criterion 的 `businessStatus` 和 `evidenceRefs`

这样**无需修改 gate 输出**，只需增强 web projection 逻辑。

---

### 4. 改动点清单

**如果采用选项 A（Gate 增强）**：

1. **`apps/api/src/gate-engine.ts:1628-1655`**
   - 修改 `evaluateBusinessAcceptanceMatrix` 函数签名，接收 `context: { compileGate, testGate, hasPassingTests }`
   - 返回值增加 per-criterion 的详细状态：`{ criteria: Array<{ id, status, evidenceRefs, risk }>, ... }`

2. **`apps/api/src/gate-engine.ts:715`**
   - 调用 `evaluateBusinessAcceptanceMatrix` 时传入 context
   - 获取 `compileGate = store.gateRuns.latestForGate(workflowRunId, 'compile_gate')`
   - 计算 `hasPassingTests` 逻辑（需访问 `store.testRuns` 或 surefire aggregate）

3. **`apps/api/src/gate-engine.ts:858-876`**
   - Rule result 增加 `metadata.criteriaStatus` 字段

4. **`packages/shared/src/types/gate.ts:30-35`**
   - `RuleResult` 接口增加 `metadata?: Record<string, unknown>` 字段

5. **`apps/web/src/projection.ts:1472-1504`**
   - 读取 gate rule result 的 `metadata.criteriaStatus`
   - 合并 gate 判定与本地计算的结果

**如果采用选项 B（Web 读 Artifact）**：

1. **`apps/web/src/projection.ts:1472-1504`**
   - 新增：从 artifacts 中查找 verifier AC matrix artifact
   - 新增：解析 matrix.acceptanceCriteria
   - 合并：matrix 中的 `businessStatus` 与本地 compile/test gate 判据

**波及面**：
- 选项 A：修改 2 个 package（api、shared），影响 gate-engine 核心逻辑，需同步更新 gate result 消费方
- 选项 B：仅修改 1 个文件（web projection），隔离度高，但 web 需要理解 matrix artifact 结构

---

## Related Specs

- `.trellis/spec/runner/backend/08-06-acceptance-gate.md` — Acceptance gate 设计文档
- `.trellis/spec/api/verifier-ac-matrix.md` — Verifier AC matrix artifact schema

---

## Caveats / Not Found

1. **`hasPassingTests` 计算逻辑未明确**：
   - Web projection 中有 `hasPassingTests`，但其来源未在本次研究中追溯
   - 需进一步确认是读取 `store.testRuns` 还是 surefire aggregate

2. **Design coverage matrix 数据未研究**：
   - Web 判据中的 `covered` 依赖 design coverage matrix
   - Gate 当前不检查此数据
   - 如需 gate 也检查 coverage，需传入 design artifact

3. **执行证据与 verifier evidence 的优先级未定义**：
   - 当两者冲突时（verifier 说 pass 但测试 fail，或反之），应以哪个为准？
   - 建议：compile/test gate 作为 必要条件，verifier 作为 充分条件
