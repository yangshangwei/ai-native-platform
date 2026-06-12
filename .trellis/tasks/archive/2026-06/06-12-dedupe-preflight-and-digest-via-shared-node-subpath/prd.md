# PRD: preflight/digest 去重——`@ainp/shared/node` 子路径（路线图 T4.1+T4.2）

## 背景与选址决策（T4.1，已定）

研究依据：archive/2026-06/06-11-architecture-review.../research/shared-crosscutting.md §2.1/§2.2/§5。
`apps/api/src/agent-backend-preflight.ts` 与 `apps/runner/src/agent-backend-preflight.ts` 约 110 行逐字符重复
（唯一实质差异：api 版入参允许 null → notConfigured）；`sha256Buffer` 在两侧 digest.ts 重复定义。
这些代码依赖 `node:child_process` / `node:crypto` / `node:fs`，被 `.trellis/spec/shared/backend/directory-structure.md`
的"shared 零 I/O"纪律挡在主入口之外。

**决策**：在 `packages/shared` 增加 **`./node` 子路径导出**（`packages/shared/src/node/`），不新建 workspace 包。
理由：单包零新增样板；主入口（被 web 浏览器 bundle 消费）物理上不 re-export node/ 下任何符号，零 I/O 纪律不破；
先例是 FLOW_REGISTRY 上移（研究报告 §2.4 引为参照）。**红线：`src/index.ts` barrel 不得 re-export `src/node/` 的任何内容；
web（apps/web）不得 import `@ainp/shared/node`。**

## 范围

1. **包装配**：packages/shared/package.json `exports` 增加 `"./node": "./src/node/index.ts"`；各 app tsconfig 的 paths
   增加 `@ainp/shared/node` 映射（对照现有 `@ainp/shared` 映射样式）；确认 vitest/Bun 解析正常。
2. **preflight 下沉**：`runCli` / `runFirstSuccessfulCli` / `preflightTimeoutMs` / `preflightAgentBackend`
   移入 `packages/shared/src/node/agent-backend-preflight.ts`。api 的 null 容忍差异用参数化或薄包装保留
   （api 现状：null/undefined → notConfiguredAgentBackendPreflight，行为一字不差）。两个 app 的本地文件改为
   薄 re-export 或直接改 import 调用点（选改动面小者，倾向删除本地文件、调用点直接 import）。
3. **digest 下沉**：`sha256Buffer`（双份）、api 的 `sha256File`/`verifyFileSha256`/`DigestVerification`、
   runner 的 `sha256CombinedStreams` 合并入 `packages/shared/src/node/digest.ts`；
   `sha256CombinedStreams` 的 stream-separator 约定注释（types/command.ts 引用的契约）随函数走。
   两 app 本地 digest.ts 删除，调用点改 import。
4. **补测试**：研究报告标注两侧 I/O 壳与 digest 均无直接单测——在 packages/shared/test/ 补
   `node-digest.test.ts`（含 combined-streams 分隔符契约）与 preflight 执行壳的最小单测（spawn 真实 `node -e`/`sh -c` 级别即可）。
5. **spec 更新**：`.trellis/spec/shared/backend/directory-structure.md` 增补 node/ 子路径的纪律说明
   （何时放 node/、主 barrel 红线、web 禁 import）。

## 不做

- runner 内部 spawn 收集器统一（研究报告 §2.6 评为中高风险行为性差异，另立项）
- llm-fallback / cli-common 的 spawn 主循环（同上）

## 验收标准

1. `bun run typecheck`、`bun x --bun vitest run` 全绿（678 + 新增）
2. 重复消除证据：`apps/api/src/agent-backend-preflight.ts`、`apps/runner/src/agent-backend-preflight.ts`、
   两侧 `digest.ts` 删除或缩为 ≤5 行 re-export shim
3. `grep -rn "@ainp/shared/node" apps/web/src` 零命中；`packages/shared/src/index.ts` 不含 node/ re-export
4. backend-selection、claude-code-backend 等既有测试零改动
