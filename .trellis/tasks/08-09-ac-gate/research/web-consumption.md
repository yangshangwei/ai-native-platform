# Research: Web Consumption Path & Fallback Impact

- **Query**: 研究 web 消费路径与兜底影响面
- **Scope**: internal
- **Date**: 2026-08-09

---

## 1. 两处调用点的 UI 场景说明

### 调用点 1: `page-task-detail.ts:2059` — 验收面板主视图

**上下文**：
```typescript
function renderAcceptancePanel(detail: RunDetail): HTMLElement {
  const req = parsedRequirement(detail);
  const design = parsedDesign(detail);
  const checklist = acceptanceMatrixChecklist(detail) ?? buildAcceptanceChecklist(req, design, detail);
  // ...
  return el('article', {
    class: 'panel doc-panel structured-panel',
    children: [
      panelHeader('验收确认', 'AC 覆盖、测试证据与风险确认'),
      checklist.length
        ? renderAcceptanceChecklist(checklist)
        : el('p', { class: 'muted', text: '暂无 AC checklist。' }),
      verdict ? renderReviewVerdict(verdict) : null,
```

**场景**：任务详情页的"验收确认"主面板，显示完整的验收清单（所有 AC 项、状态、证据、风险）。

---

### 调用点 2: `page-task-detail.ts:2524` — Checkpoint 卡片预览

**上下文**：
```typescript
if (gateId === 'acceptance_gate') {
  const req = parsedRequirement(detail);
  const design = parsedDesign(detail);
  const checklist = acceptanceMatrixChecklist(detail) ?? buildAcceptanceChecklist(req, design, detail);
  const passedCount = checklist.filter(ac => ac.status === 'passed').length;
  const totalCount = checklist.length;

  if (totalCount === 0) {
    return el('p', { class: 'muted compact', text: '验收报告正在生成中...' });
  }

  return el('details', {
    class: 'checkpoint-doc-preview',
    attrs: { open: 'true' },
    children: [
      el('summary', { text: `📄 查看验收报告 (${passedCount}/${totalCount} 通过)` }),
      el('div', {
        class: 'checkpoint-doc-content',
        children: [
          renderAcceptanceChecklist(checklist, 8),
          totalCount > 8 ? el('p', { class: 'muted compact', text: `还有 ${totalCount - 8} 项验收标准，查看主面板了解详情。` }) : null,
```

**场景**：任务详情页顶部的 `acceptance_gate` checkpoint 卡片，折叠预览前 8 条验收项，显示通过率摘要 `(passedCount/totalCount 通过)`。

---

## 2. 当前执行证据判据逻辑

**代码位置**：`projection.ts:1472-1504`

```typescript
export function buildAcceptanceChecklist(
  requirement: RequirementDoc,
  design: DesignDoc,
  detail: RunDetail,
): AcceptanceChecklistItem[] {
  const compileGate = latestGate(detail, 'compile_gate');
  const testGate = latestGate(detail, 'test_gate');
  const acceptanceGate = latestGate(detail, 'acceptance_gate');
  const hasPassingTests = detail.tests.some((t) => t.total > 0 && t.failed === 0 && t.errors === 0);
  const approvedAcceptance = detail.approvals.some(
    (a) => a.gateId === 'acceptance_gate' && a.decision === 'approved',
  );

  return requirement.acceptanceCriteria.map((ac) => {
    const covered = design.coverage.some((row) => row.acceptanceCriteria.includes(ac.id));
    const evidence: string[] = [];
    if (covered) evidence.push('Design coverage matrix');
    if (compileGate?.status === 'pass') evidence.push('compile_gate=pass');
    if (testGate?.status === 'pass' && hasPassingTests) evidence.push('test_gate=pass');
    if (acceptanceGate?.status === 'pass' || approvedAcceptance) evidence.push('acceptance approved');

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
    return { id: ac.id, text: ac.text, status, evidence, risk };
  });
}
```

**判据逻辑摘要**：
1. **证据收集**：
   - Design coverage matrix（design.coverage 包含此 AC）
   - compile_gate=pass
   - test_gate=pass + hasPassingTests（有测试且全部通过）
   - acceptance_gate=pass 或人工批准

2. **状态决策**：
   - `passed`：覆盖 + compile pass + test pass + 有通过测试
   - `at_risk`：部分证据存在（覆盖 OR compile pass OR test pass）
   - `missing`：无任何证据

3. **风险标注**：
   - `at_risk` → `'Evidence is partial; confirm risk before completion.'`
   - `missing` → `'No implementation/test evidence found yet.'`

---

## 3. 改为透传后的删减方案

**现状**：
- `acceptanceMatrixChecklist(detail)` 从 verifier 产出的 `ac_matrix` artifact 反序列化得到 checklist
- 若 artifact 不存在或解析失败，回退到 `buildAcceptanceChecklist(req, design, detail)` 构造兜底数据

**改为透传后**：
- gate 已经产出 `at_risk` 的 matrix artifact，包含完整的 `businessStatus`、`evidenceRefs`、`risk`
- web 侧不再需要自行推导 status/evidence/risk

**保留**：
```typescript
export function buildAcceptanceChecklist(
  requirement: RequirementDoc,
  design: DesignDoc,
  detail: RunDetail,
): AcceptanceChecklistItem[] {
  return requirement.acceptanceCriteria.map((ac) => ({
    id: ac.id,
    text: ac.text,
    status: 'missing',
    evidence: [],
    risk: 'Acceptance matrix not available; gate execution pending.',
  }));
}
```

**删除**：
- L1477-1482：所有 gate 查询逻辑（`compileGate`, `testGate`, `acceptanceGate`, `hasPassingTests`, `approvedAcceptance`）
- L1485-1491：证据收集逻辑（`covered`, `evidence.push(...)`）
- L1493-1502：status/risk 决策逻辑（三分支条件）

**保留的功能**：
- 从 `requirement.acceptanceCriteria` 遍历生成 checklist 结构
- 返回统一的兜底状态：`status: 'missing'`, `evidence: []`, `risk: '<兜底提示>'`

---

## 4. 兜底场景 UX 建议

### 场景 A：Matrix artifact 不存在（gate 未执行 / 尚未产出）

**当前行为**：
- `acceptanceMatrixChecklist(detail)` 返回 `null`
- 回退到 `buildAcceptanceChecklist` 构造伪数据（根据 compile/test gate 推导 status）

**建议改为**：
- 显示空状态占位符，明确提示用户 gate 尚未完成
- **主面板**（调用点 1）：
  ```
  ⏳ 验收报告生成中
  Acceptance gate 正在执行，稍后刷新查看完整验收矩阵。
  ```
- **Checkpoint 卡片**（调用点 2）：
  ```
  验收报告正在生成中...（已有此逻辑，totalCount === 0 时显示）
  ```

---

### 场景 B：Matrix artifact 加载失败（JSON 解析异常 / 网络超时）

**当前行为**：
- `acceptanceMatrixChecklist` 的 `try-catch` 捕获解析错误，返回 `null`
- 同样回退到 `buildAcceptanceChecklist`

**建议改为**：
- 显示降级提示，告知用户数据不可用
- **主面板**（调用点 1）：
  ```
  ⚠️ 无法加载验收报告
  验收矩阵数据解析失败，请联系管理员或重新执行 acceptance_gate。
  ```
- **Checkpoint 卡片**（调用点 2）：
  ```
  ⚠️ 验收报告加载失败
  ```

**实现方式**：
- 在 `acceptanceMatrixChecklist` 内部区分两种 `null` 返回原因：
  - `!artifact` → 场景 A（未产出）
  - `!text` → 场景 B（加载失败）
  - `catch` → 场景 B（解析失败）
- 或者将 `buildAcceptanceChecklist` 改为接收一个 `reason: 'pending' | 'error'` 参数，返回不同的 `risk` 文案

---

## 5. 类型合并波及文件清单

**目标**：将 `AcceptanceChecklistItem['status']` 的内联 union 改为引用 shared 的 `AcceptanceBusinessStatus`

**当前定义**：
```typescript
// apps/web/src/projection.ts:1216-1224
export interface AcceptanceChecklistItem {
  id: string;
  text: string;
  status: 'passed' | 'at_risk' | 'missing' | 'failed';  // ← 内联 union
  scenarioType?: string;
  verificationMethod?: string;
  evidence: string[];
  risk: string | null;
}
```

**Shared 定义**：
```typescript
// packages/shared/src/types/artifact.ts:310
export type AcceptanceBusinessStatus = 'passed' | 'missing' | 'at_risk' | 'failed';
```

**波及文件**：

| 文件 | 行号 | 用法 | 改动内容 |
|------|------|------|----------|
| `apps/web/src/projection.ts` | 1219 | 类型定义 | 改为 `status: AcceptanceBusinessStatus` |
| `apps/web/src/projection.ts` | 1493 | 局部变量类型标注 | 改为 `let status: AcceptanceBusinessStatus = 'missing';` |
| `apps/web/src/page-task-detail.ts` | 2255 | 函数返回类型 | 改为 `): AcceptanceBusinessStatus {` |
| `apps/web/src/page-task-detail.ts` | 2272 | 函数参数类型 | 改为 `(status: AcceptanceBusinessStatus): { ... }` |
| `apps/web/src/page-task-detail.ts` | 顶部 import | 新增导入 | `import type { AcceptanceBusinessStatus } from '@acme/shared';` |

**文件清单**：
1. `apps/web/src/projection.ts` — 2 处修改 + 1 处新增导入
2. `apps/web/src/page-task-detail.ts` — 2 处修改 + 1 处新增导入

---

## Caveats / Not Found

1. **`acceptanceMatrixChecklist` 的 artifact 筛选逻辑**：当前同时匹配三个 metadata 字段（`schemaVersion`, `reportKind`, `verifierArtifactType`），若 gate 产出的 artifact metadata 不符合任一条件，会导致"artifact 不存在"兜底。
   
2. **`renderAcceptanceChecklist` 的限制参数**：checkpoint 卡片只显示前 8 条（`renderAcceptanceChecklist(checklist, 8)`），若 AC 总数 > 8 会截断并提示"还有 N 项验收标准，查看主面板了解详情"。改为透传后此逻辑不受影响。

3. **`acceptanceRowStatus` 的向后兼容**：当前同时处理 `businessStatus` 和 `legacyStatus`（旧字段），若 gate 只产出 `businessStatus`，旧字段兜底逻辑可移除。

4. **`buildAcceptanceChecklist` 的删除时机**：若完全改为透传且所有历史 run 都已产出 matrix artifact，可考虑删除此函数；但若需保留兜底能力（应对 artifact 加载失败场景），应保留简化版。
