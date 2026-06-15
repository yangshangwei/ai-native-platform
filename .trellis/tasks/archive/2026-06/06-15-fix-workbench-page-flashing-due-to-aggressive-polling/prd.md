# 优化任务详情页面闪烁问题

## Goal

任务详情页面（Workbench Task Detail Page）当前存在明显的闪烁问题，影响用户体验。需要找出导致闪烁的根本原因并优化轮询机制，确保数据实时更新的同时不会造成页面视觉闪烁。

## What I already know

通过代码检查发现：

### 当前轮询机制
- `main.ts:102-125` 有一个 3 秒轮询逻辑
- 轮询逻辑会调用 `loadData({ render: false, keepDetail: true })` 静默加载数据
- 轮询内有指纹对比机制（`lastDataFingerprint`）尝试避免不必要的重渲染
- 指纹包含：requests状态、runs状态、runner状态、项目数量、activeDetail ID
- **第 123 行：`if (ui.activeRunId) void loadRunDetail(ui.activeRunId, false);`** 每次轮询都会重新加载 run detail，且 `shouldRender=false`

### 可能的闪烁原因
1. **Detail 重新加载导致状态重置**：`loadRunDetail` 会完全替换 `data.activeDetail`，即使指纹检查通过不触发 render，后续的操作（如 primeArtifactPreviews）也可能触发其他渲染
2. **指纹不够细粒度**：当前指纹只检查 `data.activeDetail?.run.id`，不检查 detail 内部的 steps、gates、artifacts、commands 等变化
3. **渲染条件竞争**：`loadRunDetail(ui.activeRunId, false)` 虽然传了 false，但内部异步完成后可能触发其他模块的 render

### 页面架构
- `page-task-detail.ts` 渲染任务详情页
- `data-loading.ts` 负责数据获取和状态填充
- `render-core.ts` 统一调度渲染

## Assumptions (temporary)

* 闪烁主要由频繁的 `loadRunDetail` 调用引起（每 3 秒完整替换 detail 对象）
* 用户在任务详情页停留时需要实时看到 run 状态变化，但不需要 3 秒级的刷新频率
* 可以通过更智能的条件判断来决定是否需要重新加载 detail

## Decision (confirmed)

**Detail 重新加载策略**：采用智能条件触发
- 轮询仍保持 3 秒间隔（保证响应性）
- 但 `loadRunDetail` 只在检测到关键字段变化时才调用
- 关键字段：`run.status`、`run.currentStage`、`run.updatedAt`
- 通过对比 `data.runs` 中的 run 快照与当前 `data.activeDetail` 判断是否需要重新加载

## Requirements

### Must Have (MVP)
* 在 `main.ts` 轮询逻辑中增加条件判断，只在 run 关键字段变化时调用 `loadRunDetail`
* 关键字段包括：`status`、`currentStage`、`updatedAt`
* 消除任务详情页面的闪烁问题
* 保持数据实时性（run 状态变化能在 3 秒内反映）
* 不破坏现有功能（轮询、自动启动 runner、指纹检查等）

### Should Have
* 在控制台添加 debug 日志，记录何时跳过了 detail 重载（开发调试用）
* 确保首次进入页面时能正常加载 detail

### Nice to Have
* 未来可考虑根据 run 状态（completed/failed）进一步降低轮询频率

## Acceptance Criteria

* [ ] 任务详情页在轮询时不会出现可见的闪烁
* [ ] Run 状态变化能在 3 秒内反映到 UI
* [ ] 轮询逻辑只在 run 关键字段变化时调用 `loadRunDetail`
* [ ] 首次进入任务详情页能正常加载 detail
* [ ] 现有的自动刷新和 runner 控制功能正常工作
* [ ] 代码变更有明确的注释说明优化逻辑
* [ ] 本地验证：打开任务详情页，观察至少 30 秒，确认无闪烁

## Definition of Done (team quality bar)

* 本地验证：打开任务详情页，观察至少 30 秒，确认无闪烁
* 代码审查：轮询逻辑清晰、性能优化合理
* 无 lint/typecheck 错误
* 提交信息清晰说明问题和解决方案

## Out of Scope (explicit)

* 完全移除轮询机制（需要更大的架构重构）
* 引入 WebSocket 或 SSE 实时推送（属于独立的架构升级）
* 优化其他页面的轮询逻辑（只聚焦 task detail 页面）

## Technical Approach

### Root Cause
`main.ts:123` 的轮询逻辑每 3 秒无条件调用 `loadRunDetail(ui.activeRunId, false)`，导致 `data.activeDetail` 被完全替换，即使数据无变化也会触发 DOM 重建和页面闪烁。

### Solution Design

#### 1. 在轮询逻辑中增加条件判断
在 `main.ts:102-125` 的 `setInterval` 回调中，增加以下逻辑：

```typescript
// 当前逻辑（有问题）：
if (ui.activeRunId) void loadRunDetail(ui.activeRunId, false);

// 优化后逻辑：
if (ui.activeRunId) {
  // 从最新的 data.runs 中找到当前 run 的快照
  const latestRunSnapshot = data.runs.find(r => r.id === ui.activeRunId);
  const currentDetail = data.activeDetail;
  
  // 只在关键字段变化时重新加载 detail
  const shouldReload = !currentDetail 
    || currentDetail.run.id !== ui.activeRunId
    || latestRunSnapshot && (
      latestRunSnapshot.status !== currentDetail.run.status
      || latestRunSnapshot.currentStage !== currentDetail.run.currentStage
      || latestRunSnapshot.updatedAt !== currentDetail.run.updatedAt
    );
  
  if (shouldReload) {
    void loadRunDetail(ui.activeRunId, false);
  }
}
```

#### 2. 逻辑说明
- **首次加载**：如果 `currentDetail` 不存在，必须加载
- **Run ID 切换**：如果 activeRunId 变化，必须加载新的 run
- **关键字段变化**：对比 `data.runs` 中的快照与 `data.activeDetail.run`，检测以下字段：
  - `status` — run 状态变化（running → passed/failed）
  - `currentStage` — 阶段变化（requirement → design → implementation）
  - `updatedAt` — 时间戳变化（表示有新的 steps/gates/artifacts）

#### 3. 关键数据流
```
每 3 秒轮询:
  └─> loadData({ render: false, keepDetail: true })  // 静默更新 data.runs 快照
       └─> 指纹检查（requests/runs状态变化）
            └─> 如有变化 → render()
       └─> 条件检查（run 关键字段变化）
            └─> 如有变化 → loadRunDetail(ui.activeRunId, false)
                 └─> 异步更新 data.activeDetail
                      └─> render()
```

### Implementation Steps

1. ✅ 修改 `main.ts:102-125` 轮询逻辑，在调用 `loadRunDetail` 前增加条件判断
2. ✅ 添加注释说明优化目的和判断条件
3. ✅ 类型检查通过

**实现细节调整**：
- 原计划检测 `status`、`currentStage`、`updatedAt` 三个字段
- 实际实现只检测 `status` 和 `currentStage`，因为 `WorkflowRunDto` 类型中不包含 `updatedAt`
- 这两个字段足够检测所有重要的 run 状态变化（阶段切换、成功/失败等）

### Testing Strategy

**手动测试**：
1. 启动本地环境，打开任务详情页
2. 观察至少 30 秒，确认页面不闪烁
3. 触发 run 状态变化（如重试阶段），确认 UI 能在 3 秒内更新
4. 切换不同 task，确认能正常加载新的 detail

**验证点**：
- 静态状态（run 无变化）：页面稳定，无闪烁
- 动态状态（run 状态变化）：3 秒内反映到 UI
- 切换 task：新 detail 正常加载
