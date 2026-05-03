# AI Native Platform (MVP)

AI 软件交付工作台。从一句话需求到验收报告的闭环：需求 → 设计 → AI 开发 → 本地构建测试 → 验收 → 报告 → 知识沉淀。

详见 `docs/2026-05-01-ai-native-platform-handoff.md`。当前执行环境决策见
`docs/2026-05-02-ai-native-platform-local-worktree-decision.md`。

## Status — End-to-end MVP

九阶段闭环已打通：`init → context_pack → requirement → design → implementation → build_test → review → completion → knowledge`。所有产物（Artifact、CommandRun、BuildRun/TestRun、GateRun、Approval、AuditLog）持久化到 SQLite，可被 Web UI 和 Completion Report 引用。

项目级 Agent Backend 已收敛为真实 CLI：用户在项目配置里选择 Claude Code 或 Codex；Runner 启动任务前会做 CLI preflight，失败时直接给出安装/登录修复提示。

跨平台 CLI 解析使用同一套规则：macOS/Linux 默认调用 `claude` / `codex`；Windows 会优先尝试 npm/Bun shim 与可执行文件（如 `claude.cmd`、`codex.cmd`、`.exe`）。需要固定路径时设置 `AINP_CLAUDE_BIN` 或 `AINP_CODEX_BIN`；preflight 通过的同一个解析结果会传给 Runner runtime 执行。

## Layout

```
apps/
  api/      Hono on Bun + SQLite store + Workflow Engine + Gate Engine + Reports
  runner/   Local Runner CLI (worktree, local compile/test, Codex/Claude Code backends, orchestrator)
  web/      Vite-less TS delivery workbench: project onboarding, task queue, structured Requirement/Design/Acceptance, reports, knowledge, evidence
packages/
  shared/   Cross-cutting types + utils (whitelist, surefire parser, slug/id)
examples/
  java-maven-sample/   JDK 8 + Maven sample with one passing JUnit suite (3 tests)
scripts/
  smoke.ts  Quick loop: register → mvn -B test → CommandRun stored
  e2e.ts    Full lifecycle: orchestrate + auto-approve 4 human gates + assert
```

## Quickstart

```bash
bun install

# Terminal A — API on :8787
bun run dev:api

# Terminal B — Web on :5173 (proxies /api/* to API)
bun run dev:web

# Terminal C — choose a real Agent Backend on the project, then drive a full lifecycle:
bun run runner -- register --path ./examples/java-maven-sample --name java-sample --agent-backend codex
bun run runner -- orchestrate --project java-sample --title "smoke add a marker comment"
# Or let the 5173 UI enqueue tasks and have the runner claim them:
bun run runner -- watch
# Open http://127.0.0.1:5173/ to create requests, inspect evidence, and approve human gates.

# One-shot smokes (no manual interaction):
bun run smoke   # quick: just `mvn -B test`
bun run e2e     # full 9-stage lifecycle, auto-approval

# Tests + types
bun test
bun run typecheck
```

## Operating principles (locked in)

1. **Workflow Engine 是唯一状态写入者。** Runner 只发事件，路由层只调 engine，agent 没有任何状态写入路径。
2. **Agent 不能宣布 Gate 通过。** 每个 GateRun 由 `gate-engine` 决定；agent 可附 `agentNote`，但绝不影响 status。
3. **Build/Test 必须来自真实命令。** Runner 实际 spawn `mvn`，CommandRun 含 stdoutRef/stderrRef/exitCode；TestRun 来自解析的 Surefire XML，不是 LLM 自报。
4. **开发执行使用本地环境 + Git worktree。** 每个 WorkflowRun 一个独立 worktree；compile/test 使用本机 `./mvnw` 或 `mvn`、本机 JDK/Maven/Git 环境。当前不追求 Docker/K8s/microVM 或 Tool Policy 的沙箱级强制。
5. **每次交付必须有 Completion Report。** 自动从 SQLite 拼装 markdown，引用每个 Artifact / Gate / CommandRun。
6. **经验先生成 Knowledge Candidate**，由 Knowledge Gate（人工）决定是否入库。

## What runs

| Stage | Runner-side action | Server-side gate |
|---|---|---|
| requirement | Claude Code / Codex → `requirement.md` | `requirement_gate` (artifact present) + manual approval |
| design | Claude Code / Codex → `design.md` | `design_gate` (artifact present) + manual approval |
| implementation | Claude Code / Codex edits the worktree → diff artifact | `diff_scope_gate` (path prefix) + `sensitive_change_gate` (regex) |
| build_test | `mvn -B -DskipTests compile` → `mvn -B test` (local whitelisted spawn) | `compile_gate` + `test_gate` (exit + Surefire) |
| review | Claude Code / Codex → `review.md` | `acceptance_gate` (manual) |
| completion | `POST /workflow-runs/:id/completion-report` | — (assembles markdown report artifact) |
| knowledge | `POST /workflow-runs/:id/knowledge-candidate` | `knowledge_gate` (manual) |

## API surface

- `GET /health` — counts of all entities
- `POST /projects`, `GET /projects/:idOrName` — register / lookup projects
- `POST /workflow-runs`, `GET /workflow-runs[?projectId=]`, `GET /workflow-runs/:id` — runs (detail returns runs + steps + commands + gates + artifacts + builds + tests + approvals + audit)
- `POST /workflow-requests`, `GET /workflow-requests[?status=]`, `POST /workflow-requests/:id/{claim,complete}` — UI → runner watch queue
- `POST /workflow-runs/:id/completion-report`, `POST /workflow-runs/:id/knowledge-candidate`
- `POST /approvals`, `GET /approvals?workflowRunId=` — manual gate decisions
- `GET /runners` — last-seen runner heartbeats
- `GET /artifacts/:id/content`, `GET /artifacts/workflow-runs/:workflowRunId/:kind/latest/content` — local file artifact text for UI drill-down
- `GET /command-runs/:id/logs` — stdout/stderr text for Build/Test evidence drill-down
- `POST /runner/events/{workspace-prepared,step-started,step-finished,command-run,stage-transition,await-human,workflow-completed,heartbeat,maven-build,artifact,run-gate}` — runner ingress; only path that touches the Workflow Engine

## Non-goals (still)

Docker/K8s/microVM 沙箱级强制、复杂多 Agent、IDE 集成、PR/CI 深度集成、多语言。
但 `ExecutionEnvironment` / `AgentBackend` / `SkillSpec` 都是接口，后续可选扩展；当前主线不依赖沙箱。

## Files of interest

- `apps/api/src/workflow-engine.ts` — sole state writer
- `apps/api/src/gate-engine.ts` — every gate's pass/warn/fail logic
- `apps/api/src/reports.ts` — Completion Report + Knowledge Candidate generators
- `apps/api/src/store/{db,store}.ts` — SQLite migrations + repositories
- `apps/runner/src/orchestrator.ts` — drives the 9 stages + waits on human gates
- `apps/runner/src/cmd/watch.ts` — claims UI-created WorkflowRequests and runs them in local worktrees
- `apps/runner/src/agents/{codex,claude-code}.ts` — real CLI Agent Backend adapters + streaming events
- `apps/runner/src/skills/index.ts` — Canonical SkillSpecs per stage
- `apps/runner/src/command-runner.ts` — whitelist + timeout + log cap + CommandRun
- `apps/runner/src/worktree.ts` — `TrustedLocalWorktreeEnvironment`
- `apps/web/src/{main,projection}.ts` — 5173 delivery workbench and UI projection helpers
- `packages/shared/src/utils/{whitelist,surefire,id}.ts` — pure cross-cutting utils
