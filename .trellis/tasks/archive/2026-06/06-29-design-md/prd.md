# design-md 页面改进规划

## Goal

基于 `voltagent/awesome-design-md` 的设计模板调研，为当前 Octopus / AI Native Platform Web 工作台制定一份可执行的页面改进方案。方案需要覆盖需求分析、架构方案设计、研发任务分解和回归测试验证，作为后续 UI 实现任务的输入。

## What I Already Know

- 当前 Web 前端是轻量 TypeScript DOM 应用，通过 `render()` 重建根节点，不使用前端框架虚拟 DOM。
- 当前页面形态是深色工作台：左侧导航、顶部状态、关键指标卡、任务执行趋势、执行环境、待办入口。
- `awesome-design-md` 不是组件库，而是一组面向 AI 设计生成的 `DESIGN.md` 文档模板。
- 当前产品形态最接近开发者工具 / 工程工作台，而不是营销站。
- 推荐设计参考组合：
  - 主参考：Linear，适合深色、克制、工程化、任务管理型工作台。
  - 辅参考：Raycast，适合命令面板式任务入口和紧凑 action rows。
  - 局部参考：Cursor，适合 AI 执行阶段 timeline / pill 状态色。

## Requirements

- 输出一份 Markdown 规划文档，包含：
  - 需求分析
  - 架构方案设计
  - 研发任务分解
  - 回归测试验证
- 文档需要给出明确的推荐设计方向，而不是只列模板。
- 文档需要结合当前页面架构和 Web 前端约束。
- 文档需要能直接转化为后续 Trellis 实现任务。
- 本任务不直接修改业务代码或 UI 样式。

## Acceptance Criteria

- [ ] `docs/2026-06-29-design-md-page-improvement-plan.md` 存在。
- [ ] 文档包含需求分析、架构方案设计、研发任务分解、回归测试验证四个章节。
- [ ] 文档明确推荐 `Linear 70% + Raycast 20% + Cursor timeline 10%` 的设计组合。
- [ ] 文档列出影响范围、非目标、任务拆分、测试矩阵和验收标准。
- [ ] Trellis 任务 PRD 记录目标、需求、验收和技术备注。
- [ ] 后续实现上下文 jsonl 删除 seed `_example`，改为真实规范条目。

## Definition of Done

- Markdown 文档已写入仓库。
- Trellis PRD 已写入任务目录。
- `implement.jsonl` / `check.jsonl` 已填写后续实现需要的规范上下文。
- `git diff --check` 通过。

## Technical Approach

本任务只产出规划文档，不启动代码实现。方案将把设计改进拆成四层：

1. Design tokens：颜色、字体、半径、边框、间距、状态色。
2. App shell：侧栏、顶栏、全局状态、页面容器。
3. Workbench pages：工作台、新建任务、任务详情、待办、报告、知识库。
4. Verification：DOM/unit 测试、类型检查、视觉 smoke、移动端溢出检查。

后续实现应优先从 token 和 shell 开始，再逐页改造，避免一次性重写所有页面。

## Decision (ADR-lite)

**Context**: 当前页面已有可用的信息架构，但视觉语言偏传统 admin dashboard，大面积蓝色 surface 和卡片阴影降低了工程工作台的精确感。  
**Decision**: 采用 Linear 作为主视觉参考，Raycast 作为命令/行动入口参考，Cursor 的 AI timeline 作为阶段状态参考。  
**Consequences**: 方案会保留深色主体验、减少装饰性颜色和阴影、强化任务状态层级。后续实现需要谨慎处理现有 theme token 和内联样式，避免全局改色导致可读性或状态语义回归。

## Out of Scope

- 不在本任务中实现 CSS / TypeScript 改动。
- 不引入新的 UI 框架或设计系统依赖。
- 不替换现有路由、状态管理或 API 数据结构。
- 不制作新的营销 landing page。
- 不复制任何品牌资产，只参考设计原则和组件语言。

## Technical Notes

- 当前主要 UI 文件：
  - `apps/web/src/shell.ts`
  - `apps/web/src/page-workbench.ts`
  - `apps/web/src/page-new-task.ts`
  - `apps/web/src/page-task-detail.ts`
  - `apps/web/index.html`
  - `apps/web/public/design-tokens.css`
  - `apps/web/public/design-tokens-dark.css`
  - `apps/web/public/components.css`
- 前端规范：
  - `.trellis/spec/web/frontend/index.md`
  - `.trellis/spec/web/frontend/state-management.md`
  - `.trellis/spec/web/frontend/agent-backend-ui.md`
- 本地页面可访问：`http://localhost:5173`
- 视觉检查截图已临时输出到 `/tmp/ainp-workbench.png`。
