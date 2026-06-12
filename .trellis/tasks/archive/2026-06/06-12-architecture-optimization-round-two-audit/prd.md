# 架构优化路线图 v2（2026-06-12 二轮审计产出）

依据：本目录 research/ 四份报告（leftover-debt / robustness / performance / test-observability）。
v1 路线图（11 个任务）已全部完成；本路线图基于新基线。

## 执行顺序与任务拆分

### R1 安全与健壮性加固包（最高优先，小而关键）
- R1.1 web serve.ts 监听默认改 127.0.0.1（High：当前 0.0.0.0 + /api 反代 = 局域网可取明文凭证）
- R1.2 `includeSecret=1` 分支补内部契约注释 + 最低调用方标识（robustness #3）
- R1.3 agent CLI 超时 SIGTERM→SIGKILL 升级链（claude-code/codex/llm-fallback；顺带 command-runner 进程组 kill）
- R1.4 orchestrator worktree prepare 后的异常窗口纳入 finally（robustness #4）
- R1.5 `setKnowledgeArtifactStatus` 加合法迁移表 + WHERE 状态前置（与 claim 同模式）
- R1.6 agent stdout 事件入库前 maskSecrets；workflow-engine 头部固化"状态迁移禁中途 await"约定注释

### R2 CI 与测试地基
- R2.1 修 2 个依赖本机真实 claude 登录态的测试（CLI 探测 skip / env 开关）→ 新建最小 GitHub Actions（bun install + typecheck + vitest，~30s）
- R2.2 四包 test/ 纳入 typecheck（实测仅 32 处机械修、+6s；watch.test fixture 已发现真实契约漂移）
- R2.3 runner-control.ts 路由测试（168 行进程管理零测试）+ web stream.ts 重连/续传测试

### R3 性能（用户可感知项优先）
- R3.1 stream.ts SSE 增量渲染或合帧节流（真 O(n²)：4471 事件 run 的 history replay 全量重建）
- R3.2 轮询每 tick 双 render 改单次 + loadData 浅比较跳过无变化渲染
- R3.3 agent 事件 runner 侧微批（≤200ms 窗口，守住"实时流式"硬要求）+ API 批量入口事务包裹
- R3.4 defineTable 的 db.prepare → db.query；`GET /workflow-runs` 加 ?limit=（默认 100）+ agent_events 运维清理 SQL 文档化

### R4 契约与结构
- R4.1 wire 契约下沉 shared：11 个 api 私有影子（Approval/WorkflowAction/Runner/ContextGovernance/Config* 等）+ sidecar schema（ainp.requirement.v1 系列）三端统一（T2.4 显式续篇，notes.md 有完整清单）
- R4.2 SSE tail 两份拷贝抽取（与 R2.3 同任务：先补测后重构）
- R4.3 context/builder.ts 四模块拆分（runner 最后一个千行多职责文件）
- R4.4 projects.ts → git-source.ts（凭证拼装/脱敏代码出路由文件并补单测）
- R4.5 填充项：reports.ts knowledge-suggestions 拆出；index.html 750 行 CSS 外置；llm-fallback spawnCandidate 合并 cli-common

### R5 可观测性最小补强
- R5.1 runner logger 薄封装统一带 runId（77 处 console 仅 3 处带）+ 补 promote.file_write_failed / config_audit.mirror_failed 两个 audit kind + watch 循环周期心跳 + api-client 幂等 GET 单次重试

## 明确不做（审计结论）
- gate 规则彻底表化（已半表化，剩余是美学）；MapLike 双参 set 清理（churn>收益）；
  web 全树重渲模型改造（spec 契约，无卡顿证据不动）；自动 retention 调度器；引入重型日志/APM 框架。
