# PRD: web 影子 DTO 从 shared 派生，终结静默漂移（路线图 T2.4）

## 背景与决策

施工图：本任务 research/web-dto-drift.md（实施前必读，含逐 DTO 派生表达式草案与风险清单）。
研究核实了两个关键事实：shared 的 id 全是普通 string 别名（派生零摩擦）；web 测试不在 typecheck 范围，
"容忍 legacy fixture"的弱化理由对 CI 门禁不成立。
决策：**手抄影子接口 → 从 `@ainp/shared` 类型派生**（Pick/Omit/显式 Weaken/Optionalize），
零运行时行为变化；shared 类型变更从此变成 web 编译错而非静默漂移。

## 范围

### R1 派生模板与影子替换（核心）
- 引入 `Weaken<T,K>`（弱化为 string，逐使用点注释原因）与 `Optionalize<T,K>` 模板。
- 按研究报告 §3.2 草案逐个替换：
  - projection.ts 8 个有 shared 源的 DTO + RunDetail 内联 steps/agentTasks/agentResults 形状
  - types.ts：ProjectDto（`Omit<Project,'sourceCredential'...>` + `hasSourceCredential?` 注明出处）、
    WorkflowRequestDto、AgentBackendPreflightDto（直接 alias）、删除逐字重抄的
    ProjectSourceKind/ProjectSourceAuthKind/ProjectAgentBackendKind/AgentBackendKind（改 re-export shared）
  - settings-projection.ts：`SettingsTabId = ConfigCategory`、`ProjectionConfigEntry = ConfigEntry`
  - page-settings.ts:40-66 的第三套 Config*Dto 三胞胎改 import settings-projection 的导出
  - 删除 projection.ts 的 `WorkflowRequestSummary`，统一用 WorkflowRequestDto
- 收紧档/保守档逐字段判定（依研究 §2 对账表）：
  - **收紧**：各 status（fixture 字面量全合法）、`flowId`/`startStage`/`sourceBranch`（wire 必有）、
    `CommandRunDto` 补 `timedOut/truncated` 等缺失字段、`ArtifactDto.kind: ArtifactKind`
  - **保留弱化/可选（显式声明）**：`Artifact.metadata`（Optionalize，src 已按可空处理）、
    `cwd/stage` 等现有代码依赖 optional 的点可 Optionalize（以最小 src 改动为准，逐点注释）

### R2 真实类型缺口修复（研究 §5.a，唯一需要判断的点）
projection.ts 报表三函数（reportNeedsAttention/reportIsAcceptable/reportIsRunning）拿 run.status 比较
`'awaiting_clarification'/'completed'/'claimed'`——这些是 WorkflowRequestStatus 的值，API 从不在 run 上产出。
实施时先查调用方（page-reports 等）确认实参到底是 run 还是 request：
- 若同时喂两种 → 参数类型显式声明为二者状态联合（或 string + 注释），**逻辑一字不动**
- 若纯死分支 → 删除比较项（运行时不可达，删除零行为变化），并在汇报中给出"不可达"的证据链
**红线：本任务不允许任何运行时行为变化；拿不准就保留逻辑、放宽参数类型并注释。**

### R3 测试 fixture 类型对齐
tsconfig 不动（test 仍不进 typecheck gate），但把 projection.test.ts 等 fixture 补成类型合法
（约 10 个对象补字段，研究 §5.c），保证 IDE 无红线、为未来纳入 gate 铺路。fixture 补的字段值要符合
被测函数语义（如 run 补 `type:'feature'`、`updatedAt` 等中性值），断言零改动。

### R4 登记不动项
api 私有影子（Runner/Approval/WorkflowAction/ContextGovernance/Config Override+Audit 等 9 个）与
web 独有文档解析形状（RequirementDoc 等）：在任务 notes.md 登记为"wire 契约下沉 shared"的后续候选清单，本任务不碰。
`DigestVerificationDto` 不碰（源在 @ainp/shared/node，web 禁引子路径）。

### R5 spec 更新
`.trellis/spec/web/frontend/type-safety.md`：新增"影子 DTO 必须从 shared 派生，弱化必须经 Weaken/Optionalize
显式声明并注释原因；禁止手抄平行接口"的纪律与范例。

## 验收标准
1. `bun run typecheck` 通过；`bun x --bun vitest run` 718 全绿且**断言零改动**（fixture 仅补字段）
2. `grep` 证据：projection.ts/types.ts/settings-projection.ts 不再有与 shared 实体平行的手写字段列表
3. 冒烟：7 页渲染正常、console 零错误（重点 reports 页——R2 触碰其状态判定函数的类型）
4. R2 的处理给出证据链；全部弱化点带注释
