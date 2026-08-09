# PRD: 完成 Impeccable 审计剩余 P1 和最终 Polish

## 背景

已完成 Impeccable 全面审计的大部分工作（P0, P1 部分, P2, P3），但有两项关键工作待完成：

1. **[P1] 替换卡片网格脚手架** — 当前 landing page 使用通用的 icon+h3+p 卡片网格（`.problem-grid`, `.value-grid`），这是 AI 生成 UI 的默认模板，不能表达产品的编排/门禁/证据链隐喻
2. **[Polish] 最终质量检查** — 在所有修复完成后进行全面验证

## 目标

将 landing page 从"安全的 SaaS 模板"升级为"表达产品核心隐喻"的独特设计。

## 用户故事

作为访问 landing page 的潜在用户，我希望：
- 一眼看出这是一个**工作流编排+门禁把关**的平台，而不是又一个通用工具
- 视觉布局本身就能传达"阶段→门禁→证据"的流程感
- 不要看到千篇一律的卡片网格

## 需求

### 1. [P1] 替换卡片网格脚手架 (`/impeccable bolder`)

#### 当前问题

**Problem Section** (`landing.html:93-107`)
```html
<div class="problem-grid">
  <div class="problem-card reveal">
    <h3>AI 说通过 ≠ 真的通过</h3>
    <p>...</p>
  </div>
  <!-- 3 个相同结构的卡片 -->
</div>
```

**Values Section** (`landing.html:139-171`)
```html
<div class="value-grid">
  <div class="value-card reveal">
    <div class="value-icon">⚙</div>
    <h3>单一状态写入点</h3>
    <p>...</p>
  </div>
  <!-- 6 个相同结构的卡片 -->
</div>
```

这是 AI 的默认脚手架：
- 等宽等高的卡片
- icon + heading + body 的重复模式
- 网格布局不表达任何产品特性

#### 目标设计

用**流程导向的布局**替代卡片网格，视觉上表达：
- **串联而非并列** — 阶段是有先后顺序的
- **关卡感** — 每个门禁都需要通过
- **证据链** — 从需求到验收的完整链条

#### 具体方案

**Problem Section** 改为**对比式布局**：
- 左侧：问题场景（"AI 说通过但没跑测试"）
- 右侧：平台解决方案（"真实命令执行 + 白名单"）
- 视觉上用对比而非平铺

**Values Section** 改为**流程卡片**：
- 不是 6 个等宽卡片，而是 3 个关键流程节点
- 每个节点包含多个子能力
- 视觉上形成"输入→处理→输出"的流动感

**保留现有的 Pipeline Section**（`landing.html:118-132`）：
- 这个已经是流程布局，不需要改

#### 验收标准

- [ ] Problem section 不再是卡片网格
- [ ] Values section 不再是等宽卡片
- [ ] 新布局在移动端 (<768px) 正确堆叠
- [ ] 保留所有现有文案内容（只改布局）
- [ ] 暗色模式正常工作

### 2. [Polish] 最终质量检查

在所有修复完成后执行：

#### 视觉一致性检查
- [ ] 所有交互元素有焦点指示器
- [ ] 所有 icon-only 按钮有 ARIA 标签
- [ ] 颜色使用一致（primary = teal, success = emerald）
- [ ] 间距使用 token 而非硬编码值
- [ ] 圆角使用 token 而非硬编码值

#### 响应式检查
- [ ] Hero section 在 <768px 正确堆叠
- [ ] 新的 problem/values 布局在移动端正确显示
- [ ] 触摸目标 ≥44px
- [ ] 横向内容不溢出

#### 可访问性检查
- [ ] 键盘 Tab 导航正常
- [ ] `prefers-reduced-motion` 生效
- [ ] 所有表单有正确的 label 关联
- [ ] 颜色对比度 ≥4.5:1 (WCAG AA)

#### 性能检查
- [ ] Chart.js 懒加载生效
- [ ] 无控制台错误
- [ ] 无未使用的 CSS 类（清理残留）

#### 内容检查
- [ ] 无 placeholder 文本（"Lorem ipsum", "example.com"）
- [ ] 无装饰性 eyebrow/kicker
- [ ] 无过度的破折号
- [ ] 操作文案使用产品术语（"门禁审批" 而非 "等待批准"）

## 非目标

- 不改变现有功能逻辑
- 不修改 TypeScript 业务代码
- 不新增动画效果
- 不改变现有文案内容（只改布局和样式）

## 技术约束

- 只修改 `apps/web/public/` 下的 HTML/CSS 文件
- 保持与 design-tokens.css 的兼容性
- 保持暗色模式正常工作
- 新布局必须响应式

## 成功标准

1. Landing page 不再有 AI 生成 UI 的视觉特征
2. 布局本身能传达产品的工作流/门禁/证据隐喻
3. 通过 `/impeccable audit` 复查，分数从 21/25 提升到 23/25+
4. 所有 P0/P1 问题全部解决
5. 视觉/响应式/可访问性/性能四个维度无遗留问题

## 交付物

1. 更新的 `apps/web/public/landing.html` — 新布局
2. 更新的 `apps/web/public/landing.css` — 新布局样式
3. 可能更新的 `apps/web/public/components.css` — 如果需要新组件
4. 自测报告 — 验收标准逐项确认
5. 最终审计报告 — `/impeccable audit` 输出

## 附录：现有的成功案例

保留并参考的好设计：
- **Pipeline section** (landing.html:118-132) — 已经是流程布局，很好
- **Architecture diagram** (landing.html:181-204) — 分层结构清晰
- **Terminal mock** (landing.html:66-80) — 真实感强，不是装饰
- **Evidence grid** (landing.html:240-276) — 展示真实产物，不是营销话术
