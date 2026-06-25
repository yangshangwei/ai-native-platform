# Research: Flow Registry & FlowDef — 新增只读问答 flow 所需定义

研究目标：搞清楚新增一个只读问答 flow（暂称 `ask.standard`）需要改哪些地方。本文档**只描述现状**，不含建议。

---

## 1. FlowDef 结构

定义位置：`packages/shared/src/types/workflow.ts:153-160`

```ts
export interface FlowDef {
  id: FlowId;                  // 形如 <work_kind>.<variant>
  kind: WorkflowRunType;       // 绑定到某个 run type；路由用它筛选 flow
  description: string;         // UI/docs 用的人读摘要
  stages: readonly StageStep[];// 有序步骤，orchestrator 顺序迭代
}
```

`StageStep`（`workflow.ts:138-142`）：

```ts
export interface StageStep {
  stage: WorkflowStage;        // 该位置运行的 stage
  kind: StageStepKind;         // 'agent' | 'gate' | 'human' | 'engine'
  skillId?: string;            // agent 步骤的 skill id；非 agent 可省略
}
```

注意：**FlowDef 没有 `startStage` 字段。** `startStage` 是 *运行实例* 字段（`WorkflowRun.startStage` / `WorkflowRequest.startStage`，`workflow.ts:190/236`），由 Router 或 UI 覆盖时填，表示从 flow 的哪一步切入；目前只有 `feature.standard` 用到非 null 值，其他短 flow 一律 head-to-tail（`null`）。Router 的 `recommendStartStage` 对非 `feature.standard` 的 flow 直接返回 `null`（`apps/api/src/router.ts:121-124`）。

`StageStepKind` 语义（`workflow.ts:113-128`）：
- `'agent'` — orchestrator 派生一个 LLM skill（多数 stage）
- `'gate'` — 跑确定性 gate 引擎
- `'human'` — 暂停等人工批准
- `'engine'` — runner 原生逻辑（build_test、completion 报告、knowledge 提升）

---

## 2. FlowId union 位置

定义：`packages/shared/src/types/workflow.ts:111`

```ts
export type FlowId = 'feature.standard' | 'feature.fastforward' | 'issue.standard' | 'refactor.standard';
```

派生的运行时清单与守卫在 registry：`packages/shared/src/flows/registry.ts:205-209`
- `KNOWN_FLOW_IDS` = `Object.keys(FLOW_REGISTRY)`
- `isFlowId(value)` 用作 HTTP/CLI 入参的信任边界守卫

新增 FlowId 必须加到这个 union，否则 `FLOW_REGISTRY` 的 `Readonly<Record<FlowId, FlowDef>>`（`registry.ts:192`）会触发 `tsc --noEmit` 缺项报错。

---

## 3. FlowDef.kind 与 runType 的关系

- `FlowDef.kind: WorkflowRunType`（`workflow.ts:155`）。
- `WorkflowRunType = 'feature' | 'bugfix' | 'smoke' | 'refactor'`（`workflow.ts:60`）。
- 多个 flow 可共享同一 `kind`、变体不同（`feature.standard` 与 `feature.fastforward` 都是 `kind: 'feature'`）。
- 命名不强制对齐：`issue.standard` 的 `kind` 是 `'bugfix'`（`registry.ts:124-126`，注释说明这是刻意的，重命名 `bugfix` 超范围）。

**关键现状：`'smoke'` 是合法 runType，但 FLOW_REGISTRY 中没有任何 `kind: 'smoke'` 的 flow。** Router 把 `smoke` 映射到 `feature.standard`（见下）。

---

## 4. runType → FlowId 映射现状（两处）

### 4a. Smart Router（`apps/api/src/router.ts:87-112`，函数 `recommendFlowId`）
优先级短路：
- `runType === 'bugfix'` → `issue.standard`
- `runType === 'refactor'` → `refactor.standard`
- `runType === 'smoke'` → `feature.standard`（注释：不要给 smoke 走 fastforward）
- `runType === 'feature'`：title 短（<60 字符）或含 small-change 关键词 → `feature.fastforward`；否则 `feature.standard`

HTTP 入口：`apps/api/src/routes/router.ts` 的 `POST /router/recommend`。其 `KNOWN_RUN_TYPES`（`routes/router.ts:23-28`）= `['feature','bugfix','smoke','refactor']`，对入参做信任边界校验后调用 `recommend()`。

### 4b. createWorkflowRun 默认值（`apps/api/src/workflow-engine.ts:141-144`，`defaultFlowIdForType`）
当 `body.flowId` 缺省时：
- `bugfix` → `issue.standard`
- `refactor` → `refactor.standard`
- 其他（含 feature/smoke）→ `feature.standard`

注意：`createWorkflowRun` 同时也会调 `recommend()` 做审计/预览（`workflow-engine.ts:102-104`），但实际落库 flowId 用的是 `params.flowId ?? defaultFlowIdForType(params.type)`（`:112`）——**Router 的推荐不会被静默套用**，用户/调用方显式 flowId 始终优先。

---

## 5. 最短现有 flow（参考模板）

最短的是 `feature.fastforward`（4 stage，`registry.ts:89-100`）：

```ts
const FEATURE_FASTFORWARD: FlowDef = {
  id: 'feature.fastforward',
  kind: 'feature',
  description: '...',
  stages: [
    { stage: 'implementation', kind: 'agent', skillId: 'cs-feat-impl' },
    { stage: 'build_test', kind: 'engine' },
    { stage: 'review', kind: 'agent', skillId: 'cs-feat-accept' },
    { stage: 'completion', kind: 'engine' },
  ],
};
```

`issue.standard` / `refactor.standard` 是 6 stage，引入了新 stage（`report`/`analyze`、`scan`/`plan`），它们都通过 orchestrator 的 `executeAgentMarkdownStage` 统一处理（产出一个 markdown artifact，见下）。

---

## 6. 新增只读 flow 的最小定义需要触及的字段/文件

注册一个新 flow 的 canonical 步骤已写在 `registry.ts:16-33` 的头注释里。结合代码确认，落地一个只读 `ask.standard` 至少要动：

1. **`packages/shared/src/types/workflow.ts:111`** — 把 `'ask.standard'` 加进 `FlowId` union（否则 FLOW_REGISTRY 缺项报错）。

2. **新 stage（如果只读问答用现有 stage 之外的步骤）**：
   - 把新 stage 值加进 `WorkflowStage` union（`workflow.ts:3-18`）**和** `WORKFLOW_STAGES` 数组（`workflow.ts:26-40`）——两处必须同步，否则 `_AssertAllStagesListed` 触发 tsc 失败。
   - 在 orchestrator `dispatchStep` 加 case（`apps/runner/src/orchestrator.ts:260-302`），否则 `_exhaustive: never` 报错。现有 `report/analyze/scan/plan` 共用 `executeAgentMarkdownStage`（`orchestrator.ts:291-296`；实现 `orchestrator/steps.ts:413-457`，产出 markdown artifact、不跑 gate、不需 human），是只读 agent stage 的现成模式。
   - `executeAgentMarkdownStage` 的入参类型与 `mustSkill` 的 stage 联合类型（`steps.ts:414`、`steps.ts:709-711`）也得扩展。
   - 在 `apps/runner/src/skills/index.ts` 的 `SKILLS` 数组加一个对应 stage 的 `SkillSpec`（`skills/index.ts:14-`，结构见 `packages/shared/src/types/skill.ts:9-19`：`id/version/stage/instructions/inputs/outputs/toolPolicy/requiredGates/compatibleBackends`）。`findSkillForStage`（`skills/index.ts:424-434`）按 `stage` 精确匹配查 skill。

3. **`packages/shared/src/flows/registry.ts:192-197`** — 在 `FLOW_REGISTRY` 追加 `'ask.standard': ASK_STANDARD` 条目并定义 `ASK_STANDARD: FlowDef`。`KNOWN_FLOW_IDS` / `isFlowId` 自动包含，无需手动同步清单。

4. **runType → flow 映射（视需求）**：
   - 若复用现有 runType（如 `feature`），需在 Router `recommendFlowId`（`apps/api/src/router.ts:87-112`）加判定，否则只能靠显式 `flowId='ask.standard'` 进入（参见 `refactor.standard` 现状：Coordinator 不产 refactor 路由，只能显式 flowId 进入，`registry.ts:159-162`）。
   - 若新增专门的 runType（如 `'ask'`），要扩 `WorkflowRunType`（`workflow.ts:60`）、`routes/router.ts` 的 `KNOWN_RUN_TYPES`（`:23-28`）、`defaultFlowIdForType`（`workflow-engine.ts:141-144`），以及 Coordinator 分类规则。
   - 仅靠显式 flowId（不碰 Router/Coordinator）也能跑：`createWorkflowRun` 接受 `params.flowId`（`workflow-engine.ts:90/112`），`WorkflowRequest.flowId` 也可由 UI 覆盖（`workflow.ts:230`）。

5. **测试/spec（非编译必需，但项目约定）**：
   - `apps/runner/test/flow-registry.test.ts` 用 out-of-band 数组 pin stage 顺序。
   - spec：`.trellis/spec/runner/backend/flow-registry.md`、`.trellis/spec/api/backend/smart-router.md`。

### startStage 现状（与只读 flow 相关）
- 短 flow 一律 `startStage = null`（head-to-tail）。Router 对非 `feature.standard` 直接返回 null（`router.ts:121-124`）。只读 ask flow 若也是短 flow，沿用 `null` 即可，无需 startStage 逻辑。

---

## 7. 关键文件清单

| 关注点 | 路径 | 行 |
|---|---|---|
| FLOW_REGISTRY / KNOWN_FLOW_IDS / isFlowId | `packages/shared/src/flows/registry.ts` | 192-209 |
| FlowDef / StageStep / StageStepKind / FlowId | `packages/shared/src/types/workflow.ts` | 111-160 |
| WorkflowStage union + WORKFLOW_STAGES 数组 | `packages/shared/src/types/workflow.ts` | 3-50 |
| WorkflowRunType | `packages/shared/src/types/workflow.ts` | 60 |
| RouterInput / RouterRecommendation | `packages/shared/src/types/router.ts` | 33-84 |
| SkillSpec | `packages/shared/src/types/skill.ts` | 9-19 |
| Router recommend() / recommendFlowId | `apps/api/src/router.ts` | 69-112 |
| POST /router/recommend | `apps/api/src/routes/router.ts` | 36-66 |
| createWorkflowRun / defaultFlowIdForType | `apps/api/src/workflow-engine.ts` | 98-144 |
| dispatchStep（stage→执行） | `apps/runner/src/orchestrator.ts` | 255-303 |
| executeAgentMarkdownStage（只读 markdown 模式） | `apps/runner/src/orchestrator/steps.ts` | 413-457 |
| mustSkill / findSkillForStage | `apps/runner/src/orchestrator/steps.ts` / `skills/index.ts` | 709-715 / 424-434 |
| SKILLS 数组（SkillSpec 列表） | `apps/runner/src/skills/index.ts` | 14- |
