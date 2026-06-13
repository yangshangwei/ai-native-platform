# PRD: 安全与健壮性加固包（路线图 v2 R1）

## 背景

依据：archive/2026-06/06-12-architecture-optimization-round-two-audit/research/robustness.md（实施前必读，
全部发现带文件:行号与严重度）。本任务打包 6 个小而关键的加固项，全部是缺陷修复/防御加固（非纯重构），
每项独立可验证。威胁模型：本地单机 MVP，无多租户，不做容器隔离。

## 需求（按严重度排序）

### R1.1 web dev server 监听面收紧（High）
`apps/web/serve.ts` 的 `Bun.serve` 未传 hostname（Bun 默认 0.0.0.0），且反代 /api/* —— 局域网可经
web 端口取到 `includeSecret=1` 明文凭证。改为 `process.env.AINP_WEB_HOST ?? '127.0.0.1'`（与 api
server.ts:5 的模式对齐）。补 serve.test.ts 断言（createWebServer 已可注入参数，验证默认 hostname）。

### R1.2 includeSecret 端点契约固化（Medium）
`apps/api/src/routes/projects.ts` 的 `GET /:id?includeSecret=1` 分支：补内部契约注释（runner 专用、
威胁模型说明）+ 最低限度调用方标识——要求请求头 `x-ainp-internal: runner`（或等价轻量标识，缺失时仍走
publicProject 而非报错，保证向后兼容期）；`apps/runner/src/api-client.ts:55` 同步带头。补路由测试：
无标识头 → 不返回凭证；带头 → 返回。

### R1.3 agent CLI 超时 SIGKILL 升级链（Medium）
- `apps/runner/src/agents/claude-code.ts`（硬超时 + post-result 宽限两处）与 `codex.ts`：SIGTERM 后加
  5-10s SIGKILL 升级定时器（参照 sh.ts 的有界风格；定时器须在子进程退出时清除）。
- 核实 `agents/coordinator/llm-fallback.ts` 的 spawnCandidate 两处（审计标记"疑似同缺"），同缺则同修。
- `command-runner.ts` 超时 kill 改进程组（spawn `detached: true` + `process.kill(-pid, 'SIGKILL')`，
  注释自认的 future work；注意保持非超时路径行为不变）。
- 测试：claude-code-backend-grace 测试模式可参照，为"忽略 SIGTERM 的子进程最终被 SIGKILL"补一个用例
  （用 trap SIGTERM 的 shell 脚本做 stub CLI）。

### R1.4 orchestrator worktree 异常窗口（Medium-Low）
`apps/runner/src/orchestrator.ts`：`env.prepare` 成功后到 try 块之间的 4 个可抛点（workspacePrepared /
mkdir / loadContextPolicy / unknown flowId）不受 finally 保护，失败残留 worktree。把 try 边界上移到
prepare 之后第一行（cleanup 语义不变）。补一个注入式用例：prepare 后某步抛出 → cleanup 仍被调用。

### R1.5 knowledge 状态迁移守卫（Low，与 claim 同模式）
`workflow-engine.ts` 的 `setKnowledgeArtifactStatus`：store 层 UPDATE 加 `WHERE status = ?` 前置 +
合法迁移表（draft→accepted/rejected；accepted/rejected 终态不可逆回 draft——以现有业务流为准先读代码
确认全部合法迁移，不要臆造），非法迁移返回 null/报错语义与现有调用方兼容。补单测（合法/非法/重复）。

### R1.6 防御深度两项（Low）
- agent stdout 事件入库前过 `maskSecrets`（runner 侧 emit 处统一，stderr 已有先例 cli-common/claude/codex）。
- `workflow-engine.ts` 头部注释固化"状态迁移函数必须全同步、禁止中途 await（单进程事件循环原子性依据）"。

## 不做
- 凭证列加密/混淆（记录现状即可）；api 鉴权体系；sanitizeGitError 重写（Low，单独评估）。

## 验收标准
1. `bun run typecheck`、`bun x --bun vitest run` 全绿（718 + 新增）
2. R1.1/R1.2/R1.3/R1.4/R1.5 各有对应新测试（清单见各项）
3. 实测证据：R1.1 起 server 后 `lsof` 确认只绑 127.0.0.1；R1.3 用 trap SIGTERM 的 stub 实测升级链
4. 默认行为兼容：runner 既有流程（smoke）端到端不破
