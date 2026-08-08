# P0-3 ExecutionContract + 硬单写者：reviewer 写隔离与 scope-creep 守卫

## Goal

把「只有 implementation 能改 workspace」从 prompt 里的一句建议，变成执行期可检测、可举证的硬不变量。同时给 mutating node 声明期望产出，让「少做了」和「多做了」都能被发现。

来源：`.trellis/tasks/archive/2026-08/07-30-umadev/research/comparison.md` 的 P0-3 建议 + Wave A 第 4 项 + Wave B 第 1 项。

## What I already know

已核对的事实（AINP @ `30ec537`，2026-08-09 复核）：

* `packages/shared/src/types/skill.ts:34` — `toolPolicy.writableGlobs: string[]` 存在。
* **`writableGlobs` 没有任何执行方。** 全仓库唯一的消费点是 `apps/runner/src/context/renderer.ts:56-78`，它把这个数组渲染成 prompt 里的一行文字 `- Writable globs (relative to worktree): …`。**它是给 agent 看的建议，不是约束。**
* `apps/runner/src/skills/index.ts:282` — 只有 `skill.implementation` 声明了非空 `writableGlobs: ['src/**', 'examples/**']`；`skill.review` 等其余 skill 都是 `[]`。
* `apps/runner/src/agents/codex.ts:192-193,211` — Codex **所有 stage** 硬编码 `--sandbox workspace-write`。
* `apps/runner/src/agents/claude-code.ts:442-456` — `computeAllowedTools()` 给 `review` / `design` / `requirement` / `context_pack` 都发了 `Write`。
* `apps/runner/src/agents/codex.ts:349-351` — `codexStageDir()` = `join(workspacePath, '.ainp-artifacts', stage)`。**Codex 的 sidecar 必须写在 workspace 内**，因为 router 的 "inside project" 检查（文件头注释 10-13 行说明了原因）。
* `apps/runner/src/orchestrator.ts:67-69,172` — 最终 artifact 目录 `ARTIFACTS_BASE/<runId>/<stage>/`，其中 `ARTIFACTS_BASE` 默认 `~/.ai-native/artifacts`。**在 worktree 之外。**
* `packages/shared/src/utils/operational-error.ts` — 现有 4 个 reason，注释明确：gate failures / compile-test failures / diff-scope violations **绝不能**包成 OperationalError。

关键推论：artifact 产出路径**已经**基本与 workspace 解耦（最终目录在 worktree 外），唯一的例外是 Codex 的 `.ainp-artifacts/` 临时暂存目录。所以 workspace fingerprint 守卫是可行的 —— 排除这一个目录即可。

## Assumptions (temporary)

* 本轮做**检测 + 举证 + 失败**，不做 backend 级只读沙箱切换（ADR-1）。
* fingerprint 只覆盖 git 可见的工作树状态，不追踪 gitignore 之外的临时文件。
* scope-creep 检查对比的是「声明的 allowed paths」与「实际改动的文件」，不做语义判断。

## Open Questions

无阻塞项。三个设计分叉按 ADR 处理。

## Requirements

### R1 — `ExecutionContract` 类型（shared）

新增到 `packages/shared/src/types/skill.ts` 或独立文件，供 skill 声明：

```ts
export const WORKSPACE_MUTATION_POLICIES = ['deny', 'allow_declared', 'allow_any'] as const;

export interface ExecutionContract {
  workspaceMutationPolicy: WorkspaceMutationPolicy;
  /** 只在 allow_declared 下有意义；沿用既有 writableGlobs 语义。 */
  allowedPaths: string[];
  /** 超过即判 scope creep；null 表示不限。 */
  maxChangedFiles: number | null;
  /** 期望产出的 output 名，用于「少做了」检查。 */
  expectedOutputs: string[];
}
```

* `skill.review` / `skill.verifier` / `skill.debug` → `workspaceMutationPolicy: 'deny'`。
* `skill.implementation` → `'allow_declared'`，`allowedPaths` 复用现有 `writableGlobs`。
* 未声明 contract 的 skill 默认 `'allow_any'`（向后兼容，不改变既有行为）。

### R2 — Workspace fingerprint 守卫（runner）

* 在 agent 调用**前后**各取一次 workspace fingerprint。
* fingerprint 实现用 `git status --porcelain` + `git diff --stat` 的组合（worktree 一定是 git 仓库），**不**做全树哈希 —— 成本不可接受。
* **必须排除** `.ainp-artifacts/`（Codex sidecar 暂存目录），否则 Codex 的 reviewer 会必然误报。这个排除要有显式注释说明原因。
* `workspaceMutationPolicy: 'deny'` 的 skill 出现任何 delta → 失败，且：
  * 记录被改动的文件列表作为 evidence（这是「可举证」的核心）。
  * 归类为**业务失败**，不是 OperationalError —— 契约违规是产品问题，不是基础设施问题（现有注释明确禁止把这类包进 OperationalError）。
* `'allow_declared'` 出现 allowedPaths 之外的改动 → 同样失败并举证。
* `maxChangedFiles` 超限 → 失败并举证。

### R3 — scope-creep 对偶检查

不只查「需求没做」，也查「多改了」：

* **少做了**：`expectedOutputs` 里声明的 output 缺失 → 失败（这条现有 skill outputs 的 `required: true` 已部分覆盖，本任务只需确保 contract 与 outputs 声明不打架）。
* **多做了**：改动了未声明的文件 / 超过 maxChangedFiles / 引入了未声明的依赖变更（`package.json`、lockfile 在 allowedPaths 之外时应命中）。
* 违规信息进 evidence，并且要能被 P0-2 的 `ReviewerVerdict` 或 Gate rule message 引用。

### R4 — 与 P0-2 的衔接

* 违规产生的证据应当能被 Gate 消费为 `RuleResult`，走 P0-2 已建立的「平台侧检查」路径。
* **不**让 agent 自己声明「我没越界」—— 守卫是平台侧的客观测量。

### R5 — 测试

* shared：contract 类型守卫、默认值语义。
* runner：`deny` skill 改了文件 → 失败且 evidence 含文件列表；`.ainp-artifacts/` 内的改动**不**触发失败；`allow_declared` 越界 → 失败；`maxChangedFiles` 超限 → 失败；合规路径正常通过。
* 每条测试的 fixture 必须反映真实的 `git status --porcelain` 输出格式。

## Acceptance Criteria

* [ ] `ExecutionContract` 在 shared 导出，barrel 已补。
* [ ] review / verifier / debug skill 声明 `deny`。
* [ ] reviewer 写 workspace 会被检测到并失败，evidence 含具体文件列表。
* [ ] Codex 的 `.ainp-artifacts/` 暂存不触发误报，有测试固定。
* [ ] scope-creep（多改文件 / 超限）被检测并举证。
* [ ] 违规归类为业务失败，**不**是 OperationalError。
* [ ] 未声明 contract 的既有 skill 行为不变。
* [ ] `npm run typecheck` + `npm test` 全绿。

## Definition of Done

* 质量门 = `npm run typecheck` + `npm test`（本仓库无 lint 配置），贴出实际输出。
* 测试在 bun runtime 下跑（`npm test` 或 `bun test`）；`npx vitest` 会把 suite 报成 skipped。
* 注意：`typecheck` **不覆盖 test 文件**（tsconfig include 只有 `src/**/*`），所以测试里的类型错误不会被门禁发现。

## Out of Scope

* 不切换 backend 到原生只读沙箱（ADR-1）。
* 不改 Codex 的 `--sandbox` 参数、不动 `computeAllowedTools`（同 ADR-1）。
* 不做自动返工（P1-2）。
* 不做 artifact freshness 传播（P1-1）。
* 不统一持久化安全边界（P1-3）。

## Technical Approach

1. **shared**：`ExecutionContract` 类型 + 默认值 + 守卫（纯数据，无 I/O）。
2. **runner**：fingerprint 采集函数 + 前后对比 + 违规判定，挂在既有 agent 调用点外层。
3. **skill 声明**：给 review / verifier / debug 加 `deny`，implementation 加 `allow_declared`。
4. **evidence**：违规详情走既有 artifact / RuleResult 通道，不新建真相。

## Decision (ADR-lite)

### ADR-1：先做检测守卫，不切 backend 只读沙箱

**Context**：最彻底的做法是让 Codex 用 `--sandbox read-only`、Claude 的 review stage 不发 `Write`。

**Decision**：本轮**不**做。只做前后 fingerprint 对比 + 违规失败 + 举证。

**Rationale**：两个 backend 的 artifact 产出路径不对称 —— Claude 靠 `Write` 工具写 `artifactsDir`（worktree 外），Codex 靠 sidecar 写 `workspace/.ainp-artifacts/`（worktree 内，且是 codex router 的 "inside project" 检查所强制，见 `codex.ts:10-13`）。直接切只读会打断 Codex 的产出路径。研究文档的 Wave A 也明确说「先把单写者变成**可测试不变量**」，Wave B 才做完整 ExecutionContract。

**Consequences**：本轮是「检测到并失败」而非「物理上写不进去」。真正的只读执行面依赖 P2-1 的 backend capability contract —— 知道哪个 backend 支持真只读 profile 之后再切。

### ADR-2：违规是业务失败，不是 OperationalError

**Context**：违规后 run 该走 `failed` 还是 `paused`？

**Decision**：`failed`（业务路径）。

**Rationale**：`operational-error.ts` 的头注释明确列出「gate failures、compile/test failures、**diff-scope violations**」不得包成 OperationalError。契约违规正是 diff-scope violation 的同类 —— 它是 agent 做错了事，不是平台跑不起来。混淆两者会让 P0-2 建立的「outage 不计产品返工」语义失效。

**Consequences**：违规不会触发 operational pause 的自动恢复路径，需要人工介入或 P1-2 的有界返工。

### ADR-3：fingerprint 用 git 状态，不做全树哈希

**Context**：fingerprint 可以是全树内容哈希，也可以是 git 视角的变更集。

**Decision**：`git status --porcelain` + `git diff --stat`。

**Rationale**：worktree 一定是 git 仓库（Local Runner + worktree 模式是项目既定架构）。全树哈希在大仓库上成本不可接受，且会把 build 产物、node_modules 等 gitignore 内容算进去，产生大量误报。git 视角天然对齐「什么算改动」的产品语义。

**Consequences**：agent 若改动 gitignore 覆盖的文件，守卫看不见。这是可接受的 —— 那些文件本就不进交付物。

## Technical Notes

* `writableGlobs` 目前唯一的消费点是 prompt 渲染（`renderer.ts:56-78`）。本任务**不删**这个渲染 —— 告知 agent 边界仍然有价值，只是不再是唯一防线。
* 排除 `.ainp-artifacts/` 时，路径要与 `codexStageDir()` 保持单一来源，不要在守卫里硬编码第二份字符串常量。这是 P0-1 `deriveGraphRunStatus` 建立的纪律。
* 写 fixture 时，`git status --porcelain` 的真实输出格式（两字符状态码 + 空格 + 路径）必须照抄，不能凭印象编 —— 见 `.trellis/spec/guides/index.md` § When Reading a Field Another Module Wrote。

## 实施中发现的问题

### 1. 漏了 `.ainp-verifier/`，会让 P0-3 立刻失效（已修）

PRD 只识别了 Codex 的 `.ainp-artifacts/`，漏了 `.ainp-verifier/` —— review 阶段收集 UI 证据的落点（`steps.ts:864` 的错误消息「Missing before+after screenshots or video evidence under `.ainp-verifier/`」证明这是既定约定，`executeVerifier` 从 worktree 读它再复制到 `<runArtifactsDir>/verifier/`）。

致命之处在时序：**放置这些文件的正是 reviewer 自己**，而 `skill.review` 恰好是声明 `workspaceMutationPolicy: 'deny'` 的那个 skill。不排除它，每一次带 UI 证据的 review 都会被判违约 —— 守卫上线即误报。

修法：抽 `WORKSPACE_PLATFORM_STAGING_DIRS` 常量数组，两个平台暂存目录都从 `config.ts` 单一来源取；`verifier-media.ts` 里的硬编码字面量一并换掉。

**教训**：给"谁可以写 workspace"加约束前，必须穷举**平台自己**在 worktree 里落文件的所有位置，而不只是 agent 直接写的位置。平台暂存与 agent 产出在 git 眼里没有区别。

### 2. `expectedOutputs` 声明了但无执行方（已记录，不在本轮补）

`ExecutionContract.expectedOutputs` 被 skill 声明（implementation → `['diff']`，review → `[review.md, review-verdict.json]`），但没有任何代码读取它。

不补的理由：R3「少做了」这半边**已有真实兜底** —— skill outputs 的 `required: true` 在 `steps.ts:1129` 走 operational pause（缺必需产出属于 backend protocol 失败，不是产品返工）。再加一层检查会产生第二套判定，违反「不制造第二套真相」的判断标准。

但字段存在而无人消费，正是研究文档批评的「声明能力远大于生产语义」模式 —— 与 P0-1 发现的「7 种 event 类型有 3 种零写入方」同类。P1-1 做 EvidenceContract 时应当合并这个字段，或者删掉它。

### 3. fail-open：fingerprint 取不到就不判定（有意设计）

`captureWorkspaceFingerprint` 在 git 命令失败/超时/异常时返回 null，此时守卫跳过检查并 `console.warn`，不失败。

理由：worktree 一定是 git 仓库，git 失败属异常路径；此时编造一个业务失败比放行更糟（会把基础设施问题误报成 agent 违约）。当前是本地可信模式。研究文档「不可逆安全项必须 fail-safe」针对的是安全项，本守卫是质量守卫。

若将来扩展到不受信仓库或远程 Runner，这条要重新评估 —— 那时 fingerprint 不可用应当 fail-closed。
