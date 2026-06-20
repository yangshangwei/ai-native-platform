# 重构配置分类：从技术视角到业务场景视角

## 背景

当前的配置分类（coordinator/skill_prompts/runtime/context_policy）是从**技术模块**划分的，对用户不够友好：
- 用户不关心"这是coordinator配置还是runtime配置"
- 用户关心"我想解决什么问题"、"我遇到了什么场景"
- 18个coordinator配置堆在一个tab下，缺乏业务关联性

## 目标

从**业务场景**重新设计配置分类，让用户通过"我遇到的问题"找到配置，而非"这个配置叫什么名字"。

## 新分类方案

### Tab 1: 智能分析 (6项)
**场景**：调整AI如何理解和分类用户请求
**用户问题**："AI总是把我的bug报告识别成feature"、"怎么让它识别更多重构场景"

- coordinator.confidence_threshold - 置信度阈值
- coordinator.bug_keywords - bug关键词
- coordinator.feature_keywords - feature关键词
- coordinator.refactor_keywords - 重构关键词
- coordinator.large_scope_keywords - 大范围关键词
- coordinator.large_scope_regex - 大范围正则

### Tab 2: 对话体验 (4项)
**场景**：控制AI如何与用户交互和追问
**用户问题**："AI问得太细了，能不能简化"、"我想要更严格的需求审查"

- coordinator.clarification_style - 澄清提问风格
- coordinator.max_clarification_rounds - 最大追问轮数
- coordinator.system_prompt - 通用LLM系统提示词
- coordinator.system_prompt_grill_me - grill-me模式提示词

### Tab 3: 工作流定制 (5项)
**场景**：定制各阶段（需求/设计/实现/审查）的AI行为
**用户问题**："能不能让设计阶段强制考虑性能"、"审查时要检查我们的安全规范"

- skill.context_pack.instructions - Stage 0: 上下文收集
- skill.requirement_draft.instructions - Stage 1: 需求起草
- skill.design.instructions - Stage 2: 设计方案
- skill.implementation.instructions - Stage 3: 实现代码
- skill.review.instructions - Stage 5: 代码审查

### Tab 4: 性能与资源 (8项)
**场景**：优化执行性能和控制资源消耗
**用户问题**："执行太慢了"、"token用超了"、"日志太大影响性能"

- runner.coordinator.oneshot_timeout_ms - Coordinator超时
- runner.watch.poll_ms - Watch轮询周期
- runner.command.default_timeout_ms - 命令默认超时
- runner.command.max_log_bytes - 日志大小限制
- runner.config.cache_ttl_ms - 配置缓存TTL
- context.policy.max_tokens - 上下文token预算
- context.policy.reserved_for_reasoning - 推理token预留
- context.policy.reserved_for_output - 输出token预留

### Tab 5: 故障处理 (9项)
**场景**：排查问题和自定义错误提示
**用户问题**："为什么总是失败"、"能不能改掉这些默认错误消息"

- coordinator.fallback.too_short_questions - 请求过短兜底
- coordinator.fallback.large_scope_template - 大范围需求兜底
- coordinator.fallback.large_scope_followup - 大范围需求追问
- coordinator.fallback.llm_unavailable - LLM不可用兜底
- coordinator.fallback.llm_invocation_failed - LLM调用失败兜底
- coordinator.fallback.llm_empty - LLM返回为空兜底
- coordinator.fallback.llm_invalid_json - LLM返回非法JSON兜底
- coordinator.fallback.llm_unknown_action - LLM返回未知action兜底
- context.policy.sensitive_path_patterns - 敏感路径模式

## 实现范围

### 1. 修改配置定义
**文件**：`packages/shared/src/config/registry.ts`
- 修改 `ConfigCategory` 类型定义
- 更新每个配置项的 `category` 字段

```typescript
// 旧：
export type ConfigCategory = 'coordinator' | 'skill_prompts' | 'runtime' | 'context_policy';

// 新：
export type ConfigCategory = 'intelligent_analysis' | 'conversation_ux' | 'workflow_custom' | 'performance_resource' | 'troubleshooting';
```

### 2. 修改UI显示
**文件**：`apps/web/src/settings-projection.ts`
- 更新 `SettingsTabId` 类型
- 更新 `buildSettingsViewModel()` 中的 tab 定义（label、help文本）

### 3. Tab显示顺序和文案
```typescript
const TABS = [
  { id: 'intelligent_analysis', label: '智能分析', help: '调整AI如何理解和分类用户请求' },
  { id: 'conversation_ux', label: '对话体验', help: '控制AI如何与用户交互和追问' },
  { id: 'workflow_custom', label: '工作流定制', help: '定制各阶段（需求/设计/实现/审查）的AI行为' },
  { id: 'performance_resource', label: '性能与资源', help: '优化执行性能和控制资源消耗' },
  { id: 'troubleshooting', label: '故障处理', help: '排查问题和自定义错误提示' },
];
```

### 4. 默认Tab
- 默认展开"智能分析"（最高频）
- 修改 `page-settings.ts` 中的 `activeTab` 初始值

### 5. 视觉优化（可选）
- 故障处理Tab用灰色或警告图标，表明这是"排查问题"场景
- 每个Tab顶部可以加一行场景说明（当前是help文本）

## 验收标准

1. ✅ ConfigCategory 类型改为5个新值（intelligent_analysis等）
2. ✅ 所有32个配置项的category字段已更新
3. ✅ UI的tab导航显示5个新tab，文案正确
4. ✅ 每个tab下的配置项数量符合设计（6/4/5/8/9）
5. ✅ 默认tab是"智能分析"
6. ✅ TypeCheck通过
7. ✅ Build通过
8. ✅ 所有现有功能正常工作

## 非目标

- 不改变任何配置的key（保持向后兼容）
- 不改变配置的类型、默认值、约束
- 不改变API路由或数据结构
- 不添加新配置项

## 设计原则

1. **场景驱动**：用户通过"我想做什么"找配置
2. **渐进复杂度**：高频场景在前（智能分析、对话体验），低频/专家场景在后（故障处理）
3. **关联聚合**：相关配置聚在一起（8个fallback都在故障处理）
4. **可发现性**：每个tab都有清晰的价值主张和help文本

## 参考

- 当前实现：`packages/shared/src/config/registry.ts` (CONFIG_REGISTRY)
- UI projection：`apps/web/src/settings-projection.ts` (buildSettingsViewModel)
- 页面渲染：`apps/web/src/page-settings.ts` (renderSettingsPage)
