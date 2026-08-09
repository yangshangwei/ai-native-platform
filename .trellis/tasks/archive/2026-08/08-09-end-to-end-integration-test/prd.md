# 端到端完整链路测试

## Goal

验证整个系统的端到端集成能力，确保从用户请求到最终响应的完整链路正常工作。

## What I already know

* 项目包含多个 package：api (backend/frontend)、runner (backend/frontend)、web (frontend)、shared (backend/frontend)
* 当前分支：feat/design-md-workbench-ui-ralph-finish
* 工作目录干净，最近提交涉及 AC gate 测试和执行记录
* 项目使用 Trellis 工作流管理
* 有 .trellis/spec/ 目录存放规格说明

### 现有测试基础设施

**单元测试 (Vitest)**:
- apps/api/test/: 20+ 测试文件（路由、gate、workflow、实体等）
- apps/web/test/: 18+ 测试文件（UI projection、渲染、配置管理等）
- apps/runner/test/: 至少有 profile.test.ts
- 测试框架：Vitest (通过 `bun x --bun vitest run`)
- 已有 E2E 示例：apps/web/test/e2e-config-management.test.ts（配置管理完整流程）

**Smoke 测试脚本**:
- scripts/smoke-claude-code.ts: 完整链路测试（API + Runner + Claude Code backend）
  - 流程：注册项目 → 创建 workflow run → 准备 worktree → 执行 context_pack stage → 验证流式输出
  - 验证：spawn → stream-json parse → POST /runner/events/agent-stream → SSE broadcast
- scripts/smoke-coordinator.ts: Coordinator triage 引擎测试（规则路由验证，无 LLM 调用）
- scripts/smoke-claude-requirement.ts: （未读取详情）
- scripts/smoke-codex.ts: （未读取详情）

**系统架构（从 README.md）**:
- 标准功能流：8 个阶段 `context_pack → requirement → design → implementation → build_test → review → completion → knowledge`
- 支持多条 flow：feature.fastforward、issue.standard、refactor.standard
- Agent Backend：Claude Code 或 Codex（真实 CLI）
- 执行环境：本地 Git worktree + 本机编译/测试工具
- 数据持久化：SQLite（Artifact、CommandRun、BuildRun/TestRun、GateRun、Approval、AuditLog）
- API on :8787, Web on :5173
- Runner 由 API 管理启动（Web UI 调用 `/runner/control/start`）

**关键组件**:
1. **API** (apps/api): Hono + SQLite + Workflow Engine + Gate Engine + Reports
2. **Runner** (apps/runner): worktree 管理、编译/测试执行、Agent backend 调度
3. **Web** (apps/web): 无框架 TS 工作台、项目配置、任务队列、报告展示
4. **Shared** (packages/shared): 跨包共享类型和工具

## Assumptions (temporary)

* 需要测试 API、Runner、Web 三个应用的集成
* 可能涉及前后端交互、数据流转、状态管理
* 需要验证关键业务流程的完整性

## Decision (ADR-lite)

### Context

需要为完整 8 阶段 workflow 实现端到端集成测试，验证从 API 到 Runner 到 Agent Backend 的完整链路。

### Research Findings

经过技术调研（见 research/ 目录），关键决策如下：

**1. 测试框架选型**（research/e2e-test-framework.md）
- **决策**：采用纯 Bun + fetch 脚本模式（复制增强 scripts/e2e.ts）
- **理由**：已验证可行、快速实现、CI 友好、无额外依赖

**2. API 健康检查**（research/api-health-check.md）
- **决策**：连接测试 + 快速失败（5 次重试 * 500ms）
- **理由**：假设 API 已启动、快速反馈、简单可靠

**3. SSE 流式验证**（research/sse-stream-verification.md）
- **决策**：端点可用性检查（不验证流内容）
- **理由**：聚焦核心业务逻辑、降低复杂度、非阻塞

### Implementation Strategy

**选择方案 A：复制增强模式**

```bash
# 创建增强版 E2E 测试
scripts/e2e-comprehensive.ts  # 基于 e2e.ts 扩展

# 保持原有
scripts/e2e.ts  # 快速 smoke（不变）
```

**增强点**：
1. 更详细的断言（每个 Gate 的具体字段）
2. API preflight 检查（健康检查 + Agent CLI）
3. SSE endpoint 可用性验证
4. 结构化测试报告输出（JSON 格式，便于 CI 解析）
5. 更清晰的错误信息

### Consequences

**优点**：
- 快速实现（1-2 天）
- 风险最低（基于已验证的模式）
- 独立脚本，易于 CI 集成
- 不影响现有测试结构

**缺点**：
- 代码有一定重复（与 e2e.ts）
- 手工断言，无测试框架的报告能力

**缓解措施**：
- 如果未来需要更多 E2E 场景，可重构为共享库
- 如果需要并行测试，可迁移到 Vitest

### Trade-offs

- **速度 vs 质量**：选择快速实现（复制）而非完美架构（重构）
- **覆盖 vs 复杂度**：选择核心业务逻辑验证，暂不深入 SSE 流内容
- **独立性 vs 统一性**：选择独立脚本而非统一到 Vitest（保持灵活性）

## Requirements

* 实现完整 8 阶段标准流 (feature.standard) 的端到端集成测试
* 覆盖核心业务流程：
  - context_pack → requirement → design → implementation → build_test → review → completion → knowledge
* 验证完整技术栈集成：
  - Web UI → API → Runner → Agent Backend (Claude Code/Codex) → 本地编译测试
* 验证所有关键 Gate 判定逻辑：
  - requirement_gate (artifact present + manual approval)
  - design_gate (artifact present + manual approval)
  - diff_scope_gate (path prefix whitelist)
  - sensitive_change_gate (regex patterns)
  - test_integrity_gate (no test weakening)
  - compile_gate (mvn compile exit code)
  - test_gate (mvn test + Surefire XML parsing)
  - acceptance_gate (manual approval)
  - knowledge_gate (manual approval)
* 验证数据持久化完整性：
  - Artifact、CommandRun、BuildRun/TestRun、GateRun、Approval、AuditLog 正确存储到 SQLite
* 验证实时流式输出：
  - Agent streaming → POST /runner/events/agent-stream → SSE broadcast
* 支持自动化执行（适合 CI 环境）
* 支持多 Agent Backend 切换测试（Claude Code / Codex）
* **人工 Gate 自动审批**（采用现有 e2e.ts 模式）：
  - 测试脚本轮询 API 检测 workflow status=awaiting_human
  - 自动调用 POST /approvals 通过 4 个人工 Gate
  - 完全自动化，无需人工介入

## Acceptance Criteria

* [ ] 测试脚本可执行并通过完整 8 阶段流程
* [ ] 验证所有必需阶段均执行：context_pack, requirement, design, implementation, build_test, review, completion, knowledge
* [ ] 验证 8 个 Gate 判定结果：
  - [ ] requirement_gate = pass
  - [ ] design_gate = pass
  - [ ] diff_scope_gate = pass
  - [ ] sensitive_change_gate = pass (或 n/a)
  - [ ] test_integrity_gate = pass
  - [ ] compile_gate = pass
  - [ ] test_gate = pass
  - [ ] acceptance_gate = pass
  - [ ] knowledge_gate = pass
* [ ] 验证 4 个人工审批记录存在且 decision=approved
* [ ] 验证编译命令执行成功（exitCode=0）
* [ ] 验证测试命令执行成功（exitCode=0）
* [ ] 验证所有必需 Artifact 存在：
  - [ ] project_profile
  - [ ] context_pack
  - [ ] requirement_draft
  - [ ] design_doc
  - [ ] diff
  - [ ] surefire_report
  - [ ] completion_report
  - [ ] knowledge_candidate
* [ ] 验证 BuildRun 和 TestRun 记录存在
* [ ] 验证 AgentTask 和 AgentResult 审计记录完整
* [ ] 验证 workflow 最终状态为 passed 或 completed
* [ ] 支持通过环境变量切换 Agent Backend（AINP_E2E_AGENT_BACKEND=claude_code|codex）
* [ ] 测试失败时有清晰的错误信息
* [ ] 可在 CI 环境运行（无人工介入）

## Definition of Done (team quality bar)

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes
* Rollout/rollback considered if risky

## Out of Scope (explicit)

* 失败路径测试（Gate 失败、编译/测试失败、Agent 超时）— 可作为后续增强
* 并发场景（多 workflow 并行、多项目同时运行）— 需要专项性能测试
* 其他 flow 变体（feature.fastforward, issue.standard, refactor.standard）— 可复用框架后补充
* Web UI 前端交互测试 — 本次专注于后端 API + Runner + Agent Backend 集成
* SSE 实时流的客户端验证 — 仅验证 API 端 SSE endpoint 可用，不测试浏览器接收
* 真实人工审批流程验证 — 使用自动审批机制
* 安全性测试（权限控制、输入注入）— 需要专项安全测试
* 性能/压力测试 — 需要专项性能测试
* 跨平台 CLI 兼容性（Windows/.exe/.cmd）— 当前在 macOS/Linux 环境验证
* 错误恢复和重试机制 — 假设环境稳定，专注于成功路径

## Technical Approach

### 测试架构设计

**基于现有 scripts/e2e.ts 扩展**：
- 继承成熟的 orchestrate + 轮询审批模式
- 使用纯 Bun + fetch 实现，无需额外框架依赖
- 支持环境变量配置（API_BASE, AGENT_BACKEND, DB_PATH）

**核心流程**：
1. **前置检查**：
   - 验证 API 服务可用（GET /health）
   - 验证 Agent Backend CLI 可用（claude/codex preflight）
   - 确保测试项目存在（examples/java-maven-sample）

2. **执行阶段**：
   - 启动 Runner orchestrate（spawn 子进程）
   - 并行轮询 API 检测 workflow 状态
   - 自动审批 4 个人工 Gate（requirement, design, acceptance, knowledge）
   - 等待 orchestration 完成

3. **验证阶段**：
   - 拉取 workflow 完整详情（GET /workflow-runs/:id）
   - 断言所有必需阶段、Gate、Artifact、Command、Build、Test 记录
   - 验证 AgentTask/AgentResult 审计完整性
   - 检查最终状态和产物

### 关键技术点

**自动审批机制**（复用 e2e.ts 模式）：
```typescript
// 轮询检测 status=awaiting_human
// 根据 currentStage 映射到对应 gateId
// POST /approvals 通过审批
```

**断言覆盖**（参考 e2e.ts assertions）：
- 阶段完整性：必需的 6 个执行阶段存在
- Gate 判定：8 个 Gate 全部 pass
- 命令执行：compile/test 命令 exitCode=0
- 产物完整：8 种必需 Artifact 存在
- 审计记录：AgentTask/AgentResult 数量和状态

**错误处理**：
- 任何断言失败立即退出并报告具体错误
- 超时机制（建议 10-15 分钟，考虑 LLM 调用延迟）
- 清理机制（失败后清理 worktree）

### 技术债和改进方向

**当前实现限制**：
- 仅测试成功路径，失败场景需要单独设计
- 依赖真实 Agent Backend（有 API 调用成本）
- 串行执行，耗时较长（完整流程预计 5-10 分钟）

**后续可扩展**：
- 增加失败路径测试（Mock Agent Backend 返回错误）
- 并发测试（多 workflow 同时运行）
- 性能基准（记录各阶段耗时）
- SSE 流内容验证（订阅并采样关键事件）

## Technical Notes

### 项目信息
* 项目位置：/Volumes/artisan/code/2026/ai-native-platform
* 任务目录：.trellis/tasks/08-09-end-to-end-integration-test
* 测试目标：examples/java-maven-sample（JDK 8 + Maven + 3 passing tests）

### 现有参考实现
* **scripts/e2e.ts**：完整的 feature.standard 自动化测试参考
  - 约 250 行，包含 orchestrate spawn + 轮询审批 + 详细断言
  - 已验证的自动审批机制和断言模式
  - 支持 AINP_E2E_AGENT_BACKEND 环境变量切换

### API 接口（从代码推断）
* POST /projects — 注册项目
* POST /workflow-runs — 创建 workflow（或通过 orchestrate CLI）
* GET /workflow-runs/:id — 获取详情（含 steps, gates, artifacts, commands, builds, tests, approvals, agentTasks, agentResults）
* POST /approvals — 提交审批决策
* GET /health — 健康检查
* GET /workflow-runs/:id/agent-stream — SSE 流式输出

### 成本和时间预估
* 完整 8 阶段流预计耗时：5-10 分钟
* Agent Backend 调用成本：取决于具体实现，单次完整流程预计 $0.5-2（基于 context_pack 是 <$1，完整流程有 5+ 个 agent 调用）
* CI 频率建议：每日或按需触发，不建议每次 PR 都运行（成本和时间考虑）

### 环境要求
* Bun runtime
* SQLite（API 持久化）
* Git（worktree 管理）
* Maven + JDK 8（编译测试）
* Claude Code 或 Codex CLI（Agent Backend）
* API 服务运行在 :8787

### Research References

研究文档由 trellis-research 子代理并行产出中（等待完成）：
- `research/e2e-test-framework.md` — 测试框架选型
- `research/api-health-check.md` — API 就绪检查
- `research/sse-stream-verification.md` — SSE 流式验证方案
