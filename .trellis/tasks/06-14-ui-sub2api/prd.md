# UI 风格改造：基于 Sub2API 仪表盘设计系统

## 状态：Phase 1 完成 ✅

**Phase 1 已完成：** 设计系统基础、统计卡片组件、工作台页面改造
**下一步：** Phase 2 - 扩展到其他页面

---

## 目标

将当前 AI Native Platform 的 UI 从基础样式升级为现代化 SaaS 仪表盘风格，参考 Sub2API 的设计语言，提升视觉层次、可读性和专业感。

## 参考设计分析

### Sub2API 页面核心特征

**布局**
- 左侧导航：固定宽度，深色背景，图标 + 文字标签
- 顶部栏：面包屑 + 语言选择 + 余额 + 用户头像
- 主内容：8-12px 圆角卡片，网格布局，浅色背景

**卡片设计**
- 统计卡片：白色背景 + 轻阴影（0 2px 8px rgba(0,0,0,0.08)）
- 圆形彩色图标（直径 40-48px）+ 大数字 + 辅助说明
- 指标色：绿色（余额）、紫色（API）、橙色（Token）、红色（性能）

**配色系统**
- Primary: #1E40AF（深蓝）
- Secondary: #3B82F6（亮蓝）
- Success: #10B981（绿）
- Warning: #F59E0B（橙）
- Danger: #EF4444（红）
- Purple: #8B5CF6（紫）
- Background: #F8FAFC（浅灰）
- Card: #FFFFFF
- Text Primary: #1E293B
- Text Secondary: #64748B
- Text Muted: #94A3B8

**数据可视化**
- 饼图：蓝色主色，清晰标签
- 折线图：多色图例，浅色网格线
- 表格：斑马纹，对齐清晰

**字体排版**
- Heading: Fira Code（技术感）
- Body: Fira Sans（易读性）
- 数字：等宽字体，字重 600-700
- 标签：小号，字重 400-500

## 当前状态分析

### 现有 UI 实现
- **技术栈**：原生 TypeScript + 手写 DOM 构建（`dom.ts` + `shell.ts`）
- **样式方式**：CSS 类名，当前样式较为基础
- **布局**：已有 sidebar + topbar + main 的 shell 结构
- **组件**：卡片、按钮、表单、徽章等基础组件已实现

### 待改进点
1. **视觉层次不足**：缺少阴影、圆角、渐变等现代化效果
2. **配色单一**：缺少语义化色彩系统（成功/警告/危险）
3. **卡片设计简单**：统计卡片缺少图标和视觉吸引力
4. **数据可视化待优化**：需要引入图表库
5. **间距和排版**：需要统一设计 token

## 需求范围

### Phase 1: 设计系统基础（本次实现）

#### 1.1 CSS 变量系统
定义完整的设计 token：
- 色彩变量（primary, secondary, success, warning, danger, purple）
- 间距变量（xs, sm, md, lg, xl, 2xl）
- 圆角变量（sm: 4px, md: 8px, lg: 12px, xl: 16px）
- 阴影变量（sm, md, lg）
- 字体变量（heading, body, mono）

#### 1.2 卡片组件升级
- 白色背景 + 轻阴影
- 8-12px 圆角
- 统一内边距（16-24px）
- 悬停效果（阴影加深）

#### 1.3 统计卡片（Metric Card）
新增组件：彩色圆形图标 + 大数字 + 辅助文字
- 图标尺寸：40px
- 数字字号：32px，字重 700
- 辅助文字：14px，muted 色

#### 1.4 按钮系统
- Primary：蓝色填充
- Secondary：白色背景 + 蓝色边框
- Danger：红色填充
- Ghost：透明背景 + 文字色
- 统一圆角：6px
- 悬停/按下态

#### 1.5 徽章/标签（Badge/Pill）
- 小圆角（4px）
- 语义化颜色（good/warn/bad/info/muted）
- 内边距：4px 8px
- 字号：12px

#### 1.6 表格样式
- 斑马纹行（nth-child(even)）
- 表头：字重 600，底部边框
- 单元格：垂直居中，适当内边距
- 悬停行高亮

### Phase 2: 数据可视化（后续）
- 引入图表库（Chart.js / ECharts）
- 实现饼图、折线图、柱状图
- 统一图表配色和样式

### Phase 3: 动画和交互细节（后续）
- 卡片悬停效果
- 页面切换过渡
- 加载骨架屏
- Toast 通知动画

## 实现计划

### Step 1: 创建设计系统文件
- `apps/web/public/design-tokens.css` — CSS 变量定义
- `apps/web/public/components.css` — 组件样式库
- `apps/web/public/utilities.css` — 工具类

### Step 2: 重构现有样式
- 将 `apps/web/public/index.html` 中的内联样式拆分
- 应用新的 CSS 变量
- 更新组件类名

### Step 3: 升级 DOM 辅助函数
- `dom.ts` 中新增 `metricCard()` 函数
- 新增 `iconCircle()` 函数用于彩色圆形图标
- 优化 `button()` 和 `pill()` 函数

### Step 4: 页面级改造
按优先级依次改造：
1. **工作台（Workbench）** — 展示统计卡片
2. **项目接入（Projects）** — 卡片网格布局
3. **新建任务（New Task）** — 表单美化
4. **报告（Reports）** — 表格样式
5. **知识库（Knowledge）** — 列表样式
6. **设置（Settings）** — 表单和开关

### Step 5: 响应式适配
- 移动端断点：375px, 768px
- 卡片网格：1列 → 2列 → 3列 → 4列
- 侧边栏：移动端折叠

## 验收标准

### 视觉质量
- [ ] 配色系统完整，所有状态有明确色彩映射
- [ ] 卡片阴影和圆角统一应用
- [ ] 统计卡片有彩色图标和清晰的数字层次
- [ ] 按钮和交互元素有明确的悬停/按下态
- [ ] 文字对比度符合 WCAG AA 标准（4.5:1）

### 功能完整性
- [ ] 所有现有功能保持正常工作
- [ ] 响应式布局在 375px、768px、1024px、1440px 下正常显示
- [ ] 深色/浅色模式切换正常（如需支持）
- [ ] 无布局错位或文字溢出

### 代码质量
- [ ] CSS 变量集中管理，易于维护
- [ ] 组件样式模块化，可复用
- [ ] 类名语义化，遵循 BEM 或一致的命名规范
- [ ] 无冗余样式，打包后体积合理

### 性能
- [ ] 首屏渲染时间无明显增加
- [ ] 动画流畅（60fps）
- [ ] CSS 文件压缩后 < 50KB

## Definition of Done

- 设计系统文件（design-tokens.css, components.css）创建完成
- 至少 3 个主要页面（工作台、项目接入、新建任务）完成改造
- 响应式布局测试通过
- 无 lint/typecheck 错误
- 视觉走查确认与参考设计对齐

## Out of Scope

本次不包括：
- 数据可视化图表（Phase 2）
- 复杂动画效果（Phase 3）
- 深色模式（未来单独任务）
- 国际化主题切换
- 自定义主题编辑器

## 技术约束

- 保持现有技术栈（原生 TS + 手写 DOM）
- 不引入 CSS 框架（Tailwind/Bootstrap）
- 不重构 DOM 构建逻辑，仅更新样式
- 兼容目标：Chrome/Edge/Safari 最新两个版本

## 参考资源

- 设计系统文件：`design-system/ai-native-platform/MASTER.md`
- 现有 shell 结构：`apps/web/src/shell.ts`
- DOM 辅助函数：`apps/web/src/dom.ts`
- 当前样式：`apps/web/public/index.html` 的 `<style>` 标签
