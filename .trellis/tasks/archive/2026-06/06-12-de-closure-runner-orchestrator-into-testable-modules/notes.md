# Notes: 06-12 de-closure runner orchestrator (T3.1)

## Spec 漂移记录（待 update-spec 处理）

1. **`RunCtx` 已导出**（`.trellis/spec/runner/backend/flow-registry.md` §2 写 "file-private interface in orchestrator.ts … **Not exported**"，§3 写 "declared above cmdOrchestrate and not exported (PRD R14)"）。
   - 现状：`RunCtx`（连同 `OkRef` / `ContextPolicy` / `ContextRequestCapture` / `InvokedAgent` / `PromoteDraftInput` / `OrchestrateOpts` / `OrchestrateResult`）定义在新文件 `apps/runner/src/orchestrator/types.ts` 并导出；`orchestrator.ts` re-export `RunCtx` 类型。
   - 依据：PRD 已批准为可测试性导出（spec 的 "Not exported" 是 W2-1 时点描述）。注入式单测需要构造 RunCtx fixture（`apps/runner/test/helpers/orchestrator-fixtures.ts`）。

2. **`dispatchStep` / `executeXxx` / `runContextPack` / `runStage` 不再是 cmdOrchestrate 的 inner function**（spec §2 称它们为 "inner function of cmdOrchestrate"）。
   - 现状：全部提升为模块顶层函数。`dispatchStep` 仍是单点路由（保留在 `orchestrator.ts`，每个 stage 仍流经它，未拆分——spec "Bad" 红线保持），新增可选 `deps: DispatchDeps` 参数（默认连接真实实现）仅用于测试 spy；生产路径走默认值。
   - `executeXxx` / `runStage` / `runContextPack` 移至 `apps/runner/src/orchestrator/steps.ts`，接收 `(c: RunCtx, deps: StepDeps = DEFAULT_STEP_DEPS)`；`invokeSkill` / `captureContextRequest` / `ensureContextFoundation` 移至 `apps/runner/src/orchestrator/invoke-skill.ts`（`InvokeSkillDeps`）；`awaitApproval` / `waitForApprovalDecision` / `postRejectionFeedback` / `enforceSensitiveChangeCheckpoint` 移至 `apps/runner/src/orchestrator/approval.ts`；verifier 媒体纯函数移至 `apps/runner/src/orchestrator/verifier-media.ts`。
   - spec §3 "executeXxx MUST NOT close over outer cmdOrchestrate state" 不变式依旧成立（且现在由顶层函数签名结构性保证）。`ctx.ok` boxed boolean 语义、禁 `?? 'feature.standard'` 回退均逐字保留。

3. **既有导出面经 `orchestrator.ts` re-export 保持零破坏**：`cmdOrchestrate` / `agentUserRequestForOrchestrate` / `agentTaskBriefForContext` / `sliceStagesFromStartStage` / `waitForApprovalDecision` / `enforceSensitiveChangeCheckpoint` / `SensitiveChangeCheckpointDeps` / `promoteAcceptedDraftToKnowledge` / `PromoteDraftInput` / `PromoteDeps` / `OrchestrateOpts` / `OrchestrateResult`。既有 6 个测试文件 import 面零改动。

## Check 修正（06-12 审查轮）

- PRD 第二阶段对 `verifier-media.ts` 的描述（"纯函数群（已导出已测试，纯搬移）"）前提不准确：这些函数在旧 `orchestrator.ts` 中是 file-private 且**无任何直接单测**（仅经 executeVerifier 间接覆盖）。搬移导出属实且逐字等价；审查轮补充 `apps/runner/test/orchestrator-verifier-media.test.ts` 直接锁定该模块导出面的纯函数契约。

## 顺手清理（非行为变化）

- 删除了 `orchestrator.ts` 中从未被引用的死常量 `STAGE_TO_ARTIFACT_KIND`（仅定义无使用，grep 全仓确认）。
- 原闭包对 `inputs` / `inputArtifactIds` / `draftsToPromote` / `ok` 的裸别名访问全部统一经 `c.`（研究报告 §1.1 已确认两套引用指向同一对象，纯机械转换）。
