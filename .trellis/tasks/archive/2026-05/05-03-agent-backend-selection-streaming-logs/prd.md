# Agent Backend selection and streaming logs

## Goal

把当前“Native / 模拟基线”式的 Agent Backend 体验改成用户可理解、可配置、可验证的真实执行环境：用户只能选择 Claude Code 或 Codex 作为 Agent Backend；平台在运行前做真实 CLI preflight；任务执行时使用被选中的真实 backend；Web UI 实时展示 Claude Code / Codex 的流式执行日志，让用户确信后台正在真实运行。

## What I already know

* 用户明确不需要 `Native` / 模拟验证；用户界面和产品流程里不要再出现 Native。
* 用户希望后面的 Agent Backend 是 Claude Code 或 Codex，并且能由用户选择。
* 用户希望看到 Claude Code / Codex 的真实执行日志，而且是实时、流式的。
* 现有 Runner 已有 `CodexBackend` 和 `ClaudeCodeBackend`，分别调用本机 `codex exec --json` 与 `claude --print --output-format stream-json`。
* 现有 API 已有 agent stream ingest 与 SSE：Runner POST `/runner/events/agent-stream`，Web 通过 `/workflow-runs/:id/agent-stream` 建立 EventSource。
* 现有 Web 已有 `Agent Stream` 面板，但标题和上下文还偏技术化，且默认 backend label 会显示 `native / codex / claude_code`。
* 现有 Runner 的 backend 选择来自 `AINP_AGENT_BACKEND`，默认 `native`，且 Codex / Claude Code 不可用时会 silent fallback 到 Native，这与当前产品要求冲突。
* 现有 shared 类型 `AgentBackendKind = 'native' | 'codex' | 'claude_code'`，skills 兼容 backend 也包含 native。

## Assumptions (temporary)

* `Code X` 统一按 `Codex` 处理，UI 文案使用 `Codex`。
* MVP 范围内支持“项目级默认 Agent Backend”；暂不做每次任务的临时 backend override。
* Native 可以作为历史测试 fixture 暂时存在于测试代码中，但不能作为生产运行可选项、默认项、fallback、用户文案或方案设计输出出现。
* 真实 preflight 应至少检测 CLI 安装与一次非破坏性真实调用；如果认证或 CLI 不可用，应阻止启动任务并给出修复提示，而不是 fallback。

## Open Questions

* None — MVP scope confirmed as project-level default backend only.

## Requirements (evolving)

* 用户可以在项目/Runner 配置区域选择真实 Agent Backend：`Claude Code` 或 `Codex`。
* Agent Backend 配置采用项目级默认：每个项目保存一次选择，后续任务默认沿用；MVP 不提供 per-task override。
* UI 不展示 `Native`，不把 Native 作为可选 backend、默认 backend 或 fallback 文案。
* 首次使用或 backend 未配置时，创建/启动任务前要引导用户完成选择与连接检测。
* 后续使用中，页面应持续显示当前项目/当前运行使用的真实 backend 和连接状态；只有配置缺失、CLI 不存在、认证失败或检测失败时才打断用户。
* Runner 必须按已选择 backend 执行，不允许在 Codex / Claude Code 不可用时自动降级到 Native。
* Runner preflight 必须返回用户可理解的状态：installed / authenticated or runnable / version / error / remediation hint。
* Web UI 必须展示真实执行日志，按 workflow run 实时流式更新；日志中要能看出来自 `Claude Code` 还是 `Codex`。
* 日志流应支持断线重连和历史回放，刷新页面后仍能看到已产生的事件。
* 日志展示应区分至少这些类型：system/meta、assistant、tool/user result、stderr、final result、raw fallback。
* 失败日志必须保留 stderr / meta 事件，方便用户诊断 CLI 未登录、权限、超时、sandbox 等问题。

## Acceptance Criteria (evolving)

* [ ] AC-001 UI 的 backend 选择只包含 `Claude Code` 和 `Codex`，用户可保存项目级默认 backend。
* [ ] AC-002 UI 的 header / context strip / run detail 清晰显示当前真实 backend，例如 `Agent Backend: Claude Code · Connected` 或 `Agent Backend: Codex · Needs login`。
* [ ] AC-003 产品 UI、运行方案设计输出和用户文档中不再出现 `Native` 作为用户可见 backend。
* [ ] AC-004 未选择 backend 时，创建/启动任务前出现轻量配置入口；已配置且 preflight 通过时不重复弹窗打断。
* [ ] AC-005 Runner 根据项目配置或显式运行参数选择 backend；选择缺失或 CLI 不可用时 fail fast，并返回可操作错误，不 fallback 到 Native。
* [ ] AC-006 Claude Code preflight 使用真实 `claude` CLI 检测版本与可运行性；Codex preflight 使用真实 `codex` CLI 检测版本与可运行性。
* [ ] AC-007 Claude Code 执行时，`stream-json` 事件实时进入 API `agent_events` 并通过 SSE 出现在 Web 日志面板。
* [ ] AC-008 Codex 执行时，`codex exec --json` 事件实时进入 API `agent_events` 并通过 SSE 出现在 Web 日志面板。
* [ ] AC-009 刷新页面或 SSE 重连后，Web 使用 `sinceSeq` 回放历史并继续 live tail，无明显重复刷屏。
* [ ] AC-010 失败场景（CLI missing / auth failure / process stderr / timeout）在 UI 中显示真实错误日志和修复提示。

## Definition of Done (team quality bar)

* Tests added/updated for shared types, API project config/preflight route, runner backend selection, and Web projection/rendering where applicable.
* Existing Codex / Claude Code parser tests继续通过。
* Lint / typecheck / test green。
* Docs/notes updated if user-facing setup flow or environment variables change。
* Rollback considered: backend config schema changes must be backward-compatible for existing projects.

## Technical Approach (recommended)

### Product UX

* **配置粒度**：项目级默认 backend；创建任务时只展示当前选择和状态，不提供临时切换。
* **配置位置**：在项目接入/项目设置或本地 Runner 面板内新增 `Agent Backend` 配置卡片。
* **首次使用**：如果项目没有 backend 配置，创建任务/启动 Runner 前显示 blocking setup card，要求选择 `Claude Code` 或 `Codex` 并运行检测。
* **日常使用**：右上 context strip 和 run detail 只显示状态，不反复弹窗。
* **异常处理**：检测失败时显示原因与命令提示，例如安装 CLI、登录 CLI、设置 `AINP_CLAUDE_BIN` / `AINP_CODEX_BIN`。

### Runtime/backend

* 把 backend selection 从仅依赖 `AINP_AGENT_BACKEND` 提升为项目配置/运行配置的一部分。
* Production runner supported backends 收敛为 `claude_code | codex`。
* `pickBackend` 改为 fail-fast：未知 backend、未选择 backend、CLI 不可用、preflight 失败均返回错误。
* Native 不再是默认值，不再是 fallback；若保留，只作为内部测试 fixture，不参与用户流程。

### Streaming logs

* 复用已有 `agent_events` + `/workflow-runs/:id/agent-stream` SSE 基础设施。
* Web 面板从泛化 `Agent Stream` 升级为 `Claude Code 执行日志` / `Codex 执行日志`，并显示 stage、连接状态、事件类型。
* Runner 在 backend start / finish / fail / timeout / stderr 时持续 emit `meta` / `stderr` events。
* 保持历史持久化与 `sinceSeq` 重连策略。

## Decision (ADR-lite, proposed)

**Context**: 用户无法信任 `Native` 和 Maven/Calculator 这类看起来像演示基线的方案设计；该功能的核心价值是让用户确信平台正在调用真实 Claude Code / Codex，并能观察实时执行过程。

**Decision**: MVP 采用“项目级默认 backend + 运行时状态展示 + 失败时引导修复”的方式。用户可选项只有 Claude Code 和 Codex；每次任务不做临时 override。Runner 不再自动 fallback 到 Native。实时日志沿用现有 agent event / SSE 架构，但 UI 文案和失败诊断产品化。

**Consequences**: 对真实 CLI 环境有更强依赖；在未安装/未登录时任务会 fail fast 或阻止启动，而不是继续模拟。这符合用户对真实环境的要求，但需要更好的 preflight 和错误提示来降低挫败感。

## Implementation Plan

* PR1: Backend config contract — extend project/shared types and API persistence so each project stores `agentBackend: claude_code | codex`; keep existing project rows backward-compatible but mark missing backend as needing setup.
* PR2: Runner selection/preflight — resolve backend from project config, add CLI preflight/status checks, remove Native fallback from production orchestration, and surface actionable errors.
* PR3: Web UX — add project-level backend selection/status UI, replace Native/default labels, gate task creation/start when backend setup is missing or unhealthy.
* PR4: Streaming log polish — reuse existing `agent_events` + SSE path, relabel the panel per backend, improve event rendering, replay/reconnect behavior, and failure diagnostics.
* PR5: Verification/docs — add/update tests and user setup notes for Claude Code/Codex backend selection and streaming logs.

## Out of Scope (explicit)

* 不做新的模拟 Agent Backend。
* 不把 Browser/Web UI 变成 Claude Code 或 Codex 的完整终端模拟器；MVP 展示结构化流式日志和关键错误即可。
* 不在本任务内新增第三方 Agent Backend（Gemini、Cursor、OpenCode 等）。
* 不承诺远程云 sandbox；当前仍基于本地 Runner / worktree 执行。
* 不在日志里显示敏感 secret；需要保留基本脱敏约束。

## Technical Notes

* `packages/shared/src/types/agent.ts` 当前包含 `AgentBackendKind = 'native' | 'codex' | 'claude_code'`。
* `apps/runner/src/orchestrator.ts` 当前 `pickBackend()` 默认 `native`，Codex / Claude Code 不可用时 fallback Native。
* `apps/runner/src/agents/codex.ts` 已实现 `CodexBackend`，调用 `codex exec --json`，并通过 `api.postAgentEvent()` emit stream events。
* `apps/runner/src/agents/claude-code.ts` 已实现 `ClaudeCodeBackend`，调用 `claude --print --output-format stream-json --include-partial-messages`，并 emit stream events。
* `apps/api/src/routes/runner-events.ts` 已有 `/runner/events/agent-stream` ingest。
* `apps/api/src/routes/workflow-runs.ts` 已有 `/workflow-runs/:id/agent-stream` SSE live tail 与历史回放。
* `apps/web/src/main.ts` 已有 `renderAgentStreamPanel()` / `attachStream()`，但 backend label 默认会显示 `native / codex / claude_code`。
* `scripts/smoke-codex.ts` 与 `scripts/smoke-claude-code.ts` 已可作为真实 backend + stream ingest smoke 的基础。
