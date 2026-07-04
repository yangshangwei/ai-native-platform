# 敏感路径过滤 — `packages/shared/src/utils/context-policy.ts`

## 概述

context-policy 提供 Context Injection Layer 的安全边界：确保敏感文件路径（密钥、凭据、环境变量文件等）不会泄露到 agent prompt 中。它在 builder、renderer、invoke-skill 等多处被调用。

---

## 主要导出

| 函数 | 职责 |
|------|------|
| `normalizeSensitivePathPatterns(patterns)` | 标准化敏感路径模式列表 |
| `isSensitiveContextPath(value, patterns)` | 判断单个路径/ref 是否命中敏感模式 |
| `sanitizeSensitiveContextText(text, patterns)` | 逐行过滤含敏感路径的行 |
| `lineContainsSensitivePath(line, patterns)` | 判断单行文本是否含有敏感路径 token |

---

## `normalizeSensitivePathPatterns`

```typescript
function normalizeSensitivePathPatterns(
  patterns: readonly string[] | undefined,
): string[]
```

- 输入为空/undefined → 使用 `CONTEXT_POLICY_SENSITIVE_PATH_PATTERNS_DEFAULT`
- 去重
- 全部转小写
- `\` 替换为 `/`
- trim + 过滤空串

---

## `isSensitiveContextPath` — 核心匹配逻辑

```typescript
function isSensitiveContextPath(
  value: string | null | undefined,
  patterns: readonly string[],
): boolean
```

### 匹配流程

1. 对输入值做 trim + 小写 + 路径分隔符标准化
2. 拆分 `:` 后的部分作为额外候选（支持 `uri:xxx` 格式）
3. 对每个候选调用 `matchesSensitiveContextPath`

### 模式匹配规则

| 模式类型 | 匹配逻辑 |
|----------|----------|
| 以 `/` 结尾（目录） | text == dir名 \|\| text.includes(pattern) \|\| text.includes(`/${pattern}`) |
| 以 `.` 开头（隐藏文件） | filename == pattern \|\| filename.startsWith(`${pattern}.`) \|\| text.includes(`/${pattern}`) |
| 其它 | filename == pattern \|\| filename.includes(pattern) \|\| text.includes(`/${pattern}`) |

---

## `sanitizeSensitiveContextText` — 整文本过滤

```typescript
function sanitizeSensitiveContextText(
  text: string,
  patterns: readonly string[],
): string
```

- 逐行 split
- 过滤掉包含敏感路径的行
- 重新 join

---

## `lineContainsSensitivePath` — 行级检测

```typescript
function lineContainsSensitivePath(
  line: string,
  patterns: readonly string[],
): boolean
```

1. 移除引号和括号字符
2. split by whitespace 得到 tokens
3. 任一 token 命中 `isSensitiveContextPath` → 返回 true

---

## 默认敏感模式

通过 `CONTEXT_POLICY_SENSITIVE_PATH_PATTERNS_DEFAULT`（来自 `config/defaults`），典型包含：

- `.env`、`.env.local`、`.env.production`
- `credentials`、`secrets`
- `private_key`、`id_rsa`
- `.npmrc`、`.pypirc`
- `token`、`password`

---

## 调用点

| 调用位置 | 用途 |
|----------|------|
| `builder.ts` — `buildContextPack` | 过滤 knowledge artifacts 和 input artifacts 中的敏感引用 |
| `builder.ts` — `sanitizeContextRequestForContextInjection` | 清洗 context_request 的 refs 和 questions |
| `renderer.ts` — `resolveInputInjections` | 跳过敏感名称的输入 + 清洗输入内容 |
| `invoke-skill.ts` — `captureContextRequest` | 二次清洗后校验 |
| `builder.ts` — `knowledgeCandidate` | 清洗知识 artifact 的 content 和 summary |

---

## 安全保证

- 所有进入 agent prompt 的文本都经过 `sanitizeSensitiveContextText`
- 所有 sourceRef / requestedRef 都经过 `isSensitiveContextPath` 校验
- 敏感路径过滤发生在 builder 组装阶段（最早时机），而非仅在渲染阶段
- pattern 匹配为子串匹配（宽松策略），宁可误过滤也不泄露
