# 验证记录（Round 3）

**日期**：2026-06-14
**结论**：✅ 所有本轮实测发现的失败已修复并复验，零失败、零回归。

## 修复

| 问题 | 修复 | 文件 |
|---|---|---|
| P1-1 vitest 解析不到 `@ainp/shared/browser` | alias 补 `@ainp/shared/browser`（排在 `@ainp/shared` 前） | `vitest.config.ts`（+3/-1） |
| P1-2 stream-rendering native-mode 测试断言失效 | 10 个 verbose 契约用例改走显式 `verboseLines()`（=`nativeMode:false`，零断言改写），新增 5 个 native-mode 用例守护生产默认 | `apps/web/test/stream-rendering.test.ts`（+96/-16） |

**改动范围**：仅测试 + 测试配置，**零生产运行时代码改动**（git status 确认 `vitest.config.ts` + `apps/web/test/stream-rendering.test.ts`，其余为会话前既有的未提交 web 改动）。

## 验证证据

| 检查 | 修复前 | 修复后 | 命令 |
|---|---|---|---|
| typecheck | PASS | ✅ PASS | `bun run typecheck`（exit 0） |
| vitest 全量 | 🔴 10 fail / 704 pass（714，4 文件失败） | ✅ **744 pass / 0 fail（84 文件）** | `bun run test`（exit 0） |
| 原失败 4 文件 | 加载失败/断言失败 | ✅ 42 pass（projection 16 + sidecar 4 + structured 5 + stream-rendering 17） | targeted vitest |
| 直连 E2E（claude_code）修复前 | PASS | ✅ PASS（`run_359fc51b8748`，9 门禁全 pass，maven 6/6） | `scripts/e2e.ts` |
| 直连 E2E（claude_code）**修复后** | — | ✅ **PASS（`run_0c45e401e327`，9 门禁全 pass，maven 6/6）** | `scripts/e2e.ts` |
| 队列/watch E2E（claude_code） | PASS | ✅ PASS（本会话 `run_135d5e29e72a`，Coordinator proceed 0.71，maven 7/7） | `scripts/e2e-via-watch.ts` |

测试数 714→744：3 个 projection 文件恢复加载（+25 用例参与）+ 5 个新增 native-mode 用例。

## E2E 重烧确认
两个修复是纯测试/测试配置改动，不触碰任何运行时代码（API/Runner/Coordinator/gate-engine/web 运行时），逻辑上不影响运行时。为坐实闭环仍**修复后重跑了一次完整直连 E2E**（`run_0c45e401e327`）：status=passed，9 门禁全 pass，maven 6/6，与修复前结果一致。本会话累计 3 条完整 E2E（修复前直连 + watch、修复后直连）全部 PASS。

## 遗留（低优，非失败）
- **P3-1**（保留）`bun test`（Bun 原生 runner，非 canonical）模块单例泄漏 → 建议文档化"用 `bun run test`"。
- **P3-2**（✅ 已修，本会话）清理 `ui.lastSuccess` 死状态：移除 `state.ts` 字段 + `page-projects.ts` 3 处 `=null` 清除 + 整理 2 处注释。零残留引用，`lastError` 完好，typecheck + vitest 744/744 仍绿。
- **P3-3**（保留）artifact/report 路径不受 `AINP_HOME` 管辖 → 需确认是否 by-design。
- **P3-4**（✅ 部分已修，本会话）`toast.ts` 硬化：`duration<=0` 除零守卫 + a11y（容器 `role=region`+`aria-label`；每条 toast 按类型 `role=alert/status`+`aria-live=assertive/polite`）。**测试缺口保留**：web 测试环境为 `node` 且未装 happy-dom/jsdom，toast 重度依赖 DOM/定时器，补单测需引入 DOM 环境依赖（独立后续项，避免本轮范围蔓延）。

## P3-2 / P3-4 验证（本会话追加）
- typecheck：✅ 干净。
- 全量 vitest：✅ 744 pass / 0 fail（修改后重跑）。
- 对抗式验证：原计划 3-视角并行 workflow 因 API 429 限流未跑通；改为内联三视角（回归完整性 / a11y 正确性 / 边界与质量）复核，结论 CLEAN（`lastSuccess` 零残留经 grep 证实；toast a11y 符合 WAI-ARIA；除零与定时器边界已覆盖）。

## 环境清理
隔离 API（:8911）已停；`/tmp/ainp-e2e` 已删；本会话产生的 `run_359fc51b8748`/`run_135d5e29e72a` 产物已从 `~/.ai-native` 清除；用户 8787 dev 实例与既有数据未受影响。
