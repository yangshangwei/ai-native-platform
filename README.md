# AI Native Platform (MVP)

AI 软件交付工作台。从一句话需求到验收报告的闭环：需求 → 设计 → AI 开发 → 本地构建测试 → 验收 → 报告 → 知识沉淀。

详见 `docs/2026-05-01-ai-native-platform-handoff.md`。

## Status — End-to-end MVP

九阶段闭环已打通：`init → context_pack → requirement → design → implementation → build_test → review → completion → knowledge`。所有产物（Artifact、CommandRun、BuildRun/TestRun、GateRun、Approval、AuditLog）持久化到 SQLite，可被 Web UI 和 Completion Report 引用。

LLM 接入是后续工作；当前 NativeBackend 产出的需求/设计/实现/评审产物是模板化的，但骨架可直接替换为 Codex / Claude Code 后端。

## Layout

```
apps/
  api/      Hono on Bun + SQLite store + Workflow Engine + Gate Engine + Reports
  runner/   Local Runner CLI (worktree, command whitelist, NativeBackend, orchestrator)
  web/      Vite-less TS + 3-pane UI + approval buttons (proxies /api/* to backend)
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

# Terminal C — drive a full lifecycle (Wave B+):
bun run runner -- orchestrate --project java-sample --title "smoke add a marker comment"
# In another shell: open http://127.0.0.1:5173/ and click "Approve" on each human gate.

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
4. **Worktree 是 Trusted Local Mode。** 仅工作区隔离，不隔离命令/网络/资源。命令白名单 + 5min timeout + 8MB 日志截断 + 审批 + 审计降低风险。
5. **每次交付必须有 Completion Report。** 自动从 SQLite 拼装 markdown，引用每个 Artifact / Gate / CommandRun。
6. **经验先生成 Knowledge Candidate**，由 Knowledge Gate（人工）决定是否入库。

## What runs

| Stage | Runner-side action | Server-side gate |
|---|---|---|
| requirement | NativeBackend → `requirement.md` | `requirement_gate` (artifact present) + manual approval |
| design | NativeBackend → `design.md` | `design_gate` (artifact present) + manual approval |
| implementation | NativeBackend edits a Java source file → diff artifact | `diff_scope_gate` (path prefix) + `sensitive_change_gate` (regex) |
| build_test | `mvn -B test` (whitelisted spawn) | `compile_gate` (when compile run is recorded) + `test_gate` (exit + Surefire) |
| review | NativeBackend → `review.md` | `acceptance_gate` (manual) |
| completion | `POST /workflow-runs/:id/completion-report` | — (assembles markdown report artifact) |
| knowledge | `POST /workflow-runs/:id/knowledge-candidate` | `knowledge_gate` (manual) |

## API surface

- `GET /health` — counts of all entities
- `POST /projects`, `GET /projects/:idOrName` — register / lookup projects
- `POST /workflow-runs`, `GET /workflow-runs[?projectId=]`, `GET /workflow-runs/:id` — runs (detail returns runs + steps + commands + gates + artifacts + builds + tests + approvals + audit)
- `POST /workflow-runs/:id/completion-report`, `POST /workflow-runs/:id/knowledge-candidate`
- `POST /approvals`, `GET /approvals?workflowRunId=` — manual gate decisions
- `GET /runners` — last-seen runner heartbeats
- `POST /runner/events/{workspace-prepared,step-started,step-finished,command-run,stage-transition,await-human,workflow-completed,heartbeat,maven-build,artifact,run-gate}` — runner ingress; only path that touches the Workflow Engine

## Non-goals (still)

Docker/K8s 沙箱、复杂多 Agent、IDE 集成、PR/CI 深度集成、多语言。
但 `ExecutionEnvironment` / `AgentBackend` / `SkillSpec` 都是接口，后续可扩展。

## Files of interest

- `apps/api/src/workflow-engine.ts` — sole state writer
- `apps/api/src/gate-engine.ts` — every gate's pass/warn/fail logic
- `apps/api/src/reports.ts` — Completion Report + Knowledge Candidate generators
- `apps/api/src/store/{db,store}.ts` — SQLite migrations + repositories
- `apps/runner/src/orchestrator.ts` — drives the 9 stages + waits on human gates
- `apps/runner/src/agents/native.ts` — NativeBackend (LLM placeholder)
- `apps/runner/src/skills/index.ts` — Canonical SkillSpecs per stage
- `apps/runner/src/command-runner.ts` — whitelist + timeout + log cap + CommandRun
- `apps/runner/src/worktree.ts` — `TrustedLocalWorktreeEnvironment`
- `packages/shared/src/utils/{whitelist,surefire,id}.ts` — pure cross-cutting utils
