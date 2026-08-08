# UMADEV × AI Native Platform 交叉对比

- UMADEV: `b7484379db8ef7fa1881c84e7e9252c85c60061c` (`v1.0.71`)
- AINP: `21b8539646af2eec3d43a296eec48a735b272631`
- Date: 2026-07-31

## 速答

不要搬 UMADEV 的产品壳，也不要重建 AINP 已有的 graph ledger、typed AC matrix 或 hybrid code retrieval。最值得吸收的是 UMADEV 对**单次运行的执行合同、可见协作和诚实恢复**：

1. 先补齐 AINP GraphRun 完成态收敛，再把既有 node/event ledger 暴露为 live run view。
2. 把自由文本 review 变成 typed verdict，明确 blocker、remediation、evidence、provenance、unavailable。
3. 把“只有 implementation 能改 workspace”从约定变成执行时硬约束，并加入 scope-creep 对偶检查。
4. 给 Graph node 填写具体 EvidenceContract，并在上游 artifact 变化时失效下游证据。
5. 先让手动修复消费 remediation，再用现有 attempt/checkpoint/manual-resume 基础做确定性、有界自动返工。
6. 把 artifact/log/diff 的 bounded I/O、redaction、atomic persistence 收敛到统一边界。

两边的合理关系是：

- UMADEV 提供“单仓 Agent 运行纪律”的参考实现。
- AINP 继续做“多项目交付控制面”，把这些纪律挂到既有 Graph、Gate、Handoff、ContextPack、Approval 和 Evidence ledger 上。

## 修正后的对照总表

| 维度 | UMADEV | AINP 现状 | 准确判断 |
|---|---|---|---|
| 产品形态 | 单仓 TUI coding-agent host | Web + API + Local Runner 多项目工作台 | 保留 AINP 形态，只吸收运行纪律 |
| 执行图 | Host-owned run-specific DAG + typed evidence | durable ledger + 线性 edge-mode 调度；policy/aggregate status 未闭环 | 不重建 ledger；先补 runtime 语义，再做 run-specific authoring |
| 计划 UI | 扁平 live checklist + 完整 `/plan` | stage timeline；API graph 未进入 Web type | 从 node runs 派生可靠视图，不建第二 plan artifact |
| 写/审隔离 | RunLock 单写者 + 只读 reviewer fork | review 是 fresh CLI，但仍有 workspace 写权限 | cold 已有，hard single-writer 缺失 |
| 评审协议 | `RoleVerdict` + unavailable/remediation/provenance | Gate RuleResult 已 typed；review artifact 仍 free text | 补 ReviewerVerdict，复用 EvidenceRef/GateRun |
| Acceptance | step evidence + coverage + runtime proof | typed matrix + ID/scenario gate；逐 AC proof 偏启发式 | 不重建；硬化 criterion-specific evidence |
| API contract | OpenAPI derivation/validation | 无通用 OpenAPI/项目 contract gate | 仅 contract adapter 是真实缺口 |
| 失败恢复 | 分域上限、review outage 独立暂停、frozen plan | operational pause + checkpoint + manual retry | 复用 pause；补 review unavailable 和 bounded repair |
| Artifact freshness | 上游版本变化传播到下游 | 有 sha/sourceRefs，但无 run 内统一失效传播 | P1 补 consumed digest + stale propagation |
| 检索 | BM25 + local semantic vector + RRF | BM25 + embedding hybrid code retrieval 已落地 | 不重建；只深化知识召回/真实本地语义质量 |
| 安全持久化 | bounded/no-follow/atomic/redacted | stream masking 有，artifact/log/diff 边界分散 | 统一 persistence boundary |
| Backend 适配 | capability-driven five-backend host | 两 backend，接口只有 `run()` | P2 增加 capability snapshot，不急着扩 provider |

## 建议优先级

### P0-1. Graph Live View，先把已有能力露出来

**AINP 现状**

- GraphDefinition/GraphRun/GraphNodeRun/GraphEvent 已持久化并驱动线性 stage 调度。
- node policy 尚未由生产 scheduler enforce，GraphRun 成功态也未收敛。
- API detail 已返回 `graph`。
- Web `RunDetail` 丢掉该字段，用户只能看到 stage timeline。

**适配建议**

- 先让 GraphRun 在全部 node 完成时收敛到 passed/blocked，或明确从 node runs 派生 aggregate read model。
- 再给 Web DTO/projection 补 graph。
- 顶部只显示 active node、done/total、attempt、首要 blocker、resume 状态。
- 详情区再展示依赖、events、checkpoint 和 evidence。
- 节点 owner 只来自真实 AgentSession/Handoff，避免装饰性团队 roster。

**价值 / 成本 / 风险**

- 价值：高，立刻降低“AI 在黑箱里跑”的感受。
- 成本：中；先补 aggregate semantics，再做只读 projection。
- 风险：中；node ledger 是事实，但当前 GraphRun aggregate status 还不是完整真相。
- 禁忌：不要新建 `execution_plan` artifact 作为第二真相。

### P0-2. Typed ReviewerVerdict + 可行动 Gate

**AINP 现状**

- `RuleResult` 已有 status/message/evidence。
- VerifierAcMatrix 已结构化。
- review agent 仍只写 Markdown，AgentResult 只有 summary，UI 在关键位置不显示 rule message。

**适配建议**

- 定义 `ainp.review_verdict.v1`：`role/status/blocking/remediation/advisory/evidenceRefs/provenance/contextPolicy`。
- `status` 至少含 `pass/fail/unavailable`；`unavailable` 映射现有 operational pause。
- Runner 严格解析；GateEngine 只校验 schema、证据和策略，Agent 不能直接设置 GateRun pass。
- Gate 主操作区先显示现有 rule message；随后展示首 blocker + fix + evidence。
- 收紧 `isAcceptanceReviewArtifact()`，只接受明确 schema/kind。

**价值 / 成本 / 风险**

- 价值：高，人工审批从“看红绿灯”变成“带证据决策”。
- 成本：中。
- 风险：中；必须保持 GateEngine 的唯一判定权。

### P0-3. ExecutionContract + 硬单写者

**AINP 现状**

- review skill 声明 `writableGlobs=[]`，但 backend sandbox 没有执行这个约束。
- Codex review 仍是 `workspace-write`，Claude review 仍允许 `Write`。

**适配建议**

- Graph mutating node 声明 allowed paths、max changed files、expected outputs。
- review/debug/verifier 默认 `workspaceMutationPolicy=deny`。
- reviewer 执行前后比较 workspace fingerprint；出现 delta 立即失败并记录 evidence。
- 长期把 reviewer 输出收敛到受控 JSON/sidecar 通道，按 backend capability 选择真正只读 profile。
- 同时检查 scope creep：不仅查“需求没做”，也查“多改了未声明文件/依赖/路由”。

**价值 / 成本 / 风险**

- 价值：高，修复多 Agent 最危险的共享 workspace 失控面。
- 成本：中。
- 风险：中；artifact 输出路径要与 workspace deny 策略解耦。

### P1-1. Graph node EvidenceContract + artifact freshness

**AINP 现状**

- Graph node 的 inputSelectors/outputNames 为空。
- 已有 Artifact sha256、StepCheckpoint、ContextPack sourceRefs、Handoff producedArtifacts。
- 缺 node 实际消费版本和 downstream stale propagation。

**适配建议**

- 为 node 声明 required input digests、expected outputs、对应 Gate/Command/AC 证据。
- StepCheckpoint 记录实际消费 artifact id + sha256。
- 上游 artifact 变化后，将所有消费者及 downstream 标 stale/ready，保留旧证据但不继续放行。
- 将 AC row 绑定到 criterion-specific command/test/runtime evidence，替换当前通用 artifact + 文本启发式 pass。
- EvidenceContract 优先复用现有 GateRun、CommandRun、VerifierAcMatrix，不自研第二套 verifier。

**价值 / 成本 / 风险**

- 价值：高，解决恢复和人工改稿后的旧证据污染。
- 成本：中高。
- 风险：中；要先定义历史 run 的兼容语义。

### P1-2. Remediation consumer + 有界自动返工

**AINP 现状**

- Graph 有 attempt/checkpoint/manual resume，类型层声明 retry policy，UI 有 manual retry，operational pause 已存在。
- 当前没有自动 repair loop；approval rejection feedback 尚未成为稳定 consumer contract。

**适配建议**

1. 先让 manual retry 的 ContextPack 消费 typed remediation 和原 evidence。
2. 再为 `compile/test/review` 的确定性 blocker 构造最小 repair 子图：implementation -> build_test -> review。
3. 默认最多 2 次，记录 no-progress fingerprint，源码/证据未变化即停。
4. backend unavailable/protocol/timeout 进入 paused，不计产品返工。
5. sensitive change、human rejection、knowledge gate 永不自动循环。

**价值 / 成本 / 风险**

- 价值：中高，减少人工点 retry 和重复诊断。
- 成本：高，不是简单重跑失败 node。
- 风险：高；预算、幂等、敏感变更和人审边界都要同时成立。

### P1-3. 统一持久化安全边界

**AINP 现状**

- agent stream 和 preflight 会 mask secrets。
- command logs、git diff、部分 artifact/report 仍原样写盘。
- artifact content 读取有 root realpath 校验，但无统一 size/no-follow/identity-stability 合同。

**适配建议**

- 抽一个平台级 persistence boundary，统一 bounded read、atomic write、path containment、no-follow/identity check 和 digest。
- 明确 raw evidence 与 redacted operator view 的关系；安全审计需要保真时，不要悄悄覆盖原证据。
- 至少保证 UI/API 返回和可分享 proof 中不泄漏凭据。

**价值 / 成本 / 风险**

- 价值：高，尤其在接入不受信仓库或远程 Runner 前。
- 成本：中高。
- 风险：中；redaction 会影响 digest 与法证语义，必须先定数据合同。

### P2-1. Backend capability contract

- 给 AgentBackend 增加 capability snapshot：fresh/cold、resume、read-only profile、plan events、interactive questions、permission surface、usage accuracy。
- 调度器按能力选择策略并显式降级，AgentSession 持久化实际能力。
- 先覆盖 Claude Code/Codex；不要因为 UMADEV 有五底座就立即扩 provider。

### P2-2. 运行中输入分流

- 为 running request chat 增加显式 `steer / question / next-task`。
- question 永不改变 plan/gate；steer 只在安全边界进入新 graph version；next-task 进入独立 request FIFO。
- 这是高价值 UX，但需要 Graph version、审计和权限合同先成熟。

### P2-3. 检索只深化薄弱面

- 代码检索已经是 hybrid，不重建。
- 可评估：真实本地语义模型、知识 artifact 的 BM25/vector 召回、usefulness feedback、degradation telemetry。
- 不建议默认下载 UMADEV 同类的大模型资产；先用离线评测证明收益。

## 不建议照搬

1. **Rust 单二进制 / TUI 替代 Web-API-Runner。** 会丢掉 AINP 的多项目、审批、证据浏览和知识治理。
2. **固定八角色团队。** 两边都应按任务深度裁剪；只展示真实被调度角色。
3. **让模型 accepts 直接等于 gate pass。** ReviewerVerdict 是证据/意见，GateEngine 仍负责状态。
4. **第二份 execution-plan artifact。** 先补 Graph 完成态语义，再直接显示既有 node/event ledger。
5. **重新实现整套 acceptance coverage 或 hybrid code retrieval。** AINP 已有 substrate；应硬化逐 AC proof 和知识召回薄弱面。
6. **所有治理一律 fail-open。** 不可逆安全项必须 fail-safe；可修复质量规则才允许降级后返工。
7. **立即支持五个 backend。** UMADEV 为此承担了大量协议、恢复、权限和跨平台复杂度，AINP 当前收益不足。
8. **把 TUI 的 advisory `/plan` 误当成事务式 DAG 编辑。** AINP 若提供计划修改，必须显示生效状态和 graph version。

## 建议 90 天顺序

### Wave A：把已有事实变得可见、可行动（2-3 周）

1. 修正 GraphRun aggregate status，随后 Web 只读显示 active node/attempt/blocker/resume。
2. 关键 Gate 区域显示已有 rule message/evidence。
3. `ReviewerVerdict` schema、严格解析和 review artifact 识别。
4. reviewer workspace delta guard，先把单写者变成可测试不变量。

### Wave B：把节点变成可验证合同（3-5 周）

1. ExecutionContract / expected outputs / scope-creep gate。
2. node consumed artifact digest + EvidenceContract。
3. upstream change -> downstream stale propagation。
4. review unavailable -> 现有 operational pause 的端到端收口。

### Wave C：自动化与安全深化（5-8 周）

1. manual repair 消费 remediation，再开 deterministic bounded rework。
2. 项目级 contract command + digest-backed contract gate；不先自研多语言 OpenAPI parser。
3. 统一 artifact/log/diff persistence 与 redacted operator view。
4. Backend capability 和运行中输入分流分别做 RFC；按依赖成熟度落地。

## 判断标准

一个借鉴项值得进入 AINP，当且仅当：

1. 挂到现有 GraphRun / GateRun / Handoff / ContextPack / Approval / Artifact 上。
2. 不让 Agent 绕过 GateEngine 或 human gate。
3. 不制造第二套 plan、retry、evidence 或 knowledge 真相。
4. 对用户可见、可解释、可恢复，而不是只增加后台抽象。
5. 对 fast path 可以降级，且 operational outage 不被误当产品返工。

## 风险与不确定性

- 未实机运行 UMADEV；交互手感来自源码状态机和文档，不是可用性测试。
- 90 天估算是依赖顺序，不是承诺工期；AINP 的测试/迁移成本需要单独拆解。
- AINP 当前是本地可信模式；若产品边界保持不变，持久化安全加固可晚于 Graph/Review，但不能晚于远程 Runner 或不受信仓库扩张。

## Verification

- Fixed UMADEV benchmark at `b7484379db8ef7fa1881c84e7e9252c85c60061c` and AINP at `21b8539646af2eec3d43a296eec48a735b272631`.
- Independently audited UMADEV architecture, UMADEV UX, and AINP implementation.
- Corrected the earlier false gaps for Graph Runtime, acceptance coverage, hybrid code retrieval, cold review, and handoff.
- Spot-checked representative source line references on 2026-07-31.
