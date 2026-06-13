# AI Native Platform - 用户体验优化方案

> 基于系统功能分析的完整 UX 改进建议
> 作者：Kiro AI  
> 日期：2026-06-13

## 一、当前系统功能分析

### 核心工作流
```
项目接入 → 新建任务 → AI 执行 → 人工确认 → 任务报告 → 知识沉淀
```

### 六大功能模块
1. **工作台**：任务概览、待处理事项、执行环境状态
2. **新建任务**：创建 feature/bugfix/refactor 任务
3. **任务报告**：查看交付证据、测试结果、Gate 状态
4. **知识库**：AI 建议的知识沉淀、接受/编辑/应用
5. **项目接入**：Git 项目配置、分支管理、执行方式选择
6. **运行配置**：worktree 模式、系统配置

---

## 二、用户画像与使用场景

### 主要用户类型
1. **日常开发者**（80%）：频繁创建任务、查看进度、处理确认点
2. **项目管理员**（15%）：配置项目、管理知识库、查看报告汇总
3. **新用户**（5%）：首次使用，需要引导

### 典型使用路径
- **高频路径**：工作台 → 查看待处理 → 回答问题/确认 Gate
- **中频路径**：新建任务 → 等待 AI → 查看报告
- **低频路径**：配置项目 → 管理知识库

---

## 三、当前问题诊断

### 🔴 严重问题

#### 1. **首次使用门槛高**
- **问题**：新用户不知道从哪里开始
- **影响**：流失率高、学习成本大
- **证据**：无引导流程、无初始化检查清单

#### 2. **关键状态不够明显**
- **问题**："需要我处理"的任务埋在工作台里
- **影响**：用户可能错过重要的确认点
- **证据**：无全局通知、无待办数量徽章

#### 3. **任务创建后迷失**
- **问题**：创建任务后不知道在哪里查看进度
- **影响**：用户焦虑、频繁刷新
- **证据**：无任务跳转、无实时进度推送

### 🟡 中等问题

#### 4. **菜单层级不清晰**
- **问题**：所有功能平铺，没有视觉分组
- **影响**：认知负担、操作效率低
- **建议**：添加视觉分隔和分组

#### 5. **缺少快捷操作**
- **问题**：常用操作路径太长
- **影响**：效率低、体验差
- **建议**：添加快捷入口、悬浮按钮

#### 6. **知识库价值不明显**
- **问题**：用户不理解知识库的用途
- **影响**：功能利用率低
- **建议**：强化引导、展示价值

---

## 四、优化方案设计

### 方案 A：渐进式优化（推荐）

适合快速迭代，逐步改善体验。

#### A1. 菜单结构优化 ⭐⭐⭐⭐⭐

**当前菜单（已优化）：**
```
1. 工作台
2. 新建任务
3. 任务报告
4. 知识库
5. 项目接入
6. 运行配置
```

**建议调整：添加视觉分组**

```css
┌─────────────────────────┐
│ 【核心工作区】          │ ← 添加小标题
│ 🏠 工作台               │
│    └─ 28 待处理 🔴     │ ← 待办徽章
│ ➕ 新建任务            │
│ 📊 任务报告            │
├─────────────────────────┤ ← 分隔线
│ 【知识与配置】          │
│ 📚 知识库              │
│ 🔧 项目接入            │
│ ⚙️  运行配置           │
└─────────────────────────┘
```

**实现要点：**
- 添加 CSS 分组样式（轻量级分隔线）
- 工作台菜单项右上角显示待办数量徽章
- 使用 emoji 或 icon 增强识别度

**优先级：P0 - 立即实施**

---

#### A2. 新用户引导流程 ⭐⭐⭐⭐⭐

**问题：**首次使用不知道如何开始

**方案：首次启动检查清单**

```
┌─────────────────────────────────────────┐
│ 🎉 欢迎使用 AI Native Platform          │
│                                         │
│ 完成以下步骤即可开始：                  │
│                                         │
│ ✅ 1. 启动执行器 (Runner)               │
│    └─ 已检测到 Runner 正在运行          │
│                                         │
│ ⬜ 2. 接入第一个项目                    │
│    └─ [立即接入项目] 按钮               │
│                                         │
│ ⬜ 3. 创建第一个任务                    │
│    └─ 完成项目接入后解锁                │
│                                         │
│ [稍后再说] [继续]                       │
└─────────────────────────────────────────┘
```

**触发条件：**
- 首次访问且无项目
- 本地存储标记 `hasSeenWelcome = false`

**实现位置：**
- 工作台页面顶部卡片
- 可关闭，但会在右下角保留"查看引导"按钮

**优先级：P0 - 立即实施**

---

#### A3. 全局状态栏 ⭐⭐⭐⭐⭐

**问题：**用户不知道系统当前状态、有多少待办

**方案：顶栏右侧添加状态指示器**

```
┌─────────────────────────────────────────────────────┐
│ AI Native Platform              [🔴 28] [⚡ 4] [✅ 正常] │
└─────────────────────────────────────────────────────┘
                                    ↓      ↓      ↓
                              待处理  运行中  环境状态
```

**点击展开详情：**
```
┌──────────────────────────────┐
│ 🔴 28 个任务需要你处理        │
│ ├─ 20 个等待回答问题          │
│ ├─ 6 个等待确认 Gate          │
│ └─ 2 个失败需查看             │
│                              │
│ ⚡ 4 个任务正在执行中         │
│                              │
│ ✅ 执行环境正常               │
│ └─ Runner 已连接              │
│ └─ Claude Code 已配置         │
│                              │
│ [查看全部待办] →             │
└──────────────────────────────┘
```

**优先级：P0 - 立即实施**

---

#### A4. 任务创建后的引导 ⭐⭐⭐⭐

**问题：**创建任务后不知道去哪里

**方案：创建成功后的引导卡片**

```
┌─────────────────────────────────────────┐
│ ✅ 任务创建成功！                        │
│                                         │
│ 📋 任务：登录页面新增验证码开关          │
│ 🏷️  ID: wreq_b17a7bc...                │
│                                         │
│ AI 正在执行中，你可以：                  │
│                                         │
│ [🔍 查看实时进度]  [📊 返回工作台]      │
│                                         │
│ 💡 提示：执行过程中如果 AI 需要补充      │
│    信息，我们会在工作台通知你。          │
└─────────────────────────────────────────┘
```

**优先级：P1 - 近期实施**

---

#### A5. 快捷操作浮动按钮 ⭐⭐⭐

**问题：**常用操作路径太长

**方案：右下角悬浮按钮（FAB）**

```
                           ┌────────────┐
                           │ + 新建任务  │
                           └────────────┘
                                  ↑
                              [  +  ] ← 悬浮按钮
```

**点击展开：**
```
┌─────────────────┐
│ ➕ 新建任务     │
│ 🔄 刷新数据     │
│ 📋 待办列表     │
│ 📚 知识中心     │
└─────────────────┘
```

**优先级：P2 - 可选功能**

---

### 方案 B：菜单重构方案（激进）

适合长期规划，需要较大改动。

#### B1. 双层菜单结构

**顶层导航：**
```
[ 工作台 ] [ 任务中心 ] [ 知识库 ] [ 配置中心 ]
```

**二级菜单（任务中心）：**
```
┌─────────────────┐
│ • 新建任务       │
│ • 任务报告       │
│ • 执行历史       │
└─────────────────┘
```

**二级菜单（配置中心）：**
```
┌─────────────────┐
│ • 项目管理       │
│ • 运行配置       │
│ • 系统设置       │
└─────────────────┘
```

**优点：**
- 层级清晰
- 可扩展性强

**缺点：**
- 改动大
- 增加一层点击

**建议：暂不采用，现有单层菜单足够**

---

## 五、具体实施建议

### Phase 1：立即实施（1-2 天）✅

#### 1. 菜单视觉分组
```typescript
// apps/web/src/shell.ts

const navItems = [
  // 核心工作区
  { page: 'workbench', label: '工作台', badge: () => pendingCount() },
  { page: 'new-task', label: '新建任务' },
  { page: 'reports', label: '任务报告' },
  { divider: true }, // 分隔线
  // 知识与配置
  { page: 'knowledge', label: '知识库' },
  { page: 'projects', label: '项目接入' },
  { page: 'settings', label: '运行配置' },
];
```

**CSS 样式：**
```css
.nav-divider {
  height: 1px;
  background: rgba(148, 163, 184, .18);
  margin: 12px 0;
}

.nav-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  background: var(--bad);
  color: white;
  border-radius: 999px;
  padding: 2px 6px;
  font-size: 11px;
  font-weight: 900;
}
```

#### 2. 待办数量徽章

**实现位置：** `apps/web/src/shell.ts`

```typescript
function pendingCount(): number {
  const awaitingClarification = data.requests.filter(
    r => r.status === 'awaiting_clarification'
  ).length;
  
  const awaitingHuman = data.runs.filter(
    r => r.status === 'awaiting_human'
  ).length;
  
  const failed = data.requests.filter(
    r => r.status === 'failed'
  ).length;
  
  return awaitingClarification + awaitingHuman + failed;
}
```

#### 3. 全局状态指示器

**实现位置：** `apps/web/src/shell.ts` - renderTopbar()

```typescript
function renderGlobalStatus(): HTMLElement {
  const pending = pendingCount();
  const running = data.runs.filter(r => 
    r.status === 'running' || r.status === 'claimed'
  ).length;
  
  const envStatus = workbenchEnvironmentSummary(
    selectedProject(),
    latestRunner()
  );
  
  return el('div', {
    class: 'global-status-strip',
    children: [
      pending > 0 ? statusBadge('待处理', pending, 'bad') : null,
      running > 0 ? statusBadge('运行中', running, 'info') : null,
      statusBadge('环境', envStatus.value, envStatus.kind),
    ],
  });
}
```

---

### Phase 2：近期实施（3-5 天）⏭️

#### 4. 首次使用引导

**实现位置：** `apps/web/src/page-workbench.ts`

```typescript
function renderWelcomeChecklist(): HTMLElement | null {
  const hasSeenWelcome = localStorage.getItem('hasSeenWelcome') === 'true';
  if (hasSeenWelcome) return null;
  
  const hasProjects = data.projects.length > 0;
  const hasRunner = latestRunner() !== null;
  
  return el('article', {
    class: 'welcome-checklist',
    children: [
      panelHeader('🎉 欢迎使用 AI Native Platform'),
      checklistItem('启动执行器 (Runner)', hasRunner, null),
      checklistItem('接入第一个项目', hasProjects, 
        hasRunner ? 'projects' : null
      ),
      checklistItem('创建第一个任务', false, 
        hasProjects ? 'new-task' : null
      ),
      el('div', {
        class: 'button-row',
        children: [
          button('稍后再说', 'ghost', () => {
            localStorage.setItem('hasSeenWelcome', 'true');
            render();
          }),
        ],
      }),
    ],
  });
}
```

#### 5. 任务创建成功引导

**实现位置：** `apps/web/src/page-new-task.ts` - submitWorkflowRequest()

```typescript
async function submitWorkflowRequest(...) {
  // ... 创建请求
  
  // 显示成功引导
  ui.lastSuccess = null; // 使用自定义 UI
  showTaskCreatedGuide(request.id, request.title);
  
  // 跳转选项
  setTimeout(() => {
    if (confirm('任务已创建！是否立即查看进度？')) {
      setHash('workbench');
      ui.activeTaskRequestId = request.id;
    }
  }, 1000);
}
```

---

### Phase 3：可选功能（1 周）📋

#### 6. 实时通知系统

使用 Server-Sent Events (SSE) 推送任务状态变化：

```typescript
// apps/web/src/notifications.ts

export function initNotifications() {
  const eventSource = new EventSource('/api/notifications');
  
  eventSource.addEventListener('task-needs-attention', (event) => {
    const data = JSON.parse(event.data);
    showToast({
      type: 'warn',
      title: '任务需要你处理',
      message: data.message,
      action: {
        label: '立即查看',
        onClick: () => setHash('workbench'),
      },
    });
  });
}
```

#### 7. 键盘快捷键

```typescript
// 全局快捷键
document.addEventListener('keydown', (e) => {
  // Cmd/Ctrl + K: 快速命令面板
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    openCommandPalette();
  }
  
  // Cmd/Ctrl + N: 新建任务
  if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
    e.preventDefault();
    setHash('new-task');
  }
});
```

---

## 六、优化效果预期

### 量化指标

| 指标 | 当前 | 目标 | 改进 |
|-----|------|------|------|
| 新用户上手时间 | ~30 分钟 | ~5 分钟 | -83% |
| 待办任务响应时间 | ~10 分钟 | ~1 分钟 | -90% |
| 任务创建到查看进度 | 3 次点击 | 1 次点击 | -67% |
| 用户满意度 (1-10) | ? | 8+ | - |

### 定性改进

✅ **新用户体验**：从"不知道怎么开始"到"引导式上手"  
✅ **核心效率**：从"寻找待办"到"主动推送"  
✅ **认知负担**：从"平铺功能"到"分层清晰"  
✅ **操作流畅度**：从"多次跳转"到"一键直达"

---

## 七、技术实施细节

### 新增文件

```
apps/web/src/
├── notifications.ts        # 通知系统
├── welcome-guide.ts        # 引导流程
├── command-palette.ts      # 快捷命令面板（可选）
└── global-status.ts        # 全局状态管理
```

### 修改文件

```
apps/web/src/
├── shell.ts               # 菜单分组、徽章、状态栏
├── page-workbench.ts      # 引导清单
├── page-new-task.ts       # 创建后引导
└── index.html             # 新增 CSS 样式
```

### CSS 新增样式

```css
/* 菜单分组 */
.nav-divider { ... }
.nav-badge { ... }
.nav-section-label { ... }

/* 引导清单 */
.welcome-checklist { ... }
.checklist-item { ... }

/* 全局状态栏 */
.global-status-strip { ... }
.status-badge { ... }

/* 悬浮按钮 */
.fab-button { ... }
.fab-menu { ... }
```

---

## 八、风险与注意事项

### ⚠️ 需要注意的点

1. **性能影响**：徽章计数需要高效计算，避免每次 render 都重新计算
2. **存储管理**：引导状态使用 localStorage，需要考虑清除机制
3. **通知频率**：避免通知过多，造成干扰
4. **移动端适配**：悬浮按钮在小屏幕上的位置

### 🔒 向后兼容

- 所有新功能都是增量添加
- 不影响现有用户工作流
- 可以通过配置关闭引导功能

---

## 九、总结与建议

### 推荐实施顺序

**立即做（本周）：**
1. ✅ 菜单视觉分组 + 待办徽章（2 小时）
2. ✅ 全局状态指示器（3 小时）
3. ✅ 首次使用引导（5 小时）

**近期做（下周）：**
4. 任务创建后引导（3 小时）
5. 优化成功/错误提示的样式和位置（2 小时）

**可选（按需）：**
6. 快捷操作浮动按钮
7. 实时通知推送
8. 键盘快捷键支持

### 核心价值

这套方案的核心是：
- **降低门槛**：新用户 5 分钟上手
- **提升效率**：减少寻找和等待时间
- **主动推送**：从"用户找任务"到"任务找用户"

### 投入产出比

- **开发时间**：Phase 1 约 1-2 天
- **用户价值**：显著提升新用户留存和老用户效率
- **维护成本**：低，主要是 UI 层改动

---

## 十、附录：竞品参考

### GitHub Actions
- ✅ 清晰的工作流状态指示
- ✅ 实时进度推送
- ✅ 待办事项徽章

### Linear
- ✅ 极简的任务创建流程
- ✅ 智能的快捷命令面板（Cmd+K）
- ✅ 清晰的视觉层级

### Vercel Dashboard
- ✅ 一目了然的部署状态
- ✅ 快速操作入口
- ✅ 成功后的引导流程

---

**文档版本**：v1.0  
**最后更新**：2026-06-13  
**审核状态**：待讨论

