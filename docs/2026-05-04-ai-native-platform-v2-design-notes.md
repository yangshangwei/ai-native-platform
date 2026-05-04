# AI Native Platform V2 设计纲要

> 日期：2026-05-04
> 性质：**演进方向纲要**，不是工程拆解。基于对 V1（9 阶段流水线）的复盘 + 对 CodeStable 设计哲学的提炼。
> 立意：把 AINP 从"feature 流程套所有"的产品形态，升级到"懂软件交付多样性"的 AI 原生开发平台。
> 重点：**双写架构（DB + 文件）** 和 **智能路由入口** 是 V2 的两条架构主轴。

---

## 0. TL;DR

V1 的 9 阶段固定流水线**架构骨架是稳的**，但有两个根本性短板：

1. **流程僵化**：所有任务（bug / feature / refactor / audit）都被塞进同一条 9 阶段管子；入口固定，不诊断仓库现状就直接从 context_pack 开始走完
2. **知识扁平**：所有沉淀都叫 "knowledge"，扁平、无分类，三个月后没人能从里面找到"我要的那条 decision"

V2 借鉴 CodeStable 的 6 条底层哲学，**保留 AINP 已有的产品化基础设施（DB / Web UI / SSE / 多 backend / 异步 gate）**，把它从"AI 软件交付流水线"重塑为"AI 团队的软件交付工作台"。

两条架构主轴：

- **双写**：所有产物**既写 DB 也写文件**。DB 用于 web 检索、关联、追溯；文件保留 git 可读性和"代码即文档"的演进速度
- **路由**：新建任务时不直接进流程，而是先做"诊断"——根据仓库现状、产物存量、改动估计，**动态拼装** stage 序列

---

## 1. V1 现状回顾

### 1.1 当前架构（apps/runner/src/orchestrator.ts）

外部 orchestrator 驱动 9 阶段流水线，每个阶段是独立的子进程：

| Stage | 是否调 LLM | 实际谁干活 |
|---|---|---|
| 0. context_pack | ✅ | 单独 spawn 一次 claude/codex |
| 1. requirement | ✅ | 单独 spawn |
| 2. design | ✅ | 单独 spawn |
| 3. implementation | ✅ | 单独 spawn |
| 4. build_test | ❌ | runner 跑真实 mvn |
| 5. review | ✅ | 单独 spawn |
| 6. acceptance | ❌ | 人工 gate |
| 7. completion report | ❌ | API 后端生成 |
| 8. knowledge candidate | ✅ + 人工 gate | API + 审批 |

### 1.2 阶段间数据流转（artifacts + inputs map）

V1 已经做对的部分，**V2 要保留**：

**3 套并行存储**：
- 内存 `inputs: Record<string, string>`（喂下一个 agent 的 prompt）
- 磁盘 `~/.ai-native/artifacts/{runId}/{stage}/{name}`（真相源）
- DB `postArtifact()` artifact 行（血缘审计）

**4 步循环**：
1. 喂入 — agent 启动前 inputs 已累积所有此前 stage 产物
2. 落盘 — agent 写到 `artifactsDir/<output.name>` 绝对路径
3. 注册 — runner 读回 → `api.postArtifact` → `inputs[name] = text`
4. 透传 — 下一个 invokeSkill 接收完整 inputs map

**关键设计取舍**：
- 累积而不是替换 → 上下文不会丢，但 token 涨
- 文本传输不做结构化 → orchestrator 不背业务契约
- artifact ID 仅用于 DB 血缘，prompt 用文本

### 1.3 V1 的 7 条短板

| 短板 | 病因 | V2 怎么治 |
|---|---|---|
| 字符串契约太软 | SkillSpec 名字相等是唯一约束 | 加语义 verifier + 实体化编号 |
| inputs 单调累加，token 失控 | 后期 stage prompt 爆 | inputs 截断/摘要策略 |
| 单 shot 没重试 | exitCode≠0 直接 throw | stage retry + checkpoint 恢复 |
| impl 看不见测试反馈 | 进程边界硬切割 | 长会话 + checkpoint 替代多进程 |
| knowledge 扁平 | 一个 knowledge_candidate 装所有 | 多类知识结构化（见 § 3.4） |
| 流程单一（feature 万能） | 9 阶段写死 | 工作类型多态（见 § 2.1） |
| 入口固定 | 任何任务从 context_pack 开始 | 智能路由诊断（见 § 3.2） |

---

## 2. V2 借鉴的 6 条底层哲学

抽掉 CodeStable 的 cs-* skill 名和 `codestable/` 目录约定，剩下的"骨头"是这些。这是 V2 设计的**思想根基**。

### 哲学 1：工作类型多态性（Workflow Polymorphism）

修 bug、做 feature、做重构、做审计是**形状不同**的工作，不是同一条流水线的不同变体。每种有自己的入口、stage 序列、退出条件。

> 反面教材：V1 把所有事塞进 9 阶段管子，本质是"用 feature 流程当万能模具"。

### 哲学 2：入口是诊断不是预设（Routing over Prescribing）

用户说"我想做 X"时，系统**先看仓库现状再决定从哪一步进入**：
- 已有 PRD → 跳过 brainstorm
- 已有 design → 直接 impl
- 改动很小 → 走 fastforward
- 完全空白 → 走完整流程

**流程是根据现状动态拼出来的，不是按 enum 预设的。**

### 哲学 3：知识有结构、有时效、有读者（Structured Knowledge）

不能把所有沉淀塞一个袋子里。每条知识至少要回答 4 个维度：

- **时间属性**：现状 / 计划 / 历史
- **读者视角**：任务导向（怎么用 X 做 Y）/ 零件导向（X 是什么）
- **语气属性**：警示性 / 处方性
- **生命周期**：永久 / 会刷新 / 会过期

### 哲学 4：强约束硬于软建议（Hard Rules）

"挂载点 3-5 个"、"每条断言必须 cite 源码路径"、"用户故事必须有具体角色"——这些是**产出门槛**，不是 UX 建议。**不达标 = 不出门**。

> 关键洞见：LLM 在没有强约束时会向"看起来像那么回事"的中间状态收敛。强约束把这个收敛点钉在"真的有用"的位置。

### 哲学 5：闭环回写而不是单向产出（Write-back）

acceptance 不是"点个通过就完事"——它会**反向更新**：
- architecture（系统现状变了）
- requirement（这条能力上线了）
- roadmap（这块计划兑现了）
- learning（踩了新坑）

**每次交付都让知识库跑前一步。**

### 哲学 6：编号是契约，不是命名（Identifier as Contract）

REQ-### / AC-### / DSN-### 不是为了好看，是为了让"谁影响谁"**机器可追溯**。每条 design 引 REQ，每条测试引 AC，gate 报告里出现 AC-### 才能证明"这条验收过了"。**编号串起整条因果链**。

---

## 3. V2 关键架构决定

### 3.1 ⭐ 双写架构（DB + 文件）

**这是 V2 的第一根架构主轴**。所有产物**既写 DB 也写文件**，两边永远一致。

#### 为什么必须双写

| 单写 DB（不要文件） | 单写文件（不要 DB） | 双写 |
|---|---|---|
| ❌ 项目 README 看不到这些文档 | ❌ 多人协作只能 git PR | ✅ 兼得 |
| ❌ 无法离线编辑 | ❌ 没有 dashboard / 检索 | ✅ |
| ❌ 没有 git history | ❌ 没有关联追溯 | ✅ |
| ✅ 检索快、关联强 | ✅ 演进快、AI 友好 | ✅ |

#### 一致性策略

- **文件是真相源**（source of truth）
- DB 是**索引 + 关系镜像**
- 写入流程：agent 写文件 → webhook/git commit → 同步进 DB
- 读取流程：UI 优先读 DB（快、可关联），点击穿透时才回退到文件原文
- 冲突解决：以文件为准，DB 重建（DB schema 演进时也走重建路径）

#### 仓库布局约定

让产物**双写**：
- 数据库：用于 web 查询、关联、过滤、检索
- 仓库目录：保留 markdown 结构，git 可读

具体目录命名 V2 实施期再定，**关键约束**：
- 路径稳定（不能动 schema 就改路径）
- 一类一目录（不要把 design 和 architecture 塞一起）
- frontmatter 强约束（编号、状态、关系字段必填）

#### Web 版能比纯 git 强的地方

CodeStable 在 markdown 里只能"靠人 grep"完成的事，Web 版用 DB 关系**可以做到点击级追溯**：
- 点 AC-001-1 → 跳到对应 design 的挂载点
- 点挂载点 → 跳到测试报告
- 点测试报告 → 跳到通过这条的 commit

这是 Web 版**真正能比 CodeStable 强**的地方。

### 3.2 ⭐ 智能路由入口

**这是 V2 的第二根架构主轴**。当前痛点：任何任务都从 context_pack 开始，用户感觉"不智能"。

#### 当前痛点举例

- 用户改一个分号 → 跑 context_pack + requirement + design + impl + test + review + acceptance + completion + knowledge → 9 步
- 用户已经写好 PRD 想直接 design → 还得过 context_pack 重塞一遍
- 用户想做架构审计 → 没法，9 阶段流水线只服务"feature"

#### 诊断卡机制

新建任务时**第一屏不是表单是诊断**：

```
用户描述：「我想给 Calculator 加 divide 方法」

系统诊断（基于仓库扫描 + 知识库匹配）：
  ✓ 检测到本仓库已有 REQ-042 "Calculator 基础运算" 描述类似能力
  ✓ 类似改动近 30 天平均走 ff 通道，3 分钟完成
  ✓ 这块代码上次改动有 Lesson-017 标记"注意整数溢出"
  ⚠ 没有检测到 design 文档

建议入口： [ 直接进 design ] (默认推荐)
可改为：   [ 完整流程 ]  [ ff 快速通道 ]  [ 从 brainstorm 重头 ]
```

让用户**选粒度**而不是**塞流程**。

#### 流程动态拼装

V1 的 stage 是写死的 enum，V2 改成**动态序列**：

```
任务 = {
  kind: 'feature' | 'issue' | 'refactor' | 'audit' | 'onboarding' | 'exploration',
  flow: 'standard' | 'fastforward' | 'custom',
  stages: Stage[],  // 由路由器根据 kind + flow + 仓库现状生成
}
```

每个 stage 仍然落 artifact + 跑 gate + 等审批，**但 stage 列表是诊断结果**。

#### 路由器的输入

- 用户描述（自然语言）
- 仓库现状（产物存量：是否有 design? 是否有 PRD?）
- 历史模式（同类任务用了哪种 flow）
- 知识库匹配（相关 lessons / decisions / patterns）

#### 路由器的输出

- **建议起点 stage**（带理由）
- **建议 flow**（standard / ff）
- **关联知识列表**（自动喂进后续 prompt）
- **预估时间 + token 成本**

### 3.3 长会话 + checkpoint 替代多进程

V1 每 stage spawn 独立 claude 进程的代价：
- prompt cache miss
- 上下文丢失，全靠 inputs 文本回灌
- 单 shot 失败就整 run 挂
- impl 看不见测试结果

V2 改成：**单个长会话 agent，吃 V2 风格的可演进 spec，每个 stage 仍然落 artifact + 跑 gate + 等审批，但模型本身不丢上下文**。

代价是会话失败爆炸半径变大，需要更强的 checkpoint/recovery 机制。

落地建议：
- 每个 stage 完成时 **snapshot 会话状态**（不只是 artifact）
- 失败时支持"从最近 checkpoint 恢复"，不必全重跑
- 关键 gate（acceptance/sensitive）仍然异步等人工，会话挂起期间 agent 不持续烧 token

### 3.4 结构化产物体系

V1 的扁平 `knowledge_candidate` 升级成多类一等公民。**用 artifact_kind 枚举区分**，UI 各自独立视图：

| 产物类型 | 时间属性 | 读者视角 | 生命周期 | 例子 |
|---|---|---|---|---|
| Requirement | 现状能力 | 任务导向 | 会刷新 | "Calculator 基础运算" |
| Architecture | 现状代码 | 零件导向 | 会刷新 | 系统模块图 |
| Roadmap | 计划 | 任务导向 | 会兑现 | "Q3 加除法" |
| Decision | 历史决定 | 零件导向 | 永久 | "选 Maven 不选 Gradle" |
| Lesson | 历史踩坑 | 警示性 | 永久（高亮老的） | "整数溢出注意" |
| Pattern/Trick | 处方 | 处方性 | 长期 | "用 BigDecimal 替代 double" |
| Explore | 调研存档 | 任务导向 | 长期 | "调研 X 是否能用" |
| Dev Guide | 任务文档 | 任务导向 | 会刷新 | "怎么本地起 runner" |
| API Doc | 零件文档 | 零件导向 | 会刷新 | "RunnerAPI 参考" |
| Design | 单次交付 | 任务导向 | 短期 | DSN-### |
| Diff/Test Report | 单次交付证据 | — | 永久审计 | impl 产物 |

每类**自己的列表 / 搜索 / 详情页 / 关联视图**，不挤一个 knowledge tab。

### 3.5 语义 verifier 扩展 gate 系统

V1 已有 gate 机制（diff_scope_gate / sensitive_change_gate / compile_gate / test_gate），但只查路径前缀和 mvn 退出码。

V2 把 gate 扩展到**产出质量的语义检查**：

| Gate | 检查内容 |
|---|---|
| requirement_quality_gate | 必有 ≥1 AC-### / 必有 pitch 字段 / 用户故事有具体角色 |
| design_quality_gate | 挂载点 3-5 / 每个 src 路径 grep 验证存在 / 不含代码片段 |
| traceability_gate | 所有 AC-### 引用都能在 requirement.md 找到本体 |
| knowledge_freshness_gate | accepted_knowledge 超过 N 天且代码改了 X% 触发复审 |

**不通过 = 真 fail，不是黄色警告**。这是 V1 已有的 gate 引擎能直接扩展的。

### 3.6 实体化的编号系统

V1 的 traceability.json 是 LLM 写的字符串，没有实体校验。V2 在 DB 建立显式的 entity + foreign key：

```
requirements (id: REQ-001, status, version)
  └─ acceptance_criteria (id: AC-001-1, parent: REQ-001)
designs (id: DSN-001, ref_req: REQ-001, status)
  └─ mount_points (id, parent: DSN-001, kind, target_file)
implementations (id, ref_design: DSN-001, commit_sha)
test_runs (id, ref_ac: AC-001-1, status, evidence_uri)
decisions (id: ADR-001, supersedes: ADR-XXX)
lessons (id: LSN-001, severity, related_files[])
```

**LLM 产出新编号时，runner 校验：**
- ID 唯一性
- 引用的父 ID 必须存在
- 引用的 AC 必须真在 requirement.md 里
- 不通过就回滚 stage

UI 上每个编号是可点击的，**整条链路可穿透浏览**。

---

## 4. V2 信息架构

### 4.1 顶层导航（Web UI 左栏）

不按"我的项目"展开，按**工作类型 + 知识类型**展开：

```
┌─ 概览 (project dashboard)
├─ 工作流
│  ├─ Issue Tracker      ← bug 流程
│  ├─ Features          ← 新功能流程
│  ├─ Refactors         ← 重构流程
│  ├─ Audits            ← 审计流程
│  └─ Explorations      ← 调研流程
├─ 知识库
│  ├─ Requirements      (REQ-###)
│  ├─ Architecture      (只读现状)
│  ├─ Roadmap           (计划)
│  ├─ Decisions         (ADR-###，永久)
│  ├─ Lessons           (LSN-###，警示)
│  ├─ Patterns          (复用模式)
│  └─ Explores          (调研存档)
├─ 文档
│  ├─ Dev Guides        (任务导向)
│  └─ API Reference     (零件导向)
├─ Approvals (人工 gate 队列)
└─ Settings
```

### 4.2 第一阶段先做 3 种工作流

不要一次覆盖 100%。先做：

1. **feature**（新功能）：完整流程 + ff 通道
2. **issue**（bug）：report → analyze → fix
3. **refactor**（重构）：scan → design → apply

其他类型做成 escape hatch，让用户写自由 prompt。**覆盖 100% = 哪个都做不深**。

### 4.3 acceptance 阶段产生"知识更新提案"

V1 的 acceptance 只是 yes/no 按钮，V2 改造：

系统对照本次交付**自动生成回写提案**：
- "在 Architecture 的 `apps/runner` 模块加一段：新增 X 能力"
- "标记 REQ-042 状态：implemented"
- "新建 Lesson：本次踩坑 Y，建议未来 Z"
- "Roadmap 里勾掉 milestone-3"

每条提案是**可逐条审批的 diff**，批准就 git commit + DB 写入，拒绝就丢弃。**让交付的副作用显式化**。

---

## 5. 改造路径（按 ROI 排）

### Wave 1（基础设施，最先做）

| 改动 | 体现哲学 | 估算 | 阻塞了谁 |
|---|---|---|---|
| **artifact_kind 枚举扩展**（10 类） | 哲学 3 | 1 周 | 后续所有改动 |
| **编号实体化**（DB 加表） | 哲学 6 | 1 周 | 知识库视图 |
| **双写 pipeline**（写文件 + 写 DB） | 架构主轴 1 | 1-2 周 | 知识库视图 |

### Wave 2（流程多态化）

| 改动 | 体现哲学 | 估算 |
|---|---|---|
| **降级现 9 阶段为 "feature/standard" 这一种 flow** | 哲学 1 | 1 周 |
| **加 issue + refactor 两条 flow** | 哲学 1 | 2 周 |
| **fastforward 通道** | 哲学 1+2 | 1 周 |
| **路由诊断器**（智能入口） | 架构主轴 2 | 2 周 |

### Wave 3（质量护栏）

| 改动 | 体现哲学 | 估算 |
|---|---|---|
| **语义 verifier 扩 gate** | 哲学 4 | 持续 |
| **acceptance 回写提案** | 哲学 5 | 2 周 |
| **长会话 + checkpoint** | 性能/可靠性 | 3-4 周（最大 risk） |
| **inputs 截断/摘要策略** | token 成本 | 1 周 |

### Wave 4（产品化打磨）

- 编号穿透浏览
- 知识失效高亮
- 多视图切换
- 多人协作 review

---

## 6. 5 个容易踩的坑（设计禁忌）

### 坑 1：把"借鉴 CodeStable"做成"另一个 PRD 管理工具"
CodeStable 的精华是**强约束 + 路由智能**。去掉这两条，剩下的就是 Notion + Linear。**约束不能为了"用户体验"放水**。

### 坑 2：把所有产物做成 Web 表单
markdown 是有道理的——LLM 读写都顺、git diff 友好、可以离线编辑。V2 应该是**结构化 frontmatter + markdown body** 的混合：表单管 frontmatter（编号、状态、关系），编辑器管正文。**不要把"挂载点"做成"添加挂载点"按钮 + 表单字段**。

### 坑 3：UI 把流程"图形化"反而限制流程演进
Linear / Jira 那种"自定义 workflow 图"很 fancy，但**会把流程冻死**。V2 的流程定义最好走 **"代码即配置"**（一份 yaml/ts spec 跑出 UI），而不是给用户拖拽编排。**演进速度比可视化重要十倍**。

### 坑 4：试图覆盖 100% 工作类型
先做 3 种就行（feature / issue / refactor），其他做成 escape hatch。**覆盖 100% = 哪个都做不深**。

### 坑 5：把"AI 原生"做成"AI 自动化"
AI 原生 ≠ "什么都让 AI 干"。**人和 AI 分工要清楚**：
- AI 写草稿、查代码、生成候选
- 人决策、批准、注入约束
- AI **不**做 acceptance 决策、**不**修改 decisions log、**不**移动 roadmap milestone

V2 要把这种分工**显式化在 UI 上**——哪些按钮人才能点、哪些操作 AI 自动做、哪些要双签。**别让 UI 假装"全自动"，用户会立刻不信**。

---

## 7. 一句话定位

> 如果用户用了 AINP V2 后感觉"**这套工具是真懂软件交付的，不是给 GPT 套个壳**"，就是 V2 落地成功。

具体表现是这 4 条任意一条做到：

1. 改个分号能 30 秒走完
2. 做个大 feature 自动催你写 roadmap
3. 三个月后能从一条 AC 点回当时的设计、决策、踩坑
4. 同样的烂设计第二次出现时，系统会拦下来说"上次踩过这个坑（Lesson-017）"

这 4 条任意一条做到，就比市面上 90% 的"AI 编程平台"做得深。

---

## 附录 A：与 V1 的 mapping cheat sheet

| V1 概念 | V2 演化 |
|---|---|
| 9 阶段固定流水线 | 工作类型多态 + 动态 stage 序列 |
| `findSkillForStage(stage)` 静态 enum | 路由诊断器动态决定 |
| 单 SkillSpec 数组（5 个）| 按工作类型分组的 spec 集合 |
| `inputs: Record<string, string>` 累加 | 保留，但加截断/摘要 |
| `~/.ai-native/artifacts/{runId}/` | 保留 + 加结构化 metadata |
| 单一 `knowledge_candidate` 类型 | 10 类 artifact_kind |
| `traceability.json` 字符串 | DB entity + foreign key |
| acceptance = yes/no 按钮 | acceptance = 知识更新提案队列 |
| diff_scope_gate / sensitive_change_gate / compile_gate / test_gate | 加 *_quality_gate / *_freshness_gate / traceability_gate |
| 每 stage spawn claude 进程 | 长会话 + checkpoint |

---

## 附录 B：V2 不要重复发明的轮子

V1 已经做对的部分，**V2 必须保留**：

- ✅ artifacts 落盘 + DB 双索引的基本框架（虽然 V1 还没真双写，但接口对了）
- ✅ Workflow Engine 唯一状态写者的设计
- ✅ Runner heartbeat + 多 backend 抽象（claude_code / codex）
- ✅ 异步 gate + 人工 approval 的解耦
- ✅ SSE 实时事件流
- ✅ Worktree 隔离 + 真实 mvn 执行
- ✅ runtime config override（PR1-PR3 已落地的可在线编辑 instructions）
- ✅ 命名约定（artifactsDir / inputs map / SkillSpec 输入输出 name 一致性）

V2 的所有改造都建立在这些 V1 既有能力之上。**不是重写，是演进**。
