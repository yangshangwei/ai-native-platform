# 设计并实现项目宣传页面

## Goal

为 AI Native Platform（AI 软件交付工作台）设计并实现一个独立的中文宣传落地页（landing page），把核心卖点——**可验证的 AI 交付闭环**（agent 不能自报成功、测试来自真实 `mvn`/Surefire、每次交付都有 Completion Report）——讲清楚，吸引开发者/团队了解并试用。

## Requirements

- **语言**：中文为主，技术术语（Gate / Workflow Engine / Worktree / Completion Report 等）保留英文。
- **产物形态**：独立静态 HTML 页，落在 `apps/web/public/landing.html` + `landing.css` + `landing.js`，复用现有 `design-tokens.css` / `design-tokens-dark.css`。可独立部署/截图，不改动主应用 router/render。
- **视觉**：技术感 + 适度动效。复用设计系统色板与字体（Fira Sans / Fira Code，18px 圆角，单一蓝色主色）。diagram 驱动。滚动渐显用 IntersectionObserver（带 `prefers-reduced-motion` 兜底），微交互克制（hover lift / transform+opacity only）。
- **区块**（全选 + 三个补充区块）：
  1. 顶部导航（logo + 锚点导航 + 主题切换 + 主 CTA）
  2. Hero：标题 + 副标题 + 双 CTA（开始使用 / 看它怎么工作）
  3. 痛点区块（为什么需要可验证的 AI 交付）
  4. 九阶段流水线图（init → … → knowledge，diagram 驱动）
  5. 核心价值网格（4-6 个卖点卡片）
  6. **架构图区块**：Browser UI → Platform Backend → Local Runner 分层
  7. **执行后端区块**：Claude Code / Codex 可插拔 + CLI preflight
  8. **证据/截图区块**：Completion Report / Gate 看板 / Stream 日志的产品化占位
  9. 最终 CTA
  10. Footer

## Acceptance Criteria

- [ ] `apps/web/public/landing.html` 可通过 dev server 在 `/landing.html` 直接访问
- [ ] 复用现有 design-tokens，亮/暗色都正常（主题切换可用且持久化）
- [ ] 所有十个区块齐全，文案准确反映九阶段闭环与核心原则
- [ ] 滚动渐显动效工作，且 `prefers-reduced-motion` 下禁用
- [ ] 响应式：≤1180px 与 ≤780px 断点下布局不破版
- [ ] 仅用 vanilla JS，无新增依赖；`bun run typecheck` 不受影响
- [ ] 九阶段流水线图、分层架构图用纯 HTML/CSS（或内联 SVG）绘制，不引图片资源

## Definition of Done

- 页面在本地 serve 下人工核验（亮/暗 + 两个断点）
- 无新增 npm 依赖，typecheck 绿
- 文案与 README/handoff 中的事实一致（九阶段、核心原则、非目标）

## Technical Approach

- 单页静态 HTML，`<head>` 复用 `/design-tokens.css` `/design-tokens-dark.css`，landing 专属样式放 `landing.css`。
- 主题切换：复用现有 `[data-theme="dark"]` 约定 + localStorage，landing.js 内联一小段（不依赖主应用 theme.ts）。
- 动效：CSS keyframes（已有 animations.css 可参考）+ 一段 IntersectionObserver reveal（reveal 后 unobserve，rootMargin 提前触发，stagger 用 CSS 变量 delay）。
- diagram：九阶段用 flex/grid 卡片串联 + 连接线；架构图用三层堆叠卡片。
- 仅动画 `transform`/`opacity`，必要处 `will-change`，被动监听。

## Decision (ADR-lite)

**Context**: 需要一个对外宣传入口，但不想污染主交付工作台应用。
**Decision**: 独立静态 HTML 页 + 复用设计系统 token，技术感适度动效，中文为主，全区块。
**Consequences**: 与主应用零耦合、可单独截图/部署；缺点是设计系统若变更需手动同步 token（可接受，token 文件共用已缓解）。

## Out of Scope

- 不接入主应用 router / SPA
- 不做多页站点 / CMS / i18n 框架
- 不引入构建步骤或新依赖
- 不做真实产品截图采集（用产品化占位 mock）

## Research References

- [`research/landing-page-patterns.md`](research/landing-page-patterns.md) — DevTools 落地页区块结构、可验证交付的差异化卖点、参考工具（Linear/Vercel/Cursor/v0.dev）
- [`research/animation-approaches.md`](research/animation-approaches.md) — 现有 animations.css 已具备 keyframes/reduced-motion；唯一缺口是 IntersectionObserver 滚动渐显

## Technical Notes

- 设计 token：`apps/web/public/design-tokens.css`、`design-tokens-dark.css`
- 现有动画：`apps/web/public/animations.css`（fade/slide/skeleton + prefers-reduced-motion kill switch）
- 现有组件样式参考：`apps/web/index.html` 内联 `<style>`（pill / button / stage-card / hero-card）
- 字体：Fira Sans（正文）/ Fira Code（mono）
- 主色 `--primary: #2563eb`，圆角 `--radius: 18px`
- dev server：`bun run dev:web`（serve.ts，静态 public 直出）
