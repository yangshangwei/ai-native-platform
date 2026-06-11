# PRD: 架构审查与简化重构（行为保持）

## 背景

全仓约 5 万行（api/runner/web/shared 四包）。四份架构研究（见 research/）一致指出：分层与不变式设计良好（workflow-engine 唯一写入者、gate-engine 唯一判定者、runner 只汇报事件、shared 零 I/O 纪律），但存在大量**机械重复**与**巨石文件**，拉高了扩展成本。

## 目标

在**不改变任何外部行为**的前提下，让代码更简洁、更可扩展、更优雅。安全网 = 既有测试（api 30 / runner 26 / shared 9 / web 7 个测试文件，HTTP 黑盒为主）+ typecheck + 重构前绿色基线。

## 本轮范围（按收益/风险筛选，全部为行为保持型）

### Batch 1 — shared 下沉（先行，api/runner 依赖它）
- S1: `KNOWN_FLOW_IDS` 从 `FLOW_REGISTRY` 派生导出 + `isFlowId` 守卫，消除 api/routes/workflow-runs.ts:33 与 runner/index.ts:10 两份字面量；`WorkflowStage` 守卫（`isWorkflowStage`）下沉 shared，消除 api 内 3 处重复（workflow-runs.ts:45-63、runner-events.ts:293-312、workflow-requests.ts import）
- S2: shared/utils 新增 `errorMessage(err)`，替换全仓 49 处 `err instanceof Error ? err.message : String(err)`
- S3: digest 合并：`sha256Buffer` 等纯 Buffer 函数下沉（注意 shared 禁 node:fs/child_process，文件类函数留 app 层）

### Batch 2a — apps/api（与 2b 并行）
- A1: store.ts 引入表定义工厂，消除 22 个实体的同构 Row 映射样板（预计 -700 行）；顺带删除 MapLike 双参 set 遗留签名
- A3: routes 公共 helper（404 守卫 / jsonError），消 workflow-runs.ts 11 处样板
- A4: reports.ts 提取 `persistReportPair()`（3×60 行同构尾部）
- A5: gate-engine：合并逐字相同的 matchRequirementSection/matchDesignSection；合并 uniqueCommands/uniqueArtifacts 为泛型 uniqueById；requirement/design gate 规则表化（如改动过大可只做合并）
- A6: `audit()` 独立成模块，消除 gate-engine 内联双轨

### Batch 2b — apps/runner（与 2a 并行）
- R1: 合并 executeReport/Analyze/Scan/Plan 四份逐字复制为一个泛化函数（-170 行）
- R2: AgentBackend 接口从 native.ts（stub 文件）移到 agents/types.ts，native.ts 留 re-export
- R3: 提取 agents/cli-common.ts（consumeLines×3、exitsZero×2、pickFileOutput×2、isStructuredContextRequest×2、git diff 捕获×3 等，约 -250 行）；保留 claude grace / codex staging 等真实分叉
- R4: 死代码清理（runStage 的 void extra、不可达 acceptance_gate 分支）+ completion/knowledge 两处裸 fetch 收进 api-client
- R5: llm-fallback.ts 拆出 ~200 行纯 JSON 决策解析 → coordinator/decision.ts；spawnCandidate 委托 spawnCandidateStreaming

### Batch 3 — 收尾
- 全量 typecheck + vitest；trellis-check 质量检查

## 明确不做（记入后续路线图，不混入本轮）
- web main.ts（7396 行、零测试）的 9 步拆分 —— 单独立项，需配套手动冒烟
- executeBuildTest 去 Maven 硬编码 —— 行为变化，非纯重构
- claimWorkflowRequest 原子化（TOCTOU 修复）—— 正确性修复需配并发测试，单独做
- db.ts 迁移显式化 —— 牵动 29 个测试 bootstrap
- preflight spawn 壳去重 —— 需要 node-only 共享包的架构决策
- web 影子 DTO 统一 —— DTO 弱化是刻意兼容，需单独评估

## 验收标准
1. `bun run typecheck` 通过
2. `bun x --bun vitest run` 全绿（与基线一致）
3. 无任何 API 行为 / 事件格式 / 产物格式变化（纯内部重构）
4. 净删行数显著为正（预期 -1000 行以上）
