# 工作台自我进化系统 — 设计文档

## 背景

AI 交付平台已有 Context Injection Layer（Builder → Retriever → Renderer → Orchestrator），能将项目知识、运行时制品结构化注入 agent prompt。但当前系统是"被动消费"模式——知识由人工策展，行为由硬编码规则驱动，工作流静态定义。

自我进化系统的目标是让平台从每次交互中学习、从重复模式中发现优化空间、在能力边界处自主扩展。

---

## 目标

交付一份可实现的四层架构设计文档，作为后续 MVP 实施的唯一输入。不写代码，只产出设计。

---

## 架构总览

```
┌─────────────────────────────────────────────────────────┐
│  Layer 4: Capability Extension — 工具自生成              │
│  触发条件: 能力缺口被识别 3+ 次                          │
├─────────────────────────────────────────────────────────┤
│  Layer 3: Pattern Discovery — 工作流演化                 │
│  输入: 操作日志 + 反馈规则                               │
├─────────────────────────────────────────────────────────┤
│  Layer 2: Feedback Loop — 行为校准                       │
│  输入: 用户修正信号 → 校准规则 → 注入权重调整             │
├─────────────────────────────────────────────────────────┤
│  Layer 1: Memory — 知识沉淀                              │
│  存储基础: 所有层的持久化底座                             │
├─────────────────────────────────────────────────────────┤
│  Context Injection Layer (已有)                          │
│  Builder → Retriever → Renderer → Orchestrator          │
└─────────────────────────────────────────────────────────┘
```

---

## Layer 1: Memory — 知识沉淀

### 与现有系统的关系

现有 `knowledgeArtifacts` + `acceptedKnowledge` 是人工策展的静态知识。Memory 层在此基础上增加：
- **自动沉淀**：从 agent 执行结果中自动提取值得记住的事实
- **衰减机制**：区分永久约束 vs 阶段性事实，过期记忆降权而非删除
- **语义索引**：按语义相似度检索，而非仅靠 keyword overlap

### 数据模型

```typescript
interface MemoryEntry {
  id: string;
  projectId: string;
  category: 'constraint' | 'decision' | 'pattern' | 'preference' | 'fact';
  content: string;
  source: MemorySource;         // 来自哪次交互
  confidence: number;           // 0-1, 随确认次数上升
  durability: 'permanent' | 'long_term' | 'short_term';
  lastAccessed: Date;
  accessCount: number;
  confirmedCount: number;       // 被验证/引用次数
  contradictedCount: number;    // 被否定次数
  createdAt: Date;
  expiresAt: Date | null;
  tags: string[];
  linkedMemories: string[];     // 关联记忆 ID
}
```

### 自动沉淀触发器

| 信号 | 沉淀内容 | 初始 confidence |
|------|----------|----------------|
| agent 产出被用户无修改接受 | 该任务的关键决策 | 0.6 |
| 同一模式出现 3 次 | 模式描述 | 0.7 |
| 用户显式说"记住这个" | 原文 | 0.9 |
| knowledge stage 产出 confirmed 知识 | 知识条目 | 0.8 |

### 衰减策略

- `short_term`: 30 天未访问 → confidence × 0.5
- `long_term`: 90 天未访问 → confidence × 0.7
- `permanent`: 不衰减
- confidence < 0.2 的记忆在检索时不参与评分

### 与 Retriever 的集成点

在现有 `scoreContextCandidate` 中新增维度：

| 维度 | 计算方式 | 最大值 |
|------|----------|--------|
| `memoryRelevance` | 语义匹配分 × confidence × recencyBoost | 24 |

---

## Layer 2: Feedback Loop — 行为校准

### 信号捕获

```
AI 产出 ──→ 用户响应 ──→ 信号分类器 ──→ 校准规则生成
                │
                ├─ 直接接受 → positive signal (弱)
                ├─ 修改后接受 → correction signal (强)
                ├─ 拒绝并重做 → rejection signal (最强)
                └─ 口头纠正 → verbal correction (强)
```

### 校准规则模型

```typescript
interface CalibrationRule {
  id: string;
  projectId: string;
  type: 'preference' | 'knowledge' | 'quality' | 'process';
  rule: string;                 // 人类可读规则描述
  evidence: CalibrationEvidence[];  // 触发该规则的历史事件
  scope: RuleScope;             // project-wide | stage-specific | task-type-specific
  strength: number;             // 0-1, 随证据累积增长
  activeSince: Date;
  lastApplied: Date;
  applicationCount: number;
  successRate: number;          // 应用后用户满意度
}

interface CalibrationEvidence {
  runId: string;
  stage: string;
  signalType: 'correction' | 'rejection' | 'verbal' | 'positive';
  before: string;               // AI 原始产出摘要
  after: string;                // 用户修正后内容摘要
  delta: string;                // 差异描述
  timestamp: Date;
}
```

### 规则生命周期

```
单次修正 (evidence)
  ↓ 同类出现 2 次
候选规则 (strength=0.3)
  ↓ 同类出现 3+ 次 或 用户显式确认
活跃规则 (strength=0.6+)
  ↓ 连续 5 次应用后用户未再修正
稳定规则 (strength=0.9)
  ↓ 被新规则矛盾
废弃规则 (archived)
```

### 注入机制

在 builder 的"候选项构造"阶段，将匹配当前 stage + task_type 的活跃规则作为 `calibration_directive` 注入：

```typescript
// builder.ts 扩展
if (activeCalibrationRules.length > 0) {
  candidates.push({
    section: 'calibration_directives',
    sourceType: 'calibration_rule',
    trustLevel: 'accepted_knowledge',  // 等同已确认知识
    content: renderCalibrationRules(activeCalibrationRules),
    required: false,
    confidence: avgStrength,
  });
}
```

### 与现有 calibrationSignals 的关系

现有 `buildKnowledgeReviewSignals()` 检测知识层面的 stale/conflict。Layer 2 的校准规则是行为层面的，两者互补：
- 知识校准 → "这个事实过时了"
- 行为校准 → "你生成代码时总漏掉错误处理"

---

## Layer 3: Pattern Discovery — 工作流演化

### 输入源

- **操作日志**: orchestrator 的 graph node 执行序列
- **stage 耗时**: 哪些 stage 耗时异常
- **retry 频率**: 哪些 stage 经常需要重试
- **用户干预点**: 用户在哪些环节插手最多
- **校准规则聚类**: 某类规则密集出现说明工作流有系统性问题

### 发现类型

| 模式 | 触发条件 | 建议动作 |
|------|----------|----------|
| 冗余步骤 | stage 产出被下游忽略率 > 70% | 建议跳过或合并 |
| 缺失步骤 | 同类任务 retry 率 > 50% 且原因集中 | 建议新增前置 stage |
| 并行机会 | 两个串行 stage 无数据依赖 | 建议改为并行 |
| 模板可抽取 | 同类任务的 prompt 结构重复率 > 80% | 建议抽取为 flow template |
| 质量门槛需调整 | 某 gate 通过率 < 30% 或 > 95% | 建议调整阈值 |

### 输出形态

```typescript
interface EvolutionSuggestion {
  id: string;
  type: 'skip_stage' | 'add_stage' | 'parallelize' | 'extract_template' | 'adjust_gate';
  confidence: number;
  evidence: PatternEvidence[];
  impact: 'low' | 'medium' | 'high';
  proposedChange: FlowChange;   // 具体的 flow 变更描述
  status: 'pending_review' | 'approved' | 'rejected' | 'applied';
}
```

### 执行策略

- 所有建议先入"待审"队列，需人类确认
- 低风险建议（confidence > 0.8, impact=low）可配置为自动应用
- 应用后持续监控效果，若负面反馈增加则自动回滚

---

## Layer 4: Capability Extension — 工具自生成

### 触发条件

```
1. 同类手工操作出现 3+ 次（from 操作日志）
2. agent 在执行中显式请求不存在的 tool
3. 用户说"这个以后应该自动化"
4. Pattern Discovery 发现某个模式需要专用 skill
```

### 生成物类型

| 类型 | 生成方式 | 审批要求 |
|------|----------|----------|
| Prompt Template | 从历史成功执行中提取共性 | 轻审 |
| Flow Stage 定义 | 基于缺失步骤模式生成 | 标准审 |
| Skill 定义 | 基于重复操作模式生成 | 严审 |
| Agent Type | 基于能力缺口分析生成 | 严审 + 试运行 |

### 生成流程

```
触发 → 草稿生成 → 测试验证 → 人类审批 → 纳入能力池
                                          ↓
                                    标记为 "evolved"
                                    (区分原生 vs 进化产生)
```

### 能力注册表

```typescript
interface CapabilityRegistryEntry {
  id: string;
  name: string;
  type: 'template' | 'stage' | 'skill' | 'agent_type';
  origin: 'native' | 'evolved';
  evolvedFrom?: {
    triggerId: string;          // 触发该生成的 pattern/suggestion ID
    generatedAt: Date;
    approvedBy: string;
    approvedAt: Date;
  };
  version: number;
  usageCount: number;
  successRate: number;
  lastUsed: Date;
  status: 'draft' | 'testing' | 'active' | 'deprecated';
}
```

---

## 数据流总览

```
用户交互
  │
  ├──→ [Layer 1] 自动沉淀有价值的事实 → MemoryStore
  │
  ├──→ [Layer 2] 捕获修正信号 → CalibrationRuleStore
  │         │
  │         └──→ 下次注入时应用规则
  │
  ├──→ [Layer 3] 操作日志 → PatternAnalyzer
  │         │
  │         └──→ EvolutionSuggestion → 人类审批 → Flow 变更
  │
  └──→ [Layer 4] 能力缺口 → CapabilityGenerator
            │
            └──→ 草稿 → 测试 → 审批 → CapabilityRegistry
```

---

## 工作台产品形态（讨论稿）

自我进化不应该表现为"系统偷偷改自己"，而应该表现为工作台里的一个可审计、可批准、可回滚的学习循环。用户的直观体验是：

1. **进化收件箱**：工作台聚合"系统从最近交付中学到了什么"，例如重复修正、常见返工、缺失上下文、可抽取模板、可新增工具。
2. **证据卡片**：每条建议都展示来源 run、触发次数、典型 diff、影响范围、预期收益和回滚方式。
3. **一键批准/拒绝**：用户可以把候选规则升级为 active，也可以拒绝并记录原因，拒绝原因反过来成为校准信号。
4. **下次运行可见**：规则被应用时，context governance 能看到"本次注入了哪些学习到的规则"，避免黑箱行为。
5. **效果追踪**：工作台显示规则应用后的成功率、是否减少同类修正、是否被自动降级。

### 产品边界

- MVP 的"自我进化"只允许改变 **prompt/context 注入**，不自动改代码、不自动改 workflow、不自动生成可执行工具。
- 任何会改变流程结构或新增能力的建议，都先进入待审队列。
- 系统必须把"学习到的规则"和"原始项目事实/约束"分开展示，避免把推断误当成事实。

### MVP 用户旅程

1. 用户完成一次 AI 交付，并在 review/accept 前后做了修改。
2. 系统提取 correction signal，生成"你经常这样修正我"的候选规则。
3. 工作台在进化收件箱展示候选规则和证据。
4. 用户批准后，规则进入 active 状态。
5. 下一次同类任务启动时，Context Injection Layer 自动注入该规则。
6. 后续 run 继续追踪该规则是否减少同类修正；效果差则自动降级。

---

## MVP 范围（建议）

Phase 1 只做 Layer 2 反馈闭环的最小闭环：

1. **信号捕获**: 在 review stage 后，对比 AI 产出 vs 最终提交的 diff，提取 correction signal
2. **规则生成**: 同一 correction 出现 2 次后生成候选规则
3. **规则注入**: 在 builder 中将活跃规则作为 calibration_directive 注入
4. **效果监控**: 追踪规则应用后的 correction 率变化

Phase 2 扩展 Layer 1 自动沉淀 + Layer 3 基础模式发现。
Phase 3 引入 Layer 4 能力自生成。

---

## 开放问题

1. **记忆容量上限** — 单项目记忆条目上限多少？满了之后是 LRU 还是 confidence-based eviction？
2. **规则冲突** — 两条规则矛盾时，除了"后者覆盖前者"还需要更细粒度的消解策略吗？
3. **安全边界** — 自生成的 skill 能调用哪些底层能力？需要沙箱执行吗？
4. **多项目泛化** — 某项目的进化规则能否迁移到其他项目？条件是什么？
5. **回滚粒度** — 如果一条规则导致质量下降，回滚到什么粒度？单条规则还是整批？

---

## 集成映射表

各层与现有代码模块的接入点：

### Layer 1: Memory → 现有系统

| 现有模块 | 文件 | 集成方式 |
|----------|------|----------|
| Builder | `apps/runner/src/context/builder.ts` | `buildContextPack` 新增 memoryRetrieval 步骤，在候选项构造阶段将相关 MemoryEntry 包装为 candidate |
| Retriever | `apps/runner/src/context/retriever.ts` | `scoreContextCandidate` 新增 `memoryRelevance` 评分维度 (max 24) |
| Knowledge Store | `apps/api/src/stores/` | 新增 `memory-store.ts`，独立于 knowledgeArtifacts，有自己的 CRUD + 衰减 job |
| Orchestrator | `apps/runner/src/orchestrator.ts` | 在 `dispatchStep` 完成后触发 `maybeExtractMemory(stepResult)` |
| Governance | `apps/api/src/context-governance.ts` | `ContextGovernanceReadModel` 新增 `memoryHits: MemoryAccessSummary[]` 字段 |

### Layer 2: Feedback Loop → 现有系统

| 现有模块 | 文件 | 集成方式 |
|----------|------|----------|
| Builder | `apps/runner/src/context/builder.ts` | 候选项构造阶段新增 `calibration_directives` sourceType |
| Renderer | `apps/runner/src/context/renderer.ts` | Layer 6 (Selected Context) 渲染时，calibration_directive 类型用特定格式（指令语气） |
| Context Policy | `packages/shared/src/utils/context-policy.ts` | 新增 `CalibrationRulePolicy` 限制单次注入的规则数量上限 |
| Graph Node 完成 | `apps/runner/src/orchestrator.ts` | `api.graphNodeFinished` 时附带产出摘要，供后续 diff 比对 |
| API 审计 | `apps/api/src/context-governance.ts` | 新增 `calibrationRules: CalibrationRuleSummary[]` 和 `calibrationApplications[]` |
| Workflow Action Store | `apps/api/src/stores/` | 新增 action type `calibration_signal_captured` 和 `calibration_rule_applied` |

### Layer 3: Pattern Discovery → 现有系统

| 现有模块 | 文件 | 集成方式 |
|----------|------|----------|
| Graph Scheduler | `apps/runner/src/orchestrator.ts` | 从 graph run 历史中提取执行序列和耗时 |
| Flow Registry | `apps/runner/src/flows/` | `FLOW_REGISTRY` 支持动态注册 evolved flow variants |
| Gate Runs | `apps/api/src/stores/` | 读取 gate 通过率统计 |
| API | `apps/api/src/routes/` | 新增 `/evolution/suggestions` endpoint |
| Web Dashboard | `apps/web/` | 新增"进化建议"面板，展示待审批建议 |

### Layer 4: Capability Extension → 现有系统

| 现有模块 | 文件 | 集成方式 |
|----------|------|----------|
| Skill Spec | `apps/runner/src/skills/` | 新增 `evolved-skills/` 目录，运行时动态加载 |
| Agent Backend | `apps/runner/src/agent/` | agent tool 列表支持动态注入 evolved tools |
| Flow Registry | `apps/runner/src/flows/` | 支持 `origin: 'evolved'` 标记的 flow stage |
| API | `apps/api/src/routes/` | 新增 `/capabilities/registry` CRUD endpoint |
| Governance | `apps/api/src/context-governance.ts` | 区分 native vs evolved 能力的审计追踪 |

---

## MVP Phase 1 详细方案 — 反馈闭环最小闭环

### 目标

在不改变用户工作流的前提下，让系统从 review stage 的人工修正中自动提取校准规则，并在后续同类任务中注入这些规则。

### 范围边界

- 只处理 review stage 产出 vs 最终 commit 的 diff（信号最清晰）
- 不引入新的 UI 交互（利用已有的 approve/reject 流程）
- 规则只影响 prompt 注入权重，不改变 flow 结构
- 所有规则默认需人工确认后才升级为 active

### 实现步骤

#### Step 1: 信号捕获 — `CalibrationSignalCollector`

位置：`apps/runner/src/evolution/signal-collector.ts`

```typescript
interface CorrectionSignal {
  runId: string;
  stageId: string;
  taskType: string;
  aiOutput: string;          // agent 原始产出的摘要/hash
  finalOutput: string;       // 用户最终接受的版本摘要/hash
  delta: CorrectionDelta;    // 结构化差异
  severity: 'minor' | 'major' | 'critical';
  timestamp: Date;
}

interface CorrectionDelta {
  type: 'addition' | 'removal' | 'replacement' | 'reorder';
  category: 'style' | 'logic' | 'completeness' | 'accuracy' | 'convention';
  description: string;       // 由 LLM 生成的自然语言描述
  affectedArea: string;      // 代码区域/文件类型
}
```

触发时机：当 review stage 的 gate 为 `passed_with_changes` 或者 orchestrator 检测到 agent 产出文件与 worktree 最终 commit 有 diff 时。

#### Step 2: 规则聚合 — `CalibrationRuleAggregator`

位置：`apps/runner/src/evolution/rule-aggregator.ts`

逻辑：
1. 新信号入库后，查找同 `projectId + category + affectedArea` 的历史信号
2. 若匹配 ≥ 2 条，调用 LLM 生成候选规则（prompt: "基于以下修正历史，提取一条通用规则"）
3. 候选规则存入 `CalibrationRuleStore`，status=`candidate`, strength=0.3
4. 匹配 ≥ 3 条 或 用户在 dashboard 点击确认 → status=`active`, strength=0.6

规则去重：新生成的规则与已有规则做语义相似度比较（embedding cosine > 0.85 视为重复），重复时合并 evidence 而非新建。

#### Step 3: 规则注入 — Builder 扩展

位置：`apps/runner/src/context/builder.ts` 的 `buildContextPack` 扩展

```typescript
// 在"候选项构造"阶段（步骤 6）之后：
const activeRules = await calibrationRuleStore.findActive({
  projectId: input.project.id,
  stage: input.stage,
  taskType: input.taskBrief?.taskType,
});

if (activeRules.length > 0) {
  const topRules = activeRules
    .sort((a, b) => b.strength - a.strength)
    .slice(0, MAX_CALIBRATION_RULES_PER_PACK); // 上限 5 条

  candidates.push({
    section: 'calibration_directives',
    sourceType: 'calibration_rule',
    trustLevel: 'accepted_knowledge',
    content: renderCalibrationDirectives(topRules),
    required: false,
    confidence: avg(topRules.map(r => r.strength)),
    keywords: topRules.flatMap(r => r.tags),
  });
}
```

渲染格式（在 renderer 中）：
```
## Calibration Directives (learned from prior corrections)
- [CONV] Always use camelCase for local variables in this project (confidence: 0.8, applied 12 times)
- [QUAL] Include error boundary handling for all async operations (confidence: 0.7, applied 5 times)
```

#### Step 4: 效果追踪 — `CalibrationEffectivenessTracker`

位置：`apps/runner/src/evolution/effectiveness-tracker.ts`

逻辑：
1. 每次规则被注入后，记录 `ruleId + runId` 到 `calibration_applications` 表
2. 该 run 完成后，检查是否仍出现同类 correction signal
3. 若未出现 → `successCount++`
4. 若仍出现 → `failureCount++`
5. `successRate = successCount / (successCount + failureCount)`
6. successRate < 0.3 持续 5 次 → 自动降级为 `candidate`，通知用户

### 数据存储

新增 store（位于 `apps/api/src/stores/`）：

| Store | 主要方法 |
|-------|----------|
| `CalibrationSignalStore` | `insert(signal)`, `findByProject(projectId, filters)`, `countByCategory(projectId, category, area)` |
| `CalibrationRuleStore` | `insert(rule)`, `findActive(filters)`, `updateStrength(id, delta)`, `archive(id)` |
| `CalibrationApplicationStore` | `recordApplication(ruleId, runId)`, `recordOutcome(ruleId, runId, success)`, `getEffectiveness(ruleId)` |

底层：复用现有的 store 模式（内存 + JSON 文件持久化，与 `artifactStore` / `workflowActionStore` 同构）。

### 配置

在 project settings 中新增：

```typescript
interface EvolutionConfig {
  calibration: {
    enabled: boolean;                    // 总开关
    autoPromoteThreshold: number;        // 自动升级所需的证据数 (default: 3)
    maxRulesPerPack: number;             // 单次注入上限 (default: 5)
    minStrengthForInjection: number;     // 注入最低 strength (default: 0.5)
    autoDeprecateAfterFailures: number;  // 连续失败几次后降级 (default: 5)
  };
}
```

### 验收标准

1. 在 review stage 后，correction signal 被自动提取并存入
2. 同类信号出现 2 次后，系统生成候选规则
3. 活跃规则在下次同类任务的 context pack 中可见（governance 审计可查）
4. 规则注入后同类 correction 率下降 > 30%（需要 10+ 样本验证）
5. effectiveness 低的规则被自动降级

---

## 产出物

本任务交付：
- [x] 本 PRD（架构设计 + 数据模型 + 集成点）
- [x] 各层与现有代码的集成映射表
- [x] MVP Phase 1 的详细实现方案
