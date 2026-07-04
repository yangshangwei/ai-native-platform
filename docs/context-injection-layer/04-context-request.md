# Agent 追加请求解析 — `apps/runner/src/context/request.ts`

## 概述

当 agent 在执行过程中发现缺少关键工程事实时，它会在输出中嵌入一个结构化的 `context_request`。本模块负责从 agent 输出（message 或 artifact 文件）中解析出这个请求。

---

## 主要导出

| 函数/常量 | 职责 |
|-----------|------|
| `parseContextRequestFromAgentOutput(input)` | 从多个 source 中尝试解析 context_request |
| `CONTEXT_REQUEST_SCHEMA_VERSION` | `'ainp.context_request.v1'` |

---

## 解析入口

```typescript
interface ParseContextRequestInput {
  workflowRunId: string;
  stepRunId?: string | null;
  stage: WorkflowStage;
  sources: readonly ContextRequestSource[];  // [{name, text}]
  now?: string;
  idFactory?: () => string;
}
```

遍历 `sources`，对每个 source 提取 structured payloads，尝试转换为 `ContextRequest`。**第一个成功解析的即返回**。

---

## Payload 提取策略

### 1. JSON artifact（文件名以 `.json` 结尾）

整体 `JSON.parse` 后作为一个 payload。

### 2. Fenced code blocks

用正则 `` ```lang\n...``` `` 提取：

- `json` 或 `context_request` lang → JSON.parse
- `yaml` 或 `yml` lang → 自定义简易 YAML 解析器

---

## Context Request 结构识别

从 payload 中尝试以下路径定位 candidate object：

```
obj.context_request
obj.contextRequest
obj（当 obj.type === 'context_request' 或 obj.kind === 'context_request'）
```

### 必须字段

| 字段 | 类型 | 约束 |
|------|------|------|
| `reason` | string | 非空 |
| `requestedRefs` | string[] | 字段名可为 `requestedRefs`/`requested_refs`/`refs` |
| `questions` | string[] | — |
| `priority` | 1 \| 2 \| 3 | 缺省为 2；非法值 → null（拒绝） |

requestedRefs 和 questions 至少一个非空，否则返回 null。

---

## 输出结构

```typescript
interface ContextRequest {
  id: string;              // newId('ctxreq')
  workflowRunId: string;
  stepRunId: string | null;
  stage: WorkflowStage;
  reason: string;          // 截断到 1000 字符
  requestedRefs: string[]; // 去重，每项截断 240 字符，最多 8 条
  questions: string[];     // 去重，每项截断 500 字符，最多 8 条
  priority: 1 | 2 | 3;
  status: 'open';
  createdAt: string;
}
```

---

## 简易 YAML 解析器

支持的格式：

```yaml
context_request:
  reason: "..."
  requestedRefs:
    - "code:src/foo.ts"
    - "artifact:xxx"
  questions:
    - "What is the return type?"
  priority: 2
```

规则：
- 必须有 `context_request:` 顶层 key
- 缩进检测（非顶层行必须有前导空格）
- 支持 inline array `[a, b]` 语法
- 字符串自动去引号（单引号/双引号）
- `priority` 字段自动 `Number()` 转换

---

## 安全边界

- `boundedString(value, maxLength)` — 防止超长注入
- `uniqueStrings` — 去重去空
- `safeJsonParse` — catch JSON 异常返回 null
- 数组字段严格校验：必须是 `string[]`，非法返回 `{ok: false}` 导致整个 payload 被拒绝
