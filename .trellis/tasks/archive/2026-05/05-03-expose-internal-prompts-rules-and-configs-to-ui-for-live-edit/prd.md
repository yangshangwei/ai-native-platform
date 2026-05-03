# Expose internal prompts, rules and configs to UI for live edit

## Goal

让 ai-native-platform 当前**硬编码在 runner / api 源码里**的 prompts、规则、阈值在 5173 web UI 上**可见 + 可改 + 实时生效**，目的是把"AI 软件交付工作台"内部的方案细节透明化，方便在不重启 / 不重新编译的前提下迭代 prompt 与规则。

不是要做一个面向最终用户的产品配置中心，而是给平台 owner（先服务"我"自己）一个"调试 + 演示 + 调优"的工作台。

## What I already know

### 当前"硬编码景观"（共 5 类，性质不同）

| 类 | 例子（文件:行） | 类型 | 估计大小 | 改动风险 |
|---|---|---|---|---|
| **① Coordinator 调优物** | `apps/runner/src/agents/coordinator/rules.ts:32-83`（BUG/FEATURE/LARGE_SCOPE 关键词数组）；`coordinator/index.ts:18`（`RULE_CONFIDENCE_THRESHOLD=0.65`）；`coordinator/prompt.ts:9-36`（system prompt）；`rules.ts` 里若干硬编码兜底 question 字符串 | 关键词数组 + 数值阈值 + 长 markdown prompt + 字符串模板 | 几 KB | 低 |
| **② SkillSpec 方法论 prompt** | `apps/runner/src/skills/index.ts:14-211` 的 5 个 SkillSpec 中 `instructions` 字段（context_pack / requirement_draft / design / implementation / review） | 长 markdown（每个 1-3 KB） | ~10 KB 总 | 中（影响产物质量但可重跑） |
| **③ SkillSpec 结构契约** | 同上文件的 `inputs` / `outputs` / `requiredGates` / `toolPolicy.writableGlobs` / `compatibleBackends` | 结构化对象 | 小但关键 | **高**（写错 writableGlobs = 安全洞） |
| **④ Gate 规则** | `apps/api/src/gate-engine.ts`（19 KB）里的 regex 字面量、章节存在性检查、frontmatter 校验 | 嵌入在 TS 代码逻辑里 | ~19 KB（含逻辑） | 中（逻辑性，不只是数据） |
| **⑤ 运行时阈值** | `coordinator/llm-fallback.ts:17`（`ONESHOT_TIMEOUT_MS=30s`）；`apps/runner/src/cmd/watch.ts:127`（`pollMs=2_000`）；`apps/runner/src/config.ts`（`DEFAULT_TIMEOUT_MS` / `DEFAULT_MAX_LOG_BYTES` / `WORKTREES_DIR`）；orchestrator 里的 mvn 命令模板等 | 数字 / 字符串 / 模板 | 小 | 中 |

### 当前架构（决定方案约束）

- **API 是唯一 state writer**（`apps/api/src/workflow-engine.ts`）；store 是 SQLite（`apps/api/src/store/`）
- **Runner watch 轮询**已经在每 2s 调 `GET /workflow-requests?status=pending` —— **同一个 poll 周期里加一个 config GET 几乎零成本**
- **Web 是单文件 plain TS**（`apps/web/src/main.ts` ~130 KB），用 `el(tag, attrs)` helper 直接构 DOM；没有 React/Vue/Svelte
- 配置目前在 runner 启动时通过 `import` 硬编码加载；**没有任何 runtime config 层**
- 项目记忆指令：「Local Runner + Git worktree + host JDK/Maven/Git；不上 Docker/K8s/microVM/tool-policy 沙箱」——意味着 ③ 的 toolPolicy 即使能改也无法被强制执行，只有提示作用

### 设计层面的关键观察

1. ① 和 ⑤ 是**纯数据**（dict / 数字 / 字符串），抽出来最容易、改起来最安全
2. ② 是**长 markdown prompt**，抽出来不难（变成 DB 一行一字段），但 UI 需要 markdown 编辑器
3. ③ 是**结构化数据**，可以 schema-driven 表单，但 `writableGlobs` 改错会让 implementation 阶段写到 worktree 之外
4. ④ 最难——`gate-engine.ts` 里 regex **嵌在 if/else 控制流里**，不是单纯数据，要么搞个小 DSL、要么把 gate 拆成"参数化 gate" + "代码 gate"
5. **5 类放进同一个工程是错的**——MVP 应该从最容易最高价值的开始

## Assumptions (temporary)

> 以下假设需要在第一轮回答里被用户确认或推翻。

- **A1**：先服务 platform owner 自己（单用户 MVP），不做 RBAC / 多租户
- **A2**：「实时生效」= 下一个 workflow run 看到新值（**不**热替换正在跑的 run），实现就是 runner 在每个 stage 开始前重新 fetch config
- **A3**：保留代码里的硬编码作为 **default / fallback**，DB 里只存"覆盖项 (override)"——这样：
  - 默认值仍受 git 版本控制（不会被改坏丢失）
  - "Reset to default" 是一键操作（删 override 即可）
  - 可视化"哪些值被改过"很简单
- **A4**：MVP 范围 = **类 ① + 类 ⑤**（共 ~3 KB 数据，全是 scalar / array），不碰 ②③④（这些后续阶段做）
- **A5**：Schema 不引入 React/Vue 框架，**手搓 per-shape form**；如果引入库，仅考虑 `zod`（树摇友好、TS-first）做 runtime 校验
- **A6**：override 范围只做 `global`（不分 project / run），数据模型上预留 `scope` 字段以备未来分层
- **A7**：所有 override 都走 audit log，可回滚到任意历史版本

## Open Questions

> 严格遵循 trellis-brainstorm "one question per message"，仅保留 blocking / preference 问题。

### Q1（Blocking）：MVP 范围 — ✅ RESOLVED → **MVP-M**

> 用户选择 MVP-M：覆盖类 ① + ② + ⑤
> 范围 = Coordinator 调优物 + SkillSpec 长 prompt 编辑 + 运行时阈值
> 不含：③ 结构化字段、④ Gate 规则
> 估时 ~1 周；长 prompt 用原生 textarea（D3 决议）

### Q2（Blocking）：Override 生效语义 — ✅ RESOLVED → **A. 直接生效**

> 用户选择 A：UI 改 → API PUT → DB 立即写 → runner 下次 poll（≤2s）拿到新值。
> 数据模型保持单列 `value_json`；客户端用显式 [Save] 按钮（非失焦自动保存）做"人肉 publish"防护。
> Audit log + 一键 revert 已覆盖"改错了怎么办"场景（R5 / AC6）。

### Q3（Blocking）：长 prompt 编辑器 widget — ✅ RESOLVED → **A. 纯 textarea + autosize**

> 用户选择 A：长 prompt 字段（SkillSpec.instructions / Coordinator system prompt / 兜底 questions）使用原生 `<textarea>` + 自动撑高，不引入 markdown 编辑器。
> AC9 验证 byte-for-byte 保真；textarea 是天然候选。
> 留升级位：将来若需高亮 / 折叠 / 查找替换，可换 CodeMirror 6（widget 接口隔离，零数据迁移）。

### Q4（Blocking）：Override 数组语义 — ✅ RESOLVED → **C. 替换 + 继承提示**

> 用户选择 C：存储用 A（替换全数组）的简单语义；UI 上加便利（编辑框预填当前生效值 + [复制默认值到编辑框] + Reset）。
> 数据模型保持单列 `value_json`，runtime 取值 `JSON.parse(value_json) ?? default`。

### Q5-Q7（Blocking）：缓存策略 / 失败模式 / UI 编排 / 字段清单 — ✅ RESOLVED 按 AI 推荐（用户授权）

详见 Decision 节 D4/D5/D6/D7。具体决议：
- **Q5 字段清单 v1** → 见下方 "Config Registry — v1 fields"，24 个 key（① 14 + ② 5 + ⑤ 5；cache_ttl 已计入 runtime tab）
- **Q6 缓存 + 失败** → cache TTL 1500ms（略短于 watch poll 2s）；启动 API 不通用 default 启动 + warn；运行中 API 暂时不通用 stale-while-revalidate（保最后成功值不抖动）
- **Q7 UI 编排** → 顶级 `#settings` 路由；按 category 分 3 tab（Coordinator / SkillSpec Prompts / Runtime）；列表+详情两段式；历史折叠在每行

## Research References

> 三个 sub-agent research 因上游 API 500 暂未启动，待主对话恢复后重派：
>
> - [ ] `research/prompt-management-ui-patterns.md` — LangSmith / Langfuse / PromptLayer / OpenAI Playground / Dust / Helicone 的 prompt UI 模式
> - [ ] `research/runtime-config-override-patterns.md` — LaunchDarkly / Unleash / Spring Cloud Config / Consul / AWS AppConfig 的 layered override + hot reload
> - [ ] `research/schema-driven-form-libraries.md` — JSON Schema → form 在 plain-TS 场景的可行性
>
> Q1 收敛后视范围决定哪些主题真的需要研究（MVP-X/S 几乎不需要研究，MVP-M/L/XL 需要）。

## Requirements (final)

- **R1**：Web UI 新增 "Settings → Runtime Config" 面板，按类分组展示当前所有可调项（① + ⑤ 范围）
- **R2**：每项展示三栏：`默认值`（来自代码）/ `当前生效值`（默认 ⊕ override）/ `编辑`
- **R3**：编辑后立即 PUT API；下一次 runner poll cycle（≤2s）即生效
- **R4**：每个 override 项可"reset to default"（删 override 行）
- **R5**：所有变更进 audit table，UI 可看历史 + 一键回滚
- **R6**：runner 端"取值函数"统一封装（`getConfig('coordinator.confidence_threshold')`），所有原硬编码引用替换为该函数
- **R7**：API 启动时读 SQLite 里的 override，runner 启动时**不**强依赖 API（API 不可达时回退到代码默认，不阻断启动）
- **R8**：5 个 SkillSpec 的 `instructions` 字段（context_pack / requirement_draft / design / implementation / review）支持 UI 编辑；底层与 ① ⑤ 共用同一个 `config_overrides` 表，key 形如 `skill.requirement_draft.instructions`
- **R9**：长 prompt 字段使用 `<textarea>` + autosize（D3 决议，无 markdown 编辑器）；列表展示前 200 字摘要，点击进入详情全文编辑
- **R10**：SkillSpec instructions 之外的字段（id / version / inputs / outputs / requiredGates / toolPolicy / compatibleBackends）**不在 MVP 范围**——UI 应只读展示，不开放编辑（防误操作 ③ 结构契约）
- **R11**：数组型 override（`bug_keywords` 等）UI 编辑框预填当前生效值；旁边 [复制默认值到编辑框] 按钮；保存时整段替换（D4 决议）
- **R12**：runner 端 config cache TTL = 1500ms（略短于 watch poll 2s）；启动时 API 不通 → 用代码默认 + warn 不阻断；运行中 API 暂时不通 → stale-while-revalidate 保最后成功值
- **R13**：UI 路由 `#settings`（顶级），按 `category` 分 3 tab：`coordinator` / `skill_prompts` / `runtime`；任务详情页不嵌入 settings（避免冲突）

## Acceptance Criteria (evolving)

- [ ] AC1: 在 5173 UI 改 `RULE_CONFIDENCE_THRESHOLD` 从 0.65 到 0.5，下一个 workflow request 的 Coordinator decision 用 0.5 阈值（可在 audit log 里看到 source = override）
- [ ] AC2: 在 5173 UI 给 `BUG_KEYWORDS` 加一个新关键词 "panic"，包含 "panic" 的请求被分诊为 bugfix（confidence ≥ 0.65）
- [ ] AC3: 在 UI 改 `ONESHOT_TIMEOUT_MS` 从 30s 到 5s，下次走 LLM 兜底的请求 5s 后 timeout（在 audit 里能看到值为 5000）
- [ ] AC4: 删除某个 override，下一次 runner 周期回到代码默认值
- [ ] AC5: API 不可达时启动 runner，runner 用代码默认值正常工作（不 crash，但 log warn）
- [ ] AC6: 改 override 后 UI 历史 panel 立即出现新条目，包含旧值 / 新值 / 时间戳
- [ ] AC7: 在 5173 UI 把 `skill.requirement_draft.instructions` 的某段方法论文本改写并保存，下一个 workflow run 的 requirement 阶段产出体现新文案
- [ ] AC8: SkillSpec 详情页可只读展示 `inputs` / `outputs` / `requiredGates` / `toolPolicy`（不可编辑），并附"如需修改请走代码 PR"提示
- [ ] AC9: 长 prompt 编辑器支持 ≥ 3KB 文本无截断、保留 LF 换行、保存后再次打开内容不变（无格式漂移）
- [ ] AC10: 数组型 override 在 UI 编辑框默认显示当前生效值；点 [复制默认值到编辑框] 后内容被默认值替换
- [ ] AC11: 启动 runner 时 API 已死，runner 用代码默认值正常处理 1 个 workflow request；API 恢复后第一次 poll 周期内能拉到 override
- [ ] AC12: 在 5173 改 override 后 1.5-2.0s 内 runner 看到新值；测量方式 = `console.log(getConfig(...))` 在 stage 起点打印
- [ ] AC13: UI `#settings` 路由可独立访问（直接打开 URL hash 命中），返回主页不影响 task 状态

## Definition of Done

- 单元测试覆盖 `getConfig` 五种情况：override 命中 / override 缺失 / API 不可达 / cache hit / stale-while-revalidate
- API 端 vitest 覆盖 PUT/GET/DELETE override + GET registry + GET audit 接口的 happy path + 校验失败
- Web 端用 e2e-via-watch 风格的脚本验证 AC1 / AC4 / AC7 跑得通
- `apps/runner/src/agents/coordinator/{rules,index,prompt,llm-fallback}.ts` 与 `apps/runner/src/skills/index.ts` 中所有原硬编码点替换为 `getConfig` / 异步注入
- `.trellis/spec/runtime-config-layer.md` 新增：覆盖语义、新加配置项的步骤、字段命名规则
- 24 keys 全部在 `packages/shared/src/config/registry.ts` 中声明 + 自动测试覆盖（每个 key 有 default 且 type 正确；锁定常量 `CONFIG_REGISTRY_KEY_COUNT = 24`）
- `npm test` / typecheck / lint 全过

## Out of Scope (explicit MVP)

- ❌ 多用户 RBAC（platform owner 单用户起步）
- ❌ Project 级 / per-run override（数据模型预留 `scope` 字段，不实现 UI / runtime 分层）
- ✅ 类 ② SkillSpec 长 prompt 编辑（Q1 已决议：纳入 MVP-M）
- ❌ 类 ③ 结构化字段（writableGlobs / inputs / outputs）— 涉及安全边界，单独立项
- ❌ 类 ④ Gate 规则改造 — 需要先把 gate-engine.ts 拆成 data + interpreter，单独立项
- ❌ Override 的"草稿 / 发布"双态（Q2 已决议：v1 直接生效；audit + revert 覆盖回滚）
- ❌ Override diff 视图 / 多分支 / A-B 实验（v1 只做 audit log + revert）
- ❌ 远程多人协作（本地单机，无需 OT/CRDT）

## Technical Approach (final)

### 数据模型（SQLite）

```sql
-- 单表 + 简单 audit
CREATE TABLE config_overrides (
  key TEXT PRIMARY KEY,        -- "coordinator.confidence_threshold"
  scope TEXT NOT NULL DEFAULT 'global',  -- 预留 'project:xxx' / 'run:xxx'
  value_json TEXT NOT NULL,    -- 序列化后的值
  updated_at TEXT NOT NULL,
  updated_by TEXT              -- 单用户暂留 'system'
);

CREATE TABLE config_audit (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  old_value_json TEXT,
  new_value_json TEXT,
  changed_at TEXT NOT NULL,
  changed_by TEXT
);
```

### 配置注册表（packages/shared）

```ts
// packages/shared/src/config/registry.ts
export const CONFIG_REGISTRY = {
  'coordinator.confidence_threshold': {
    type: 'number', default: 0.65, min: 0, max: 1,
    description: '规则置信度 ≥ 此值则跳过 LLM 兜底',
    category: 'coordinator',
  },
  'coordinator.bug_keywords': {
    type: 'string_array', default: ['bug', '错误', /* ... */],
    category: 'coordinator',
  },
  'runner.oneshot_timeout_ms': {
    type: 'number', default: 30000, min: 1000, max: 300000,
    category: 'runtime',
  },
  // ...
} as const;
```

### Runner 取值函数

```ts
// apps/runner/src/config-client.ts
let cache: Map<string, unknown> | null = null;
let cacheAt = 0;
const CACHE_TTL_MS = 1500; // 略短于 watch poll 2s

export async function getConfig<K extends keyof typeof CONFIG_REGISTRY>(
  key: K,
): Promise<(typeof CONFIG_REGISTRY)[K]['default']> {
  if (!cache || Date.now() - cacheAt > CACHE_TTL_MS) {
    try {
      cache = new Map(Object.entries(await api.getOverrides()));
      cacheAt = Date.now();
    } catch { /* 静默失败：fall back to defaults */ }
  }
  return cache?.get(key) ?? CONFIG_REGISTRY[key].default;
}
```

### API 路由

- `GET  /config/registry` → 返回 schema 给 UI（fields + types + defaults + descriptions）
- `GET  /config/overrides` → 返回当前所有 override
- `PUT  /config/overrides/:key` → 设置 override（写 audit）
- `DELETE /config/overrides/:key` → 删除 override / reset（写 audit）
- `GET  /config/audit?key=xxx&limit=20` → 历史

### Web UI

- 新增 "Settings" 顶级路由 (`#settings`)
- 按 `category` 分 tab：Coordinator / Runtime / 未来…
- 每行：`label | default | current | [edit] [reset]`
- 编辑用对应 widget：`number` → number input；`string_array` → 多行 textarea，每行一个；`string` → input；超长字符串走 `<textarea>`
- 历史 panel 折叠在每行下方

### Config Registry — v1 fields (24 keys)

> 全部静态声明在 `packages/shared/src/config/registry.ts`。新增 key 必走 PR；UI 不允许添加新 key。

#### Tab "coordinator"（14 keys）

| key | type | default 来源 | 备注 |
|---|---|---|---|
| `coordinator.confidence_threshold` | `number` (0..1) | `coordinator/index.ts:18` (0.65) | 规则置信度 ≥ 此值跳过 LLM |
| `coordinator.bug_keywords` | `string[]` | `rules.ts:32` | 替换语义 |
| `coordinator.feature_keywords` | `string[]` | `rules.ts:51` | 替换语义 |
| `coordinator.large_scope_keywords` | `string[]` | `rules.ts:69` | 替换语义 |
| `coordinator.large_scope_regex` | `string` | `rules.ts:83` | UI 提供 regex 试运行（贴一段文本即时高亮） |
| `coordinator.system_prompt` | `string` (multiline) | `prompt.ts:9-36` | textarea，AC9 |
| `coordinator.fallback.too_short_questions` | `string[]` | `rules.ts:101-105` | 2 句 |
| `coordinator.fallback.large_scope_template` | `string` | `rules.ts:124` | 含 `${trigger}` 占位 |
| `coordinator.fallback.large_scope_followup` | `string` | `rules.ts:127` | 第二句 |
| `coordinator.fallback.llm_unavailable` | `string` | `llm-fallback.ts:24` | |
| `coordinator.fallback.llm_invocation_failed` | `string` | `llm-fallback.ts:39` | |
| `coordinator.fallback.llm_empty` | `string` | `llm-fallback.ts:131` | |
| `coordinator.fallback.llm_invalid_json` | `string` | `llm-fallback.ts:147` | |
| `coordinator.fallback.llm_unknown_action` | `string` | `llm-fallback.ts:179` | |

#### Tab "skill_prompts"（5 keys）

| key | type | default 来源 | 备注 |
|---|---|---|---|
| `skill.context_pack.instructions` | `string` (multiline) | `skills/index.ts:19-20` | AC9 |
| `skill.requirement_draft.instructions` | `string` (multiline) | `skills/index.ts:46-76` | AC7 / AC9 |
| `skill.design.instructions` | `string` (multiline) | `skills/index.ts:108-136` | AC9 |
| `skill.implementation.instructions` | `string` (multiline) | `skills/index.ts:174-175` | AC9 |
| `skill.review.instructions` | `string` (multiline) | `skills/index.ts:200-201` | AC9 |

> **注**: 同一 SkillSpec 的其他字段（id / version / inputs / outputs / requiredGates / toolPolicy / compatibleBackends）只读展示，不可编辑（R10 / AC8）。

#### Tab "runtime"（5 keys）

| key | type | default 来源 | 范围 |
|---|---|---|---|
| `runner.coordinator.oneshot_timeout_ms` | `number` | `llm-fallback.ts:17` (30000) | 1000..300000 |
| `runner.watch.poll_ms` | `number` | `cmd/watch.ts:127` (2000) | 500..30000 |
| `runner.command.default_timeout_ms` | `number` | `config.ts` (`DEFAULT_TIMEOUT_MS`) | 5000..600000 |
| `runner.command.max_log_bytes` | `number` | `config.ts` (`DEFAULT_MAX_LOG_BYTES`) | 1024..50_000_000 |
| `runner.config.cache_ttl_ms` | `number` | 1500（新增） | 200..5000 |

#### 排除清单（明确不暴露）

- `WORKTREES_DIR` / `ARTIFACTS_BASE` / `AINP_API_BASE`：路径类，改错 = 数据丢失 / 失联
- mvn 命令模板（`./mvnw / mvn -B test`）：耦合 Java 项目类型，留待 ③ SkillSpec.toolPolicy 阶段
- runner ID / heartbeat 间隔：基础设施量，不是"AI 内部细节"

## Decision (ADR-lite)

### D1: MVP 范围 = MVP-M
- **Context**: 5 类硬编码（Coordinator / SkillSpec instructions / SkillSpec 结构 / Gate 规则 / 运行时阈值）暴露需求差异巨大；工程量 X→XL 跨度 5-10 倍。
- **Decision**: 选择 MVP-M（① + ② + ⑤），覆盖 Coordinator 调优物 + 5 个 SkillSpec 长 prompt 编辑 + 运行时阈值。
- **Consequences**:
  - 引入 SQLite `config_overrides` 表 + audit + 取值函数 `getConfig`
  - 需要长 markdown 字段编辑器；UI bundle 可能从纯 DOM 上加新组件
  - 不强制运行时校验 toolPolicy（沙箱原则项目记忆禁止）
  - ③ ④ 留白；将来若做 ③，需要 schema-driven 表单 + 沙箱协同设计
  - SkillSpec 整体不开放编辑——只开放 instructions 单字段，避免破坏 inputs/outputs 流程拓扑

### D2: Override 生效语义 = 直接生效（非 draft+publish）
- **Context**: 单用户 MVP；改一半被读走是多人并发场景的痛点，单用户改的时候自己就是 run 的发起者，不会自己撞自己。
- **Decision**: UI [Save] 按钮触发 PUT → DB 立即写入 → runner 下次 poll 周期（≤2s）拿到新值。无 draft 状态。
- **Consequences**:
  - 数据模型简化：`config_overrides.value_json` 单列即可；`draft_value_json` 留作未来非破坏性扩展
  - API 路由不需要 `/publish`；audit log + DELETE-as-revert 覆盖"撤销"语义
  - UI 长 prompt 编辑用显式 [Save] 按钮防意外失焦写入；scalar 字段可在 [Save] 时一并 commit
  - 若未来引入多用户/多 run 协同，需要重启讨论（升到 draft+publish 或加锁）

### D3: 长 prompt 编辑器 = 原生 textarea + autosize（非 CodeMirror / Monaco）
- **Context**: 5 个 SkillSpec instructions + Coordinator system prompt 都是 1-3KB markdown，给 LLM 读不给人渲染；apps/web bundle 已 130 KB；编辑频率低（一周一两次量级）。
- **Decision**: 编辑用 `<textarea>` + JS 自动撑高，不引入 markdown 编辑器库。
- **Consequences**:
  - bundle 体积零增量；首屏加载不退化
  - 没有语法高亮 / live preview / 折叠——但 prompt 是 LLM 输入，这些对正确性零贡献
  - widget 接口设计成可替换：将来需要时换 CodeMirror 6 仅替换组件，不动数据 / API / runner
  - AC9（≥3KB 无截断 + LF 保真 + 内容稳定）由 textarea 天然支持

### D4: 数组语义 = 替换全数组（C 选项 = A 存储 + UI 便利）
- **Context**: 数组类 override（BUG_KEYWORDS 等）需要"改一下"语义，但 patch 模型对单用户 MVP 是过度设计。
- **Decision**: 存储语义 = 整段替换（`value_json` 是用户编辑后的完整数组）；UI 上提供编辑框预填 current value + [复制默认值] + Reset 按钮。
- **Consequences**:
  - runtime 取值代码最简：`JSON.parse(value) ?? default`，零合并逻辑
  - 数据模型与 number / string / 长 prompt 完全一致（都是"完整覆盖"语义）
  - 未来若需要 patch 语义，可加 `value_kind: 'replace' | 'patch'` 字段非破坏扩展
  - UI 上需要写一段 array editor 组件（多行 textarea + 按行解析）

### D5: 缓存与失败模式 — 1.5s TTL + stale-while-revalidate + fail-open
- **Context**: runner 已经在每 2s poll API；config 取值如果每次都打 HTTP 会放大 RTT；同时 API 偶尔不可达（重启 / 维护）不能让 runner 崩。
- **Decision**:
  - runner 维护内存缓存，TTL = 1500ms（< 2s poll 周期，下个 stage 取值前已自然过期）
  - getConfig() 在 cache miss 时尝试 fetch；fetch 失败 = 保留上次成功的缓存（stale-while-revalidate）
  - 启动时第一次 fetch 失败 = 用代码默认 + 一次 warn log；不阻断 runner 启动
- **Consequences**:
  - 单次 workflow run 内 config 一致性高（缓存周期内同值）
  - API 短暂故障不影响在跑 run（继续用最后成功值）
  - 长时间故障 = 一直用 stale 值；可在 UI 显示"runner 上次同步时间"作为可观测信号（未来增强）
  - AC5 / AC11 / AC12 由此覆盖

### D6: UI 编排 = 顶级 #settings + category tab
- **Context**: 三类配置（Coordinator / SkillSpec Prompts / Runtime）展示形态差异大；需独立路由方便分享 URL。
- **Decision**:
  - 顶级 hash 路由 `#settings`，与现有 `#task/...` 平级
  - 三 tab：`coordinator`（关键词 / 阈值 / system prompt / 兜底 questions）/ `skill_prompts`（5 个 SkillSpec instructions + 只读结构）/ `runtime`（timeout / poll / cache TTL）
  - 列表行：`label | default | current | [edit] [reset] [history ▾]`
  - 详情：长 prompt 字段进入"详情子页"全屏编辑，scalar 字段在列表行内编辑
  - 历史 panel 折叠展开在每行下方，不弹模态
- **Consequences**:
  - main.ts 增加约 800-1200 行（路由 + 三 tab 渲染 + 编辑器组件）
  - 不复用 task 详情页，避免与 Coordinator chat panel 风格冲突
  - 直接 `?#settings/skill_prompts/skill.requirement_draft.instructions` 可分享深链

### D7: Config Registry 字段清单 v1（24 keys）
- **Context**: 需要明确 MVP-M 范围里到底暴露哪些 key，避免 scope creep。
- **Decision**: 见下方 "Config Registry — v1 fields" 子节，分为：
  - Coordinator 类（14 keys）：阈值 1 + 关键词数组 3 + regex 1 + system prompt 1 + 兜底 questions 8
  - SkillSpec Prompts 类（5 keys）：5 个 SkillSpec.instructions
  - Runtime 类（5 keys）：4 个 timeout/limit + cache TTL
  - 三类合计 24（cache_ttl 是元配置但归入 runtime tab，不另列 meta tab）
- **Consequences**:
  - 所有 24 个 key 在 `packages/shared/src/config/registry.ts` 静态声明 default + type + validator
  - 排除：`AINP_API_BASE` / `WORKTREES_DIR` / `ARTIFACTS_BASE`（路径类，改错破坏环境）；mvn 命令模板（耦合项目类型，留待 ③ 阶段）
  - 新增 key 走 PR 流程（改 registry.ts），UI 自动反映；不在 UI 增加 key

## Technical Notes

- 关键文件：
  - `apps/runner/src/agents/coordinator/rules.ts:32-176`
  - `apps/runner/src/agents/coordinator/index.ts:18`
  - `apps/runner/src/agents/coordinator/prompt.ts:9-36`
  - `apps/runner/src/agents/coordinator/llm-fallback.ts:17`
  - `apps/runner/src/skills/index.ts:14-211`
  - `apps/runner/src/cmd/watch.ts:125-167`
  - `apps/runner/src/config.ts`
  - `apps/api/src/store/store.ts` & `db.ts`
  - `apps/api/src/app.ts:14-44`
  - `apps/web/src/main.ts`（路由 + 渲染）

- 已知约束：
  - `apps/web/src/main.ts` 单文件 130 KB，没用框架；新增"Settings"页面要遵循现有 `el()` helper 风格
  - SQLite migration 是 bespoke 的（看 `apps/api/src/store/db.ts`），新增表要走那条路
  - `@ainp/shared` 用 TypeScript 项目引用；新加 CONFIG_REGISTRY 要在 shared 中导出，被 api / runner / web 三方共用
  - vitest 单测惯例：`apps/{api,runner,web}/test/*.test.ts`

- 相关 spec 文件（待读）：
  - `.trellis/spec/` 索引（在 SessionStart 已加载）
  - `CodeStable/architecture.md`（如果有）

- Open implementation questions（不阻塞 Q1，但 Q1 答完要回答）：
  - watch poll 周期里加 config fetch 还是单独 poll？
  - SkillSpec 这种"嵌套对象 + 数组"在 v2 引入时，CONFIG_REGISTRY 的结构能否平滑扩展？还是要换成 JSON Schema？
  - ✅ RESOLVED → audit log 持久化到 `.omc/audit/config-YYYY-MM-DD.jsonl`，SQLite-as-truth + jsonl mirror（fail-open）；详见 PR4 设计 D-PR4.1（`docs/superpowers/specs/2026-05-04-pr4-settings-polish-design.md`）

## PR4 Follow-up Design (2026-05-04)

PR3 已交付 Settings → Runtime Config UI。PR4 是该 UI 的精修 + 兑现 PRD 末尾 audit log 持久化的 open question。完整 design 见：

> `docs/superpowers/specs/2026-05-04-pr4-settings-polish-design.md`

PR4 包含 4 项决策：

- **D-PR4.1** · `config_audit` 镜像到 `.omc/audit/config-YYYY-MM-DD.jsonl`（SQLite-as-truth + 同步 append，fail-open）
- **D-PR4.2** · 抽 `apps/web/src/settings-projection.ts` 纯函数 → `apps/web/test/settings-projection.test.ts` vitest 覆盖（registry 分组 / override 应用 / dirty 状态 / audit 关联）
- **D-PR4.3** · CSS adornment-only：追加 `.settings-tabs / .settings-row / .settings-row__meta / .settings-row__dirty / .settings-textarea / .settings-array` 6 个具名 class 到 `apps/web/index.html`，复用现有 token，~0.6KB
- **D-PR4.4** · trellis-check 补审 PR1/PR2 → 登记为 F1 followup（不在 PR4 实施范围）

### Followups

- **F1** · trellis-check 补审 PR1/PR2
  - 触发条件：sub-agent 服务恢复
  - 命令：`/trellis:check pr1` 和 `/trellis:check pr2`
  - 产出：写入本任务目录新文件 `pr-followup-check.jsonl`（与 in-flight `check.jsonl` 区分）
