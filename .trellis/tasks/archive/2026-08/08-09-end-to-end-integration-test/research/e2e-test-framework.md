# E2E 测试框架选型

## 问题背景

需要为完整 8 阶段 workflow 实现端到端集成测试。当前项目已有：
- scripts/e2e.ts：纯 Bun + fetch 实现的完整测试（约 250 行）
- apps/api/test/*.test.ts：Vitest 单元测试
- apps/web/test/e2e-config-management.test.ts：Vitest E2E 组件测试

需要决定新的完整链路测试使用哪种框架。

## 调研发现

### 方案 1: 纯 Bun + fetch 脚本（当前 e2e.ts 模式）

**实现特点**：
```typescript
// scripts/e2e.ts 核心模式
import { spawn } from 'node:child_process';

// 1. spawn runner orchestrate
const runner = spawn('bun', ['run', RUNNER, 'orchestrate', ...]);

// 2. 轮询 API 检测状态
while (true) {
  const detail = await fetch(`${API_BASE}/workflow-runs/${id}`).then(r => r.json());
  if (detail.run.status === 'awaiting_human') {
    await fetch(`${API_BASE}/approvals`, { method: 'POST', ... });
  }
  // 检测 runner 完成
  const finished = await Promise.race([runner.done, timeout]);
  if (finished) break;
}

// 3. 拉取最终状态并断言
const final = await fetch(`${API_BASE}/workflow-runs/${id}`);
if (final.run.status !== 'passed') fail('...');
```

**优点**：
- 已验证可用，覆盖完整 8 阶段流
- 无额外依赖，直接用 Node.js 标准库
- 灵活控制子进程和轮询逻辑
- 独立脚本，可直接 `bun run e2e` 执行

**缺点**：
- 手工断言，无测试框架的报告能力
- 错误信息需手动格式化
- 无并行能力（单个测试场景）

### 方案 2: Vitest 集成模式

**实现特点**：
```typescript
// apps/api/test/e2e-full-workflow.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';

describe('Full 8-stage workflow E2E', () => {
  let apiProcess: ChildProcess;
  
  beforeAll(async () => {
    // 启动 API 服务（或假设已运行）
    apiProcess = spawn('bun', ['run', 'apps/api/src/server.ts']);
    await waitForHealthy();
  });

  it('should complete feature.standard flow', async () => {
    const runner = spawn('bun', ['run', RUNNER, 'orchestrate', ...]);
    // 轮询 + 断言逻辑
    expect(detail.run.status).toBe('passed');
  }, 600_000); // 10 分钟超时

  afterAll(async () => {
    apiProcess?.kill();
  });
});
```

**优点**：
- 统一测试框架（与单元测试一致）
- 更好的报告和错误展示（Vitest UI）
- 可利用 describe/it 结构组织多场景
- 支持 setup/teardown 钩子

**缺点**：
- 需要管理 API 服务生命周期（或要求外部启动）
- Vitest 默认超时较短（5s），需显式配置长超时
- 与现有 scripts/e2e.ts 模式不一致（需要迁移）
- `bun test` 的模块共享问题（需用 `bun x --bun vitest`）

### 方案 3: 专用 E2E 框架（Playwright / Puppeteer）

**适用场景**：
- 需要真实浏览器自动化（点击 UI、验证前端渲染）
- 需要截图、视频录制、网络拦截

**当前需求匹配度**：
- ❌ 本次测试专注于后端 API + Runner + Agent Backend 集成
- ❌ 不涉及 Web UI 交互测试
- ❌ 引入 Playwright 会增加依赖体积和复杂度

**结论**：不适用于当前需求。

## 方案对比

| 维度 | 纯脚本模式 | Vitest 集成 | Playwright |
|------|-----------|------------|------------|
| 实现成本 | 低（复制 e2e.ts） | 中（适配 Vitest） | 高（学习成本） |
| 维护成本 | 中（手工断言） | 低（框架报告） | 高（额外依赖） |
| 报告质量 | 基础（console.log） | 优秀（Vitest UI） | 优秀（HTML 报告） |
| 执行灵活性 | 高（独立脚本） | 中（需 Vitest runner） | 低（依赖浏览器） |
| 适配当前需求 | ✅ 完美匹配 | ✅ 可行 | ❌ 过度设计 |

## 推荐方案

**推荐方案 A：纯脚本模式（复制增强）**

理由：
1. **快速实现**：复制 scripts/e2e.ts 为 scripts/e2e-comprehensive.ts，增强断言覆盖
2. **已验证可行**：e2e.ts 已成功运行完整 8 阶段流
3. **独立执行**：无需测试框架，直接 `bun run` 即可
4. **CI 友好**：作为独立脚本更易集成到 CI pipeline
5. **最小变更**：不影响现有测试结构

实施建议：
```bash
# 创建增强版 E2E 测试
cp scripts/e2e.ts scripts/e2e-comprehensive.ts

# 增强点：
# 1. 更详细的断言（验证每个 Gate 的具体字段）
# 2. 增加 SSE stream endpoint 验证
# 3. 增加超时配置和错误恢复
# 4. 输出结构化测试报告（JSON 格式）

# package.json 添加命令
"e2e:full": "bun run scripts/e2e-comprehensive.ts"
```

**备选方案：Vitest 集成（长期优化）**

如果后续需要：
- 并行测试多个 flow 变体
- 更好的测试报告和可视化
- 统一测试框架（降低维护成本）

可以迁移到 Vitest，但作为第二阶段重构，不作为 MVP 首选。

## 决策

**选择方案 A：纯脚本模式**

实现路径：
1. 复制 scripts/e2e.ts 为基础
2. 增强断言覆盖（参考 Acceptance Criteria）
3. 添加结构化输出（便于 CI 解析）
4. 保留原 e2e.ts 作为快速 smoke
