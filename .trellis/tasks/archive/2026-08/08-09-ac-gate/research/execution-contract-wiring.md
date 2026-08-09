# Research: ExecutionContract 校验接线点

- **Query**: 找到 `executionContractOutputConflicts` 的天然接线点，让声明漂移在开发期爆
- **Scope**: internal (apps/runner, packages/shared)
- **Date**: 2026-08-09

---

## 1. Skill 注册/加载流程

### 1.1 Skill 定义与存储

**位置**: `apps/runner/src/skills/index.ts:27`

```typescript
export const SKILLS: SkillSpec[] = [
  // 所有 skill 以数组字面量形式硬编码在此文件
  // 每个 SkillSpec 包含:
  //   - id, version, stage
  //   - instructions (可从配置层覆盖)
  //   - inputs, outputs (每个有 name, kind, required, description)
  //   - toolPolicy
  //   - executionContract (可选)
  //   - requiredGates
  //   - compatibleBackends
]
```

**关键点**:
- SKILLS 是编译期静态数组，不是运行时注册
- `executionContract.expectedOutputs` 在此处声明（如 `:294`, `:381`）
- `outputs` 的 `required` 字段也在此处声明

### 1.2 Skill 查找函数

**位置**: `apps/runner/src/skills/index.ts:605-615`

```typescript
export async function findSkillForStage(
  stage: SkillSpec['stage'],
): Promise<SkillSpec | undefined> {
  const base = SKILLS.find((s) => s.stage === stage);
  if (!base) return undefined;
  const overrideKey = `${base.id}.instructions` as ConfigKey;
  const instructions = (await getConfig(overrideKey)) as string;
  return { ...base, instructions };
}
```

**特性**:
- 异步函数（因为 instructions 可从配置层实时覆盖）
- 结构字段（id/inputs/outputs/executionContract/toolPolicy）仍是硬编码合约
- 仅 instructions 可运行时编辑

### 1.3 Skill 调用流程

**流程图**（文字描述）:

```
1. orchestrator/steps.ts 各 stage 函数
   ↓
2. await findSkillForStage(stage)  // 查找 skill spec
   ↓
3. deps.invokeSkill(c, skill, skillCtx)  // 委托给 invoke-skill.ts
   ↓
4. invoke-skill.ts:invokeSkill (L93)
   ↓ 构建 context pack
   ↓
5. invokeSkillAttempt (L164)
   ↓ 记录 task/session
   ↓ 捕获 workspace baseline (L237)
   ↓
6. c.backend.run(skill, enrichedCtx)  // 实际执行 agent
   ↓
7. enforceExecutionContract (L240-250)  // 工作区变更检查
   ↓
8. return InvokedAgent { outputs, ... }
   ↓
9. steps.ts: 遍历 agent.outputs，调用 postArtifact
   ↓
10. finishAgentSuccess (invoke-skill.ts:导出函数)
```

**关键观察**:
- **步骤 7** 已存在 `enforceExecutionContract`，检查工作区变更违规
- **步骤 8-9** 处理 outputs，但只检查 required 是否缺失（operational pause）
- **无任何步骤** 调用 `executionContractOutputConflicts`

---

## 2. 推荐接线点

### 2.1 最佳位置

**文件**: `apps/runner/src/skills/index.ts`  
**函数**: `findSkillForStage`  
**行号**: 605-615（函数体末尾，return 前插入）

**理由**:

1. **时机正确**: 每次查找 skill 时立即校验，确保声明一致性在使用前就已验证
2. **调用路径统一**: 所有 stage 都通过 `findSkillForStage` 获取 skill，一处接线覆盖全部
3. **开发期爆破**: skill 定义是编译期静态的，声明冲突会在第一次调用时就被发现
4. **无副作用**: 校验是纯函数，不依赖运行时状态
5. **不违反 ADR-3**: 这是声明一致性校验，不是运行时输出存在性检查

### 2.2 具体接线代码（示例）

```typescript
export async function findSkillForStage(
  stage: SkillSpec['stage'],
): Promise<SkillSpec | undefined> {
  const base = SKILLS.find((s) => s.stage === stage);
  if (!base) return undefined;
  
  // 接线点：声明一致性校验
  const conflicts = executionContractOutputConflicts(base);
  if (conflicts.length > 0) {
    const details = conflicts.map(c => 
      `  - ${c.outputName}: ${c.reason}`
    ).join('\n');
    throw new Error(
      `[skill.${base.id}] ExecutionContract output conflicts:\n${details}\n` +
      `Fix: align outputs[] and executionContract.expectedOutputs in apps/runner/src/skills/index.ts`
    );
  }
  
  const overrideKey = `${base.id}.instructions` as ConfigKey;
  const instructions = (await getConfig(overrideKey)) as string;
  return { ...base, instructions };
}
```

### 2.3 次选位置

**文件**: `apps/runner/src/orchestrator/invoke-skill.ts`  
**函数**: `invokeSkillAttempt`  
**行号**: 164-178（函数入口，在 agentTaskStarted 前）

**理由**:
- 紧邻现有的 `enforceExecutionContract` 调用（L240）
- 每次 agent 调用前执行
- 仍在工作区变更前，是开发期检查

**缺点**:
- 比 `findSkillForStage` 晚（首次调用时才校验，而非加载时）
- 可能被多次触发（retry 机制）

---

## 3. 冲突时行为建议

### 3.1 推荐方案：throw (开发期爆)

**行为**: 抛出异常，终止 workflow run

**理由**:

1. **声明冲突是致命错误**: 两处声明不一致意味着 skill 定义本身有缺陷，不是可容忍的降级
2. **快速反馈**: 开发期立即发现，不会漏到生产环境
3. **符合现有模式**: `enforceExecutionContract` 违规时也是抛异常（见 `execution-contract.ts:20-23` 注释："violation is a BUSINESS failure"）
4. **修复简单**: 错误消息直接指向 `apps/runner/src/skills/index.ts`，开发者可立即对齐声明

**错误类型选择**:
- **不应用** `OperationalError`（理由见下文 ADR-3 分析）
- **应用** 普通 `Error`，或新增 `ConfigurationError` 类型

### 3.2 次选方案：gate warn（运行时降级）

**行为**: 记录 gate warning，允许 run 继续

**理由**:
- 允许非关键冲突（如 optional output 不在 expectedOutputs）不阻塞运行
- 可通过 gate 规则控制是否阻断

**缺点**:
- 冲突可能被长期忽略（warning 疲劳）
- 需要新增 gate 规则与 UI 展示
- 不符合"开发期爆"的目标

### 3.3 不推荐：log warn（仅记录）

**理由**:
- 容易被忽略
- 声明冲突的严重性高于普通 warning
- 与现有 `enforceExecutionContract` 的处理力度不一致

---

## 4. ADR-3 合规说明

### 4.1 ADR-3 的红线

**来源**: `.trellis/tasks/archive/2026-08/08-09-p1-1-evidencecontract-artifact-freshness-node/prd.md:147-155`

**核心内容**:
```
Decision: 本轮**不动** expectedOutputs

Rationale: 
- P1-1 重心是 digest 信号 + AC proof 分级，与 output 存在性检查不是同一件事
- skill outputs 的 `required: true` 已在 steps.ts:1129 走 operational pause 兜底
- 收编会产生第二套判定
- 硬塞进来会让本任务失焦

Consequences: expectedOutputs 继续悬空
```

**关键红线**: "收编会产生第二套判定" = **禁止运行时输出存在性检查**

### 4.2 本接线如何不违反

| ADR-3 禁止的 | 本接线做的 | 区别 |
|---|---|---|
| **运行时**输出存在性检查 | **开发期**声明一致性校验 | 时机不同 |
| 检查 agent 是否产生了 output 文件 | 检查 skill 定义的两处声明是否对齐 | 检查对象不同 |
| 与 steps.ts:1129 operational pause 冲突 | 不依赖运行时状态，纯静态检查 | 无冲突 |
| 产生第二套判定 | 不做判定，只做声明校验 | 不引入判定 |

**具体分析**:

1. **校验时机**: 
   - ADR-3 禁止的：agent 执行后检查 outputs 是否存在（运行时）
   - 本接线：`findSkillForStage` 时检查两处声明是否一致（加载时）

2. **校验内容**:
   - ADR-3 禁止的：`required: true` 的 output 是否被 agent 产生
   - 本接线：`required: true` 的 output 是否在 `expectedOutputs` 中 **声明**

3. **与 operational pause 关系**:
   - `steps.ts:1129` (实际是 `:330` 等多处): 检查 `agent.outputs.find(o => o.name === 'xxx')` 是否存在
   - 本接线：检查 `skill.outputs` 与 `skill.executionContract.expectedOutputs` 数组是否对齐
   - **不冲突**: 前者保证 agent 行为，后者保证 skill 定义

4. **错误类型**:
   - 若用 `OperationalError`，会被误解为运行时故障，违反 ADR-3 精神
   - 应用普通 `Error`，表明这是配置错误而非运行时检查

### 4.3 文档注释建议

在接线代码上方添加注释：

```typescript
// 08-09 P0-3 R6: Declaration consistency check (NOT runtime output validation).
// Ensures skill.outputs[].required aligns with executionContract.expectedOutputs,
// preventing the two declarations from drifting apart. This is a dev-time guard
// that fails fast at skill load, distinct from the operational pause at L330
// which checks whether the agent actually produced the output. ADR-3 forbids
// runtime output existence checks to avoid a second judgment layer; this
// validation is purely about config integrity.
```

---

## 5. 改动点清单与测试覆盖方案

### 5.1 改动点清单

| 文件 | 函数/行号 | 改动内容 | 风险等级 |
|---|---|---|---|
| `apps/runner/src/skills/index.ts` | `findSkillForStage:605-615` | 插入 `executionContractOutputConflicts` 调用 + throw | 中 |
| `apps/runner/src/skills/index.ts` | top-level | 新增 `import { executionContractOutputConflicts }` | 低 |
| (可选) `packages/shared/src/types/execution-contract.ts` | `executionContractOutputConflicts:247-263` | 完善 JSDoc，说明调用场景 | 低 |

**风险分析**:
- **中风险**: `findSkillForStage` 是所有 skill 调用的入口，改动会影响全部 workflow stage
- **缓解**: 现有 SKILLS 定义已通过测试（`packages/shared/test/execution-contract.test.ts:264-300`），新增校验只会在声明错误时才抛异常

### 5.2 测试策略

#### 5.2.1 单元测试（新增）

**文件**: `apps/runner/test/skills.test.ts` (新建)

**覆盖场景**:

1. **Happy path**: 声明对齐的 skill 不抛异常
   ```typescript
   test('findSkillForStage: aligned declarations pass', async () => {
     // skill.review 的 expectedOutputs 与 outputs[].required 已对齐
     const skill = await findSkillForStage('review');
     expect(skill).toBeDefined();
     expect(skill?.id).toBe('skill.review');
   });
   ```

2. **Conflict: expected_output_not_declared**
   ```typescript
   test('findSkillForStage: throws when expectedOutputs includes undeclared output', async () => {
     // 临时修改 SKILLS 数组（或用 mock）
     await expect(findSkillForStage('mock_stage_with_ghost_output'))
       .rejects.toThrow(/expected_output_not_declared/);
   });
   ```

3. **Conflict: required_output_not_expected**
   ```typescript
   test('findSkillForStage: throws when required output not in expectedOutputs', async () => {
     await expect(findSkillForStage('mock_stage_with_missing_expectation'))
       .rejects.toThrow(/required_output_not_expected/);
   });
   ```

4. **No contract**: skill 无 executionContract 时不抛异常
   ```typescript
   test('findSkillForStage: skill without contract passes', async () => {
     // skill.context_pack 等早期 skill 可能无 contract
     const skill = await findSkillForStage('context_pack');
     expect(skill).toBeDefined();
   });
   ```

#### 5.2.2 集成测试（现有）

**文件**: `apps/runner/test/skill-execution-contract.test.ts`

**已有覆盖**:
- `executionContractOutputConflicts` 的逻辑已被测试（通过 `packages/shared/test/execution-contract.test.ts:255-300`）
- 无需重复测试冲突检测逻辑本身

**需补充**:
- 验证 `findSkillForStage` 在真实 workflow 中调用时，冲突能正确终止 run
- 可通过临时注入错误 skill 定义，触发 operational/business failure

#### 5.2.3 回归测试

**范围**: 所有现有 skill 的 E2E 测试

**验证点**:
- 所有 stage 的 `findSkillForStage` 调用仍能成功
- 无误报（现有 skill 定义已对齐，不应抛异常）

**执行方式**:
```bash
bun test apps/runner/test/
bun test apps/api/test/gate-engine.test.ts  # 验证 gate 侧不受影响
```

### 5.3 生产验证

**Pre-flight check**:

```typescript
// 临时脚本: apps/runner/scripts/validate-skill-declarations.ts
import { SKILLS } from '../src/skills';
import { executionContractOutputConflicts } from '@ainp/shared';

for (const skill of SKILLS) {
  const conflicts = executionContractOutputConflicts(skill);
  if (conflicts.length > 0) {
    console.error(`[${skill.id}] conflicts:`, conflicts);
    process.exit(1);
  }
}
console.log('✓ All skills have aligned declarations');
```

**运行时机**: 
- CI pipeline 的 lint/validate 阶段
- 部署前强制检查

---

## 6. 相关文件清单

### 6.1 核心文件

| 文件 | 作用 | 关键行号 |
|---|---|---|
| `apps/runner/src/skills/index.ts` | skill 定义与查找 | 27 (SKILLS), 294/381 (expectedOutputs 声明), 605 (findSkillForStage) |
| `apps/runner/src/orchestrator/invoke-skill.ts` | skill 调用入口 | 93 (invokeSkill), 164 (invokeSkillAttempt), 237-250 (enforceExecutionContract) |
| `apps/runner/src/orchestrator/steps.ts` | 各 stage 实现 | 330 (operational pause), 1283/1707 (findSkillForStage 调用点) |
| `packages/shared/src/types/execution-contract.ts` | 校验函数定义 | 247-263 (executionContractOutputConflicts) |
| `packages/shared/src/types/skill.ts` | SkillSpec 类型定义 | 11-30 (SkillSpec), 32-37 (SkillIO) |

### 6.2 测试文件

| 文件 | 覆盖内容 |
|---|---|
| `packages/shared/test/execution-contract.test.ts` | executionContractOutputConflicts 逻辑 (L255-300) |
| `apps/runner/test/skill-execution-contract.test.ts` | enforceExecutionContract 集成 |

### 6.3 相关 spec

| 文件 | 说明 |
|---|---|
| `.trellis/tasks/08-09-ac-gate/research/current-shape.md` | AC 判定现状与 expectedOutputs 悬空问题 (L72-83) |
| `.trellis/tasks/archive/2026-08/08-09-p1-1-evidencecontract-artifact-freshness-node/prd.md` | ADR-3: 不收编 expectedOutputs (L147-155) |

---

## 7. Caveats / 未覆盖

1. **配置层覆盖 instructions 后**: 
   - `findSkillForStage` 只覆盖 instructions，不覆盖 outputs/executionContract
   - 声明冲突检查不受影响（因为检查的是 `base`，不是合并后的 skill）

2. **动态 skill 注册**:
   - 当前 SKILLS 是静态数组，若未来支持运行时注册，需在注册点也调用校验

3. **executionContract.expectedOutputs 的语义完整性**:
   - 本接线只保证 `required: true` 的 output 在 expectedOutputs 中
   - 不保证 expectedOutputs 中所有 output 都是 `required: true`（允许 optional output 也在 expectedOutputs）
   - 这与测试用例 `execution-contract.test.ts:264-278` 的预期一致

4. **与 gate 规则的协同**:
   - 本接线阻止冲突 skill 被调用，gate 侧不需要处理这类错误
   - 但 gate 规则仍需处理 expectedOutputs 的**运行时缺失**（这是 operational pause 的职责，不在本接线范围）

---

## 总结

**推荐接线方案**:
- **位置**: `apps/runner/src/skills/index.ts:findSkillForStage` 函数体末尾
- **行为**: 检测到冲突时 throw Error（开发期爆）
- **ADR-3 合规**: 这是声明一致性校验，不是运行时输出存在性检查，不违反 ADR-3
- **测试覆盖**: 新增单元测试 + 复用现有集成测试 + 回归测试

**关键优势**:
1. 一处接线，覆盖所有 skill
2. 开发期立即发现声明漂移，不会漏到生产
3. 与现有 `enforceExecutionContract` 形成配套（前者保证定义一致性，后者保证运行时合规）
4. 修复简单（错误消息直接指向 skills/index.ts）
