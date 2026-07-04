# 各 Stage 实现 — `apps/runner/src/orchestrator/steps.ts`

## 概述

steps.ts 包含所有 stage 的具体执行逻辑。每个 `executeXxx` 函数是从原 `cmdOrchestrate` 闭包提取的顶层函数，通过 `RunCtx` 读取运行状态，通过 `StepDeps` 注入外部依赖。

---

## 核心 Stage 实现

### `runContextPack(c)`

```
1. generateProjectProfile() → 写入 c.contextFoundation
2. stepStarted(stage='context_pack')
3. checkpointStageContext(phase='start')
4. postArtifact(kind='project_profile')
5. collectAcceptedKnowledge() → 写入 c.inputs['accepted_knowledge.md']
6. findSkillForStage('context_pack') → 获取 skill
7. invokeSkill(c, skill, skillCtx) → agent 执行
8. 遍历 outputs → postArtifact(kind='context_pack')
9. finishAgentSuccess
10. checkpointStageContext(phase='finish')
11. stepFinished(status='passed')
```

---

### `runStage(c, stage, artifactKind, rulebasedGateId)`

通用 requirement / design / review 三阶段模板：

```
1. mustSkill(stage)
2. stepStarted
3. checkpointStageContext(phase='start')
4. invokeSkill → agent 执行
5. 遍历 outputs:
   - artifactKindForStageOutput() → requirement_draft / design_doc / traceability / other
   - postArtifact
   - 如果是 requirement_draft / design_doc → 加入 c.draftsToPromote
6. finishAgentSuccess
7. requirement stage → recordRequirementToDesignStageHandoff
8. review stage → recordReviewHandoff
9. checkpointStageContext(phase='finish')
10. stepFinished

如果有 rulebasedGateId:
11. runGate(rulebasedGateId) → fail 则 throw
12. awaitHuman(stage) → 等待人工审批
13. awaitApproval(approverGateId) → rejected 则 postRejectionFeedback + throw
```

---

### `executeImplementation(c)`

```
1. mustSkill('implementation')
2. stepStarted(stage='implementation')
3. checkpointStageContext(phase='start')
4. invokeSkill → agent 执行（产出 diff + changed-files）
5. postArtifact(kind='diff')
6. toolInvocation(runner.git_diff_capture)
7. finishAgentSuccess
8. 记录 handoffContext(implementationSessionId, implementationArtifactIds)
9. runGate('diff_scope_gate') → fail 则 throw
10. runGate('sensitive_change_gate')
11. enforceSensitiveChangeCheckpoint → 敏感变更需人工审批
12. checkpointStageContext(phase='finish')
13. stepFinished
```

---

### `executeBuildTest(c)`

```
1. 检测 mvnw 或 mvn
2. 读取 project.buildCompileCommand / buildTestCommand（自定义命令优先）
3. stepStarted(stage='build_test')
4. runWhitelistedCommandWithToolInvocation(compileCommand)
5. 编译失败 → recordBuildFailureDebuggerHandoff + throw
6. runWhitelistedCommandWithToolInvocation(testCommand)
7. collectReports() → maven surefire/failsafe 报告
8. api.mavenBuild() → 获取 compile_gate + test_gate 状态
9. 两个 gate 都 pass → stepFinished('passed')
10. 否则 → recordBuildFailureDebuggerHandoff + throw
```

---

### `executeVerifier(c)`

仅当 `shouldRequireUiVerifier(run.title)` 为 true 时执行：

```
1. stepStarted(stage='review', name='verifier')
2. persistVerifierMediaArtifacts → 收集 .ainp-verifier/ 下的截图/视频
3. acceptanceCriterionIdsFromInputs → 从 inputs 提取 AC ids
4. verifierMediaSatisfiesCoverage → 判断 pass/blocked
5. 构建 VerifierAcMatrix JSON
6. postArtifact(kind='other', verifier_ac_matrix)
7. stepFinished
```

---

### `executeAcceptance(c)`

```
1. runGate('acceptance_gate') → 验收追溯性
2. runGate('evidence_gate') → 证据充分性
3. awaitHuman(stage='review')
4. awaitApproval('acceptance_gate')
5. approved → 遍历 draftsToPromote → promoteAcceptedDraftToKnowledge
6. rejected → postRejectionFeedback + throw
```

---

### `executeAgentMarkdownStage(stage, c)`

report / analyze / scan / plan 的通用模板：

```
1. mustSkill(stage)
2. stepStarted
3. checkpointStageContext(phase='start')
4. invokeSkill → agent 执行
5. 遍历 outputs → postArtifact(kind='other')
6. finishAgentSuccess
7. checkpointStageContext(phase='finish')
8. stepFinished
```

---

### `executeCompletion(c)`

```
1. stageTransition(stage='completion')
2. runGate('evidence_gate') → fail 则 throw
3. generateCompletionReport(runId)
```

---

### `executeKnowledgePromotion(c)`

```
1. stageTransition(stage='knowledge')
2. generateKnowledgeCandidate(runId)
3. awaitHuman(stage='knowledge')
4. awaitApproval('knowledge_gate')
5. approved → getWorkflowRun → 提取 knowledge_suggestion_action → persistKnowledgeCandidate
6. rejected → ok=false（不 throw，优雅退出）
```

---

## Stage Context Checkpoint

每个 stage 的 start 和 finish 都会写入 `StageContextCheckpointSnapshot`:

```typescript
{
  phase: 'start' | 'finish',
  workflowRunId, stepRunId, stage,
  inputs: {...c.inputs},
  inputArtifactIds: {...c.inputArtifactIds},
  producedArtifactIds: {...},
  contextPackArtifactIds: [...],
  createdAt
}
```

用于 resume 时恢复 `c.inputs` / `c.inputArtifactIds`（`restoreRunCtxInputsFromStageCheckpoint`）。

---

## Tool Invocation 审计

`runWhitelistedCommandWithToolInvocation` 在每次命令执行前后记录 `ToolInvocation`：
- toolId = `runner.command`
- argumentsDigest = SHA256(command + cwd + stage + extraAllow)
- resultRefs 引用 CommandRun

`toolInvocationForDiffCapture` 为 diff 捕获记录审计记录。

---

## Handoff 记录

- **Requirement → Design**: `buildRequirementDesignStageHandoff` 提取摘要/决策/风险/开放问题，写为 markdown artifact
- **Implementation → Review**: 使用 `recordReviewHandoff` 建立 executor → reviewer 的独立审查链
- **Build Failure → Debugger**: `recordBuildFailureDebuggerHandoff` 产出 debugger-input.json + analysis markdown

---

## Knowledge Promotion

`promoteAcceptedDraftToKnowledge(projectId, draft)`:
- 调用 `api.promoteDraft()`
- 服务端在单 transaction 中完成 entity_id 解析、版本 bump、INSERT knowledge_artifact
- 失败只 log 不 throw（不阻断验收 gate）

---

## 依赖注入 (`StepDeps`)

```typescript
interface StepDeps {
  api: StepApi;
  mustSkill, findSkillForStage,
  invokeSkill, finishAgentSuccess,
  awaitApproval, postRejectionFeedback,
  enforceSensitiveChangeCheckpoint,
  promoteAcceptedDraftToKnowledge,
  runWhitelistedCommand, collectReports,
  persistVerifierMediaArtifacts,
  generateProjectProfile, collectAcceptedKnowledge,
  persistKnowledgeCandidate,
}
```
