# 端到端集成测试

## 概述

`scripts/e2e-comprehensive.ts` 提供了完整的 8 阶段 workflow 端到端集成测试，验证从 API 到 Runner 到 Agent Backend 的完整链路。

## 特性

- ✅ **完整 8 阶段验证**：context_pack → requirement → design → implementation → build_test → review → completion → knowledge
- ✅ **自动化人工审批**：自动通过 4 个人工 Gate（无需手动介入）
- ✅ **Preflight 检查**：API 健康检查、Agent Backend CLI 可用性验证
- ✅ **详细断言**：验证所有 Gate、Artifact、Command、Build、Test、Approval 记录
- ✅ **SSE 端点验证**：检查流式输出端点可用性（非阻塞）
- ✅ **结构化报告**：输出 JSON 格式测试结果，便于 CI 解析
- ✅ **清晰错误提示**：每个失败断言都有明确的错误信息

## 前置要求

1. **API 服务运行**：
   ```bash
   bun run dev:api
   ```

2. **Agent Backend CLI 可用**：
   - Claude Code: `claude --version` 可执行
   - Codex: `codex --version` 可执行

3. **测试项目就绪**：
   ```bash
   cd examples/java-maven-sample
   git init && git add . && git commit -m "initial"
   ```

4. **Maven + JDK 8**：编译和测试需要

## 使用方法

### 快速测试（使用默认 Codex）

```bash
bun run e2e:full
```

### 使用 Claude Code Backend

```bash
AINP_E2E_AGENT_BACKEND=claude_code bun run e2e:full
```

### 指定 API 地址

```bash
AINP_API_BASE=http://localhost:8787 bun run e2e:full
```

### 指定数据库路径

```bash
AINP_DB_PATH=/tmp/test.db bun run e2e:full
```

## 测试流程

1. **Preflight 检查** (2-3 秒)
   - API 健康检查（5 次重试）
   - Agent Backend CLI 验证
   - 测试项目检查

2. **执行阶段** (5-10 分钟)
   - 启动 Runner orchestrate
   - 并行轮询 API 状态
   - 自动审批人工 Gate
   - 等待完整流程完成

3. **验证阶段** (1-2 秒)
   - 验证所有必需阶段执行
   - 验证 9 个 Gate 判定结果
   - 验证 8 种 Artifact 存在
   - 验证编译/测试命令成功
   - 验证 AgentTask/AgentResult 审计记录
   - 验证 BuildRun/TestRun 记录
   - 验证 4 个人工审批记录

## 测试覆盖

### 必需阶段
- context_pack
- requirement
- design
- implementation
- build_test
- review
- completion（可选）
- knowledge（可选）

### 必需 Gate（全部 pass）
- requirement_gate
- design_gate
- diff_scope_gate
- sensitive_change_gate
- test_integrity_gate
- compile_gate
- test_gate
- acceptance_gate
- knowledge_gate

### 必需 Artifact
- project_profile
- context_pack
- requirement_draft
- design_doc
- diff
- surefire_report
- completion_report
- knowledge_candidate

### 必需命令（exitCode=0）
- `mvn -DskipTests compile`
- `mvn test`

### 审计记录
- AgentTask（≥5 条）
- AgentResult（与 AgentTask 数量一致，status=success）
- BuildRun（≥1 条）
- TestRun（≥1 条，failed=0）
- Approval（4 条，对应 4 个人工 Gate）

## 输出格式

测试完成后输出结构化 JSON 报告：

```json
{
  "success": true,
  "workflowRunId": "uuid",
  "duration": 315000,
  "timestamp": "2026-08-09T...",
  "agentBackend": "codex",
  "assertions": {
    "passed": [
      "workflow status=passed",
      "stage present: context_pack",
      "gate requirement_gate: pass",
      ...
    ],
    "failed": []
  },
  "summary": {
    "stages": 8,
    "gates": 9,
    "artifacts": 8,
    "commands": 2,
    "builds": 1,
    "tests": 1,
    "approvals": 4
  }
}
```

## 退出码

- `0`：所有断言通过
- `1`：有断言失败或发生异常

## 与 scripts/e2e.ts 的区别

| 特性 | e2e.ts（快速 smoke） | e2e-comprehensive.ts（完整测试） |
|------|---------------------|--------------------------------|
| 执行时间 | 5-8 分钟 | 5-10 分钟 |
| Preflight 检查 | ❌ 无 | ✅ API + CLI |
| SSE 验证 | ❌ 无 | ✅ 端点检查 |
| 断言详细度 | 基础 | 详细（每个 Gate 单独验证） |
| 错误信息 | 简单 | 清晰明确 |
| 输出格式 | console.log | 结构化 JSON |
| 适用场景 | 开发快速验证 | CI 完整验证 |

## CI 集成

### GitHub Actions 示例

```yaml
name: E2E Tests

on: [push, pull_request]

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      
      - name: Install dependencies
        run: bun install
      
      - name: Start API
        run: bun run dev:api &
        
      - name: Wait for API ready
        run: |
          timeout 30s bash -c 'until curl -f http://127.0.0.1:8787/health; do sleep 1; done'
      
      - name: Setup test project
        run: |
          cd examples/java-maven-sample
          git init && git add . && git commit -m "initial"
      
      - name: Run E2E test
        run: bun run e2e:full
        env:
          AINP_E2E_AGENT_BACKEND: codex
        timeout-minutes: 15
      
      - name: Upload test report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: e2e-report
          path: e2e-report.json
```

## 成本和时间预估

- **执行时间**：5-10 分钟（取决于 Agent Backend 响应速度）
- **API 调用成本**：约 $0.5-2/次（完整 8 阶段流程，5+ agent 调用）
- **建议频率**：
  - 开发阶段：按需手动运行
  - CI：每日或关键 PR（避免每次 PR 都运行）

## 故障排查

### API 不可达

```
❌ FAIL: API not reachable at http://127.0.0.1:8787
```

**解决方案**：先启动 API 服务
```bash
bun run dev:api
```

### Agent CLI 不可用

```
❌ FAIL: claude CLI not found on PATH
```

**解决方案**：安装 Claude Code 或设置环境变量
```bash
# macOS/Linux
export PATH="/path/to/claude:$PATH"

# 或使用 Codex
AINP_E2E_AGENT_BACKEND=codex bun run e2e:full
```

### 测试项目不是 Git 仓库

```
❌ FAIL: sample is not a git repo
```

**解决方案**：初始化 Git 仓库
```bash
cd examples/java-maven-sample
git init && git add . && git commit -m "initial"
```

### Workflow 卡在某个阶段

检查 API 日志和 Runner 输出，可能原因：
- Agent Backend 超时（网络问题）
- 编译/测试失败
- Gate 判定逻辑错误

## 扩展开发

### 添加新的断言

在 `runAssertions()` 函数中添加：

```typescript
// 示例：验证特定 Artifact 的内容
const designDoc = detail.artifacts.find((a) => a.kind === 'design_doc');
if (designDoc && designDoc.uri.includes('expected-content')) {
  passed.push('design_doc content valid');
} else {
  failed.push('design_doc content invalid');
}
```

### 测试失败路径

创建新脚本 `scripts/e2e-failure.ts`：
- 故意提交会导致编译失败的代码
- 验证 compile_gate = fail
- 验证 workflow status = failed

### 并发测试

修改脚本同时启动多个 workflow：
```typescript
const runners = [
  spawnRunner(['orchestrate', '--project', 'java-sample', '--title', 'task-1']),
  spawnRunner(['orchestrate', '--project', 'java-sample', '--title', 'task-2']),
];
await Promise.all(runners.map(r => r.done));
```

## 相关文档

- [开发工作流](.trellis/workflow.md)
- [API 规格](.trellis/spec/api/backend/index.md)
- [Runner 规格](.trellis/spec/runner/backend/index.md)
- [Gate 判定逻辑](apps/api/src/modules/gate/README.md)
- [测试框架选型研究](.trellis/tasks/08-09-end-to-end-integration-test/research/e2e-test-framework.md)

## 许可

与项目主仓库相同。
