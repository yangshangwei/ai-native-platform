# 端到端测试报告 + 整改方案

**日期**：2026-06-14
**分支**：`feat/context-injection-layer-mvp`（8 个未提交 web 改动 + HEAD `2aac89f` browser-safe entry point）
**被测对象**：AI Native Platform 当前工作树
**测试者**：Claude（autonomous E2E + 整改闭环）
**隔离环境**：API on `:8911` + `AINP_DB_PATH=/tmp/ainp-e2e/ainp.sqlite` + `AINP_HOME=/tmp/ainp-e2e/home`（未触碰用户 8787 dev 实例）

---

## 总体结论

| 维度 | 结果 | 命令/证据 |
|---|---|---|
| 类型检查 | 🟢 PASS | `bun run typecheck` 全包干净 |
| 单元/集成测试（vitest，canonical） | 🔴 **FAIL** | `bun run test` → **10 失败 / 704 通过（714），4 文件失败** |
| 直连 E2E（claude_code） | 🟢 PASS | `run_359fc51b8748` status=passed，9 门禁全 pass，maven 6/6 |
| 队列/watch E2E（claude_code） | 🟢 PASS | `run_135d5e29e72a`，Coordinator proceed(0.71)，9 门禁全 pass，maven 7/7 |
| `bun test`（Bun 原生 runner，非 canonical） | 🟡 13 失败 | 模块单例跨文件泄漏，属 runner 兼容性 |

**判定**：**业务运行时端到端完全可用（绿）**；唯一阻塞项是 **2 个单元测试回归**，均由近期 web 改动引入，根因清晰、修复隔离。Codex 后端未测（沿用上一轮 401 外部鉴权阻塞结论）。

---

## 问题清单

### P1-1 [高] vitest 无法解析 `@ainp/shared/browser` → 3 个 projection 测试文件加载失败

- **现象**：`bun run test` 中 `apps/web/test/projection.test.ts`、`sidecar-projection.test.ts`、`structured-projection.test.ts` 三个文件 **加载即失败**（0 测试运行）。
  ```
  Error: Cannot find module '@ainp/shared/browser' imported from apps/web/src/projection.ts
  ❯ apps/web/src/projection.ts:1:1
  ```
- **根因**：`vitest.config.ts:8-15` 的 alias 映射只配了 `@ainp/shared/node` 和 `@ainp/shared`，**缺 `@ainp/shared/browser`**。vite 字符串 alias 按前缀匹配，`@ainp/shared` 把 `@ainp/shared/browser` 改写成非法路径 `.../src/index.ts/browser` → 解析失败。注释本身已意识到前缀吞并问题（故 `/node` 排在前），但 HEAD 提交 `2aac89f` 引入 browser 入口时漏加 `/browser`。
- **为何只 projection 挂、stream-rendering 不挂**：`stream-rendering.ts:1` 用 `import type`（编译期擦除，无运行时解析）；`projection.ts:17` 是**值导入** `FLOW_REGISTRY`（运行时解析）→ 触发失败。
- **为何线上 UI / typecheck 不受影响**：`apps/web/serve.ts` 用 `Bun.build()` 即时打包（走 package.json `exports`，正确解析）；tsc 也走 `exports`。**唯独 vitest alias 漏配**。
- **定位**：`vitest.config.ts:8-15`
- **整改方案**：在 alias 中新增（排在 `@ainp/shared` **之前**）：
  ```ts
  '@ainp/shared/browser': new URL('./packages/shared/src/browser.ts', import.meta.url).pathname,
  ```
- **验证**：`bun x --bun vitest run apps/web/test/projection.test.ts apps/web/test/sidecar-projection.test.ts apps/web/test/structured-projection.test.ts` → 3 文件全部加载并通过。

### P1-2 [高] stream-rendering native-mode 行为变更，10 个测试断言未跟进

- **现象**：`apps/web/test/stream-rendering.test.ts` 中 10 个用例失败，期望 `prefix: "[18:30:45 1 Claude Code assistant]"`，实得 `prefix: ""`。
- **根因（有意改动，未提交）**：`apps/web/src/stream-rendering.ts` 给 `buildStreamDisplayLines` 增加 `nativeMode = true` 参数，native 模式下隐藏 `[时间 序号 后端 类型]` 元数据前缀 + 过滤噪声事件；`apps/web/src/stream.ts:123` 显式传 `true`（"Native mode: hide metadata prefixes"）。生产路径已切到 native 模式，但 10 个测试仍按旧 verbose 前缀断言。
- **关键事实**：`nativeMode=false` 分支与旧行为**逐字节一致**（已核对 flushPending prefix/title、renderBoundaryLine prefix、过滤跳过）。被测的合并/边界/去重/通道隔离逻辑本身未变，只是 prefix 字符串变了。
- **定位**：`apps/web/src/stream-rendering.ts:129/192/294/359-376`（源），`apps/web/test/stream-rendering.test.ts`（10 用例）
- **整改方案**：
  1. 把 10 个失败用例的 `buildStreamDisplayLines(events)` 改为 `buildStreamDisplayLines(events, false)`（保留原断言、验证 verbose 契约，零断言改写即通过）。
  2. **新增** native-mode describe 块，覆盖生产默认路径（prefix 为空、meta/raw 噪声过滤），保证默认行为有测试守护。
- **验证**：`bun x --bun vitest run apps/web/test/stream-rendering.test.ts` → 全绿，且新增用例覆盖 native 默认。

### P3-1 [低] `bun test`（Bun 原生 runner）13 失败 — 模块单例跨文件泄漏

- **现象**：`bun test`（非 canonical）报 `initDb: already initialized with ...; refusing to switch` 等 13 失败。
- **根因**：Bun 原生 runner 同进程跨文件共享模块注册表，`store/db.ts` 的 `initDb` 单例（设计上 fail-fast 拒绝切换路径，task 06-12）被泄漏触发。vitest 每文件隔离 worker 不受影响。
- **结论**：**非产品 bug**。canonical 命令是 `bun run test`（vitest）。建议：在 README/CONTRIBUTING 注明"测试用 `bun run test`，勿用 `bun test`"，或后续为 db 单例加测试期重置钩子。本轮不修。

### P3-2 [低] `ui.lastSuccess` 死状态

- **现象**：toast 迁移后，`page-new-task.ts`/`page-projects.ts` 改用 `showSuccessToast`，`shell.ts:321` 移除成功提示渲染；`ui.lastSuccess` 只剩 `= null` 清除、再无赋消息处。
- **结论**：死状态/死分支，非 bug。建议清理 `state.ts:67` 的 `lastSuccess` 字段与残留清除语句（可并入本轮或后续小清理）。

### P3-3 [低] artifact/report 存储路径不受 `AINP_HOME` 管辖

- **现象**：设了 `AINP_HOME=/tmp/ainp-e2e/home`，worktrees/projects/knowledge 都正确落在 `/tmp/...`，但 artifacts 与 reports 仍写到 `~/.ai-native/artifacts`、`~/.ai-native/reports`。
- **影响**：隔离不完整，测试会在真实 `~/.ai-native` 留下 run 产物（按 runId 分目录，无冲突，仅是杂物）。
- **结论**：低优。需确认是否 by-design（artifact 路径可能由 API 侧独立配置/默认）。本轮记录为观察项，不强行改（属非目标外的存储策略）。

### P3-4 [低] `toast.ts` 无测试、`duration=0` 除零、容器缺 `aria-live`

- **现象**：新增 `apps/web/src/toast.ts`（133 行，无单测）。`updateProgress` 在 `duration=0` 时 `remaining/duration` 为 NaN（当前调用方都用默认 3000，不可达）。toast 容器无 `role="status"`/`aria-live`，读屏不友好。
- **结论**：低优。功能正确，建议后续补 a11y 与边界守卫。

---

## 业务路径状态（动态 E2E 实测）

### 🟢 直连编排流程（GREEN）
`runner orchestrate` → 9 阶段 → completion。`run_359fc51b8748`：status=passed，14 门禁记录全 pass（requirement/design/diff_scope/sensitive_change/compile/test/acceptance/evidence/knowledge），Claude 真实新增 `subtract(int,int)`+3 用例，`mvn compile`+`mvn test` exit=0，surefire 6/6，completion_report + knowledge_candidate 落库，worktree 自动清理。

### 🟢 队列/watch + Coordinator（GREEN）
Web/API WorkflowRequest → `runner watch` → Coordinator triage → 编排。`run_135d5e29e72a`：Coordinator(rules) proceed routeCase=feature_clear confidence=0.71 runType=feature；9 门禁全 pass；surefire 7/7；run.type 与 Coordinator runType 一致。**知识注入正向验证**：第二次 run 把首次沉淀的 REQ-001/DSN-001 标记 `possibly_stale` 且未依赖，行为正确。

### 🟢 门禁/证据/报告/知识沉淀
gate-engine 全程由服务端裁决（agent 不能宣布 gate 通过）；Build/Test 来自真实 mvn + 解析 surefire XML；completion report 从 SQLite 拼装；knowledge candidate 经人工 knowledge_gate（E2E 自动审批）入库。均符合 README "operating principles"。

---

## 整改执行顺序
1. 修 P1-1（vitest.config.ts 加 `@ainp/shared/browser` alias）。
2. 修 P1-2（stream-rendering 测试改 verbose 显式 `false` + 新增 native-mode 覆盖）。
3. 重跑 `bun run typecheck` + `bun run test` → 要求 0 失败。
4. 重跑两条 E2E（claude_code）→ 确认仍全绿（修改仅触及测试/测试配置，不应影响运行时；重跑作回归保险）。
5. （可选低优）P3-2 清理 `ui.lastSuccess`。P3-1/P3-3/P3-4 记录为后续。

## 验收对照（与 prd.md）
- AC-1 typecheck：已绿。
- AC-2 vitest 0 失败：**整改后达成**（本报告时点未达成）。
- AC-3 直连 E2E：已绿。
- AC-4 watch E2E：已绿。
- AC-5 每个修复对应实测失败：P1-1/P1-2 均有 vitest 实测证据。
- AC-6 报告记录状态：本文件。
