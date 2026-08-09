# P2-1 Backend capability contract：让不对称显式化

## Goal

`AgentBackend` 接口只有 `kind` 和 `run()`。调度侧无法得知某个 backend 能否真正只读执行、能否 resume、权限面有多大 —— 这些差异现在散落在各 backend 实现的注释和硬编码里。

本任务给 backend 加一份能力快照，让调度侧**显式判断并降级**，而不是靠调用方记住每个 backend 的脾气。

**不扩 provider**：研究文档明确写了「不要因为 UMADEV 有五底座就立即扩 provider」。本轮只覆盖已有的 Claude Code 与 Codex。

来源：`.trellis/tasks/archive/2026-08/07-30-umadev/research/comparison.md` P2-1 段 + P0-3 ADR-1 留下的接口。

## What I already know（已核实，AINP @ `e7df0e5`）

* `apps/runner/src/agents/types.ts:41-50` — `AgentBackend` 只有 `kind: 'native' | 'codex' | 'claude_code'` 与 `run()`。
* `packages/shared/src/types/agent.ts:15,19` — `AgentBackendKind` 三值；`PROJECT_AGENT_BACKENDS` 只有 `claude_code` / `codex`（`native` 是测试夹具）。
* `apps/runner/src/agents/claude-code.ts:442-455` — `computeAllowedTools()` 按 stage 发工具。review 拿到 `['Read','Glob','Grep','Write']`。**摘掉 `Write` 在 Claude 侧是可行的**，只要产出改走别的通道。
* `apps/runner/src/agents/codex.ts:193,212` — 所有 stage 硬编码 `--sandbox workspace-write`。
* `codex.ts:10-19` 的文件头注释解释了原因：`codex_core::tools::router` **硬阻止** `--cd` 之外的 `apply_patch`，与 OS 沙箱无关。所以 produce-file stage 必须在 workspace 内暂存再拷出。
* `codex.ts:175,195-196` — `--output-last-message` 也指向 workspace 内的 `.codex-last-message.txt`。

### 核心不对称（这是本任务存在的理由）

两个 backend 达成「只读 review」的路径根本不同：

| | Claude Code | Codex |
|---|---|---|
| 产出通道 | `Write` 工具直接写 `artifactsDir`（worktree 外） | sidecar 写 workspace 内，再拷出 |
| 摘掉写能力 | 可行（改 `computeAllowedTools`） | **不可行** —— last-message 与 staged artifact 都要写 workspace |
| 真只读档位 | 有（不发 `Write`） | 无（`--sandbox read-only` 会打断产出） |

P0-3 因此只做了「检测 + 举证」而非「物理阻止」，并在 ADR-1 写明真只读依赖本任务。

## Requirements

### R1 — `AgentBackendCapabilities` 类型（shared）

至少覆盖 P0-3 与调度侧真正会问的问题：

```ts
export interface AgentBackendCapabilities {
  /** 能否在完全不写 workspace 的前提下完成一次调用。 */
  readOnlyExecution: 'supported' | 'unsupported';
  /** 不支持时说明原因，让降级可解释而非静默。 */
  readOnlyBlockedReason: string | null;
  /** 产出通过什么通道回到平台。 */
  artifactChannel: 'direct_write' | 'workspace_staging';
  /** 会话是否可跨调用恢复。 */
  resume: 'supported' | 'unsupported';
}
```

字段集合以**当前有人要问**为准，不做前瞻性铺陈 —— 声明了没人消费正是本项目反复批评的模式。

### R2 — 两个 backend 各自声明真实能力

* Claude Code：`readOnlyExecution: 'supported'`、`artifactChannel: 'direct_write'`。
* Codex：`readOnlyExecution: 'unsupported'`，理由字符串指向 router 的 in-project 限制；`artifactChannel: 'workspace_staging'`。
* `native`（测试夹具）也要有值，否则类型不完整。

### R3 — 至少一个真实消费方

**这是本任务成立的前提**。能力声明必须立刻被用上，否则就是第 6 处悬空声明。

最小消费方：P0-3 的 workspace guard 在 `readOnlyExecution === 'unsupported'` 时，把违规判定降级为记录而非失败 —— 因为 Codex 的 staging 写入本就无法避免。当前 guard 靠 `WORKSPACE_PLATFORM_STAGING_DIRS` 路径白名单绕开这个问题，能力声明让**原因**变得显式。

若实施时发现该消费方并不需要能力声明（路径白名单已足够），**如实报告并考虑放弃本任务** —— 见 ADR-1。

### R4 — 测试

* shared：类型守卫、能力值的完整性。
* runner：两个 backend 的声明与其实际行为一致（Codex 声明 unsupported 且确实写 staging 目录）。
* 消费方：能力影响判定的那条路径有测试。

## Acceptance Criteria

* [ ] `AgentBackendCapabilities` 在 shared 导出。
* [ ] 三个 backend 都声明能力，Codex 的 `readOnlyBlockedReason` 指向真实原因。
* [ ] **至少一个真实消费方**读取该声明并改变行为。
* [ ] 未扩 provider（仍是 claude_code / codex / native）。
* [ ] `npm run typecheck` + `npm test` 全绿。

## Definition of Done

* 质量门 = `npm run typecheck` + `npm test`（无 lint 配置），贴实际输出。
* 测试在 bun runtime 下跑；`npx vitest` 会把 suite 报成 skipped。
* 按 `.trellis/spec/guides/index.md` § When You Wire A New Input Through Several Layers 做变异验证。
* **不新增无消费方的声明**。

## Out of Scope

* 不扩 provider。
* 不改 Codex 的 `--sandbox` 参数（P0-3 ADR-1 的理由仍然成立）。
* 不改 `computeAllowedTools`（真切只读要等有消费方需要它）。
* 不做 P2-2（运行中输入分流）与 P2-3（检索深化）。

## Decision (ADR-lite)

### ADR-1：没有真实消费方就不做

**Context**：能力快照本身是「可能有用」的抽象。本项目已有 6 处「声明了没有执行方」的债（`GRAPH_EVENT_TYPES` 3 种零写入、`at_risk`、`expectedOutputs`、`getLatestArtifactContent`、`rejection_feedback` 曾经、`recovery` mode）。

**Decision**：R3 的消费方是本任务的**前置条件**而非可选项。若实施中发现没有消费方真的需要它，放弃本任务并如实记录。

**Rationale**：研究文档给 P2-1 的定位是「先定义 capability snapshot 并持久化到 AgentSession，不急着扩到五个 backend」—— 但那个「持久化」本身不构成消费。一个没人读的能力字段，与它试图消除的硬编码相比没有任何改进，只是把知识从注释挪到了类型里。

**Consequences**：本任务可能以「不做」收尾。那也是有价值的结论 —— 它说明 P0-3 的路径白名单方案已经足够，capability contract 应当等到真有第三个 backend 或真要切只读时再做。

## 结论：不做。ADR-1 的前置条件不成立

按 ADR-1 的规定，R3「至少一个真实消费方」是前置条件而非可选项。逐个核查后，**该消费方不存在**。

### 核查过程

**候选 1：P0-3 workspace guard** —— 不需要。

`workspace-guard.ts` 完全不感知 backend（grep `backend|kind` 只命中一处注释和三处无关的 `kind: 'other'` artifact 字面量）。它通过 `isPlatformStagingPath()` 按路径白名单排除 `.ainp-artifacts/` 与 `.ainp-verifier/`，对两个 backend 一视同仁。

关键在于**路径白名单比能力声明更精确**：guard 真正要回答的是「这个具体路径是否属于平台暂存」，而不是「这个 backend 理论上能否只读」。加一层 `readOnlyExecution === 'unsupported'` 判断不会改变任何一个判定结果，只会引入一个必须与路径白名单保持同步的第二事实。

**候选 2：agents 目录外所有按 backend 分支的代码** —— 都不问能力。

| 位置 | 实际在问 |
|---|---|
| `backend-selection.ts:29` | 该 new 哪个类（构造分派） |
| `cmd/watch.ts:176,228` | 项目配置值是否合法（输入校验） |
| `coordinator/decision.ts:174` | 输出格式是 stream-json 还是纯文本（解析器选择） |
| `coordinator/llm-fallback.ts:98,102,115` | CLI 装了吗、fallback 顺序（可用性探测） |
| `coordinator/index.ts:89` | 同上（类型收窄） |
| `llm-fallback.ts:643` | 环境变量开关（与 backend 能力无关） |

没有一处在问「能不能只读执行」「产出走哪个通道」「能不能 resume」。这些是**构造、校验、解析、探测**四类问题，`AgentBackendCapabilities` 一个字段都答不上。

### 为什么这是正确的结论而不是偷懒

本项目已积累 6 处「声明了没有执行方」的债：`GRAPH_EVENT_TYPES` 三种零写入（P0-1 发现）、`AcceptanceBusinessStatus.at_risk`（P1-1）、`ExecutionContract.expectedOutputs`（P0-3 自己留下的）、`rejection_feedback` 曾经（P1-2 修复）等。研究文档对 AINP 的核心批评正是「声明能力远大于生产语义」。

在这个背景下新增第 7 处，还给它配上「这是未来的接口」的说法，是把同一个错误再犯一次并称之为设计。

**P0-3 ADR-1 说「真正的只读执行面依赖 P2-1 的 backend capability contract」这句话本身需要修正**：真只读执行面依赖的是 Codex 有一个不写 workspace 的产出通道 —— 那是 Codex 上游的能力问题，不是 AINP 的类型问题。加一个字段声明「Codex 不支持只读」并不能让它支持。

### 何时该重做本任务

出现下列任一情形：

1. **接入第三个 backend** —— 届时 `backend-selection.ts` 的构造分派与 `decision.ts` 的解析器选择都会变成 n 路分支，能力表才比逐个 `if` 划算。
2. **真要切只读执行** —— 前提是 Codex 提供了 worktree 外的产出通道（或平台改为从 stdout 收产出），那时「哪个 backend 支持只读」成为调度必须问的问题。
3. **guard 需要区分 backend 而非区分路径** —— 例如引入不受信仓库模式，staging 目录本身也要按 backend 差别对待。

三者都未发生。

### 建议：修正 P0-3 遗留的错误指向

`.trellis/tasks/archive/2026-08/08-09-p0-3-*/prd.md` 的 ADR-1 把只读执行面挂在本任务上。该判断有误（理由见上），应当记入 spec 以免下一个人照着做。这是本任务唯一的实际产出。

## P2-2 与 P2-3 的同步核查（同属 P2，一并结论）

本任务原属「P2 三项」，核查 P2-1 时顺带验证了另两项的前置条件。**三项都不该在当前状态动手**，理由各不相同。

### P2-2 运行中输入分流 —— 前置合同未成熟

研究文档原文：「这是高价值 UX，但需要 Graph version、审计和权限合同先成熟」。

核查结果，前置条件确实未满足：

* Graph version 存在（`GraphRun.graphVersion`，P0-1 期间确认），但**没有任何生产写入方产生第二个版本** —— `flowToGraphDefinition` 恒定输出 `version: '1'`。分流中的 `steer` 要求「只在安全边界进入新 graph version」，而 version bump 的语义尚未定义。
* 既有的运行中介入通道是 coordinator 的 `pause_for_human`（`decision.ts:61,177`）与 context-request 补充轮 —— 两者都是**agent 主动发起**，不是用户主动插入。用户侧插入需要新的入站路径。
* 分流的三个类别里，`question`（不改 plan/gate）与既有 `pause_for_human` 语义重叠，`next-task` 实际是「新建一个 request」而非「介入当前 run」—— 三选一里有两个可能根本不属于同一个功能。

先做这个会在 graph version 语义确定之前，把 UX 形状钉死在一个未定的基础上。

### P2-3 检索深化 —— 证明收益的手段不存在

研究文档原文：「不建议默认下载 UMADEV 同类的大模型资产；**先用离线评测证明收益**」。

核查结果：`eval/` 与 `scripts/eval-harness.ts` 存在（有 `fixtures`、`scenarios`、`scenarios-red` 三个目录），但**没有任何检索质量指标** —— grep `recall|precision|ndcg` 零命中。

也就是说，研究文档给 P2-3 设的前置条件（离线评测证明收益）目前**无法执行**。在没有基线的情况下换检索实现，无法判断是改进还是退化。

真正的第一步是给 eval harness 加检索质量指标与标注集，而那本身是一个独立任务，且价值独立于是否最终换实现。

### P2 整体结论

| 项 | 状态 | 阻塞 |
|---|---|---|
| P2-1 capability contract | 不做 | 无消费方（详见上文核查） |
| P2-2 运行中输入分流 | 不做 | graph version 语义未定；三类别中两类可能不属于同一功能 |
| P2-3 检索深化 | 不做 | 收益无法度量 —— eval harness 缺检索指标 |

三项都不是「没时间做」，而是**前置条件不成立**。研究文档给 P2 的整体定位本就是最低优先级，且对每一项都附了条件句 —— 这些条件句现在被逐一验证为未满足。

### 由此产生的后续任务

1. **eval harness 补检索质量指标与标注集** —— P2-3 的真实第一步，价值独立。
2. **graph version bump 语义** —— P2-2 的前置，也是 P0-1 遗留（当前恒为 `'1'`）。
3. 修正 P0-3 ADR-1 对本任务的错误指向（已写入 spec）。
