# 优化 Claude Code 执行日志输出格式

## Goal

优化 Web UI 中显示的 Claude Code / Codex 执行日志，使其更清晰易读，减少冗余的原始 JSON 事件输出，提升用户体验。

当前问题：日志输出包含大量原始 stream_event JSON 数据（包括 token 统计、UUID、元数据等），导致：
- 难以快速定位有用信息
- 视觉噪音过多，影响阅读体验
- 关键信息（如工具调用、AI 输出）被淹没在大量 JSON 中

## What I Already Know

### 技术架构定位

1. **前端渲染层**：
   - `apps/web/src/stream-rendering.ts` - 核心渲染逻辑
     - `buildStreamDisplayLines()` - 将事件转换为显示行
     - `shouldFilterEventInNativeMode()` - 已有的过滤逻辑（native mode）
     - `nativeMode` 参数：当前设置为 `true`，会隐藏元数据前缀
   - `apps/web/src/stream.ts` - Stream 管理和 UI 更新
     - 通过 SSE (EventSource) 接收实时日志
     - 事件类型：`'system' | 'assistant' | 'user' | 'result' | 'stderr' | 'meta' | 'raw'`

2. **后端数据源**：
   - `apps/runner/src/cmd/run.ts` - Runner 命令执行
   - 日志通过 SSE 端点推送：`/workflow-runs/:id/agent-stream`

### 现有过滤机制

`stream-rendering.ts` 中已有 `shouldFilterEventInNativeMode()` 函数：
- 过滤非重要的 `meta` 事件（保留 session_start/end, message_start）
- 过滤无文本或纯 JSON 的 `raw` 事件

### 当前输出示例（截图中的问题）

```json
{"type":"stream_event","event":{"type":"message_delta","delta":{"stop_reason":"tool_use",...}}}
{"type":"stream_event","event":{"type":"message_stop"},...}
[system] status
{"type":"stream_event","event":{"type":"message_start","message":{...}}}
[tool→ Write...]
[tool-input...] {"file_path": "..."}
```

用户看到大量原始 JSON，尤其是包含 token 统计、UUID、stop_reason 等内部数据。

## Assumptions (Temporary)

1. 用户主要关心：
   - AI 的文本输出（assistant 消息）
   - 工具调用及其结果（tool-input, tool-result）
   - 错误信息（stderr, result with errors）
   - 关键状态变化（session start/end）

2. 可以安全过滤：
   - 详细的 token 统计信息
   - 内部的 stream_event 包装
   - 大部分 meta 事件（除非是关键状态）
   - 冗长的 UUID 和技术元数据

3. 需要保留可追溯性：
   - 关键信息应可展开查看原始数据
   - 或提供 "详细模式" / "调试模式" 切换

## Confirmed Decisions

### 决策 1：详细级别 = 极简模式
只显示 AI 文本输出、工具调用摘要、错误信息，隐藏所有 JSON、token 统计、UUID。

### 决策 2：显示格式 = 紧凑格式
```
AI: Let me read the file first
→ Read(apps/web/src/stream.ts)
AI: I found the issue...
→ Write(apps/web/src/stream.ts)
```

### 决策 3：可配置性 = UI 切换按钮
在日志页面添加切换按钮，用户可以在"简洁"和"详细"模式间切换。

## Requirements

### 核心需求（基于极简模式选择）

1. **隐藏原始 JSON 包装**
   - 不显示 `{"type":"stream_event","event":{...}}` 这类包装
   - 不显示 token 统计（input_tokens, output_tokens, cache_*）
   - 不显示内部 UUID（parent_tool_use_id, session_id 等）
   - 不显示 stop_reason、stop_sequence、stop_details 等内部状态

2. **简化工具调用显示**
   - 格式：`→ ToolName(关键参数)`
   - 示例：
     - `→ Read(apps/web/src/stream.ts)`
     - `→ Write(file.ts)`
     - `→ Bash(npm test)`
   - 工具输入的冗长 JSON 转为单行摘要

3. **保留关键信息**
   - AI 的文本输出（assistant 消息）
   - 工具执行结果的关键部分（成功/失败状态）
   - stderr 错误输出
   - 关键状态变化（session start/end）

4. **移除冗余的系统消息**
   - 过滤掉 `[system] status` 这类无实际内容的行
   - 过滤掉重复的 meta 事件（message_start/stop 的原始 JSON）

5. **UI 切换功能**
   - 在日志区域添加切换按钮（图标或文本按钮）
   - 两种模式：
     - "简洁模式"（默认）：应用上述过滤规则
     - "详细模式"：显示所有原始数据（当前行为）
   - 模式切换立即生效，重新渲染当前日志
   - 用户偏好存储在 localStorage（按 project 或全局）

### 不改变的部分

- 保持实时流式更新
- 保持 sequence tracking（用于去重和排序）
- 保持 native mode 的语义（无元数据前缀）
- 后端继续发送完整数据（仅前端过滤）

## Expansion: 未来演进与边界情况

### 1. 未来演进考虑

- **多级详细度**：未来可能需要"简洁 / 标准 / 详细"三级
  - 设计切换 UI 时预留扩展性（下拉菜单而非 toggle）
  
- **搜索/过滤功能**：用户可能需要在长日志中搜索关键词
  - 当前 MVP 不实现，但渲染结构应支持后续添加

- **日志导出**：用户可能需要复制或下载日志
  - 导出时应使用"详细模式"（保留完整信息）

### 2. 相关场景一致性

- **不同页面的日志展示**：
  - Task detail 页面
  - Workbench 页面
  - Coordinator chat 页面
  - 确保所有页面使用相同的渲染逻辑和切换功能

- **历史 vs 实时日志**：
  - 用户中途打开页面时，历史事件和新事件应一致处理
  - 切换模式时，已渲染的历史日志也要重新渲染

### 3. 失败与边界情况

- **切换模式时的性能**：
  - 如果日志有上千条事件，重新渲染可能卡顿
  - 解决：限制缓存事件数量（当前已有 maxEvents = 1000）
  - 解决：使用虚拟滚动（out of scope for MVP）

- **模式偏好持久化失败**：
  - localStorage 可能被禁用或配额满
  - Fallback：每次加载默认为"简洁模式"

- **工具参数提取失败**：
  - 某些工具的 payload 结构可能未预期
  - Fallback：显示 `→ ToolName(...)`（省略参数）

- **事件类型未知**：
  - 后端可能引入新的 event type
  - 当前代码已有 fallback（显示 JSON.stringify(payload)）
  - 简洁模式下应忽略未知类型，而非显示 JSON

## MVP 范围确认

### 包含在 MVP 中
- 简洁模式的过滤逻辑
- 详细模式（保持当前行为）
- UI 切换按钮
- 偏好存储（localStorage，全局或按 project）
- 所有使用 `buildStreamDisplayLines` 的页面生效

### 明确排除（Out of Scope）
- 三级以上的详细度
- 日志搜索/过滤功能
- 日志导出/下载
- 虚拟滚动优化
- 时间戳显示（即使在简洁模式）
- 彩色高亮或语法高亮

## Acceptance Criteria

- [ ] 原始 `stream_event` JSON 包装不再显示
- [ ] Token 统计（input_tokens, output_tokens 等）被完全隐藏
- [ ] UUID、session_id、parent_tool_use_id 等内部 ID 不显示
- [ ] 工具调用以简洁格式显示：`→ ToolName(key_param)`
- [ ] AI 文本输出保持清晰可读
- [ ] 错误信息（stderr）仍然可见
- [ ] 无内容的系统消息被过滤（如空的 `[system] status`）
- [ ] 实时流式更新功能不受影响
- [ ] 页面性能不下降（大量事件时）

## Definition of Done (Team Quality Bar)

- Tests added/updated (unit/integration where appropriate)
- Lint / typecheck / CI green
- Docs/notes updated if behavior changes
- 实际运行 Claude Code 任务，验证日志输出符合预期
- 确保前端渲染性能不受影响（事件量可能很大）

## Out of Scope (Explicit)

- 修改后端日志生成逻辑（后端继续生成完整数据）
- 修改 SSE 传输协议
- 添加日志导出/下载功能
- 历史日志的重新渲染（仅影响新加载的日志）

## Technical Approach

### 实现策略

1. **扩展 `stream-rendering.ts` 的过滤逻辑**
   - 当前 `shouldFilterEventInNativeMode()` 只过滤部分 meta/raw 事件
   - 新增更激进的过滤规则（简洁模式）
   - 新增 `formatToolCallCompact()` 提取工具名称和关键参数

2. **添加模式参数**
   - `buildStreamDisplayLines()` 接受新参数：`verbosity: 'compact' | 'verbose'`
   - 当前的 `nativeMode` 参数保留（控制前缀显示）
   - `verbosity='compact'` 时应用简洁过滤

3. **UI 切换按钮**
   - 在 `stream.ts` 的 `renderAgentStreamBody()` 附近添加切换按钮
   - 按钮位置：日志标题栏右侧
   - 图标建议：`☰` (详细) ↔ `▤` (简洁)，或文本 "简洁/详细"

4. **状态管理**
   - 在 `state.ts` 添加 `ui.streamVerbosity: 'compact' | 'verbose'`
   - 初始值从 localStorage 读取（key: `stream-verbosity` 或 `stream-verbosity:${projectId}`）
   - 切换时更新状态 + localStorage + 触发 `render()`

5. **重新渲染逻辑**
   - 切换模式时调用 `refreshStreamViewsForChannel()` 重新渲染当前 channel
   - 确保历史事件和新事件都用新模式渲染

### 关键函数修改清单

- `stream-rendering.ts`
  - `buildStreamDisplayLines(events, nativeMode, verbosity)` - 添加 verbosity 参数
  - `shouldFilterEventInCompactMode(event)` - 新增，简洁模式过滤逻辑
  - `formatToolCallCompact(event)` - 新增，提取工具调用摘要
  - `streamTextSegments(event, nativeMode, verbosity)` - 添加 verbosity 参数

- `stream.ts`
  - `buildAgentStreamView(channel, verbosity)` - 传递 verbosity 给渲染函数
  - `renderStreamVerbosityToggle()` - 新增，渲染切换按钮
  - `toggleStreamVerbosity()` - 新增，处理切换逻辑

- `state.ts`
  - 添加 `ui.streamVerbosity: 'compact' | 'verbose'`
  - 添加 localStorage 持久化逻辑

### 决策记录（ADR-lite）

**Context**: 用户反馈日志输出过于冗长，充斥原始 JSON 和元数据，难以快速定位关键信息。

**Decision**: 
- 默认使用"简洁模式"，只显示 AI 输出和工具调用摘要
- 提供 UI 切换按钮，允许用户临时查看完整日志
- 过滤在前端实现，后端保持完整数据传输

**Consequences**:
- **优点**：大幅提升日志可读性，降低视觉噪音
- **优点**：保留调试能力（可切换到详细模式）
- **优点**：实现简单，不影响后端和 SSE 协议
- **缺点**：切换模式时需要重新渲染，可能有短暂卡顿（事件量大时）
- **未来改进**：可添加虚拟滚动优化长日志性能
