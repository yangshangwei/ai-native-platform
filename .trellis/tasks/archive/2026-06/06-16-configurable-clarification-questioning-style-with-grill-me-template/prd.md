# 可配置的需求澄清提问风格(grill-me 模板)

## Goal

让 Coordinator(协调器)的"需求澄清"提问策略**可配置**，新增一种 `grill-me` 风格的提问模板。
grill-me 来自 [mattpocock/skills grill-me](https://github.com/mattpocock/skills/blob/main/skills/productivity/grill-me/SKILL.md)，
其精髓是：**一次只问一个问题**、沿**决策树分支**逐个解决依赖、**能从代码/上下文回答的先自查**而非问用户、
持续**相对无情地深挖**直到所有歧义消除、达成共识。目标是把当前"批量生成一组问题 → 答完重新分诊"的澄清，
升级为可选的"逐题决策树深挖"风格，从而把模糊需求收敛得更彻底、更少返工。

## What I already know

来自用户:
* 参考模版是 grill-me(逐题、决策树、能查代码先查、无情深挖、达成共识为止)
* 诉求是"模板可以配置成 grill-me 的" —— 即提问风格作为可配置项，grill-me 是其中一种

来自上一轮代码探索(待本轮 Explore 精确化):
* 澄清触发: Runner watch → `defaultTriage` → 规则层(过短/大范围) 或 LLM 回退判定 `pause_for_human`
  * `apps/runner/src/cmd/watch.ts`、`packages/shared/src/coordinator/rules-core.ts`、`apps/runner/src/agents/coordinator/llm-fallback.ts`
* 问题来源: 规则模板(`coordinator.fallback.*`) / LLM 动态生成(`questions: string[]`) / LLM 降级兜底
* 决策结构: `CoordinatorAction = proceed | pause_for_human{questions[]} | abort`(`packages/shared/src/types/coordinator.ts`)
* 前端已是 step-by-step 逐题展示(`apps/web/src/coordinator-chat.ts`、`coordinator-clarification.ts`)，但问题是**一次性批量生成**的
* 状态机: `pending ↔ awaiting_clarification → claimed → completed/failed`(`apps/api/src/routes/workflow-request-chat.ts`)

## grill-me 与当前澄清的关键差异

| 维度 | 当前 | grill-me |
|------|------|----------|
| 问题生成 | 一次批量生成一组 | 一次一个，依据上一答案动态生成下一个 |
| 推进 | 答完一批重新分诊 | 沿决策树逐分支解决依赖 |
| 能查代码的问题 | 直接问用户 | 先自查上下文，查不到才问 |
| 停止 | 置信度够即 proceed | 所有分支消除歧义、达成共识 |
| 语气 | 中性 | 相对无情的系统化拷问 |

## Assumptions (temporary)

* 配置粒度: 倾向**全局 + 可 per-project 覆盖**(待确认现有 config 是否支持 per-project)
* `grill-me` 主要改的是 **LLM 回退路径的 system prompt / 问题生成策略**，规则层(过短/大范围)保持不变或仅作入口
* 真正的"逐题动态生成"需要 Coordinator 支持**单题循环**(每轮只产 1 个问题)，而非一次产 N 个 —— 这是潜在的较大改动点
* 前端 step-by-step UI 基本可复用，可能需支持"总题数未知/动态增长"的展示

## Decisions (已拍板)

### D1: 改造深度 = 完整可配置 MVP
- 新增「提问风格」配置项(default / grill-me)
- grill-me = 每轮只问 1 题 + 深挖语气 + 防失控上限
- 后端按风格选 prompt，前端适配单题/未知总数展示
- **理由**: 真正满足"可配置成 grill-me"，且改动可控(主要在 config + prompt + 前端小适配)

### D2: 配置形态 = 预置风格下拉
- 内置 default / grill-me 两套模板
- 设置页选风格名，后端按名选对应 prompt
- **理由**: 贴合"模板"语义，用户零 prompt 维护成本
- **技术债**: 现有 ConfigType 无 enum，需评估新增类型或用 string + 校验

### D3: 「能查代码先查」= MVP 不接代码
- grill-me 退化为「能从对话历史/需求推断的先不问」+ 逐题深挖
- 不给 Coordinator 接项目代码
- **理由**: 避免大改，先把逐题深挖体验做扎实
- **Future**: 后续可注入项目代码/README 摘要，支持真正的"查代码再决定问不问"

### D4: 防失控 = 设最大追问轮数
- 默认上限(如 5 题，可配置)
- 到顶强制收敛(proceed 或 pause_for_human 让人接手)
- **理由**: 生产可控，符合"深挖但有边界"
- **实现**: 在 messageHistory 中计数 coordinator 消息数，达上限时 system prompt 追加"已达上限,必须收敛"指令

## Requirements

### R1: 配置项 - 提问风格
- 新增 config key `coordinator.clarification_style`(类型待定: string 或新 enum)
- 可选值: `default` / `grill-me`
- 默认值: `default`(向后兼容)
- 用户通过 Web 设置页选择风格，写入 DB override，runner 热加载

### R2: 预置模板 - default
- 保持当前 `coordinator.system_prompt` 行为
- 一次可出 ≤2 个问题(AT MOST 2)
- 中性语气

### R3: 预置模板 - grill-me
- 新 system prompt 文本(基于 grill-me 原则改写)
- **每轮只出 1 个问题**(questions 数组长度固定 1)
- **深挖语气**: "沿决策树分支逐个解决依赖"、"先从对话历史/需求推断，推断不出才问"
- **收敛指令**: 明确告知"达成共识后必须 proceed，不要无限追问"

### R4: 防失控上限
- 新增 config key `coordinator.max_clarification_rounds`(number，默认 5)
- 后端在 llm-fallback 中计数 messageHistory 里 coordinator 消息数
- 达上限时，在 system prompt 追加指令: "已达最大追问轮数，必须基于现有信息做出 proceed 或 abort 决策"

### R5: 前端适配
- `coordinator-chat.ts` 适配未知总数: 去掉分母 `问题 N/总数`，改为 `问题 N`(grill-me 时总数动态增长)
- `isLastQuestion` 判断: grill-me 模式下每题都当"可能是最后一题"(显示"提交回复"按钮，后端会决定是否继续)
- `submitAllAnswers` 保持不变(单条提交→打回 pending 的机制天然支持逐题)

### R6: 向后兼容
- 未配置 / `clarification_style=default` 时行为与现状完全一致
- 前端根据当前问题总数(=1 且是 grill-me)自动切换 UI 模式

## Acceptance Criteria

* [ ] 新增 `coordinator.clarification_style` 配置项(schema 在 registry.ts, 默认值在 defaults.ts)
* [ ] 新增 `coordinator.max_clarification_rounds` 配置项(默认 5)
* [ ] Web 设置页可选择 default / grill-me 风格(UI 待实现或复用现有文本输入)
* [ ] 选 default 时: 行为与现状一致(≤2 题批量、中性语气)
* [ ] 选 grill-me 时:
  * [ ] 后端每轮只生成 1 个问题(questions.length === 1)
  * [ ] system prompt 包含 grill-me 原则(逐题、决策树、先推断再问、深挖、收敛)
  * [ ] 达 max_clarification_rounds 上限时强制收敛(追加收敛指令到 prompt)
* [ ] 前端适配 grill-me 单题模式:
  * [ ] 问题计数显示为 `问题 N`(无分母，因总数未知)
  * [ ] 每题都显示"提交回复"按钮(不再判断 isLastQuestion)
  * [ ] 提交后轮询，后端决定继续追问或 proceed
* [ ] 单测: 配置解析、风格选择、prompt 构造、上限截断
* [ ] 集成测: 端到端 grill-me 流程(pending → 逐题追问 → 达上限/共识 → proceed)
* [ ] 现有 default 模式的集成测不受影响(回归测试)

## Technical Approach

### 配置层(packages/shared/src/config/)

1. **registry.ts**: 新增两个配置项
   ```typescript
   'coordinator.clarification_style': { type: 'string', default: 'default', description: '...' }
   'coordinator.max_clarification_rounds': { type: 'number', default: 5, description: '...' }
   ```
   - 类型选择: 先用 `string`(避免新增 enum 类型的复杂度)，运行时校验值必须是 `default` | `grill-me`

2. **defaults.ts**: 新增 grill-me system prompt 模板
   - 保持现有 `coordinator.system_prompt`(default 风格)
   - 新增 `coordinator.system_prompt_grill_me`(新 key，或内嵌在 clarification_style 逻辑里选择)
   - grill-me prompt 要点:
     * "You must ask ONE question at a time"(强制单题)
     * "Walk down each branch of the decision tree, resolving dependencies one-by-one"
     * "Before asking, try to infer the answer from the conversation history and user's original request"
     * "Use a systematic, relentless tone to stress-test the requirement"
     * "When shared understanding is reached across all critical aspects, output action: 'proceed'"
     * JSON schema 的 questions 字段保持数组，但指令要求"数组必须只有 1 个元素"

### 后端逻辑(apps/runner/src/agents/coordinator/)

3. **llm-fallback.ts**: 根据风格选 prompt + 上限截断
   - `triageWithLLM` 入口处:
     * 读取 `config.get('coordinator.clarification_style')`
     * 读取 `config.get('coordinator.max_clarification_rounds')`
     * 计数 `messageHistory.filter(m => m.role === 'coordinator').length`
   - 构造 system prompt 时:
     * 如果 `style === 'grill-me'`: 用 grill-me 模板
     * 如果已达 max_rounds: 追加 "You have reached the maximum clarification rounds. You MUST make a decision (proceed or abort) based on current information."
   - 输出校验: grill-me 模式下，如果 LLM 返回 questions.length > 1，截断为只取第一个 + 打 warning 日志

### 前端适配(apps/web/src/)

4. **coordinator-chat.ts**: 检测单题模式 + UI 适配
   - 检测逻辑: `const isSingleQuestionMode = questions.length === 1`(无需知道后端配置，根据实际问题数判断)
   - 问题计数显示:
     * 原: `问题 ${currentIndex + 1}/${questions.length}`
     * 改: `isSingleQuestionMode ? `问题 ${currentIndex + 1}` : `问题 ${currentIndex + 1}/${questions.length}``
   - 按钮逻辑:
     * 原: 非最后一题显示"下一个 →"，最后一题显示"提交回复"
     * 改: `isSingleQuestionMode` 时始终显示"提交回复"(因为不知道后端会不会继续追问)
   - `submitAllAnswers` 保持不变(已支持单条提交)

5. **coordinator-clarification.ts**: 无需改动(问题解析逻辑与风格无关)

### Web 设置页(apps/web/)

6. **settings UI**: 新增风格选择
   - 如果现有设置页支持下拉/单选，复用
   - 如果只支持文本输入，暂时用文本输入 + placeholder 提示 `default 或 grill-me`
   - 后续可改进为真下拉 UI

### 测试

7. **单测**:
   - `config/registry.test.ts`: 校验新配置项存在且类型正确
   - `coordinator/llm-fallback.test.ts`: mock config，验证 grill-me 模式选对应 prompt、上限截断生效
   - `coordinator/prompt.test.ts`: 验证上限时追加的指令文本

8. **集成测**:
   - `coordinator.e2e.test.ts`: 端到端流程
     * 设置 `clarification_style=grill-me` + `max_rounds=3`
     * 创建过短请求 → 验证返回单题 → 提交答案 → 验证再返回单题 → 重复 3 轮 → 验证强制收敛
   - 回归测: 现有 default 模式测试不受影响

### 风险与缓解

- **风险 1**: grill-me 可能增加 LLM 往返次数(原 1 次出 2 题变成 2 次各出 1 题) → **缓解**: max_rounds 默认 5，可配置下调
- **风险 2**: ConfigType 无 enum，string 类型可能被填入非法值 → **缓解**: 运行时校验 + 日志告警，非法值降级到 default
- **风险 3**: 前端"问题 N"无分母可能让用户不知道还要答多久 → **缓解**: grill-me 文档说明"逐题深挖，题数不定"；设置页给出预期

* Tests added/updated(单测/集成: 配置解析 + 提示词构造 + 单题循环逻辑)
* Lint / typecheck / CI green
* 行为变化有文档/notes
* 风险点(单题循环可能增加 LLM 往返次数)有评估与回滚考量

## Out of Scope (explicit)

* 不接入项目代码/README 给 Coordinator(真正的"查代码再决定问不问"留作 future)
* 不改规则层(过短/大范围)的触发逻辑，只改 LLM 回退路径
* 不新增决策树状态机(不显式追踪"当前在哪个分支节点"，靠 LLM 自行从历史推断)
* 不支持 per-project 配置覆盖(当前 config 只有 global 作用域)
* 不支持用户自由编辑完整 system_prompt(仅预置风格下拉，自由编辑留作高级功能)
* 不改前端的选项解析(`A. B. C.` 多选格式)和 IME 组成防护(已有逻辑保持)
* 不改 `awaiting_clarification` 状态的轮询间隔(保持 1.5s)

## Technical Notes (现状精确结论)

* **配置 schema**: coordinator 全部配置(15 key)schema 在 `packages/shared/src/config/registry.ts`,默认值在 `packages/shared/src/config/defaults.ts`
* **用户改配置的方式**: Web 设置页 → `PUT /config/overrides/:key` 写 DB override(**仅 global 作用域,无 per-project / 无环境变量 / 无配置文件**);runner 经 `config-client.ts:getConfig` ≤1.5s 热加载。改默认值本身需改 `defaults.ts` 发 PR
* **提示词位置**: LLM 兜底分诊 system prompt = config key `coordinator.system_prompt`(默认文本 `defaults.ts:90-117`),在 `apps/runner/src/agents/coordinator/llm-fallback.ts:211` 取用;user prompt 由 `prompt.ts:buildUserPrompt` 把**全量 messageHistory 平铺注入**
* **数量约束写死在 prompt 文本里**: "AT MOST 2" 和 `questions: string[]` 的 JSON schema 都在 system_prompt 文本内,不是独立代码常量
* **当前是批量、无状态**: 一次性出一组问题,无逐题循环;triage 完全无状态,re-triage 靠全量历史回灌(已就绪,改 grill-me 不必新建状态存储)
* **无 persona/strategy 抽象**: 需从 config registry 起新建;`ConfigType` **无 enum 类型**,做"下拉选风格"要评估是否新增类型
* **无"已问 N 题"计数器**: 逐题深挖需自行加上限防无限追问
* **前端强依赖问题总数已知**: `coordinator-chat.ts` 分母 `问题 N/总数`(:497)、`isLastQuestion`(:376)、`submitAllAnswers` 批量拼装(:259) 都假设全部问题已知;底层 `sendCoordinatorReply`(单条提交→打回 pending→轮询)天然支持逐题。**后端固定每轮 `questions.length===1` 时前端改动量最小**
* grill-me 参考: https://github.com/mattpocock/skills/blob/main/skills/productivity/grill-me/SKILL.md

## Research References

* grill-me SKILL.md 已读(见上方差异表)
* [`research/current-clarification-config.md`](research/current-clarification-config.md) — 配置系统 + 提示词构造现状精确定位(带 file:line 引用)

## Implementation Plan (按 PR 拆解)

### PR1: 配置基础设施 + grill-me prompt 模板
**范围**: 配置层，零行为变化(只加配置项和默认值，不实际使用)
- [ ] `packages/shared/src/config/registry.ts`: 新增 `coordinator.clarification_style` 和 `coordinator.max_clarification_rounds`
- [ ] `packages/shared/src/config/defaults.ts`: 
  - 新增两个 key 的默认值(`default` 和 `5`)
  - 编写 `coordinator.system_prompt_grill_me` 完整文本(基于 grill-me 原则)
- [ ] 单测: 配置项存在性、类型校验、默认值正确
- [ ] Lint + typecheck green
- **验收**: 配置可读取，但后端逻辑尚未使用，行为无变化

### PR2: 后端核心逻辑 - 风格选择 + 上限截断
**范围**: Coordinator LLM 回退路径
- [ ] `apps/runner/src/agents/coordinator/llm-fallback.ts`:
  - 读取 `clarification_style` 和 `max_clarification_rounds`
  - 计数 `messageHistory` 中 coordinator 消息
  - 根据风格选 prompt(default 用现有 `system_prompt`，grill-me 用 `system_prompt_grill_me`)
  - 达上限时追加收敛指令
  - grill-me 模式输出校验(questions.length > 1 时截断 + 日志)
- [ ] 单测: mock config，验证各分支逻辑
- [ ] 集成测: 端到端 grill-me 流程(pending → 单题 → 答复 → 单题 → 达上限 → 收敛)
- [ ] 回归测: default 模式测试通过
- **验收**: 后端能按配置生成 grill-me 单题，前端尚未适配(会显示 `问题 1/1` 但功能可用)

### PR3: 前端 UI 适配 + Web 设置页
**范围**: 前端单题模式展示 + 用户配置入口
- [ ] `apps/web/src/coordinator-chat.ts`:
  - 检测 `isSingleQuestionMode = questions.length === 1`
  - 问题计数: 单题模式去分母(`问题 N` 而非 `问题 N/总数`)
  - 按钮: 单题模式始终显示"提交回复"
- [ ] `apps/web/src/settings/` 或对应设置页组件:
  - 新增 `coordinator.clarification_style` 输入(文本输入或下拉，视现有 UI 组件而定)
  - 新增 `coordinator.max_clarification_rounds` 数字输入
  - 保存调用 `PUT /config/overrides/:key`
- [ ] 手动测试: Web 设置页改配置 → runner 热加载 → 创建过短请求 → 验证 grill-me 逐题体验
- **验收**: 完整端到端可用，用户可在 Web 配置 grill-me 并实际体验逐题深挖

### PR4(可选): 文档 + 优化
**范围**: 用户文档、配置说明、可选的 UI 改进
- [ ] 更新文档: 说明 grill-me 风格的特点、适用场景、max_rounds 含义
- [ ] 设置页 UI 改进(如果 PR3 只用了文本输入，这里改成真下拉)
- [ ] 性能 profiling: 对比 default vs grill-me 的 LLM 往返次数和平均收敛时间
- **验收**: 文档完整，用户能自主选择和理解 grill-me
