# Research: apps/runner 架构分析（为简化与可扩展性重构提供依据）

- **Query**: 从架构角度深入分析 apps/runner 包，为"更简洁、更可扩展、功能保持正确"的重构提供依据
- **Scope**: internal
- **Date**: 2026-06-11

## 0. 包全貌（行数）

| 文件 | 行数 | 职责 |
|---|---|---|
| `apps/runner/src/orchestrator.ts` | 1968 | 8 阶段流水线编排（核心问题文件） |
| `apps/runner/src/context/builder.ts` | 1025 | ContextPack 组装 + 成熟度画像 + 知识评审信号 |
| `apps/runner/src/agents/coordinator/llm-fallback.ts` | 815 | Coordinator LLM 兜底分诊（CLI 调用 + JSON 解析） |
| `apps/runner/src/agents/claude-code.ts` | 546 | Claude Code CLI backend |
| `apps/runner/src/agents/native.ts` | 544 | 测试 stub backend + **AgentBackend 接口定义** |
| `apps/runner/src/api-client.ts` | 483 | 平台 API 的类型化 fetch 封装（扁平对象，结构健康） |
| `apps/runner/src/context/retriever.ts` | 443 | 候选打分/预算裁剪（纯函数，结构健康） |
| `apps/runner/src/skills/index.ts` | 434 | SkillSpec 注册表（数据为主，结构健康） |
| `apps/runner/src/agents/codex.ts` | 402 | Codex CLI backend |
| 其余 | <300/个 | parser、preflight、worktree、profile 等 |

测试共 26 个文件 5581 行（`apps/runner/test/`），覆盖映射见 §4。

---

## 1. orchestrator.ts 职责分解（1968 行）

### 1.1 整体结构问题

`cmdOrchestrate`（L199-L1415）是一个 **约 1200 行的单一函数**，内部用 ~16 个内嵌闭包函数实现各阶段，闭包同时捕获 `ctx`、`project`、`run`、`inputs`、`inputArtifactIds`、`ok` 等多个可变变量（既有 `ctx.inputs` 又有裸 `inputs` 别名，两套引用指向同一对象，见 L237-L273 与 L911/L951 混用）。这使任何一个 executeXxx 都无法被单元测试单独驱动。

### 1.2 行段-职责映射

| 行段 | 职责类别 | 内容 |
|---|---|---|
| L55-L163 | 类型/契约 | OrchestrateOpts、RunCtx、ContextPolicy、ContextRequestCapture |
| L164-L184 | 配置加载 | `loadContextPolicy()`（getConfig 4 连发） |
| L199-L308 | **生命周期骨架** | heartbeat → 建/续 run → worktree prepare → flow 切片 → for 循环 dispatch → finally 上报+清理 |
| L316-L367 | **阶段路由** | `dispatchStep` switch（exhaustive，但 `review` case 内联捆绑 review+verifier+acceptance 三件事，L333-L341） |
| L374-L451 | 阶段实现 | `executeImplementation`（diff 产物 + diff_scope/sensitive 两个 gate） |
| L453-L517 | 阶段实现 | `executeBuildTest`（**硬编码 Maven**：mvnw/mvn、compile/test 命令、jdkVersion） |
| L519-L583 | 阶段实现 | `executeVerifier`（UI 验证媒体 + AC 矩阵） |
| L585-L636 | 阶段实现 | `executeAcceptance`（gate + 人工审批 + 草稿晋升） |
| L643-L815 | 阶段实现 | `executeReport / executeAnalyze / executeScan / executePlan` —— **4 份逐字复制**，仅 stage 字符串不同（每份约 40 行，共 ~170 行可压成 1 个 ~45 行泛化函数） |
| L817-L875 | 阶段实现 | `executeCompletion / executeKnowledgePromotion`（**绕过 api-client 用裸 fetch**，L829-L835、L840-L846） |
| L879-L1064 | 通用阶段助手 | `runContextPack`、`runStage`（requirement/design/review 共用，含 gate+审批） |
| L1066-L1134 | **Agent 调用层** | `invokeSkill`：buildContextPack → agentTaskStarted → backend.run → captureContextRequest |
| L1136-L1414 | 上下文注入伴生 | `captureContextRequest`（L1168-L1305，140 行）、`ensureContextFoundation`、知识使用/信号上报 |
| L1417-L1908 | 纯函数工具 | verifier 媒体识别、`sliceStagesFromStartStage`、`waitForApprovalDecision`、`enforceSensitiveChangeCheckpoint` 等（**已导出、已测试，是好的范本**） |
| L1910-L1968 | 晋升包装 | `promoteAcceptedDraftToKnowledge`（deps 注入，已测试） |

### 1.3 最自然的拆法

orchestrator 实际上是一个隐式状态机：**生命周期骨架 / 阶段路由 / 各阶段步骤 / Agent 调用+上下文注入 / 纯工具** 五层。文件底部已经存在被验证过的模式——`enforceSensitiveChangeCheckpoint`（L1766，deps 注入）和 `promoteAcceptedDraftToKnowledge`(L1940, deps 注入) 都是顶层导出 + 依赖注入 + 有专门测试。拆分即把这一模式推广：

```
orchestrator/
  run.ts            # cmdOrchestrate 骨架 + finally 收尾（~150 行）
  dispatch.ts       # dispatchStep + FLOW 切片
  steps/
    agent-stage.ts  # 泛化的 "agent → markdown artifact" 步骤（吃掉 report/analyze/scan/plan + runStage 的产物落库半段）
    implementation.ts build-test.ts verifier.ts acceptance.ts completion.ts knowledge.ts
  invoke-skill.ts   # invokeSkill + captureContextRequest + ensureContextFoundation（上下文注入层入口）
  approval.ts       # awaitApproval / waitForApprovalDecision / postRejectionFeedback
  verifier-media.ts # L1428-L1535 的纯函数群
```

关键前提：把 RunCtx 从"闭包捕获"改为显式参数（现在 executeXxx 已经都接收 `c: RunCtx`，只有 `runContextPack`/`runStage`/`invokeSkill` 还直接捕获外层变量——这三个是拆分的主要工作量）。

---

## 2. Agent backend 抽象现状

### 2.1 接口定义位置

- **运行时接口 `AgentBackend` 定义在 `apps/runner/src/agents/native.ts:41-50`** —— 即"测试 stub 文件"里。`claude-code.ts:36`、`codex.ts:38`、`orchestrator.ts:33`、`backend-selection.ts:6` 都 `import type ... from './native'`。生产契约寄居在 fixture 文件中，是命名/归属错位。
- 共享类型在 `packages/shared/src/types/agent.ts`：`AgentBackendKind`（L15，含 native）、`ProjectAgentBackendKind`（L17，仅 codex/claude_code）、`AgentBackendPreflight`（L38）。CLI 解析/spawn 助手在 `packages/shared/src/utils/agent-backend-cli.ts`（已良好复用）。
- 接口本身很薄（`kind` + `run(skill, ctx)`），形状合理；问题不在接口而在实现间的复制。

### 2.2 backend 实现间的重复（claude-code.ts vs codex.ts vs llm-fallback.ts）

| 重复逻辑 | claude-code.ts | codex.ts | llm-fallback.ts | 说明 |
|---|---|---|---|---|
| `consumeLines`（readline 逐行） | L443-L453 | L307-L317 | L590-L600 | **三份逐字相同** |
| `exitsZero`（探活 spawn+3s 超时） | L507-L531 | L252-L276 | — | 两份逐字相同 |
| `xxxCliAvailable` | L494-L505 | L239-L250 | — | 仅 backend 名不同 |
| `emit`/`emitMeta`（postAgentEvent + 失败降级日志） | L462-L489 | L319-L344 | L125-L158 | 仅 agentKind/文案不同 |
| `pickFileOutput` | L404-L408 | L301-L305 | — | 逐字相同 |
| `isStructuredContextRequest` | L533-L547 | L356-L369 | — | 逐字相同 |
| `BuildPromptArgs` 接口 | L361-L365 | L278-L282 | — | 逐字相同 |
| `runImplementation` 的 git diff 捕获（git diff → changes.diff + changed-files.txt → 双 output） | L141-L166 | L117-L142 | — | 逐字相同（native.ts L141-L164 还有第三份） |
| produce-file 的"空产物→context_request 探测→报错"三连 | L108-L116 | L87-L95 | — | 结构相同 |
| spawn + 超时 SIGTERM + stdout/stderr 双流消费 | invokeCli L255-L348 | invokeCli L200-L235 | spawnCandidate L426-L481 / spawnCandidateStreaming L483-L552 | **5 份变体**；另 agent-backend-preflight.ts runCli L76-L124 是第 6 份 |
| Claude hooks 隔离 + 用户 env 转发 | L196-L253 | — | runClaudeOneShot L293-L296 + buildCoordinatorChildEnv L554-L588 | 同一套 `AINP_CLAUDE_LOAD_USER_SETTINGS` / `AINP_CLAUDE_HOME_ISOLATION` 逻辑写了两遍 |

差异点（重构时必须保留的真实分叉）：
- claude 有 post-result grace + exit code 调和逻辑（claude-code.ts L263-L337，有专门测试 claude-code-backend-grace.test.ts）；codex 无。
- codex 有 in-workspace staging（`codexStageDir`/`adoptStagedArtifact`，codex.ts L374-L402）因 apply_patch 沙箱限制；claude 直写 artifactsDir。
- lastMessage 来源不同：claude 从 stream result 事件取，codex 从 `--output-last-message` sidecar 文件取。

可提取形状：`agents/cli-common.ts`（consumeLines、exitsZero、cliAvailable、emit 工厂、pickFileOutput、isStructuredContextRequest、captureWorktreeDiff）+ 一个参数化的 `runCliStreaming({argv, env, timeoutMs, onLine, graceConfig?})`。两个 backend 各自保留 ~150 行真实差异。

### 2.3 llm-fallback.ts（815 行）的内部分层

实际混了四件事：① 选择策略（selectionOrder + 可用性探测，L101-L123）；② 两个 one-shot CLI runner（L282-L371）；③ 通用 spawn 助手两份近重复（spawnCandidate vs spawnCandidateStreaming，非流式版可直接委托流式版）；④ **纯 JSON 决策解析器**（extractFinalAssistantText / jsonObjectCandidates / extractDecisionObject / parseDecision，L616-L815，约 200 行纯函数）。④ 拆成 `coordinator/decision.ts` 零风险且测试最厚（coordinator-llm-fallback.test.ts 673 行主要打这里和注入 deps 的 classifyByLlm）。

### 2.4 与 apps/api 的同名文件对比

- **agent-backend-preflight.ts：几乎完全重复**。`diff apps/runner/src/agent-backend-preflight.ts apps/api/src/agent-backend-preflight.ts` 仅 10 行差异——api 版多了 `backend == null → notConfiguredAgentBackendPreflight()` 分支。`runFirstSuccessfulCli`/`runCli`（~100 行 spawn 逻辑）逐字相同。注意：纯分类部分已在 `packages/shared/src/utils/agent-backend-preflight.ts`，但 spawn 部分依赖 node:child_process，而 @ainp/shared 被 web 前端消费，直接上移有打包风险——需要 node-only 入口（如 `@ainp/shared/node`）或接受统一到一处后另一方 HTTP 调用。
- **digest.ts：部分重复**。runner 版（14 行：sha256Buffer + sha256CombinedStreams）与 api 版（21 行：sha256Buffer + sha256File + verifyFileSha256）共享 `sha256Buffer`。重复量小，优先级低。
- flows/registry.ts 已是 9 行 re-export shim（FLOW_REGISTRY 已上移 shared），是历史去重的成功案例，可作为 preflight 去重的参照。

---

## 3. 坏味道清单（按文件，附行号证据）

### orchestrator.ts
1. **巨型闭包函数**：`cmdOrchestrate` L199-L1415，~16 个内嵌函数捕获共享可变状态；`inputs`/`inputArtifactIds` 既经 `ctx` 又经闭包裸名访问（对照 L911 用裸 `inputs` 与 L405 用 `c.inputArtifactIds`）。
2. **四连复制**：executeReport L643 / executeAnalyze L685 / executeScan L733 / executePlan L775 —— 除 stage 字符串外逐字相同。
3. **死参数**：`runStage` 的 `extra: { skipKindOverride?: 'other' }` L968，函数体第一行 `void extra;` L970；调用方 L338 还在传 `{ skipKindOverride: 'other' }`。
4. **死分支**：`runStage` 内 approverGateId 三元的 `'acceptance_gate'` 分支 L1041-L1043 不可达——review 阶段传入的 rulebasedGateId 是 null（L338），整个 gate 块不会进入。
5. **绕过 api-client 的裸 fetch**：L829-L835（completion-report）、L840-L846（knowledge-candidate），各自内联 `process.env.AINP_API_BASE ?? 'http://127.0.0.1:8787'`，与 `config.ts` 的 API_BASE 重复。
6. **错误信号双轨制**：`OkRef`（L108-L113）可变布尔 + throw 混用；多数路径"set ok=false 再 throw"（如 L434-L437），knowledge gate 拒绝则"set 不 throw"（L852-L856 的 V1 quirk）——语义靠注释维持。
7. **Maven 硬编码**：executeBuildTest L454-L456 写死 mvnw/mvn、compile/test 命令；L502 `jdkVersion: c.tools.jdk`；heartbeat 也只回 jdk/maven（L120-L122）。多语言项目无法接入。
8. **重复的 foundation 加载**：runContextPack L880-L921（profile + acceptedKnowledge）与 ensureContextFoundation L1350-L1396 几乎是同一段逻辑两份。
9. **重复的巨型实参列表**：invokeSkill 的 buildContextPack L1072-L1096 与 captureContextRequest 的 buildIncrementalContextPack L1190-L1218 传 ~18 个相同字段。
10. 小杂味：acceptanceCriterionIdsFromInputs L1494-L1496 把 `[...seen].sort().slice(0,50)` 算了 3 遍；`recordKnowledgeReviewSignals` 在循环中逐条 await api 调用 L1142-L1165。
11. **dispatchStep 的 review case 捆绑三件事**（L333-L341）：runStage(review) + executeVerifier + executeAcceptance 内联在路由层，破坏"路由只路由"的层次。

### agents/
12. **接口住错地方**：`AgentBackend`/`AgentTaskContext`/`AgentRunResult` 定义在 native.ts L13-L50（stub 文件），被全部生产代码反向引用。
13. §2.2 表中所列 8 组复制（consumeLines×3、exitsZero×2、emit×3、git-diff 捕获×3 等）。
14. llm-fallback.ts L426-L481 vs L483-L552：spawnCandidate 与 spawnCandidateStreaming 近重复。
15. llm-fallback.ts L626-L643 `extractFinalAssistantText` 手写 stream-json 解析，与 claude-code-parser.ts 已有能力部分重叠。

### context/
16. **builder.ts 1025 行多职责**：pack 组装（L83-L271）+ 增量 pack（L273-L325）+ 成熟度画像启发式（L347-L440）+ 知识评审信号/事实冲突检测（L641-L873，含 L839-L849 基于正则的 `extractFacts`）+ 候选构造（L494-L639）+ 各种 normalize 工具（L835-L938）。全部纯函数、互相独立，天然可拆为 `maturity.ts` / `signals.ts` / `candidates.ts`。
17. retriever.ts、renderer.ts、request.ts 结构健康，无需动。

### 跨 app 重复
18. agent-backend-preflight.ts runner/api 双份（§2.4，10 行 diff）。
19. digest.ts sha256Buffer 双份（§2.4）。

---

## 4. 测试覆盖映射（apps/runner/test/，26 文件 5581 行）

| 源区域 | 测试 | 覆盖度 |
|---|---|---|
| orchestrator 纯导出（sliceStagesFromStartStage / waitForApprovalDecision / enforceSensitiveChangeCheckpoint / agentUserRequestForOrchestrate / promoteAcceptedDraftToKnowledge） | orchestrator-start-stage(103) / approval-wait(23) / sensitive-checkpoint(156) / orchestrator-user-request(43) / promote-to-knowledge(198) | 好（deps 注入式） |
| **cmdOrchestrate 内嵌闭包（dispatchStep、executeXxx、runStage、invokeSkill、captureContextRequest）** | **无任何直接测试** | **空白——重构最大风险点也是最大收益点** |
| ClaudeCodeBackend（含 grace/exit 调和） | claude-code-backend(483) + claude-code-backend-grace(157) + claude-code-parser(155) | 很好 |
| CodexBackend（含 staging） | codex-backend(352) + codex-parser(166) | 很好 |
| backend-selection / preflight | backend-selection(187) | 好 |
| coordinator（classifyByLlm 选择策略 + 决策解析 + 降级） | coordinator-llm-fallback(673) + coordinator-degraded-fallback(185) + coordinator-rules(161) | 很好 |
| context 注入层 | context-builder(556) + context-retriever(159) + context-renderer(278) + context-request(211) | 很好 |
| flows / knowledge / profile / worktree / watch / reports | flow-registry(377) / knowledge(219) / profile(68) / worktree-remote-source(94) / watch(301) / reports(29) | 中-好 |
| native sidecars | native-sidecars(77) | 够用 |

---

## 5. 重构建议（按 收益/风险 排序）

| # | 建议 | 收益 | 风险 | 测试支撑 |
|---|---|---|---|---|
| R1 | **合并 executeReport/Analyze/Scan/Plan 为一个 `executeAgentMarkdownStage(stage, c)`**（orchestrator.ts L643-L815，-170 行） | 高 | 低（机械替换，行为逐字等价） | 无直接单测，但 flow-registry.test 锁定 stage 集合；建议合并时为泛化函数补一个注入式单测 |
| R2 | **把 AgentBackend/AgentTaskContext/AgentRunResult 从 native.ts 移到 `agents/types.ts`**（native.ts 留 re-export 防 churn，模式同 flows/registry.ts shim） | 中高 | 极低（纯类型移动，tsc 即验证） | 全部现有测试 + typecheck |
| R3 | **提取 `agents/cli-common.ts`**：consumeLines、exitsZero、cliAvailable 工厂、emit/emitMeta 工厂、pickFileOutput、isStructuredContextRequest、captureWorktreeDiff（§2.2 表） | 高（-250 行左右，新 backend 接入成本骤降） | 低 | claude-code-backend(483+157) 与 codex-backend(352) 两侧都有行为级测试兜底 |
| R4 | **清理 orchestrator 死代码与裸 fetch**：删 `extra`/`skipKindOverride`（L338/L968/L970）、删不可达 acceptance_gate 分支（L1041-L1043）、completion/knowledge 两处裸 fetch 收进 api-client | 中 | 低 | api-client 形状由编译器约束；建议补 watch/api 侧 stub 验证 URL |
| R5 | **拆 llm-fallback.ts**：决策解析 ~200 行纯函数 → `coordinator/decision.ts`；spawnCandidate 委托 spawnCandidateStreaming | 中高 | 低 | coordinator-llm-fallback.test(673) 直接覆盖解析与注入路径 |
| R6 | **拆 context/builder.ts** 为 builder/maturity/signals/candidates 四个模块（导出面不变） | 中 | 低中（纯函数搬移，需保持导出兼容） | context-builder.test(556) 全是公开函数级断言 |
| R7 | **cmdOrchestrate 去闭包化**：executeXxx/runStage/invokeSkill 提为顶层函数，RunCtx+ApiDeps 显式传参（推广 enforceSensitiveChangeCheckpoint L1766 的既有 deps 模式），再按 §1.3 分文件 | 最高（可测性从 0→可注入） | 中（闭包捕获别名多，需一次只迁一个函数 + 为每个迁出函数补单测） | 现有 orchestrator 测试只兜纯函数；**此项必须伴随新增测试**，建议作为多 PR 串行 |
| R8 | **runner/api preflight 去重**：spawn 部分上移到 node-only 共享入口（注意 @ainp/shared 被 web 消费，不能直接放主入口；参照 FLOW_REGISTRY 上移的先例但需 `exports` 子路径如 `@ainp/shared/node`） | 中 | 中（打包边界） | backend-selection.test(187) + api 侧测试 |
| R9 | executeBuildTest 的构建命令抽象（去 Maven 硬编码，按 project profile/config 决定命令） | 高（扩展性） | 高（**行为变化**，超出纯重构边界，建议单独立项） | 无现成测试；不建议混入本轮 |
| R10 | digest.ts 合并 | 低 | 低 | 顺手项，可并入 R8 |

推荐执行序：R1→R2→R4（一个 PR，纯减法）；R3、R5、R6 可并行；R7 串行多 PR 最后做；R8/R10 视打包方案；R9 不属于本轮"行为不变"重构。

## Caveats / Not Found

- 未运行测试套件验证当前绿基线（任务范围为只读分析）；R7 动手前应先确认 `apps/runner` 测试全绿。
- `apps/api/src/agent-backend-preflight.ts` 只读了前 60 行 + 全文 diff（diff 共 10 行差异，足以下结论）。
- @ainp/shared 是否已有 node-only 子路径导出未深查（R8 需先确认 package.json `exports`）。
