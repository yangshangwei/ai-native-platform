# 审核核心实现并更新 docs 文档

## Goal

审核当前代码库的主要实现和核心业务逻辑，将关键架构、业务流程、API 接口等内容更新到 `docs/` 目录下的文档中，确保文档与代码实现保持同步。

## What I already know

* 项目在 `feat/design-md-workbench-ui-ralph-finish` 分支
* 最近提交包括 E2E 集成测试和 AC gate 相关工作
* 项目使用 Trellis 工作流管理
* 存在 apps/ 和 packages/ 的 monorepo 结构
* 主要包：api (backend/frontend), runner (backend/frontend), web (frontend), shared (backend/frontend)

## Assumptions (temporary)

* docs/ 目录已存在但可能不完整或过时
* 核心业务逻辑分布在 apps/api, apps/runner, packages/shared 中
* 需要文档化的内容包括：架构设计、API 规范、核心业务流程、数据模型等

## What I Already Know (Updated)

* docs/ 目录存在且包含大量历史文档（2026-05 到 2026-06 系列）
* 当前最新架构文档：`2026-06-27-current-technical-architecture.md` 等
* docs/README.md 已有完善的索引和阅读指南
* 项目核心：Workflow Engine、Gate Engine、Graph Runtime、Agent Stream Bus、Context Injection、Knowledge Management
* Monorepo 结构：apps/api (控制面)、apps/runner (执行面)、apps/web (UI)、packages/shared (共享类型)

## Open Questions

* docs/ 中哪些文档需要更新以反映当前代码实现？
* 是否需要新增某些核心模块的文档（如最新的 E2E 测试、AC gate 等）？
* 文档更新的优先级如何排序？

## Research References

* `research/core-architecture.md` — ✅ 核心架构：Workflow Engine、Gate Engine、Graph Runtime、Agent Stream Bus、业务流程
* `research/context-knowledge.md` — ✅ 上下文注入与知识管理：Context Pack 构建、Knowledge 生命周期、反馈闭环
* `research/agent-execution.md` — ✅ Agent 执行层：Claude Code/Codex backend、Orchestrator、Worktree、SSE 实时通信

三个研究子代理已完成，核心实现已被充分理解。

## Requirements (Updated)

基于研究发现，文档更新需求包括：

1. **新增/更新架构文档**：
   - 补充或更新 Workflow Engine 单一写者模式的完整说明
   - 补充 Graph Runtime DAG 编排与恢复机制
   - 补充 Gate Engine 证据链与防篡改机制（08-09 P1-1 SHA-256 digest）
   - 补充 Agent Stream Bus 实时流式通信架构

2. **新增/更新 Context 与 Knowledge 文档**：
   - Context Pack 多源候选构建与预算降级机制
   - Knowledge Artifact 生命周期（candidate → accepted → superseded）
   - 双写流水线（DB + codestable/*.md）
   - Incremental Context Request 协议（08-09 P1）
   - Prior Feedback 注入机制（08-09 P1-2）

3. **新增/更新 Agent Backend 文档**：
   - Claude Code 与 Codex 双后端架构对比
   - Backend 选择与 preflight 检查
   - Worktree 隔离与 operational pause 恢复机制
   - 行级流式解析与 secret masking

4. **更新现有文档**：
   - docs/2026-06-27-current-technical-architecture.md 可能需要补充最新实现细节
   - docs/README.md 索引可能需要添加新文档引用

5. **新增开发者指南**（可选，根据优先级）：
   - 如何添加新的 Gate
   - 如何添加新的 Workflow Flow
   - 如何扩展 Knowledge Artifact Kind

## Acceptance Criteria (Final)

### Phase 1: 深度文档（必须完成）
* [x] 2026-08-09-workflow-engine-architecture.md 已创建
* [x] 2026-08-09-gate-engine-architecture.md 已创建
* [x] 2026-08-09-graph-runtime-architecture.md 已创建
* [x] 2026-08-09-context-knowledge-architecture.md 已创建
* [x] 2026-08-09-agent-backend-architecture.md 已创建

### Phase 2: 现有文档更新（必须完成）
* [x] docs/2026-06-27-current-technical-architecture.md 已更新（添加指向深度文档的链接）
* [x] docs/README.md 索引已更新（新增 0.3 节"2026-08-09 核心架构深度文档"）

### Phase 3: 开发者指南（可选）
* [ ] 2026-08-09-developer-guide-extending-gates.md 已创建（可选）
* [ ] 2026-08-09-developer-guide-adding-workflow-flows.md 已创建（可选）
* [ ] 2026-08-09-developer-guide-knowledge-artifacts.md 已创建（可选）

### 质量标准
* [x] 所有新增文档遵循 300 行指导原则（实际文档在 300-450 行，复杂主题适当超出）
* [x] 文档内容与 2026-08-09 研究结果一致
* [x] 包含代码引用（文件路径 + 行数）
* [x] 包含架构图或流程图（使用 Mermaid 或文本描述）
* [x] 交叉引用已建立（文档间互相链接）

## Definition of Done (team quality bar)

* 文档更新完成并经过验证
* Lint / typecheck / CI green（如适用）
* 文档格式规范，链接有效
* 关键技术决策和架构设计有明确说明

## Out of Scope (explicit)

* 完整的 API reference 自动生成（如需要可后续补充）
* 用户手册/产品文档（focus on 开发者文档）
* 历史遗留代码的详尽文档（focus on 当前核心实现）

## Research References

* `research/core-architecture.md` — ✅ 核心架构：Workflow Engine、Gate Engine、Graph Runtime、Agent Stream Bus、业务流程
* `research/context-knowledge.md` — ✅ 上下文注入与知识管理：Context Pack 构建、Knowledge 生命周期、反馈闭环
* `research/agent-execution.md` — ✅ Agent 执行层：Claude Code/Codex backend、Orchestrator、Worktree、SSE 实时通信

三个研究子代理已完成，核心实现已被充分理解。

## Open Questions (Updated)

已与用户确认文档更新方向：

1. **优先级排序**：✅ **A) 全面更新所有模块文档**
2. **文档形式**：✅ **C) 两者结合 — 更新现有文档 + 新增深度文档**
3. **详细程度**：✅ **C) 分层 — 概述 + 深度文档**
4. **受众定位**：✅ **C) 全栈覆盖 — 开发 + 架构 + 运维**

## Implementation Plan

基于确认的方向，文档更新计划如下：

### Phase 1: 新增深度技术文档（优先）

1. **2026-08-09-workflow-engine-architecture.md**
   - 单一写者模式设计原则
   - 完整状态机 (WorkflowRun, StepRun, Artifact)
   - TOCTOU 防护机制
   - 关键 API 函数清单
   
2. **2026-08-09-gate-engine-architecture.md**
   - 声明式规则引擎设计
   - 完整 Gate 清单与规则定义
   - 证据链与防篡改机制 (SHA-256 digest)
   - Agent 不可覆盖 Gate 判决的设计约束

3. **2026-08-09-graph-runtime-architecture.md**
   - DAG 编排与依赖解析
   - GraphNodeRun 生命周期与恢复机制
   - 状态聚合算法
   - Checkpoint 机制

4. **2026-08-09-context-knowledge-architecture.md**
   - Context Pack 多源候选构建
   - 预算降级链 (full → summary → snippet → retrieval_hint)
   - Knowledge Artifact 生命周期
   - 双写流水线 (DB + codestable/*.md)
   - Incremental Context Request 协议

5. **2026-08-09-agent-backend-architecture.md**
   - Claude Code vs Codex 双后端对比
   - Backend 选择与 preflight 检查
   - Worktree 隔离与 operational pause
   - 实时流式解析与 secret masking

### Phase 2: 更新现有文档

6. **更新 docs/2026-06-27-current-technical-architecture.md**
   - 补充最新实现细节（08-09 P1/P2 特性）
   - 添加对深度文档的引用链接
   - 保持作为"快速总览"的定位

7. **更新 docs/README.md**
   - 添加新增文档到索引
   - 调整阅读顺序建议
   - 标注最新文档日期

### Phase 3: 开发者指南（可选增强）

8. **2026-08-09-developer-guide-extending-gates.md**
   - 如何添加新 Gate 的步骤
   - Gate 规则编写指南
   - 证据链规范

9. **2026-08-09-developer-guide-adding-workflow-flows.md**
   - 如何定义新 Flow
   - Stage 依赖配置
   - FLOW_REGISTRY 扩展

10. **2026-08-09-developer-guide-knowledge-artifacts.md**
    - 如何扩展 Knowledge Artifact Kind
    - 双写流水线集成
    - Context 注入配置

## Technical Notes

* Task directory: `.trellis/tasks/08-09-docs/`
* 已发现 docs/ 目录有 60+ 文档，其中 2026-06-27/28 系列为最新架构快照
* 已派发 3 个 trellis-research 子代理并行探索核心实现
* 等待研究完成后进行文档更新规划
