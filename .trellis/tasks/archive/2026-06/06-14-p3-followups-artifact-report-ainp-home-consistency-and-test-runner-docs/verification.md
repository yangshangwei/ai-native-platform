# 验证记录 — P3 Follow-ups

**日期**：2026-06-14
**结论**：✅ P3-1、P3-3 均已修复并验证，零回归。

## 改动
| 项 | 修复 | 文件 |
|---|---|---|
| P3-3 | artifact 写入基目录经 `AINP_HOME` 兜底 | `apps/runner/src/orchestrator.ts`（`ARTIFACTS_BASE`） |
| P3-3 | report 写入基目录经 `AINP_HOME` 兜底 | `apps/api/src/reports.ts`（`REPORTS_DIR`） |
| P3-1 | 测试命令 `bun test` → `bun run test` + 说明 | `README.md` |

修复式：`process.env.AINP_<X>_DIR ?? join(process.env.AINP_HOME ?? join(homedir(), '.ai-native'), '<x>')`。专用 dir 仍优先；默认（不设 AINP_HOME）落点不变。

## 验证证据
| 检查 | 结果 | 命令/证据 |
|---|---|---|
| typecheck | ✅ PASS | `bun run typecheck` |
| vitest 全量 | ✅ 744 pass / 0 fail | `bun run test`（含 `report-sidecars.test.ts`） |
| 路径解析 AC-1/2/3 | ✅ 6/6 PASS | 复现表达式 eval：默认→`~/.ai-native`、`AINP_HOME=X`→`X/{artifacts,reports}`、专用 dir 优先 |
| **真实 E2E（AC-2 端到端）** | ✅ PASS | `AINP_HOME=/tmp/ainp-p3` 跑 `scripts/e2e.ts`（claude_code）：`run_8351afc3b087` status=passed，9 门禁全过，maven 7/7 |
| — artifacts 落点 | ✅ `/tmp/ainp-p3/artifacts/run_8351afc3b087/...` | E2E 实测 |
| — reports 落点 | ✅ `/tmp/ainp-p3/reports/run_8351afc3b087/...`（completion_report + knowledge_candidate） | E2E 实测 |
| — 反面（无泄漏） | ✅ `~/.ai-native` 未出现 `run_8351afc3b087` | 修复前这两类会落 `~/.ai-native`，现完全随 AINP_HOME |

## 验收对照
- AC-1 默认行为不变：✅（eval + 普通用户默认 AINP_HOME 未设 → `~/.ai-native`）。
- AC-2 AINP_HOME 管辖 artifacts/reports：✅（真实 E2E 端到端证明）。
- AC-3 专用 dir 优先：✅（eval）。
- AC-4 typecheck + vitest 0 失败：✅。
- AC-5 README 用 `bun run test` 且有说明：✅。

## 范围确认
仅改 2 处运行时常量 + README；读取侧 `artifact-content.ts`（已含 AINP_HOME 候选根）未动，E2E 证明读写一致。
