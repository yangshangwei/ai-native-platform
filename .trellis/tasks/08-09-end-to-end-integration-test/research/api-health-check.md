# API 健康检查实现

## 问题背景

E2E 测试需要在执行前验证 API 服务已就绪，避免因服务未启动导致的测试失败。需要确定：
1. 使用哪个端点检查健康状态
2. 检查哪些指标
3. 重试策略

## 调研发现

### API /health 端点分析

从 README.md 描述：
> Core endpoints:
> - `GET /health` — counts of all entities

从现有代码推断（scripts/e2e.ts 和 scripts/smoke-*.ts）：
- 当前实现**没有**显式调用 /health 做 preflight
- 直接调用业务 API（POST /projects）并依赖错误处理

### 健康检查策略对比

**策略 1: 无显式健康检查（当前模式）**
```typescript
// scripts/e2e.ts 当前做法
async function ensureProject(): Promise<void> {
  // 直接调用业务 API，失败时整个测试 fail
  const project = await fetchJson('/projects', { method: 'POST', ... });
}
```

优点：
- 简单，无额外请求
- 失败时错误信息已包含 HTTP 状态码

缺点：
- 无法区分"服务未启动"和"业务逻辑错误"
- 第一个业务请求失败，错误信息可能不直观

**策略 2: GET /health + 重试**
```typescript
async function waitForApiHealthy(maxRetries = 10, delayMs = 1000): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const health = await fetch(`${API_BASE}/health`).then(r => r.json());
      if (health.status === 'ok' || health.projects !== undefined) {
        log('API healthy');
        return;
      }
    } catch (err) {
      if (i === maxRetries - 1) {
        fail(`API not reachable at ${API_BASE} after ${maxRetries} retries`);
      }
      await sleep(delayMs);
    }
  }
}
```

优点：
- 明确的服务就绪检查
- 支持等待服务启动（适合 CI 场景）
- 友好的错误信息

缺点：
- 额外请求开销（微小）
- 需要假设 /health 的响应格式

**策略 3: 连接测试（最小化）**
```typescript
async function waitForApiReachable(maxRetries = 5, delayMs = 500): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const r = await fetch(`${API_BASE}/health`);
      if (r.ok) {
        log('API reachable');
        return;
      }
    } catch (err) {
      if (i === maxRetries - 1) {
        fail(`API not reachable at ${API_BASE}: ${(err as Error).message}`);
      }
      await sleep(delayMs);
    }
  }
}
```

优点：
- 只检查连接性，不解析响应
- 快速失败（5 次 * 500ms = 2.5s）
- 适合"假设 API 已启动"的场景

### /health 响应格式推断

基于 README.md 描述"counts of all entities"，推测响应格式：
```typescript
interface HealthResponse {
  status?: 'ok' | 'degraded';
  projects?: number;
  workflowRuns?: number;
  steps?: number;
  gates?: number;
  artifacts?: number;
  // ... 其他实体计数
}
```

验证方式：
```bash
curl http://127.0.0.1:8787/health
```

## 推荐方案

**推荐：策略 3（连接测试 + 快速失败）**

理由：
1. **假设 API 已启动**：E2E 测试的前置条件是"API 服务已运行"（参考 README.md 的 Quickstart）
2. **快速反馈**：2.5 秒内确认可达性，避免长时间等待
3. **简单可靠**：不依赖 /health 的具体响应格式
4. **CI 友好**：可在 CI 脚本中先启动 API，等待端口监听，再运行测试

实现示例：
```typescript
async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function preflight(): Promise<void> {
  log(`checking API at ${API_BASE}`);
  
  // 1. 快速连接测试（5 次 * 500ms = 2.5s）
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) {
        log('API reachable');
        break;
      }
    } catch (err) {
      if (i === 4) {
        fail(`API not reachable at ${API_BASE}. Is the server running? (bun run dev:api)`);
      }
      await sleep(500);
    }
  }

  // 2. Agent Backend CLI 检查（如果需要）
  if (!(await claudeCliAvailable())) {
    fail('claude CLI not found on PATH');
  }

  // 3. 测试项目检查
  if (!existsSync(SAMPLE_PATH)) {
    fail(`sample missing: ${SAMPLE_PATH}`);
  }
}
```

**CI 集成建议**：
```yaml
# .github/workflows/e2e.yml
jobs:
  e2e:
    steps:
      - name: Start API
        run: bun run dev:api &
        
      - name: Wait for API ready
        run: |
          timeout 30s bash -c 'until curl -f http://127.0.0.1:8787/health; do sleep 1; done'
      
      - name: Run E2E test
        run: bun run e2e:full
```

## 备选方案

如果未来需要"等待 API 从冷启动到就绪"（如 Docker 容器启动），可升级为策略 2，增加重试次数和延迟。但当前场景下，策略 3 已足够。

## 决策

**选择策略 3：连接测试 + 快速失败**

- 5 次重试，每次 500ms 间隔
- 检查 GET /health 返回 2xx
- 失败时给出明确的启动提示
