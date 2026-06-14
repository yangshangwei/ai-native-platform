# PRD — P3 Follow-ups（artifact/report AINP_HOME 一致性 + 测试 runner 文档）

## 目标
收口 06-14 E2E 审计遗留的两个低优观察项：
- **P3-3**：让 artifact / report 的写入路径在未设专用 dir 时也遵循 `AINP_HOME`，与 worktrees/projects/knowledge/db 的隔离行为一致。
- **P3-1**：修正 README，把测试命令从误导性的 `bun test`（Bun 原生 runner，模块单例跨文件泄漏 → 13 假失败）改为 canonical 的 `bun run test`（vitest），并加一句说明。

## 背景与证据（来自 06-14 test-report）
- 写入侧 `apps/runner/src/orchestrator.ts:55`、`apps/api/src/reports.ts:9` 直接落到 `homedir()/.ai-native/...`，绕过 `AINP_HOME`；而读取侧 `apps/api/src/artifact-content.ts:14-20` 的 `allowedArtifactRoots` 已包含 `AINP_HOME` —— 说明本意 AINP_HOME 应可管辖，写入侧是疏漏。
- `README.md:63` 写的是 `bun test`，会触发 Bun 原生 runner 的 `initDb` 单例泄漏，产生与产品无关的失败。

## 范围内
1. `orchestrator.ts` / `reports.ts`：`AINP_ARTIFACTS_DIR/AINP_REPORTS_DIR ?? join(AINP_HOME ?? ~/.ai-native, 'artifacts'|'reports')`。
2. `README.md`：`bun test` → `bun run test` + 一句 runner 说明。

## 范围外
- 不改读取侧 `artifact-content.ts`（已含 AINP_HOME）。
- 不引入新的共享 path helper（保持与 `config.ts`/`projects.ts:598` 的就地模式一致）。
- 不动 `AINP_DB_PATH` 等其它已正确的隔离点。

## 验收标准
- AC-1：默认场景（不设 AINP_HOME）落点仍为 `~/.ai-native/{artifacts,reports}`——零行为变化。
- AC-2：设 `AINP_HOME=X`（不设专用 dir）时，artifacts→`X/artifacts`、reports→`X/reports`。
- AC-3：专用 `AINP_ARTIFACTS_DIR`/`AINP_REPORTS_DIR` 仍优先。
- AC-4：`bun run typecheck` 通过；`bun run test`（vitest）0 失败（含 `report-sidecars.test.ts`）。
- AC-5：README 测试命令为 `bun run test` 且有说明。
