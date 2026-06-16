# 使用 Claude Code 后端执行完整业务流程的端到端测试

## Goal

验证 AI Native Platform 的完整九阶段业务流程在使用 **Claude Code** 作为 Agent Backend 时能够正确运行，确保所有 stages、gates、命令执行和 artifacts 生成符合预期。

## What I Already Know

* 项目已有完整的九阶段流程：`init → context_pack → requirement → design → implementation → build_test → review → completion → knowledge`
* 现有 `scripts/e2e.ts` 脚本存在，默认使用 Codex，可通过 `AINP_E2E_AGENT_BACKEND` 环境变量切换
* Claude Code 后端实现位于 `apps/runner/src/agents/claude-code.ts`，支持流式输出和所有必需的 stages
* Claude Code CLI 已安装且可用（`claude --version` 返回 2.1.178）
* 测试需要验证：
  - 9 个 stages 全部执行
  - 8 个 gates 状态正确（requirement_gate, design_gate, diff_scope_gate, sensitive_change_gate, compile_gate, test_gate, acceptance_gate, knowledge_gate）
  - Maven 编译和测试命令成功执行（exit code = 0）
  - 所有必需的 artifacts 生成（project_profile, context_pack, requirement_draft, design_doc, diff, surefire_report, completion_report, knowledge_candidate）
  - 4 个人工审批记录（requirement, design, acceptance, knowledge）

## Assumptions (Temporary)

* API 服务已在本地运行（端口 8787）
* 示例项目 `examples/java-maven-sample` 存在且已初始化为 git 仓库
* Claude Code CLI 已通过认证（无需额外登录）
* 测试环境有足够的预算配额（默认 $5 per run）

## Open Questions

~~* 是否需要创建新的测试脚本还是直接使用现有的 `e2e.ts` 并设置环境变量？~~ → **已确认：方式 A，使用环境变量 `AINP_E2E_AGENT_BACKEND=claude_code`，复用现有脚本**

## Requirements

* 使用环境变量 `AINP_E2E_AGENT_BACKEND=claude_code` 运行现有的 `scripts/e2e.ts`
* 验证所有 9 个 stages 成功完成
* 验证所有 8 个 gates 通过（status = pass）
* 验证 Maven 编译和测试命令执行成功（exit code = 0）
* 验证所有 8 种必需的 artifacts 正确生成
* 验证 4 个人工审批流程正确触发和记录
* 生成测试报告文档（markdown 格式），包含执行时间、关键指标、成功/失败状态

## Acceptance Criteria

* [ ] API 服务成功启动（端口 8787）
* [ ] 示例项目已注册且 agent backend 设置为 `claude_code`
* [ ] E2E 测试脚本成功执行，exit code = 0
* [ ] WorkflowRun 状态为 `passed`
* [ ] 所有 9 个 stages 在 steps 中出现（context_pack, requirement, design, implementation, build_test, review, completion, knowledge）
* [ ] 所有 8 个 gates 状态为 `pass`
* [ ] Maven compile 和 test 命令 exit code = 0
* [ ] 所有 8 种必需的 artifacts 存在
* [ ] 4 个人工审批记录存在（requirement_gate, design_gate, acceptance_gate, knowledge_gate）
* [ ] Agent tasks 和 results 审计记录存在且状态为 success
* [ ] 测试报告生成并包含关键指标（stages、gates、artifacts、commands、执行时间）

## Definition of Done (Team Quality Bar)

* E2E 测试通过（所有断言成功）
* 测试报告文档生成（markdown 格式）
* 如果发现问题，创建对应的 issue 或 fix
* 更新 README 或 docs，说明如何运行 Claude Code E2E 测试
* CI 配置更新（如果适用）

## Technical Approach

### 执行方式
使用环境变量切换后端，复用现有测试脚本：

```bash
# 1. 启动 API 服务（Terminal A）
bun run dev:api

# 2. 运行 E2E 测试，指定 Claude Code 后端（Terminal B）
AINP_E2E_AGENT_BACKEND=claude_code bun run e2e
```

### 实现步骤

1. **前置检查**
   - 验证 Claude Code CLI 可用：`claude --version`
   - 验证 API 服务运行中：`curl http://127.0.0.1:8787/health`
   - 验证示例项目存在：`examples/java-maven-sample/.git`

2. **执行测试**
   - 设置环境变量 `AINP_E2E_AGENT_BACKEND=claude_code`
   - 运行 `bun run e2e`（等价于 `bun run scripts/e2e.ts`）
   - 测试脚本会自动：
     - 注册项目并设置 agent backend
     - 创建 WorkflowRun（title 包含时间戳）
     - 启动 runner orchestrate
     - 并行轮询 API，自动批准 4 个人工 gates
     - 等待流程完成并执行断言

3. **收集结果**
   - 从 API 获取 WorkflowRun 详情（`GET /workflow-runs/:id`）
   - 提取关键指标：stages、gates、commands、artifacts、approvals、agent tasks
   - 记录执行时间、exit code

4. **生成报告**
   - 创建 markdown 测试报告（类似 `test-report-e2e-2026-06-16.md`）
   - 包含：测试摘要、stages 验证、gates 验证、命令执行、artifacts 清单、审批记录
   - 标注任何失败或警告项

### 关键验证点

| 验证项 | 来源 | 期望值 |
|--------|------|--------|
| Workflow status | `detail.run.status` | `passed` |
| Workflow stage | `detail.run.currentStage` | `completion` 或 `knowledge` |
| Steps count | `detail.steps.length` | ≥6（context_pack, requirement, design, implementation, build_test, review） |
| Gates pass | `detail.gates` | 8 个 gates 全部 `status=pass` |
| Compile exit code | `detail.commands` (含 `compile`) | `exitCode=0` |
| Test exit code | `detail.commands` (含 `test`) | `exitCode=0` |
| Artifacts | `detail.artifacts` | 8 种 kind 全部存在 |
| Approvals | `detail.approvals` | 4 条记录（requirement, design, acceptance, knowledge） |
| Agent tasks | `detail.agentTasks` | ≥5 条，backend=`claude_code` |
| Agent results | `detail.agentResults` | 全部 `status=success` |

### 失败处理策略

- **CLI 不可用**：提示安装/登录，终止测试
- **API 未运行**：提示启动 API，终止测试
- **中间阶段失败**：记录失败点、error message、保留 worktree（通过 `--keep-worktree`）
- **断言失败**：生成详细报告，标注失败项，exit code = 1

## Out of Scope (Explicit)

* 对比 Claude Code 和 Codex 的性能差异（可作为后续任务）
* 修改 Claude Code 后端实现本身（假设已正确实现）
* 支持其他 Agent Backends（如 Gemini、本地模型）
* Web UI 的手动测试流程（本任务聚焦自动化测试）
* CI/CD 深度集成（手动运行优先）
* 修改 `e2e.ts` 脚本本身（除非发现明确 bug）

## Technical Notes

### 相关文件
* `scripts/e2e.ts` — 现有 E2E 测试脚本
* `apps/runner/src/agents/claude-code.ts` — Claude Code 后端实现
* `examples/java-maven-sample` — 测试用示例项目
* `docs/2026-05-06-end-to-end-business-flow.md` — 业务流程文档
* `test-report-e2e-2026-06-16.md` — 最近的测试报告（配置管理 E2E）

### 关键配置
* 环境变量：`AINP_E2E_AGENT_BACKEND=claude_code`
* API 端点：`http://127.0.0.1:8787`
* 默认预算：`$5 per run`（可通过 `--max-budget-usd` 调整）

### 约束
* Claude Code CLI 必须已安装并认证
* API 服务必须在本地运行
* 测试使用本地环境（不在 Docker/K8s 中运行）
