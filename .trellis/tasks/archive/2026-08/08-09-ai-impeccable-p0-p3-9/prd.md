# PRD: 去除 AI 味 — Impeccable 审计修复

## 1. 背景与问题

Impeccable 全面审计发现系统页面存在 AI 生成痕迹，得分 14/20（Good 级别）。主要问题：

- **P0 阻塞性问题**：无键盘焦点指示器、图标按钮缺少 ARIA 标签
- **P1 重要问题**：着陆页 12 处破折号、卡片网格脚手架、装饰性模糊效果、通用操作文案
- **P2 次要问题**：等宽字体误用、未延迟加载图表、缺少加载态
- **P3 打磨项**：装饰性元素（段落编号、终端模拟圆点）、欢迎引导改进

**核心诉求**：从"安全分类设计"升级为"产品特定声音"，保留技术准确性的同时注入平台身份。

## 2. 目标

**主目标**：修复 P0-P2 所有问题（19 项），Impeccable 复审得分 ≥ 18/20（Excellent）

**子目标**：
1. 无障碍性从 2 分提升至 4 分（焦点指示器 + ARIA 标签 + 动画可选退出）
2. 实现完整性从 2 分提升至 4 分（移除 AI 脚手架、注入产品隐喻）
3. 着陆页文案去除 AI 节奏（12 个破折号降至 ≤3 个）
4. 所有交互元素支持键盘导航并有可见焦点环

## 3. 需求拆解（按优先级）

### P0 — 立即修复（accessibility blocking）

#### P0.1 键盘焦点指示器
- **范围**：所有页面的按钮、导航项、表单控件、可交互卡片
- **规格**：`:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }`
- **文件**：`design-tokens.css`（全局样式）、`landing.css`、`components.css`
- **验收**：Tab 键导航任意页面，所有交互元素有蓝色焦点环

#### P0.2 ARIA 标签
- **范围**：
  - `landing.html:34` — 主题切换按钮 `aria-label="切换主题"`
  - `shell.ts` — 导航图标按钮添加 `aria-label`
  - `page-workbench.ts` — 度量卡片图标添加 `aria-hidden="true"`（图标装饰性，label 在文本里）
- **验收**：屏幕阅读器能朗读所有按钮用途

#### P0.3 减少动画支持
- **规格**：`@media (prefers-reduced-motion: reduce) { .reveal, * { animation: none !important; transition-duration: 0.01ms !important; } }`
- **文件**：`animations.css`
- **验收**：macOS 系统偏好设置启用"减弱动态效果"后，页面无动画

### P1 — 发布前修复（major issues）

#### P1.1 着陆页文案去 AI 味
- **问题**：12 个破折号、AI 节奏
- **改写清单**：
  - Hero lede（Line 50-53）：拆分长句，用句号代替破折号
  - Problem 卡片（Line 95-104）：精简为短句
  - Pipeline note（Line 128-131）：去除破折号
- **验收**：破折号数量 ≤3，Impeccable `detect.mjs` 无 advisory

#### P1.2 交互文案产品化
- **范围**：
  - `page-workbench.ts:222` — "等待你批准" → "等待门禁放行"
  - `page-workbench.ts:224` — "查看并批准" → "审查证据并放行"
  - `page-my-todos.ts:51` — "需要你补充信息、批准继续或处理失败的任务" → "需要补充上下文、通过门禁或处理失败的执行"
- **验收**：交互标签体现"门禁""证据链""放行"等平台术语

#### P1.3 卡片网格替换为编排隐喻
- **范围**：
  - `landing.html:93` — `.problem-grid` 替换为 `.validation-flow`（问题→门禁→证据的三栏布局）
  - `landing.html:139` — `.value-grid` 替换为 `.orchestration-stages`（垂直流水线，每个能力对应一个阶段）
- **设计方向**：用流水线、检查点、证据链的视觉隐喻替代通用卡片网格
- **验收**：视觉布局表达"编排→把关→证据"的产品核心

#### P1.4 移除装饰性效果
- **清单**：
  - `landing.css:110` — 删除 `backdrop-filter: blur(14px)`，nav 保持不透明
  - `landing.css:138` — Hero 背景从渐变简化为 `background: var(--bg-base);`
  - `landing.css:92` — 删除 `.eyebrow` 组件及所有用例（Line 48）
- **验收**：着陆页无模糊效果、无渐变背景、标题上方无 kicker

#### P1.5 触摸目标尺寸
- **问题**：`.metric-icon` 为 36×36px，低于 44px WCAG 最低值
- **修复**：`components.css:73` — 改为 `width: 44px; height: 44px;`
- **验收**：所有可点击图标 ≥44×44px

#### P1.6 着陆页响应式
- **问题**：Hero 双栏布局在 <768px 时拥挤
- **修复**：`landing.css` 添加 `@media (max-width: 768px) { .hero-inner { grid-template-columns: 1fr; } }`
- **验收**：iPhone SE 视口下 hero 单栏堆叠，终端模拟图在文案下方

### P2 — 下一轮修复（minor issues）

#### P2.1 等宽字体精准使用
- **问题**：`.metric-value` 对所有数值用等宽字体，但"3 个待办"不需要对齐
- **修复**：只对需要表格对齐的数值（token 计数、耗时）用 `var(--font-mono)`，其他用常规字重
- **验收**：度量卡片中非表格数据用无衬线字体

#### P2.2 占位符替换
- **清单**：
  - `page-projects.ts:414` — `https://git.example.com/...` → `https://gitea.company.com/team/java-service.git`
  - `page-new-task.ts:279` — 通用示例 → 引用用户当前项目的上下文
- **验收**：表单占位符使用真实场景示例

#### P2.3 图表延迟加载
- **问题**：Chart.js 在 workbench 页面首屏即加载，但图表在折叠下方
- **修复**：`page-workbench.ts` — 图表容器添加 `IntersectionObserver`，进入视口时才调用 `createLineChart`
- **验收**：控制台网络面板显示 Chart.js 在滚动到图表区域时才下载

#### P2.4 异步按钮加载态
- **范围**：
  - `page-new-task.ts` — 提交工作流请求时按钮显示 spinner
  - `page-projects.ts` — 后端预检时显示加载反馈
- **规格**：按钮禁用 + 添加 `.loading` 类（CSS 已有 spinner 定义）
- **验收**：点击提交后按钮变灰并显示旋转图标

### P3 — 时间允许时修复（polish）

#### P3.1 移除装饰性元素
- **清单**：
  - `landing.html:119` — 删除 `.stage-idx` 数字标签
  - 评估终端模拟的圆点是否保留（如果"可验证命令执行"是核心隐喻则保留）
- **决策**：保留终端圆点（命令执行是产品核心），删除流水线编号

#### P3.2 欢迎引导改进
- **问题**：首次引导在有项目后自动消失，无法重新访问
- **修复**：
  - `page-workbench.ts` — 添加手动关闭按钮
  - `page-settings.ts` — 添加"显示欢迎引导"选项
- **验收**：关闭后可在设置中重新打开

## 4. 技术方案

### 4.1 文件改动清单

| 优先级 | 文件 | 改动类型 | 工作量 |
|--------|------|----------|--------|
| P0 | `design-tokens.css` | 添加全局 `:focus-visible` | 10 行 |
| P0 | `animations.css` | 添加 `prefers-reduced-motion` | 5 行 |
| P0 | `landing.html` | ARIA 标签 | 3 处 |
| P0 | `shell.ts` | ARIA 标签 | ~10 处 |
| P0 | `page-workbench.ts` | ARIA 标签 | ~5 处 |
| P1 | `landing.html` | 文案重写 + 布局重构 | ~80 行 |
| P1 | `landing.css` | 删除装饰效果 + 响应式 | ~30 行 |
| P1 | `components.css` | 触摸目标尺寸 | 2 行 |
| P1 | `page-workbench.ts` | 交互文案 | ~5 处 |
| P1 | `page-my-todos.ts` | 交互文案 | ~3 处 |
| P2 | `page-projects.ts` | 占位符 + 加载态 | ~10 行 |
| P2 | `page-new-task.ts` | 占位符 + 加载态 | ~10 行 |
| P2 | `page-workbench.ts` | 图表延迟加载 | ~20 行 |
| P2 | `components.css` | 等宽字体修正 | 5 行 |
| P3 | `landing.html` | 删除装饰元素 | -10 行 |
| P3 | `page-workbench.ts` | 欢迎引导改进 | ~30 行 |

### 4.2 实施顺序

1. **Phase 1 (P0)**: 全局无障碍修复（design-tokens.css + animations.css）
2. **Phase 2 (P0)**: ARIA 标签批量添加（landing.html + shell.ts + page-workbench.ts）
3. **Phase 3 (P1)**: 着陆页重构（landing.html + landing.css）
4. **Phase 4 (P1)**: 交互文案产品化（page-*.ts）
5. **Phase 5 (P2)**: 细节打磨（延迟加载 + 占位符 + 等宽字体）
6. **Phase 6 (P3)**: 可选改进（欢迎引导）
7. **Phase 7**: Impeccable 复审 + 自测

### 4.3 验收标准

**P0 验收**：
- [ ] Tab 键导航所有页面，焦点环可见
- [ ] 屏幕阅读器（VoiceOver/NVDA）能朗读所有按钮
- [ ] macOS"减弱动态效果"启用后无动画
- [ ] 所有交互元素 ≥44×44px

**P1 验收**：
- [ ] `node .claude/skills/impeccable/scripts/detect.mjs public/landing.html` 无 advisory
- [ ] 着陆页无模糊、无渐变、无 kicker
- [ ] 交互标签包含"门禁""证据链""放行"等术语
- [ ] 着陆页布局表达编排隐喻而非通用卡片
- [ ] iPhone SE 视口下着陆页单栏布局

**P2 验收**：
- [ ] 图表在滚动到可见区域时才加载
- [ ] 异步按钮显示 loading 状态
- [ ] 表单占位符使用真实场景示例

**最终验收**：
- [ ] 重新运行 Impeccable audit，得分 ≥18/20
- [ ] 本地启动 `bun run dev:web`，手动测试所有修改点
- [ ] 无 console 错误，无回归

## 5. 风险与依赖

**风险**：
- 着陆页布局重构可能需要多次迭代才能找到合适的编排隐喻
- ARIA 标签添加需要逐个组件审查，可能遗漏

**依赖**：
- 无外部依赖
- 需要设计决策：卡片网格的替代布局方向

## 6. 不做什么

- **不做**：重写整个设计系统（token 系统已成熟，保留）
- **不做**：改变交互逻辑（只改文案和样式，不动状态管理）
- **不做**：添加新功能（专注去除 AI 味，不扩展能力）
- **不做**：性能优化之外的其他优化（如 bundle size、tree shaking）

## 7. 后续计划

完成 P0-P2 后：
- Impeccable 复审
- 截图对比（修复前/后）
- 如果得分未达 18/20，分析原因并补充修复
