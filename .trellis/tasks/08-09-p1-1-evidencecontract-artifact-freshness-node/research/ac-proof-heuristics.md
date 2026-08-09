# Research: AC proof 的启发式到底有多松

- **Query**: 读 `gate-engine.ts` 的 proven 判定和 runner 的 `businessAcceptanceStatus`。一个 AC 在什么条件下会被判成 passed？最松的路径是什么？`businessAcceptanceEvidenceRefs` 把 requirement.md / design.md / diff / review.md 绑给每一条 AC 意味着什么？
- **Scope**: internal
- **Date**: 2026-08-09

## 速答

一条 AC 判成 passed 的**充要条件是「design.md 里那一行字够长且不像命令」**。全链路没有任何一步把某条 AC 与某个具体的 command run / test case / 断言关联起来。

而且发现一个直接违反「单一判定原则」的事实：**同一个「这段文字是不是只是个命令」的判定存在两份逐字符相同的拷贝**，分处 api 和 runner 两个包。

## Findings

### 写侧：runner 如何决定 businessStatus

`apps/runner/src/orchestrator/steps.ts:817-830`：

```ts
function businessAcceptanceStatus(input: {
  text: string | undefined;
  verificationMethod: string | undefined;
  uiVerifierRequired: boolean;
  mediaSatisfied: boolean;
}): AcceptanceBusinessStatus {
  if (
    !input.text
    || !input.verificationMethod
    || commandOnlyVerifierText(input.verificationMethod)
  ) return 'missing';
  if (input.uiVerifierRequired && !input.mediaSatisfied) return 'missing';
  return 'passed';
}
```

三个输入的来源（已验证）：

- `text` ← `acceptanceCriterionText`（`steps.ts:779-788`）：在 `requirement.json` / `requirement.md` / `design.md` / `user_request` 里正则找 `\bAC-001\b\s*[:：-]?\s*(.+)`，取后半行前 500 字。
- `verificationMethod` ← `verificationMethodForCriterion`（`steps.ts:790-815`）：在 `design.md` 里找含该 AC id 的 markdown 表格行，取**第 4 个单元格**（`cells[3] ?? cells.at(-1)`）；找不到表格就退化成从声明行往下抓文本块。
- `mediaSatisfied` 只在 UI 任务（标题正则命中）时才起约束。

**关键**：这个函数**不读任何执行结果**。不看 test gate、不看 CommandRun、不看 diff 内容、不看 exit code。它只读 markdown 文本。

`commandOnlyVerifierText`（`steps.ts:869-880`）剥掉命令词、剥掉中文通用词、剥掉 `AC-###`，剩下**长度 ≥ 8** 就算「不是命令」。

### 读侧：gate 如何复核

`apps/api/src/gate-engine.ts:1584-1611`：

```ts
for (const criterion of criteria) {
  const hasEvidence = criterion.evidenceRefs.length > 0;
  const passedStatus = criterion.businessStatusDeclared
    ? criterion.businessStatus === 'passed'
    : criterion.status === 'pass';
  const passed = passedStatus
    && hasEvidence
    && !isCommandOnlyText(`${criterion.text ?? ''} ${criterion.verificationMethod ?? ''}`);
```

结果喂给规则 `acceptance.business_matrix_criteria_proven`（`gate-engine.ts:844-863`）。

三个合取项逐一看：

| 合取项 | 实际强度 |
|---|---|
| `passedStatus` | runner 总是显式写 `businessStatus`，所以走 `businessStatus === 'passed'` 分支 —— 即**完全采信 runner 的文本判定** |
| `hasEvidence` | 只要 `evidenceRefs.length > 0`。见下节，这个几乎恒真 |
| `!isCommandOnlyText(...)` | 与 runner 端**同一个判定的第二份拷贝**，只是拼上了 `text` 一起判，比 runner 端更松（更多字符 → 更不容易被判成 command-only） |

### 重复判定：两份逐字符相同的代码

已验证（`diff` 两段源码，唯一差异是函数名那一行）：

- `apps/api/src/gate-engine.ts:498-509` — `isCommandOnlyText`
- `apps/runner/src/orchestrator/steps.ts:869-880` — `commandOnlyVerifierText`

正则、替换顺序、阈值 `< 8` 全部一致。这是跨包复制粘贴，任何一侧改动都会让写侧和读侧对「什么算命令」产生分歧 —— 正是 `deriveGraphRunStatus` / `parseReviewerVerdict` 那条纪律要消除的形态。

### evidenceRefs 的绑定意味着什么

`apps/runner/src/orchestrator/steps.ts:832-844`：

```ts
function businessAcceptanceEvidenceRefs(c: RunCtx, id: string) {
  for (const [inputName, claim] of [
    ['requirement.md', `requirement business criterion ${id}`],
    ['design.md', `design verification strategy for ${id}`],
    ['diff', `implementation diff relevant to ${id}`],
    ['review.md', `review evidence for ${id}`],
  ] as const) {
    const artifactId = c.inputArtifactIds[inputName];
    if (artifactId) refs.push({ artifactId, claim });
  }
}
```

含义（已验证）：

1. **每条 AC 拿到的是完全相同的 4 个 artifact id**。AC-001 和 AC-007 的 evidenceRefs 一模一样。
2. `claim` 里的 `${id}` 制造了**特异性的假象** —— 字符串写着 "implementation diff relevant to AC-007"，但它就是整个 run 的那一份 diff，没有任何裁剪或定位。
3. 因此 `hasEvidence` 这个合取项**对区分 AC 之间的强弱毫无作用**：只要这个 run 走到了 review 阶段（diff 和 review.md 都在），所有 AC 的 `hasEvidence` 同时为真。
4. 一旦有任一 AC 的证据存在，就没有任何 AC 会因为「缺证据」而 fail。

### 最松的通过路径（已验证的完整链条）

在 `design.md` 里写一行 markdown 表格：

```
| AC-001 | 用户能登录 | 手动 | 打开登录页输入账号密码后跳转到首页并显示欢迎语 |
```

然后：

1. `acceptanceCriterionText` 从 requirement 抓到 "用户能登录" → `text` 非空 ✓
2. `verificationMethodForCriterion` 取 `cells[3]` = "打开登录页输入账号密码后跳转到首页并显示欢迎语" → 非空 ✓
3. `commandOnlyVerifierText`：剥掉通用词后剩余远超 8 字符 → 不是 command-only ✓
4. 非 UI 任务 → 不要求 media ✓
5. → `businessStatus = 'passed'`
6. gate 侧 `passedStatus` ✓、`hasEvidence` ✓（diff 存在）、`!isCommandOnlyText` ✓
7. → 规则 `acceptance.business_matrix_criteria_proven` 判 **pass**

**全程没有任何一行代码验证登录功能是否真的被实现过。** 这条 AC 的「证据」是 design.md 里的一句话，加上整个 run 的通用 diff。

### 边界：确实拦得住的情况

公平起见，以下会被拦（已验证）：

- verificationMethod 写成 `mvn test` → command-only → `missing` → gate fail
- design.md 里根本没提到该 AC → verificationMethod 为 undefined → `missing`
- 标题命中 UI 正则（`gate-engine.ts:1497`）但没有 before+after 截图或视频 → `missing`
- requirement 里的 AC 没出现在 matrix 里 → 另一条规则 `acceptance.business_matrix_criteria_reconciled`（`gate-engine.ts:826-843`）会 fail
- scenario type 覆盖不全（缺 core/boundary/exception）→ `acceptance.business_matrix_scenarios_present` fail（`gate-engine.ts:864-879`）

所以现有机制拦的是**「文档没写」**，拦不住**「文档写了但代码没做」**。

## Caveats / Not Found

- `verificationMethodForCriterion` 取 `cells[3]` 是硬编码列序。若 design.md 表格列顺序不同，取到的会是别的列的内容 —— 未验证 spec 是否强制列序，建议 P1-1 若动这块先查 `.trellis/spec` 的 design.md 模板约定。
- `acceptanceScenarioType`（`steps.ts:846-851`）同样是纯文本正则分类，未纳入本次深挖。
- 未验证 `businessStatus === 'at_risk'` 的产生路径 —— `businessAcceptanceStatus` 只返回 `'missing'` 或 `'passed'`，从不返回 `'at_risk'` / `'failed'`。gate 侧 `evaluateBusinessAcceptanceMatrix` 有 `at_risk` 分支（`gate-engine.ts:1599-1601`）但**当前 runner 写不出这个值**，疑似另一处「声明了没有执行方」，建议 P1-1 顺带确认。
