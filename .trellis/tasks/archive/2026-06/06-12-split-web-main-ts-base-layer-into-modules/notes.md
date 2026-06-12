# Notes: 拆分过程中发现的坏味道（只记录，不修）

记录人: implement agent（T2.1 基础层拆分）。以下问题在搬移过程中逐一确认存在，
按"纯搬移、不改逻辑"纪律全部原样保留。

1. **loadData 静默吞掉各端点错误**（`apps/web/src/data-loading.ts`，原 main.ts:806-820）：
   `/health`、`/runners`、`/workflow-requests`、`/workflow-runs`、`/runner/control/status`
   全部 `.catch(() => null / [])`，只有 `/projects` 的错误被保留到 `ui.projectsLoadError`。
   其余端点失败时 UI 无任何提示，数据看起来像"空"。

2. **data-loading 依赖导航状态**（`data-loading.ts` loadKnowledgeArtifacts 末尾）：
   `if (shouldRender && ui.activePage === 'knowledge') render()` —— 数据层反向感知
   当前页面。T2.2 拆知识页时应由调用方决定是否渲染。

3. **`agentBackendLabel` 现为 state.ts 内部专用**：搬移后 main.ts 不再引用它
   （只被 `agentBackendContextLabel` 调用），但按原结构仍 export。页面拆完后可收敛。

4. **`KnowledgeSuggestionItem` 是知识页专属视图类型**，却躺在跨页 DTO 文件
   `types.ts` 里（原 main.ts:332-339 就如此）。T2.2 拆知识页时应随页面走。

5. **ConfigEntryDto/ConfigOverrideDto/ConfigAuditDto 仍在 main.ts（~6010 行附近）**，
   与 `settings-projection.ts:16-42` 的 ProjectionConfigEntry/Override/Audit 形状平行
   重复（研究报告 §5.7 已记录，T2.4 范围）。

6. **errorMessage(err) 之外仍有裸 catch 模式残留**：mutation 动作区（submitApproval
   等四个函数）结构逐行雷同（研究报告 §5.4），本次未触碰。

7. **临时注册点脚手架**：`render-core.setRenderHooks`（5 个回调）与
   `data-loading.setStreamHooks`（2 个回调）是本步引入的过渡接缝，
   T2.2（页面模块化）与 T2.3（stream 拆分）完成后应改为直接 import 并删除。

8. **`statusKind()` 的状态词表是领域知识**（'awaiting_clarification'、'claimed' 等），
   却以纯函数身份进了 dom.ts（判定标准是"不引用模块级可变状态"，它符合）。
   语义上更接近领域文案层，后续可与 requestStatusLabel 等一起归位。

9. **types.ts 内部留有原文件的双空行/注释痕迹**（如 ProjectDto 后双空行、
   WorkflowRequestDto 内的 V2 W2 注释），按"逐字搬移"保留，未做格式化。
