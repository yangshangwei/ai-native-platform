# PRD — E2E 全功能测试与整改（Round 3）

## 目标
对 AI Native Platform 当前工作树（`feat/context-injection-layer-mvp`，含 8 个未提交 web 改动 + 最近的 browser-safe entry point 提交）跑一次完整的端到端测试，产出测试报告 + 问题清单 + 整改方案，然后按方案修复、重跑 E2E、验证直至零失败。

## 背景
- 上一轮审计 `06-10-business-flow-end-to-end-audit` 在 **未引入** 当前这批未提交改动与 `2aac89f` 之前为绿。本轮针对**当前工作树**重新验证。
- 系统是 9 阶段交付闭环：`init → context_pack → requirement → design → implementation → build_test → review → completion → knowledge`，Runner 调真实 `claude`/`codex` CLI，门禁由 API gate-engine 决定。

## 范围内
1. 静态检查：`bun run typecheck`、`bun run test`（canonical vitest）。
2. 动态 E2E：隔离实例（独立端口 + 临时 DB + 临时 HOME）跑 `scripts/e2e.ts`（直连 orchestrate）与 `scripts/e2e-via-watch.ts`（队列/watch + Coordinator）。
3. 记录所有失败/隐患，按严重度定位 file:line + 根因 + 整改方案 + 验证方式。
4. 实施整改，重跑直至 typecheck + vitest + 两条 E2E 全绿。

## 范围外
- 不改业务流水线语义、不引入 Docker/K8s/microVM（遵循既定非目标）。
- 不动上一轮已通过、与本轮失败无关的代码。
- Codex 后端 401 鉴权（外部环境问题）不在产品修复范围。

## 验收标准
- AC-1：`bun run typecheck` 通过。
- AC-2：`bun run test`（vitest）0 失败（当前 10 失败 / 4 文件需归零）。
- AC-3：直连 E2E（claude_code）`run.status=passed`，9 命名门禁全 pass，maven 测试全绿。
- AC-4：队列/watch E2E（claude_code）Coordinator proceed + 全生命周期通过。
- AC-5：每个修复都对应一个本轮实测到的具体失败，且有重跑证据。
- AC-6：测试报告（test-report.md）记录绿/降级/阻塞状态与证据。

## 已知问题（实测，详见 test-report.md）
- P1：vitest 无法解析 `@ainp/shared/browser`（alias 缺子路径）→ 3 个 projection 测试文件加载失败。
- P1：`stream-rendering.ts` 引入 nativeMode（默认 true）→ 10 个 stream-rendering 测试断言旧前缀失败。
- P3：`bun test`（Bun 原生 runner）模块单例泄漏；`ui.lastSuccess` 死状态；artifact 路径不受 AINP_HOME 管辖；toast 无测试/无 aria-live。
