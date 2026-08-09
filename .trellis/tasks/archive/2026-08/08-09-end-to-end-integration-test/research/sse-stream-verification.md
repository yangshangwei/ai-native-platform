# SSE 流式验证方案

## 问题背景

Agent Backend 执行时通过 SSE (Server-Sent Events) 实时推送输出到前端。E2E 测试需要决定是否验证 SSE 流，以及验证到什么程度。

## 调研发现

### SSE 流的架构（从代码分析）

**数据流路径**：
```
Agent Backend (claude/codex)
  → stream-json output
  → Runner 解析
  → POST /runner/events/agent-stream
  → API 收集
  → SSE broadcast to /workflow-runs/:id/agent-stream
  → Web UI 订阅
```

**相关代码**：
- scripts/smoke-claude-code.ts 注释：
  > Validates: spawn → stream-json parse → POST /runner/events/agent-stream → SSE broadcast

**API 端点**：
- `GET /workflow-runs/:id/agent-stream` — SSE 流式输出
- README.md 提到：可用 `curl -N` 订阅流

### 验证策略对比

**策略 1: 不验证 SSE（最小化）**

当前 scripts/e2e.ts 的做法：
```typescript
// 只验证最终状态，不订阅 SSE 流
const detail = await fetchJson(`/workflow-runs/${id}`);
if (detail.run.status !== 'passed') fail('...');
```

优点：
- 简单，无需处理流式响应
- 避免 SSE 解析复杂性
- 测试聚焦于业务逻辑（最终状态）

缺点：
- 不验证实时反馈机制
- 无法检测流式输出中断/格式错误
- 不覆盖 Web UI 的核心体验

适用场景：
- MVP 阶段，专注于端到端业务逻辑
- SSE 机制由单独的单元测试覆盖

**策略 2: 端点可用性检查**

验证 SSE endpoint 可访问，但不解析内容：
```typescript
async function verifySseEndpoint(workflowRunId: string): Promise<void> {
  const r = await fetch(`${API_BASE}/workflow-runs/${workflowRunId}/agent-stream`);
  if (!r.ok) {
    fail(`SSE endpoint not accessible: ${r.status}`);
  }
  if (r.headers.get('content-type') !== 'text/event-stream') {
    fail(`SSE endpoint wrong content-type: ${r.headers.get('content-type')}`);
  }
  log('SSE endpoint available');
  // 不读取流内容，立即关闭连接
  r.body?.cancel();
}
```

优点：
- 验证端点存在和基本配置
- 无需解析流内容（避免复杂性）
- 快速执行（<1s）

缺点：
- 不验证流内容格式
- 不验证是否有实际事件推送

适用场景：
- 作为健康检查的一部分
- 验证 API 路由配置正确

**策略 3: 采样验证（部分内容）**

订阅 SSE 流，采样验证关键事件：
```typescript
async function verifySseStream(workflowRunId: string, timeoutMs = 5000): Promise<void> {
  const r = await fetch(`${API_BASE}/workflow-runs/${workflowRunId}/agent-stream`);
  const reader = r.body?.getReader();
  const decoder = new TextDecoder();
  
  let receivedEvents = 0;
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    const { done, value } = await reader!.read();
    if (done) break;
    
    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        receivedEvents++;
        const data = JSON.parse(line.slice(6));
        // 验证事件格式
        if (!data.type || !data.timestamp) {
          fail(`Invalid SSE event format: ${line}`);
        }
      }
    }
    
    if (receivedEvents >= 3) {
      log(`SSE stream verified (${receivedEvents} events sampled)`);
      reader!.cancel();
      return;
    }
  }
  
  if (receivedEvents === 0) {
    fail('No SSE events received within timeout');
  }
}
```

优点：
- 验证流内容格式正确
- 确认有实际事件推送
- 采样策略避免长时间订阅

缺点：
- 增加测试复杂度
- 需要处理流式解析
- 依赖 workflow 执行时机（可能还未开始推送）

**策略 4: 完整流验证（最全面）**

全程订阅，验证完整事件序列：
```typescript
async function verifyFullSseStream(workflowRunId: string): Promise<void> {
  const events: any[] = [];
  const r = await fetch(`${API_BASE}/workflow-runs/${workflowRunId}/agent-stream`);
  // ... 全程收集所有事件
  
  // 验证事件完整性
  const stages = new Set(events.map(e => e.stage));
  if (!stages.has('context_pack')) fail('Missing context_pack events');
  if (!stages.has('requirement')) fail('Missing requirement events');
  // ...
}
```

优点：
- 最全面的验证
- 可检测事件遗漏或顺序错误

缺点：
- 极高复杂度
- 测试耗时长（需等待完整流程）
- 与轮询审批逻辑并行时难以同步
- 维护成本高

## 推荐方案

**推荐：策略 1（不验证 SSE）+ 策略 2（端点检查）组合**

实施方案：
```typescript
async function main(): Promise<void> {
  await preflight(); // API + Agent Backend 检查
  
  const runner = spawnRunner(['orchestrate', ...]);
  const workflowRunId = await findLatestRun(title);
  
  // 在 workflow 启动后，快速检查 SSE 端点可用性
  if (workflowRunId) {
    await verifySseEndpointExists(workflowRunId);
  }
  
  // 继续原有的轮询审批逻辑
  await pollUntilDone();
  
  // 验证最终状态（不依赖 SSE 内容）
  await assertFinalState(workflowRunId);
}

async function verifySseEndpointExists(id: string): Promise<void> {
  try {
    const r = await fetch(`${API_BASE}/workflow-runs/${id}/agent-stream`, {
      signal: AbortSignal.timeout(2000),
    });
    if (r.ok && r.headers.get('content-type')?.includes('text/event-stream')) {
      log('SSE endpoint available');
    }
    r.body?.cancel(); // 立即关闭
  } catch (err) {
    log(`SSE endpoint check failed (non-blocking): ${(err as Error).message}`);
    // 不阻塞测试，因为 SSE 不影响最终状态验证
  }
}
```

理由：
1. **聚焦核心价值**：E2E 测试的核心是验证业务流程完整性，SSE 是展示层优化
2. **降低复杂度**：避免流式解析和事件同步的复杂性
3. **快速执行**：端点检查只需 1-2 秒
4. **非阻塞**：SSE 检查失败不影响核心测试
5. **单元测试补充**：SSE 机制可由专门的单元测试覆盖（mock agent stream）

验证范围：
- ✅ SSE endpoint 存在且可访问
- ✅ Content-Type 正确配置
- ❌ 不验证流内容格式（留给单元测试）
- ❌ 不验证事件完整性（留给单元测试）
- ❌ 不验证前端订阅逻辑（留给前端测试）

## 备选方案

如果未来 SSE 成为关键验收点（如"必须在 X 秒内推送首个事件"），可升级为策略 3（采样验证），但需要：
1. 独立的 SSE 测试用例（与主流程分离）
2. 明确的采样标准（如"前 5 秒内至少 3 个事件"）
3. 更长的超时配置

## 决策

**选择策略 1 + 策略 2 组合**

实现要点：
- 在 workflow 启动后，快速检查 GET /workflow-runs/:id/agent-stream 可访问
- 验证 Content-Type: text/event-stream
- 失败时记录日志但不阻塞测试
- 核心验证仍依赖最终状态（GET /workflow-runs/:id 的 detail）

这样既保持测试简单性，又覆盖了 SSE 端点的基本可用性。
