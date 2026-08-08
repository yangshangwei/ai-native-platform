# UMADEV 与 AI Native Platform 设计实现对比研究

## Goal

基于 UMADEV `main` 分支的真实代码与文档，对照本项目当前实现，识别可直接吸收、需要改造后吸收、以及不适合当前阶段引入的设计做法，为后续产品和架构决策提供可回溯证据。

## What I already know

* 对比对象是 <https://github.com/umacloud/umadev/tree/main>。
* 用户关注的不只是功能清单，而是“设计实现”层面的可借鉴点。
* 本项目是包含 `apps/api`、`apps/runner`、`apps/web` 与 `packages/shared` 的多包系统。
* 研究结论需要同时覆盖产品工作流、前端交互、后端/运行时架构、扩展性与安全边界。

## Assumptions (temporary)

* 以两个仓库在 2026-07-31 复核时可获取的固定 commit 为比较基准。
* “可吸收借鉴”按本项目适配价值排序，而不是简单评价哪一方更先进。
* 用户本轮需要研究结论与建议，不要求直接修改产品代码。

## Open Questions

* 无阻塞问题；先做全栈横向对比，结论中明确不同优先级和适用前提。

## Requirements

* 梳理 UMADEV 的产品定位、关键用户路径、模块边界和核心运行机制。
* 梳理本项目对应的现有能力与约束，避免把已有能力误报为缺口。
* 每项关键结论必须能回溯到仓库文件和行号，必要时补充提交版本。
* 输出“借鉴点 → 本项目现状 → 适配建议 → 价值/成本/风险 → 优先级”的对照。
* 明确列出不建议照搬的设计及理由。

## Acceptance Criteria

* [x] UMADEV 与本项目各自有一份基于代码的结构化研究记录。
* [x] 关键结论至少覆盖产品交互、执行架构、上下文/会话、扩展机制、安全与可观测性。
* [x] 形成按 P0/P1/P2 分级的借鉴清单，并区分快速收益与中长期方向。
* [x] 每个优先建议都有本项目落点，不停留在泛化最佳实践。
* [x] 记录比较基准 commit，避免结论随上游变化失去语境。

## Definition of Done

* 研究材料已保存到任务目录。
* 结论中的文件路径与行号已抽样复核。
* 最终答复说明已验证事实、推断、以及仍存在的不确定性。

## Out of Scope

* 不在本轮修改业务代码或引入新依赖。
* 不做性能压测、部署验证或完整安全审计。
* 不以 UI 外观相似度作为主要比较标准。

## Technical Approach

将研究拆为三条独立证据链：UMADEV 架构与运行时、UMADEV 产品/交互、本项目现状。完成后按相同维度交叉映射，由主线程复核代表性源码与证据，再形成适配建议。

## Research References

* `research/umadev-architecture.md` — UMADEV 架构、执行模型、扩展和安全边界。
* `research/umadev-product-ux.md` — UMADEV 产品工作流、前端交互和信息架构。
* `research/ainp-current-design.md` — 本项目对应能力、模块边界和已有设计。
* `research/comparison.md` — 交叉对比与借鉴优先级。

## Decision (ADR-lite)

**Context**: 两个项目的定位和成熟度可能不同，按功能数量做横向表格会产生误导。

**Decision**: 以用户任务闭环和关键架构机制为比较单元，所有建议都映射到本项目现有代码落点，并同时评估收益、适配成本与风险。

**Consequences**: 结论更适合指导本项目演进，但不会试图穷举 UMADEV 的每个文件或功能。

## Technical Notes

* `cs-explore` 默认要求归档到 `codestable/compound/`，本仓库未采用该目录；研究证据改存 Trellis 任务目录。
* 外部仓库研究应记录 `git rev-parse HEAD`，本地研究记录当前 `HEAD`。


## Research Status

* Completed 2026-07-31
* UMADEV commit: `b7484379db8ef7fa1881c84e7e9252c85c60061c` (`v1.0.71`)
* AINP commit: `21b8539646af2eec3d43a296eec48a735b272631`
* Revision note: the first draft used UMADEV `71f1464` and was superseded after `main` advanced by 158 files; the final research also corrects false AINP gaps for Graph Runtime, acceptance coverage, hybrid retrieval, cold review, and handoff.
* Artifacts:
  * `research/umadev-architecture.md`
  * `research/umadev-product-ux.md`
  * `research/ainp-current-design.md`
  * `research/comparison.md`
