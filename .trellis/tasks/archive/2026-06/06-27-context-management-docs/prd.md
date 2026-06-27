# context management docs

## Goal

落盘交付工作台上下文管理优化路线的三份 Markdown 文档，并推进第一批 P0/P1：

- 需求文档
- 方案设计文档
- 任务分解文档
- P0：校准当前上下文架构说明
- P1：实现 per-invocation ContextPack 持久化

## What I already know

- 当前系统已有 `ContextPack` 架构，每次 agent invocation 会构建上下文。
- 阶段产物通过 artifact 和 `RunCtx.inputs` 传递给后续阶段。
- 现有链路缺少显式 handoff、阶段 checkpoint、持久化 base context pack 和输入注入策略治理。
- 当前 `invokeSkill()` 已支持一次 same-step supplement retry：base invocation 捕获 `context_request` 后结束，并用 supplement `ContextPack` 重试同一个 skill 一次；retry 再次请求上下文会触发 retry limit。
- 目标落盘位置是 `docs/`。

## Requirements

- 在 `docs/` 下新增三份 Markdown 文档。
- 文档应覆盖需求、方案设计、任务拆解、验收标准、风险和迁移策略。
- 校准 `docs/2026-06-27-context-management-architecture.md`，确保它与当前 `invokeSkill()` retry 行为一致。
- 实现 P1 ContextPack 持久化：base pack 在 backend 调用前写为 `context_pack` artifact；supplement pack 在 `context_request` 捕获时写为 `context_pack` artifact；agent session metadata 记录 invocation/context artifact 关系。
- 保留现有 workflow 兼容，不改变阶段产物通过 artifact + `RunCtx.inputs` 向下游传递的主路径。

## Acceptance Criteria

- [x] `docs/` 下存在需求文档。
- [x] `docs/` 下存在方案设计文档。
- [x] `docs/` 下存在任务分解文档。
- [x] 三份文档能独立阅读，也能串成一条实施路线。
- [x] 文档明确一期和二期边界。
- [x] 架构说明明确 `context_request` same-step supplement retry 一次和 retry limit。
- [x] 新 invocation 能找到 base `ContextPack` artifact。
- [x] `context_request` 能找到 request artifact、supplement artifact 和 retry 关系。
- [x] 相关测试覆盖正常调用、supplement retry 和治理读模型。

## Out of Scope

- 不引入新依赖。
- 不实现 P2/P3/P4 的阶段 checkpoint、输入注入策略和显式 handoff。
- 不调整现有 workflow stage 顺序。

## Technical Notes

- 参考现有文档：`docs/2026-06-27-context-management-architecture.md`。
