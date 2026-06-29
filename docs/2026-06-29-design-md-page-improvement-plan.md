# design-md 页面改进规划

> 日期：2026-06-29  
> 任务：`.trellis/tasks/06-29-design-md`  
> 范围：Octopus / AI Native Platform Web 工作台视觉与信息架构改进规划。  
> 参考：`voltagent/awesome-design-md` 中 Linear、Raycast、Cursor、VoltAgent 等 `DESIGN.md` 模板。

## 0. 结论

推荐采用：

```text
Linear 70% + Raycast 20% + Cursor timeline 10%
```

- **Linear 作为主参考**：适合深色、克制、任务管理、工程团队工作台。当前页面的左侧导航、任务状态、指标卡、报告中心都更接近 Linear 的产品型工作台语言。
- **Raycast 作为交互参考**：适合命令面板、紧凑 action row、快捷动作、任务入口。用于改造“新建任务”“我的待办”“需要处理”的操作区。
- **Cursor timeline 作为局部参考**：适合 AI 执行阶段色票和阶段 pill。用于表达理解目标、准备上下文、实现、检查、知识沉淀等 AI 工作流状态。

不建议把 VoltAgent 作为主模板。VoltAgent 的黑绿开发者平台气质适合营销页和文档站，但当前 Web UI 是任务运行台，过强的品牌绿会压过任务状态语义。

## 1. 需求分析

### 1.1 背景

当前 Web 页面已经具备完整的产品骨架：

- 左侧导航：工作台、我的待办、新建任务、任务报告、知识库、项目接入、运行配置。
- 顶部状态：运行中、待处理、正常、执行环境。
- 工作台主体：待办提醒、工作台概览、任务执行趋势、执行环境。
- 任务详情和报告页：展示阶段、证据、审批、Agent Stream、Runner 状态。

问题不在功能缺失，而在视觉语言和信息层级还偏“传统 admin dashboard”：

- 大面积深蓝 surface 和高饱和蓝色 active 态让页面主题偏单色。
- 卡片边界、阴影、背景层级同时存在，层级来源不够统一。
- “需要我处理”的动作与“系统状态说明”视觉权重接近，用户需要扫描后才能判断下一步。
- AI 执行阶段目前更多依赖 good/warn/bad 语义色，缺少“AI 正在做什么”的阶段化表达。
- 页面已经是工作台，不需要营销式 hero 或装饰性大图，应提升工作效率和状态可读性。

### 1.2 用户目标

目标用户是使用本地 Runner / AI Agent 执行研发任务的人。页面第一屏应该快速回答：

- 当前有没有我必须处理的事情？
- AI 正在处理什么？
- 哪些任务失败、等待确认或可以验收？
- 当前项目、Runner、Agent Backend 是否可用？
- 新建任务时系统会走哪条流程，是否具备执行条件？

### 1.3 设计目标

- **任务优先**：把“需要处理”和“正在执行”放在视觉层级最高的位置。
- **工程化克制**：减少装饰性颜色、渐变和阴影，用 surface ladder、hairline、状态 pill 表达层级。
- **状态清晰**：区分 system health、task status、human action、AI stage 四类状态。
- **行动入口紧凑**：审批、查看待办、新建任务、重试、展开日志等动作应像命令面板一样直接。
- **保留现有信息架构**：不重写路由、不换框架、不改变 API DTO。
- **渐进式落地**：先 token 和 shell，再逐页改造，避免一次性大改造成回归风险。

### 1.4 非目标

- 不做新的 landing page。
- 不复制 Linear / Raycast / Cursor 的品牌资产。
- 不新增前端框架、UI 库或图标库依赖。
- 不改变任务流、审批流、Runner/API 协议。
- 不把页面改成纯营销风或纯终端风。

### 1.5 约束

- Web 前端是原生 TypeScript DOM 渲染应用，通过 `render()` 重建页面。
- 自动 polling / SSE 会触发重渲染，所有输入草稿、focus、IME composition、`details` 展开状态必须遵守现有前端规范。
- 当前主题 token 同时存在 `apps/web/index.html` 内联样式和 `apps/web/public/*.css`，实现时需要先整理映射，避免重复定义互相覆盖。
- 现有深浅色切换需要保留；即使推荐深色作为主体验，也不能破坏浅色模式。

## 2. 架构方案设计

### 2.1 总体方案

采用“四层改造”：

```text
Design Tokens
  -> App Shell
  -> Page Surfaces
  -> State/Action Components
```

每层职责：

| 层 | 职责 | 参考模板 |
|---|---|---|
| Design Tokens | 颜色、surface ladder、字体、半径、边框、状态色 | Linear |
| App Shell | 侧栏、顶栏、全局状态、页面容器 | Linear + Raycast |
| Page Surfaces | 工作台、任务详情、报告、知识库、新建任务的布局密度 | Linear |
| State/Action Components | 待办、审批、阶段 pill、命令入口、日志展开 | Raycast + Cursor |

### 2.2 Design Token 方向

当前 token 应从“蓝色 admin dashboard”调整为“深色工程工作台”。

推荐 token 语义：

| Token | 用途 | 建议 |
|---|---|---|
| `--bg` / `--canvas` | 页面底色 | 近黑蓝灰，不用纯黑 |
| `--surface` | 侧栏、主 panel | 比 canvas 亮一阶 |
| `--surface-2` | 卡片内层、active row | 比 surface 亮一阶 |
| `--surface-3` | hover / nested surface | 谨慎使用 |
| `--line` | 默认 hairline | 1px 边框主层级 |
| `--line-strong` | focus / active border | 少量使用 |
| `--primary` | 主操作 / active nav | 单一主色，避免大面积填充 |
| `--stage-*` | AI 阶段状态 | 借 Cursor timeline，限定在阶段/流程组件 |

颜色策略：

- 深色主体验使用 Linear 式 surface ladder，而不是靠阴影制造层级。
- 主色只用于 active nav、主按钮、focus ring、关键链接。
- good/warn/bad/info 继续保留，但只表达结果语义。
- AI stage 色票独立于结果语义，例如：
  - planning / thinking：暖橙或 peach
  - context / reading：蓝
  - implementation / editing：lavender
  - validation / checking：mint
  - done：green/gold

### 2.3 App Shell 方案

当前 shell 文件：`apps/web/src/shell.ts`。

保留现有结构：

```text
aside.sidebar
main.main-shell
  topbar
  current page
expanded stream overlay
```

改造方向：

- 侧栏从“大块蓝色 active 背景”改成更克制的 row active indicator：
  - active row 可使用 surface lift + 左侧 2px/3px primary indicator。
  - badge 保持高可见，但不要和主按钮同权重。
- 侧栏底部“自动执行”卡改成 compact status console：
  - 等待开始 / 执行中 用小型 metric。
  - 最近任务用单行 row，必要信息优先。
  - Runner fallback 说明默认弱化。
- 顶栏从“标题 + 状态 badge”改为“页面标题 + 当前关键上下文 + 全局 health strip”：
  - 工作台：执行环境 / 待处理 / 运行中。
  - 新建任务：项目、Backend、Runner readiness。
  - 任务详情：当前阶段、审批状态、Agent Backend。

### 2.4 工作台页面方案

当前文件：`apps/web/src/page-workbench.ts`。

第一屏建议顺序：

1. **Action Queue**：需要我处理的任务、失败、等待确认。
2. **Run Snapshot**：AI 正在处理、最近完成、任务总数。
3. **Execution Trend**：趋势图，视觉权重低于待办。
4. **Environment**：正常时收起，异常时提升权重。

改造建议：

- `todos-alert` 参考 Raycast command row，做成高密度 action panel。
- 指标卡参考 Linear：边框、紧凑数字、少阴影。
- 趋势图 panel 当前占比很大，如果数据为空，应降级为空状态，不使用假数据伪装真实趋势。
- 执行环境正常时作为 collapsed detail；异常时在 Action Queue 下方展示。

### 2.5 新建任务页面方案

当前文件：`apps/web/src/page-new-task.ts`。

新建任务是命令入口，应参考 Raycast：

- 表单主体像 command composer，而不是传统后台表单。
- 标题/详情输入保持大面积可写区域。
- 项目、分支、任务类型、Flow override 用紧凑 selector rows。
- 执行建议卡用“推荐路径 + 可解释原因 + 可覆盖”的结构。
- Runner / Backend readiness 不应打断输入流，但缺失时必须阻止提交并给出短提示。

保持现有关键约束：

- 用户草稿必须跨 polling render 保留。
- IME composition 期间不能重建输入节点。
- API 原始错误只进 collapsed diagnostics。

### 2.6 任务详情页面方案

当前文件：`apps/web/src/page-task-detail.ts`。

任务详情是 reviewer surface，不是日志页。推荐层级：

```text
Next Action / Review Decision
  -> Current Stage
  -> Stage Timeline
  -> Evidence Summary
  -> Agent Stream / Runner Diagnostics
```

改造建议：

- 等待人工确认时，主 panel 只展示用户能理解的动作：批准、打回、补充说明。
- raw gate id、run id、worktree、command count 放入稳定 `details`。
- Stage Timeline 使用 Cursor 风格 stage pill，但结果状态仍使用 good/warn/bad。
- Agent Stream 默认 readable summary；原始日志折叠，展开后保持现有 stream cache，不新增连接。

### 2.7 报告、知识库、设置页面方案

这些页面不需要强视觉重写，重点统一组件语言：

- 报告页：更像 review inbox，失败/待确认优先，完成报告作为 evidence cards。
- 知识库：区分 candidate / accepted / stale / superseded，避免所有卡片等权。
- 设置页：保持诊断优先，正常状态折叠，异常状态提升。
- 项目接入：接入流程保留 step-by-step，但视觉上使用紧凑 setup checklist。

### 2.8 文件与边界

预计后续实现影响：

| 区域 | 主要文件 | 原则 |
|---|---|---|
| Token / 全局样式 | `apps/web/index.html`, `apps/web/public/design-tokens*.css`, `apps/web/public/components.css` | 先映射语义 token，再改组件样式 |
| Shell | `apps/web/src/shell.ts` | 不改变页面 union 和路由 |
| 工作台 | `apps/web/src/page-workbench.ts` | 不改变数据来源，只改渲染层 |
| 新建任务 | `apps/web/src/page-new-task.ts` | 保留草稿/focus/IME 合同 |
| 任务详情 | `apps/web/src/page-task-detail.ts`, `apps/web/src/stream.ts` | 不改变 SSE 协议和缓存 key |
| DOM helpers | `apps/web/src/dom.ts` | 只在复用价值明确时扩展 helper |

## 3. 研发任务分解

### Epic A - 设计 token 与视觉基线

| ID | 任务 | 产出 | 验收 |
|---|---|---|---|
| A1 | 盘点现有颜色、surface、radius、shadow token 的使用点 | token mapping 表 | 明确哪些 token 保留、重命名、废弃 |
| A2 | 定义 Linear 风格 dark surface ladder 和 light fallback | CSS token diff | 深浅色模式均可读 |
| A3 | 收敛按钮、panel、badge、metric card 的半径/边框/阴影规则 | 组件样式更新 | 卡片主要靠 border/surface，而不是多层阴影 |
| A4 | 建立 AI stage 色票，不替代 good/warn/bad | stage token | 阶段色只用于 stage/timeline 组件 |

### Epic B - App Shell 改造

| ID | 任务 | 产出 | 验收 |
|---|---|---|---|
| B1 | 侧栏 active row 改为克制 indicator + surface lift | `renderSidebar` 样式调整 | 当前页面一眼可辨，badge 不抢主按钮 |
| B2 | 侧栏底部自动执行卡压缩为 status console | sidebar queue summary | 等待/执行/最近任务可扫描 |
| B3 | 顶栏 context strip 统一状态优先级 | topbar rendering | 每个页面只显示当前最相关状态 |
| B4 | 移动端侧栏和顶栏回归 | responsive CSS | 360px 宽度无横向溢出 |

### Epic C - 工作台信息层级

| ID | 任务 | 产出 | 验收 |
|---|---|---|---|
| C1 | 将待办提醒重构为 Action Queue | workbench action panel | 有待办时优先显示下一步动作 |
| C2 | 指标卡收敛为 Linear 风格 metric row | metric cards | 数字、标签、动作目标清晰 |
| C3 | 趋势图空数据改为空状态，不显示假趋势 | chart empty state | 无真实数据时不误导用户 |
| C4 | 执行环境异常提升，正常折叠 | environment panel | 异常可见，正常不占主视觉 |

### Epic D - 新建任务命令入口

| ID | 任务 | 产出 | 验收 |
|---|---|---|---|
| D1 | 表单布局改为 command composer | new task layout | 标题/详情输入优先，配置项次级 |
| D2 | 执行建议卡改成 recommendation row | recommendation UI | 推荐 flow、原因、覆盖入口可见 |
| D3 | readiness 提示合并为 submit guard | readiness UI | 缺项目/backend/runner 时阻止提交并给短提示 |
| D4 | 保留草稿、focus、IME、details 状态 | render hooks tests | polling render 不破坏输入 |

### Epic E - 任务详情 reviewer surface

| ID | 任务 | 产出 | 验收 |
|---|---|---|---|
| E1 | Next Action panel 成为任务详情第一优先级 | task detail layout | 等待确认时按钮和说明在首屏 |
| E2 | Stage Timeline 使用 AI stage pill | stage board | 阶段和结果状态互不混淆 |
| E3 | Evidence Summary 前置，raw diagnostics 后置 | evidence layout | 用户先看到验收证据，再看技术细节 |
| E4 | Agent Stream 默认 readable collapsed | stream panel | 标题/状态可见，原始日志不压过审批 |

### Epic F - 辅助页面统一

| ID | 任务 | 产出 | 验收 |
|---|---|---|---|
| F1 | 报告页改为 review inbox 语言 | reports layout | 失败/待确认/可验收优先 |
| F2 | 知识库按 lifecycle 状态分层 | knowledge layout | candidate 与 accepted 视觉层级不同 |
| F3 | 设置页诊断信息按正常/异常分层 | settings layout | 正常状态不制造噪音 |
| F4 | 项目接入改为 setup checklist | projects layout | 新用户知道下一步 |

### 推荐执行顺序

1. A1-A4：先建立 token 和组件基线。
2. B1-B4：改 shell，统一全局 chrome。
3. C1-C4：改工作台第一屏。
4. D1-D4：改新建任务入口。
5. E1-E4：改任务详情。
6. F1-F4：统一辅助页面。

每个 Epic 应单独提交，避免视觉大改难以回滚。

## 4. 回归测试验证

### 4.1 自动化检查

每轮实现至少运行：

```bash
bun run --filter @ainp/web typecheck
bun test apps/web/test
git diff --check
```

如果改到 shared 类型或 API DTO，再运行：

```bash
bun run typecheck
bun test
```

### 4.2 DOM / 单元测试矩阵

| 区域 | 必测点 | 建议测试 |
|---|---|---|
| Shell | active page、badge、collapsed sidebar、topbar context | `shell`/render helper DOM test |
| Workbench | 待办存在/不存在、runner 正常/异常、趋势空数据 | page-workbench DOM test |
| New Task | 草稿保留、focus restore、IME composition、readiness guard | 现有 new-task tests 扩展 |
| Task Detail | 等待审批、已审批等待继续、running 无 gate、stream collapsed | page-task-detail DOM test |
| Stream | compact/expanded 共用 cache，不新增 SSE | stream-rendering tests |
| Details | `data-details-key` 保留展开状态 | render-core/details tests |

### 4.3 视觉 smoke

建议使用本地 Web 服务检查：

```bash
bun run dev:web
```

检查页面：

- `/#workbench`
- `/#new-task`
- `/#my-todos`
- `/#reports`
- `/#knowledge`
- `/#projects`
- `/#settings`
- 任一任务详情页

视口：

- Desktop：1440x1000
- Tablet：1024x768
- Mobile：390x844

视觉断言：

- 无横向滚动。
- 主要按钮文字不溢出。
- badge、pill、metric 不重叠。
- 待办/action panel 在有待办时位于首屏。
- 深色和浅色模式都可读。
- 图表无数据时不显示伪造趋势。

### 4.4 回归风险与防护

| 风险 | 触发 | 防护 |
|---|---|---|
| token 改动影响全站 | CSS 变量覆盖关系复杂 | 先建 token mapping，逐组件替换 |
| 浅色模式退化 | 只按深色调样式 | 每个 token 必须有 light fallback |
| 输入草稿丢失 | new-task / coordinator render 改动 | 遵守 state-management 规范并加测试 |
| details 展开丢失 | 重构 panel key | 所有可展开技术细节加稳定 `data-details-key` |
| SSE 重复连接 | stream UI 重构 | compact/expanded 继续复用同一 cache |
| 状态色混淆 | stage 色替代结果色 | AI stage 和 good/warn/bad 分开命名 |
| 视觉过度营销化 | 套用 VoltAgent/landing 风格 | 保持工作台信息密度和任务优先 |

### 4.5 验收标准

- 工作台第一屏能在 5 秒内回答“我现在要处理什么”。
- 新建任务页能在不展开高级配置的情况下完成常规任务创建。
- 任务详情页等待确认时，确认/打回动作在首屏可见。
- 正常状态不噪音化，异常状态不被埋在折叠区。
- 所有主要页面在 desktop/tablet/mobile 无布局溢出。
- `@ainp/web` typecheck 和 Web 测试通过。

## 5. 后续任务建议

建议把实现拆成 3 个 Trellis 任务：

1. **Web 设计 token 与 shell 改造**
   - 覆盖 Epic A / B。
   - 目标是统一全局 chrome，不改页面业务结构。

2. **工作台与新建任务体验改造**
   - 覆盖 Epic C / D。
   - 目标是提升第一屏待办识别和任务创建效率。

3. **任务详情、报告、知识库 reviewer surface 改造**
   - 覆盖 Epic E / F。
   - 目标是强化人工确认、证据和知识生命周期的可读性。

每个任务都应独立通过 `@ainp/web` typecheck、Web tests、视觉 smoke，再进入下一个任务。
