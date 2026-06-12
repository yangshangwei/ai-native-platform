# PRD: web main.ts 基础层拆分（路线图 T2.1）

## 背景

`apps/web/src/main.ts` 7396 行、零测试，是全仓最大的巨石文件。完整职责地图与 9 步迁移方案见
`.trellis/tasks/archive/2026-06/06-11-architecture-review-and-refactor-for-simplicity-and-extensibility/research/web-architecture.md`（实施前必读）。
本任务只做其中 **步骤 1-4（基础层）**，为后续页面模块拆分（T2.2/T2.3）打地基。

## 硬性约束

- **纯搬移、不改逻辑**：main.ts 无测试，安全网只有 typecheck + 既有纯模块测试 + 冒烟。除"裸 let 收敛"外不允许任何改写；发现坏味道只记录到任务目录 notes.md，不顺手修。
- 遵守 `.trellis/spec/web/frontend/directory-structure.md`（不引入框架、平铺不嵌套、按 feature/概念分组）与 `state-management.md`（草稿/IME/disclosure 三大渲染契约必须保形，render() 对 coordinatorReplyComposing/knowledgeEditComposing 的特判原样保留）。
- 部署不变：serve.ts 按需 Bun.build 打包，入口仍是 `/src/main.ts`，import 会自动进 bundle。

## 范围（四步，每步独立可验证）

1. **types.ts**：搬出 main.ts 54-348 行的纯类型/DTO（约 30 个 interface/type）
2. **api.ts + dom.ts**：搬出 `api()` fetch 封装（422-429）与 DOM 工具 `el/icon/clear/fmtTime/shortId/pill/metric` 等纯函数（431-505 及散落的同类）
3. **state.ts**：搬出全局状态区（350-420）+ 状态选择器（672-777 的 selectedProject/latestRunner 等）。**唯一非纯搬移步**：约 17 个被跨模块读写的裸 `let`（activePage、lastError、knowledgeActiveView、streamES 等）必须收敛为状态对象属性（如 `ui.activePage`）——ES module 的 export let 是只读 live binding。机械全替换，单独成果（汇报中单列）。散落在文件中部的状态声明（retryInFlight:2631、coordinator 状态:4904-4964、settingsConfig:6316、stream 状态:7064-7073）本步只处理其中"被基础层函数引用"的部分，其余留在 main.ts 原位待 T2.2/T2.3 随页面搬走。
4. **render-core.ts + router.ts + data-loading.ts**：render() 与 capture/restore 机制（963-1097）、setHash/parseHash（778-803）、loadData/loadRunDetail/ensure*（805-961）。render/loadData 被各页面调用 63/24 次——它们放在被 import 的核心模块，页面代码（仍在 main.ts）单向 import，避免回调注入。

行号为研究报告快照值，以当前代码为准。main.ts 本任务结束后仍包含全部页面渲染代码——这是预期，不要试图一次拆完。

## 不做

- 任何页面模块拆分（T2.2/T2.3）
- DTO 与 shared 类型统一（T2.4）
- index.html 内联 CSS、serve.ts 改动

## 验收标准

1. `cd apps/web && bun x tsc -p tsconfig.json --noEmit` 通过；根 `bun run typecheck` 通过
2. `bun x --bun vitest run` 全绿（630 个）
3. 冒烟：起 api + web dev server，逐页打开 #workbench、#task、#projects、#new-task、#reports、#knowledge、#settings，浏览器 console 无新增错误
4. main.ts 行数显著下降（预计 -1500 行以上），新模块各有清晰的单一职责头注释（模式参照 settings-projection.ts:1-12）
