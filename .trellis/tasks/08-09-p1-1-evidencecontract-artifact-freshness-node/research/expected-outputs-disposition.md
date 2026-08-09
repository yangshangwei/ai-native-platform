# Research: `ExecutionContract.expectedOutputs` 的收编或删除

- **Query**: P0-3 刚加了这个字段但没有执行方（skill 声明了，无人读）。P1-1 是否应该收编它？如果收编，与 skill outputs 现有的 `required: true` 检查（走 operational pause）如何不打架？还是应该直接删掉？
- **Scope**: internal
- **Date**: 2026-08-09

## 速答

**既不收编也不删除 —— 它已经有执行方，只是执行方是测试而不是运行时，而这是 P0-3 的刻意设计。**

调研推翻了「无人读」这个前提。建议 P1-1 **不动这个字段**，只在 spec 里补一句说明它的执行方位置。理由见下。

## Findings

### `expectedOutputs` 的实际消费方（已验证）

生产代码里读 `contract.expectedOutputs` 的只有一处：

`packages/shared/src/types/execution-contract.ts:247-264` 的 `executionContractOutputConflicts()`。

而 `executionContractOutputConflicts` 的调用方（已验证，grep 全仓）：

| 调用点 | 性质 |
|---|---|
| `apps/runner/test/skill-execution-contract.test.ts:30` | **对全部 SKILLS 做静态断言** |
| `packages/shared/test/execution-contract.test.ts:258,266,282,291` | 单元测试 |

运行时零调用 —— 这点团队 lead 的判断是对的。但**这不等于「无人读」**。

### 为什么测试就是它的正确执行方

`apps/runner/test/skill-execution-contract.test.ts:27-35`：

```ts
describe('shipped skill execution contracts', () => {
  test('every declared contract agrees with the skill outputs', () => {
    for (const skill of SKILLS) {
      expect({ id: skill.id, conflicts: executionContractOutputConflicts(skill) }).toEqual({
        id: skill.id, conflicts: [],
      });
    }
  });
```

这个断言在 CI 每次跑，覆盖**全部** shipped skill。任何人往 skill 里加一个 `required: true` 的 output 而忘了同步 `expectedOutputs`，或者往 `expectedOutputs` 里写一个不存在的 output 名，**构建就红**。

`executionContractOutputConflicts` 检查的两个方向（`execution-contract.ts:256-263`）：

- `expected_output_not_declared` — contract 说要产出 X，但 skill 的 outputs 里没有 X（写了个幽灵）
- `required_output_not_expected` — skill 声明 X 是 required，但 contract 没把它列进 expectedOutputs（两份声明漂移）

这是**编译期/CI 期的一致性约束**，不是运行时检查。对于「两份声明不许漂移」这类需求，CI 断言比运行时检查更合适 —— 它在问题进入生产之前就拦住。

### P0-3 已经明确写下了这个设计决定

`packages/shared/src/types/execution-contract.ts:236-246` 的函数注释（原文）：

> Cross-check `expectedOutputs` against the skill's own output declarations.
> Returns nothing for a skill that declares no contract — there is no second
> declaration to disagree with.
>
> "Missing required output" is already enforced by the backends via
> `SkillIO.required`, and 07-26 deliberately classifies it as an operational
> pause rather than a business failure. So this task does NOT add a second
> runtime check that would reclassify it — it keeps the two declarations from
> drifting apart, which is exactly what R3 asks for.

测试文件头部（`skill-execution-contract.test.ts:1-10`）重复了同一件事：

> R3's "did too little" half is already enforced by `SkillIO.required` (and
> 07-26 deliberately classifies a missing required output as an operational
> pause, not a business failure). What this file fixes is that the two
> declarations cannot drift apart

所以「与 `required: true` 检查如何不打架」这个问题，P0-3 **已经回答过了**：靠不做第二个运行时检查来避免打架。

### 当前实际声明情况（已验证）

`apps/runner/src/skills/index.ts`：

- `290-296` — `skill.implementation`：`expectedOutputs: ['diff']`
- `377-383` — `skill.review`：`expectedOutputs: [REVIEW_MARKDOWN_OUTPUT_NAME, REVIEW_VERDICT_OUTPUT_NAME]`

只有这两个 skill 声明了 contract，且 `skill-execution-contract.test.ts:65-70` 用 `expect(measured).toEqual(['skill.implementation', 'skill.review'])` 锁死了这个范围 —— 再加一个 contract 就会让测试红，强制作者显式确认。

### 如果 P1-1 强行收编会发生什么

假设 P1-1 加一个运行时检查「invocation 结束后核对 expectedOutputs 是否都产出了」：

1. **与 07-26 的分类打架。** 缺 required output 目前进 operational pause（平台侧问题，不计业务失败）。新增检查若判 business failure，同一个现象会有两种分类，取决于哪个先触发。
2. **产生第二套真相。** `SkillIO.required` 和 `expectedOutputs` 会各自维护一份「必须产出什么」，而 `executionContractOutputConflicts` 存在的意义恰恰是让它们保持同一份。
3. **收益接近零。** 因为 CI 已经保证两份声明一致，运行时再查一遍 `expectedOutputs` 与查 `required` 结果必然相同。

### 如果删掉会发生什么

删掉 `expectedOutputs` 就删掉了 `executionContractOutputConflicts`，也就删掉了「两份声明不许漂移」的守卫。后果：有人给 `skill.review` 加一个 `required: true` 的新 output 时，不再有任何东西提醒 contract 需要同步。这是**净损失**。

## 建议

**不动。** P1-1 唯一值得做的是文档层面的一句话：在 `.trellis/spec` 里说明 `expectedOutputs` 的执行方是 CI 断言而非运行时，避免下一个人重复得出「声明了没人读」的结论并试图删掉或收编它。

若后续确实需要运行时的「did too little」判定，正确做法是**扩展 `SkillIO.required` 的现有路径**（`apps/runner/src/orchestrator/steps.ts:1129` 附近的 operational pause），而不是让 `expectedOutputs` 长出第二条腿。

## Caveats / Not Found

- 未逐行读 `steps.ts:1129` 附近的 operational pause 实现细节（本次只确认了它的存在与分类语义来自 P0-3 的注释与测试）。若 P1-1 后续要改这块，需要单独取证。
- `ExecutionContractOutputConflict.reason` 的两个值目前没有 UI 呈现 —— 冲突只以测试失败的形式暴露。这是刻意的还是遗漏，未验证。
