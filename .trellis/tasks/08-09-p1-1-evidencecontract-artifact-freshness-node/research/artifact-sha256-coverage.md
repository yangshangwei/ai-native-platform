# Research: Artifact sha256 的实际覆盖面与既有校验机制

- **Query**: `Artifact.sha256` 什么时候被计算和写入？是所有 artifact 都有还是部分？有没有已经在用它做比对的地方？
- **Scope**: internal
- **Date**: 2026-08-09

## 速答

1. sha256 **只在 artifact 创建那一刻**计算，且**只对 `file://` URI** 计算，非 file URI 一律为 `null`。（已验证）
2. **重校验机制已经存在并且已经在跑** —— 每次通过 API 读 artifact 内容都会重算当前文件 sha256 并与落库值比对，产出三态 `verified: true | false | null`。（已验证）
3. **缺的不是检测，是后果。** `verified === false` 目前的唯一消费方是 web 上的一个文案 pill。没有任何 gate 规则、node 状态或传播逻辑读它。（已验证）

这条结论直接决定 P1-1 的解法：不需要发明 digest 机制，需要给已有的 mismatch 信号接执行方。

## Findings

### 写入侧：唯一的计算点

`apps/api/src/workflow-engine.ts:862-896` 是唯一的 artifact 落库入口：

```ts
export function createArtifact(input: CreateArtifactInput): Artifact {
  const sha256 = input.uri.startsWith('file://')
    ? safeFileSha256(input.uri.slice('file://'.length))
    : null;
```

`safeFileSha256`（同文件 890-896）吞掉所有异常返回 `null`，底层是 `sha256File`（`packages/shared/src/node/digest.ts:12-14`）。

覆盖面（已验证）：

| artifact 来源 | URI 形态 | 有 sha256？ |
|---|---|---|
| runner 各 step 产出（diff / requirement / design / review / verifier matrix / command log …） | `pathToFileUri(...)`，`apps/runner/src/orchestrator/steps.ts` 内 17 处 | 有 |
| rejection_feedback | `mem://rejection_feedback/...`（`apps/runner/src/orchestrator/approval.ts:25`） | **无（null）** |
| project capability 卡片 | `mem://project-capability/...`（`apps/web/src/page-projects.ts:1248`） | **无（null）** |
| 文件读取失败（路径已删 / 权限） | file:// | **无（null）**，静默降级 |

所以「所有 artifact 都有 sha256」不成立，但**P1-1 关心的 run 内证据类 artifact 基本都是 file:// 且都有**。`mem://` 是少数派且都不是证据链上的东西。

类型层对此是**诚实**的 —— `packages/shared/src/types/artifact.ts:647-648` 注释写明 "Null for non-file or legacy artifacts"。

DB 侧 `sha256 TEXT`（可空），见 `apps/api/src/store/db.ts:193`，迁移编号 19（`db.ts:537`）。

### 已经在用它做比对的地方（这是关键发现）

`packages/shared/src/node/digest.ts:16-20`：

```ts
export function verifyFileSha256(path: string, expected?: string | null): DigestVerification {
  const actual = sha256File(path);
  if (!expected) return { algorithm: 'sha256', expected: null, actual, verified: null };
  return { algorithm: 'sha256', expected, actual, verified: actual === expected };
}
```

调用链（已验证，全部是生产路径）：

- `apps/api/src/artifact-content.ts:36` — `readFileUriContent` 每次读都调 `verifyFileSha256`
- `apps/api/src/artifact-content.ts:22-24` — `readArtifactContent(artifact)` 传入 `artifact.sha256`
- 上游消费方：
  - `apps/api/src/routes/artifacts.ts:15,27` — artifact 内容接口
  - `apps/api/src/routes/command-runs.ts:15-16` — stdout/stderr（用 `CommandRun.stdoutSha256` / `stderrSha256`）
  - `apps/api/src/reports.ts:443,646`、`apps/api/src/context-governance.ts:277` — 只取 `.text`，**丢弃 `.digest`**

也就是说：**只要有人在 UI 上打开一个 artifact，平台就已经知道它是否被改过了。**

### 消费侧：信号目前只到 UI 文案为止

`apps/web/src/page-task-detail.ts:2830-2834`：

```ts
function digestStatusText(digest: DigestVerificationDto): string {
  if (digest.verified === true) return 'sha256 verified';
  if (digest.verified === false) return 'sha256 mismatch';
  return 'sha256 untracked';
}
```

渲染点 `page-task-detail.ts:2814`（mismatch 显示红色 pill）、`2744`（command 日志）。

**API 侧零消费**（已验证）：`grep "verified" apps/api/src` 只命中 `gate-engine.ts:503` 的正则字面量和两处注释，没有任何 gate 规则读 `DigestVerification.verified`。

### gate 目前只检查 digest「在不在」，不检查「对不对」

`apps/api/src/gate-engine.ts` 里三处 sha256 相关判定，全部是**存在性**检查：

- `1171-1173` — `fileArtifactsMissingDigest`：file:// 但 `!artifact.sha256`
- `1231-1240` — 规则 `evidence.artifact_digests_present`，注意 status 是 **`warn` 不是 `fail`**
- `1461-1463` — `digestFailures`：verifier artifact 缺 digest
- `1162-1164` — `commandsMissingDigest`：CommandRun 三个 digest 字段

没有一处比较 expected vs actual。

## Caveats / Not Found

- 未验证 `AINP_ARTIFACTS_DIR` 之外的 artifact 读取行为 —— `artifact-content.ts:48-59` 有 root 白名单，超出会抛错，此时 digest 校验根本不会发生（读取先失败）。这意味着**沙箱外的 artifact 既读不到也校验不了**，P1-1 若要做全量扫描需注意这个边界。
- 未统计现网 DB 里 `sha256 IS NULL` 的实际比例（需要跑库，本次未执行）。
- `CommandRun` 的三个 digest 走另一套写入路径（`apps/runner/src/command-runner.ts:155-157`，对 buffer 而非文件算），与 artifact 的 sha256 是**并行的两套**，但语义一致，`readFileUriContent` 对两者复用同一个 `verifyFileSha256`。
