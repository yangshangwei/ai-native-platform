# 将需求澄清页面改造为分步问答式交互

## Goal

当前的需求澄清页面将多个问题一次性展示给用户，用户需要在一个大文本框中组织答案。改造为分步问答式交互：**一次只显示一个问题**，用户回答后系统处理并决定是否继续提问，提供更自然、聚焦的交互体验。

这种交互方式：
- 降低认知负担（一次只看一个问题）
- 允许 Coordinator 根据前一个答案动态调整后续问题
- 提供清晰的进度反馈（例如"问题 1/2"）
- 支持跳过某些非必答问题

## What I Already Know

### 现有实现位置
- **核心渲染逻辑**: `apps/web/src/coordinator-chat.ts`
  - `renderCoordinatorChatPanel()`: 主面板渲染入口
  - `renderCoordinatorActionPanel()`: 渲染问题列表和回复区
  - `renderCoordinatorQuestionCard()`: 单个问题卡片（目前全部同时展示）
- **状态管理**: 
  - `coordinatorChats`: 每个 request 的对话历史和 triage 决策缓存
  - `coordinatorReplyDrafts`: 用户草稿（按 requestId 索引）
  - `coordinatorOptionSelections`: 多选题选项状态
  - `coordinatorAutoReplyBlocks`: 自动生成的回复文本块
- **后端交互**: 
  - `POST /workflow-requests/:id/messages`: 提交用户回复
  - `PATCH /workflow-requests/:id/status`: 切换状态回 `pending` 触发重新分诊

### 现有交互模式
1. Coordinator 分诊时发现信息不足 → `action: 'pause_for_human'` + `questions: string[]`
2. 前端渲染 **所有问题** 在黄色 `coordinator-action` 区域
3. 用户在底部单一文本框回答所有问题（或点选选项后自动填充）
4. 提交后 Coordinator 继续分诊或进入下一轮提问

### 关键约束
- 问题格式: `parseCoordinatorQuestion()` 支持纯文本 / 单选 / 多选
- IME composition guard: `ui.coordinatorReplyComposing` 防止输入法输入时触发重渲染
- 草稿保存: 轮询/状态变更时不能丢失用户已填内容
- 后端 API 不变：仍然是发送一条用户消息，Coordinator 自行判断是否继续提问

## Assumptions (Temporary)

- **后端保持现有消息模型**：分步提交意味着每个答案都是一次独立的 POST `/messages`，Coordinator 每次返回新的 `questions` 列表（可能为空 = 完成澄清，或继续下一个问题）
- **前端负责分步逻辑**：后端不需要知道"当前是第几步"，只需要判断"信息是否足够"
- **"跳过"由前端实现**：向后端发送 `"我跳过这个问题"` 或空回答，让 Coordinator 决定是否可接受

## Research References

- [`research/coordinator-behavior.md`](research/coordinator-behavior.md) — Coordinator 后端行为研究（问题数组替换策略、skip 语义、动态问题顺序）

## Decision (ADR-lite)

### 分步交互的实现策略

**Context**: Coordinator 每次返回的 `questions: string[]` 是**完整替换**，不是增量追加。用户提交答案后，Coordinator 会根据新的对话历史重新决策，可能返回：
- 完全不同的问题列表
- 相同的问题（答案不满足）
- 空列表（澄清完成）

**Decision**: **前端维护本地问题索引**，逐个展示当前 `questions` 数组中的问题

实现逻辑：
1. 每次收到新的 `decision.questions`，重置索引为 0
2. 显示 `questions[currentIndex]`，用户回答后 `currentIndex++`
3. 如果 `currentIndex >= questions.length`，提交给后端触发下一轮 triage
4. 后端返回新的 `questions` → 重置索引，继续循环

**Consequences**:
- ✅ 前端完全控制分步节奏，后端逻辑零改动
- ✅ 支持 Coordinator 动态调整问题（LLM fallback 模式下）
- ✅ 用户体验平滑（一次只看一个问题）
- ⚠️ 如果 Coordinator 一次返回 10 个问题，用户需要点击 10 次"下一个"（但实际场景中 Coordinator 通常返回 1-3 个问题）
- ⚠️ "跳过"按钮的语义：前端发送 "我跳过这个问题" 文本，LLM Coordinator 自行解释（规则模式下无效）

## Requirements

### 核心交互流程
1. **单问题展示**：一次只显示一个问题（基于本地索引 `currentIndex`）
2. **回答输入**：文本框 + 可选的选项按钮（保持现有选项逻辑）
3. **下一个/提交行为**：
   - 如果 `currentIndex < questions.length - 1` → 点击"下一个"按钮，`currentIndex++`，保存草稿，显示下一个问题（**不发送请求**）
   - 如果 `currentIndex === questions.length - 1` → 点击"提交回复"按钮，发送所有累积的答案给后端
4. **提交并等待**：提交后显示 loading 状态，等待 Coordinator 返回
   - 返回新的 `questions` → 重置 `currentIndex = 0`，显示新的第一个问题
   - 返回空 `questions` + `action: 'proceed'` → 澄清完成，移除问答区
5. **进度指示**：显示"问题 1/3"（当前问题/总问题数）
6. **跳过功能**：显示"跳过"按钮，向草稿追加 "(跳过)"，然后行为同"下一个"

### 视觉层次优化
- 黄色 `coordinator-action` 区域只保留标题和进度指示，去掉重复的 reason 文本（reason 移到顶部说明一次即可）
- 历史沟通记录默认折叠（`<details>` 默认关闭），标题改为"查看沟通记录 ▼"
- 问题序号改用圆形徽章样式，放在问题文本左侧

### 状态管理新增
- `coordinatorCurrentQuestionIndex: Map<requestId, number>`: 当前问题索引
- `coordinatorAnswerDrafts: Map<requestId, Map<questionIndex, string>>`: 每个问题的答案草稿（多个问题的答案独立保存）

### 兼容性
- 保持现有草稿保存逻辑（轮询时不丢失输入）
- 保持 IME composition guard
- 不破坏现有的多选/单选逻辑
- 向后兼容：如果后端逻辑未来改为增量问题，只需调整索引重置逻辑

## Acceptance Criteria

- [ ] 打开需求澄清页面，一次只看到一个问题（基于 `currentIndex`）
- [ ] 回答第一个问题后，点击"下一个"显示第二个问题（**不发送请求**，本地切换）
- [ ] 回答最后一个问题后，点击"提交回复"，发送所有答案给后端，显示 loading 状态
- [ ] 后端返回新问题列表时，重置索引为 0，显示新的第一个问题
- [ ] 后端返回空问题列表且 `action: 'proceed'` 时，澄清区域消失
- [ ] 显示进度指示（例如"问题 1/3"）
- [ ] 点击"跳过"按钮，当前问题答案标记为"(跳过)"，自动进入下一个问题
- [ ] 历史沟通记录默认折叠
- [ ] 输入过程中轮询不丢失草稿（每个问题的草稿独立保存）
- [ ] IME 输入法输入时不触发重渲染
- [ ] 多选/单选选项点击后，仍然能正确更新当前问题的答案

## Definition of Done

- 代码实现完成并通过自测
- TypeScript 类型检查通过
- 无明显 lint 错误
- 在浏览器中手动验证交互流程正常
- 如有测试文件需更新，一并完成

## Out of Scope

- 后端 Coordinator 逻辑修改（保持现有 API 不变）
- 增加"编辑之前答案"功能（可在后续迭代考虑）
- 移动端专门优化（当前只确保桌面端体验）
- 问题之间的依赖关系可视化

## Technical Notes

### 关键文件
- `apps/web/src/coordinator-chat.ts`: 主要修改文件
- `apps/web/src/coordinator-clarification.ts`: 问题解析逻辑（可能需要查看）
- `apps/web/public/components.css`: 样式调整

### 实现思路（更新后）
```typescript
// 新增状态：当前问题索引 + 每个问题的答案草稿
const coordinatorCurrentQuestionIndex = new Map<string, number>();
const coordinatorAnswerDrafts = new Map<string, Map<number, string>>();

// 重置逻辑：收到新的 questions 时调用
function resetCoordinatorQuestionState(requestId: string): void {
  coordinatorCurrentQuestionIndex.set(requestId, 0);
  coordinatorAnswerDrafts.delete(requestId); // 清空旧答案
}

// 渲染逻辑
function renderCoordinatorActionPanel(requestId, questions, ...) {
  const currentIndex = coordinatorCurrentQuestionIndex.get(requestId) ?? 0;
  const currentQuestion = questions[currentIndex];
  const totalQuestions = questions.length;
  const isLastQuestion = currentIndex === totalQuestions - 1;
  
  // 获取当前问题的草稿
  const drafts = coordinatorAnswerDrafts.get(requestId) ?? new Map();
  const currentDraft = drafts.get(currentIndex) ?? '';
  
  return el('section', {
    children: [
      // 进度指示
      el('div', { text: `问题 ${currentIndex + 1}/${totalQuestions}` }),
      // 单个问题
      renderCoordinatorQuestionCard(requestId, currentQuestion, currentIndex, ...),
      // 回复区
      replyArea.value = currentDraft,
      // 按钮行
      el('div', { 
        children: [
          skipBtn,  // "跳过" → 标记当前答案为 "(跳过)"，然后 currentIndex++
          isLastQuestion 
            ? submitBtn  // "提交回复" → 合并所有答案，发送给后端
            : nextBtn    // "下一个" → 保存草稿，currentIndex++，切换问题
        ]
      })
    ]
  });
}

// 提交逻辑：合并所有答案
async function submitAllAnswers(requestId: string, questions: string[]): Promise<void> {
  const drafts = coordinatorAnswerDrafts.get(requestId) ?? new Map();
  const allAnswers = questions.map((q, i) => {
    const answer = drafts.get(i) ?? '';
    return `Q${i + 1}: ${q}\nA${i + 1}: ${answer || '(未回答)'}`;
  }).join('\n\n');
  
  await sendCoordinatorReply(requestId, allAnswers);
  resetCoordinatorQuestionState(requestId);
}
```

### 后端 API 行为（需验证）
- 提交一个答案后，Coordinator 可能：
  1. 返回新的 `questions` 列表（继续澄清）
  2. 返回空 `questions`（澄清完成，切换到 `proceed` 决策）
  3. 返回相同问题（答案不满足，要求重新回答）

### 待验证点
- Coordinator 是否支持"跳过"语义（发送 "skip" 或 "我跳过" 时的行为）
- 多个问题是否总是按顺序提问，还是可能根据答案调整顺序
