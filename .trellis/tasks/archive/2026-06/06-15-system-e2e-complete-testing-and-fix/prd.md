# PRD: AI Native Platform 系统端到端完整测试

## 目标

对 AI Native Platform 进行端到端的完整测试，发现问题后修复，直到所有测试用例全部通过。

## 已知信息

从代码库检查发现：

### 项目结构
- **三个 App**：`apps/api` (Hono + SQLite)、`apps/runner` (CLI orchestrator)、`apps/web` (5173 delivery workbench)
- **共享包**：`packages/shared` (类型、工具)
- **示例项目**：`examples/java-maven-sample` (JDK 8 + Maven)

### 现有测试体系
1. **单元测试**：`packages/shared/test/*.test.ts`、`apps/web/test/*.test.ts`（19个测试文件）
2. **Smoke 测试**：`scripts/smoke.ts` - 快速循环测试（register → mvn test → 验证 CommandRun）
3. **E2E 测试**：`scripts/e2e.ts` - 完整生命周期测试（9阶段 + 4个人工 gate 自动审批 + 完整断言）

### 测试命令
- `bun run test` - vitest 单元测试（必须用 `bun run test`，不能用 `bun test`）
- `bun run smoke` - 快速冒烟测试
- `bun run e2e` - 完整端到端测试
- `bun run typecheck` - TypeScript 类型检查

### 关键约束
- E2E 测试要求 API 必须已启动（`AINP_API_BASE` 默认 `http://127.0.0.1:8787`）
- 示例项目必须是 git 仓库
- Agent Backend 可选 `claude_code` 或 `codex`（通过 `AINP_E2E_AGENT_BACKEND` 设置）

## 测试策略

### Phase 1: 环境准备 & 类型检查
- 验证依赖安装
- TypeScript 类型检查
- 示例项目 git 初始化检查

### Phase 2: 单元测试
- 运行 `bun run test` 验证所有单元测试通过
- 检查覆盖核心工具类（whitelist、surefire parser、id/slug 生成等）

### Phase 3: 快速冒烟测试
- 启动 API (后台)
- 运行 `scripts/smoke.ts`
- 验证基础 workflow 循环（register → run → store）

### Phase 4: 完整 E2E 测试
- 保持 API 运行
- 运行 `scripts/e2e.ts`
- 验证完整的 9 阶段生命周期
- 自动审批 4 个人工 gate
- 验证所有产物、命令、gate、审批

### Phase 5: 问题修复与回归
- 如任何阶段失败，定位根因
- 修复代码
- 从失败的阶段重新开始测试
- 重复直到所有测试通过

## 验收标准

- ✅ TypeScript 类型检查通过（无 error）
- ✅ 所有单元测试通过（`bun run test`）
- ✅ 快速冒烟测试通过（`bun run smoke`）
- ✅ 完整 E2E 测试通过（`bun run e2e`）
- ✅ 无回归问题
- ✅ 所有修复已验证

## Definition of Done

- 测试覆盖：TypeCheck + Unit + Smoke + E2E 全通过
- 错误修复：所有发现的问题已修复并验证
- 文档更新：如修复导致行为变化，需更新相关文档
- CI 兼容：所有测试可自动化运行

## Out of Scope

- 新增测试用例（只运行现有测试）
- 性能优化（除非影响测试通过）
- UI/UX 改进
- 新功能开发
- 多 Agent Backend 并行测试

## 技术细节

### 测试前置条件
```bash
# 示例项目必须是 git 仓库
cd examples/java-maven-sample
git init
git add .
git -c user.email=ai@ainp -c user.name=ainp commit -q -m initial
```

### E2E 测试断言点（来自 scripts/e2e.ts）
- 9个阶段全部到达：init → context_pack → requirement → design → implementation → build_test → review → completion → knowledge
- 4个人工 gate 审批：requirement_gate、design_gate、acceptance_gate、knowledge_gate
- 规则 gate 通过：diff_scope_gate、sensitive_change_gate、compile_gate、test_gate
- Maven 命令成功：`mvn compile` exit=0、`mvn test` exit=0
- Agent 审计：AgentTask 和 AgentResult 记录完整
- 产物完整：project_profile、context_pack、requirement_draft、design_doc、diff、surefire_report、completion_report、knowledge_candidate
- BuildRun 和 TestRun 存在，测试无失败

### 环境变量
- `AINP_API_BASE` - API 地址（默认 http://127.0.0.1:8787）
- `AINP_E2E_AGENT_BACKEND` - Agent 后端（claude_code 或 codex，默认 codex）
- `AINP_DB_PATH` - SQLite 数据库路径（可覆盖）

## 执行计划

1. **环境验证** (5分钟)
   - 检查依赖
   - 初始化示例项目 git
   - TypeScript 类型检查

2. **单元测试** (2分钟)
   - `bun run test`
   - 记录失败用例

3. **API 启动** (后台持续)
   - `bun run dev:api` 后台运行
   - 健康检查

4. **Smoke 测试** (2分钟)
   - `bun run smoke`
   - 验证基础循环

5. **E2E 测试** (10-15分钟)
   - `bun run e2e`
   - 完整生命周期验证

6. **问题修复循环** (按需)
   - 定位失败原因
   - 修复代码
   - 重新运行失败的测试阶段
   - 验证修复效果

## 技术参考

- Workflow Engine: `apps/api/src/workflow-engine.ts`
- Gate Engine: `apps/api/src/gate-engine.ts`
- Orchestrator: `apps/runner/src/orchestrator.ts`
- Agent Backends: `apps/runner/src/agents/{codex,claude-code}.ts`
- Store: `apps/api/src/store/store.ts`
