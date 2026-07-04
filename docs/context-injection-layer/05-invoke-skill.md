# 统一调用入口 — `apps/runner/src/orchestrator/invoke-skill.ts`

## 概述

invoke-skill 是 Context Injection Layer 与 Agent Backend 之间的桥接层。它承担：
1. 确保 context foundation（project profile / accepted knowledge / knowledge artifacts / run history）就绪
2. 构建 base ContextPack 并发起 agent 调用
3. 捕获 agent 输出中的 context_request 并自动重试（最多 1 次 supplement）
4. 将 ContextPack、ContextRequest、KnowledgeUsage 等全流程审计数据持久化到 API

---

## 主要导出

| 函数 | 职责 |
|------|------|
| `invokeSkill(c, skill, skillCtx, deps)` | 统一调用入口（含 context_request 重试） |
| `captureContextRequest(c, input, deps)` | 从 agent 结果中捕获 context_request 并构建 supplement pack |
| `ensureContextFoundation(c)` | 懒加载 project profile / accepted knowledge / knowledge artifacts / run history |
| `finishAgentSuccess(agent, artifactIds, summary)` | 成功完成 agent task + session |
| `agentTaskBriefForContext(title, inputs)` | 从 inputs.user_request 或 title 派生 taskBrief |

---

## `invokeSkill` 主流程

```
1. ensureContextFoundation(c) → 确保 profile/knowledge/history 就绪
2. buildContextPack(...) → 构建 base context pack
3. invokeSkillAttempt(attempt=0, role='base')
   ├─ agentTaskStarted
   ├─ persistContextPackArtifact → 写 JSON 到 artifacts/context-packs/
   ├─ agentSessionStarted
   ├─ recordSelectedKnowledgeUsage
   ├─ recordKnowledgeReviewSignals
   ├─ backend.run(skill, enrichedCtx) → 实际 LLM 调用
   └─ captureContextRequest → 检查输出中是否有 context_request
4. 如果有 context_request:
   ├─ finishContextRequestBaseInvocation (标记 base 调用成功)
   ├─ invokeSkillAttempt(attempt=1, role='supplement')
   └─ 如果再次有 context_request → 抛出 "retry limit reached"
5. 返回 InvokedAgent
```

---

## `InvokedAgent` 返回结构

```typescript
interface InvokedAgent {
  taskId: string;
  sessionId: string;
  invocationId: string;
  contextPackArtifactId: string;
  outputs: AgentOutput[];
  contextPack: ContextPack;
  contextRequest: ContextRequestCapture | null;
}
```

---

## `ensureContextFoundation` — 懒加载

| 数据 | 来源 | 写入 |
|------|------|------|
| projectProfileResult | `generateProjectProfile()` | `c.inputs['project_profile.md']` |
| acceptedKnowledge | `collectAcceptedKnowledge(projectId)` | `c.inputs['accepted_knowledge.md']` |
| knowledgeArtifacts | `api.listKnowledgeArtifacts()` | `c.contextFoundation.knowledgeArtifacts` |
| runHistory | `api.listWorkflowRuns()` | `c.contextFoundation.runHistory` |

所有网络错误降级为空数组 + warn 日志，不阻断流程。

---

## `captureContextRequest` 详细流程

```
1. parseContextRequestFromRunResult → 从 lastMessage + output files 解析
2. sanitizeContextRequestForContextInjection → 清洗敏感路径
3. 如果清洗后 refs+questions 为空 → 忽略
4. buildIncrementalContextPack → 构建 supplement pack
5. 序列化 request + supplement 为 JSON 文件
6. postArtifact × 2 (request artifact + supplement artifact)
7. recordSelectedKnowledgeUsage(supplementPack)
8. 更新 c.inputs / c.inputArtifactIds
9. recordContextRequest → 记录到 API
10. 返回 ContextRequestCapture
```

---

## Context Pack Artifact 持久化

写入路径: `{artifactsDir}/context-packs/context_pack.{role}.{packId}.json`

Envelope 结构:
```typescript
{
  schemaVersion: 'ainp.context_pack_artifact.v1',
  snapshot: ContextInvocationSnapshot,
  contextPack: ContextPack,
}
```

---

## Knowledge Review Signal 传播

当 ContextPack 含有 calibrationSignals 时，对每个 signal 调用 `recordKnowledgeAction`:
- `mark_stale_or_supersede` / `mark_stale_or_downgrade` → action = `mark_stale`
- `open_knowledge_review` / `review_before_use` / `review_status_transition` → action = `needs_review`

失败只 warn 不阻断。

---

## 依赖注入 (`InvokeSkillDeps`)

```typescript
interface InvokeSkillDeps {
  agentTaskStarted, agentTaskFinished,
  agentSessionStarted, agentSessionFinished,
  postArtifact,
  recordContextRequest,
  recordKnowledgeUsage,
  recordKnowledgeAction,
}
```

生产环境使用 `DEFAULT_INVOKE_SKILL_DEPS`（直接绑定 `api.*`），测试可注入 stub。

---

## 错误处理

- agent 执行异常 → agentTaskFinished(status='failed') + agentSessionFinished(status='failed') + re-throw
- context_request 重试失败 → failInvocation() + throw Error
- knowledge usage/signal 记录失败 → warn 日志，不阻断
