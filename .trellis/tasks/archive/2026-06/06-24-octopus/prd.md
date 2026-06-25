# 设计并实现 Octopus 品牌图标

## Goal

将侧边栏品牌区域的 "AI" 文字替换为一个简约、现代的章鱼（Octopus）SVG 图标，与现有设计风格保持一致，强化品牌识别度。

## What I already know

**当前实现：**
- 品牌图标位置：`shell.ts` 第 153 行，`<div class="brand-mark">` 显示文字 "AI"
- 样式定义：`index.html` 第 204-208 行
  - 尺寸：42x42px
  - 圆角：14px
  - 背景：`var(--primary)`（蓝色）
  - 文字颜色：白色，字重 800
- 项目已有 SVG icon 工具函数：`dom.ts` 第 36-50 行
  - 创建 24x24 viewBox 的 SVG
  - 使用 stroke（描边）风格，非填充
  - 支持 currentColor

**设计系统特征：**
- 圆角风格：柔和（14px-18px）
- 颜色：主色为蓝色（`var(--primary)`）
- 图标风格：线条描边（stroke），简约现代

**章鱼品牌寓意：**
- 多任务并行（多条触手）
- 智能灵活
- 自主协作

## Assumptions (temporary)

- 图标应该保持在 42x42px 容器内
- 图标颜色使用白色（与背景蓝色对比）
- 图标风格应与现有导航图标风格一致（描边风格）
- 需要设计一个识别度高的章鱼简化图形

## Decision

**用户选择：方案 A - 简化章鱼剪影**

设计要点：
- 圆形/椭圆形头部（象征智能核心）
- 3-4 条弯曲触手（象征多任务并行）
- 线条描边风格，stroke-width: 2-2.5
- 白色图标 + 蓝色背景
- 在 42x42px 容器中居中，留适当边距

## Requirements

1. 设计一个简化的章鱼 SVG 图标（方案 A）
   - 圆形/椭圆形头部
   - 3-4 条弯曲触手，自然向下延伸
   - 线条描边风格（stroke），stroke-width: 2-2.5
   - 图标本身约 28-32px，在 42x42px 容器中居中
2. 图标颜色为白色，背景保持蓝色（`var(--primary)`）
3. 图标风格与现有导航图标一致（圆润、简约、描边）
4. 在侧边栏收起状态下也应该清晰可见
5. 在 `dom.ts` 中创建 `octopusIcon()` 辅助函数
6. 修改 `shell.ts` 中的品牌图标渲染逻辑

## Acceptance Criteria

- [x] 章鱼图标在侧边栏正常显示
- [x] 图标在浅色/深色主题下都清晰可见
- [x] 图标与品牌文字（Octopus）视觉协调
- [x] 侧边栏收起时图标清晰可辨
- [x] 图标在不同分辨率下保持清晰（SVG 矢量）

## Implementation Summary

**已完成：**
1. ✅ 在 `dom.ts` 中添加 `octopusIcon()` 函数
   - 创建 32x32 viewBox 的 SVG
   - 椭圆形头部（cx=16, cy=12, rx=7, ry=8）
   - 4条贝塞尔曲线触手，自然向下延伸
   - stroke-width: 2.5，stroke: currentColor
2. ✅ 在 `shell.ts` 中导入并使用 `octopusIcon()`
   - 导入 `octopusIcon` 函数
   - 替换 `.brand-mark` 中的文字 "AI" 为 SVG 图标
3. ✅ 浏览器测试验证
   - 浅色主题：白色图标 + 蓝色背景 ✓
   - 深色主题：白色图标 + 蓝色背景 ✓
   - 侧边栏展开：图标清晰显示 ✓
   - 侧边栏收起：图标依然可见 ✓

## Definition of Done (team quality bar)

- 代码修改最小化（新增 `dom.ts` 图标 helper，并在 `shell.ts` 使用）
- 浏览器实测验证（浅色/深色主题、侧边栏展开/收起状态）
- 视觉效果与用户期望一致

## Out of Scope (explicit)

- 动画效果（可作为未来增强）
- 多套图标变体
- favicon 更新（另开任务）
- 其他页面的 logo 更新

## Technical Notes

**文件涉及：**
- `apps/web/src/dom.ts` - 新增 `octopusIcon()` 函数
- `apps/web/src/shell.ts` - 修改品牌图标渲染（第 153 行）
- `apps/web/index.html` - `.brand-mark` 样式可能需要微调（视觉验证后）

**图标设计约束：**
- 需要在小尺寸（42x42px）下识别度高
- 章鱼特征明显：头部（圆形/椭圆）+ 触手（曲线）
- 避免过于复杂的细节（在小尺寸下会模糊）

**SVG 图标设计方案：**
- viewBox: "0 0 32 32"（给图标足够空间，避免边缘裁切）
- 头部：椭圆形，位于上半部分
- 触手：3-4 条贝塞尔曲线，从头部底部延伸
- stroke: currentColor（继承白色）
- stroke-width: 2.5（在小尺寸下清晰可见）
- fill: none（保持描边风格）

**实现步骤：**
1. 在 `dom.ts` 中创建 `octopusIcon()` 函数，返回完整 SVG 元素
2. 在 `shell.ts` 中用 `octopusIcon()` 替换文字 "AI"
3. 浏览器中测试视觉效果（浅色/深色主题、侧边栏展开/收起）
4. 必要时微调 `.brand-mark` 的 padding 或图标尺寸

## Implementation Plan

**单 PR 实现：**
1. 设计章鱼 SVG path 数据（头部 + 触手）
2. 在 `dom.ts` 添加 `octopusIcon()` 函数
3. 在 `shell.ts` 替换品牌图标
4. 浏览器测试并微调
5. 截图验证最终效果

## Task Directory Cleanup

- 已将重复目录 `06-24-octopus-brand-icon/` 中的 PRD 和上下文合并到 `06-24-octopus/`
- 已移除重复目录，保留 `06-24-octopus/` 作为唯一 Trellis 任务目录
