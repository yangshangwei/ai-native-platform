# P1-3 统一持久化安全边界：让脱敏覆盖所有落盘路径

## Goal

`maskSecrets` 已是完备的共享实现，但只在 agent stream 与 coordinator 路径被调用。**命令输出与 diff 原样写盘** —— 而这两者恰恰最容易带凭据（`mvn -Dtoken=…`、失败堆栈里的连接串、误提交的 `.env` diff）。

本任务让所有落盘路径共用同一个脱敏边界。

来源：`.trellis/tasks/archive/2026-08/07-30-umadev/research/comparison.md` P1-3 段。

## What I already know（已核实，AINP @ `6f249d1`）

* `packages/shared/src/utils/redaction.ts:5-18` — `maskSecrets` 覆盖 5 类模式：`sk-*`、GitHub `gh[pousr]_*`、`Bearer *`、`api_key|token|credential|secret = *`（大小写两版）。
* **调用方只有 4 个文件**（已 grep 统计）：`agents/claude-code.ts`、`agents/cli-common.ts`、`agents/codex.ts`、`agents/coordinator/llm-fallback.ts`。全是 agent 相关。
* `apps/runner/src/command-runner.ts:126-128` — stdout/stderr **原样 `writeFile`**，该文件完全没有 import `maskSecrets`。
* `apps/runner/src/agents/cli-common.ts:155,159` — diff 与 names-only **原样 `writeFile`**。**同一文件的 187-188 行**却对 stream 事件做了 `maskSecrets` —— 不对称就在一个文件里。
* `command-runner.ts:155-157` — `stdoutSha256` / `stderrSha256` / `combinedSha256` 算的是**与写盘同一个 buffer**。

### 关键约束：脱敏必须在算 digest 之前

P1-1 的 `evidence.artifact_digests_match` 规则在读取时重算 sha256 并与落库值比对，不符即 **fail**。

若在写盘后才脱敏，或写盘与 digest 用不同内容，每个含密的命令输出都会被判成"证据被篡改"。所以顺序不可颠倒：**脱敏 → 写盘 → 算 digest**，三者必须基于同一份最终字节。

这不是可选的实现细节，是 P1-1 已上线规则给出的硬约束。

## Requirements

### R1 — 命令输出落盘前脱敏

* `command-runner.ts` 对 stdout/stderr 在写盘前过一遍 `maskSecrets`。
* digest 基于脱敏后的内容计算（见上述约束）。
* stdout/stderr 是 `Buffer`，`maskSecrets` 接受 `string`。转换要处理非 UTF-8 字节不能损坏 —— 二进制输出（如某些工具的进度条）不该被 mangled。

### R2 — diff 落盘前脱敏

* `cli-common.ts:155,159` 的两处 `writeFile` 与同文件已有的 stream 脱敏对齐。
* diff 里的凭据通常来自误提交的配置文件，正是最需要拦住的场景。

### R3 — 单一边界，不是散落的调用

* 不在每个 `writeFile` 前手写一次 `maskSecrets` —— 那会重复第 5 次「两份拷贝会分歧」的错误（`deriveGraphRunStatus` / `parseReviewerVerdict` / `isCommandOnlyText` 已建立纪律）。
* 提供一个「脱敏后写盘」的共享入口，让新增落盘路径默认安全。

### R4 — 测试

* shared：脱敏写盘入口对 5 类模式各有覆盖；二进制内容不被破坏。
* runner：命令输出含 token 时落盘内容已脱敏，且 digest 与落盘字节一致（防止 P1-1 误报回归）。
* runner：diff 含 token 时同理。

## Acceptance Criteria

* [ ] 命令 stdout/stderr 落盘前脱敏，digest 基于脱敏后内容。
* [ ] diff 与 names-only 落盘前脱敏。
* [ ] 落盘脱敏只有一个实现入口。
* [ ] 含密命令输出**不会**触发 P1-1 的 digest mismatch fail（有回归测试）。
* [ ] 二进制/非 UTF-8 输出不被破坏。
* [ ] `npm run typecheck` + `npm test` 全绿。

## Definition of Done

* 质量门 = `npm run typecheck` + `npm test`（无 lint 配置），贴实际输出。
* 测试在 bun runtime 下跑；`npx vitest` 会把 suite 报成 skipped。
* 多层接线按 `.trellis/spec/guides/index.md` § When You Wire A New Input Through Several Layers 做变异验证。
* 未制造第二套脱敏真相。

## Out of Scope

* 不扩充 `maskSecrets` 的模式集合 —— 覆盖面调整与边界统一分开，否则无法判断回归来自哪一侧。
* 不做已落盘历史数据的回溯脱敏。
* 不改 artifact 读取侧的 root 白名单。
* 不碰 P2 的三项。

## Decision (ADR-lite)

### ADR-1：脱敏在写盘前，不在读取时

**Context**：也可以在 `readArtifactContent` 读取时脱敏，保留原始字节。

**Decision**：写盘前脱敏，磁盘上不留明文。

**Rationale**：读取时脱敏意味着凭据仍在磁盘上，任何绕过该读取路径的访问（人工翻 artifacts 目录、备份、日志收集器）都能拿到明文。而且 P1-1 的 digest 校验在读取路径上，读取时脱敏会让"落库 digest"与"呈现内容"永久不一致 —— 等于把刚接通的 mismatch 信号变成噪音。

**Consequences**：脱敏不可逆，误伤的内容（恰好匹配模式的正常文本）无法恢复原文。可接受：`maskSecrets` 的模式要求 `key = value` 形态或已知前缀，误伤面窄。

## 实施结果：R1–R4 全部完成

### 已交付

**R3 单一边界** — `packages/shared/src/node/redacted-write.ts` 的 `writeRedactedFile` 同时负责脱敏、写盘、算 digest 并把三者的结果一起返回。这个设计让「脱敏与 digest 基于不同内容」在类型层就难以写出：调用方拿不到未脱敏内容的 digest。

**R1 命令输出** — `command-runner.ts` 的 stdout/stderr 走该入口。同时修正了一处此前不显眼的不一致：`stdoutBytes` / `stderrBytes` 原本报告的是**限流累加器**的值（用于 `maxLogBytes` 截断判断），而非落盘字节数。脱敏会改变长度，所以现在报告实际写入量。

**R2 diff** — `cli-common.ts:155,159` 两处走同一入口，与该文件 187-188 行早已存在的 stream 脱敏对齐。`size` 也一并改为落盘后的值。

**R4 测试（13 条）** — shared 9 条（5 类模式各一 + digest 一致性 + 二进制保真 + 无需脱敏时返回原 buffer + 已知缺口），runner 4 条端到端（走真实 spawn，因为要防的是接线错误而非函数错误）。

### 变异验证（两次，都精确命中）

| 变异 | 失败数 | 覆盖层次 |
|---|---|---|
| `writeRedactedFile` 跳过脱敏 | 8 条 | shared 单元 6 + runner 端到端 2 |
| digest 取原始内容、写盘取脱敏内容 | 7 条 | 含「digest 与落盘字节一致」专项 |

第二个变异尤其关键：它正是会让 P1-1 的 `evidence.artifact_digests_match` 把**每一个含密命令输出**误判成「证据被篡改」的场景。有专门测试钉住。

### 发现：`maskSecrets` 有一处真实覆盖缺口（已固定，未修）

`-Dapi_key=super-secret-value` **不会**被脱敏。原因是所有赋值模式都用 `\b` 锚定，而 `-D` 的 `D` 与 `api_key` 的 `a` 都是 word 字符，两者之间不存在词边界。

对照之下 `--token=x` **会**被脱敏 —— `-` 不是 word 字符，所以 `-token` 前有边界。所以缺口不是「flag 形式」通用失效，而**特定于字母紧邻前缀**。

这个形式恰恰是 JVM 构建传密最常见的写法（PRD Goal 段我自己举的 `mvn -Dtoken=…` 就是这种）。

未修的理由：PRD Out of Scope 明确写了「不扩充模式集合 —— 覆盖面调整与边界统一分开，否则无法判断回归来自哪一侧」。已加 `KNOWN GAP` 测试断言当前（不足的）行为并注明理由，将来扩充模式时它会变红，提醒实施者更新。

**这个缺口是边界统一之后才变得可测的** —— 在此之前 command-runner 根本不调用 `maskSecrets`，谈覆盖面没有意义。

### 移交清单

* 扩充 `maskSecrets` 模式集合，至少覆盖 `-D<key>=` 与 `-<key> <value>` 两种形式；届时更新 `KNOWN GAP` 测试。
* 历史已落盘数据未回溯脱敏（本轮 Out of Scope）。若要做需评估 P1-1 影响 —— 回溯改写会让所有既有 artifact 的 digest 失配。
